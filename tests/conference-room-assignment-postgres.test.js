'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const test=require('node:test');
const root=path.join(__dirname,'..');
const migration=path.join(root,'supabase/migrations/20261020131411_conference_room_assignment_foundation.sql');
const pgApp='/Applications/Postgres.app/Contents/Versions/latest/bin';
const pgBin=fs.existsSync(path.join(pgApp,'psql'))?pgApp:'';
const database=`conference_room_assignment_${process.pid}_${Date.now()}`;
const connection=['-h',process.env.PGHOST||'/tmp','-p',process.env.PGPORT||'5432','-U',process.env.PGUSER||os.userInfo().username];
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')&&!/(?:^DIRECT_URL$|(?:DATABASE|DB|POSTGRES|SUPABASE).*URL)/i.test(key)));
function tool(name){return pgBin?path.join(pgBin,name):name;}
function command(name,args){return execFileSync(tool(name),[...connection,...args],{encoding:'utf8',stdio:'pipe',env}).trim();}
function query(sql){return command('psql',['-X','-v','ON_ERROR_STOP=1','-At','-d',database,'-c',sql]);}
function rejects(sql,pattern){assert.throws(()=>query(sql),error=>pattern.test(String(error.stderr)),String(pattern));}
function asyncQuery(sql){return new Promise(resolve=>{const child=spawn(tool('psql'),[...connection,'-X','-v','ON_ERROR_STOP=1','-At','-d',database,'-c',sql],{env});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('close',code=>resolve({code,out,err}));});}

