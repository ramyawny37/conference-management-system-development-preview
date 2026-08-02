begin;

-- P0.3C-1 creates an inactive guarded RPC surface only. It does not revoke
-- legacy grants or enable enforcement; P0.3E alone activates runtime use.
create or replace function public.get_my_device_aware_system_access(
  p_device_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  access_row public.system_user_access%rowtype;
  device_status text;
  enforcement_enabled boolean;
  roles text[];
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select * into access_row from public.system_user_access as access
   where access.user_id = current_user_id;
  select authorization_status into device_status
    from public.user_device_authorizations as authorizations
   where authorizations.user_id = current_user_id
     and authorizations.device_id = p_device_id;
  select enforcement.enforcement_enabled into enforcement_enabled
    from public.device_authorization_enforcement as enforcement
   where enforcement.singleton_id = 1;
  select coalesce(array_agg(system_roles.role order by system_roles.role), '{}'::text[])
    into roles from public.system_user_roles as system_roles
   where system_roles.user_id = current_user_id;
  return jsonb_build_object(
    'userId', current_user_id,
    'accountStatus', coalesce(access_row.account_status, 'missing'),
    'canCreateConferences', coalesce(access_row.can_create_conferences, false),
    'systemRoles', roles,
    'isSystemOwner', 'system_owner' = any(roles),
    'isSystemAdmin', 'system_admin' = any(roles),
    'deviceAuthorizationStatus', coalesce(device_status, 'not_registered'),
    'enforcementEnabled', coalesce(enforcement_enabled, false),
    'checkedAt', clock_timestamp()
  );
end;
$$;

-- Read guards preserve the legacy return contracts while binding each call to
-- the common approved-device helper. Mutation guards are added separately only
-- with their reviewed lock/idempotency implementations.
create or replace function public.device_guarded_list_my_organizations(
  p_actor_device_id uuid
)
returns table (id uuid, organization_key text, display_name text, is_default boolean, created_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.require_current_approved_device(p_actor_device_id);
  return query select * from public.list_my_organizations();
end; $$;

create or replace function public.device_guarded_get_my_organization_access(
  p_actor_device_id uuid, p_organization_id uuid
)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.require_current_approved_device(p_actor_device_id);
  return public.get_my_organization_access(p_organization_id);
end; $$;

create or replace function public.device_guarded_list_organization_members(
  p_actor_device_id uuid, p_organization_id uuid
)
returns table (user_id uuid, display_name text, role text, created_at timestamptz, is_current_user boolean)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.require_current_approved_device(p_actor_device_id);
  return query select * from public.list_organization_members(p_organization_id);
end; $$;

create or replace function public.device_guarded_lookup_organization_candidate_by_email(
  p_actor_device_id uuid, p_organization_id uuid, p_email text
)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.require_current_approved_device(p_actor_device_id);
  return public.lookup_organization_candidate_by_email(p_organization_id, p_email);
end; $$;

create or replace function public.device_guarded_get_my_conference_access(
  p_actor_device_id uuid, p_conference_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.require_current_approved_device(p_actor_device_id);
  return public.get_my_conference_access(p_conference_id);
end; $$;

create or replace function public.device_guarded_list_conference_members(
  p_actor_device_id uuid, p_conference_id uuid
) returns table (user_id uuid, display_name text, role text, created_at timestamptz, is_current_user boolean)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.require_current_approved_device(p_actor_device_id);
  return query select * from public.list_conference_members(p_conference_id);
end; $$;

create or replace function public.device_guarded_lookup_conference_user_by_email(
  p_actor_device_id uuid, p_conference_id uuid, p_email text
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.require_current_approved_device(p_actor_device_id);
  return public.lookup_conference_user_by_email(p_conference_id, p_email);
end; $$;

create or replace function public.device_guarded_get_conference_lock(
  p_actor_device_id uuid, p_conference_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$ begin
  perform public.require_current_approved_device(p_actor_device_id);
  return public.get_conference_lock(p_conference_id, p_actor_device_id);
end; $$;

create or replace function public.device_guarded_get_my_conference_membership(
  p_actor_device_id uuid, p_conference_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ declare current_user_id uuid; membership_role text;
begin
  current_user_id := public.require_current_approved_device(p_actor_device_id);
  select members.role into membership_role from public.conference_members as members
   where members.conference_id = p_conference_id and members.user_id = current_user_id;
  if membership_role is null then
    return jsonb_build_object('success',false,'status','access_denied','conferenceId',p_conference_id);
  end if;
  return jsonb_build_object('success',true,'status','available','conferenceId',p_conference_id,
    'userId',current_user_id,'role',membership_role,
    'canManageMembers',membership_role = 'owner',
    'canSync',membership_role in ('owner','manager'),
    'canResolveConflicts',membership_role in ('owner','manager'),
    'canAcquireLock',membership_role in ('owner','manager'));
end; $$;

create or replace function public.device_guarded_list_available_conferences(
  p_actor_device_id uuid
) returns table (conference_id uuid, name text, owner_id uuid, role text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ declare current_user_id uuid;
begin
  current_user_id := public.require_current_approved_device(p_actor_device_id);
  return query select conferences.id, conferences.name, conferences.owner_id,
    members.role, conferences.created_at, conferences.updated_at, conferences.deleted_at
  from public.conference_members as members join public.conferences as conferences
    on conferences.id = members.conference_id
  where members.user_id = current_user_id order by conferences.created_at, conferences.id;
end; $$;

create or replace function public.device_guarded_get_conference_snapshot_metadata(
  p_actor_device_id uuid, p_conference_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ declare snapshot_row public.conference_snapshots%rowtype;
begin
  perform public.require_current_approved_device(p_actor_device_id);
  if not public.is_conference_member(p_conference_id) then raise exception 'CONFERENCE_MEMBERSHIP_REQUIRED' using errcode='42501'; end if;
  select * into snapshot_row from public.conference_snapshots where conference_id=p_conference_id;
  if not found then return jsonb_build_object('status','not_found','conferenceId',p_conference_id); end if;
  return jsonb_build_object('status','found','conferenceId',p_conference_id,'revision',snapshot_row.revision,'schemaVersion',snapshot_row.schema_version,'appVersion',snapshot_row.app_version,'updatedAt',snapshot_row.updated_at);
end; $$;

create or replace function public.device_guarded_download_conference_snapshot(
  p_actor_device_id uuid, p_conference_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ declare snapshot_row public.conference_snapshots%rowtype;
begin
  perform public.require_current_approved_device(p_actor_device_id);
  if not public.is_conference_member(p_conference_id) then raise exception 'CONFERENCE_MEMBERSHIP_REQUIRED' using errcode='42501'; end if;
  select * into snapshot_row from public.conference_snapshots where conference_id=p_conference_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','downloaded','conferenceId',p_conference_id,'snapshot',snapshot_row.data,'revision',snapshot_row.revision,'schemaVersion',snapshot_row.schema_version,'appVersion',snapshot_row.app_version,'updatedAt',snapshot_row.updated_at,'updatedByDeviceId',snapshot_row.updated_by_device_id);
end; $$;

create or replace function public.device_guarded_get_conference_creation_operation(
  p_actor_device_id uuid, p_operation_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ declare current_user_id uuid; operation_row public.conference_creation_operations%rowtype;
begin
  current_user_id := public.require_current_approved_device(p_actor_device_id);
  select * into operation_row from public.conference_creation_operations as operations
   where operations.user_id=current_user_id and operations.operation_id=p_operation_id;
  if not found then return jsonb_build_object('status','not_found','operationId',p_operation_id); end if;
  return jsonb_build_object('status','created','userId',current_user_id,
    'operationId',operation_row.operation_id,'conferenceId',operation_row.conference_id,
    'createdAt',operation_row.created_at,'updatedAt',operation_row.updated_at);
end; $$;

create or replace function public.device_guarded_get_sync_conflict(
  p_actor_device_id uuid, p_conflict_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ declare current_user_id uuid; conflict_row public.sync_conflicts%rowtype;
begin
  current_user_id := public.require_current_approved_device(p_actor_device_id);
  select conflicts.* into conflict_row from public.sync_conflicts as conflicts
  join public.conference_members as members on members.conference_id=conflicts.conference_id
   where conflicts.id=p_conflict_id and members.user_id=current_user_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','loaded','conflict',jsonb_build_object(
    'conflictId',conflict_row.id,'conferenceId',conflict_row.conference_id,
    'operationId',conflict_row.operation_id,'expectedRevision',conflict_row.expected_revision,
    'actualRevision',conflict_row.actual_revision,'localSnapshot',conflict_row.local_payload,
    'serverSnapshot',conflict_row.server_snapshot,'status',case conflict_row.status when 'open' then 'pending' when 'discarded' then 'ignored' else conflict_row.status end,
    'createdAt',conflict_row.created_at,'resolvedAt',conflict_row.resolved_at));
end; $$;

create or replace function public.device_guarded_list_sync_conflicts(
  p_actor_device_id uuid, p_conference_id uuid, p_status text, p_limit integer
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$ declare current_user_id uuid; normalized_status text; result_rows jsonb;
begin
  current_user_id := public.require_current_approved_device(p_actor_device_id);
  if p_status is not null and p_status not in ('pending','resolved','ignored') then raise exception 'INVALID_CONFLICT_STATUS' using errcode='22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'INVALID_CONFLICT_LIMIT' using errcode='22023'; end if;
  if not exists (select 1 from public.conference_members as members where members.conference_id=p_conference_id and members.user_id=current_user_id) then raise exception 'CONFERENCE_MEMBERSHIP_REQUIRED' using errcode='42501'; end if;
  normalized_status := case p_status when 'pending' then 'open' when 'ignored' then 'discarded' else p_status end;
  select coalesce(jsonb_agg(jsonb_build_object('conflictId',conflicts.id,'conferenceId',conflicts.conference_id,'operationId',conflicts.operation_id,'expectedRevision',conflicts.expected_revision,'actualRevision',conflicts.actual_revision,'localSnapshot',conflicts.local_payload,'serverSnapshot',conflicts.server_snapshot,'status',case conflicts.status when 'open' then 'pending' when 'discarded' then 'ignored' else conflicts.status end,'createdAt',conflicts.created_at,'resolvedAt',conflicts.resolved_at) order by conflicts.created_at, conflicts.id),'[]'::jsonb)
  into result_rows from (select * from public.sync_conflicts where conference_id=p_conference_id and (normalized_status is null or status=normalized_status) order by created_at,id limit p_limit) as conflicts;
  return jsonb_build_object('status','loaded','conflicts',result_rows);
end; $$;

create or replace function public.device_guarded_add_organization_member(p_actor_device_id uuid,p_organization_id uuid,p_target_user_id uuid,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended('organization-membership:'||p_organization_id::text,0)); return public.add_organization_member(p_organization_id,p_target_user_id,p_operation_id); end; $$;
create or replace function public.device_guarded_remove_organization_member(p_actor_device_id uuid,p_organization_id uuid,p_target_user_id uuid,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended('organization-membership:'||p_organization_id::text,0)); return public.remove_organization_member(p_organization_id,p_target_user_id,p_operation_id); end; $$;
create or replace function public.device_guarded_change_organization_role(p_actor_device_id uuid,p_organization_id uuid,p_target_user_id uuid,p_target_role text,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended('organization-membership:'||p_organization_id::text,0)); return public.change_organization_role(p_organization_id,p_target_user_id,p_target_role,p_operation_id); end; $$;
create or replace function public.device_guarded_add_conference_manager(p_actor_device_id uuid,p_conference_id uuid,p_target_user_id uuid,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); return public.add_conference_manager(p_conference_id,p_target_user_id,p_operation_id); end; $$;
create or replace function public.device_guarded_remove_conference_manager(p_actor_device_id uuid,p_conference_id uuid,p_target_user_id uuid,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); return public.remove_conference_manager(p_conference_id,p_target_user_id,p_operation_id); end; $$;
create or replace function public.device_guarded_create_conference_idempotent(p_actor_device_id uuid,p_operation_id uuid,p_requested_conference_id uuid,p_name text,p_initial_metadata jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':conference-create:'||p_operation_id::text,0)); return public.create_conference_idempotent(p_operation_id,p_requested_conference_id,p_name,p_initial_metadata); end; $$;
create or replace function public.device_guarded_apply_conference_snapshot(p_actor_device_id uuid,p_conference_id uuid,p_operation_id uuid,p_base_revision bigint,p_snapshot jsonb,p_schema_version text,p_app_version text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended('conference-snapshot:'||p_conference_id::text,0)); return public.apply_conference_snapshot(p_conference_id,p_operation_id,p_actor_device_id,p_base_revision,p_snapshot,p_schema_version,p_app_version); end; $$;
create or replace function public.device_guarded_acquire_conference_lock(p_actor_device_id uuid,p_conference_id uuid,p_lock_token uuid,p_ttl_seconds integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended('conference-lock:'||p_conference_id::text,0)); return public.acquire_conference_lock(p_conference_id,p_actor_device_id,p_lock_token,p_ttl_seconds); end; $$;
create or replace function public.device_guarded_renew_conference_lock(p_actor_device_id uuid,p_conference_id uuid,p_lock_token uuid,p_ttl_seconds integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended('conference-lock:'||p_conference_id::text,0)); return public.renew_conference_lock(p_conference_id,p_actor_device_id,p_lock_token,p_ttl_seconds); end; $$;
create or replace function public.device_guarded_release_conference_lock(p_actor_device_id uuid,p_conference_id uuid,p_lock_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended('conference-lock:'||p_conference_id::text,0)); return public.release_conference_lock(p_conference_id,p_actor_device_id,p_lock_token); end; $$;
create or replace function public.device_guarded_resolve_sync_conflict(p_actor_device_id uuid,p_conflict_id uuid,p_conference_id uuid,p_resolution_operation_id uuid,p_expected_revision bigint,p_strategy text,p_resolved_snapshot jsonb,p_schema_version text,p_app_version text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin perform public.require_current_approved_device(p_actor_device_id); perform pg_advisory_xact_lock(hashtextextended('conference-snapshot:'||p_conference_id::text,0)); return public.resolve_sync_conflict(p_conflict_id,p_conference_id,p_resolution_operation_id,p_actor_device_id,p_expected_revision,p_strategy,p_resolved_snapshot,p_schema_version,p_app_version); end; $$;

revoke all on function public.get_my_device_aware_system_access(uuid) from public, anon;
revoke all on function public.device_guarded_list_my_organizations(uuid) from public, anon;
revoke all on function public.device_guarded_get_my_organization_access(uuid,uuid) from public, anon;
revoke all on function public.device_guarded_list_organization_members(uuid,uuid) from public, anon;
revoke all on function public.device_guarded_lookup_organization_candidate_by_email(uuid,uuid,text) from public, anon;
grant execute on function public.get_my_device_aware_system_access(uuid) to authenticated;
grant execute on function public.device_guarded_list_my_organizations(uuid) to authenticated;
grant execute on function public.device_guarded_get_my_organization_access(uuid,uuid) to authenticated;
grant execute on function public.device_guarded_list_organization_members(uuid,uuid) to authenticated;
grant execute on function public.device_guarded_lookup_organization_candidate_by_email(uuid,uuid,text) to authenticated;
revoke all on function public.device_guarded_get_my_conference_access(uuid,uuid) from public, anon;
revoke all on function public.device_guarded_list_conference_members(uuid,uuid) from public, anon;
revoke all on function public.device_guarded_lookup_conference_user_by_email(uuid,uuid,text) from public, anon;
revoke all on function public.device_guarded_get_conference_lock(uuid,uuid) from public, anon;
revoke all on function public.device_guarded_get_my_conference_membership(uuid,uuid) from public, anon;
revoke all on function public.device_guarded_list_available_conferences(uuid) from public, anon;
revoke all on function public.device_guarded_get_conference_snapshot_metadata(uuid,uuid) from public, anon;
revoke all on function public.device_guarded_download_conference_snapshot(uuid,uuid) from public, anon;
grant execute on function public.device_guarded_get_my_conference_access(uuid,uuid) to authenticated;
grant execute on function public.device_guarded_list_conference_members(uuid,uuid) to authenticated;
grant execute on function public.device_guarded_lookup_conference_user_by_email(uuid,uuid,text) to authenticated;
grant execute on function public.device_guarded_get_conference_lock(uuid,uuid) to authenticated;
grant execute on function public.device_guarded_get_my_conference_membership(uuid,uuid) to authenticated;
grant execute on function public.device_guarded_list_available_conferences(uuid) to authenticated;
grant execute on function public.device_guarded_get_conference_snapshot_metadata(uuid,uuid) to authenticated;
grant execute on function public.device_guarded_download_conference_snapshot(uuid,uuid) to authenticated;
revoke all on function public.device_guarded_get_conference_creation_operation(uuid,uuid) from public, anon;
revoke all on function public.device_guarded_get_sync_conflict(uuid,uuid) from public, anon;
revoke all on function public.device_guarded_list_sync_conflicts(uuid,uuid,text,integer) from public, anon;
grant execute on function public.device_guarded_get_conference_creation_operation(uuid,uuid) to authenticated;
grant execute on function public.device_guarded_get_sync_conflict(uuid,uuid) to authenticated;
grant execute on function public.device_guarded_list_sync_conflicts(uuid,uuid,text,integer) to authenticated;
revoke all on function public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid) from public, anon;
revoke all on function public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid) from public, anon;
revoke all on function public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid) from public, anon;
revoke all on function public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid) from public, anon;
revoke all on function public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.device_guarded_create_conference_idempotent(uuid,uuid,uuid,text,jsonb),public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text),public.device_guarded_acquire_conference_lock(uuid,uuid,uuid,integer),public.device_guarded_renew_conference_lock(uuid,uuid,uuid,integer),public.device_guarded_release_conference_lock(uuid,uuid,uuid),public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text) from public, anon;
grant execute on function public.device_guarded_create_conference_idempotent(uuid,uuid,uuid,text,jsonb),public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text),public.device_guarded_acquire_conference_lock(uuid,uuid,uuid,integer),public.device_guarded_renew_conference_lock(uuid,uuid,uuid,integer),public.device_guarded_release_conference_lock(uuid,uuid,uuid),public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text) to authenticated;

-- P0.3C-1 creates inactive guarded read and mutation contracts. P0.3E alone
-- may revoke legacy RPC grants, activate these wrappers, or enable enforcement.
-- Fail closed unless the complete reviewed surface has the exact catalog shape.
do $$
declare
  expected_guarded regprocedure[] := array[
    'public.device_guarded_list_my_organizations(uuid)'::regprocedure,
    'public.device_guarded_get_my_organization_access(uuid,uuid)'::regprocedure,
    'public.device_guarded_list_organization_members(uuid,uuid)'::regprocedure,
    'public.device_guarded_lookup_organization_candidate_by_email(uuid,uuid,text)'::regprocedure,
    'public.device_guarded_get_my_conference_access(uuid,uuid)'::regprocedure,
    'public.device_guarded_list_conference_members(uuid,uuid)'::regprocedure,
    'public.device_guarded_lookup_conference_user_by_email(uuid,uuid,text)'::regprocedure,
    'public.device_guarded_get_conference_lock(uuid,uuid)'::regprocedure,
    'public.device_guarded_get_my_conference_membership(uuid,uuid)'::regprocedure,
    'public.device_guarded_list_available_conferences(uuid)'::regprocedure,
    'public.device_guarded_get_conference_snapshot_metadata(uuid,uuid)'::regprocedure,
    'public.device_guarded_download_conference_snapshot(uuid,uuid)'::regprocedure,
    'public.device_guarded_get_conference_creation_operation(uuid,uuid)'::regprocedure,
    'public.device_guarded_get_sync_conflict(uuid,uuid)'::regprocedure,
    'public.device_guarded_list_sync_conflicts(uuid,uuid,text,integer)'::regprocedure,
    'public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)'::regprocedure,
    'public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.device_guarded_create_conference_idempotent(uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)'::regprocedure,
    'public.device_guarded_acquire_conference_lock(uuid,uuid,uuid,integer)'::regprocedure,
    'public.device_guarded_renew_conference_lock(uuid,uuid,uuid,integer)'::regprocedure,
    'public.device_guarded_release_conference_lock(uuid,uuid,uuid)'::regprocedure,
    'public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)'::regprocedure
  ];
  expected_restricted regprocedure[] := array[
    'public.get_my_device_aware_system_access(uuid)'::regprocedure
  ];
  expected_stable regprocedure[] := array[
    'public.get_my_device_aware_system_access(uuid)'::regprocedure,
    'public.device_guarded_list_my_organizations(uuid)'::regprocedure,
    'public.device_guarded_get_my_organization_access(uuid,uuid)'::regprocedure,
    'public.device_guarded_list_organization_members(uuid,uuid)'::regprocedure,
    'public.device_guarded_lookup_organization_candidate_by_email(uuid,uuid,text)'::regprocedure,
    'public.device_guarded_get_my_conference_access(uuid,uuid)'::regprocedure,
    'public.device_guarded_list_conference_members(uuid,uuid)'::regprocedure,
    'public.device_guarded_lookup_conference_user_by_email(uuid,uuid,text)'::regprocedure,
    'public.device_guarded_get_my_conference_membership(uuid,uuid)'::regprocedure,
    'public.device_guarded_list_available_conferences(uuid)'::regprocedure,
    'public.device_guarded_get_conference_snapshot_metadata(uuid,uuid)'::regprocedure,
    'public.device_guarded_download_conference_snapshot(uuid,uuid)'::regprocedure,
    'public.device_guarded_get_conference_creation_operation(uuid,uuid)'::regprocedure,
    'public.device_guarded_get_sync_conflict(uuid,uuid)'::regprocedure,
    'public.device_guarded_list_sync_conflicts(uuid,uuid,text,integer)'::regprocedure
  ];
  approved_owner oid;
  helper_oid oid := 'public.require_current_approved_device(uuid)'::regprocedure::oid;
  actual_guarded_count integer;
begin
  select count(*) into actual_guarded_count
  from pg_proc as functions join pg_namespace as namespaces on namespaces.oid=functions.pronamespace
  where namespaces.nspname='public' and functions.proname like 'device_guarded_%';
  if actual_guarded_count <> cardinality(expected_guarded) then
    raise exception 'P0_3C_GUARDED_FUNCTION_COUNT_INVALID';
  end if;
  if exists (
    select 1 from unnest(expected_guarded||expected_restricted) as expected(oid)
    left join pg_proc as functions on functions.oid=expected.oid where functions.oid is null
  ) then raise exception 'P0_3C_APPROVED_SIGNATURE_MISSING'; end if;
  if (select count(*) from pg_proc as functions join pg_namespace as namespaces on namespaces.oid=functions.pronamespace
      where namespaces.nspname='public' and (functions.proname like 'device_guarded_%'
        or functions.proname='get_my_device_aware_system_access')) <> 27 then
    raise exception 'P0_3C_APPROVED_FUNCTION_COUNT_INVALID';
  end if;

  select classes.relowner into approved_owner from pg_class as classes
  join pg_namespace as namespaces on namespaces.oid=classes.relnamespace
  where namespaces.nspname='public' and classes.relname='device_authorization_enforcement';
  if approved_owner is null or (select count(*) from pg_class as classes
    join pg_namespace as namespaces on namespaces.oid=classes.relnamespace
    where namespaces.nspname='public' and classes.relkind='r' and classes.relname in (
      'devices','user_device_authorizations','device_authorization_operations',
      'device_authorization_audit_log','device_authorization_enforcement','system_user_access'
    )) <> 6 or exists (
    select 1 from pg_class as classes join pg_namespace as namespaces on namespaces.oid=classes.relnamespace
    where namespaces.nspname='public' and classes.relname in (
      'devices','user_device_authorizations','device_authorization_operations',
      'device_authorization_audit_log','device_authorization_enforcement','system_user_access'
    ) and classes.relowner<>approved_owner
  ) or exists (
    select 1 from unnest(expected_guarded||expected_restricted||array[helper_oid::regprocedure]) as expected(oid)
    join pg_proc as functions on functions.oid=expected.oid where functions.proowner<>approved_owner
  ) then raise exception 'P0_3C_FUNCTION_OWNER_INVALID'; end if;
  if exists (
    select 1 from unnest(expected_guarded||expected_restricted) as expected(oid)
    join pg_proc as functions on functions.oid=expected.oid
    where not functions.prosecdef
      or not (functions.proconfig @> array['search_path=pg_catalog, public']::text[])
      or has_function_privilege('public',functions.oid,'execute')
      or has_function_privilege('anon',functions.oid,'execute')
      or not has_function_privilege('authenticated',functions.oid,'execute')
  ) then raise exception 'P0_3C_FUNCTION_SECURITY_INVALID'; end if;
  if exists (
    select 1 from unnest(expected_guarded||expected_restricted) as expected(oid)
    join pg_proc as functions on functions.oid=expected.oid
    where (functions.oid=any(expected_stable) and functions.provolatile<>'s')
       or (not functions.oid=any(expected_stable) and functions.provolatile<>'v')
  ) then raise exception 'P0_3C_FUNCTION_MODE_INVALID'; end if;
  if not exists (select 1 from pg_proc where oid=helper_oid and prosecdef
      and proconfig @> array['search_path=pg_catalog, public']::text[])
     or has_function_privilege('public',helper_oid,'execute')
     or has_function_privilege('anon',helper_oid,'execute')
     or has_function_privilege('authenticated',helper_oid,'execute') then
    raise exception 'P0_3C_HELPER_ISOLATION_INVALID';
  end if;
  if exists (select 1 from public.device_authorization_enforcement where enforcement_enabled) then
    raise exception 'P0_3C_ENFORCEMENT_MUST_REMAIN_DISABLED';
  end if;
end;
$$;

commit;
