'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(
  path.join(root,'supabase','migrations','20260914164500_reservations_link_backfill_conference_people.sql'),
  'utf8'
);

test('standalone event link backfills pre-existing bookings through the canonical conference projection',()=>{
  assert.match(migration,/create or replace function reservations_private\.link_standalone_event_to_conference\(/i);
  assert.match(migration,/conference_context\(\s*p_device_id,v_conference_id,'reservations\.event\.manage'\s*\)/i);
  assert.match(migration,/v_replay:=reservations_private\.begin_operation\(/i);
  assert.match(migration,/if v_replay is not null then[\s\S]*?from reservations\.bookings b[\s\S]*?conference_person_links[\s\S]*?project_booking_to_conference\([\s\S]*?return v_replay;/i);
  assert.match(migration,/insert into reservations\.scope_partition_links\([\s\S]*?for v_booking in[\s\S]*?project_booking_to_conference\(/i);
  assert.match(migration,/not exists\([\s\S]*?reservations\.conference_person_links l[\s\S]*?l\.booking_id=b\.id/i);
  assert.match(migration,/extensions\.gen_random_uuid\(\)/i);
  assert.match(migration,/set constraints all deferred;/i);
  assert.match(migration,/scope_relink_guard/i);
  assert.doesNotMatch(migration,/grant execute[\s\S]*authenticated/i);
});