test('room allocation PostgreSQL proves overlap, concurrency, dates, occupancy, ACL and replay',async()=>{
  const actor='10000000-0000-4000-8000-000000000001',device='20000000-0000-4000-8000-000000000001';
  const c1='30000000-0000-4000-8000-000000000001',c2='30000000-0000-4000-8000-000000000002',c3='30000000-0000-4000-8000-000000000003';
  const house='40000000-0000-4000-8000-000000000001',floor='50000000-0000-4000-8000-000000000001';
  const room1='60000000-0000-4000-8000-000000000001',room2='60000000-0000-4000-8000-000000000002',room3='60000000-0000-4000-8000-000000000003';
  const context=`set local platform.phase1c_context='${JSON.stringify({user_id:actor,device_id:device})}';`;
  let sequence=0;const op=()=>`70000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
  const assignHouse=(conference,operation)=>`begin;${context}select public.assign_conference_house('${device}','${operation}','${conference}','${house}',true,null);commit;`;
  const assignRoom=(conference,room,operation)=>`begin;${context}select public.assign_conference_room('${device}','${operation}','${conference}','${room}',true,null);commit;`;
  const created=[];
  try{command('psql',['-X','-At','-d','postgres','-c','select 1']);}catch{assert.fail('isolated/local PostgreSQL is required; do not silently skip');}
  command('createdb',[database]);
  try{
    for(const role of ['anon','authenticated','service_role'])if(query(`select exists(select 1 from pg_roles where rolname='${role}')`)==='f'){query(`create role ${role} nologin`);created.push(role);}
    query(`create schema extensions;create extension pgcrypto with schema extensions;create schema platform;create schema platform_private;
      create table platform.profiles(user_id uuid primary key);
      create table platform.user_device_authorizations(id uuid primary key,user_id uuid,device_id uuid,status text);
      create table platform.audit_events(id uuid primary key default extensions.gen_random_uuid(),actor_user_id uuid,actor_device_authorization_id uuid,domain text,module text,action text,entity_type text,entity_id uuid,scope_type text,scope_id text,old_values jsonb,new_values jsonb,metadata jsonb,operation_id uuid,source text);
      create table public.conferences(id uuid primary key,start_date date not null,end_date date not null,deleted_at timestamptz);
      create table public.conference_accommodation_houses(id uuid primary key,name text,description text,position integer,revision bigint,is_active boolean);
      create table public.conference_accommodation_floors(id uuid primary key,house_id uuid references public.conference_accommodation_houses(id),name text,position integer,revision bigint);
      create table public.conference_accommodation_rooms(id uuid primary key,floor_id uuid references public.conference_accommodation_floors(id),room_number text,base_capacity integer,extra_bed_capacity integer,notes text,is_closed boolean,closed_day integer,position integer,revision bigint);
      create table public.conference_house_assignments(id uuid primary key default extensions.gen_random_uuid(),conference_id uuid references public.conferences(id),house_id uuid references public.conference_accommodation_houses(id),revision bigint default 1,created_by uuid references platform.profiles(user_id),updated_by uuid references platform.profiles(user_id),unique(conference_id,house_id));
      create table platform.people(id uuid primary key,full_name text,phone text,gender text,date_of_birth date,church text);
      create table public.conference_participations(id uuid primary key,conference_id uuid,status text,person_id uuid references platform.people(id));
      create table public.conference_accommodation_occupancies(id uuid primary key default extensions.gen_random_uuid(),conference_id uuid,room_id uuid,participation_id uuid,revision bigint default 1,arrival_day integer,leave_day integer,bed_type text,extra_bed_person_type text);
      create function platform_private.validated_phase1c_device_authorization(a uuid,d uuid) returns uuid language sql stable as $$select id from platform.user_device_authorizations where user_id=a and device_id=d and status='approved'$$;
      create function platform_private.require_conference_accommodation_context(d uuid,c uuid,p text,m boolean) returns jsonb language plpgsql stable as $$declare x jsonb;begin x:=nullif(current_setting('platform.phase1c_context',true),'')::jsonb;if x is null or (x->>'user_id')::uuid<>'${actor}' or (x->>'device_id')::uuid<>d or platform_private.validated_phase1c_device_authorization((x->>'user_id')::uuid,d) is null then raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501';end if;return jsonb_build_object('actorUserId',x->>'user_id');end$$;
      create function platform_private.require_exact_jsonb_keys(p jsonb,r text[]) returns void language plpgsql as $$begin return;end$$;
      create function platform_private.conference_accommodation_pricing_projection(c uuid) returns jsonb language sql stable as $$select '{}'::jsonb$$;
      create function platform_private.route_canonical_conference_operation(a uuid,b uuid,c bytea,d uuid,p_operation text,p_args jsonb) returns jsonb language plpgsql as $$begin
 if p_operation='noop' then return '{}'::jsonb;
  elsif p_operation='get_conference_accommodation' then return '{}'::jsonb;
 end if;return '{}'::jsonb;end$$;
      insert into platform.profiles values('${actor}');insert into platform.user_device_authorizations values(extensions.gen_random_uuid(),'${actor}','${device}','approved');
      insert into public.conferences values('${c1}','2026-01-01','2026-01-05',null),('${c2}','2026-02-01','2026-02-05',null),('${c3}','2026-02-05','2026-02-09',null);
      insert into public.conference_accommodation_houses values('${house}','House',null,0,1,true);insert into public.conference_accommodation_floors values('${floor}','${house}','Floor',0,1);insert into public.conference_accommodation_rooms values('${room1}','${floor}','1',2,0,null,false,null,0,1),('${room2}','${floor}','2',2,0,null,false,null,1,1),('${room3}','${floor}','3',2,0,null,false,null,2,1);insert into public.conference_house_assignments(conference_id,house_id,created_by,updated_by) values('${c1}','${house}','${actor}','${actor}');`);
    command('psql',['-X','-v','ON_ERROR_STOP=1','-d',database,'-f',migration]);
    assert.equal(query(`select count(*) from public.conference_room_assignments where conference_id='${c1}'`),'3');
    query(assignHouse(c2,op()));query(assignHouse(c3,op()));
    query(assignRoom(c2,room1,op()));
    rejects(assignRoom(c3,room1,op()),/ROOM_CONFERENCE_PERIOD_OVERLAP/);
    rejects(`update public.conferences set start_date='2026-02-05',end_date='2026-02-10' where id='${c1}'`,/ROOM_CONFERENCE_PERIOD_OVERLAP/);
    const replayOp=op(),first=query(assignRoom(c2,room2,replayOp)),second=query(assignRoom(c2,room2,replayOp));assert.match(first,/"status": "success"/);assert.match(second,/"status": "duplicate"/);assert.equal(query(`select count(*) from platform.audit_events where operation_id='${replayOp}'`),'1');
    query(`insert into public.conference_accommodation_occupancies(conference_id,room_id) values('${c2}','${room2}')`);rejects(`begin;${context}select public.assign_conference_room('${device}','${op()}','${c2}','${room2}',false,1);commit;`,/ROOM_ASSIGNMENT_HAS_OCCUPANCIES/);query(`delete from public.conference_accommodation_occupancies where conference_id='${c2}' and room_id='${room2}'`);
    query(`delete from public.conference_room_assignments where conference_id='${c1}' and room_id='${room3}'`);
    const [a,b]=await Promise.all([asyncQuery(assignRoom(c2,room3,op())),asyncQuery(assignRoom(c3,room3,op()))]);assert.equal([a,b].filter(x=>x.code===0).length,1);assert.equal([a,b].filter(x=>/ROOM_CONFERENCE_PERIOD_OVERLAP/.test(x.err)).length,1);
    for(const role of ['public','anon','authenticated','service_role'])assert.equal(query(`select has_table_privilege('${role}','public.conference_room_assignments','select') or has_table_privilege('${role}','public.conference_room_assignments','insert')`),'f');
  }finally{command('dropdb',['--if-exists',database]);for(const role of created)command('psql',['-X','-v','ON_ERROR_STOP=1','-d','postgres','-c',`drop role ${role}`]);}
});
