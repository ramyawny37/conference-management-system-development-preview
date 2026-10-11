'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const test=require('node:test');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const migration='supabase/migrations/20261003120000_canonical_conference_discovery_foundation.sql';
const sql=read(migration);
const capabilityMigration='supabase/migrations/20261003130000_canonical_discovery_activation_capabilities.sql';
const capabilitySql=read(capabilityMigration);
const discovery=read('js/supabase/canonical-conference-discovery.js');
const startup=read('js/sync/startup-conference-discovery.js');
const opening=read('js/sync/discovered-conference-open-service.js');
const activation=read('js/sync/conference-activation-authorization.js');
const edge=read('supabase/functions/platform-device-operation/index.ts');

test('1 owner discovery reuses canonical owner inheritance',()=>assert.match(sql,/require_effective_module_permission[\s\S]*conference\.access\.view/));
test('2 scoped discovery uses the unified resolver',()=>assert.doesNotMatch(sql,/module_permission_grants|organization_members/));
test('3 unauthorized conferences are omitted on permission denial',()=>assert.match(sql,/exception when insufficient_privilege then null/));
test('4 stale owner membership cannot grant discovery',()=>assert.doesNotMatch(sql,/conference_members|\bowner\b/i));
test('5 stale manager membership cannot grant discovery',()=>assert.doesNotMatch(sql,/\bmanager\b/i));
test('6 stale viewer membership cannot grant discovery',()=>assert.doesNotMatch(sql,/\bviewer\b/i));
test('7 projection contains no snapshot payload',()=>assert.doesNotMatch(sql.slice(sql.indexOf("v_items:=v_items"),sql.indexOf('exception when')),/conference_snapshots|snapshot|payload/i));
test('8 projection contains no legacy membership role',()=>assert.doesNotMatch(sql.slice(sql.indexOf("v_items:=v_items"),sql.indexOf('exception when')),/['"]role['"]|membership/i));
test('9 actor identity is supplied only by device context',()=>{assert.match(sql,/list_accessible_conferences\(p_actor_device_id uuid\)/);assert.doesNotMatch(sql,/p_(?:actor_)?user_id/);});
test('10 approved device and protected session are required',()=>{assert.match(sql,/require_current_approved_device\(p_actor_device_id\)/);assert.match(sql,/route_canonical_conference_operation/);});
test('11 frontend discovery does not query conference_members',()=>{assert.doesNotMatch(discovery,/conference_members|\.from\(/);assert.doesNotMatch(startup,/listAvailableConferences/);});
test('12 frontend discovery invokes the canonical operation',()=>{assert.match(discovery,/invokeModuleProtected\([\s\S]*list_accessible_conferences/);assert.match(edge,/conference\.add\('list_accessible_conferences'\)/);});
test('13 discovery contains no snapshot hydration',()=>assert.doesNotMatch(startup+opening,/downloadSnapshot|conference_snapshots|SupabaseSnapshotSync/));
test('15 activation has no retired local authorization path',()=>{
  assert.doesNotMatch(activation,/authorizeLocal|local_conference|isLinked/);
  assert.match(activation,/canonicalAccess !== true/);
});
test('16 Reservations operation allowlist remains present',()=>assert.match(edge,/const reservations=new Set/));
test('17 Warehouse operation allowlist remains present',()=>assert.match(edge,/const warehouse=new Set/));
test('18 direct function execution remains denied',()=>assert.match(sql,/revoke all on function public\.list_accessible_conferences\(uuid\) from public,anon,authenticated,service_role/));
test('19 transitional capabilities use exact canonical permissions independently from discovery',()=>{
  assert.match(capabilitySql,/conference\.sync\.write/);
  assert.match(capabilitySql,/conference\.accommodation\.manage/);
  assert.match(capabilitySql,/conference\.transport\.manage/);
  assert.doesNotMatch(capabilitySql,/conference_members|\bowner\b|\bmanager\b|\bviewer\b/i);
  assert.match(capabilitySql,/'edit',v_can_sync and v_can_accommodation_manage and v_can_transport_manage/);
});
test('20 capability correction preserves protected ACL',()=>assert.match(capabilitySql,/revoke all on function public\.list_accessible_conferences\(uuid\) from public,anon,authenticated,service_role/));

test('21 runtime adapter returns canonical metadata and server-derived capabilities without snapshot or role',async()=>{
  const calls=[];
  const context={window:{},Promise};context.window=context;
  context.SupabaseClientLayer={getClient(){return {};}};
  context.SupabaseAuth={getSession(){return {user:{id:'10000000-0000-4000-8000-000000000001'}};}};
  context.SupabaseDeviceIdentity={getCurrent(){return {id:'20000000-0000-4000-8000-000000000001'};}};
  context.PlatformDeviceSession={invokeModuleProtected(module,operation,args){calls.push({module,operation,args});return Promise.resolve({conferences:[{conferenceId:'30000000-0000-4000-8000-000000000001',organizationId:'40000000-0000-4000-8000-000000000001',name:'Visible',status:'active',revision:2,capabilities:{edit:true,sync:true}}]});}};
  vm.runInNewContext(discovery,context);
  const result=await context.CanonicalConferenceDiscovery.listAccessibleConferences();
  assert.equal(JSON.stringify(calls),JSON.stringify([{module:'conference',operation:'list_accessible_conferences',args:{}}]));
  assert.equal(result.data.conferences[0].id,'30000000-0000-4000-8000-000000000001');
  assert.equal(Object.hasOwn(result.data.conferences[0],'role'),false);
  assert.equal(Object.hasOwn(result.data.conferences[0],'snapshot'),false);
  assert.equal(JSON.stringify(result.data.conferences[0].capabilities),JSON.stringify({edit:true,sync:true,transportManage:false}));
});

const postgresAppBin='/Applications/Postgres.app/Contents/Versions/latest/bin';
const pgBin=fs.existsSync(path.join(postgresAppBin,'psql'))?postgresAppBin:'';
const database=`conference_p6i_b1_${process.pid}_${Date.now()}`;
const connection=process.env.PGHOST?['-h',process.env.PGHOST,'-p',process.env.PGPORT||'5432','-U',process.env.PGUSER||os.userInfo().username]:['-h','/tmp','-p','5432','-U',process.env.PGUSER||os.userInfo().username];
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')&&!/(?:^DIRECT_URL$|(?:DATABASE|DB|POSTGRES|SUPABASE).*URL)/i.test(key)));
if(process.env.PGPASSWORD)env.PGPASSWORD=process.env.PGPASSWORD;
function command(name,args){return execFileSync(pgBin?path.join(pgBin,name):name,[...connection,...args],{encoding:'utf8',stdio:'pipe',env}).trim();}
function query(statement){return command('psql',['-X','-v','ON_ERROR_STOP=1','-At','-d',database,'-c',statement]);}

test('22 disposable PostgreSQL proves owner capabilities, restricted grants, stale memberships, device boundary and ACL',()=>{
  try{command('psql',['-X','-At','-d','postgres','-c','select 1']);}catch{assert.fail('isolated/local PostgreSQL is required; do not silently skip');}
  const owner='10000000-0000-4000-8000-000000000001',grantee='10000000-0000-4000-8000-000000000002',legacy='10000000-0000-4000-8000-000000000003';
  const ownerDevice='20000000-0000-4000-8000-000000000001',grantDevice='20000000-0000-4000-8000-000000000002',legacyDevice='20000000-0000-4000-8000-000000000003';
  const visible='30000000-0000-4000-8000-000000000001',other='30000000-0000-4000-8000-000000000002',org='40000000-0000-4000-8000-000000000001';
  const created=[];command('createdb',[database]);
  try{
    for(const role of ['anon','authenticated','service_role'])if(query(`select exists(select 1 from pg_roles where rolname='${role}')`)==='f'){query(`create role ${role} nologin`);created.push(role);}
    query(`create schema platform_private;
      create table public.conferences(id uuid primary key,owner_id uuid,organization_id uuid,name text,start_date date,end_date date,status text,completed_at timestamptz,revision bigint,created_at timestamptz,updated_at timestamptz,updated_by uuid,deleted_at timestamptz);
      create table public.conference_members(conference_id uuid,user_id uuid,role text);
      create table public.devices(device_id uuid,user_id uuid,approved boolean);
      create table public.grants(user_id uuid,conference_id uuid,permission_key text);
      insert into public.conferences values('${visible}','${owner}','${org}','Visible','2026-10-01','2026-10-03','active',null,2,now(),now(),'${owner}',null),('${other}','50000000-0000-4000-8000-000000000001','${org}','Other','2026-11-01','2026-11-02','active',null,1,now(),now(),'${owner}',null);
      insert into public.devices values('${ownerDevice}','${owner}',true),('${grantDevice}','${grantee}',true),('${legacyDevice}','${legacy}',true);
      insert into public.grants values('${grantee}','${visible}','conference.access.view');
      insert into public.conference_members values('${other}','${legacy}','owner'),('${visible}','${legacy}','manager'),('${other}','${legacy}','viewer');
      create function public.require_current_approved_device(uuid) returns uuid language plpgsql stable as \$\$ declare actor uuid; begin select user_id into actor from public.devices where device_id=\$1 and approved; if actor is null then raise exception 'DEVICE_DENIED' using errcode='42501'; end if; return actor; end \$\$;
      create function public.require_effective_module_permission(uuid,text,text,text,text) returns jsonb language plpgsql stable as \$\$ declare actor uuid:=public.require_current_approved_device(\$1); begin if \$2<>'conference' or \$4<>'conference' then raise exception 'MODULE_PERMISSION_REQUIRED' using errcode='42501'; end if; if not exists(select 1 from public.conferences where id=\$5::uuid and owner_id=actor) and not exists(select 1 from public.grants where user_id=actor and conference_id=\$5::uuid and permission_key=\$3) then raise exception 'MODULE_PERMISSION_REQUIRED' using errcode='42501'; end if; return jsonb_build_object('actorUserId',actor); end \$\$;
      create function platform_private.require_exact_jsonb_keys(jsonb,text[],text[] default '{}') returns void language plpgsql immutable as \$\$ begin return; end \$\$;
      create function platform_private.route_canonical_conference_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_actor_device_id uuid,p_operation text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='' as \$\$ begin if p_operation='get_conference_core' then return '{}'::jsonb; end if; raise exception 'CONFERENCE_OPERATION_NOT_ALLOWED' using errcode='42501'; end \$\$;`);
    command('psql',['-X','-v','ON_ERROR_STOP=1','-d',database,'-f',path.join(root,migration)]);
    command('psql',['-X','-v','ON_ERROR_STOP=1','-d',database,'-f',path.join(root,capabilityMigration)]);
    const response=device=>JSON.parse(query(`select public.list_accessible_conferences('${device}')`));
    const ids=device=>response(device).conferences.map(item=>item.conferenceId);
    assert.deepEqual(ids(ownerDevice),[visible]);assert.deepEqual(ids(grantDevice),[visible]);assert.deepEqual(ids(legacyDevice),[]);
    assert.deepEqual(response(ownerDevice).conferences[0].capabilities,{edit:true,sync:true});
    assert.deepEqual(response(grantDevice).conferences[0].capabilities,{edit:false,sync:false});
    assert.throws(()=>ids('20000000-0000-4000-8000-000000000099'),/DEVICE_DENIED/);
    for(const role of ['anon','authenticated','service_role'])assert.equal(query(`select has_function_privilege('${role}','public.list_accessible_conferences(uuid)','EXECUTE')`),'f');
  }finally{command('dropdb',['--if-exists',database]);for(const role of created)command('psql',['-X','-v','ON_ERROR_STOP=1','-d','postgres','-c',`drop role ${role}`]);}
});
