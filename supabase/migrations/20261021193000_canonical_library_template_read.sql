-- Restore the canonical personal Library Template read surface after Organization retirement.
create or replace function public.list_library_templates(p_actor_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor_id uuid:=auth.uid();
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  perform public.require_current_approved_device(p_actor_device_id);
  return jsonb_build_object(
    'status','success',
    'templates',coalesce((
      select jsonb_agg(jsonb_build_object(
        'templateType',template_type,
        'templateId',template_id,
        'payload',payload,
        'revision',revision,
        'deletedAt',deleted_at,
        'createdAt',created_at,
        'updatedAt',updated_at
      ) order by template_type,template_id)
      from public.library_templates
      where owner_user_id=actor_id
    ),'[]'::jsonb)
  );
end
$function$;

-- Soft deletion remains centrally recoverable; the browser is not a backup owner.
create or replace function public.apply_library_template_content_operation(
  p_actor_device_id uuid,p_operation_id uuid,p_template_type text,p_template_id text,
  p_action text,p_base_revision bigint,p_payload jsonb default null)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','extensions'
as $function$
declare actor_id uuid:=auth.uid(); current_row public.library_templates%rowtype;
  prior public.library_template_operations%rowtype;
  normalized_id text:=btrim(coalesce(p_template_id,'')); intent text;
  result jsonb; result_status text; next_revision bigint;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  perform public.require_current_approved_device(p_actor_device_id);
  if p_operation_id is null or p_template_type not in ('house','conference')
    or p_action not in ('upsert','delete') or length(normalized_id) not between 1 and 160
    or p_base_revision is null or p_base_revision<0
    or (p_action='upsert' and (p_payload is null or jsonb_typeof(p_payload)<>'object'))
    or (p_action='delete' and p_payload is not null)
  then raise exception 'INVALID_TEMPLATE_OPERATION' using errcode='22023'; end if;
  intent:=encode(digest(actor_id::text||'|'||p_template_type||'|'||normalized_id||'|'||
    p_action||'|'||p_base_revision::text||'|'||coalesce(p_payload::text,'null'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('library-template-operation:'||p_operation_id::text,0));
  select * into prior from public.library_template_operations where operation_id=p_operation_id;
  if found then
    if prior.actor_user_id<>actor_id or prior.intent_hash<>intent then
      raise exception 'TEMPLATE_OPERATION_INTENT_MISMATCH' using errcode='22023';
    end if;
    return prior.stored_result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('library-template:'||p_template_type||':'||normalized_id,0));
  select * into current_row from public.library_templates
    where template_type=p_template_type and template_id=normalized_id for update;
  if not found then
    if p_base_revision<>0 or p_action<>'upsert' then
      return jsonb_build_object('status','conflict','templateType',p_template_type,
        'templateId',normalized_id,'currentRevision',0);
    end if;
    insert into public.library_templates(
      template_type,template_id,payload,owner_user_id,created_by,updated_by
    ) values(p_template_type,normalized_id,p_payload,actor_id,actor_id,actor_id);
    result_status:='created'; next_revision:=1;
  else
    if current_row.owner_user_id<>actor_id and not public.is_system_owner(actor_id) then
      raise exception 'TEMPLATE_OWNER_REQUIRED' using errcode='42501';
    end if;
    if current_row.revision<>p_base_revision then
      return jsonb_build_object('status','conflict','templateType',p_template_type,
        'templateId',normalized_id,'currentRevision',current_row.revision);
    end if;
    if p_action='delete' and current_row.deleted_at is not null then
      result_status:='unchanged'; next_revision:=current_row.revision;
    elsif p_action='upsert' and current_row.deleted_at is null and current_row.payload=p_payload then
      result_status:='unchanged'; next_revision:=current_row.revision;
    else
      next_revision:=current_row.revision+1;
      update public.library_templates set
        payload=case when p_action='upsert' then p_payload else payload end,
        deleted_at=case when p_action='delete' then now() else null end,
        revision=next_revision,updated_by=actor_id,updated_at=now()
      where template_type=p_template_type and template_id=normalized_id;
      result_status:=case when p_action='delete' then 'deleted' else 'updated' end;
    end if;
  end if;
  result:=jsonb_build_object('status',result_status,'templateType',p_template_type,
    'templateId',normalized_id,'operationId',p_operation_id,'revision',next_revision);
  insert into public.library_template_operations values(
    p_operation_id,actor_id,p_actor_device_id,p_template_type,normalized_id,p_action,
    p_base_revision,intent,result_status,next_revision,result,now());
  if result_status<>'unchanged' then
    insert into public.library_template_audit_log(
      template_type,template_id,actor_user_id,actor_device_id,operation_id,action,
      previous_revision,resulting_revision
    ) values(p_template_type,normalized_id,actor_id,p_actor_device_id,p_operation_id,
      p_action,p_base_revision,next_revision);
  end if;
  return result;
end
$function$;

revoke all on function public.list_library_templates(uuid)
  from public,anon,authenticated,service_role;

do $migration$
declare
  signature regprocedure:=
    'platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)'::regprocedure;
  definition text;
  marker text:='when ''apply_library_template_content_operation'' then';
  replacement text:='when ''list_library_templates'' then
      perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);
      return public.list_library_templates(v_session.device_id);
    when ''apply_library_template_content_operation'' then';
begin
  definition:=pg_get_functiondef(signature);
  if position('when ''list_library_templates'' then' in definition)=0 then
    if position(marker in definition)=0 then
      raise exception 'CANONICAL_TEMPLATE_DISPATCH_MARKER_MISSING' using errcode='55000';
    end if;
    execute replace(definition,marker,replacement);
  end if;
end
$migration$;

comment on function public.list_library_templates(uuid) is
  'Canonical personal Library Template read through the approved Platform device session.';
