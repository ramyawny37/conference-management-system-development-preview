begin;

do $$
declare
  v_user constant uuid:='916c0d83-4c5a-4a9e-89bb-4faa671166f7';
  v_device constant uuid:='10000000-0000-4000-8000-000000000001';
  v_authorization constant uuid:='10000000-0000-4000-8000-000000000002';
  v_binding constant uuid:='10000000-0000-4000-8000-000000000003';
  v_session constant uuid:='10000000-0000-4000-8000-000000000004';
  v_thumbprint constant text:='cf0abff910e8d7bdc6aa31f33ef0121d1678e902e345ddde046ad546f0484d1a';
  v_jwk constant jsonb:='{"kty":"EC","crv":"P-256","x":"lbYLeDW-zMoeVzHOfnPrRhJBSwXEqpP24xlu_ICqI2g","y":"a0lv5kvQonfk8xW2cMG-54tRxb4rZyzNP58MdkKmBFQ"}'::jsonb;
  v_challenge jsonb;
  v_context jsonb;
  v_completed jsonb;
  v_verified jsonb;
  v_replay_rejected boolean:=false;
begin
  insert into platform.devices(id,secret_hash,display_name,lifecycle_status)
  values(v_device,encode(extensions.digest('phase-1b-runtime-fixture-device','sha256'),'hex'),'Phase 1B rollback fixture','active');
  insert into platform.user_device_authorizations(id,user_id,device_id,status,approved_at)
  values(v_authorization,v_user,v_device,'approved',statement_timestamp());
  insert into platform.device_key_bindings(id,user_id,device_id,device_authorization_id,public_key_jwk,
    public_key_thumbprint,algorithm,lifecycle_status,migration_source)
  values(v_binding,v_user,v_device,v_authorization,v_jwk,v_thumbprint,'ECDSA_P256_SHA256','active','current_http_only_device_secret');

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  v_challenge:=platform.begin_device_session_challenge(v_binding);
  if v_challenge->>'bindingId'<>v_binding::text then raise exception 'RUNTIME_CHALLENGE_CREATION_FAILED'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','service_role')::text,true);
  v_context:=platform.get_device_session_challenge_context((v_challenge->>'challengeId')::uuid,v_user);
  if v_context->'publicKeyJwk'<>v_jwk then raise exception 'RUNTIME_BINDING_JWK_LOOKUP_FAILED'; end if;
  if v_context->>'signingPayload'<>v_challenge->>'signingPayload' then raise exception 'RUNTIME_CANONICAL_PAYLOAD_FAILED'; end if;

  v_completed:=platform.complete_device_session((v_challenge->>'challengeId')::uuid,v_user,v_device,
    v_authorization,v_binding,v_thumbprint,v_session,extensions.digest('phase-1b-runtime-fixture-token','sha256'));
  if v_completed->>'sessionId'<>v_session::text then raise exception 'RUNTIME_SESSION_COMPLETION_FAILED'; end if;
  if not exists(select 1 from platform_private.device_sessions where id=v_session) then raise exception 'RUNTIME_SESSION_INSERT_FAILED'; end if;
  if not exists(select 1 from platform_private.device_session_audit where session_id=v_session and event='established') then
    raise exception 'RUNTIME_SESSION_AUDIT_FAILED';
  end if;

  v_verified:=platform.verify_device_session(v_user,v_session,extensions.digest('phase-1b-runtime-fixture-token','sha256'));
  if coalesce((v_verified->>'valid')::boolean,false) is not true then raise exception 'RUNTIME_SESSION_VERIFY_FAILED'; end if;

  begin
    perform platform.complete_device_session((v_challenge->>'challengeId')::uuid,v_user,v_device,
      v_authorization,v_binding,v_thumbprint,extensions.gen_random_uuid(),extensions.digest('replay','sha256'));
  exception when sqlstate '42501' then v_replay_rejected:=true;
  end;
  if not v_replay_rejected then raise exception 'RUNTIME_REPLAY_ACCEPTED'; end if;
end;
$$;

rollback;
