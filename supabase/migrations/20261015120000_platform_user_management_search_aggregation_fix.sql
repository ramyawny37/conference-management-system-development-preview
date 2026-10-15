create or replace function public.search_user_management_users(p_actor_device_id uuid,p_query text default null,p_account_status text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare actor_id uuid; normalized_query text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_query,''))); effective_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
 actor_id:=public.require_current_approved_device(p_actor_device_id);
 if not public.is_system_owner(actor_id) then raise exception 'USER_MANAGEMENT_SCOPE_DENIED' using errcode='42501'; end if;
 if p_account_status is not null and p_account_status not in('pending','approved','blocked') then raise exception 'INVALID_ACCOUNT_STATUS' using errcode='22023'; end if;
 return pg_catalog.jsonb_build_object('status','success','capabilities',public.get_user_management_actor_capabilities(p_actor_device_id)-'status','users',coalesce((
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('userId',ordered.id,'displayName',ordered.display_name,'email',ordered.email,'accountStatus',ordered.account_status,'deviceCount',platform_private.canonical_device_count(ordered.id)) order by ordered.sort_name,ordered.id)
  from (
   select u.id,p.display_name,u.email,p.account_status,coalesce(p.display_name,u.email) as sort_name
   from auth.users u join platform.profiles p on p.user_id=u.id
   where (p_account_status is null or p.account_status=p.account_status)
     and (normalized_query='' or pg_catalog.lower(coalesce(p.display_name,'')) like '%'||normalized_query||'%' or pg_catalog.lower(coalesce(u.email,'')) like '%'||normalized_query||'%')
   order by coalesce(p.display_name,u.email),u.id limit effective_limit
  ) ordered
 ),'[]'::jsonb));
end $$;