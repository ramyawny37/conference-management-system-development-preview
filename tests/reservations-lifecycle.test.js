const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260908153405_reservations_v1_foundation.sql','utf8');
test('Lifecycle, revision, replay, and audit are server authoritative',()=>{
  assert.match(sql,/v_current\.status<>'draft'/);
  assert.match(sql,/v_current\.status not in \('draft','confirmed'\)/);
  assert.match(sql,/v_current\.status<>'confirmed'/);
  assert.match(sql,/v_current\.status<>'checked_in'/);
  assert.match(sql,/for update/);
  assert.match(sql,/RESERVATIONS_REVISION_CONFLICT/);
  assert.match(sql,/RESERVATIONS_OPERATION_IDEMPOTENCY_CONFLICT/);
  assert.match(sql,/return v_replay/);
  assert.match(sql,/insert into platform\.audit_events/);
});
