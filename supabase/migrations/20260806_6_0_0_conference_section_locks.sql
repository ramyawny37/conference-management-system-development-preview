begin;

alter table public.conference_locks
  add column if not exists section text not null default 'conference';

alter table public.conference_locks
  drop constraint if exists conference_locks_pkey;

alter table public.conference_locks
  add constraint conference_locks_pkey primary key (conference_id, section);

alter table public.conference_locks
  drop constraint if exists conference_locks_section_check;

alter table public.conference_locks
  add constraint conference_locks_section_check
  check (section ~ '^[a-z][a-z0-9_]{0,31}$');

create or replace function public.acquire_conference_section_lock(
  p_conference_id uuid,
  p_section text,
  p_device_id uuid,
  p_lock_token uuid,
  p_ttl_seconds integer default 120
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  current_user_id uuid := auth.uid();
  effective_ttl integer := coalesce(p_ttl_seconds,120);
  normalized_section text := lower(trim(coalesce(p_section,'')));
  current_lock public.conference_locks%rowtype;
  server_now timestamptz := clock_timestamp();
  new_expiry timestamptz;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if p_conference_id is null or p_device_id is null or p_lock_token is null
    or normalized_section !~ '^[a-z][a-z0-9_]{0,31}$'
    or effective_ttl < 30 or effective_ttl > 300 then
    raise exception 'invalid conference section lock arguments';
  end if;
  if not public.is_conference_member(p_conference_id) then raise exception 'conference membership required'; end if;
  if not exists(select 1 from public.devices d where d.id=p_device_id and d.user_id=current_user_id) then
    raise exception 'device does not belong to authenticated user';
  end if;
  perform 1 from public.conferences c where c.id=p_conference_id for update;
  if not found then raise exception 'conference not found'; end if;
  select * into current_lock from public.conference_locks cl
   where cl.conference_id=p_conference_id and cl.section=normalized_section for update;
  new_expiry := server_now + make_interval(secs=>effective_ttl);
  if not found then
    insert into public.conference_locks(conference_id,section,user_id,device_id,lock_token,acquired_at,expires_at,last_renewed_at,created_at)
    values(p_conference_id,normalized_section,current_user_id,p_device_id,p_lock_token,server_now,new_expiry,server_now,server_now);
    return jsonb_build_object('success',true,'status','acquired','conferenceId',p_conference_id,'section',normalized_section,'lockToken',p_lock_token,'owned',true,'userId',current_user_id,'deviceId',p_device_id,'acquiredAt',server_now,'expiresAt',new_expiry,'lastRenewedAt',server_now,'serverNow',server_now,'isExpired',false);
  end if;
  if current_lock.expires_at <= server_now then
    update public.conference_locks set user_id=current_user_id,device_id=p_device_id,lock_token=p_lock_token,
      acquired_at=server_now,expires_at=new_expiry,last_renewed_at=server_now,created_at=server_now
     where conference_id=p_conference_id and section=normalized_section;
    return jsonb_build_object('success',true,'status','acquired','conferenceId',p_conference_id,'section',normalized_section,'lockToken',p_lock_token,'owned',true,'userId',current_user_id,'deviceId',p_device_id,'acquiredAt',server_now,'expiresAt',new_expiry,'lastRenewedAt',server_now,'serverNow',server_now,'isExpired',false);
  end if;
  if current_lock.user_id=current_user_id and current_lock.device_id=p_device_id then
    return jsonb_build_object('success',true,'status','already_owned','conferenceId',p_conference_id,'section',normalized_section,'lockToken',current_lock.lock_token,'owned',true,'userId',current_lock.user_id,'deviceId',current_lock.device_id,'acquiredAt',current_lock.acquired_at,'expiresAt',current_lock.expires_at,'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,'isExpired',false);
  end if;
  return jsonb_build_object('success',true,'status','locked','conferenceId',p_conference_id,'section',normalized_section,'owned',false,'userId',current_lock.user_id,'deviceId',current_lock.device_id,'acquiredAt',current_lock.acquired_at,'expiresAt',current_lock.expires_at,'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,'isExpired',false);
end; $$;

create or replace function public.renew_conference_section_lock(
  p_conference_id uuid,p_section text,p_device_id uuid,p_lock_token uuid,p_ttl_seconds integer default 120
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  current_user_id uuid := auth.uid(); effective_ttl integer := coalesce(p_ttl_seconds,120);
  normalized_section text := lower(trim(coalesce(p_section,'')));
  current_lock public.conference_locks%rowtype; server_now timestamptz := clock_timestamp(); new_expiry timestamptz;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if p_conference_id is null or p_device_id is null or p_lock_token is null
    or normalized_section !~ '^[a-z][a-z0-9_]{0,31}$' or effective_ttl<30 or effective_ttl>300 then
    raise exception 'invalid conference section lock arguments'; end if;
  if not public.is_conference_member(p_conference_id) then raise exception 'conference membership required'; end if;
  if not exists(select 1 from public.devices d where d.id=p_device_id and d.user_id=current_user_id) then raise exception 'device does not belong to authenticated user'; end if;
  select * into current_lock from public.conference_locks cl
   where cl.conference_id=p_conference_id and cl.section=normalized_section for update;
  if not found then return jsonb_build_object('success',true,'status','not_found','conferenceId',p_conference_id,'section',normalized_section,'owned',false,'serverNow',server_now,'isExpired',false); end if;
  if current_lock.expires_at<=server_now then
    return jsonb_build_object('success',true,'status','expired','conferenceId',p_conference_id,'section',normalized_section,'owned',false,'expiresAt',current_lock.expires_at,'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,'isExpired',true); end if;
  if current_lock.user_id<>current_user_id or current_lock.device_id<>p_device_id or current_lock.lock_token<>p_lock_token then
    return jsonb_build_object('success',true,'status','not_owner','conferenceId',p_conference_id,'section',normalized_section,'owned',false,'expiresAt',current_lock.expires_at,'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,'isExpired',false); end if;
  new_expiry:=server_now+make_interval(secs=>effective_ttl);
  update public.conference_locks set expires_at=new_expiry,last_renewed_at=server_now
   where conference_id=p_conference_id and section=normalized_section;
  return jsonb_build_object('success',true,'status','renewed','conferenceId',p_conference_id,'section',normalized_section,'lockToken',p_lock_token,'owned',true,'userId',current_user_id,'deviceId',p_device_id,'acquiredAt',current_lock.acquired_at,'expiresAt',new_expiry,'lastRenewedAt',server_now,'serverNow',server_now,'isExpired',false);
end; $$;

create or replace function public.release_conference_section_lock(
  p_conference_id uuid,p_section text,p_device_id uuid,p_lock_token uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  current_user_id uuid := auth.uid(); normalized_section text := lower(trim(coalesce(p_section,'')));
  current_lock public.conference_locks%rowtype; server_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if p_conference_id is null or p_device_id is null or p_lock_token is null or normalized_section !~ '^[a-z][a-z0-9_]{0,31}$' then raise exception 'invalid conference section lock arguments'; end if;
  if not public.is_conference_member(p_conference_id) then raise exception 'conference membership required'; end if;
  select * into current_lock from public.conference_locks cl
   where cl.conference_id=p_conference_id and cl.section=normalized_section for update;
  if not found then return jsonb_build_object('success',true,'status','not_found','conferenceId',p_conference_id,'section',normalized_section,'owned',false,'serverNow',server_now); end if;
  if current_lock.user_id<>current_user_id or current_lock.device_id<>p_device_id or current_lock.lock_token<>p_lock_token then
    return jsonb_build_object('success',true,'status','not_owner','conferenceId',p_conference_id,'section',normalized_section,'owned',false,'serverNow',server_now); end if;
  delete from public.conference_locks where conference_id=p_conference_id and section=normalized_section;
  return jsonb_build_object('success',true,'status','released','conferenceId',p_conference_id,'section',normalized_section,'lockToken',p_lock_token,'owned',false,'serverNow',server_now);
end; $$;

create or replace function public.get_conference_section_lock(
  p_conference_id uuid,p_section text,p_device_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  current_user_id uuid := auth.uid(); normalized_section text := lower(trim(coalesce(p_section,'')));
  current_lock public.conference_locks%rowtype; server_now timestamptz := clock_timestamp(); owned_by_requester boolean;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if p_conference_id is null or p_device_id is null or normalized_section !~ '^[a-z][a-z0-9_]{0,31}$' then raise exception 'invalid conference section lock arguments'; end if;
  if not public.is_conference_member(p_conference_id) then raise exception 'conference membership required'; end if;
  select * into current_lock from public.conference_locks cl where cl.conference_id=p_conference_id and cl.section=normalized_section;
  if not found then return jsonb_build_object('success',true,'status','not_found','conferenceId',p_conference_id,'section',normalized_section,'locked',false,'owned',false,'serverNow',server_now,'isExpired',false); end if;
  owned_by_requester:=current_lock.user_id=current_user_id and current_lock.device_id=p_device_id;
  return jsonb_strip_nulls(jsonb_build_object('success',true,'status',case when current_lock.expires_at<=server_now then 'not_found' else 'locked' end,'conferenceId',p_conference_id,'section',normalized_section,'locked',current_lock.expires_at>server_now,'owned',owned_by_requester and current_lock.expires_at>server_now,'lockToken',case when owned_by_requester then current_lock.lock_token else null end,'userId',current_lock.user_id,'deviceId',current_lock.device_id,'acquiredAt',current_lock.acquired_at,'expiresAt',current_lock.expires_at,'lastRenewedAt',current_lock.last_renewed_at,'serverNow',server_now,'isExpired',current_lock.expires_at<=server_now));
end; $$;

-- Preserve the public legacy API while ensuring its queries address only the
-- legacy "conference" section after the primary key becomes composite.
create or replace function public.acquire_conference_lock(
  p_conference_id uuid,p_device_id uuid,p_lock_token uuid,p_ttl_seconds integer default 120
) returns jsonb language sql security definer
set search_path = pg_catalog, public as $$
  select public.acquire_conference_section_lock(p_conference_id,'conference',p_device_id,p_lock_token,p_ttl_seconds);
$$;

create or replace function public.renew_conference_lock(
  p_conference_id uuid,p_device_id uuid,p_lock_token uuid,p_ttl_seconds integer default 120
) returns jsonb language sql security definer
set search_path = pg_catalog, public as $$
  select public.renew_conference_section_lock(p_conference_id,'conference',p_device_id,p_lock_token,p_ttl_seconds);
$$;

create or replace function public.release_conference_lock(
  p_conference_id uuid,p_device_id uuid,p_lock_token uuid
) returns jsonb language sql security definer
set search_path = pg_catalog, public as $$
  select public.release_conference_section_lock(p_conference_id,'conference',p_device_id,p_lock_token);
$$;

create or replace function public.get_conference_lock(
  p_conference_id uuid,p_device_id uuid
) returns jsonb language sql security definer
set search_path = pg_catalog, public as $$
  select public.get_conference_section_lock(p_conference_id,'conference',p_device_id);
$$;

revoke all on function public.acquire_conference_section_lock(uuid,text,uuid,uuid,integer) from public;
revoke all on function public.renew_conference_section_lock(uuid,text,uuid,uuid,integer) from public;
revoke all on function public.release_conference_section_lock(uuid,text,uuid,uuid) from public;
revoke all on function public.get_conference_section_lock(uuid,text,uuid) from public;
grant execute on function public.acquire_conference_section_lock(uuid,text,uuid,uuid,integer) to authenticated;
grant execute on function public.renew_conference_section_lock(uuid,text,uuid,uuid,integer) to authenticated;
grant execute on function public.release_conference_section_lock(uuid,text,uuid,uuid) to authenticated;
grant execute on function public.get_conference_section_lock(uuid,text,uuid) to authenticated;

commit;
