'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sql=fs.readFileSync('supabase/migrations/20260910120000_reservations_conference_scope_reconciliation.sql','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');

test('Conference membership is the Reservations runtime boundary even within one Organization',()=>{
  assert.match(sql,/join public\.conference_members m[\s\S]*m\.conference_id = c\.id[\s\S]*m\.user_id = v_actor/);
  assert.match(sql,/RESERVATIONS_CONFERENCE_ACCESS_REQUIRED/);
  assert.match(sql,/events e where e\.conference_id=v_conference_id/);
  assert.match(sql,/event,conference_id/);
  assert.doesNotMatch(sql,/resolve_platform_scope\(\)/);
});

test('Organization remains internal and is derived from the authorized Conference',()=>{
  assert.match(sql,/select c\.organization_id[\s\S]*into v_organization_id/);
  assert.match(sql,/jsonb_build_object\([\s\S]*'conferenceId',[\s\S]*'organizationId'/);
  assert.match(sql,/foreign key\(conference_id,organization_id\)[\s\S]*references public\.conferences\(id,organization_id\)/);
  assert.match(sql,/alter column conference_id set not null/);
});

test('Conference options are membership-filtered and collection reads require explicit scope',()=>{
  assert.match(sql,/p_operation = 'list_conference_options'[\s\S]*join public\.conference_members/);
  for(const operation of ['get_dashboard_summary','list_events'])
    assert.match(sql,new RegExp(`when '${operation}'[\\s\\S]*p_conference_id`));
  assert.match(sql,/list_bookings'[\s\S]*p_conference_id/);
  assert.match(sql,/search_participants_bookings'[\s\S]*p_conference_id/);
  assert.match(sql,/list_attendance','get_report_source_data'[\s\S]*p_conference_id/);
});

test('Event creation is atomic and Conference linkage is stable',()=>{
  assert.match(sql,/insert into reservations\.events\([\s\S]*organization_id,conference_id/);
  assert.match(sql,/values \([\s\S]*v_organization_id,v_conference_id/);
  assert.match(sql,/RESERVATIONS_EVENT_CONFERENCE_IMMUTABLE/);
  assert.doesNotMatch(sql,/insert into reservations\.events[\s\S]{0,800}update reservations\.events set conference_id/);
});

test('booking and payment targets resolve through event Conference before mutation',()=>{
  assert.match(sql,/reservations\.bookings b join reservations\.events e on e\.id=b\.event_id/);
  assert.match(sql,/reservations\.payments z join reservations\.bookings b on b\.id=z\.booking_id join reservations\.events e/);
  assert.match(sql,/conference_context\(p_device_id,v_conference_id,v_permission\)/);
});

test('trusted identity and tenancy overrides remain rejected',()=>{
  for(const key of ['p_organization_id','organization_id','p_actor_user_id','p_actor_device_id','p_device_id','p_conference_person_id','conference_person_id']) {
    assert.match(sql,new RegExp(key));
  }
  assert.match(edge,/p_organization_id/);
  assert.match(edge,/p_actor_user_id/);
});

test('Round 1 projection and manual-action protection remain delegated',()=>{
  assert.match(sql,/mutate_pre_conference_scope/);
  const round1=fs.readFileSync('supabase/migrations/20260909160000_reservations_conference_lifecycle_round1.sql','utf8');
  assert.match(round1,/project_booking_to_conference/);
  assert.match(round1,/RESERVATIONS_CONFERENCE_PERSON_MANUAL_ACTION_REQUIRED/);
  assert.match(round1,/if found then return jsonb_build_object\([^;]*'linked',true/);
  assert.match(round1,/'accommodated',v_room is not null/);
});
