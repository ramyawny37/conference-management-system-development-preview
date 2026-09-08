const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
const sql=fs.readFileSync('supabase/migrations/20260908171822_reservations_event_booking_dispatcher.sql','utf8');
const operations=['get_dashboard_summary','list_events','get_event','list_event_periods','list_booking_types','list_bookings','get_booking_detail','search_participants_bookings','list_booking_payments','list_attendance','get_operational_state','get_report_source_data','create_event','update_event','delete_event','create_event_period','update_event_period','delete_event_period','reorder_event_periods','create_booking_type','update_booking_type','create_booking','update_participant_booking','delete_booking','record_payment','void_payment','update_attendance','update_operational_review'];
test('Edge and SQL dispatch only the approved Reservations operations',()=>{
  for(const operation of operations){assert.match(edge,new RegExp(`'${operation}'`));assert.match(sql,new RegExp(`'${operation}'`));}
  assert.match(sql,/execute_device_operation_pre_reservations_event_booking/);
  assert.match(sql,/return platform\.execute_device_operation_pre_reservations_event_booking/);
  assert.match(sql,/s\.token_hash=p_token_hash/);
  assert.match(sql,/p_args\?'p_actor_user_id'/);
  assert.match(sql,/grant execute[\s\S]*?to service_role/);
});
