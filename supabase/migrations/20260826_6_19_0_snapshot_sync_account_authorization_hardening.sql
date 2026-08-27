begin;

-- Snapshot/Sync writes and system-access administration are authorization-plane
-- operations. Browser callers must use the existing approved-current-device
-- guarded functions; this migration does not redesign their operation models.

lock table public.conference_snapshots, public.sync_operations,
  public.sync_conflicts, public.conference_snapshot_guard_intents,
  public.system_user_access, public.system_access_audit_log,
  public.system_access_admin_operations in share mode;

create temporary table migration_6_19_0_data_baseline (
  relation text primary key,
  row_count bigint not null,
  fingerprint text not null
) on commit drop;

insert into migration_6_19_0_data_baseline(relation,row_count,fingerprint)
select 'conference_snapshots',count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.conference_id),''))
from public.conference_snapshots r
union all select 'sync_operations',count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),''))
from public.sync_operations r
union all select 'sync_conflicts',count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''))
from public.sync_conflicts r
union all select 'conference_snapshot_guard_intents',count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),''))
from public.conference_snapshot_guard_intents r
union all select 'system_user_access',count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.user_id),''))
from public.system_user_access r
union all select 'system_access_audit_log',count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),''))
from public.system_access_audit_log r
union all select 'system_access_admin_operations',count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),''))
from public.system_access_admin_operations r
union all select 'pg_auth_members',count(*)::bigint,
  md5(coalesce(string_agg(
    roleid::text||'|'||member::text||'|'||grantor::text||'|'||
    admin_option::text||'|'||inherit_option::text||'|'||set_option::text,
    E'\n' order by roleid,member,grantor),''))
from pg_auth_members;

do $$
declare
  latest record;
  guarded_snapshot regprocedure := to_regprocedure(
    'public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)');
  inner_snapshot regprocedure := to_regprocedure(
    'public.apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)');
  guarded_conflict regprocedure := to_regprocedure(
    'public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)');
  inner_conflict regprocedure := to_regprocedure(
    'public.resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)');
  guarded_account regprocedure := to_regprocedure(
    'public.device_guarded_manage_system_user(uuid,uuid,uuid,text,boolean)');
  unexpected_policy text;
  legacy_signature text;
  legacy_function regprocedure;
  unexpected_mutator text;
