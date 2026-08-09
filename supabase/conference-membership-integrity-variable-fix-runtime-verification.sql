begin;

create temporary table membership_integrity_verification(
  scenario text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  fixture_conference_id uuid;
  fixture_organization_id uuid;
  fixture_owner_id uuid;
  fixture_owner_device_id uuid;
  fixture_member_id uuid;
  fixture_member_device_id uuid;
  created_conference_id uuid := gen_random_uuid();
  fixture_operation_id uuid;
  response jsonb;
  rejected boolean;
begin
  select conferences.id, conferences.organization_id, conferences.owner_id,
         owner_device.device_id, member.user_id, member_device.device_id
    into fixture_conference_id, fixture_organization_id, fixture_owner_id,
         fixture_owner_device_id, fixture_member_id, fixture_member_device_id
    from public.conferences as conferences
    join public.organizations as organizations
      on organizations.id = conferences.organization_id
     and organizations.status = 'active'
    join public.organization_members as owner_organization
      on owner_organization.organization_id = conferences.organization_id
     and owner_organization.user_id = conferences.owner_id
    join public.system_user_access as owner_access
      on owner_access.user_id = conferences.owner_id
     and owner_access.account_status = 'approved'
    join public.user_device_authorizations as owner_device
      on owner_device.user_id = conferences.owner_id
     and owner_device.authorization_status = 'approved'
     and owner_device.revoked_at is null
    join public.organization_members as member
      on member.organization_id = conferences.organization_id
     and member.user_id <> conferences.owner_id
    join public.system_user_access as member_access
      on member_access.user_id = member.user_id
     and member_access.account_status = 'approved'
    join public.user_device_authorizations as member_device
      on member_device.user_id = member.user_id
     and member_device.authorization_status = 'approved'
     and member_device.revoked_at is null
   order by conferences.created_at
   limit 1;

  if fixture_conference_id is null then
    raise exception 'MEMBERSHIP_INTEGRITY_RUNTIME_FIXTURE_REQUIRED';
  end if;

  delete from public.conference_members
   where conference_id = fixture_conference_id
     and user_id = fixture_member_id;

  perform set_config('request.jwt.claim.sub', fixture_owner_id::text, true);
  fixture_operation_id := gen_random_uuid();
  response := public.device_guarded_manage_conference_member(
    fixture_owner_device_id, fixture_conference_id, fixture_member_id,
    fixture_operation_id, 'add', 'manager'
  );
  insert into membership_integrity_verification values(
    'A_SAME_ORGANIZATION_ADD',
    response ->> 'status' = 'added'
      and exists (
        select 1 from public.conference_members as members
         where members.conference_id = fixture_conference_id
           and members.user_id = fixture_member_id
           and members.role = 'manager'
      )
  );

  fixture_operation_id := gen_random_uuid();
  response := public.device_guarded_manage_conference_member(
    fixture_owner_device_id, fixture_conference_id, fixture_member_id,
    fixture_operation_id, 'change_role', 'viewer'
  );
  insert into membership_integrity_verification values(
    'B_MANAGER_TO_VIEWER', response ->> 'status' = 'role_changed'
  );

  fixture_operation_id := gen_random_uuid();
  response := public.device_guarded_manage_conference_member(
    fixture_owner_device_id, fixture_conference_id, fixture_member_id,
    fixture_operation_id, 'change_role', 'manager'
  );
  insert into membership_integrity_verification values(
    'C_VIEWER_TO_MANAGER', response ->> 'status' = 'role_changed'
  );

  fixture_operation_id := gen_random_uuid();
  response := public.device_guarded_manage_conference_member(
    fixture_owner_device_id, fixture_conference_id, fixture_member_id,
    fixture_operation_id, 'change_role', 'manager'
  );
  insert into membership_integrity_verification values(
    'D_IDEMPOTENT_ROLE_REPLAY', response ->> 'status' = 'unchanged'
  );

  response := public.device_guarded_manage_conference_member(
    fixture_owner_device_id, fixture_conference_id, fixture_member_id,
    fixture_operation_id, 'change_role', 'manager'
  );
  update membership_integrity_verification
     set passed = passed and response ->> 'replayed' = 'true'
   where scenario = 'D_IDEMPOTENT_ROLE_REPLAY';

  fixture_operation_id := gen_random_uuid();
  response := public.device_guarded_create_organization_conference_idempotent(
    fixture_owner_device_id, fixture_operation_id, created_conference_id,
    fixture_organization_id, 'Membership integrity runtime verification', '{}'::jsonb
  );
  insert into membership_integrity_verification values(
    'E_CONFERENCE_CREATION',
    response ->> 'status' = 'created'
      and exists (
        select 1 from public.conference_members as members
         where members.conference_id = created_conference_id
           and members.user_id = fixture_owner_id
           and members.role = 'owner'
      )
  );

  perform set_config('request.jwt.claim.sub', fixture_member_id::text, true);
  rejected := false;
  begin
    perform public.device_guarded_manage_conference_member(
      fixture_member_device_id, fixture_conference_id, fixture_owner_id,
      gen_random_uuid(), 'change_role', 'viewer'
    );
  exception when others then
    rejected := sqlerrm like '%conference owner access required%';
  end;
  insert into membership_integrity_verification values(
    'F_UNAUTHORIZED_ACTOR_REJECT', rejected
  );

  perform set_config('request.jwt.claim.sub', fixture_owner_id::text, true);
  delete from public.conference_members
   where conference_id = fixture_conference_id
     and user_id = fixture_member_id;
  delete from public.organization_members
   where organization_id = fixture_organization_id
     and user_id = fixture_member_id;

  fixture_operation_id := gen_random_uuid();
  rejected := false;
  begin
    perform public.device_guarded_manage_conference_member(
      fixture_owner_device_id, fixture_conference_id, fixture_member_id,
      fixture_operation_id, 'add', 'viewer'
    );
  exception when sqlstate '42501' then
    rejected := sqlerrm = 'CONFERENCE_MEMBER_ORGANIZATION_REQUIRED';
  end;
  insert into membership_integrity_verification values(
    'G_CROSS_ORGANIZATION_REJECT',
    rejected
      and not exists (
        select 1 from public.conference_members as members
         where members.conference_id = fixture_conference_id
           and members.user_id = fixture_member_id
      )
      and not exists (
        select 1 from public.conference_membership_operations as operations
         where operations.operation_id = fixture_operation_id
      )
  );

  update public.conferences as conferences
     set organization_id = null
   where conferences.id = fixture_conference_id;
  rejected := false;
  begin
    insert into public.conference_members(conference_id,user_id,role)
    values(fixture_conference_id,fixture_member_id,'viewer');
  exception when sqlstate '23514' then
    rejected := sqlerrm = 'CONFERENCE_ORGANIZATION_REQUIRED';
  end;
  insert into membership_integrity_verification values(
    'H_NULL_LEGACY_CONFERENCE_REJECT', rejected
  );

  update public.conferences as conferences
     set organization_id = fixture_organization_id
   where conferences.id = fixture_conference_id;
  insert into public.organization_members(organization_id,user_id,role)
  values(fixture_organization_id,fixture_member_id,'member');
  insert into public.conference_members(conference_id,user_id,role)
  values(fixture_conference_id,fixture_member_id,'viewer');
  fixture_operation_id := gen_random_uuid();
  response := public.device_guarded_manage_conference_member(
    fixture_owner_device_id, fixture_conference_id, fixture_member_id,
    fixture_operation_id, 'remove', null
  );
  insert into membership_integrity_verification values(
    'I_REMOVE_UNCHANGED',
    response ->> 'status' = 'removed'
      and not exists (
        select 1 from public.conference_members as members
         where members.conference_id = fixture_conference_id
           and members.user_id = fixture_member_id
      )
  );

  if exists(select 1 from membership_integrity_verification where not passed) then
    raise exception 'MEMBERSHIP_INTEGRITY_RUNTIME_VERIFICATION_FAILED: %',
      (select jsonb_agg(scenario order by scenario)
         from membership_integrity_verification where not passed);
  end if;
end;
$$;

select scenario, passed
  from membership_integrity_verification
 order by scenario;

rollback;
