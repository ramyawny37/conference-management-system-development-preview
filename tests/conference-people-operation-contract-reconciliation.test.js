'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20261015110000_conference_people_operation_contract_reconciliation.sql','utf8');

test('Edge admits the complete canonical Conference people operation set before protected dispatch',()=>{
  for(const operation of ['search_conference_people','get_conference_canonical_person','update_conference_canonical_person','create_conference_participation','create_conference_participation_with_person','delete_conference_participation'])
    assert.match(edge,new RegExp(`conference(?:\\.add\\('${operation}'\\)|[^\\n]*'${operation}')`),operation);
  assert.match(edge,/ACTOR_DEVICE_OVERRIDE_DENIED/);
  assert.match(edge,/service\.schema\('platform'\)\.rpc\('execute_device_operation'/);
});

test('SQL reconciliation removes the missing historical delete dependency without weakening guards',()=>{
  assert.match(migration,/create or replace function public\.delete_conference_participation/);
  assert.doesNotMatch(migration,/delete_conference_participation_without_(?:restaurant|transport|accommodation)_cleanup/);
  assert.match(migration,/PLATFORM_DEVICE_SESSION_DISPATCH/);
  assert.match(migration,/validated_phase1c_device_authorization/);
  assert.match(migration,/require_conference_participation_context\(p_actor_device_id,v_current\.conference_id,'conference\.people\.manage',true\)/);
  assert.match(migration,/cleanup_conference_accommodation_for_participation/);
  assert.match(migration,/delete from public\.conference_transport_assignments/);
  assert.match(migration,/delete from public\.conference_restaurant_participation_overrides/);
  assert.match(migration,/conference\.participation\.deleted/);
  assert.match(migration,/revoke all on function public\.delete_conference_participation[\s\S]*grant execute[\s\S]*to service_role/);
});

test('migration preflight requires exact search, read, update and both creation signatures',()=>{
  for(const signature of [
    'public.search_conference_people(uuid,uuid,text,integer)',
    'public.get_conference_canonical_person(uuid,uuid,uuid)',
    'public.update_conference_canonical_person(uuid,uuid,uuid,bigint,text,text,text,text,date)',
    'public.create_conference_participation(uuid,uuid,uuid,uuid)',
    'public.create_conference_participation_with_person(uuid,uuid,uuid,text,text,text,date,text)',
  ]) assert.ok(migration.includes(signature),signature);
  assert.match(migration,/CONFERENCE_PEOPLE_ROUTER_CONTRACT_INCOMPLETE/);
  assert.match(migration,/CONFERENCE_PEOPLE_FUNCTION_CONTRACT_INCOMPLETE/);
});