begin
  select version,name into latest from supabase_migrations.schema_migrations
   order by version desc limit 1;
  if latest.version is distinct from '20260826113408'
    or latest.name is distinct from 'conference_lifecycle_hardening_6_18_0' then
    raise exception 'EXPECTED_MIGRATION_6_18_0_IS_NOT_CURRENT';
  end if;

  if exists (
    select 1 from public.conference_members cm
    join public.conferences c on c.id=cm.conference_id
    left join public.organization_members om
      on om.organization_id=c.organization_id and om.user_id=cm.user_id
    where om.user_id is null
  ) then raise exception 'EXISTING_CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP'; end if;

  if exists (
    select 1 from public.conference_snapshots s
    left join public.devices d on d.id=s.updated_by_device_id
    where s.revision<1 or s.updated_by is null or s.updated_by_device_id is null
      or d.id is null or d.user_id<>s.updated_by
  ) or exists (
    select 1 from public.sync_operations o
    where o.operation_id is null or o.base_revision<0
      or (o.status in ('applied','conflict') and o.processed_at is null)
      or (o.status='applied' and o.resulting_revision is null)
  ) or exists (
    select 1 from public.sync_conflicts c
    left join public.sync_operations o on o.operation_id=c.operation_id
    where o.operation_id is null or o.conference_id<>c.conference_id
      or o.status<>'conflict' or c.expected_revision<0 or c.actual_revision<0
  ) or exists (
    select 1 from public.conference_snapshot_guard_intents i
    left join public.devices d on d.id=i.actor_device_id
    where d.id is null or d.user_id<>i.actor_user_id
      or i.operation_kind not in ('apply_snapshot','resolve_conflict')
  ) then raise exception 'INVALID_EXISTING_SNAPSHOT_SYNC_STATE'; end if;

  if guarded_snapshot is null
    or not has_function_privilege('authenticated',guarded_snapshot,'execute')
    or position('require_current_approved_device' in pg_get_functiondef(guarded_snapshot))=0
    or position('conference_snapshot_guard_intents' in pg_get_functiondef(guarded_snapshot))=0
    or position('apply_conference_snapshot' in pg_get_functiondef(guarded_snapshot))=0
    or inner_snapshot is null
    or has_function_privilege('authenticated',inner_snapshot,'execute')
    or position('sync_operations' in pg_get_functiondef(inner_snapshot))=0
    or position('sync_conflicts' in pg_get_functiondef(inner_snapshot))=0
    or position('base_revision' in pg_get_functiondef(inner_snapshot))=0 then
    raise exception 'GUARDED_SNAPSHOT_CONTRACT_INVALID';
  end if;

  if guarded_conflict is null
    or not has_function_privilege('authenticated',guarded_conflict,'execute')
    or position('require_current_approved_device' in pg_get_functiondef(guarded_conflict))=0
    or position('conference_snapshot_guard_intents' in pg_get_functiondef(guarded_conflict))=0
    or position('resolve_sync_conflict' in pg_get_functiondef(guarded_conflict))=0
    or inner_conflict is null
    or has_function_privilege('authenticated',inner_conflict,'execute')
    or position('sync_operations' in pg_get_functiondef(inner_conflict))=0
    or position('expected_revision' in pg_get_functiondef(inner_conflict))=0 then
    raise exception 'GUARDED_CONFLICT_CONTRACT_INVALID';
  end if;

  if guarded_account is null
    or not has_function_privilege('authenticated',guarded_account,'execute')
    or position('require_current_approved_device' in pg_get_functiondef(guarded_account))=0
    or position('is_system_owner' in pg_get_functiondef(guarded_account))=0
    or position('system_access_admin_operations' in pg_get_functiondef(guarded_account))=0
    or position('approve_system_user' in pg_get_functiondef(guarded_account))=0
    or position('block_system_user' in pg_get_functiondef(guarded_account))=0
    or position('unblock_system_user' in pg_get_functiondef(guarded_account))=0
    or position('set_user_conference_creation_permission' in pg_get_functiondef(guarded_account))=0 then
    raise exception 'GUARDED_ACCOUNT_ADMINISTRATION_CONTRACT_INVALID';
  end if;

  foreach legacy_signature in array array[
    'public.approve_system_user(uuid,boolean)',
    'public.block_system_user(uuid)',
    'public.unblock_system_user(uuid)',
    'public.set_user_conference_creation_permission(uuid,boolean)'
  ] loop
    legacy_function:=to_regprocedure(legacy_signature);
    if legacy_function is null
      or not has_function_privilege('authenticated',legacy_function,'execute')
      or has_function_privilege('anon',legacy_function,'execute') then
      raise exception 'LEGACY_ACCOUNT_FUNCTION_GRANT_DRIFT: %',legacy_signature;
    end if;
  end loop;

  select p.policyname into unexpected_policy from pg_policies p
   where p.schemaname='public'
     and p.tablename in ('conference_snapshots','sync_operations','sync_conflicts')
     and p.cmd in ('ALL','INSERT','UPDATE','DELETE')
     and p.roles && array['public','anon','authenticated']::name[]
     and p.policyname not in (
       'conference_snapshots_insert_manager','conference_snapshots_update_manager',
       'sync_operations_insert_manager')
   order by p.tablename,p.policyname limit 1;
  if unexpected_policy is not null then
    raise exception 'UNREVIEWED_SNAPSHOT_SYNC_WRITE_POLICY: %',unexpected_policy;
  end if;

  select p.oid::regprocedure::text into unexpected_mutator
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and pg_get_function_result(p.oid)<>'trigger'
    and (has_function_privilege('anon',p.oid,'execute')
      or has_function_privilege('authenticated',p.oid,'execute'))
    and (pg_get_functiondef(p.oid) ~* '(insert[[:space:][:print:]]*into|update|delete[[:space:]]+from)[[:space:]]+(public[.])?(conference_snapshots|sync_operations|sync_conflicts)'
      or pg_get_functiondef(p.oid) ~* 'public[.](apply_conference_snapshot|resolve_sync_conflict)[(]')
    and p.proname not in ('device_guarded_apply_conference_snapshot','device_guarded_resolve_sync_conflict')
  order by p.oid::regprocedure::text limit 1;
  if unexpected_mutator is not null then
    raise exception 'UNREVIEWED_SNAPSHOT_SYNC_MUTATOR: %',unexpected_mutator;
  end if;
end;
$$;

revoke insert,update,delete,truncate,references,trigger
  on table public.conference_snapshots,public.sync_operations,
    public.sync_conflicts
  from public,anon,authenticated;

drop policy if exists conference_snapshots_insert_manager
  on public.conference_snapshots;
drop policy if exists conference_snapshots_update_manager
  on public.conference_snapshots;
drop policy if exists sync_operations_insert_manager
  on public.sync_operations;

do $$
declare
  signature text;
  target regprocedure;
begin
  foreach signature in array array[
    'public.approve_system_user(uuid,boolean)',
    'public.block_system_user(uuid)',
    'public.unblock_system_user(uuid)',
    'public.set_user_conference_creation_permission(uuid,boolean)'
  ] loop
    target:=to_regprocedure(signature);
    if target is null then
      raise exception 'EXPECTED_LEGACY_ACCOUNT_FUNCTION_MISSING: %',signature;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated',
      target::text);
  end loop;
end;
$$;

do $$
declare
  guarded_snapshot regprocedure := to_regprocedure(
    'public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)');
  guarded_conflict regprocedure := to_regprocedure(
    'public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)');
  guarded_account regprocedure := to_regprocedure(
    'public.device_guarded_manage_system_user(uuid,uuid,uuid,text,boolean)');
  signature text;
  target regprocedure;
  bypass text;
  changed text;
