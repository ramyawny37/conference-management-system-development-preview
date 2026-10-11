begin;
-- Align the single Platform dispatcher with the canonical Reservations client.
-- The scope selector is mandatory: a standalone event or a canonical conference.
do $$
declare
  v_definition text;
  v_old text := E'when ''list_conference_options'',''get_booking_creation_context'' then\n      perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);';
  v_new text := E'when ''list_conference_options'' then\n      perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);\n    when ''get_booking_creation_context'' then\n      if p_args ? ''p_scope_type'' then\n        perform platform_private.require_exact_jsonb_keys(p_args,array[''p_scope_type'']);\n        if p_args->>''p_scope_type'' <> ''standalone'' then\n          raise exception ''RESERVATIONS_SCOPE_TYPE_INVALID'' using errcode=''22023'';\n        end if;\n      else\n        perform platform_private.require_exact_jsonb_keys(p_args,array[''p_conference_id'']);\n        if nullif(p_args->>''p_conference_id'','''') is null then\n          raise exception ''RESERVATIONS_CONFERENCE_REQUIRED'' using errcode=''22023'';\n        end if;\n      end if;';
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='platform' and p.proname='execute_device_operation'
    and p.prokind='f'
    and pg_get_function_identity_arguments(p.oid)=
      'p_user_id uuid, p_session_id uuid, p_token_hash bytea, p_module text, p_operation text, p_args jsonb';
  if v_definition is null or position(v_old in v_definition)=0 then
    raise exception 'RESERVATIONS_BOOKING_CONTEXT_DISPATCH_PRECONDITION_FAILED' using errcode='55000';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;
commit;
