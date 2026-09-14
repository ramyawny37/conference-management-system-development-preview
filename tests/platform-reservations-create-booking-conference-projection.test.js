'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20260914151500_reservations_create_booking_conference_projection_fix.sql'),'utf8');

test('conference-linked create_booking projects the participant through the existing conference person lifecycle',()=>{
  assert.match(migration,/create or replace function reservations\.mutate\([\s\S]*?security definer[\s\S]*?set search_path=''/i);
  assert.match(migration,/v_result:=reservations_private\.mutate_scoped\(p_device_id,p_operation,v_args\)/);
  assert.match(migration,/if p_operation='create_booking' then[\s\S]*?event\.conference_id is not null/i);
  assert.match(migration,/resolve_booking_scope\([\s\S]*?'reservations\.booking\.create'/i);
  assert.match(migration,/reservations_private\.project_booking_to_conference\([\s\S]*?v_booking_id,v_operation_id,v_context/i);
  assert.match(migration,/jsonb_build_object\([\s\S]*?'conferencePerson'/i);
  assert.match(migration,/revoke all on function reservations\.mutate\(uuid,text,jsonb\)[\s\S]*?public,anon,authenticated/i);
  assert.doesNotMatch(migration,/grant execute on function reservations\.mutate\(uuid,text,jsonb\) to authenticated/i);
});
