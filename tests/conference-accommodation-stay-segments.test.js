'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const migration=fs.readFileSync('supabase/migrations/20261022142500_canonical_accommodation_stay_segments.sql','utf8');
const core=fs.readFileSync('core.js','utf8');
const cards=fs.readFileSync('cards.js','utf8');
const runtime=fs.readFileSync('script.js','utf8');

test('stay segments replace single-participation storage with a half-open overlap exclusion',()=>{
  assert.match(migration,/drop constraint if exists conference_accommodation_occupancies_participation_id_key/);
  assert.match(migration,/exclude using gist[\s\S]*participation_id with =[\s\S]*int4range\(arrival_day,coalesce\(leave_day,2147483647\),'\[\)'\) with &&/);
  assert.match(migration,/ACCOMMODATION_STAY_EXCLUSION_DRIFT/);
  assert.match(migration,/create index if not exists conference_accommodation_occupancies_participation_period_idx/);
  assert.doesNotMatch(migration,/drop table|truncate|disable trigger/i);
});

test('partial live application is reconciled without replaying matching temporal consumers',()=>{
  const projection=fs.readFileSync('supabase/migrations/20261022144500_accommodation_temporal_consumer_projection.sql','utf8');
  assert.match(projection,/if position\(new_join in definition\)>0 then[\s\S]*continue/);
  assert.match(projection,/elsif position\(old_join in definition\)>0 then/);
  assert.match(projection,/ACCOMMODATION_TEMPORAL_CONSUMER_DRIFT/);
});

test('capacity is checked independently for every occupied night under the room lock',()=>{
  assert.match(migration,/create or replace function platform_private\.conference_room_has_capacity/);
  assert.match(migration,/generate_series\(p_arrival,coalesce\(p_leave,platform_private\.conference_accommodation_duration\(p_conference\)\+1\)-1\)/);
  assert.match(migration,/where id in\(current\.room_id,p_room\) order by id for update/);
  assert.match(migration,/conference_room_is_assigned/);
});

test('a transfer closes the prior segment and inserts a new segment atomically',()=>{
  assert.match(migration,/historical:=p_arrival>current\.arrival_day/);
  assert.match(migration,/set leave_day=p_arrival/);
  assert.match(migration,/historicalSegmentPreserved/);
  assert.match(migration,/ACCOMMODATION_STAY_OVERLAP/);
});

test('runtime resolves rooms by operational day and cards keep participation identity across moves',()=>{
  assert.match(core,/function getConferenceOperationalDay/);
  assert.match(core,/getConferenceRoomPeopleOnDay\(room,day,conference\)/);
  assert.match(core,/getConferenceAccommodationPeople\(conference\)/);
  assert.match(core,/day===Math\.floor\(leftDay\)&&mealIndex===0/);
  assert.match(cards,/participation:' \+ participationId/);
  assert.match(cards,/getConferenceRoomPeopleOnDay\(room,day,context\.conference\)/g);
});

test('card rendering and PNG capture dimensions remain unchanged',()=>{
  assert.match(runtime,/captureCardElementAsPng/);
  assert.match(runtime,/captureModernBannerCardAsPng/);
  assert.match(runtime,/html2canvas/);
  assert.match(runtime,/scale:\s*2/);
});


test('removal preserves historical stay segments',()=>{
 const source=fs.readFileSync('supabase/migrations/20261022190000_preserve_canonical_accommodation_history_on_removal.sql','utf8');
 assert.match(source,/ACCOMMODATION_HISTORICAL_STAY_IMMUTABLE/);
 assert.match(source,/set leave_day=effective_day/);
 assert.match(source,/ACCOMMODATION_REVISION_CONFLICT/);
 assert.match(source,/platform.audit_events/);
});


test('effective-day transfers correct future bookings and preserve consumed nights',()=>{
 const source=fs.readFileSync('supabase/migrations/20261022192000_canonical_accommodation_transfer_effective_day.sql','utf8');
 assert.match(source,/ACCOMMODATION_HISTORICAL_TRANSFER_DAY_IMMUTABLE/);
 assert.match(source,/current.arrival_day<effective_day/);
 assert.match(source,/historical:=p_arrival>current.arrival_day and current.arrival_day<effective_day/);
 assert.match(source,/p_arrival:=current.arrival_day/);
 assert.match(source,/set leave_day=p_arrival/);
 assert.match(source,/ACCOMMODATION_STAY_OVERLAP/);
});
