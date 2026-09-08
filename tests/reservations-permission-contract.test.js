const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260908153405_reservations_v1_foundation.sql','utf8');
test('Reservations permission catalog is exact and creates no grants',()=>{
  const expected=['booking.view','booking.create','booking.update','booking.cancel','assignment.manage','stay.check_in','stay.check_out'].map(x=>`reservations.${x}`);
  const found=[...sql.matchAll(/'reservations\.([a-z_]+\.[a-z_]+)'\s*,\s*'reservations'/g)].map(x=>`reservations.${x[1]}`);
  assert.deepEqual(found,expected);
  assert.doesNotMatch(sql,/insert into public\.module_permission_grants/i);
  assert.match(sql,/'reservations\.booking\.view'[\s\S]*?null,false,1/);
});
