-- Phase 1C: explicit lost-private-key recovery for the approved current device.
-- Normal initial handoff remains one-time and still rejects an active binding.

alter table platform_private.device_ownership_handoff_challenges
  add column handoff_mode text not null default 'initial'
    check (handoff_mode in ('initial','binding_recovery')),
  add column replacement_binding_id uuid null
    references platform.device_key_bindings(id) on delete restrict,
  add column recovery_reason text null
    check (recovery_reason is null or recovery_reason='lost_private_key'),
  add constraint device_ownership_handoff_challenge_mode_check check (
    (handoff_mode='initial' and replacement_binding_id is null and recovery_reason is null)
    or
    (handoff_mode='binding_recovery' and replacement_binding_id is not null and recovery_reason='lost_private_key')
  );

alter table platform_private.device_ownership_handoff_audit
  drop constraint device_ownership_handoff_audit_migration_source_check,
  add column handoff_mode text not null default 'initial'
    check (handoff_mode in ('initial','binding_recovery')),
  add column previous_binding_id uuid null,
  add column previous_public_key_thumbprint text null,
  add column recovery_reason text null,
  add constraint device_ownership_handoff_audit_migration_source_check
    check (migration_source in ('current_http_only_device_secret','bound_key_rotation')),
  add constraint device_ownership_handoff_audit_recovery_check check (
    (handoff_mode='initial' and migration_source='current_http_only_device_secret'
      and previous_binding_id is null and previous_public_key_thumbprint is null and recovery_reason is null)
    or
    (handoff_mode='binding_recovery' and migration_source='bound_key_rotation'
      and previous_binding_id is not null
      and previous_public_key_thumbprint ~ '^[0-9a-f]{64}$'
      and recovery_reason='lost_private_key')
  );

