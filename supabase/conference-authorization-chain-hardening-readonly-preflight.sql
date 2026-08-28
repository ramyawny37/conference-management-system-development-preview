-- Read-only readiness check for Migration 6.17.0. Expected browser bypasses
-- are reported for removal by the migration; unknown surfaces fail closed.
begin transaction read only;

do $$
declare
  unexpected_policy text;
  unexpected_mutator text;
begin
  if exists (
    select 1
      from public.conference_members as conference_members
      join public.conferences as conferences
        on conferences.id = conference_members.conference_id
      left join public.organization_members as organization_members
        on organization_members.organization_id = conferences.organization_id
       and organization_members.user_id = conference_members.user_id
     where conferences.organization_id is null
        or organization_members.user_id is null
  ) then
    raise exception 'EXISTING_CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP';
  end if;

  select policies.policyname into unexpected_policy
    from pg_policies as policies
   where policies.schemaname = 'public'
     and policies.tablename = 'conference_members'
     and policies.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
     and policies.roles && array['public', 'anon', 'authenticated']::name[]
     and policies.policyname not in (
       'conference_members_insert_owner',
       'conference_members_update_owner',
       'conference_members_delete_owner'
     )
   order by policies.policyname limit 1;
  if unexpected_policy is not null then
    raise exception 'UNREVIEWED_CONFERENCE_MEMBERS_WRITE_POLICY: %',
      unexpected_policy;
  end if;

  select format('%I.%I(%s)', namespaces.nspname, functions.proname,
      pg_get_function_identity_arguments(functions.oid))
    into unexpected_mutator
    from pg_proc as functions
    join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
   where namespaces.nspname = 'public'
     and functions.prokind = 'f'
     and pg_get_function_result(functions.oid) <> 'trigger'
     and (
       pg_get_functiondef(functions.oid) ~*
         '(insert[[:space:][:print:]]*into|update|delete[[:space:]]+from)[[:space:]]+public[.]conference_members'
       or pg_get_functiondef(functions.oid) ~*
         'public[.](manage_conference_member|add_conference_manager|remove_conference_manager)[(]'
     )
     and has_function_privilege('authenticated', functions.oid, 'execute')
     and functions.proname not in (
       'manage_conference_member',
       'add_conference_manager',
       'remove_conference_manager',
       'device_guarded_manage_conference_member',
       'device_guarded_add_conference_manager',
       'device_guarded_remove_conference_manager'
     )
   order by functions.proname limit 1;
  if unexpected_mutator is not null then
    raise exception 'UNREVIEWED_CONFERENCE_MEMBERS_MUTATOR: %',
      unexpected_mutator;
  end if;
end;
$$;

do $$
declare
  mapping record;
  legacy_function regprocedure;
  guarded_function regprocedure;
begin
  for mapping in
    select * from (values
      ('public.manage_organization_member(uuid,uuid,uuid,text,text)', null),
      ('public.add_organization_member(uuid,uuid,uuid)',
       'public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)'),
      ('public.remove_organization_member(uuid,uuid,uuid)',
       'public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)'),
      ('public.change_organization_role(uuid,uuid,text,uuid)',
       'public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)'),
      ('public.manage_conference_member(uuid,uuid,uuid,text,text)',
       'public.device_guarded_manage_conference_member(uuid,uuid,uuid,uuid,text,text)'),
      ('public.add_conference_manager(uuid,uuid,uuid)',
       'public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)'),
      ('public.remove_conference_manager(uuid,uuid,uuid)',
       'public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)')
    ) as mappings(legacy_signature, guarded_signature)
  loop
    legacy_function := to_regprocedure(mapping.legacy_signature);
    if legacy_function is null or not has_function_privilege(
      'authenticated', legacy_function, 'execute'
    ) then
      continue;
    end if;
    if mapping.guarded_signature is null then
      raise exception
        'BROWSER_EXECUTABLE_LEGACY_FUNCTION_HAS_NO_GUARDED_PATH: %',
        mapping.legacy_signature;
    end if;
    guarded_function := to_regprocedure(mapping.guarded_signature);
    if guarded_function is null or not has_function_privilege(
      'authenticated', guarded_function, 'execute'
    ) then
      raise exception 'REQUIRED_GUARDED_MEMBERSHIP_RPC_UNAVAILABLE: %',
        mapping.guarded_signature;
    end if;
    if position(
      'require_current_approved_device' in
      pg_get_functiondef(guarded_function)
    ) = 0 then
      raise exception 'REQUIRED_GUARDED_MEMBERSHIP_RPC_IS_NOT_DEVICE_GUARDED: %',
        mapping.guarded_signature;
    end if;
  end loop;
