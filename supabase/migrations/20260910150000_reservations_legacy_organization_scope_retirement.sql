begin;

create or replace function platform.execute_device_operation_pre_reservations_conference_scope(
  p_user_id uuid,
  p_session_id uuid,
  p_token_hash bytea,
  p_module text,
  p_operation text,
  p_args jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'platform', 'platform_private', 'reservations', 'reservations_private'
as $$
begin
  if p_module = 'reservations' then
    raise exception 'LEGACY_RESERVATIONS_DISPATCH_RETIRED' using errcode = '42501';
  end if;
  return platform.execute_device_operation_pre_reservations_conference_lifecycle(
    p_user_id, p_session_id, p_token_hash, p_module, p_operation, p_args
  );
end
$$;

create or replace function platform.execute_device_operation_pre_reservations_conference_lifecycle(
  p_user_id uuid,
  p_session_id uuid,
  p_token_hash bytea,
  p_module text,
  p_operation text,
  p_args jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'platform', 'platform_private', 'reservations', 'reservations_private'
as $$
begin
  if p_module = 'reservations' then
    raise exception 'LEGACY_RESERVATIONS_DISPATCH_RETIRED' using errcode = '42501';
  end if;
  return platform.execute_device_operation_pre_reservations_event_booking(
    p_user_id, p_session_id, p_token_hash, p_module, p_operation, p_args
  );
end
$$;

create or replace function platform.execute_device_operation_pre_reservations_event_booking(
  p_user_id uuid,
  p_session_id uuid,
  p_token_hash bytea,
  p_module text,
  p_operation text,
  p_args jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'platform', 'platform_private', 'reservations', 'reservations_private'
as $$
begin
  if p_module = 'reservations' then
    raise exception 'LEGACY_RESERVATIONS_DISPATCH_RETIRED' using errcode = '42501';
  end if;
  return platform.execute_device_operation_pre_reservations(
    p_user_id, p_session_id, p_token_hash, p_module, p_operation, p_args
  );
end
$$;

revoke all on function
  platform.execute_device_operation_pre_reservations_conference_scope(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_reservations_conference_lifecycle(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_reservations_event_booking(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_reservations(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_module_permission_administration(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_item_units(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_party_finance(uuid,uuid,bytea,text,text,jsonb),
  reservations.read(uuid,text,jsonb),
  reservations.mutate(uuid,text,jsonb),
  reservations.read_pre_conference_scope(uuid,text,jsonb),
  reservations.mutate_pre_conference_scope(uuid,text,jsonb),
  reservations.read_pre_conference_lifecycle(uuid,text,jsonb),
  reservations.mutate_pre_conference_lifecycle(uuid,text,jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  platform.execute_device_operation_pre_reservations_conference_scope(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_reservations_conference_lifecycle(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_reservations_event_booking(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_reservations(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_module_permission_administration(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_item_units(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_party_finance(uuid,uuid,bytea,text,text,jsonb),
  reservations.read(uuid,text,jsonb),
  reservations.mutate(uuid,text,jsonb),
  reservations.read_pre_conference_scope(uuid,text,jsonb),
  reservations.mutate_pre_conference_scope(uuid,text,jsonb),
  reservations.read_pre_conference_lifecycle(uuid,text,jsonb),
  reservations.mutate_pre_conference_lifecycle(uuid,text,jsonb)
to postgres;

drop function reservations_private.resolve_platform_scope();

commit;
