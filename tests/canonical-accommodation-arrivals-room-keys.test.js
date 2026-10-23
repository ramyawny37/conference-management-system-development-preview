const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261023103201_canonical_accommodation_arrivals_and_room_keys.sql'),'utf8');
const integration=fs.readFileSync(path.join(root,'js/platform-integration.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'script.js'),'utf8');
const platformEdge=fs.readFileSync(path.join(root,'supabase/functions/platform-device-operation/index.ts'),'utf8');
const conferenceEdge=fs.readFileSync(path.join(root,'supabase/functions/conference-device-operation/index.ts'),'utf8');
const bundleReference=fs.readFileSync(path.join(root,'supabase/migrations/20261023105331_conference_bundle_room_key_reference.sql'),'utf8');

test('arrival is canonical occupancy state with actor, time, revision and audit evidence',()=>{
  assert.match(migration,/conference_accommodation_occupancies[\s\S]*arrived_at timestamptz[\s\S]*arrived_by uuid/);
  assert.match(migration,/ACCOMMODATION_REVISION_CONFLICT/);
  assert.match(migration,/conference\.accommodation\.arrival_updated/);
  assert.match(migration,/permissionKey','conference\.accommodation\.manage/);
});

test('room key state belongs to the conference room assignment and requires a current occupant',()=>{
  assert.match(migration,/conference_room_assignments[\s\S]*key_holder_occupancy_id uuid/);
  assert.match(migration,/ROOM_KEY_HOLDER_NOT_CURRENT_OCCUPANT/);
  assert.match(migration,/conference_operational_day\(p_conference\)/);
  assert.match(migration,/conference\.accommodation\.room_key_updated/);
});

test('arrival and key writes are protected by the existing room lease and exact permission path',()=>{
  assert.match(migration,/require_conference_accommodation_context\(p_device,p_conference,'conference\.accommodation\.manage',true\)/);
  assert.match(migration,/require_accommodation_operation_leases/);
  assert.match(integration,/acquireResourceLease\('conference','accommodation_room'/);
  assert.match(integration,/mutate_conference_accommodation_operations/);
});

test('both active Conference Edge allowlists pass the operation to the protected dispatcher',()=>{
  assert.match(platformEdge,/conference\.add\('mutate_conference_accommodation_operations'\)/);
  assert.match(conferenceEdge,/allowed\.add\('mutate_conference_accommodation_operations'\)/);
});

test('canonical projection and UI expose per-person arrival and named room key recipient',()=>{
  for(const field of ['arrivedAt','arrivedBy','keyHolderOccupancyId','keyHolderName','keyDeliveredAt','keyDeliveredBy'])assert.ok(migration.includes(`'${field}'`));
  assert.match(integration,/arrivedAt:value\.arrivedAt/);
  assert.match(integration,/keyHolderName:value\.keyHolderName/);
  assert.match(ui,/setCanonicalAccommodationArrival/);
  assert.match(ui,/setCanonicalAccommodationRoomKey/);
  assert.match(ui,/canonicalAccommodationActiveKeyHolder/);
  assert.match(ui,/activeKeyHolder\.person&&activeKeyHolder\.person\.fullName/);
});

test('a temporal transfer inherits arrival while stale key recipients are suppressed from reads',()=>{
  assert.match(migration,/inherit_conference_accommodation_arrival/);
  assert.match(migration,/o\.leave_day=new\.arrival_day/);
  assert.match(migration,/case when exists\(select 1 from public\.conference_accommodation_occupancies ko/);
  assert.match(migration,/ko\.room_id=ra\.room_id/);
});

test('canonical bundle restore remaps the room key recipient occupancy identity',()=>{
  assert.match(bundleReference,/restore_conference_bundle_table/);
  assert.match(bundleReference,/key_holder_occupancy_id/);
  assert.match(bundleReference,/conference_bundle_uuid\(p_operation_id,\(v_row->>''key_holder_occupancy_id''\)::uuid\)/);
});