end;
$$;

with function_mapping(legacy_signature, guarded_signature) as (values
  ('public.manage_organization_member(uuid,uuid,uuid,text,text)', null),
  ('public.add_organization_member(uuid,uuid,uuid)',
   'public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)'),
  ('public.remove_organization_member(uuid,uuid,uuid)',
   'public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)'),
  ('public.change_organization_role(uuid,uuid,text,uuid)',
   'public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)'),
  ('public.manage_conference_member(uuid,uuid,uuid,text,text)',
   'public.device_guarded_manage_conference_member(uuid,uuid,uuid,uuid,text,text)'),
  ('public.add_conference_manager(uuid,uuid,uuid)',
   'public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)'),
  ('public.remove_conference_manager(uuid,uuid,uuid)',
   'public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)')
)
select legacy_signature,
  to_regprocedure(legacy_signature) is not null as legacy_exists,
  case when to_regprocedure(legacy_signature) is null then null else
    has_function_privilege('anon', to_regprocedure(legacy_signature), 'execute')
  end as anon_legacy_execute,
  case when to_regprocedure(legacy_signature) is null then null else
    has_function_privilege(
      'authenticated', to_regprocedure(legacy_signature), 'execute')
  end as authenticated_legacy_execute,
  guarded_signature,
  to_regprocedure(guarded_signature) is not null as guarded_exists,
  case when guarded_signature is null
      or to_regprocedure(guarded_signature) is null then null else
    has_function_privilege(
      'authenticated', to_regprocedure(guarded_signature), 'execute')
  end as authenticated_guarded_execute
from function_mapping
order by legacy_signature;

select
  has_table_privilege('anon', 'public.conference_members', 'insert')
    as anon_insert,
  has_table_privilege('anon', 'public.conference_members', 'update')
    as anon_update,
  has_table_privilege('anon', 'public.conference_members', 'delete')
    as anon_delete,
  has_table_privilege('anon', 'public.conference_members', 'truncate')
    as anon_truncate,
  has_table_privilege('authenticated', 'public.conference_members', 'insert')
    as authenticated_insert,
  has_table_privilege('authenticated', 'public.conference_members', 'update')
    as authenticated_update,
  has_table_privilege('authenticated', 'public.conference_members', 'delete')
    as authenticated_delete,
  has_table_privilege('authenticated', 'public.conference_members', 'truncate')
    as authenticated_truncate;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'conference_members'
order by policyname;

select count(*)::bigint as organization_conference_membership_gap_count
from public.conference_members as conference_members
join public.conferences as conferences
  on conferences.id = conference_members.conference_id
left join public.organization_members as organization_members
  on organization_members.organization_id = conferences.organization_id
 and organization_members.user_id = conference_members.user_id
where conferences.organization_id is null
   or organization_members.user_id is null;

select
  count(*)::bigint as organization_member_count,
  md5(coalesce(string_agg(
    organization_id::text||'|'||user_id::text||'|'||role,
    E'\n' order by organization_id,user_id
  ),'')) as organization_member_fingerprint
from public.organization_members;

select
  count(*)::bigint as conference_member_count,
  md5(coalesce(string_agg(
    conference_id::text||'|'||user_id::text||'|'||role,
    E'\n' order by conference_id,user_id
  ),'')) as conference_member_fingerprint
from public.conference_members;

select md5(coalesce(string_agg(
  roleid::text||'|'||member::text||'|'||grantor::text||'|'||
  admin_option::text||'|'||inherit_option::text||'|'||set_option::text,
  E'\n' order by roleid,member,grantor
),'')) as role_membership_fingerprint
from pg_auth_members;

commit;
