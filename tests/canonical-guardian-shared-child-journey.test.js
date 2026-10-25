const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sql=fs.readFileSync('supabase/migrations/20261025103000_canonical_guardian_shared_child_accommodation.sql','utf8');
const updateGuard=fs.readFileSync('supabase/migrations/20261025111500_enforce_transport_resident_on_assignment_updates.sql','utf8');
const script=fs.readFileSync('script.js','utf8');
const integration=fs.readFileSync('js/platform-integration.js','utf8');

test('shared child stay is canonical, guardian-bound and consumes no bed',()=>{
  assert.match(sql,/bed_type in \('base','extra','shared'\)/);
  assert.match(sql,/select p_bed='shared' or not exists/);
  assert.match(sql,/ACCOMMODATION_SHARED_CHILD_GUARDIAN_STAY_REQUIRED/);
  assert.match(sql,/guardian_stay\.room_id=new\.room_id/);
  assert.match(integration,/\['base','extra','shared'\]/);
  assert.match(script,/bedOccupancies=roomOccupancies\.filter\(function\(item\)\{return item\.bedType!=='shared'/);
});

test('manual seat child becomes central person participation guardian stay and assignment',()=>{
  assert.match(script,/function ensureCanonicalManualChildJourney/);
  assert.match(script,/searchConferencePeople\(current\.id,name,20\)/);
  assert.match(script,/createConferenceParticipationWithPerson/);
  assert.match(script,/setConferenceParticipationGuardian/);
  assert.match(script,/bedType:'shared'/);
  assert.match(script,/CanonicalConferenceTransport\.setAssignment/);
  assert.match(script,/canonicalSeatSavePending=true/);
  assert.match(script,/finally\(function\(\)\{canonicalSeatSavePending=false/);
  assert.doesNotMatch(script,/seatManualSharedChildren\.push\([^\n]+\)[\s\S]{0,500}save\(\)/);
});

test('transport assignments require active canonical residents and guardian-linked children',()=>{
  assert.match(sql,/CONFERENCE_TRANSPORT_RESIDENT_REQUIRED/);
  assert.match(sql,/CONFERENCE_TRANSPORT_CHILD_GUARDIAN_REQUIRED/);
  assert.match(sql,/conference_transport_resident_assignment/);
  assert.match(updateGuard,/before insert or update on public\.conference_transport_assignments/);
  assert.match(sql,/sync_guardian_shared_child_stays/);
});
