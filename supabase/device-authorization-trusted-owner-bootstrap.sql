begin;

-- P0.3D deployment-only template. Never commit a copy populated with real
-- identities. Replace all four placeholders only in an untracked local copy.
do $bootstrap$
declare
  trusted_user_text constant text := 'TRUSTED_OWNER_USER_UUID_HERE';
  trusted_email constant text := 'EXPECTED_TRUSTED_OWNER_EMAIL_HERE';
  organization_text constant text := 'ORGANIZATION_UUID_HERE';
  trusted_device_text constant text := 'TRUSTED_DEVICE_UUID_HERE';
  trusted_user_id uuid;
  trusted_organization_id uuid;
  trusted_device_id uuid;
  authorization_row public.user_device_authorizations%rowtype;
  protected_owner oid;
  initial_status text;
  matching_audit_count integer;
  related_bootstrap_count integer;
begin
  if trusted_user_text = 'TRUSTED_OWNER_USER_UUID_HERE'
     or trusted_email = 'EXPECTED_TRUSTED_OWNER_EMAIL_HERE'
     or organization_text = 'ORGANIZATION_UUID_HERE'
     or trusted_device_text = 'TRUSTED_DEVICE_UUID_HERE'
     or btrim(trusted_user_text) = '' or btrim(trusted_email) = ''
     or btrim(organization_text) = '' or btrim(trusted_device_text) = '' then
    raise exception 'P0_3D_REVIEWED_LITERALS_REQUIRED';
  end if;
  begin
    trusted_user_id := trusted_user_text::uuid;
    trusted_organization_id := organization_text::uuid;
    trusted_device_id := trusted_device_text::uuid;
  exception when invalid_text_representation then
    raise exception 'P0_3D_REVIEWED_UUID_INVALID';
  end;

  perform pg_advisory_xact_lock(hashtextextended(
    'device-authorization-user:' || trusted_user_id::text, 0));
  select * into authorization_row from public.user_device_authorizations
   where user_id=trusted_user_id and device_id=trusted_device_id for update;
  if not found then raise exception 'P0_3D_AUTHORIZATION_ROW_REQUIRED'; end if;

  -- All database preconditions below are checked while holding both locks.
  -- P0.3B protected-table, owner, RLS, FORCE-RLS and grant boundary.
  select min(c.relowner::text)::oid into protected_owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in (
    'devices','user_device_authorizations','device_authorization_operations',
    'device_authorization_audit_log','device_authorization_enforcement','system_user_access'
  );
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname in
      ('devices','user_device_authorizations','device_authorization_operations',
       'device_authorization_audit_log','device_authorization_enforcement','system_user_access')) <> 6
     or (select count(distinct c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='r' and c.relname in
         ('devices','user_device_authorizations','device_authorization_operations',
          'device_authorization_audit_log','device_authorization_enforcement','system_user_access')) <> 1
     or exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname in
         ('devices','user_device_authorizations','device_authorization_operations',
          'device_authorization_audit_log','device_authorization_enforcement','system_user_access')
         and (not c.relrowsecurity or c.relforcerowsecurity)) then
    raise exception 'P0_3D_P0_3B_PROTECTED_TABLE_INVARIANT_INVALID';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in
      ('user_device_authorizations','device_authorization_operations',
       'device_authorization_audit_log','device_authorization_enforcement')
      and (has_table_privilege('public',c.oid,'select') or has_table_privilege('anon',c.oid,'select')
        or has_table_privilege('authenticated',c.oid,'select') or has_table_privilege('authenticated',c.oid,'insert')
        or has_table_privilege('authenticated',c.oid,'update') or has_table_privilege('authenticated',c.oid,'delete'))) then
    raise exception 'P0_3D_P0_3B_TABLE_GRANT_INVALID';
  end if;
  if to_regclass('public.user_device_authorizations_one_approved_per_user_idx') is null
     or not exists (select 1 from pg_trigger where tgrelid='public.device_authorization_audit_log'::regclass
                    and tgname='device_authorization_audit_immutable' and not tgisinternal) then
    raise exception 'P0_3D_P0_3B_AUDIT_OR_INDEX_INVALID';
  end if;

  -- Exact P0.3B functions: three browser functions and two isolated helpers.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.oid in (
       to_regprocedure('public.prevent_device_authorization_audit_mutation()'),
       to_regprocedure('public.require_current_approved_device(uuid)'),
       to_regprocedure('public.register_or_refresh_current_device(uuid,text,text)'),
       to_regprocedure('public.request_current_device_authorization(uuid,uuid)'),
       to_regprocedure('public.get_my_device_authorization(uuid)'))) <> 5
     or exists (select 1 from pg_proc p where p.oid in (
       to_regprocedure('public.prevent_device_authorization_audit_mutation()'),
       to_regprocedure('public.require_current_approved_device(uuid)'),
       to_regprocedure('public.register_or_refresh_current_device(uuid,text,text)'),
       to_regprocedure('public.request_current_device_authorization(uuid,uuid)'),
       to_regprocedure('public.get_my_device_authorization(uuid)'))
       and (p.proowner<>protected_owner or not p.prosecdef
         or not (p.proconfig @> array['search_path=pg_catalog, public']::text[]))) then
    raise exception 'P0_3D_P0_3B_FUNCTION_INVARIANT_INVALID';
  end if;
  if has_function_privilege('public','public.require_current_approved_device(uuid)','execute')
     or has_function_privilege('anon','public.require_current_approved_device(uuid)','execute')
     or has_function_privilege('authenticated','public.require_current_approved_device(uuid)','execute')
     or has_function_privilege('public','public.prevent_device_authorization_audit_mutation()','execute')
     or has_function_privilege('anon','public.prevent_device_authorization_audit_mutation()','execute')
     or has_function_privilege('authenticated','public.prevent_device_authorization_audit_mutation()','execute') then
    raise exception 'P0_3D_P0_3B_HELPER_ISOLATION_INVALID';
  end if;
  if not has_function_privilege('authenticated','public.register_or_refresh_current_device(uuid,text,text)','execute')
     or not has_function_privilege('authenticated','public.request_current_device_authorization(uuid,uuid)','execute')
     or not has_function_privilege('authenticated','public.get_my_device_authorization(uuid)','execute')
     or has_function_privilege('public','public.register_or_refresh_current_device(uuid,text,text)','execute')
     or has_function_privilege('anon','public.register_or_refresh_current_device(uuid,text,text)','execute')
     or has_function_privilege('public','public.request_current_device_authorization(uuid,uuid)','execute')
     or has_function_privilege('anon','public.request_current_device_authorization(uuid,uuid)','execute')
     or has_function_privilege('public','public.get_my_device_authorization(uuid)','execute')
     or has_function_privilege('anon','public.get_my_device_authorization(uuid)','execute') then
    raise exception 'P0_3D_P0_3B_BROWSER_GRANT_INVALID';
  end if;

  -- P0.3C exact guarded surface and ownership/grant invariants.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like 'device_guarded_%'
        or p.proname='get_my_device_aware_system_access')) <> 27
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like 'device_guarded_%'
        or p.proname='get_my_device_aware_system_access')
        and (p.proowner<>protected_owner or not p.prosecdef
          or not (p.proconfig @> array['search_path=pg_catalog, public']::text[])
          or has_function_privilege('public',p.oid,'execute')
          or has_function_privilege('anon',p.oid,'execute')
          or not has_function_privilege('authenticated',p.oid,'execute'))) then
    raise exception 'P0_3D_P0_3C_FUNCTION_INVARIANT_INVALID';
  end if;
  if (select count(*) from unnest(array[
      to_regprocedure('public.get_my_device_aware_system_access(uuid)'),
      to_regprocedure('public.device_guarded_list_my_organizations(uuid)'),
      to_regprocedure('public.device_guarded_get_my_organization_access(uuid,uuid)'),
      to_regprocedure('public.device_guarded_list_organization_members(uuid,uuid)'),
      to_regprocedure('public.device_guarded_lookup_organization_candidate_by_email(uuid,uuid,text)'),
      to_regprocedure('public.device_guarded_get_my_conference_access(uuid,uuid)'),
      to_regprocedure('public.device_guarded_list_conference_members(uuid,uuid)'),
      to_regprocedure('public.device_guarded_lookup_conference_user_by_email(uuid,uuid,text)'),
      to_regprocedure('public.device_guarded_get_conference_lock(uuid,uuid)'),
      to_regprocedure('public.device_guarded_get_my_conference_membership(uuid,uuid)'),
      to_regprocedure('public.device_guarded_list_available_conferences(uuid)'),
      to_regprocedure('public.device_guarded_get_conference_snapshot_metadata(uuid,uuid)'),
      to_regprocedure('public.device_guarded_download_conference_snapshot(uuid,uuid)'),
      to_regprocedure('public.device_guarded_get_conference_creation_operation(uuid,uuid)'),
      to_regprocedure('public.device_guarded_get_sync_conflict(uuid,uuid)'),
      to_regprocedure('public.device_guarded_list_sync_conflicts(uuid,uuid,text,integer)'),
      to_regprocedure('public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)'),
      to_regprocedure('public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)'),
      to_regprocedure('public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)'),
      to_regprocedure('public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)'),
      to_regprocedure('public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)'),
      to_regprocedure('public.device_guarded_create_conference_idempotent(uuid,uuid,uuid,text,jsonb)'),
      to_regprocedure('public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)'),
      to_regprocedure('public.device_guarded_acquire_conference_lock(uuid,uuid,uuid,integer)'),
      to_regprocedure('public.device_guarded_renew_conference_lock(uuid,uuid,uuid,integer)'),
      to_regprocedure('public.device_guarded_release_conference_lock(uuid,uuid,uuid)'),
      to_regprocedure('public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)')
    ]::regprocedure[]) as expected(oid) where expected.oid is not null) <> 27 then
    raise exception 'P0_3D_P0_3C_EXACT_SIGNATURE_MISSING';
  end if;

  if (select count(*) from public.device_authorization_enforcement where singleton_id=1) <> 1
     or (select count(*) from public.device_authorization_enforcement where enforcement_enabled) <> 0 then
    raise exception 'P0_3D_ENFORCEMENT_MUST_REMAIN_DISABLED';
  end if;
  if (select count(*) from auth.users where id=trusted_user_id) <> 1
     or not exists (select 1 from auth.users where id=trusted_user_id and email=trusted_email) then
    raise exception 'P0_3D_TRUSTED_OWNER_IDENTITY_INVALID';
  end if;
  if not exists (select 1 from public.system_user_access
      where user_id=trusted_user_id and account_status='approved') then
    raise exception 'P0_3D_SYSTEM_ACCESS_APPROVED_REQUIRED';
  end if;
  if not exists (select 1 from public.organization_members as members
      where members.organization_id=trusted_organization_id and members.user_id=trusted_user_id
        and role='organization_owner') then
    raise exception 'P0_3D_ORGANIZATION_OWNER_REQUIRED';
  end if;
  if not exists (select 1 from public.devices
      where id=trusted_device_id and user_id=trusted_user_id) then
    raise exception 'P0_3D_TRUSTED_DEVICE_OWNERSHIP_INVALID';
  end if;

  -- Re-check mutable identity and ownership immediately before mutation/replay.
  if not exists (select 1 from auth.users where id=trusted_user_id and email=trusted_email)
     or not exists (select 1 from public.system_user_access where user_id=trusted_user_id and account_status='approved')
     or not exists (select 1 from public.organization_members where organization_id=trusted_organization_id
                    and user_id=trusted_user_id and role='organization_owner')
     or not exists (select 1 from public.devices where id=trusted_device_id and user_id=trusted_user_id)
     or (select count(*) from public.device_authorization_enforcement where singleton_id=1 and not enforcement_enabled) <> 1 then
    raise exception 'P0_3D_LOCKED_PRECONDITION_CHANGED';
  end if;
  if authorization_row.revoked_at is not null or authorization_row.revoked_by is not null
     or authorization_row.authorization_status='revoked' then
    raise exception 'P0_3D_REVOCATION_EVIDENCE_PRESENT';
  end if;

  select count(*) into matching_audit_count
  from public.device_authorization_audit_log a
  where a.action='device_authorization_bootstrapped'
    and a.actor_user_id=trusted_user_id and a.target_user_id=trusted_user_id
    and a.device_id=trusted_device_id and a.operation_id is null
    and a.old_values->>'authorizationStatus' in ('registered','pending')
    and a.new_values = jsonb_build_object(
      'authorizationStatus','approved','approvedBy',trusted_user_id,
      'trustedOwnerEmail',trusted_email,'organizationId',trusted_organization_id,
      'deviceId',trusted_device_id,'source','manual_trusted_owner_bootstrap');
  select count(*) into related_bootstrap_count
  from public.device_authorization_audit_log a
  where a.action='device_authorization_bootstrapped'
    and (a.target_user_id=trusted_user_id or a.device_id=trusted_device_id);

  if authorization_row.authorization_status in ('registered','pending') then
    if matching_audit_count<>0 or related_bootstrap_count<>0
       or exists (select 1 from public.user_device_authorizations
          where user_id=trusted_user_id and authorization_status='approved' and revoked_at is null) then
      raise exception 'P0_3D_CONFLICTING_APPROVAL_OR_AUDIT';
    end if;
    initial_status := authorization_row.authorization_status;
    update public.user_device_authorizations
       set authorization_status='approved', approved_at=now(), approved_by=trusted_user_id
     where user_id=trusted_user_id and device_id=trusted_device_id;
    insert into public.device_authorization_audit_log(
      actor_user_id,target_user_id,device_id,action,operation_id,old_values,new_values
    ) values (
      trusted_user_id,trusted_user_id,trusted_device_id,
      'device_authorization_bootstrapped',null,
      jsonb_build_object('authorizationStatus',initial_status),
      jsonb_build_object('authorizationStatus','approved','approvedBy',trusted_user_id,
        'trustedOwnerEmail',trusted_email,'organizationId',trusted_organization_id,
        'deviceId',trusted_device_id,'source','manual_trusted_owner_bootstrap')
    );
  elsif authorization_row.authorization_status='approved' then
    if authorization_row.approved_at is null or authorization_row.approved_by is distinct from trusted_user_id
       or matching_audit_count<>1 or related_bootstrap_count<>1
       or (select count(*) from public.user_device_authorizations where user_id=trusted_user_id
           and authorization_status='approved' and revoked_at is null)<>1 then
      raise exception 'P0_3D_IDEMPOTENT_EVIDENCE_INVALID';
    end if;
    -- Exact replay intentionally performs no write.
  else
    raise exception 'P0_3D_AUTHORIZATION_STATE_INVALID';
  end if;

  if (select count(*) from public.user_device_authorizations where user_id=trusted_user_id
      and device_id=trusted_device_id and authorization_status='approved'
      and revoked_at is null and revoked_by is null)<>1
     or (select count(*) from public.user_device_authorizations where user_id=trusted_user_id
         and authorization_status='approved' and revoked_at is null)<>1
     or (select count(*) from public.device_authorization_audit_log a
         where a.action='device_authorization_bootstrapped'
           and a.actor_user_id=trusted_user_id and a.target_user_id=trusted_user_id
           and a.device_id=trusted_device_id and a.operation_id is null
           and a.old_values->>'authorizationStatus' in ('registered','pending')
           and a.new_values=jsonb_build_object(
             'authorizationStatus','approved','approvedBy',trusted_user_id,
             'trustedOwnerEmail',trusted_email,'organizationId',trusted_organization_id,
             'deviceId',trusted_device_id,'source','manual_trusted_owner_bootstrap'))<>1
     or (select count(*) from public.device_authorization_audit_log a
         where a.action='device_authorization_bootstrapped'
           and (a.target_user_id=trusted_user_id or a.device_id=trusted_device_id))<>1
     or (select count(*) from public.device_authorization_enforcement where enforcement_enabled)<>0 then
    raise exception 'P0_3D_POSTCONDITION_INVALID';
  end if;
end;
$bootstrap$;

commit;
