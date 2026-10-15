'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const test=require('node:test');
const root=path.join(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261003140000_canonical_conference_transport_foundation.sql'),'utf8');

test('1 Transport reuses the canonical Participation operation ledger',()=>assert.match(sql,/public\.conference_participation_operations/));
test('2 no parallel Transport ledger or replay helper remains',()=>assert.doesNotMatch(sql,/conference_transport_operations|transport_replay/));
test('3 replay returns the original stored result',()=>assert.match(sql,/if found then[\s\S]*return prior\.result/));
test('4 replay exits before mutation and audit',()=>assert.ok(sql.indexOf('return prior.result')<sql.indexOf('conference.transport.vehicle_')));
test('5 operation ID mismatch is rejected by the canonical ledger',()=>assert.match(sql,/CONFERENCE_PARTICIPATION_OPERATION_MISMATCH/));
test('6 guardian removal returns every removed assignment ID',()=>assert.match(sql,/guardian_assignment_removed[\s\S]*removedAssignmentIds/));
test('7 shared children are locked, audited, then deleted',()=>assert.match(sql,/order by child_assignment\.id for update of child_assignment[\s\S]*audit_conference_transport_assignment_removal[\s\S]*delete from public\.conference_transport_assignments child_assignment/));
test('8 requested guardian assignment is explicitly audited',()=>assert.match(sql,/audit_conference_transport_assignment_removal\(actor,authz,old,p_operation_id,'assignment_removed'/));
test('9 vehicle deletion audits every assignment before explicit deletion',()=>assert.match(sql,/where vehicle_id=p_vehicle order by id for update loop[\s\S]*'vehicle_deleted'[\s\S]*delete from public\.conference_transport_assignments where vehicle_id=p_vehicle/));
test('10 capacity shrink audits every overflow assignment',()=>assert.match(sql,/seat_number>p_capacity order by id for update loop[\s\S]*'capacity_reduced'[\s\S]*delete from public\.conference_transport_assignments where vehicle_id=p_vehicle and seat_number>p_capacity/));
test('11 Participation deletion explicitly cleans Transport before canonical deletion',()=>assert.match(sql,/delete from public\.conference_transport_assignments where participation_id=any\(v_participation_ids\)[\s\S]*delete_conference_participation_without_transport_cleanup/));
test('12 guardian Participation cascade shares one locked transaction',()=>assert.match(sql,/conference-guardian:[\s\S]*guardian_participation_id=p_participation_id[\s\S]*participation_id=any\(v_participation_ids\)/));
test('13 function ordering preserves rollback of cleanup and Participation deletion',()=>{assert.match(sql,/returns jsonb language plpgsql security definer/);assert.doesNotMatch(sql,/\bcommit\b[\s\S]*delete_conference_participation_without_transport_cleanup/i);});
test('14 B2 product semantics remain Participation based and Accommodation optional',()=>{assert.match(sql,/participation_id uuid not null/);assert.match(sql,/left join public\.conference_accommodation_occupancies/);assert.doesNotMatch(sql.slice(sql.indexOf('create function public.set_conference_transport_assignment'),sql.indexOf('create function public.remove_conference_transport_assignment')),/occupanc|room_id/i);});
test('15 ACL and RLS remain protected',()=>{assert.match(sql,/force row level security/);assert.match(sql,/revoke all on table public\.conference_transport_vehicles,public\.conference_transport_assignments from public,anon,authenticated,service_role/);});
test('16 linked legacy authority is not introduced by the correction',()=>assert.doesNotMatch(sql,/conference_snapshots|conference_members|current\.transports|\bsave\(\)/));

const pgApp='/Applications/Postgres.app/Contents/Versions/latest/bin';
const pgBin=fs.existsSync(path.join(pgApp,'psql'))?pgApp:'';
const database=`conference_p6i_b2_1_${process.pid}_${Date.now()}`;
const connection=['-h',process.env.PGHOST||'/tmp','-p',process.env.PGPORT||'5432','-U',process.env.PGUSER||os.userInfo().username];
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')&&!/(?:^DIRECT_URL$|(?:DATABASE|DB|POSTGRES|SUPABASE).*URL)/i.test(key)));
function command(name,args){return execFileSync(pgBin?path.join(pgBin,name):name,[...connection,...args],{encoding:'utf8',stdio:'pipe',env}).trim();}
function query(statement){return command('psql',['-X','-v','ON_ERROR_STOP=1','-At','-d',database,'-c',statement]);}
function rejects(statement,pattern){assert.throws(()=>query(statement),error=>pattern.test(String(error.stderr)));}

test('disposable PostgreSQL proves ledger replay, complete cleanup audits and atomic rollback',async(t)=>{
  const actor='10000000-0000-0000-0000-000000000001',device='11000000-0000-0000-0000-000000000001',authz='12000000-0000-0000-0000-000000000001';
  const conference='20000000-0000-0000-0000-000000000001',roles=['anon','authenticated','service_role'],created=[];
  command('createdb',[database]);
  try{
    for(const role of roles)if(query(`select exists(select 1 from pg_roles where rolname='${role}')`)==='f'){query(`create role ${role} nologin`);created.push(role);}
    query(`create schema extensions; create extension pgcrypto with schema extensions; create schema platform; create schema platform_private;
      create table platform.profiles(user_id uuid primary key);
      create table platform.people(id uuid primary key,full_name text,phone text);
      create table platform.audit_events(id uuid primary key default extensions.gen_random_uuid(),actor_user_id uuid,actor_device_authorization_id uuid,domain text,module text,action text,entity_type text,entity_id uuid,scope_type text,old_values jsonb,new_values jsonb,metadata jsonb,operation_id uuid,source text,occurred_at timestamptz default now());
      create table public.conferences(id uuid primary key,organization_id uuid,name text,start_date date,end_date date,status text,completed_at timestamptz,revision bigint default 1,created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz);
      create table public.conference_participations(id uuid primary key,conference_id uuid not null references public.conferences(id),person_id uuid not null references platform.people(id),status text not null default 'active',guardian_participation_id uuid,revision bigint not null default 1,created_at timestamptz default now(),updated_at timestamptz default now(),created_by uuid references platform.profiles(user_id),updated_by uuid references platform.profiles(user_id),unique(id,conference_id));
      create table public.conference_participation_operations(actor_user_id uuid not null,operation_id uuid not null,operation text not null constraint conference_participation_operations_operation_check check(operation in('create','create_with_person','set_status','set_guardian','delete')),request jsonb not null,result jsonb not null,created_at timestamptz default now(),primary key(actor_user_id,operation_id));
      create table public.conference_accommodation_rooms(id uuid primary key,room_number text);
      create table public.conference_accommodation_occupancies(participation_id uuid,room_id uuid);
      create table public.module_permission_catalog(permission_key text primary key,module_key text,status text);
      create table public.permission_context(view_allowed boolean,manage_allowed boolean,device_allowed boolean);insert into public.permission_context values(true,true,true);
      insert into public.module_permission_catalog values('conference.transport.view','conference','active'),('conference.transport.manage','conference','active'),('conference.restaurant.view','conference','active'),('conference.restaurant.manage','conference','active');
      insert into platform.profiles values('${actor}');
      insert into public.conferences(id,organization_id,name,start_date,end_date,status) values('${conference}',extensions.gen_random_uuid(),'Test','2027-01-01','2027-01-05','active');
      create function public.require_effective_module_permission(uuid,text,text,text,text) returns jsonb language plpgsql stable as \$\$ declare x public.permission_context%rowtype;begin select * into x from public.permission_context;if (\$3='conference.restaurant.view' and not x.view_allowed) or (\$3='conference.restaurant.manage' and not x.manage_allowed) then raise exception 'MODULE_PERMISSION_REQUIRED' using errcode='42501';end if;return jsonb_build_object('actorUserId','${actor}');end \$\$;
      create function platform_private.validated_phase1c_device_authorization(uuid,uuid) returns uuid language sql stable as \$\$ select case when \$1='${actor}' and \$2='${device}' and (select device_allowed from public.permission_context) then '${authz}'::uuid end \$\$;
      create function platform_private.require_exact_jsonb_keys(jsonb,text[],text[] default '{}') returns void language sql immutable as \$\$ select \$\$;
      create function public.require_current_approved_device(uuid) returns jsonb language sql stable as \$\$ select '{}'::jsonb \$\$;
      create function platform_private.require_conference_participation_context(uuid,uuid,text,boolean) returns jsonb language sql stable as \$\$ select jsonb_build_object('actorUserId','${actor}') \$\$;
      create function platform_private.route_canonical_conference_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_actor_device_id uuid,p_operation text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='' as \$\$ begin if p_operation='list_accessible_conferences' then return '{}'::jsonb; elsif p_operation='get_conference_core' then return '{}'::jsonb; end if; return '{}'::jsonb; end \$\$;
      create function public.list_accessible_conferences(uuid) returns jsonb language sql stable as \$\$ select '{}'::jsonb \$\$;
      create function public.delete_conference_participation(p_actor_device_id uuid,p_operation_id uuid,p_participation_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as \$\$
      declare a uuid; old public.conference_participations%rowtype; ids uuid[]; result jsonb;
      begin a:=(current_setting('platform.phase1c_context')::jsonb->>'user_id')::uuid;
        select * into old from public.conference_participations where id=p_participation_id for update;
        if not found then raise exception 'CONFERENCE_PARTICIPATION_NOT_FOUND'; end if;
        if old.revision<>p_expected_revision then raise exception 'CONFERENCE_PARTICIPATION_REVISION_CONFLICT'; end if;
        select array_agg(id order by id) into ids from public.conference_participations where id=p_participation_id or guardian_participation_id=p_participation_id;
        delete from public.conference_participations where id=any(ids);
        result:=jsonb_build_object('participationId',p_participation_id,'conferenceId',old.conference_id,'deletedParticipationIds',to_jsonb(ids),'deleted',true);
        insert into public.conference_participation_operations values(a,p_operation_id,'delete',jsonb_build_object('participationId',p_participation_id,'expectedRevision',p_expected_revision),result,statement_timestamp());
        return result;
      end \$\$;`);
    command('psql',['-X','-v','ON_ERROR_STOP=1','-d',database,'-f',path.join(root,'supabase/migrations/20261003140000_canonical_conference_transport_foundation.sql')]);
    command('psql',['-X','-v','ON_ERROR_STOP=1','-d',database,'-f',path.join(root,'supabase/migrations/20261003160000_canonical_conference_restaurant_foundation.sql')]);
    query(`create function public.search_conference_people(uuid,uuid,text,integer) returns jsonb language sql as \$\$select '{}'::jsonb\$\$;
      create function public.get_conference_canonical_person(uuid,uuid,uuid) returns jsonb language sql as \$\$select '{}'::jsonb\$\$;
      create function public.update_conference_canonical_person(uuid,uuid,uuid,bigint,text,text,text,text,date) returns jsonb language sql as \$\$select '{}'::jsonb\$\$;
      create function public.create_conference_participation(uuid,uuid,uuid,uuid) returns jsonb language sql as \$\$select '{}'::jsonb\$\$;
      create function public.create_conference_participation_with_person(uuid,uuid,uuid,text,text,text,date,text) returns jsonb language sql as \$\$select '{}'::jsonb\$\$;
      create function platform_private.cleanup_conference_accommodation_for_participation(uuid,uuid,uuid,jsonb,text,uuid) returns uuid language plpgsql as \$\$declare removed uuid;begin delete from public.conference_accommodation_occupancies where participation_id=\$1 returning room_id into removed;return removed;end\$\$;
      create or replace function platform_private.route_canonical_conference_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_actor_device_id uuid,p_operation text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='' as \$\$ begin
        if p_operation='search_conference_people' then return public.search_conference_people(p_actor_device_id,null,null,null);
        elsif p_operation='get_conference_canonical_person' then return public.get_conference_canonical_person(p_actor_device_id,null,null);
        elsif p_operation='update_conference_canonical_person' then return public.update_conference_canonical_person(p_actor_device_id,null,null,null,null,null,null,null,null);
        elsif p_operation='create_conference_participation' then return public.create_conference_participation(p_actor_device_id,null,null,null);
        elsif p_operation='create_conference_participation_with_person' then return public.create_conference_participation_with_person(p_actor_device_id,null,null,null,null,null,null,null);
        elsif p_operation='delete_conference_participation' then return public.delete_conference_participation(p_actor_device_id,null,null,null); end if;
        return '{}'::jsonb; end \$\$;`);
    command('psql',['-X','-v','ON_ERROR_STOP=1','-d',database,'-f',path.join(root,'supabase/migrations/20261015110000_conference_people_operation_contract_reconciliation.sql')]);
    query(`create function platform_private.run_delete(uuid,uuid,bigint) returns jsonb language plpgsql security definer set search_path='' as \$\$ begin perform set_config('platform.phase1c_context',jsonb_build_object('purpose','PLATFORM_DEVICE_SESSION_DISPATCH','user_id','${actor}','device_id','${device}')::text,true); return public.delete_conference_participation('${device}',\$1,\$2,\$3); end \$\$;
      create function platform_private.run_remove(uuid,uuid,bigint) returns jsonb language plpgsql security definer set search_path='' as \$\$ begin perform set_config('platform.phase1c_context',jsonb_build_object('purpose','PLATFORM_DEVICE_SESSION_DISPATCH','user_id','${actor}','device_id','${device}')::text,true); return public.remove_conference_transport_assignment('${device}',\$1,\$2,\$3); end \$\$;`);
    let sequence=1;
    const uuid=prefix=>`${prefix}000000-0000-0000-0000-${String(sequence++).padStart(12,'0')}`;
    function participant(guardian=null){const person=uuid('30'),part=uuid('40');query(`insert into platform.people values('${person}','Person',null);insert into public.conference_participations values('${part}','${conference}','${person}','active',${guardian?`'${guardian}'`:'null'},1,now(),now(),'${actor}','${actor}')`);return part;}
    function vehicle(capacity=4){return JSON.parse(query(`select public.mutate_conference_transport_vehicle('${device}','${uuid('50')}','create','${conference}',null,null,'Bus ${sequence}','🚌',${capacity},0,false)`));}
    function assign(part,vehicleId,mode='independent',seat=1){return JSON.parse(query(`select public.set_conference_transport_assignment('${device}','${uuid('51')}','${conference}','${part}','${vehicleId}','${mode}','${mode==='shared'?'child':'adult'}',${seat===null?'null':seat},null)`));}

    await t.test('guardian removal audits all assignments once and replay is exact',()=>{
      const guardian=participant(),child=participant(guardian),bus=vehicle(),ga=assign(guardian,bus.vehicleId),ca=assign(child,bus.vehicleId,'shared',null),op=uuid('52');
      const result=JSON.parse(query(`select platform_private.run_remove('${op}','${ga.assignmentId}',1)`));
      assert.deepEqual(new Set(result.removedAssignmentIds),new Set([ga.assignmentId,ca.assignmentId]));
      assert.equal(query(`select count(*) from platform.audit_events where operation_id='${op}' and action='conference.transport.assignment_removed'`),'2');
      assert.deepEqual(JSON.parse(query(`select platform_private.run_remove('${op}','${ga.assignmentId}',1)`)),result);
      assert.equal(query(`select count(*) from platform.audit_events where operation_id='${op}'`),'2');
      rejects(`select platform_private.run_remove('${op}','${ca.assignmentId}',1)`,/CONFERENCE_PARTICIPATION_OPERATION_MISMATCH/);
    });
    await t.test('vehicle delete and capacity shrink audit every implicit assignment removal',()=>{
      const bus=vehicle(3),a=assign(participant(),bus.vehicleId,'independent',1),b=assign(participant(),bus.vehicleId,'independent',3),shrink=uuid('53');
      const reduced=JSON.parse(query(`select public.mutate_conference_transport_vehicle('${device}','${shrink}','update','${conference}','${bus.vehicleId}',1,'Bus reduced','🚌',1,0,true)`));
      assert.deepEqual(reduced.removedAssignmentIds,[b.assignmentId]);assert.equal(query(`select metadata->>'removalReason' from platform.audit_events where operation_id='${shrink}' and action='conference.transport.assignment_removed'`),'capacity_reduced');
      const gone=uuid('54'),deleted=JSON.parse(query(`select public.mutate_conference_transport_vehicle('${device}','${gone}','delete','${conference}','${bus.vehicleId}',2,null,null,null,null,false)`));
      assert.deepEqual(deleted.removedAssignmentIds,[a.assignmentId]);assert.equal(query(`select metadata->>'removalReason' from platform.audit_events where operation_id='${gone}' and action='conference.transport.assignment_removed'`),'vehicle_deleted');
    });
    await t.test('Restaurant facts use Participation without Accommodation and canonical replay',()=>{
      const first=participant(),second=participant(),settingsOp=uuid('57');query(`update platform.people set full_name='Same name' where id in(select person_id from public.conference_participations where id in('${first}','${second}'))`);
      const payload=`jsonb_build_object('enabled',true,'firstMeal','dinner','lastMeal','lunch','prices',jsonb_build_object('breakfast',10,'lunch',20,'dinner',30))`;
      const result=JSON.parse(query(`select public.mutate_conference_restaurant('${device}','${settingsOp}','update_settings','${conference}',null,${payload})`));
      assert.deepEqual(JSON.parse(query(`select public.mutate_conference_restaurant('${device}','${settingsOp}','update_settings','${conference}',null,${payload})`)),result);
      assert.equal(query(`select count(*) from platform.audit_events where operation_id='${settingsOp}'`),'1');
      rejects(`select public.mutate_conference_restaurant('${device}','${settingsOp}','update_settings','${conference}',null,jsonb_build_object('enabled',false,'firstMeal','dinner','lastMeal','lunch','prices',jsonb_build_object('breakfast',10,'lunch',20,'dinner',30)))`,/CONFERENCE_PARTICIPATION_OPERATION_MISMATCH/);
      for(const part of [first,second])query(`select public.mutate_conference_restaurant('${device}','${uuid('58')}','upsert_participation','${conference}',null,jsonb_build_object('participationId','${part}','day',1,'meal','dinner','included',false,'note','test'))`);
      const projection=JSON.parse(query(`select public.get_conference_restaurant('${device}','${conference}')`));
      assert.equal(projection.participations.filter(item=>item.person.fullName==='Same name').length,2);assert.equal(projection.participations.filter(item=>[first,second].includes(item.participationId)&&item.roomNumber===null).length,2);assert.equal(projection.participationOverrides.length,2);
      assert.equal(query(`select count(*) from public.conference_accommodation_occupancies where participation_id in('${first}','${second}')`),'0');
      assert.equal(query(`select count(*) from public.conference_restaurant_participation_overrides where participation_id in('${first}','${second}')`),'2');
    });
    await t.test('Restaurant read, manage and approved-device boundaries fail closed',()=>{
      query('update public.permission_context set manage_allowed=false');rejects(`select public.mutate_conference_restaurant('${device}','${uuid('57')}','update_settings','${conference}',1,jsonb_build_object('enabled',true,'firstMeal','dinner','lastMeal','lunch','prices',jsonb_build_object('breakfast',1,'lunch',1,'dinner',1)))`,/MODULE_PERMISSION_REQUIRED/);query(`select public.get_conference_restaurant('${device}','${conference}')`);
      query('update public.permission_context set manage_allowed=true,view_allowed=false');rejects(`select public.get_conference_restaurant('${device}','${conference}')`,/MODULE_PERMISSION_REQUIRED/);
      query('update public.permission_context set view_allowed=true,device_allowed=false');rejects(`select public.get_conference_restaurant('${device}','${conference}')`,/APPROVED_DEVICE_SESSION_REQUIRED/);query('update public.permission_context set device_allowed=true');
    });
    await t.test('Participation guardian cascade cleans Transport explicitly and replays without duplicate audit',()=>{
      const guardian=participant(),child=participant(guardian),bus=vehicle(),ga=assign(guardian,bus.vehicleId),ca=assign(child,bus.vehicleId,'shared',null),op=uuid('55');
      query(`select public.mutate_conference_restaurant('${device}','${uuid('59')}','upsert_participation','${conference}',null,jsonb_build_object('participationId','${child}','day',1,'meal','dinner','included',false,'note','cascade'))`);
      const result=JSON.parse(query(`select platform_private.run_delete('${op}','${guardian}',1)`));
      assert.deepEqual(new Set(result.removedTransportAssignmentIds),new Set([ga.assignmentId,ca.assignmentId]));
      assert.equal(query(`select count(*) from public.conference_participations where id in('${guardian}','${child}')`),'0');
      assert.equal(query(`select count(*) from platform.audit_events where operation_id='${op}' and action='conference.transport.assignment_removed'`),'2');
      assert.equal(query(`select count(*) from platform.audit_events where operation_id='${op}' and action='conference.restaurant.participation_override_removed'`),'1');
      assert.deepEqual(JSON.parse(query(`select platform_private.run_delete('${op}','${guardian}',1)`)),result);
      assert.equal(query(`select count(*) from platform.audit_events where operation_id='${op}'`),'5');
    });
    await t.test('injected failure rolls back Transport cleanup, audit and Participation deletion',()=>{
      const part=participant(),bus=vehicle(),assignment=assign(part,bus.vehicleId),op=uuid('56');
      query(`select public.mutate_conference_restaurant('${device}','${uuid('59')}','upsert_participation','${conference}',null,jsonb_build_object('participationId','${part}','day',1,'meal','dinner','included',false,'note','rollback'))`);
      query(`create function public.fail_transport_cleanup() returns trigger language plpgsql as \$\$ begin if new.operation_id='${op}' then raise exception 'INJECTED_TRANSPORT_FAILURE'; end if; return new; end \$\$;create trigger fail_transport_cleanup before insert on platform.audit_events for each row execute function public.fail_transport_cleanup()`);
      rejects(`select platform_private.run_delete('${op}','${part}',1)`,/INJECTED_TRANSPORT_FAILURE/);
      assert.equal(query(`select count(*) from public.conference_participations where id='${part}'`),'1');assert.equal(query(`select count(*) from public.conference_transport_assignments where id='${assignment.assignmentId}'`),'1');assert.equal(query(`select count(*) from platform.audit_events where operation_id='${op}'`),'0');assert.equal(query(`select count(*) from public.conference_participation_operations where operation_id='${op}'`),'0');
      assert.equal(query(`select count(*) from public.conference_restaurant_participation_overrides where participation_id='${part}'`),'1');
    });
    for(const role of roles){assert.equal(query(`select has_table_privilege('${role}','public.conference_transport_assignments','SELECT,INSERT,UPDATE,DELETE')`),'f');assert.equal(query(`select has_function_privilege('${role}','public.remove_conference_transport_assignment(uuid,uuid,uuid,bigint)','EXECUTE')`),'f');assert.equal(query(`select has_table_privilege('${role}','public.conference_restaurant_participation_overrides','SELECT,INSERT,UPDATE,DELETE')`),'f');assert.equal(query(`select has_function_privilege('${role}','public.get_conference_restaurant(uuid,uuid)','EXECUTE')`),'f');assert.equal(query(`select has_function_privilege('${role}','public.mutate_conference_restaurant(uuid,uuid,text,uuid,bigint,jsonb)','EXECUTE')`),'f');}
  }finally{
    command('dropdb',['--if-exists',database]);
    for(const role of created)command('psql',['-X','-v','ON_ERROR_STOP=1','-d','postgres','-c',`drop role ${role}`]);
  }
});
