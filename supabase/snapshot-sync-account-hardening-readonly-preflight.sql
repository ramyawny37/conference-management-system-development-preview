-- Project identity gate: execute only through the configured Development MCP
-- whose verified URL is https://gppwltrifgfxrkzvvxoe.supabase.co.
-- PostgreSQL does not expose the Supabase project ref as a server setting.
begin transaction read only;

do $$
declare
  latest record;
  gs regprocedure:=to_regprocedure('public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)');
  isf regprocedure:=to_regprocedure('public.apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)');
  gc regprocedure:=to_regprocedure('public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)');
  ic regprocedure:=to_regprocedure('public.resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)');
  ga regprocedure:=to_regprocedure('public.device_guarded_manage_system_user(uuid,uuid,uuid,text,boolean)');
  unexpected text;
  legacy_signature text; legacy_function regprocedure; unexpected_mutator text;
begin
  select version,name,md5(array_to_string(statements,E'\n')) content_md5
    into latest from supabase_migrations.schema_migrations
   order by version desc limit 1;
  if latest.name is distinct from 'conference_lifecycle_hardening_6_18_0'
    or latest.content_md5 is distinct from
      '699f1bf58271c8c75d6026ebc0436b28' then
    raise exception 'EXPECTED_MIGRATION_6_18_0_IS_NOT_CURRENT';
  end if;
  if exists(select 1 from public.conference_members cm join public.conferences c on c.id=cm.conference_id left join public.organization_members om on om.organization_id=c.organization_id and om.user_id=cm.user_id where om.user_id is null) then
    raise exception 'EXISTING_CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP';
  end if;
  if exists(select 1 from public.conference_snapshots s left join public.devices d on d.id=s.updated_by_device_id where s.revision<1 or s.updated_by is null or s.updated_by_device_id is null or d.id is null or d.user_id<>s.updated_by)
    or exists(select 1 from public.sync_operations o where o.operation_id is null or o.base_revision<0 or (o.status in ('applied','conflict') and o.processed_at is null) or (o.status='applied' and o.resulting_revision is null))
    or exists(select 1 from public.sync_conflicts c left join public.sync_operations o on o.operation_id=c.operation_id where o.operation_id is null or o.conference_id<>c.conference_id or o.status<>'conflict' or c.expected_revision<0 or c.actual_revision<0)
    or exists(select 1 from public.conference_snapshot_guard_intents i left join public.devices d on d.id=i.actor_device_id where d.id is null or d.user_id<>i.actor_user_id or i.operation_kind not in ('apply_snapshot','resolve_conflict')) then
    raise exception 'INVALID_EXISTING_SNAPSHOT_SYNC_STATE';
  end if;
  if gs is null or not has_function_privilege('authenticated',gs,'execute') or position('require_current_approved_device' in pg_get_functiondef(gs))=0 or position('conference_snapshot_guard_intents' in pg_get_functiondef(gs))=0 or position('apply_conference_snapshot' in pg_get_functiondef(gs))=0 or isf is null or has_function_privilege('authenticated',isf,'execute') or position('sync_operations' in pg_get_functiondef(isf))=0 or position('sync_conflicts' in pg_get_functiondef(isf))=0 or position('base_revision' in pg_get_functiondef(isf))=0 then
    raise exception 'GUARDED_SNAPSHOT_CONTRACT_INVALID';
  end if;
  if gc is null or not has_function_privilege('authenticated',gc,'execute') or position('require_current_approved_device' in pg_get_functiondef(gc))=0 or position('conference_snapshot_guard_intents' in pg_get_functiondef(gc))=0 or position('resolve_sync_conflict' in pg_get_functiondef(gc))=0 or ic is null or has_function_privilege('authenticated',ic,'execute') or position('sync_operations' in pg_get_functiondef(ic))=0 or position('expected_revision' in pg_get_functiondef(ic))=0 then
    raise exception 'GUARDED_CONFLICT_CONTRACT_INVALID';
  end if;
  if ga is null or not has_function_privilege('authenticated',ga,'execute') or position('require_current_approved_device' in pg_get_functiondef(ga))=0 or position('is_system_owner' in pg_get_functiondef(ga))=0 or position('system_access_admin_operations' in pg_get_functiondef(ga))=0 or position('approve_system_user' in pg_get_functiondef(ga))=0 or position('block_system_user' in pg_get_functiondef(ga))=0 or position('unblock_system_user' in pg_get_functiondef(ga))=0 or position('set_user_conference_creation_permission' in pg_get_functiondef(ga))=0 then
    raise exception 'GUARDED_ACCOUNT_ADMINISTRATION_CONTRACT_INVALID';
  end if;
  foreach legacy_signature in array array['public.approve_system_user(uuid,boolean)','public.block_system_user(uuid)','public.unblock_system_user(uuid)','public.set_user_conference_creation_permission(uuid,boolean)'] loop
    legacy_function:=to_regprocedure(legacy_signature);
    if legacy_function is null or not has_function_privilege('authenticated',legacy_function,'execute') or has_function_privilege('anon',legacy_function,'execute') then raise exception 'LEGACY_ACCOUNT_FUNCTION_GRANT_DRIFT: %',legacy_signature; end if;
  end loop;
  select p.policyname into unexpected from pg_policies p where p.schemaname='public' and p.tablename in ('conference_snapshots','sync_operations','sync_conflicts') and p.cmd in ('ALL','INSERT','UPDATE','DELETE') and p.roles && array['public','anon','authenticated']::name[] and p.policyname not in ('conference_snapshots_insert_manager','conference_snapshots_update_manager','sync_operations_insert_manager') order by p.tablename,p.policyname limit 1;
  if unexpected is not null then raise exception 'UNREVIEWED_SNAPSHOT_SYNC_WRITE_POLICY: %',unexpected; end if;
  select p.oid::regprocedure::text into unexpected_mutator from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and pg_get_function_result(p.oid)<>'trigger' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')) and (pg_get_functiondef(p.oid) ~* '(insert[[:space:][:print:]]*into|update|delete[[:space:]]+from)[[:space:]]+(public[.])?(conference_snapshots|sync_operations|sync_conflicts)' or pg_get_functiondef(p.oid) ~* 'public[.](apply_conference_snapshot|resolve_sync_conflict)[(]') and p.proname not in ('device_guarded_apply_conference_snapshot','device_guarded_resolve_sync_conflict') order by p.oid::regprocedure::text limit 1;
  if unexpected_mutator is not null then raise exception 'UNREVIEWED_SNAPSHOT_SYNC_MUTATOR: %',unexpected_mutator; end if;
end;
$$;

select current_database() database_name,current_user database_identity,
  'gppwltrifgfxrkzvvxoe'::text expected_development_project_ref,
  (select jsonb_build_object('version',version,'name',name) from supabase_migrations.schema_migrations order by version desc limit 1) current_migration;

select t.table_name,r.role_name,
  has_table_privilege(r.role_name,'public.'||t.table_name,'select') can_select,
  has_table_privilege(r.role_name,'public.'||t.table_name,'insert') can_insert,
  has_table_privilege(r.role_name,'public.'||t.table_name,'update') can_update,
  has_table_privilege(r.role_name,'public.'||t.table_name,'delete') can_delete,
  has_table_privilege(r.role_name,'public.'||t.table_name,'truncate') can_truncate,
  has_table_privilege(r.role_name,'public.'||t.table_name,'references') can_reference,
  has_table_privilege(r.role_name,'public.'||t.table_name,'trigger') can_trigger
from (values('conference_snapshots'),('sync_operations'),('sync_conflicts')) t(table_name)
cross join (values('public'),('anon'),('authenticated')) r(role_name)
order by t.table_name,r.role_name;

select policyname,tablename,cmd,roles,qual,with_check from pg_policies
where schemaname='public' and tablename in ('conference_snapshots','sync_operations','sync_conflicts')
order by tablename,policyname;

select p.oid::regprocedure::text signature,
  has_function_privilege('public',p.oid,'execute') public_execute,
  has_function_privilege('anon',p.oid,'execute') anon_execute,
  has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
  position('require_current_approved_device' in pg_get_functiondef(p.oid))>0 device_guarded
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('apply_conference_snapshot','resolve_sync_conflict','device_guarded_apply_conference_snapshot','device_guarded_resolve_sync_conflict','approve_system_user','block_system_user','unblock_system_user','set_user_conference_creation_permission','device_guarded_manage_system_user')
order by signature;

select 'conference_snapshots' relation,count(*)::bigint row_count,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.conference_id),'')) fingerprint from public.conference_snapshots r
union all select 'sync_operations',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),'')) from public.sync_operations r
union all select 'sync_conflicts',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),'')) from public.sync_conflicts r
union all select 'conference_snapshot_guard_intents',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),'')) from public.conference_snapshot_guard_intents r
union all select 'system_user_access',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.user_id),'')) from public.system_user_access r
union all select 'system_access_audit_log',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),'')) from public.system_access_audit_log r
union all select 'system_access_admin_operations',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),'')) from public.system_access_admin_operations r
order by relation;

select md5(coalesce(string_agg(roleid::text||'|'||member::text||'|'||grantor::text||'|'||admin_option::text||'|'||inherit_option::text||'|'||set_option::text,E'\n' order by roleid,member,grantor),'')) role_membership_fingerprint from pg_auth_members;
commit;