begin
  if exists (
    select 1 from unnest(array['public','anon','authenticated']) r(role_name)
    cross join unnest(array['insert','update','delete','truncate','references','trigger']) p(privilege_name)
    cross join unnest(array['conference_snapshots','sync_operations','sync_conflicts']) t(table_name)
    where has_table_privilege(r.role_name,'public.'||t.table_name,p.privilege_name)
  ) then raise exception 'BROWSER_SNAPSHOT_SYNC_WRITE_PRIVILEGE_REMAINS'; end if;

  if exists (select 1 from pg_policies p where p.schemaname='public'
    and p.tablename in ('conference_snapshots','sync_operations','sync_conflicts')
    and p.cmd in ('ALL','INSERT','UPDATE','DELETE')
    and p.roles && array['public','anon','authenticated']::name[]) then
    raise exception 'BROWSER_SNAPSHOT_SYNC_WRITE_POLICY_REMAINS';
  end if;

  foreach signature in array array[
    'public.approve_system_user(uuid,boolean)','public.block_system_user(uuid)',
    'public.unblock_system_user(uuid)',
    'public.set_user_conference_creation_permission(uuid,boolean)'
  ] loop
    target:=to_regprocedure(signature);
    if has_function_privilege('public',target,'execute')
      or has_function_privilege('anon',target,'execute')
      or has_function_privilege('authenticated',target,'execute') then
      raise exception 'LEGACY_ACCOUNT_ADMIN_EXECUTE_REMAINS: %',signature;
    end if;
  end loop;

  if guarded_snapshot is null
    or not has_function_privilege('authenticated',guarded_snapshot,'execute')
    or position('require_current_approved_device' in pg_get_functiondef(guarded_snapshot))=0
    or position('conference_snapshot_guard_intents' in pg_get_functiondef(guarded_snapshot))=0
    or guarded_conflict is null
    or not has_function_privilege('authenticated',guarded_conflict,'execute')
    or position('require_current_approved_device' in pg_get_functiondef(guarded_conflict))=0
    or position('conference_snapshot_guard_intents' in pg_get_functiondef(guarded_conflict))=0 then
    raise exception 'GUARDED_SNAPSHOT_SYNC_ENTRY_POINT_INVALID';
  end if;

  if guarded_account is null
    or not has_function_privilege('authenticated',guarded_account,'execute')
    or position('require_current_approved_device' in pg_get_functiondef(guarded_account))=0
    or position('is_system_owner' in pg_get_functiondef(guarded_account))=0
    or position('system_access_admin_operations' in pg_get_functiondef(guarded_account))=0 then
    raise exception 'GUARDED_ACCOUNT_ADMINISTRATION_ENTRY_POINT_INVALID';
  end if;

  select p.oid::regprocedure::text into bypass
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and pg_get_function_result(p.oid)<>'trigger'
    and (has_function_privilege('anon',p.oid,'execute')
      or has_function_privilege('authenticated',p.oid,'execute'))
    and (pg_get_functiondef(p.oid) ~* '(insert[[:space:][:print:]]*into|update|delete[[:space:]]+from)[[:space:]]+(public[.])?(conference_snapshots|sync_operations|sync_conflicts)'
      or pg_get_functiondef(p.oid) ~* 'public[.](apply_conference_snapshot|resolve_sync_conflict)[(]')
    and p.proname not in ('device_guarded_apply_conference_snapshot',
      'device_guarded_resolve_sync_conflict')
  order by p.oid::regprocedure::text limit 1;
  if bypass is not null then
    raise exception 'UNGUARDED_SNAPSHOT_SYNC_MUTATOR_REMAINS: %',bypass;
  end if;

  with current_values as (
    select 'conference_snapshots' relation,count(*)::bigint row_count,
      md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.conference_id),'')) fingerprint from public.conference_snapshots r
    union all select 'sync_operations',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),'')) from public.sync_operations r
    union all select 'sync_conflicts',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),'')) from public.sync_conflicts r
    union all select 'conference_snapshot_guard_intents',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),'')) from public.conference_snapshot_guard_intents r
    union all select 'system_user_access',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.user_id),'')) from public.system_user_access r
    union all select 'system_access_audit_log',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),'')) from public.system_access_audit_log r
    union all select 'system_access_admin_operations',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),'')) from public.system_access_admin_operations r
    union all select 'pg_auth_members',count(*)::bigint,md5(coalesce(string_agg(roleid::text||'|'||member::text||'|'||grantor::text||'|'||admin_option::text||'|'||inherit_option::text||'|'||set_option::text,E'\n' order by roleid,member,grantor),'')) from pg_auth_members
  )
  select b.relation into changed from migration_6_19_0_data_baseline b
  join current_values c using(relation)
  where b.row_count<>c.row_count or b.fingerprint<>c.fingerprint
  order by b.relation limit 1;
  if changed is not null then
    raise exception 'MIGRATION_CHANGED_DATA_OR_HISTORY: %',changed;
  end if;
end;
$$;

commit;
