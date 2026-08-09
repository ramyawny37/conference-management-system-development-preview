begin;

create table if not exists public.conference_snapshot_guard_intents (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_device_id uuid not null,
  conference_id uuid not null references public.conferences(id) on delete cascade,
  operation_kind text not null check(operation_kind in ('apply_snapshot','resolve_conflict')),
  intent_hash text not null check(length(intent_hash)=32),
  created_at timestamptz not null default now()
);

alter table public.conference_snapshot_guard_intents enable row level security;
revoke all on table public.conference_snapshot_guard_intents
  from public, anon, authenticated;

create or replace function public.device_guarded_apply_conference_snapshot(
  p_actor_device_id uuid,
  p_conference_id uuid,
  p_operation_id uuid,
  p_base_revision bigint,
  p_snapshot jsonb,
  p_schema_version text,
  p_app_version text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  actor_id uuid;
  intent text;
  prior public.conference_snapshot_guard_intents%rowtype;
begin
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  perform pg_advisory_xact_lock(hashtextextended(
    'conference-snapshot:'||p_conference_id::text,0
  ));
  intent:=md5(jsonb_build_object(
    'conferenceId',p_conference_id,'operationId',p_operation_id,
    'baseRevision',p_base_revision,'snapshot',p_snapshot,
    'schemaVersion',p_schema_version,'appVersion',p_app_version
  )::text);
  select * into prior from public.conference_snapshot_guard_intents
   where operation_id=p_operation_id;
  if found then
    if prior.actor_user_id<>actor_id
      or prior.actor_device_id<>p_actor_device_id
      or prior.conference_id<>p_conference_id
      or prior.operation_kind<>'apply_snapshot'
      or prior.intent_hash<>intent then
      raise exception 'SNAPSHOT_OPERATION_INTENT_MISMATCH' using errcode='22023';
    end if;
  else
    insert into public.conference_snapshot_guard_intents(
      operation_id,actor_user_id,actor_device_id,conference_id,
      operation_kind,intent_hash
    ) values(
      p_operation_id,actor_id,p_actor_device_id,p_conference_id,
      'apply_snapshot',intent
    );
  end if;
  return public.apply_conference_snapshot(
    p_conference_id,p_operation_id,p_actor_device_id,p_base_revision,
    p_snapshot,p_schema_version,p_app_version
  );
end;
$$;

create or replace function public.device_guarded_resolve_sync_conflict(
  p_actor_device_id uuid,
  p_conflict_id uuid,
  p_conference_id uuid,
  p_resolution_operation_id uuid,
  p_expected_revision bigint,
  p_strategy text,
  p_resolved_snapshot jsonb,
  p_schema_version text,
  p_app_version text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  actor_id uuid;
  intent text;
  prior public.conference_snapshot_guard_intents%rowtype;
begin
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  perform pg_advisory_xact_lock(hashtextextended(
    'conference-snapshot:'||p_conference_id::text,0
  ));
  intent:=md5(jsonb_build_object(
    'conflictId',p_conflict_id,'conferenceId',p_conference_id,
    'operationId',p_resolution_operation_id,
    'expectedRevision',p_expected_revision,'strategy',p_strategy,
    'snapshot',p_resolved_snapshot,'schemaVersion',p_schema_version,
    'appVersion',p_app_version
  )::text);
  select * into prior from public.conference_snapshot_guard_intents
   where operation_id=p_resolution_operation_id;
  if found then
    if prior.actor_user_id<>actor_id
      or prior.actor_device_id<>p_actor_device_id
      or prior.conference_id<>p_conference_id
      or prior.operation_kind<>'resolve_conflict'
      or prior.intent_hash<>intent then
      raise exception 'CONFLICT_RESOLUTION_INTENT_MISMATCH' using errcode='22023';
    end if;
  else
    insert into public.conference_snapshot_guard_intents(
      operation_id,actor_user_id,actor_device_id,conference_id,
      operation_kind,intent_hash
    ) values(
      p_resolution_operation_id,actor_id,p_actor_device_id,p_conference_id,
      'resolve_conflict',intent
    );
  end if;
  return public.resolve_sync_conflict(
    p_conflict_id,p_conference_id,p_resolution_operation_id,
    p_actor_device_id,p_expected_revision,p_strategy,p_resolved_snapshot,
    p_schema_version,p_app_version
  );
end;
$$;

-- Snapshot mutations must enter through the approved-device wrappers. The
-- legacy functions remain implementation details for the wrappers' existing
-- idempotency, attribution, revision, and conflict semantics.
revoke all on function public.apply_conference_snapshot(
  uuid, uuid, uuid, bigint, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.resolve_sync_conflict(
  uuid, uuid, uuid, uuid, bigint, text, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.device_guarded_apply_conference_snapshot(
  uuid, uuid, uuid, bigint, jsonb, text, text
) from public, anon;

revoke all on function public.device_guarded_resolve_sync_conflict(
  uuid, uuid, uuid, uuid, bigint, text, jsonb, text, text
) from public, anon;

grant execute on function public.device_guarded_apply_conference_snapshot(
  uuid, uuid, uuid, bigint, jsonb, text, text
) to authenticated;

grant execute on function public.device_guarded_resolve_sync_conflict(
  uuid, uuid, uuid, uuid, bigint, text, jsonb, text, text
) to authenticated;

do $$
declare
  apply_wrapper oid := to_regprocedure(
    'public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)'
  );
  conflict_wrapper oid := to_regprocedure(
    'public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)'
  );
  unsafe_apply oid := to_regprocedure(
    'public.apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)'
  );
  unsafe_conflict oid := to_regprocedure(
    'public.resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)'
  );
begin
  if apply_wrapper is null or conflict_wrapper is null
    or unsafe_apply is null or unsafe_conflict is null then
    raise exception 'SNAPSHOT_DEVICE_GUARD_SIGNATURE_MISSING';
  end if;

  if has_function_privilege('public', unsafe_apply, 'execute')
    or has_function_privilege('anon', unsafe_apply, 'execute')
    or has_function_privilege('authenticated', unsafe_apply, 'execute')
    or has_function_privilege('public', unsafe_conflict, 'execute')
    or has_function_privilege('anon', unsafe_conflict, 'execute')
    or has_function_privilege('authenticated', unsafe_conflict, 'execute') then
    raise exception 'UNSAFE_SNAPSHOT_RPC_EXECUTE_REMAINS';
  end if;

  if has_function_privilege('public', apply_wrapper, 'execute')
    or has_function_privilege('anon', apply_wrapper, 'execute')
    or not has_function_privilege('authenticated', apply_wrapper, 'execute')
    or has_function_privilege('public', conflict_wrapper, 'execute')
    or has_function_privilege('anon', conflict_wrapper, 'execute')
    or not has_function_privilege('authenticated', conflict_wrapper, 'execute') then
    raise exception 'GUARDED_SNAPSHOT_RPC_GRANT_INVALID';
  end if;

  if position('require_current_approved_device' in
      (select prosrc from pg_proc where oid = apply_wrapper)) = 0
    or position('require_current_approved_device' in
      (select prosrc from pg_proc where oid = conflict_wrapper)) = 0 then
    raise exception 'SNAPSHOT_APPROVED_DEVICE_GUARD_MISSING';
  end if;
  if position('SNAPSHOT_OPERATION_INTENT_MISMATCH' in
      (select prosrc from pg_proc where oid=apply_wrapper))=0
    or position('CONFLICT_RESOLUTION_INTENT_MISMATCH' in
      (select prosrc from pg_proc where oid=conflict_wrapper))=0 then
    raise exception 'SNAPSHOT_OPERATION_INTENT_GUARD_MISSING';
  end if;
end;
$$;

commit;
