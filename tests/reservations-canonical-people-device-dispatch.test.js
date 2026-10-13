'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const dispatcher=fs.readFileSync(
  'supabase/migrations/20261010201800_flatten_platform_device_operation_dispatcher.sql','utf8'
);
const bookingContextPatch=fs.readFileSync(
  'supabase/migrations/20261012110000_reservations_booking_creation_context_dispatch_contract.sql','utf8'
);
const searchReadRoute=fs.readFileSync(
  'supabase/migrations/20261012174500_reservations_canonical_people_read_route.sql','utf8'
);
const migration=fs.readFileSync(
  'supabase/migrations/20261013141000_reservations_canonical_people_device_dispatch.sql','utf8'
);

test('canonical people search joins the existing device-session dispatcher after its guards',()=>{
  assert.match(dispatcher,/PLATFORM_OPERATION_BACKEND_REQUIRED[\s\S]*from platform_private\.device_sessions[\s\S]*session\.token_hash=p_token_hash[\s\S]*DEVICE_SESSION_INVALID/);
  assert.match(migration,/when \\'search_people\\' then[\s\S]*require_exact_jsonb_keys\(p_args,array\[\\'p_query\\',\\'p_limit\\'\]\)[\s\S]*return reservations\.read\(v_session\.device_id,p_operation,p_args\)/);
  assert.doesNotMatch(migration,/p_actor_device_id[^\n]*:=|p_device_id[^\n]*:=/);
});

test('Reservations read route retains the booking-create permission check for people search',()=>{
  assert.match(searchReadRoute,/p_operation='search_people'[\s\S]*require_exact_jsonb_keys\(p_args,array\['p_query'\],array\['p_limit'\]\)[\s\S]*search_reservations_people\(p_device_id/);
  assert.match(
    fs.readFileSync('supabase/migrations/20261012170000_reservations_guarded_canonical_people_search.sql','utf8'),
    /require_effective_module_permission\(p_actor_device_id,'reservations','reservations\.booking\.create',null,null\)/
  );
  assert.match(migration,/revoke all on function public\.search_reservations_people\(uuid,text,integer\)[\s\S]*from public,anon,authenticated/);
});

test('migration preserves every existing operation and the established security envelope',()=>{
  for(const guard of [
    'PLATFORM_OPERATION_BACKEND_REQUIRED','from platform_private.device_sessions',
    'session.token_hash=p_token_hash',"device_auth.status=''approved''",
    "profile.account_status=''approved''",'DEVICE_SESSION_INVALID','ACTOR_DEVICE_OVERRIDE_DENIED'
  ]) assert.ok(migration.includes(guard),`missing precondition: ${guard}`);
  assert.match(migration,/v_operations_after<>v_operations_before/);
  assert.match(migration,/has_function_privilege\('service_role',v_oid,'execute'\)/);
  assert.match(migration,/has_function_privilege\('anon',v_oid,'execute'\)/);
  assert.match(migration,/has_function_privilege\('authenticated',v_oid,'execute'\)/);
  assert.match(bookingContextPatch,/get_booking_creation_context[\s\S]*RESERVATIONS_SCOPE_TYPE_INVALID/);
});
