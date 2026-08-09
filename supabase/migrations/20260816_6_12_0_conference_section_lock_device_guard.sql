begin;

create or replace function public.require_conference_section_lock_writer(
  p_conference_id uuid,
  p_actor_device_id uuid
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  actor_id uuid;
  actor_role text;
begin
  actor_id := public.require_current_approved_device(p_actor_device_id);

  select members.role into actor_role
    from public.conference_members as members
   where members.conference_id = p_conference_id
     and members.user_id = actor_id;

  if actor_role is null or actor_role not in ('owner','manager') then
    raise exception 'CONFERENCE_WRITE_ACCESS_DENIED' using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

create or replace function public.acquire_conference_section_lock(
  p_conference_id uuid,
  p_section text,
  p_device_id uuid,
  p_lock_token uuid,
  p_ttl_seconds integer default 120
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  current_user_id uuid;
  effective_ttl integer := coalesce(p_ttl_seconds,120);
  normalized_section text := lower(trim(coalesce(p_section,'')));
  current_lock public.conference_locks%rowtype;
  server_now timestamptz := clock_timestamp();
  new_expiry timestamptz;
begin
  if p_conference_id is null or p_device_id is null or p_lock_token is null
    or normalized_section !~ '^[a-z][a-z0-9_]{0,31}$'
    or effective_ttl < 30 or effective_ttl > 300 then
    raise exception 'INVALID_CONFERENCE_SECTION_LOCK_ARGUMENTS' using errcode = '22023';
  end if;

  current_user_id := public.require_conference_section_lock_writer(
    p_conference_id,p_device_id
  );

  perform 1 from public.conferences as conferences
   where conferences.id = p_conference_id for update;
  if not found then
    raise exception 'CONFERENCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.require_conference_section_lock_writer(
    p_conference_id,p_device_id
  );

  select * into current_lock from public.conference_locks as locks
   where locks.conference_id = p_conference_id
     and locks.section = normalized_section for update;
  new_expiry := server_now + make_interval(secs => effective_ttl);

  if not found then
    insert into public.conference_locks(
      conference_id,section,user_id,device_id,lock_token,
      acquired_at,expires_at,last_renewed_at,created_at
    ) values(
      p_conference_id,normalized_section,current_user_id,p_device_id,p_lock_token,
      server_now,new_expiry,server_now,server_now
    );
    return jsonb_build_object(
      'success',true,'status','acquired','conferenceId',p_conference_id,
      'section',normalized_section,'lockToken',p_lock_token,'owned',true,
      'userId',current_user_id,'deviceId',p_device_id,'acquiredAt',server_now,
      'expiresAt',new_expiry,'lastRenewedAt',server_now,'serverNow',server_now,
      'isExpired',false
    );
  end if;

  if current_lock.expires_at <= server_now then
    update public.conference_locks
       set user_id=current_user_id,device_id=p_device_id,lock_token=p_lock_token,
           acquired_at=server_now,expires_at=new_expiry,
           last_renewed_at=server_now,created_at=server_now
     where conference_id=p_conference_id and section=normalized_section;
    return jsonb_build_object(
      'success',true,'status','acquired','conferenceId',p_conference_id,
      'section',normalized_section,'lockToken',p_lock_token,'owned',true,
      'userId',current_user_id,'deviceId',p_device_id,'acquiredAt',server_now,
      'expiresAt',new_expiry,'lastRenewedAt',server_now,'serverNow',server_now,
      'isExpired',false
    );
  end if;

  if current_lock.user_id=current_user_id and current_lock.device_id=p_device_id then
    return jsonb_build_object(
      'success',true,'status','already_owned','conferenceId',p_conference_id,
      'section',normalized_section,'lockToken',current_lock.lock_token,'owned',true,
      'userId',current_lock.user_id,'deviceId',current_lock.device_id,
      'acquiredAt',current_lock.acquired_at,'expiresAt',current_lock.expires_at,
      'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,
      'isExpired',false
    );
  end if;

  return jsonb_build_object(
    'success',true,'status','locked','errorCode','LOCK_NOT_OWNED',
    'conferenceId',p_conference_id,'section',normalized_section,'owned',false,
    'userId',current_lock.user_id,'deviceId',current_lock.device_id,
    'acquiredAt',current_lock.acquired_at,'expiresAt',current_lock.expires_at,
    'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,
    'isExpired',false
  );
end;
$$;

create or replace function public.renew_conference_section_lock(
  p_conference_id uuid,p_section text,p_device_id uuid,p_lock_token uuid,
  p_ttl_seconds integer default 120
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  current_user_id uuid;
  effective_ttl integer := coalesce(p_ttl_seconds,120);
  normalized_section text := lower(trim(coalesce(p_section,'')));
  current_lock public.conference_locks%rowtype;
  lock_found boolean;
  server_now timestamptz := clock_timestamp();
  new_expiry timestamptz;
begin
  if p_conference_id is null or p_device_id is null or p_lock_token is null
    or normalized_section !~ '^[a-z][a-z0-9_]{0,31}$'
    or effective_ttl < 30 or effective_ttl > 300 then
    raise exception 'INVALID_CONFERENCE_SECTION_LOCK_ARGUMENTS' using errcode = '22023';
  end if;

  current_user_id := public.require_conference_section_lock_writer(
    p_conference_id,p_device_id
  );

  select * into current_lock from public.conference_locks as locks
   where locks.conference_id=p_conference_id
     and locks.section=normalized_section for update;
  lock_found := found;

  perform public.require_conference_section_lock_writer(
    p_conference_id,p_device_id
  );

  if not lock_found then
    return jsonb_build_object(
      'success',true,'status','not_found','errorCode','LOCK_NOT_OWNED',
      'conferenceId',p_conference_id,'section',normalized_section,
      'owned',false,'serverNow',server_now,'isExpired',false
    );
  end if;
  if current_lock.expires_at<=server_now then
    return jsonb_build_object(
      'success',true,'status','expired','errorCode','LOCK_EXPIRED',
      'conferenceId',p_conference_id,'section',normalized_section,
      'owned',false,'expiresAt',current_lock.expires_at,
      'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,
      'isExpired',true
    );
  end if;
  if current_lock.user_id<>current_user_id or current_lock.device_id<>p_device_id then
    return jsonb_build_object(
      'success',true,'status','not_owner','errorCode','LOCK_NOT_OWNED',
      'conferenceId',p_conference_id,'section',normalized_section,
      'owned',false,'expiresAt',current_lock.expires_at,
      'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,
      'isExpired',false
    );
  end if;
  if current_lock.lock_token<>p_lock_token then
    return jsonb_build_object(
      'success',true,'status','not_owner','errorCode','LOCK_TOKEN_MISMATCH',
      'conferenceId',p_conference_id,'section',normalized_section,
      'owned',false,'expiresAt',current_lock.expires_at,
      'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,
      'isExpired',false
    );
  end if;

  new_expiry:=server_now+make_interval(secs=>effective_ttl);
  update public.conference_locks
     set expires_at=new_expiry,last_renewed_at=server_now
   where conference_id=p_conference_id and section=normalized_section;
  return jsonb_build_object(
    'success',true,'status','renewed','conferenceId',p_conference_id,
    'section',normalized_section,'lockToken',p_lock_token,'owned',true,
    'userId',current_user_id,'deviceId',p_device_id,
    'acquiredAt',current_lock.acquired_at,'expiresAt',new_expiry,
    'lastRenewedAt',server_now,'serverNow',server_now,'isExpired',false
  );
end;
$$;

create or replace function public.release_conference_section_lock(
  p_conference_id uuid,p_section text,p_device_id uuid,p_lock_token uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  current_user_id uuid;
  normalized_section text := lower(trim(coalesce(p_section,'')));
  current_lock public.conference_locks%rowtype;
  lock_found boolean;
  server_now timestamptz := clock_timestamp();
begin
  if p_conference_id is null or p_device_id is null or p_lock_token is null
    or normalized_section !~ '^[a-z][a-z0-9_]{0,31}$' then
    raise exception 'INVALID_CONFERENCE_SECTION_LOCK_ARGUMENTS' using errcode = '22023';
  end if;

  current_user_id := public.require_conference_section_lock_writer(
    p_conference_id,p_device_id
  );

  select * into current_lock from public.conference_locks as locks
   where locks.conference_id=p_conference_id
     and locks.section=normalized_section for update;
  lock_found := found;

  perform public.require_conference_section_lock_writer(
    p_conference_id,p_device_id
  );

  if not lock_found then
    return jsonb_build_object(
      'success',true,'status','not_found','errorCode','LOCK_NOT_OWNED',
      'conferenceId',p_conference_id,'section',normalized_section,
      'owned',false,'serverNow',server_now
    );
  end if;
  if current_lock.user_id<>current_user_id or current_lock.device_id<>p_device_id then
    return jsonb_build_object(
      'success',true,'status','not_owner','errorCode','LOCK_NOT_OWNED',
      'conferenceId',p_conference_id,'section',normalized_section,
      'owned',false,'serverNow',server_now
    );
  end if;
  if current_lock.lock_token<>p_lock_token then
    return jsonb_build_object(
      'success',true,'status','not_owner','errorCode','LOCK_TOKEN_MISMATCH',
      'conferenceId',p_conference_id,'section',normalized_section,
      'owned',false,'serverNow',server_now
    );
  end if;

  delete from public.conference_locks
   where conference_id=p_conference_id and section=normalized_section;
  return jsonb_build_object(
    'success',true,'status','released','conferenceId',p_conference_id,
    'section',normalized_section,'lockToken',p_lock_token,'owned',false,
    'serverNow',server_now
  );
end;
$$;

revoke all on function public.require_conference_section_lock_writer(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.acquire_conference_section_lock(uuid,text,uuid,uuid,integer)
  from public,anon;
revoke all on function public.renew_conference_section_lock(uuid,text,uuid,uuid,integer)
  from public,anon;
revoke all on function public.release_conference_section_lock(uuid,text,uuid,uuid)
  from public,anon;
grant execute on function public.acquire_conference_section_lock(uuid,text,uuid,uuid,integer)
  to authenticated;
grant execute on function public.renew_conference_section_lock(uuid,text,uuid,uuid,integer)
  to authenticated;
grant execute on function public.release_conference_section_lock(uuid,text,uuid,uuid)
  to authenticated;

do $$
declare
  acquire_rpc oid := to_regprocedure(
    'public.acquire_conference_section_lock(uuid,text,uuid,uuid,integer)'
  );
  renew_rpc oid := to_regprocedure(
    'public.renew_conference_section_lock(uuid,text,uuid,uuid,integer)'
  );
  release_rpc oid := to_regprocedure(
    'public.release_conference_section_lock(uuid,text,uuid,uuid)'
  );
begin
  if acquire_rpc is null or renew_rpc is null or release_rpc is null then
    raise exception 'CONFERENCE_SECTION_LOCK_GUARD_SIGNATURE_MISSING';
  end if;
  if has_function_privilege('public',acquire_rpc,'execute')
    or has_function_privilege('anon',acquire_rpc,'execute')
    or has_function_privilege('public',renew_rpc,'execute')
    or has_function_privilege('anon',renew_rpc,'execute')
    or has_function_privilege('public',release_rpc,'execute')
    or has_function_privilege('anon',release_rpc,'execute') then
    raise exception 'CONFERENCE_SECTION_LOCK_GUARD_GRANT_INVALID';
  end if;
  if position('require_conference_section_lock_writer' in
      (select prosrc from pg_proc where oid=acquire_rpc))=0
    or position('require_conference_section_lock_writer' in
      (select prosrc from pg_proc where oid=renew_rpc))=0
    or position('require_conference_section_lock_writer' in
      (select prosrc from pg_proc where oid=release_rpc))=0 then
    raise exception 'CONFERENCE_SECTION_LOCK_GUARD_MISSING';
  end if;
end;
$$;

commit;