create or replace function platform.begin_current_device_ownership_handoff(p_public_key_thumbprint text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare
  v_user uuid:=auth.uid(); v_authorization uuid; v_device uuid; v_replacement_binding uuid;
  v_id uuid; v_nonce text; v_issued timestamptz:=statement_timestamp(); v_expires timestamptz;
  v_payload text; v_thumbprint text; v_mode text; v_reason text;
begin
  if p_public_key_thumbprint ~ '^[0-9a-f]{64}$' then
    v_mode:='initial'; v_thumbprint:=p_public_key_thumbprint;
  elsif p_public_key_thumbprint ~ '^recovery:lost_private_key:[0-9a-f]{64}$' then
    v_mode:='binding_recovery'; v_reason:='lost_private_key';
    v_thumbprint:=substring(p_public_key_thumbprint from 27);
  else
    raise exception 'DEVICE_HANDOFF_ARGUMENT_INVALID' using errcode='22023';
  end if;
  if v_user is null then raise exception 'DEVICE_HANDOFF_ARGUMENT_INVALID' using errcode='22023'; end if;
  v_authorization:=platform_private.current_device_authorization_id(v_user);
  if v_authorization is null then raise exception 'DEVICE_HANDOFF_CURRENT_DEVICE_REQUIRED' using errcode='42501'; end if;
  select device_authorization.device_id into strict v_device
    from platform.user_device_authorizations device_authorization
    join platform.devices device on device.id=device_authorization.device_id
    join platform.profiles profile on profile.user_id=device_authorization.user_id
    where device_authorization.id=v_authorization and device_authorization.user_id=v_user
      and device_authorization.status='approved' and device_authorization.revoked_at is null
      and device.lifecycle_status='active' and profile.account_status='approved';
  if v_device<>'f9306733-612d-433f-a38e-5d72855c2fe3'::uuid then
    raise exception 'DEVICE_HANDOFF_CANONICAL_DEVICE_MISMATCH' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('device-handoff-device:'||v_device::text,0));
  if v_mode='initial' then
    if exists(select 1 from platform.device_key_bindings binding
      where binding.device_id=v_device and binding.lifecycle_status='active') then
      raise exception 'DEVICE_HANDOFF_BINDING_ALREADY_ACTIVE' using errcode='55000';
    end if;
  else
    select binding.id into strict v_replacement_binding
      from platform.device_key_bindings binding
      where binding.user_id=v_user and binding.device_id=v_device
        and binding.device_authorization_id=v_authorization
        and binding.lifecycle_status='active' and binding.rotated_at is null
        and binding.revoked_at is null and binding.retired_at is null
      for share;
  end if;
  update platform_private.device_ownership_handoff_challenges challenge
    set failed_at=v_issued,failure_code='EXPIRED_REPLACED'
    where challenge.user_id=v_user and challenge.device_id=v_device and challenge.consumed_at is null
      and challenge.failed_at is null and challenge.expires_at<=v_issued;
  v_id:=extensions.gen_random_uuid();
  v_nonce:=translate(encode(extensions.gen_random_bytes(32),'base64'),E'+/\n','-_');
  v_expires:=v_issued+interval '2 minutes';
  if v_mode='initial' then
    v_payload:='PLATFORM_DEVICE_OWNERSHIP_HANDOFF'||chr(10)||v_id||chr(10)||v_user||chr(10)||v_device||chr(10)||v_authorization||chr(10)||v_thumbprint||chr(10)||v_nonce||chr(10)||
      to_char(v_issued at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||chr(10)||to_char(v_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  else
    v_payload:='PLATFORM_DEVICE_OWNERSHIP_HANDOFF'||chr(10)||'binding_recovery'||chr(10)||v_id||chr(10)||v_user||chr(10)||v_device||chr(10)||v_authorization||chr(10)||v_replacement_binding||chr(10)||v_thumbprint||chr(10)||v_reason||chr(10)||v_nonce||chr(10)||
      to_char(v_issued at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||chr(10)||to_char(v_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  end if;
  insert into platform_private.device_ownership_handoff_challenges(id,user_id,device_id,device_authorization_id,purpose,
    public_key_thumbprint,nonce,signing_payload,signing_payload_hash,issued_at,expires_at,handoff_mode,replacement_binding_id,recovery_reason)
  values(v_id,v_user,v_device,v_authorization,'PLATFORM_DEVICE_OWNERSHIP_HANDOFF',v_thumbprint,v_nonce,
    v_payload,extensions.digest(v_payload,'sha256'),v_issued,v_expires,v_mode,v_replacement_binding,v_reason);
  return jsonb_build_object('challengeId',v_id,'userId',v_user,'deviceId',v_device,'authorizationId',v_authorization,
    'purpose','PLATFORM_DEVICE_OWNERSHIP_HANDOFF','publicKeyThumbprint',v_thumbprint,
    'signingPayload',v_payload,'issuedAt',v_issued,'expiresAt',v_expires,'handoffMode',v_mode,
    'replacementBindingId',v_replacement_binding,'recoveryReason',v_reason);
exception
  when no_data_found then
    if v_mode='binding_recovery' then
      raise exception 'DEVICE_HANDOFF_ACTIVE_BINDING_REQUIRED' using errcode='55000';
    end if;
    raise;
end;
$$;

create or replace function platform.get_current_device_handoff_assertion_claims(p_challenge_id uuid,p_public_key_thumbprint text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_user uuid:=auth.uid(); v_authorization uuid; challenge platform_private.device_ownership_handoff_challenges%rowtype;
begin
  v_authorization:=platform_private.current_device_authorization_id(v_user);
  select * into challenge from platform_private.device_ownership_handoff_challenges item where item.id=p_challenge_id;
  if not found or challenge.user_id<>v_user or challenge.device_authorization_id<>v_authorization
    or challenge.device_id<>'f9306733-612d-433f-a38e-5d72855c2fe3'::uuid
    or challenge.public_key_thumbprint<>p_public_key_thumbprint or challenge.purpose<>'PLATFORM_DEVICE_OWNERSHIP_HANDOFF'
    or challenge.consumed_at is not null or challenge.failed_at is not null or challenge.expires_at<=statement_timestamp() then
    raise exception 'DEVICE_HANDOFF_ASSERTION_CLAIMS_DENIED' using errcode='42501';
  end if;
  if challenge.handoff_mode='binding_recovery' and not exists(
    select 1 from platform.device_key_bindings binding
    where binding.id=challenge.replacement_binding_id and binding.user_id=challenge.user_id
      and binding.device_id=challenge.device_id
      and binding.device_authorization_id=challenge.device_authorization_id
      and binding.lifecycle_status='active' and binding.rotated_at is null
      and binding.revoked_at is null and binding.retired_at is null
  ) then
    raise exception 'DEVICE_HANDOFF_REPLACEMENT_STALE' using errcode='55000';
  end if;
  return jsonb_build_object('userId',challenge.user_id,'deviceId',challenge.device_id,
    'authorizationId',challenge.device_authorization_id,'challengeId',challenge.id,
    'publicKeyThumbprint',challenge.public_key_thumbprint,'purpose',challenge.purpose,
    'signingPayload',challenge.signing_payload,'challengeExpiresAt',challenge.expires_at,
    'handoffMode',challenge.handoff_mode,'replacementBindingId',challenge.replacement_binding_id,
    'recoveryReason',challenge.recovery_reason);
end;
$$;

create or replace function platform.complete_device_binding_recovery(
  p_user_id uuid,p_device_id uuid,p_authorization_id uuid,p_challenge_id uuid,p_replacement_binding_id uuid,
  p_public_key_thumbprint text,p_public_key_jwk jsonb,p_recovery_reason text,p_assertion_jti uuid,
  p_assertion_hash bytea,p_assertion_issued_at timestamptz,p_assertion_expires_at timestamptz
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare
  challenge platform_private.device_ownership_handoff_challenges%rowtype;
  previous_binding platform.device_key_bindings%rowtype;
  v_binding uuid; v_handoff_audit uuid; v_rotation_audit uuid; v_activation_audit uuid; v_now timestamptz:=statement_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'DEVICE_HANDOFF_BACKEND_REQUIRED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('device-handoff-device:'||p_device_id::text,0));
  select * into challenge from platform_private.device_ownership_handoff_challenges item
    where item.id=p_challenge_id for update;
  if not found or challenge.consumed_at is not null or challenge.failed_at is not null
    or challenge.expires_at<=v_now or p_assertion_expires_at<=v_now
    or p_assertion_expires_at>p_assertion_issued_at+interval '2 minutes'
    or challenge.user_id<>p_user_id or challenge.device_id<>p_device_id
    or challenge.device_authorization_id<>p_authorization_id
    or challenge.replacement_binding_id<>p_replacement_binding_id
    or challenge.public_key_thumbprint<>p_public_key_thumbprint
    or challenge.purpose<>'PLATFORM_DEVICE_OWNERSHIP_HANDOFF'
    or challenge.handoff_mode<>'binding_recovery' or challenge.recovery_reason<>p_recovery_reason
    or p_recovery_reason<>'lost_private_key'
    or p_device_id<>'f9306733-612d-433f-a38e-5d72855c2fe3'::uuid
    or pg_catalog.octet_length(p_assertion_hash)<>32 then
    raise exception 'DEVICE_BINDING_RECOVERY_FINALIZATION_DENIED' using errcode='42501';
  end if;
  if not exists(select 1 from platform.user_device_authorizations device_authorization
      join platform.devices device on device.id=device_authorization.device_id
      join platform.profiles profile on profile.user_id=device_authorization.user_id
      where device_authorization.id=p_authorization_id and device_authorization.user_id=p_user_id
        and device_authorization.device_id=p_device_id and device_authorization.status='approved'
        and device_authorization.revoked_at is null and device.lifecycle_status='active'
        and profile.account_status='approved') then
    raise exception 'DEVICE_HANDOFF_AUTHORIZATION_INVALID' using errcode='42501';
  end if;
  select * into previous_binding from platform.device_key_bindings binding
    where binding.id=p_replacement_binding_id and binding.user_id=p_user_id
      and binding.device_id=p_device_id and binding.device_authorization_id=p_authorization_id
      and binding.lifecycle_status='active' and binding.rotated_at is null
      and binding.revoked_at is null and binding.retired_at is null
    for update;
  if not found then raise exception 'DEVICE_HANDOFF_REPLACEMENT_STALE' using errcode='55000'; end if;
  update platform.device_key_bindings
    set lifecycle_status='rotated',rotated_at=v_now
    where id=previous_binding.id;
  insert into platform.device_key_bindings(user_id,device_id,device_authorization_id,public_key_jwk,
    public_key_thumbprint,algorithm,lifecycle_status,migration_source,created_at,activated_at)
  values(p_user_id,p_device_id,p_authorization_id,p_public_key_jwk,p_public_key_thumbprint,
    'ECDSA_P256_SHA256','active','bound_key_rotation',v_now,v_now) returning id into v_binding;
  update platform.device_key_bindings set replaced_by_binding_id=v_binding where id=previous_binding.id;
  insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,
    entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source)
  values(p_user_id,p_authorization_id,p_user_id,'platform','devices','device_key_binding.rotated',
    'device_key_binding',previous_binding.id,'platform',jsonb_build_object('lifecycleStatus','active'),
    jsonb_build_object('lifecycleStatus','rotated','rotatedAt',v_now,'replacedByBindingId',v_binding),
    jsonb_build_object('deviceId',p_device_id,'authorizationId',p_authorization_id,
      'previousBindingId',previous_binding.id,'newBindingId',v_binding,
      'previousPublicKeyThumbprint',previous_binding.public_key_thumbprint,
      'newPublicKeyThumbprint',p_public_key_thumbprint,'recoveryReason',p_recovery_reason,
      'challengeId',p_challenge_id,'assertionJti',p_assertion_jti),p_assertion_jti,'system')
    returning id into v_rotation_audit;
  insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,
    entity_type,entity_id,scope_type,new_values,metadata,operation_id,source)
  values(p_user_id,p_authorization_id,p_user_id,'platform','devices','device_key_binding.recovery_activated',
    'device_key_binding',v_binding,'platform',jsonb_build_object('lifecycleStatus','active'),
    jsonb_build_object('deviceId',p_device_id,'authorizationId',p_authorization_id,
      'previousBindingId',previous_binding.id,'newBindingId',v_binding,
      'previousPublicKeyThumbprint',previous_binding.public_key_thumbprint,
      'newPublicKeyThumbprint',p_public_key_thumbprint,'recoveryReason',p_recovery_reason,
      'challengeId',p_challenge_id,'assertionJti',p_assertion_jti),p_assertion_jti,'system')
    returning id into v_activation_audit;
  insert into platform_private.device_ownership_handoff_audit(user_id,device_id,device_authorization_id,binding_id,
    public_key_thumbprint,purpose,migration_source,challenge_id,assertion_jti,handoff_mode,
    previous_binding_id,previous_public_key_thumbprint,recovery_reason)
  values(p_user_id,p_device_id,p_authorization_id,v_binding,p_public_key_thumbprint,'PLATFORM_DEVICE_OWNERSHIP_HANDOFF',
    'bound_key_rotation',p_challenge_id,p_assertion_jti,'binding_recovery',previous_binding.id,
    previous_binding.public_key_thumbprint,p_recovery_reason) returning id into v_handoff_audit;
  update platform_private.device_ownership_handoff_challenges
    set consumed_at=v_now,assertion_jti=p_assertion_jti,assertion_hash=p_assertion_hash,binding_id=v_binding
    where id=p_challenge_id;
  update platform.device_key_bindings set audit_event_id=v_activation_audit where id=v_binding;
  return jsonb_build_object('status','active','bindingId',v_binding,'previousBindingId',previous_binding.id,
    'deviceId',p_device_id,'authorizationId',p_authorization_id,'publicKeyThumbprint',p_public_key_thumbprint,
    'handoffAuditId',v_handoff_audit,'rotationAuditId',v_rotation_audit,'activationAuditId',v_activation_audit);
end;
$$;

revoke all on function platform.complete_device_binding_recovery(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid,bytea,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function platform.complete_device_binding_recovery(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid,bytea,timestamptz,timestamptz) to service_role;
