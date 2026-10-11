-- Align canonical conference creation with the single platform permission authority.
create or replace function public.create_canonical_conference(
  p_actor_device_id uuid,
  p_operation_id uuid,
  p_requested_conference_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_context jsonb;
  v_actor uuid;
  v_device_authorization_id uuid;
  v_name text:=btrim(coalesce(p_name,''));
  v_intent jsonb;
  v_prior public.conference_creation_operations%rowtype;
  v_permission text;
  v_grant_ids jsonb:='{}'::jsonb;
  v_grant_id uuid;
  v_result jsonb;
begin
  if p_operation_id is null or p_requested_conference_id is null
     or v_name='' or char_length(v_name)>500
     or p_start_date is null or p_end_date is null or p_end_date<p_start_date then
    raise exception 'CANONICAL_CONFERENCE_CREATE_ARGUMENT_INVALID' using errcode='22023';
  end if;

  v_context:=public.require_effective_module_permission(
    p_actor_device_id,'conference','conference.lifecycle.create',null,null
  );
  v_actor:=(v_context->>'actorUserId')::uuid;
  v_device_authorization_id:=platform_private.validated_phase1c_device_authorization(
    v_actor,p_actor_device_id
  );
  if v_device_authorization_id is null then
    raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501';
  end if;

  v_intent:=jsonb_build_object(
    'contract','final-canonical-conference-create-v1',
    'conferenceId',p_requested_conference_id,
    'name',v_name,'startDate',p_start_date,'endDate',p_end_date
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text||':conference-create:'||p_operation_id::text,0)
  );
  select operations.* into v_prior
  from public.conference_creation_operations operations
  where operations.user_id=v_actor and operations.operation_id=p_operation_id;
  if found then
    if v_prior.conference_id<>p_requested_conference_id
       or v_prior.initial_metadata<>v_intent then
      raise exception 'CANONICAL_CONFERENCE_CREATE_OPERATION_MISMATCH' using errcode='22023';
    end if;
    if not exists(
      select 1 from public.conferences conference
      where conference.id=p_requested_conference_id and conference.deleted_at is null
    ) or exists(
      select 1 from (values('conference.access.view'),('conference.lifecycle.manage')) expected(permission_key)
      where not exists(
        select 1 from platform.permission_grants grants
        join platform.permissions permission on permission.id=grants.permission_id
        where grants.user_id=v_actor and permission.code=expected.permission_key
          and permission.status='active' and grants.scope_type='resource'
          and grants.resource_type='conference'
          and grants.resource_id=p_requested_conference_id::text
          and grants.revoked_at is null
      )
    ) then
      raise exception 'CANONICAL_CONFERENCE_CREATE_REPLAY_STATE_INVALID' using errcode='55000';
    end if;
    return jsonb_build_object(
      'status','duplicate','operationId',p_operation_id,
      'conferenceId',p_requested_conference_id,
      'name',v_name,'startDate',p_start_date,'endDate',p_end_date,
      'conferenceStatus','active','completedAt',null,'revision',1,'created',false
    );
  end if;

  if exists(select 1 from public.conferences where id=p_requested_conference_id) then
    raise exception 'CONFERENCE_ID_ALREADY_USED' using errcode='23505';
  end if;

  insert into public.conferences(
    id,name,owner_id,start_date,end_date,status,
    completed_at,revision,updated_by
  ) values(
    p_requested_conference_id,v_name,v_actor,
    p_start_date,p_end_date,'active',null,1,v_actor
  );

  insert into public.conference_creation_operations(
    user_id,operation_id,conference_id,initial_metadata
  ) values(v_actor,p_operation_id,p_requested_conference_id,v_intent);

  foreach v_permission in array array[
    'conference.access.view','conference.lifecycle.manage'
  ] loop
    insert into platform.permission_grants(
      user_id,permission_id,scope_type,resource_type,resource_id,
      granted_by,metadata
    )
    select v_actor,permission.id,'resource','conference',
      p_requested_conference_id::text,v_actor,
      jsonb_build_object('actorDeviceId',p_actor_device_id)
    from platform.permissions permission
    where permission.code=v_permission and permission.status='active'
      and permission.allowed_scope_mode='resource'
      and permission.allowed_resource_type='conference'
    returning id into v_grant_id;
    if v_grant_id is null then
      raise exception 'CANONICAL_CONFERENCE_CREATOR_PERMISSION_MISSING' using errcode='55000';
    end if;
    v_grant_ids:=v_grant_ids||jsonb_build_object(v_permission,v_grant_id);
  end loop;

  v_result:=jsonb_build_object(
    'status','created','operationId',p_operation_id,
    'conferenceId',p_requested_conference_id,
    'name',v_name,'startDate',p_start_date,'endDate',p_end_date,
    'conferenceStatus','active','completedAt',null,'revision',1,'created',true
  );
  insert into platform.audit_events(
    actor_user_id,actor_device_authorization_id,subject_user_id,
    domain,module,action,entity_type,entity_id,scope_type,scope_id,
    old_values,new_values,metadata,operation_id,source
  ) values(
    v_actor,v_device_authorization_id,null,
    'platform','conference','conference.lifecycle.created',
    'conference',p_requested_conference_id,'platform',null,
    null,jsonb_build_object(
      'name',v_name,'startDate',p_start_date,'endDate',p_end_date,
      'status','active','completedAt',null,'revision',1
    ),jsonb_build_object(
      'permissionKey','conference.lifecycle.create',
      'authoritySource',v_context->>'authoritySource',
      'authorityGrantId',v_context->'grantId',
      'creatorResourceGrants',v_grant_ids,'deviceId',p_actor_device_id
    ),p_operation_id,'rpc'
  );
  return v_result;
end $$;
