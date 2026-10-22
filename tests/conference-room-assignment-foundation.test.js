const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const migration=fs.readFileSync('supabase/migrations/20261020131411_conference_room_assignment_foundation.sql','utf8');
const integration=fs.readFileSync('js/platform-integration.js','utf8');
const script=fs.readFileSync('script.js','utf8');
const routing=fs.readFileSync('js/application-routing.js','utf8');

test('room assignment is the only Conference room scope and preserves central definitions',()=>{
  assert.match(migration,/create table public\.conference_room_assignments/);
  assert.match(migration,/unique\(conference_id,room_id\)/);
  assert.match(migration,/conference_room_is_assigned[\s\S]*conference_room_assignments/);
  assert.doesNotMatch(migration,/HOUSE_CONFERENCE_PERIOD_OVERLAP/);
});

test('inclusive room overlap and date changes share the same serialized guard',()=>{
  assert.match(migration,/conference-room-period:/);
  assert.match(migration,/p_start<=c\.end_date and c\.start_date<=p_end/);
  assert.match(migration,/before update of start_date,end_date/);
  assert.match(migration,/ROOM_CONFERENCE_PERIOD_OVERLAP/);
});

test('room assignment mutation is protected, revisioned, idempotent and audited',()=>{
  assert.match(migration,/require_conference_accommodation_context\(p_device,p_conference,'conference\.accommodation\.manage',true\)/);
  assert.match(migration,/ROOM_ASSIGNMENT_REVISION_CONFLICT/);
  assert.match(migration,/ROOM_ASSIGNMENT_HAS_OCCUPANCIES/);
  assert.match(migration,/conference\.room\.assigned/);
  assert.match(migration,/operation_id/);
});

test('UI selects explicit available rooms and route retains the houses settings view',()=>{
  assert.match(integration,/listConferenceHouseRoomOptions/);
  assert.match(integration,/assignConferenceRoom/);
  assert.match(script,/غير متاحة — متداخلة/);
  assert.match(script,/unassignCanonicalConferenceRoom/);
  assert.match(routing,/resolveConferenceSettingsRoute/);
  assert.match(routing,/settingsView/);
  assert.match(script,/route\.settingsView==='houses'[\s\S]*switchTab\(route\.tabId,\{preserveRoute:true\}\)/);
  assert.match(integration,/\[a-z0-9-\]\+\(\?:\\\/\[a-z0-9-\]\+\)\?/);
});
