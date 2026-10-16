-- Keep the credential lifecycle guard fail-closed for ordinary writes while
-- allowing the exact counter-only write made inside a verified, target-bound,
-- one-time platform-owner recovery transaction. The exception is derived only
-- from locked database state; no request/session setting can enable it.

create or replace function public.guard_device_security_credential_lifecycle()
returns trigger language plpgsql security definer
set search_path='' as $$
declare recovery_counter_update boolean:=false;
begin
  if tg_op='INSERT' then
    if new.lifecycle_status<>'enrollment_pending' then
      raise exception 'DEVICE_SECURITY_CREDENTIAL_MUST_ENROLL_PENDING' using errcode='42501';
    end if;
    perform platform_private.require_canonical_device_authorization(
      new.user_id,new.device_id,true);
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_DELETE_FORBIDDEN' using errcode='42501';
  end if;
  if new.id<>old.id or new.webauthn_credential_id<>old.webauthn_credential_id
    or new.user_id<>old.user_id or new.device_id<>old.device_id
    or new.credential_kind<>old.credential_kind or new.public_key_cose<>old.public_key_cose
    or new.public_key_algorithm<>old.public_key_algorithm or new.aaguid is distinct from old.aaguid
    or new.transports<>old.transports or new.backup_eligible<>old.backup_eligible
    or new.backup_state<>old.backup_state or new.user_verification_policy<>old.user_verification_policy
    or new.created_at<>old.created_at then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_IDENTITY_IMMUTABLE' using errcode='42501';
  end if;
  if (old.enrolled_at is not null and new.enrolled_at is distinct from old.enrolled_at)
    or (old.activated_at is not null and new.activated_at is distinct from old.activated_at)
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_SECURITY_TIME_IMMUTABLE' using errcode='42501';
  end if;
  if old.lifecycle_status='revoked'
    or (old.lifecycle_status='enrollment_pending' and new.lifecycle_status not in ('enrollment_pending','active','revoked'))
    or (old.lifecycle_status='active' and new.lifecycle_status not in ('active','rotation_pending','recovery_required','revoked'))
    or (old.lifecycle_status='rotation_pending' and new.lifecycle_status not in ('rotation_pending','active','recovery_required','revoked'))
    or (old.lifecycle_status='recovery_required' and new.lifecycle_status not in ('recovery_required','revoked')) then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_TRANSITION_INVALID' using errcode='42501';
  end if;
  if new.sign_count<old.sign_count then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_COUNTER_REGRESSION' using errcode='42501';
  end if;

  if new.lifecycle_status='active' and old.lifecycle_status='active'
    and (pg_catalog.to_jsonb(new)-array['sign_count','last_used_at']::text[])
      =(pg_catalog.to_jsonb(old)-array['sign_count','last_used_at']::text[])
    and new.last_used_at is not null
    and (old.last_used_at is null or new.last_used_at>=old.last_used_at) then
    select exists(
      select 1
      from platform_private.stable_device_recovery_authorizations recovery
      join platform_private.stable_device_recovery_challenges challenge
        on challenge.recovery_authorization_id=recovery.id
       and challenge.credential_id=recovery.credential_id
      join platform.user_device_authorizations target_authorization
        on target_authorization.id=recovery.target_authorization_id
       and target_authorization.user_id=recovery.owner_user_id
       and target_authorization.device_id=recovery.target_device_id
      join platform.devices target_device on target_device.id=recovery.target_device_id
      where recovery.owner_user_id=new.user_id and recovery.credential_id=new.id
        and recovery.issuance_basis='reviewed_platform_owner_passkey_recovery'
        and recovery.review_reference is not null
        and recovery.environment='development_preview'
        and recovery.expected_origin='https://ramyawny37.github.io'
        and recovery.expected_rp_id='ramyawny37.github.io'
        and recovery.consumed_at is null
        and pg_catalog.statement_timestamp() between recovery.issued_at and recovery.expires_at
        and target_authorization.status='pending' and target_authorization.revoked_at is null
        and target_device.lifecycle_status='active' and target_device.retired_at is null
        and target_device.compromised_at is null
        and challenge.verified_at is not null and challenge.consumed_at is null
        and challenge.failed_at is null and challenge.expires_at>pg_catalog.statement_timestamp()
        and challenge.verification_context->'userVerified'='true'::jsonb
        and (challenge.verification_context->>'backupEligible')::boolean
          is not distinct from new.backup_eligible
        and (challenge.verification_context->>'backupState')::boolean
          is not distinct from new.backup_state
        and (not (challenge.verification_context->>'backupState')::boolean
          or (challenge.verification_context->>'backupEligible')::boolean)
    ) into recovery_counter_update;
  end if;

  if new.lifecycle_status='active' and not recovery_counter_update then
    perform platform_private.require_canonical_device_authorization(
      new.user_id,new.device_id,true);
  end if;
  return new;
end; $$;

revoke all on function public.guard_device_security_credential_lifecycle()
  from public,anon,authenticated;


-- Keep rejected/revoked device authorizations in security history, but do not
-- present them as actionable devices in the canonical user-management view.
create or replace function public.get_user_management_devices(
  p_actor_device_id uuid, p_target_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid;
begin
  if p_target_user_id is null then
    raise exception 'TARGET_USER_REQUIRED' using errcode='22023';
  end if;
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  if not platform_private.user_has_module_permission_for(
    actor_id,'platform.devices.view',null,null
  ) then
    raise exception 'DEVICE_READ_SCOPE_DENIED' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object('status','success','devices',
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'deviceId',da.device_id,'deviceName',d.display_name,'platform',d.platform,
      'lastSeenAt',d.last_seen_at,'authorizationStatus',da.status,
      'requestedAt',da.requested_at,'approvedAt',da.approved_at,
      'revokedAt',da.revoked_at,'lastRegisteredAt',da.last_authorized_seen_at,
      'capabilities',pg_catalog.jsonb_build_object(
        'canApprove',platform_private.user_has_module_permission_for(actor_id,'platform.devices.approve',null,null) and da.status='pending',
        'canReject',platform_private.user_has_module_permission_for(actor_id,'platform.devices.block',null,null) and da.status='pending',
        'canRevoke',platform_private.user_has_module_permission_for(actor_id,'platform.devices.revoke',null,null) and da.status='approved'
      )
    ) order by da.created_at,da.device_id)
    from platform.user_device_authorizations da
    join platform.devices d on d.id=da.device_id
    where da.user_id=p_target_user_id and da.status in ('pending','approved')
    ),'[]'::jsonb));
end $$;
