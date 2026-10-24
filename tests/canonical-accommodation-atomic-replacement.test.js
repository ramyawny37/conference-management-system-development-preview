const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const migration=fs.readFileSync('supabase/migrations/20261024133000_canonical_accommodation_atomic_guest_replacement.sql','utf8');
const integration=fs.readFileSync('js/platform-integration.js','utf8');
const script=fs.readFileSync('script.js','utf8');
const edge=fs.readFileSync('supabase/functions/conference-device-operation/index.ts','utf8');

test('replacement is one protected idempotent audited database transaction',()=>{
  assert.match(migration,/require_conference_accommodation_context\(p_device,p_conference,'conference\.accommodation\.manage',true\)/);
  assert.match(migration,/validated_phase1c_device_authorization/);
  assert.match(migration,/operation_id=p_operation_id[\s\S]*status','duplicate'/);
  assert.match(migration,/for update/);
  assert.match(migration,/ACCOMMODATION_REVISION_CONFLICT/);
  assert.match(migration,/ACTIVE_CONFERENCE_PARTICIPATION_REQUIRED/);
  assert.match(migration,/ACCOMMODATION_STAY_OVERLAP/);
  assert.match(migration,/conference_room_has_capacity/);
  assert.match(migration,/conference\.accommodation\.replaced/);
  assert.match(migration,/key_holder_occupancy_id=null[\s\S]*key_delivered_at=null/);
});

test('replacement inserts the successor before ending or deleting the previous stay',()=>{
  const insert=migration.indexOf('insert into public.conference_accommodation_occupancies(',migration.indexOf('prior_old:='));
  const update=migration.indexOf('update public.conference_accommodation_occupancies set leave_day=p_effective_day',insert);
  const removal=migration.indexOf('delete from public.conference_accommodation_occupancies where id=old_stay.id',insert);
  assert.ok(insert>0&&update>insert&&removal>insert);
  assert.match(migration,/p_effective_day=old_stay\.arrival_day[\s\S]*historicalSegmentPreserved/);
  assert.match(migration,/exception when exclusion_violation/);
});

test('dispatcher requires the current room lease and exposes only the protected edge operation',()=>{
  assert.match(migration,/require_accommodation_operation_leases/);
  assert.match(migration,/p_room_lease_tokens/);
  assert.match(migration,/revoke all on function public\.replace_conference_accommodation[\s\S]*grant execute[\s\S]*to service_role/);
  assert.match(edge,/'replace_conference_accommodation'/);
  assert.match(integration,/replaceConferenceAccommodation:replaceConferenceAccommodation/);
  assert.match(integration,/operation==='replace_conference_accommodation'/);
});

test('edit UI offers other active candidates and routes a changed person to replacement',()=>{
  assert.doesNotMatch(script,/draft\.mode==='edit'.*filter\(function\(item\).*draft\.participationId/);
  assert.match(script,/isReplacement=draft\.mode==='edit'/);
  assert.match(script,/replaceConferenceAccommodation\(current\.id/);
  assert.match(script,/effectiveDay:interval\.arrivalDay/);
  assert.match(script,/saveCanonicalAccommodationRoomData/);
  assert.match(script,/mutateConferenceAccommodationStructure\(current\.id,'update_accommodation_room'/);
});
