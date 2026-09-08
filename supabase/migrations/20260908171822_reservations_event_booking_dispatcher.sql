begin;
alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) rename to execute_device_operation_pre_reservations_event_booking;
create function platform.execute_device_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_module text,p_operation text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,platform,platform_private,reservations,reservations_private as $$
declare v_session platform_private.device_sessions%rowtype;
begin
 if p_module<>'reservations' then return platform.execute_device_operation_pre_reservations_event_booking(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args); end if;
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
 if p_args is null or jsonb_typeof(p_args)<>'object' or p_args?'p_device_id' or p_args?'p_actor_device_id' or p_args?'p_actor_user_id' then raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023'; end if;
 select s.* into v_session from platform_private.device_sessions s join platform.device_key_bindings b on b.id=s.binding_id join platform.user_device_authorizations a on a.id=s.device_authorization_id join platform.devices d on d.id=s.device_id join platform.profiles p on p.user_id=s.user_id
 where s.id=p_session_id and s.user_id=p_user_id and s.token_hash=p_token_hash and s.purpose='PLATFORM_DEVICE_SESSION' and s.revoked_at is null and s.expires_at>statement_timestamp()
 and b.user_id=s.user_id and b.device_id=s.device_id and b.device_authorization_id=s.device_authorization_id and b.public_key_thumbprint=s.public_key_thumbprint and b.algorithm='ECDSA_P256_SHA256' and b.lifecycle_status='active' and b.revoked_at is null and b.retired_at is null
 and a.user_id=s.user_id and a.device_id=s.device_id and a.status='approved' and a.revoked_at is null and d.lifecycle_status='active' and d.retired_at is null and d.compromised_at is null and p.account_status='approved';
 if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true);
 perform set_config('platform.phase1c_context',jsonb_build_object('purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',v_session.id,'user_id',v_session.user_id,'device_id',v_session.device_id,'authorization_id',v_session.device_authorization_id,'binding_id',v_session.binding_id,'token_hash',encode(p_token_hash,'hex'))::text,true);
 case p_operation
  when 'get_dashboard_summary' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id']);
  when 'list_events' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_status','p_limit']);
  when 'get_event','list_event_periods','list_booking_types' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_event_id']);
  when 'list_bookings' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_event_id','p_limit']);
  when 'get_booking_detail','list_booking_payments','get_operational_state' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_booking_id']);
  when 'search_participants_bookings' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_query','p_event_id','p_limit']);
  when 'list_attendance' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_event_id','p_limit']);
  when 'get_report_source_data' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_event_id','p_limit']);
  when 'create_event' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']);
  when 'update_event' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_event_id','p_expected_revision','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']);
  when 'delete_event' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_event_id','p_expected_revision']);
  when 'create_event_period' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_event_id','p_kind','p_starts_on','p_ends_on','p_display_order']);
  when 'update_event_period' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_event_id','p_period_id','p_expected_revision','p_kind','p_starts_on','p_ends_on','p_display_order']);
  when 'delete_event_period' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_event_id','p_period_id','p_expected_revision']);
  when 'reorder_event_periods' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_event_id','p_period_ids']);
  when 'create_booking_type' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_event_id','p_name','p_code','p_price','p_active','p_display_order','p_eligible_attendance_segments']);
  when 'update_booking_type' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_event_id','p_booking_type_id','p_expected_revision','p_name','p_code','p_price','p_active','p_display_order','p_eligible_attendance_segments']);
  when 'create_booking' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_event_id','p_booking_type_id','p_full_name','p_phone','p_age','p_church','p_governorate','p_city_or_village','p_service_sector','p_service_sector_other','p_notes']);
  when 'update_participant_booking' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_booking_id','p_expected_revision','p_full_name','p_phone','p_age','p_church','p_governorate','p_city_or_village','p_service_sector','p_service_sector_other','p_notes']);
  when 'delete_booking' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_booking_id','p_expected_revision']);
  when 'record_payment' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_booking_id','p_amount','p_payment_date','p_payment_method','p_payment_method_other','p_reference','p_notes']);
  when 'void_payment' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_payment_id','p_void_reason']);
  when 'update_attendance' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_booking_id','p_segment','p_attended','p_attendance_date','p_notes']);
  when 'update_operational_review' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_booking_id','p_expected_revision','p_review_status']);
  else raise exception 'RESERVATIONS_OPERATION_NOT_ALLOWED' using errcode='42501';
 end case;
 if p_operation in('get_dashboard_summary','list_events','get_event','list_event_periods','list_booking_types','list_bookings','get_booking_detail','search_participants_bookings','list_booking_payments','list_attendance','get_operational_state','get_report_source_data') then return reservations.read(v_session.device_id,p_operation,p_args); end if;
 return reservations.mutate(v_session.device_id,p_operation,p_args);
end $$;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),platform.execute_device_operation_pre_reservations_event_booking(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),platform.execute_device_operation_pre_reservations_event_booking(uuid,uuid,bytea,text,text,jsonb) to service_role;
commit;
