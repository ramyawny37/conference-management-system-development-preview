-- Development SQL Editor verification only. Always rolls back.
begin;

create temporary table legacy_conference_preflight_verification_result (
  result text not null,
  detail text not null
) on commit drop;

do $$
declare function_definition text;
begin
  begin
    select pg_get_functiondef(
      'public.device_guarded_list_eligible_legacy_conference_organizations(uuid,uuid)'::regprocedure
    ) into function_definition;
    if function_definition is null then raise exception 'PREFLIGHT_FUNCTION_MISSING'; end if;
    if function_definition !~* 'stable' or function_definition !~* 'security definer' then
      raise exception 'PREFLIGHT_FUNCTION_SECURITY_CONTRACT_MISSING';
    end if;
    if function_definition !~* 'require_current_approved_device\(p_actor_device_id\)' then
      raise exception 'PREFLIGHT_DEVICE_GUARD_MISSING';
    end if;
    if function_definition ~* '\m(insert|update|delete|merge|truncate)\M' then
      raise exception 'PREFLIGHT_MUST_BE_READ_ONLY';
    end if;
    if function_definition ~* '(email|membercount|user_id[^;]*jsonb_build_object)' then
      raise exception 'PREFLIGHT_RESULT_MAY_EXPOSE_MEMBER_DATA';
    end if;
    if has_function_privilege('anon',
      'public.device_guarded_list_eligible_legacy_conference_organizations(uuid,uuid)', 'EXECUTE') then
      raise exception 'ANON_EXECUTE_MUST_BE_REVOKED';
    end if;
    if not has_function_privilege('authenticated',
      'public.device_guarded_list_eligible_legacy_conference_organizations(uuid,uuid)', 'EXECUTE') then
      raise exception 'AUTHENTICATED_EXECUTE_MISSING';
    end if;
    insert into legacy_conference_preflight_verification_result(result, detail)
    values ('PASS', 'LEGACY_CONFERENCE_PREFLIGHT_CONTRACT_VERIFIED');
  exception when others then
    insert into legacy_conference_preflight_verification_result(result, detail)
    values ('FAIL', sqlerrm);
  end;
end;
$$;

select result, detail
  from legacy_conference_preflight_verification_result;

rollback;
