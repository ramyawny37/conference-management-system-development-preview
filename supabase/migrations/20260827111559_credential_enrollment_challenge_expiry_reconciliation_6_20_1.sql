begin;

-- Reconcile Development Preview with the reviewed 6.20 credential-enrollment
-- definition. The challenge bounds constraint derives created_at from the
-- statement timestamp, so expires_at must use that same stable time source.
create or replace function public.begin_system_owner_credential_enrollment(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,
  p_environment text,p_expected_origin text,p_expected_rp_id text,
  p_challenge_hash bytea,p_operation_id uuid,p_bootstrap_hash bytea
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
declare bootstrap_authorization public.system_owner_credential_bootstrap_authorizations%rowtype;
  challenge_id uuid;
begin
  perform public.require_platform_device_backend();
  if p_session_id is null or p_operation_id is null or octet_length(p_challenge_hash)<>32
    or octet_length(p_bootstrap_hash)<>32 then
    raise exception 'CREDENTIAL_ENROLLMENT_ARGUMENT_INVALID' using errcode='22023';
  end if;
  if not exists(select 1 from public.system_user_access access where access.user_id=p_actor_user_id
      and access.account_status='approved') or not public.is_system_owner(p_actor_user_id)
    or not exists(select 1 from public.user_device_authorizations uda
      where uda.user_id=p_actor_user_id and uda.device_id=p_actor_device_id
        and uda.authorization_status='approved' and uda.revoked_at is null) then
    raise exception 'APPROVED_SYSTEM_OWNER_DEVICE_REQUIRED' using errcode='42501';
  end if;
  select * into bootstrap_authorization from public.system_owner_credential_bootstrap_authorizations bootstrap
    where bootstrap.authorization_hash=p_bootstrap_hash
      and bootstrap.intended_user_id=p_actor_user_id
      and bootstrap.intended_device_id=p_actor_device_id
      and bootstrap.environment=p_environment and bootstrap.consumed_at is null
      and statement_timestamp() between bootstrap.issued_at and bootstrap.expires_at
    for update;
  if not found then raise exception 'CREDENTIAL_BOOTSTRAP_AUTHORIZATION_INVALID' using errcode='42501'; end if;
  insert into public.device_possession_challenges(challenge_hash,user_id,session_id,
    actor_device_id,credential_id,purpose,operation_id,expected_origin,expected_rp_id,
    environment,expires_at)
  values(p_challenge_hash,p_actor_user_id,p_session_id,p_actor_device_id,null,
    'SYSTEM_OWNER_CREDENTIAL_ENROLLMENT',p_operation_id,lower(p_expected_origin),
    lower(p_expected_rp_id),p_environment,statement_timestamp()+interval '2 minutes')
  returning id into challenge_id;
  return jsonb_build_object('status','challenge_created','challengeId',challenge_id,
    'bootstrapAuthorizationId',bootstrap_authorization.id,'operationId',p_operation_id);
end;
$$;

revoke all on function public.begin_system_owner_credential_enrollment(uuid,uuid,uuid,text,text,text,bytea,uuid,bytea)
  from public,anon,authenticated;
grant execute on function public.begin_system_owner_credential_enrollment(uuid,uuid,uuid,text,text,text,bytea,uuid,bytea)
  to service_role;

commit;
