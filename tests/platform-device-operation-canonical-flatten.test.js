'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const migration=read('supabase/migrations/20261010201800_flatten_platform_device_operation_dispatcher.sql');
const edge=read('supabase/functions/platform-device-operation/index.ts');
const conferenceRouter=read('supabase/migrations/20261010201000_reservations_organization_free_scope_runtime.sql');
const conferenceCore=read('supabase/migrations/20261010201600_platform_dispatcher_organization_retirement.sql');
const conferencePeoplePatches=[
  'supabase/migrations/20261014182000_conference_people_search_canonical_device_route.sql',
  'supabase/migrations/20261014210000_conference_canonical_person_revision_update.sql',
  'supabase/migrations/20261014220000_conference_canonical_person_exact_read.sql',
].map(read).join('\n');
const dispatcher=migration.match(/create or replace function platform\.execute_device_operation\([\s\S]*?end \$\$;/i)?.[0]||'';
const dispatcherPatches=read('supabase/migrations/20261013141000_reservations_canonical_people_device_dispatch.sql');
const ownerPendingReadPatch=read('supabase/migrations/20261018214500_canonical_owner_pending_device_session_read.sql');
const effectiveDispatcher=dispatcher+dispatcherPatches+ownerPendingReadPatch;

function edgeOperations(module){
  const initial=edge.match(new RegExp(`const ${module}=new Set\\(\\[([^;]+)\\]\\)`));
  assert.ok(initial,`${module} Edge set`);
  const operations=new Set([...initial[1].matchAll(/'([^']+)'/g)].map(match=>match[1]));
  for(const match of edge.matchAll(new RegExp(`${module}\\.add\\('([^']+)'\\)`,'g')))operations.add(match[1]);
  return operations;
}

test('one top-level dispatcher owns the verified session and has no predecessor delegation',()=>{
  assert.match(dispatcher,/auth\.jwt\(\)->>'role'[\s\S]*service_role/);
  assert.match(dispatcher,/session\.purpose='PLATFORM_DEVICE_SESSION'/);
  assert.match(dispatcher,/binding\.algorithm='ECDSA_P256_SHA256'/);
  assert.match(dispatcher,/join platform\.user_device_authorizations device_auth on device_auth\.id=session\.device_authorization_id/);
  assert.match(dispatcher,/device_auth\.status='approved'/);
  assert.doesNotMatch(dispatcher,/join platform\.user_device_authorizations authorization\b/i);
  assert.match(dispatcher,/profile\.account_status='approved'/);
  assert.match(dispatcher,/set_config\('platform\.phase1c_context'/);
  assert.match(dispatcher,/ACTOR_DEVICE_OVERRIDE_DENIED/);
  assert.match(dispatcher,/require_effective_module_permission\(v_session\.device_id,p_module,p_module\|\|'\.module\.access'/);
  assert.doesNotMatch(dispatcher,/execute_device_operation_pre_/);
});

test('every current Edge operation remains represented by its canonical module route',()=>{
  for(const operation of edgeOperations('platform'))assert.match(effectiveDispatcher,new RegExp(`'${operation}'`),`platform:${operation}`);
  for(const operation of edgeOperations('reservations'))assert.match(effectiveDispatcher,new RegExp(`'${operation}'`),`reservations:${operation}`);
  for(const operation of edgeOperations('warehouse'))assert.match(effectiveDispatcher,new RegExp(`'${operation}'`),`warehouse:${operation}`);
  assert.match(dispatcher,/'apply_library_template_content_operation'/);
  assert.match(dispatcher,/p_module='conference'[\s\S]*platform\.execute_conference_device_operation\(/);
  for(const operation of edgeOperations('conference')){
    const route=operation==='check_module_access'?dispatcher:conferenceRouter+conferenceCore+conferencePeoplePatches;
    assert.match(route,new RegExp(`'${operation}'`),`conference:${operation}`);
  }
});

test('Reservations, Warehouse and permission administration keep exact canonical routing',()=>{
  assert.match(dispatcher,/return reservations\.read\(v_session\.device_id,p_operation,p_args\)/);
  assert.match(dispatcher,/return reservations\.mutate\(v_session\.device_id,p_operation,p_args\)/);
  assert.match(dispatcher,/reservations_private\.link_standalone_event_to_conference/);
  assert.match(dispatcher,/p_args->>'p_scope_type'<>'standalone'/);
  assert.match(dispatcher,/route_permission_administration\(p_user_id,p_operation,p_args\)/);
  assert.match(dispatcher,/warehouse\.upsert_item_units/);
  assert.match(dispatcher,/warehouse\.cancel_document_draft/);
  assert.match(dispatcher,/require_exact_jsonb_keys/g);
});

test('retirement is exhaustive, non-cascading and Organization-free',()=>{
  assert.match(migration,/procedure\.proname like 'execute_device_operation_pre_%'/);
  assert.match(migration,/PLATFORM_DISPATCHER_PREDECESSOR_RETIREMENT_INCOMPLETE/);
  assert.doesNotMatch(migration,/\bdrop\b[\s\S]{0,80}\bcascade\b/i);
  assert.doesNotMatch(migration,/organization_id|organizationId|organization_members|public\.organizations/i);
});
