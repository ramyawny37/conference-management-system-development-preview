const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260908153405_reservations_v1_foundation.sql','utf8');
test('Active assignments cannot overlap and permit same-day turnover',()=>{
  assert.match(sql,/exclude using gist \(resource_id with =,daterange\(starts_on,ends_on,'\[\)'\) with &&\) where \(status='active'\)/);
  assert.match(sql,/create unique index reservations_one_active_assignment_idx/);
  assert.match(sql,/RESERVATIONS_ASSIGNMENT_OVERLAP/);
  assert.match(sql,/RESERVATIONS_RESOURCE_CAPACITY_EXCEEDED/);
  assert.match(sql,/values\(v_organization_id,v_reservation_id,v_resource\.id,v_current\.arrival_date,v_current\.departure_date/);
});
