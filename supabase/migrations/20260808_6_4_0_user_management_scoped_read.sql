begin;

create or replace function public.get_user_management_actor_capabilities(
  p_actor_device_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  system_owner boolean;
  organization_administrator boolean;
  conference_owner boolean;
begin
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  system_owner:=public.is_system_owner(actor_id);
  organization_administrator:=exists(
    select 1 from public.organization_members members
    where members.user_id=actor_id
      and members.role in ('organization_owner','organization_admin'));
  conference_owner:=exists(
    select 1 from public.conferences conferences
    where conferences.owner_id=actor_id and conferences.deleted_at is null);
  return jsonb_build_object(
    'status','success',
    'canOpenUserManagement',system_owner or organization_administrator or conference_owner,
    'canViewAccount',system_owner,
    'canManageAccount',system_owner,
    'canViewOrganization',organization_administrator,
    'canManageOrganizationMembers',organization_administrator,
    'canManageOrganizationRoles',exists(
      select 1 from public.organization_members members
      where members.user_id=actor_id and members.role='organization_owner'),
    'canViewConferences',conference_owner,
    'canManageConferenceMembership',conference_owner,
    'canViewDevices',organization_administrator,
    'canManageDevices',organization_administrator);
end;
$$;

create or replace function public.search_user_management_users(
  p_actor_device_id uuid,
  p_query text default null,
  p_account_status text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  system_owner boolean;
  normalized_query text:=lower(trim(coalesce(p_query,'')));
  effective_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  system_owner:=public.is_system_owner(actor_id);
  if p_account_status is not null
    and p_account_status not in ('pending','approved','blocked') then
    raise exception 'INVALID_ACCOUNT_STATUS' using errcode='22023';
  end if;
  return jsonb_build_object(
    'status','success',
    'capabilities',public.get_user_management_actor_capabilities(p_actor_device_id)-'status',
    'users',coalesce((
      with scoped_users as (
        select users.id,users.email from auth.users users where system_owner
        union
        select users.id,users.email
        from public.organization_members actor_members
        join public.organization_members target_members
          on target_members.organization_id=actor_members.organization_id
        join auth.users users on users.id=target_members.user_id
        where actor_members.user_id=actor_id
          and actor_members.role in ('organization_owner','organization_admin')
        union
        select users.id,users.email
        from public.conferences conferences
        join public.conference_members target_members
          on target_members.conference_id=conferences.id
        join auth.users users on users.id=target_members.user_id
        where conferences.owner_id=actor_id and conferences.deleted_at is null
      ), filtered as (
        select users.id,users.email
        from scoped_users users
        join public.system_user_access access on access.user_id=users.id
        left join public.profiles profiles on profiles.id=users.id
        where (p_account_status is null or access.account_status=p_account_status)
          and (normalized_query='' or lower(coalesce(profiles.display_name,'')) like '%'||normalized_query||'%'
            or lower(coalesce(users.email,'')) like '%'||normalized_query||'%')
        order by coalesce(profiles.display_name,users.email),users.id limit effective_limit
      )
      select jsonb_agg(jsonb_build_object(
        'userId',users.id,'displayName',profiles.display_name,'email',users.email,
        'accountStatus',access.account_status,
        'conferenceCount',(select count(*) from public.conference_members members
          join public.conferences conferences on conferences.id=members.conference_id
          where members.user_id=users.id and (system_owner or conferences.owner_id=actor_id)),
        'deviceCount',(select count(*) from public.user_device_authorizations devices
          where devices.user_id=users.id and (system_owner or exists(
            select 1 from public.organization_members am
            join public.organization_members tm on tm.organization_id=am.organization_id
            where am.user_id=actor_id and tm.user_id=users.id
              and am.role in ('organization_owner','organization_admin'))))
      ) order by coalesce(profiles.display_name,users.email),users.id)
      from filtered users
      join public.system_user_access access on access.user_id=users.id
      left join public.profiles profiles on profiles.id=users.id
    ),'[]'::jsonb));
end;
$$;

create or replace function public.get_user_management_overview(
  p_actor_device_id uuid,
  p_target_user_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  system_owner boolean;
  target_user auth.users%rowtype;
  target_profile public.profiles%rowtype;
  target_access public.system_user_access%rowtype;
  target_in_scope boolean;
  device_organization_id uuid;
begin
  if p_target_user_id is null then raise exception 'TARGET_USER_REQUIRED' using errcode='22023'; end if;
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  system_owner:=public.is_system_owner(actor_id);
  target_in_scope:=system_owner or exists(
    select 1 from public.organization_members am join public.organization_members tm
      on tm.organization_id=am.organization_id
    where am.user_id=actor_id and tm.user_id=p_target_user_id
      and am.role in ('organization_owner','organization_admin')) or exists(
    select 1 from public.conferences c join public.conference_members cm on cm.conference_id=c.id
    where c.owner_id=actor_id and c.deleted_at is null and cm.user_id=p_target_user_id);
  if not target_in_scope then raise exception 'USER_MANAGEMENT_SCOPE_DENIED' using errcode='42501'; end if;
  select * into target_user from auth.users users where users.id=p_target_user_id;
  if not found then raise exception 'TARGET_USER_NOT_FOUND' using errcode='P0002'; end if;
  select * into target_profile from public.profiles where id=p_target_user_id;
  select * into target_access from public.system_user_access where user_id=p_target_user_id;
  if not found then raise exception 'SYSTEM_ACCESS_NOT_FOUND' using errcode='P0002'; end if;
  select am.organization_id into device_organization_id
  from public.organization_members am join public.organization_members tm
    on tm.organization_id=am.organization_id and tm.user_id=p_target_user_id
  where am.user_id=actor_id and am.role in ('organization_owner','organization_admin')
    and (am.role='organization_owner' or tm.role='member')
  order by am.created_at,am.organization_id limit 1;
  return jsonb_build_object(
    'status','success',
    'user',jsonb_build_object('userId',target_user.id,'displayName',target_profile.display_name,'email',target_user.email),
    'account',case when system_owner then jsonb_build_object(
      'accountStatus',target_access.account_status,'canCreateConferences',target_access.can_create_conferences,
      'systemRoles',coalesce((select jsonb_agg(r.role order by r.role) from public.system_user_roles r
        where r.user_id=p_target_user_id),'[]'::jsonb)) else null end,
    'organizations',coalesce((select jsonb_agg(jsonb_build_object(
      'organizationId',o.id,'organizationName',o.display_name,'isMember',tm.user_id is not null,'role',tm.role,
      'capabilities',jsonb_build_object(
        'canAdd',tm.user_id is null and target_access.account_status='approved',
        'canChangeRole',tm.user_id is not null and am.role='organization_owner' and p_target_user_id<>actor_id,
        'canRemove',tm.user_id is not null and p_target_user_id<>actor_id
          and (am.role='organization_owner' or tm.role='member')))
      order by o.display_name,o.id)
      from public.organization_members am join public.organizations o on o.id=am.organization_id
      left join public.organization_members tm on tm.organization_id=o.id and tm.user_id=p_target_user_id
      where am.user_id=actor_id and am.role in ('organization_owner','organization_admin')),'[]'::jsonb),
    'conferences',coalesce((select jsonb_agg(jsonb_build_object(
      'conferenceId',c.id,'conferenceName',c.name,'organizationId',c.organization_id,
      'isMember',cm.user_id is not null,'role',cm.role,
      'capabilities',jsonb_build_object('canAdd',cm.user_id is null,
        'canChangeRole',cm.user_id is not null and cm.role<>'owner',
        'canRemove',cm.user_id is not null and cm.role<>'owner'))
      order by c.created_at,c.id)
      from public.conferences c left join public.conference_members cm
        on cm.conference_id=c.id and cm.user_id=p_target_user_id
      where c.owner_id=actor_id and c.deleted_at is null),'[]'::jsonb),
    'deviceOrganizationId',device_organization_id,
    'capabilities',jsonb_build_object(
      'canViewAccount',system_owner,'canManageAccount',system_owner,
      'canViewOrganization',exists(select 1 from public.organization_members am
        where am.user_id=actor_id and am.role in ('organization_owner','organization_admin')),
      'canManageOrganizationMembers',exists(select 1 from public.organization_members am
        where am.user_id=actor_id and am.role in ('organization_owner','organization_admin')),
      'canManageOrganizationRoles',exists(select 1 from public.organization_members am
        where am.user_id=actor_id and am.role='organization_owner'),
      'canViewConferences',exists(select 1 from public.conferences c where c.owner_id=actor_id and c.deleted_at is null),
      'canManageConferenceMembership',exists(select 1 from public.conferences c where c.owner_id=actor_id and c.deleted_at is null),
      'canViewDevices',device_organization_id is not null,
      'canManageDevices',device_organization_id is not null));
end;
$$;

create or replace function public.get_user_management_devices(
  p_actor_device_id uuid,
  p_target_user_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare actor_id uuid; system_owner boolean; scoped boolean;
begin
  if p_target_user_id is null then raise exception 'TARGET_USER_REQUIRED' using errcode='22023'; end if;
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  system_owner:=public.is_system_owner(actor_id);
  scoped:=system_owner or exists(
    select 1 from public.organization_members am join public.organization_members tm
      on tm.organization_id=am.organization_id
    where am.user_id=actor_id and tm.user_id=p_target_user_id
      and am.role in ('organization_owner','organization_admin')
      and (am.role='organization_owner' or tm.role='member'));
  if not scoped then raise exception 'DEVICE_READ_SCOPE_DENIED' using errcode='42501'; end if;
  return jsonb_build_object('status','success','devices',coalesce((select jsonb_agg(jsonb_build_object(
    'deviceId',a.device_id,'deviceName',d.device_name,'platform',d.platform,
    'lastSeenAt',d.last_seen_at,'authorizationStatus',a.authorization_status,
    'requestedAt',a.requested_at,'approvedAt',a.approved_at,'revokedAt',a.revoked_at,
    'lastRegisteredAt',a.last_registered_at,
    'capabilities',jsonb_build_object('canApprove',false,'canReject',false,'canRevoke',false))
    order by a.created_at,a.device_id)
    from public.user_device_authorizations a join public.devices d
      on d.id=a.device_id and d.user_id=a.user_id
    where a.user_id=p_target_user_id),'[]'::jsonb));
end;
$$;

revoke all on function public.get_user_management_actor_capabilities(uuid) from public,anon;
revoke all on function public.search_user_management_users(uuid,text,text,integer) from public,anon;
revoke all on function public.get_user_management_overview(uuid,uuid) from public,anon;
revoke all on function public.get_user_management_devices(uuid,uuid) from public,anon;
grant execute on function public.get_user_management_actor_capabilities(uuid) to authenticated;
grant execute on function public.search_user_management_users(uuid,text,text,integer) to authenticated;
grant execute on function public.get_user_management_overview(uuid,uuid) to authenticated;
grant execute on function public.get_user_management_devices(uuid,uuid) to authenticated;

commit;
