const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260908153405_reservations_v1_foundation.sql','utf8');
test('Reservations v1 schema is organization-scoped and private',()=>{
  for(const table of ['guests','assignable_resources','reservations','assignments','operations']) assert.match(sql,new RegExp(`create table reservations\\.${table} \\([\\s\\S]*?organization_id uuid not null`));
  assert.match(sql,/foreign key\(organization_id,guest_id\)/);
  assert.match(sql,/foreign key\(organization_id,reservation_id\)/);
  assert.match(sql,/foreign key\(organization_id,resource_id\)/);
  assert.match(sql,/revoke all on all tables in schema reservations from public,anon,authenticated/);
  assert.match(sql,/force row level security/g);
});
