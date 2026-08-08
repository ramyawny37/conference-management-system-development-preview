begin;

create or replace function public.search_user_management_users(
  p_actor_device_id uuid,
  p_query text default null,
  p_account_status text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  normalized_query text := lower(trim(coalesce(p_query,'')));
  effective_limit integer := least(greatest(coalesce(p_limit,50),1),100);
begin
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  if not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;
  if p_account_status is not null
    and p_account_status not in ('pending','approved','blocked') then
    raise exception 'INVALID_ACCOUNT_STATUS' using errcode='22023';
  end if;

  return jsonb_build_object(
    'status','success',
    'users',coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId',users.id,
        'displayName',profiles.display_name,
        'email',users.email,
        'accountStatus',access.account_status,
        'conferenceCount',(select count(*) from public.conference_members members
          where members.user_id=users.id),
        'deviceCount',(select count(*) from public.user_device_authorizations devices
          where devices.user_id=users.id)
      ) order by coalesce(profiles.display_name,users.email),users.id)
      from (
        select auth_users.id,auth_users.email
        from auth.users auth_users
        join public.system_user_access candidate_access
          on candidate_access.user_id=auth_users.id
        left join public.profiles candidate_profiles
          on candidate_profiles.id=auth_users.id
        where (p_account_status is null
          or candidate_access.account_status=p_account_status)
          and (normalized_query=''
            or lower(coalesce(candidate_profiles.display_name,'')) like
              '%'||normalized_query||'%'
            or lower(coalesce(auth_users.email,'')) like
              '%'||normalized_query||'%')
        order by coalesce(candidate_profiles.display_name,auth_users.email),
          auth_users.id
        limit effective_limit
      ) users
      join public.system_user_access access on access.user_id=users.id
      left join public.profiles profiles on profiles.id=users.id
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_user_management_devices(
  p_actor_device_id uuid,
  p_target_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
begin
  if p_target_user_id is null then
    raise exception 'TARGET_USER_REQUIRED' using errcode='22023';
  end if;
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  if not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users users where users.id=p_target_user_id) then
    raise exception 'TARGET_USER_NOT_FOUND' using errcode='P0002';
  end if;

  return jsonb_build_object(
    'status','success',
    'devices',coalesce((select jsonb_agg(jsonb_build_object(
      'deviceId',authorizations.device_id,
      'deviceName',devices.device_name,
      'platform',devices.platform,
      'lastSeenAt',devices.last_seen_at,
      'authorizationStatus',authorizations.authorization_status,
      'requestedAt',authorizations.requested_at,
      'approvedAt',authorizations.approved_at,
      'revokedAt',authorizations.revoked_at,
      'lastRegisteredAt',authorizations.last_registered_at,
      'capabilities',jsonb_build_object(
        'canApprove',false,'canReject',false,'canRevoke',false)
    ) order by authorizations.created_at,authorizations.device_id)
    from public.user_device_authorizations authorizations
    join public.devices devices on devices.id=authorizations.device_id
      and devices.user_id=authorizations.user_id
    where authorizations.user_id=p_target_user_id),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_user_management_overview(
  p_actor_device_id uuid,
  p_target_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  target_user auth.users%rowtype;
  target_profile public.profiles%rowtype;
  target_access public.system_user_access%rowtype;
  actor_is_system_owner boolean;
begin
  if p_target_user_id is null then
    raise exception 'TARGET_USER_REQUIRED' using errcode='22023';
  end if;
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  actor_is_system_owner:=public.is_system_owner(actor_id);
  if not actor_is_system_owner then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;

  select * into target_user from auth.users users
   where users.id=p_target_user_id;
  if not found then
    raise exception 'TARGET_USER_NOT_FOUND' using errcode='P0002';
  end if;
  select * into target_profile from public.profiles profiles
   where profiles.id=p_target_user_id;
  select * into target_access from public.system_user_access access
   where access.user_id=p_target_user_id;
  if not found then
    raise exception 'SYSTEM_ACCESS_NOT_FOUND' using errcode='P0002';
  end if;

  return jsonb_build_object(
    'status','success',
    'user',jsonb_build_object(
      'userId',target_user.id,
      'displayName',target_profile.display_name,
      'email',target_user.email
    ),
    'account',jsonb_build_object(
      'accountStatus',target_access.account_status,
      'canCreateConferences',target_access.can_create_conferences,
      'systemRoles',coalesce((select jsonb_agg(roles.role order by roles.role)
        from public.system_user_roles roles
        where roles.user_id=p_target_user_id),'[]'::jsonb)
    ),
    'organizations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'organizationId',organizations.id,
        'organizationName',organizations.display_name,
        'isMember',target_members.user_id is not null,
        'role',target_members.role,
        'capabilities',jsonb_build_object(
          'canAdd',target_members.user_id is null
            and target_access.account_status='approved',
          'canChangeRole',target_members.user_id is not null
            and actor_members.role='organization_owner'
            and p_target_user_id<>actor_id,
          'canRemove',target_members.user_id is not null
            and target_members.user_id<>actor_id
            and (actor_members.role='organization_owner'
              or target_members.role='member')
        )
      ) order by organizations.display_name,organizations.id)
      from public.organization_members actor_members
      join public.organizations organizations
        on organizations.id=actor_members.organization_id
      left join public.organization_members target_members
        on target_members.organization_id=organizations.id
       and target_members.user_id=p_target_user_id
      where actor_members.user_id=actor_id
        and actor_members.role in ('organization_owner','organization_admin')
    ),'[]'::jsonb),
    'conferences',coalesce((
      select jsonb_agg(jsonb_build_object(
        'conferenceId',conferences.id,
        'conferenceName',conferences.name,
        'organizationId',conferences.organization_id,
        'isMember',members.user_id is not null,
        'role',members.role,
        'capabilities',jsonb_build_object(
          'canAdd',members.user_id is null,
          'canChangeRole',members.user_id is not null
            and members.role<>'owner',
          'canRemove',members.user_id is not null
            and members.role<>'owner'
        )
      ) order by conferences.created_at,conferences.id)
      from public.conferences conferences
      left join public.conference_members members
        on members.conference_id=conferences.id
       and members.user_id=p_target_user_id
      where conferences.owner_id=actor_id
        and conferences.deleted_at is null
    ),'[]'::jsonb),
    'deviceOrganizationId',(
      select actor_members.organization_id
      from public.organization_members actor_members
      join public.organization_members target_members
        on target_members.organization_id=actor_members.organization_id
       and target_members.user_id=p_target_user_id
      where actor_members.user_id=actor_id
        and actor_members.role in ('organization_owner','organization_admin')
        and (actor_members.role='organization_owner'
          or target_members.role='member')
      order by actor_members.created_at,actor_members.organization_id
      limit 1
    ),
    'capabilities',jsonb_build_object(
      'canManageAccount',actor_is_system_owner
    )
  );
end;
$$;

revoke all on function public.search_user_management_users(
  uuid,text,text,integer) from public,anon;
revoke all on function public.get_user_management_overview(
  uuid,uuid) from public,anon;
revoke all on function public.get_user_management_devices(
  uuid,uuid) from public,anon;
grant execute on function public.search_user_management_users(
  uuid,text,text,integer) to authenticated;
grant execute on function public.get_user_management_overview(
  uuid,uuid) to authenticated;
grant execute on function public.get_user_management_devices(
  uuid,uuid) to authenticated;

commit;
