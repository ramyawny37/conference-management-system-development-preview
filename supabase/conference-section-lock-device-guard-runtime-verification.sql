begin;

create temporary table lock_guard_verification(
  scenario text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  fixture_conference_id uuid;
  fixture_organization_id uuid;
  fixture_owner_id uuid;
  fixture_owner_device_id uuid;
  fixture_manager_id uuid;
  fixture_manager_device_id uuid;
  pending_device_id uuid := gen_random_uuid();
  revoked_device_id uuid := gen_random_uuid();
  owner_token uuid := gen_random_uuid();
  manager_token uuid := gen_random_uuid();
  result jsonb;
  rejected boolean;
  section_name text := 'launch_lock_guard';
begin
  select conferences.id,organizations.id,owner_member.user_id,owner_device.device_id,
         manager_member.user_id,manager_device.device_id
    into fixture_conference_id,fixture_organization_id,
         fixture_owner_id,fixture_owner_device_id,
         fixture_manager_id,fixture_manager_device_id
    from public.conferences as conferences
    join public.conference_members as owner_member
      on owner_member.conference_id=conferences.id and owner_member.role='owner'
    join public.system_user_access as owner_access
      on owner_access.user_id=owner_member.user_id
     and owner_access.account_status='approved'
    join public.user_device_authorizations as owner_device
      on owner_device.user_id=owner_member.user_id
     and owner_device.authorization_status='approved'
     and owner_device.revoked_at is null
    join public.conference_members as manager_member
      on manager_member.conference_id=conferences.id and manager_member.role='manager'
    join public.system_user_access as manager_access
      on manager_access.user_id=manager_member.user_id
     and manager_access.account_status='approved'
    join public.user_device_authorizations as manager_device
      on manager_device.user_id=manager_member.user_id
     and manager_device.authorization_status='approved'
     and manager_device.revoked_at is null
    join public.organization_members as owner_organization
      on owner_organization.user_id=owner_member.user_id
    join public.organization_members as manager_organization
      on manager_organization.user_id=manager_member.user_id
     and manager_organization.organization_id=owner_organization.organization_id
    join public.organizations as organizations
      on organizations.id=owner_organization.organization_id
     and organizations.status='active'
   where conferences.organization_id is null
      or conferences.organization_id=organizations.id
   order by conferences.created_at
   limit 1;

  if fixture_conference_id is null then
    raise exception 'LOCK_GUARD_RUNTIME_FIXTURE_REQUIRED';
  end if;

  update public.conferences set organization_id=fixture_organization_id
   where id=fixture_conference_id and organization_id is null;

  insert into public.devices(id,user_id,device_name,platform,last_seen_at)
  values
    (pending_device_id,fixture_owner_id,'Lock guard pending fixture','verification',now()),
    (revoked_device_id,fixture_owner_id,'Lock guard revoked fixture','verification',now());
  insert into public.user_device_authorizations(
    user_id,device_id,authorization_status,requested_at,revoked_at,last_registered_at
  ) values
    (fixture_owner_id,pending_device_id,'pending',now(),null,now()),
    (fixture_owner_id,revoked_device_id,'revoked',now(),now(),now());

  delete from public.conference_locks
   where conference_id=fixture_conference_id and section=section_name;

  perform set_config('request.jwt.claim.sub',fixture_owner_id::text,true);
  result:=public.acquire_conference_section_lock(
    fixture_conference_id,section_name,fixture_owner_device_id,owner_token,120
  );
  insert into lock_guard_verification values(
    'A_OWNER_APPROVED_ACQUIRE',result->>'status'='acquired' and (result->>'owned')::boolean
  );
  perform public.release_conference_section_lock(
    fixture_conference_id,section_name,fixture_owner_device_id,owner_token
  );

  perform set_config('request.jwt.claim.sub',fixture_manager_id::text,true);
  result:=public.acquire_conference_section_lock(
    fixture_conference_id,section_name,fixture_manager_device_id,manager_token,120
  );
  insert into lock_guard_verification values(
    'B_MANAGER_APPROVED_ACQUIRE',result->>'status'='acquired' and (result->>'owned')::boolean
  );
  perform public.release_conference_section_lock(
    fixture_conference_id,section_name,fixture_manager_device_id,manager_token
  );

  execute 'alter table public.conference_members disable trigger conference_members_launch_integrity';
  update public.conference_members set role='viewer'
   where conference_id=fixture_conference_id and user_id=fixture_manager_id;
  rejected:=false;
  begin
    perform public.acquire_conference_section_lock(
      fixture_conference_id,section_name,fixture_manager_device_id,gen_random_uuid(),120
    );
  exception when sqlstate '42501' then
    rejected:=sqlerrm='CONFERENCE_WRITE_ACCESS_DENIED';
  end;
  insert into lock_guard_verification values('C_VIEWER_ACQUIRE_REJECT',rejected);
  update public.conference_members set role='manager'
   where conference_id=fixture_conference_id and user_id=fixture_manager_id;

  perform set_config('request.jwt.claim.sub',fixture_owner_id::text,true);
  rejected:=false;
  begin
    perform public.acquire_conference_section_lock(
      fixture_conference_id,section_name,pending_device_id,gen_random_uuid(),120
    );
  exception when sqlstate '42501' then
    rejected:=sqlerrm='APPROVED_DEVICE_REQUIRED';
  end;
  insert into lock_guard_verification values('D_PENDING_DEVICE_REJECT',rejected);

  rejected:=false;
  begin
    perform public.acquire_conference_section_lock(
      fixture_conference_id,section_name,revoked_device_id,gen_random_uuid(),120
    );
  exception when sqlstate '42501' then
    rejected:=sqlerrm='APPROVED_DEVICE_REQUIRED';
  end;
  insert into lock_guard_verification values('E_REVOKED_DEVICE_REJECT',rejected);

  rejected:=false;
  begin
    perform public.acquire_conference_section_lock(
      fixture_conference_id,section_name,fixture_manager_device_id,gen_random_uuid(),120
    );
  exception when sqlstate '42501' then
    rejected:=sqlerrm='APPROVED_DEVICE_REQUIRED';
  end;
  insert into lock_guard_verification values('F_CROSS_USER_DEVICE_REJECT',rejected);

  delete from public.conference_members
   where conference_id=fixture_conference_id and user_id=fixture_manager_id;
  perform set_config('request.jwt.claim.sub',fixture_manager_id::text,true);
  rejected:=false;
  begin
    perform public.acquire_conference_section_lock(
      fixture_conference_id,section_name,fixture_manager_device_id,gen_random_uuid(),120
    );
  exception when sqlstate '42501' then
    rejected:=sqlerrm='CONFERENCE_WRITE_ACCESS_DENIED';
  end;
  insert into lock_guard_verification values('G_NON_MEMBER_REJECT',rejected);
  insert into public.conference_members(conference_id,user_id,role)
  values(fixture_conference_id,fixture_manager_id,'manager');

  perform set_config('request.jwt.claim.sub',fixture_owner_id::text,true);
  owner_token:=gen_random_uuid();
  result:=public.acquire_conference_section_lock(
    fixture_conference_id,section_name,fixture_owner_device_id,owner_token,120
  );
  result:=public.renew_conference_section_lock(
    fixture_conference_id,section_name,fixture_owner_device_id,owner_token,120
  );
  insert into lock_guard_verification values(
    'H_OWNER_RENEW_PASS',result->>'status'='renewed' and (result->>'owned')::boolean
  );

  perform set_config('request.jwt.claim.sub',fixture_manager_id::text,true);
  result:=public.renew_conference_section_lock(
    fixture_conference_id,section_name,fixture_manager_device_id,owner_token,120
  );
  insert into lock_guard_verification values(
    'I_DIFFERENT_WRITER_RENEW_REJECT',
    result->>'status'='not_owner' and result->>'errorCode'='LOCK_NOT_OWNED'
  );

  perform set_config('request.jwt.claim.sub',fixture_owner_id::text,true);
  result:=public.renew_conference_section_lock(
    fixture_conference_id,section_name,fixture_owner_device_id,gen_random_uuid(),120
  );
  insert into lock_guard_verification values(
    'J_WRONG_TOKEN_REJECT',
    result->>'status'='not_owner' and result->>'errorCode'='LOCK_TOKEN_MISMATCH'
  );

  update public.conference_members set role='viewer'
   where conference_id=fixture_conference_id and user_id=fixture_manager_id;
  perform set_config('request.jwt.claim.sub',fixture_manager_id::text,true);
  rejected:=false;
  begin
    perform public.release_conference_section_lock(
      fixture_conference_id,section_name,fixture_manager_device_id,owner_token
    );
  exception when sqlstate '42501' then
    rejected:=sqlerrm='CONFERENCE_WRITE_ACCESS_DENIED';
  end;
  insert into lock_guard_verification values('L_VIEWER_RELEASE_REJECT',rejected);
  update public.conference_members set role='manager'
   where conference_id=fixture_conference_id and user_id=fixture_manager_id;

  perform set_config('request.jwt.claim.sub',fixture_owner_id::text,true);
  result:=public.release_conference_section_lock(
    fixture_conference_id,section_name,fixture_owner_device_id,owner_token
  );
  insert into lock_guard_verification values(
    'K_OWNER_RELEASE_PASS',result->>'status'='released'
  );

  owner_token:=gen_random_uuid();
  perform public.acquire_conference_section_lock(
    fixture_conference_id,section_name,fixture_owner_device_id,owner_token,120
  );
  update public.conference_locks
     set acquired_at=clock_timestamp()-interval '3 minutes',
         last_renewed_at=clock_timestamp()-interval '3 minutes',
         created_at=clock_timestamp()-interval '3 minutes',
         expires_at=clock_timestamp()-interval '1 second'
   where conference_id=fixture_conference_id and section=section_name;
  perform set_config('request.jwt.claim.sub',fixture_manager_id::text,true);
  result:=public.acquire_conference_section_lock(
    fixture_conference_id,section_name,fixture_manager_device_id,gen_random_uuid(),120
  );
  insert into lock_guard_verification values(
    'M_EXPIRED_LOCK_REACQUIRE_PASS',
    result->>'status'='acquired' and (result->>'owned')::boolean
  );

  update public.system_user_access set account_status='pending'
   where user_id=fixture_manager_id;
  rejected:=false;
  begin
    perform public.acquire_conference_section_lock(
      fixture_conference_id,'launch_account_guard',fixture_manager_device_id,
      gen_random_uuid(),120
    );
  exception when sqlstate '42501' then
    rejected:=sqlerrm='SYSTEM_ACCESS_APPROVED_REQUIRED';
  end;
  insert into lock_guard_verification values('N_PENDING_ACCOUNT_REJECT',rejected);
end;
$$;

select jsonb_object_agg(scenario,passed order by scenario) as verification
  from lock_guard_verification;

rollback;
