-- Keep device authorization reads behind a narrowly scoped service-only RPC.
create or replace function platform.get_device_enrollment_device_status(p_user_id uuid,p_device_id uuid)
returns jsonb language sql stable security definer
set search_path to 'pg_catalog','platform'
as $fn$
  select coalesce((
    select jsonb_build_object('known',true,'status',uda.status,'revoked',uda.revoked_at is not null)
    from platform.user_device_authorizations uda
    where uda.user_id=p_user_id and uda.device_id=p_device_id
    order by uda.created_at desc limit 1
  ),jsonb_build_object('known',false,'status','missing','revoked',false));
$fn$;
revoke all on function platform.get_device_enrollment_device_status(uuid,uuid) from public,anon,authenticated;
grant execute on function platform.get_device_enrollment_device_status(uuid,uuid) to service_role;
