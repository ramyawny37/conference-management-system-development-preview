begin;

do $$
declare
  owner_id uuid;
  owner_device_id uuid;
  manager_id uuid;
  manager_device_id uuid;
  test_conference_id uuid;
  snapshot_data jsonb;
  current_revision bigint;
  operation_id uuid;
  response jsonb;
begin
  if has_function_privilege(
      'authenticated',
      'public.apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)',
      'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)',
      'execute'
    ) then
    raise exception 'UNSAFE_SNAPSHOT_RPC_EXECUTE_REMAINS';
  end if;

  select conferences.owner_id, authorizations.device_id,
         conferences.id, snapshots.data, snapshots.revision
    into owner_id, owner_device_id, test_conference_id,
         snapshot_data, current_revision
    from public.conferences as conferences
    join public.conference_snapshots as snapshots
      on snapshots.conference_id = conferences.id
    join public.system_user_access as access
      on access.user_id = conferences.owner_id
     and access.account_status = 'approved'
    join public.user_device_authorizations as authorizations
      on authorizations.user_id = conferences.owner_id
     and authorizations.authorization_status = 'approved'
     and authorizations.revoked_at is null
   order by snapshots.updated_at desc
   limit 1;
  if owner_id is null then
    raise exception 'DEVELOPMENT_OWNER_FIXTURE_MISSING';
  end if;

  select access.user_id, authorizations.device_id
    into manager_id, manager_device_id
    from public.system_user_access as access
    join public.user_device_authorizations as authorizations
      on authorizations.user_id = access.user_id
     and authorizations.authorization_status = 'approved'
     and authorizations.revoked_at is null
   where access.account_status = 'approved'
     and access.user_id <> owner_id
   order by access.user_id
   limit 1;
  if manager_id is null then
    raise exception 'DEVELOPMENT_MANAGER_FIXTURE_MISSING';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  operation_id := gen_random_uuid();
  response := public.device_guarded_apply_conference_snapshot(
    owner_device_id, test_conference_id, operation_id, current_revision,
    snapshot_data, 'runtime-verification', 'development-only'
  );
  if response ->> 'status' <> 'applied' then
    raise exception 'APPROVED_OWNER_WRITE_FAILED: %', response;
  end if;
  current_revision := (response ->> 'revision')::bigint;

  insert into public.conference_members(conference_id,user_id,role)
  values(test_conference_id,manager_id,'manager')
  on conflict (conference_id,user_id) do update set role='manager';
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  operation_id := gen_random_uuid();
  response := public.device_guarded_apply_conference_snapshot(
    manager_device_id, test_conference_id, operation_id, current_revision,
    snapshot_data, 'runtime-verification', 'development-only'
  );
  if response ->> 'status' <> 'applied' then
    raise exception 'APPROVED_MANAGER_WRITE_FAILED: %', response;
  end if;
  current_revision := (response ->> 'revision')::bigint;

  response := public.device_guarded_apply_conference_snapshot(
    manager_device_id, test_conference_id, operation_id, current_revision - 1,
    snapshot_data, 'runtime-verification', 'development-only'
  );
  if response ->> 'status' <> 'applied' then
    raise exception 'IDEMPOTENT_REPLAY_FAILED: %', response;
  end if;
  begin
    perform public.device_guarded_apply_conference_snapshot(
      manager_device_id, test_conference_id, operation_id, current_revision,
      snapshot_data || jsonb_build_object('_intentMismatch',true),
      'runtime-verification', 'development-only'
    );
    raise exception 'OPERATION_INTENT_MISMATCH_NOT_REJECTED';
  exception when others then
    if sqlerrm not like '%SNAPSHOT_OPERATION_INTENT_MISMATCH%' then raise; end if;
  end;

  operation_id := gen_random_uuid();
  response := public.device_guarded_apply_conference_snapshot(
    manager_device_id, test_conference_id, operation_id,
    greatest(current_revision - 1,0), snapshot_data,
    'runtime-verification', 'development-only'
  );
  if response ->> 'status' <> 'conflict' then
    raise exception 'STALE_REVISION_CONFLICT_FAILED: %', response;
  end if;

  update public.user_device_authorizations
     set authorization_status='pending', approved_at=null,
         approved_by=null, revoked_at=null, revoked_by=null
   where user_id=manager_id and device_id=manager_device_id;
  begin
    perform public.device_guarded_apply_conference_snapshot(
      manager_device_id,test_conference_id,gen_random_uuid(),current_revision,
      snapshot_data,'runtime-verification','development-only'
    );
    raise exception 'PENDING_DEVICE_WRITE_NOT_REJECTED';
  exception when others then
    if sqlerrm not like '%APPROVED_DEVICE_REQUIRED%' then raise; end if;
  end;

  update public.user_device_authorizations
     set authorization_status='revoked', revoked_at=now(),
         revoked_by=owner_id
   where user_id=manager_id and device_id=manager_device_id;
  begin
    perform public.device_guarded_apply_conference_snapshot(
      manager_device_id,test_conference_id,gen_random_uuid(),current_revision,
      snapshot_data,'runtime-verification','development-only'
    );
    raise exception 'REVOKED_DEVICE_WRITE_NOT_REJECTED';
  exception when others then
    if sqlerrm not like '%APPROVED_DEVICE_REQUIRED%' then raise; end if;
  end;

  update public.user_device_authorizations
     set authorization_status='approved', approved_at=now(),
         approved_by=owner_id, revoked_at=null, revoked_by=null
   where user_id=manager_id and device_id=manager_device_id;
  update public.conference_members set role='viewer'
   where conference_members.conference_id=test_conference_id
     and conference_members.user_id=manager_id;
  begin
    perform public.device_guarded_apply_conference_snapshot(
      manager_device_id,test_conference_id,gen_random_uuid(),current_revision,
      snapshot_data,'runtime-verification','development-only'
    );
    raise exception 'VIEWER_WRITE_NOT_REJECTED';
  exception when others then
    if sqlerrm not like '%conference write access denied%' then raise; end if;
  end;

  delete from public.conference_members
   where conference_members.conference_id=test_conference_id
     and conference_members.user_id=manager_id;
  begin
    perform public.device_guarded_apply_conference_snapshot(
      manager_device_id,test_conference_id,gen_random_uuid(),current_revision,
      snapshot_data,'runtime-verification','development-only'
    );
    raise exception 'NON_MEMBER_WRITE_NOT_REJECTED';
  exception when others then
    if sqlerrm not like '%conference write access denied%' then raise; end if;
  end;

  insert into public.conference_members(conference_id,user_id,role)
  values(test_conference_id,manager_id,'manager');
  begin
    perform public.device_guarded_apply_conference_snapshot(
      owner_device_id,test_conference_id,gen_random_uuid(),current_revision,
      snapshot_data,'runtime-verification','development-only'
    );
    raise exception 'OTHER_USERS_DEVICE_WRITE_NOT_REJECTED';
  exception when others then
    if sqlerrm not like '%APPROVED_DEVICE_REQUIRED%' then raise; end if;
  end;

  raise notice 'SNAPSHOT_DEVICE_GUARD_RUNTIME_VERIFICATION_PASS';
end;
$$;

rollback;
