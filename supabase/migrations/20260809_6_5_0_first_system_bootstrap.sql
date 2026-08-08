begin;

alter table public.organizations add column description text null;

create table public.system_bootstrap_state (
  singleton_id smallint primary key check (singleton_id=1),
  completed_at timestamptz null,
  completed_by uuid null references auth.users(id) on delete restrict,
  organization_id uuid null references public.organizations(id) on delete restrict,
  device_id uuid null references public.devices(id) on delete restrict,
  operation_id uuid null unique,
  intent_hash text null,
  stored_result jsonb null check (stored_result is null or jsonb_typeof(stored_result)='object'),
  check ((completed_at is null and completed_by is null and organization_id is null and device_id is null and operation_id is null and intent_hash is null and stored_result is null)
    or (completed_at is not null and completed_by is not null and organization_id is not null and device_id is not null and operation_id is not null and intent_hash is not null and stored_result is not null))
);
create table public.system_bootstrap_secret (
  singleton_id smallint primary key check (singleton_id=1),
  secret_hash text not null check (secret_hash like '$2%'),
  provisioned_at timestamptz not null default now()
);
alter table public.system_bootstrap_state enable row level security;
alter table public.system_bootstrap_secret enable row level security;
revoke all on public.system_bootstrap_state,public.system_bootstrap_secret from public,anon,authenticated;

insert into public.system_bootstrap_state(singleton_id) values(1);
do $$ declare owner_id uuid; org_id uuid; approved_device_id uuid; begin
  select user_id into owner_id from public.system_user_roles where role='system_owner' order by granted_at,user_id limit 1;
  select organization_id into org_id from public.organization_members where user_id=owner_id and role='organization_owner' order by created_at,organization_id limit 1;
  select device_id into approved_device_id from public.user_device_authorizations where user_id=owner_id and authorization_status='approved' and revoked_at is null order by approved_at nulls last,device_id limit 1;
  if owner_id is not null and org_id is not null and approved_device_id is not null then
    update public.system_bootstrap_state set completed_at=now(),completed_by=owner_id,organization_id=org_id,device_id=approved_device_id,operation_id=gen_random_uuid(),intent_hash='historical-existing-owner',stored_result='{"status":"historical_existing_owner"}'::jsonb where singleton_id=1;
  end if;
end $$;

create or replace function public.get_first_system_bootstrap_status()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select case
    when exists(select 1 from public.system_user_roles where role='system_owner') or exists(select 1 from public.system_bootstrap_state where singleton_id=1 and completed_at is not null)
      then jsonb_build_object('status','completed','setupRequired',false)
    when not exists(select 1 from public.system_bootstrap_secret where singleton_id=1)
      then jsonb_build_object('status','not_provisioned','setupRequired',false)
    else jsonb_build_object('status','setup_required','setupRequired',true)
  end;
$$;

create or replace function public.complete_first_system_bootstrap(p_setup_token text,p_organization_name text,p_organization_description text,p_device_id uuid,p_device_name text,p_device_platform text,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); state_row public.system_bootstrap_state%rowtype; secret_row public.system_bootstrap_secret%rowtype; org_id uuid:=gen_random_uuid(); normalized_name text:=btrim(coalesce(p_organization_name,'')); intent text; result jsonb;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_operation_id is null or p_device_id is null or normalized_name='' or length(normalized_name)>160 or length(coalesce(p_organization_description,''))>1000 then raise exception 'INVALID_BOOTSTRAP_REQUEST' using errcode='22023'; end if;
  intent:=encode(digest(actor_id::text||'|'||p_device_id::text||'|'||normalized_name||'|'||coalesce(p_organization_description,''),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('first-system-bootstrap',0));
  select * into state_row from public.system_bootstrap_state where singleton_id=1 for update;
  if state_row.completed_at is not null then
    if state_row.completed_by=actor_id and state_row.operation_id=p_operation_id and state_row.intent_hash=intent then return state_row.stored_result; end if;
    raise exception 'BOOTSTRAP_ALREADY_COMPLETED' using errcode='42501';
  end if;
  if exists(select 1 from public.system_user_roles where role='system_owner') then raise exception 'SYSTEM_OWNER_ALREADY_EXISTS' using errcode='42501'; end if;
  select * into secret_row from public.system_bootstrap_secret where singleton_id=1 for update;
  if not found or crypt(coalesce(p_setup_token,''),secret_row.secret_hash)<>secret_row.secret_hash then raise exception 'BOOTSTRAP_CREDENTIAL_INVALID' using errcode='42501'; end if;
  if not exists(select 1 from public.system_user_access where user_id=actor_id and account_status='pending') then raise exception 'PENDING_ACCOUNT_REQUIRED' using errcode='42501'; end if;
  insert into public.organizations(id,organization_key,display_name,description,is_default) values(org_id,'org-'||replace(org_id::text,'-',''),normalized_name,nullif(btrim(coalesce(p_organization_description,'')),''),false);
  update public.system_user_access set account_status='approved',can_create_conferences=true,approved_by=actor_id,approved_at=now(),blocked_by=null,blocked_at=null where user_id=actor_id;
  insert into public.system_user_roles(user_id,role,granted_by) values(actor_id,'system_owner',actor_id);
  insert into public.organization_members(organization_id,user_id,role) values(org_id,actor_id,'organization_owner');
  insert into public.devices(id,user_id,device_name,platform,last_seen_at) values(p_device_id,actor_id,nullif(btrim(coalesce(p_device_name,'')),''),nullif(btrim(coalesce(p_device_platform,'')),''),now());
  insert into public.user_device_authorizations(user_id,device_id,authorization_status,approved_at,approved_by,last_registered_at) values(actor_id,p_device_id,'approved',now(),actor_id,now());
  insert into public.system_access_audit_log(actor_user_id,target_user_id,action,new_values) values(actor_id,actor_id,'first_system_owner_bootstrapped',jsonb_build_object('organizationId',org_id,'deviceId',p_device_id));
  insert into public.organization_membership_audit_log(organization_id,actor_user_id,actor_user_id_snapshot,target_user_id,target_user_id_snapshot,action,operation_id,requested_role,resulting_role,outcome,metadata) values(org_id,actor_id,actor_id,actor_id,actor_id,'bootstrap_organization_owner',p_operation_id,'organization_owner','organization_owner','applied',jsonb_build_object('source','first_system_bootstrap'));
  insert into public.device_authorization_audit_log(actor_user_id,target_user_id,device_id,action,operation_id,new_values) values(actor_id,actor_id,p_device_id,'device_authorization_bootstrapped',p_operation_id,jsonb_build_object('source','first_system_bootstrap'));
  result:=jsonb_build_object('status','completed','organizationId',org_id,'deviceId',p_device_id,'operationId',p_operation_id);
  update public.system_bootstrap_state set completed_at=now(),completed_by=actor_id,organization_id=org_id,device_id=p_device_id,operation_id=p_operation_id,intent_hash=intent,stored_result=result where singleton_id=1;
  delete from public.system_bootstrap_secret where singleton_id=1;
  return result;
end;
$$;
revoke all on function public.get_first_system_bootstrap_status() from public,anon;
revoke all on function public.complete_first_system_bootstrap(text,text,text,uuid,text,text,uuid) from public,anon;
grant execute on function public.get_first_system_bootstrap_status() to authenticated;
grant execute on function public.complete_first_system_bootstrap(text,text,text,uuid,text,text,uuid) to authenticated;

commit;
