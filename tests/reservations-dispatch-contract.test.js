const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
const sql=fs.readFileSync('supabase/migrations/20260908153406_reservations_v1_protected_dispatcher.sql','utf8');
const operations=['list_reservations','get_reservation','search_reservation_guests','list_assignable_resources','get_reservation_history','create_reservation','update_reservation','confirm_reservation','cancel_reservation','assign_reservation','check_in_reservation','check_out_reservation'];
test('Edge and SQL dispatch only the approved Reservations operations',()=>{
  for(const operation of operations){assert.match(edge,new RegExp(`'${operation}'`));assert.match(sql,new RegExp(`'${operation}'`));}
  assert.match(sql,/execute_device_operation_pre_reservations/);
  assert.match(sql,/return platform\.execute_device_operation_pre_reservations/);
  assert.match(sql,/item\.token_hash=p_token_hash/);
  assert.match(sql,/p_args\?'p_actor_user_id'/);
  assert.match(sql,/grant execute[\s\S]*?to service_role/);
});
