'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sql=fs.readFileSync('supabase/migrations/20260910160000_reservations_report_booking_pagination.sql','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');

test('report booking pages use deterministic compound keyset pagination',()=>{
  assert.match(sql,/order by b\.created_at,b\.id[\s\S]*limit v_limit\+1/i);
  assert.match(sql,/b\.created_at > v_after_created_at[\s\S]*b\.created_at = v_after_created_at and b\.id > v_after_booking_id/i);
  assert.match(sql,/select count\(\*\) > v_limit from candidates/i);
  assert.match(sql,/'nextCursor'[\s\S]*case when coalesce\(v_has_more,false\)[\s\S]*else null end/i);
});

test('one page row keeps authoritative booking associations nested',()=>{
  for(const field of ["'booking'","'participant'","'payments'","'attendance'","'operationalReview'"])
    assert.match(sql,new RegExp(field));
  assert.match(sql,/payments z where z\.organization_id=b\.organization_id and z\.booking_id=b\.id/i);
  assert.match(sql,/attendance_records a where a\.organization_id=b\.organization_id and a\.booking_id=b\.id/i);
  assert.match(sql,/operational_reviews o where o\.organization_id=b\.organization_id and o\.booking_id=b\.id/i);
});

test('Event authorization derives exact Conference and Organization server-side',()=>{
  assert.match(sql,/select e\.conference_id,e\.organization_id[\s\S]*where e\.id=v_event_id/i);
  assert.match(sql,/conference_context\([\s\S]*'reservations\.reports\.view'/i);
  assert.match(sql,/b\.organization_id=v_organization_id[\s\S]*b\.event_id=v_event_id/i);
  assert.match(sql,/RESERVATIONS_CONFERENCE_ACCESS_REQUIRED/);
});

test('argument and grant boundaries stay closed',()=>{
  assert.match(sql,/v_limit < 1 or v_limit > 500/i);
  for(const key of ['p_organization_id','organization_id','p_device_id','p_actor_device_id','p_actor_user_id','p_conference_id'])
    assert.match(sql,new RegExp(key));
  assert.match(sql,/require_exact_jsonb_keys\([\s\S]*p_after_created_at[\s\S]*p_after_booking_id/i);
  assert.match(sql,/read_pre_report_booking_pagination[\s\S]*from public,anon,authenticated,service_role/i);
  assert.match(edge,/get_report_booking_page/);
});

test('legacy report operation remains delegated',()=>{
  assert.match(sql,/return reservations\.read_pre_report_booking_pagination/i);
  assert.match(edge,/get_report_source_data/);
});
