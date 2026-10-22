'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const migration=fs.readFileSync('supabase/migrations/20261022103823_conference_house_assignment_audit_scope_uuid.sql','utf8');
const foundation=fs.readFileSync('supabase/migrations/20261020131411_conference_room_assignment_foundation.sql','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
const dispatcher=fs.readFileSync('supabase/migrations/20261010201800_flatten_platform_device_operation_dispatcher.sql','utf8');

test('repair targets both protected assignment functions and only the audit scope expression',()=>{
  assert.match(migration,/assign_conference_house\(uuid,uuid,uuid,uuid,boolean,bigint\)/);
  assert.match(migration,/assign_conference_room\(uuid,uuid,uuid,uuid,boolean,bigint\)/);
  assert.match(migration,/broken_expression constant text:='''resource'',p_conference::text,result,jsonb_build_object'/);
  assert.match(migration,/corrected_expression constant text:='''conference'',p_conference,result,jsonb_build_object'/);
  assert.match(migration,/pg_get_functiondef/);
  assert.match(migration,/CONFERENCE_ASSIGNMENT_AUDIT_SCOPE_TYPE_DRIFT/);
  assert.doesNotMatch(migration,/alter table|create table|drop table|grant\s|disable trigger/i);
});

test('historical source proves the exact 42804 expression existed in house and room audit inserts',()=>{
  const matches=foundation.match(/'resource',p_conference::text,result,jsonb_build_object/g)||[];
  assert.equal(matches.length,2);
  assert.match(foundation,/ROOM_CONFERENCE_PERIOD_OVERLAP/);
  assert.match(foundation,/ROOM_ASSIGNMENT_HAS_OCCUPANCIES/);
  assert.match(foundation,/operation_id=p_operation_id/);
  assert.match(foundation,/conference\.accommodation\.manage/);
});

test('the established Edge and SQL dispatcher chain remains the only assignment route',()=>{
  assert.match(edge,/schema\('platform'\)\.rpc\('execute_device_operation'/);
  assert.match(edge,/['"]assign_conference_house['"]/);
  assert.match(edge,/['"]assign_conference_room['"]/);
  assert.match(dispatcher,/return platform\.execute_conference_device_operation/);
  assert.match(foundation,/route_canonical_conference_operation/);
  assert.match(foundation,/return public\.assign_conference_room/);
  assert.doesNotMatch(migration,/execute_device_operation|route_canonical_conference_operation/);
});
