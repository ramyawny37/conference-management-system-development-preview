begin transaction read only;
do $$
declare
  gs regprocedure:=to_regprocedure('public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)');
  gc regprocedure:=to_regprocedure('public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)');
  ga regprocedure:=to_regprocedure('public.device_guarded_manage_system_user(uuid,uuid,uuid,text,boolean)');
  signature text; target regprocedure; bypass text;
begin
  if exists(select 1 from unnest(array['public','anon','authenticated']) r(role_name) cross join unnest(array['insert','update','delete','truncate','references','trigger']) p(privilege_name) cross join unnest(array['conference_snapshots','sync_operations','sync_conflicts']) t(table_name) where has_table_privilege(r.role_name,'public.'||t.table_name,p.privilege_name)) then raise exception 'BROWSER_SNAPSHOT_SYNC_WRITE_PRIVILEGE_REMAINS'; end if;
  if exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename in ('conference_snapshots','sync_operations','sync_conflicts') and p.cmd in ('ALL','INSERT','UPDATE','DELETE') and p.roles && array['public','anon','authenticated']::name[]) then raise exception 'BROWSER_SNAPSHOT_SYNC_WRITE_POLICY_REMAINS'; end if;
  foreach signature in array array['public.approve_system_user(uuid,boolean)','public.block_system_user(uuid)','public.unblock_system_user(uuid)','public.set_user_conference_creation_permission(uuid,boolean)'] loop
    target:=to_regprocedure(signature);
    if target is null or has_function_privilege('public',target,'execute') or has_function_privilege('anon',target,'execute') or has_function_privilege('authenticated',target,'execute') then raise exception 'LEGACY_ACCOUNT_ADMIN_EXECUTE_REMAINS: %',signature; end if;
  end loop;
  if gs is null or not has_function_privilege('authenticated',gs,'execute') or position('require_current_approved_device' in pg_get_functiondef(gs))=0 or position('conference_snapshot_guard_intents' in pg_get_functiondef(gs))=0 or position('apply_conference_snapshot' in pg_get_functiondef(gs))=0 or gc is null or not has_function_privilege('authenticated',gc,'execute') or position('require_current_approved_device' in pg_get_functiondef(gc))=0 or position('conference_snapshot_guard_intents' in pg_get_functiondef(gc))=0 or position('resolve_sync_conflict' in pg_get_functiondef(gc))=0 then raise exception 'GUARDED_SNAPSHOT_SYNC_ENTRY_POINT_INVALID'; end if;
  if ga is null or not has_function_privilege('authenticated',ga,'execute') or position('require_current_approved_device' in pg_get_functiondef(ga))=0 or position('is_system_owner' in pg_get_functiondef(ga))=0 or position('system_access_admin_operations' in pg_get_functiondef(ga))=0 then raise exception 'GUARDED_ACCOUNT_ADMINISTRATION_ENTRY_POINT_INVALID'; end if;
  select p.oid::regprocedure::text into bypass from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and pg_get_function_result(p.oid)<>'trigger' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')) and (pg_get_functiondef(p.oid) ~* '(insert[[:space:][:print:]]*into|update|delete[[:space:]]+from)[[:space:]]+(public[.])?(conference_snapshots|sync_operations|sync_conflicts)' or pg_get_functiondef(p.oid) ~* 'public[.](apply_conference_snapshot|resolve_sync_conflict)[(]') and p.proname not in ('device_guarded_apply_conference_snapshot','device_guarded_resolve_sync_conflict') order by p.oid::regprocedure::text limit 1;
  if bypass is not null then raise exception 'UNGUARDED_SNAPSHOT_SYNC_MUTATOR_REMAINS: %',bypass; end if;
  if exists(select 1 from public.conference_members cm join public.conferences c on c.id=cm.conference_id left join public.organization_members om on om.organization_id=c.organization_id and om.user_id=cm.user_id where om.user_id is null) then raise exception 'CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP_REMAINS'; end if;
end;
$$;

select t.table_name,r.role_name,has_table_privilege(r.role_name,'public.'||t.table_name,'select') can_select,
  has_table_privilege(r.role_name,'public.'||t.table_name,'insert') or has_table_privilege(r.role_name,'public.'||t.table_name,'update') or has_table_privilege(r.role_name,'public.'||t.table_name,'delete') or has_table_privilege(r.role_name,'public.'||t.table_name,'truncate') or has_table_privilege(r.role_name,'public.'||t.table_name,'references') or has_table_privilege(r.role_name,'public.'||t.table_name,'trigger') any_write
from (values('conference_snapshots'),('sync_operations'),('sync_conflicts')) t(table_name) cross join (values('public'),('anon'),('authenticated')) r(role_name) order by t.table_name,r.role_name;

select 'conference_snapshots' relation,count(*)::bigint row_count,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.conference_id),'')) fingerprint from public.conference_snapshots r
union all select 'sync_operations',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),'')) from public.sync_operations r
union all select 'sync_conflicts',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),'')) from public.sync_conflicts r
union all select 'conference_snapshot_guard_intents',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),'')) from public.conference_snapshot_guard_intents r
union all select 'system_user_access',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.user_id),'')) from public.system_user_access r
union all select 'system_access_audit_log',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),'')) from public.system_access_audit_log r
union all select 'system_access_admin_operations',count(*)::bigint,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.operation_id),'')) from public.system_access_admin_operations r order by relation;
select count(*)::bigint organization_conference_membership_gap_count from public.conference_members cm join public.conferences c on c.id=cm.conference_id left join public.organization_members om on om.organization_id=c.organization_id and om.user_id=cm.user_id where om.user_id is null;
select md5(coalesce(string_agg(roleid::text||'|'||member::text||'|'||grantor::text||'|'||admin_option::text||'|'||inherit_option::text||'|'||set_option::text,E'\n' order by roleid,member,grantor),'')) role_membership_fingerprint from pg_auth_members;
commit;
