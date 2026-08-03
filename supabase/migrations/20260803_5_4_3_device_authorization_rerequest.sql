begin;

create or replace function public.request_current_device_authorization(
  p_device_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  access_status text;
  existing_operation public.device_authorization_operations%rowtype;
  authorization_row public.user_device_authorizations%rowtype;
  request_result jsonb;
  previous_status text;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select access.account_status into access_status
    from public.system_user_access as access
   where access.user_id = current_user_id;
  if access_status is distinct from 'approved' then
    raise exception 'SYSTEM_ACCESS_APPROVED_REQUIRED' using errcode = '42501';
  end if;
  if p_device_id is null or p_operation_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('device-authorization-user:' || current_user_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('device-authorization-device:' || p_device_id::text, 0)
  );

  select * into existing_operation
    from public.device_authorization_operations as operations
   where operations.operation_id = p_operation_id;
  if found then
    if existing_operation.actor_user_id = current_user_id
       and existing_operation.device_id = p_device_id
       and existing_operation.action = 'request_current_device_authorization' then
      return existing_operation.result;
    end if;
    return jsonb_build_object('status', 'operation_mismatch');
  end if;

  select * into authorization_row
    from public.user_device_authorizations as authorizations
   where authorizations.user_id = current_user_id
     and authorizations.device_id = p_device_id
   for update;

  if not found then
    request_result := jsonb_build_object('status', 'denied');
  elsif authorization_row.authorization_status in ('registered', 'revoked') then
    previous_status := authorization_row.authorization_status;
    update public.user_device_authorizations
       set authorization_status = 'pending',
           requested_at = now(),
           approved_at = null,
           approved_by = null,
           revoked_at = null,
           revoked_by = null
     where user_id = current_user_id
       and device_id = p_device_id;
    request_result := jsonb_build_object('status', 'pending');
    insert into public.device_authorization_audit_log (
      actor_user_id, target_user_id, device_id, action, operation_id,
      old_values, new_values
    ) values (
      current_user_id, current_user_id, p_device_id,
      'device_authorization_requested', p_operation_id,
      jsonb_build_object('authorizationStatus', previous_status),
      jsonb_build_object(
        'authorizationStatus', 'pending',
        'requestSource', case when previous_status = 'revoked'
          then 'rerequest' else 'initial_request' end
      )
    );
  elsif authorization_row.authorization_status = 'pending' then
    request_result := jsonb_build_object('status', 'unchanged');
  else
    request_result := jsonb_build_object('status', 'denied');
  end if;

  insert into public.device_authorization_operations (
    operation_id, actor_user_id, device_id, action, result_status, result
  ) values (
    p_operation_id, current_user_id, p_device_id,
    'request_current_device_authorization',
    request_result ->> 'status', request_result
  );
  return request_result;
end;
$$;

revoke all on function public.request_current_device_authorization(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.request_current_device_authorization(uuid, uuid)
  to authenticated;

commit;

/*
ROLLBACK SQL (run separately only after an explicit rollback decision):

begin;

create or replace function public.request_current_device_authorization(
  p_device_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  access_status text;
  existing_operation public.device_authorization_operations%rowtype;
  authorization_row public.user_device_authorizations%rowtype;
  request_result jsonb;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select access.account_status into access_status
    from public.system_user_access as access
   where access.user_id = current_user_id;
  if access_status is distinct from 'approved' then
    raise exception 'SYSTEM_ACCESS_APPROVED_REQUIRED' using errcode = '42501';
  end if;
  if p_device_id is null or p_operation_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('device-authorization-user:' || current_user_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('device-authorization-device:' || p_device_id::text, 0)
  );
  select * into existing_operation
    from public.device_authorization_operations as operations
   where operations.operation_id = p_operation_id;
  if found then
    if existing_operation.actor_user_id = current_user_id
       and existing_operation.device_id = p_device_id
       and existing_operation.action = 'request_current_device_authorization' then
      return existing_operation.result;
    end if;
    return jsonb_build_object('status', 'operation_mismatch');
  end if;
  select * into authorization_row
    from public.user_device_authorizations as authorizations
   where authorizations.user_id = current_user_id
     and authorizations.device_id = p_device_id
   for update;
  if not found then
    request_result := jsonb_build_object('status', 'denied');
  elsif authorization_row.authorization_status = 'registered' then
    update public.user_device_authorizations
       set authorization_status = 'pending', requested_at = now()
     where user_id = current_user_id and device_id = p_device_id;
    request_result := jsonb_build_object('status', 'pending');
    insert into public.device_authorization_audit_log (
      actor_user_id, target_user_id, device_id, action, operation_id,
      old_values, new_values
    ) values (
      current_user_id, current_user_id, p_device_id,
      'device_authorization_requested', p_operation_id,
      jsonb_build_object('authorizationStatus', 'registered'),
      jsonb_build_object('authorizationStatus', 'pending')
    );
  elsif authorization_row.authorization_status = 'pending' then
    request_result := jsonb_build_object('status', 'unchanged');
  else
    request_result := jsonb_build_object('status', 'denied');
  end if;
  insert into public.device_authorization_operations (
    operation_id, actor_user_id, device_id, action, result_status, result
  ) values (
    p_operation_id, current_user_id, p_device_id,
    'request_current_device_authorization',
    request_result ->> 'status', request_result
  );
  return request_result;
end;
$$;

revoke all on function public.request_current_device_authorization(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.request_current_device_authorization(uuid, uuid)
  to authenticated;

commit;

The rollback intentionally restores behavior only. It does not delete audit rows
or reverse valid requests that were created while re-request support was active.
*/
