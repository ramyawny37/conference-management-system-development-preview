'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20260914152500_reservations_booking_projection_self_heal.sql'),'utf8');

test('conference-linked booking create/update projects through the existing conference person lifecycle',()=>{
  assert.match(migration,/create or replace function reservations\.mutate\([\s\S]*?security definer[\s\S]*?set search_path=''/i);
  assert.match(migration,/if p_operation in\('create_booking','update_participant_booking'\) then/);
  assert.match(migration,/when p_operation='create_booking' then 'reservations\.booking\.create'/);
  assert.match(migration,/else 'reservations\.booking\.update'/);
  assert.match(migration,/event\.conference_id is not null/);
  assert.match(migration,/reservations_private\.project_booking_to_conference\([\s\S]*?v_booking_id,v_operation_id,v_context/i);
  assert.match(migration,/jsonb_build_object\([\s\S]*?'conferencePerson'/i);
  assert.doesNotMatch(migration,/create trigger|after insert|after update/i);
});
