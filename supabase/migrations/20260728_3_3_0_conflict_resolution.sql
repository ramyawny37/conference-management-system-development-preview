begin;

alter table public.sync_conflicts
  add column resolution_strategy text,
  add column resolution_operation_id uuid
    references public.sync_operations(operation_id),
  add column resolved_revision bigint;

alter table public.sync_conflicts
  add constraint sync_conflicts_resolution_strategy_check
  check (
    resolution_strategy is null
    or resolution_strategy in ('keep_local', 'keep_server', 'manual')
  ),
  add constraint sync_conflicts_resolved_revision_check
  check (resolved_revision is null or resolved_revision >= 0);

create unique index sync_conflicts_resolution_operation_id_key
  on public.sync_conflicts(resolution_operation_id)
  where resolution_operation_id is not null;

create or replace function public.resolve_sync_conflict(
  p_conflict_id uuid,
  p_conference_id uuid,
  p_resolution_operation_id uuid,
  p_device_id uuid,
  p_expected_revision bigint,
  p_strategy text,
  p_resolved_snapshot jsonb,
  p_schema_version text,
  p_app_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  conflict_record public.sync_conflicts%rowtype;
  existing_operation public.sync_operations%rowtype;
  current_revision bigint;
  next_revision bigint;
  final_revision bigint;
  final_status text;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conflict_id is null
    or p_conference_id is null
    or p_resolution_operation_id is null
    or p_device_id is null
    or p_expected_revision is null
    or p_expected_revision < 0
    or p_strategy is null
    or p_strategy not in ('keep_local', 'keep_server', 'manual')
    or nullif(btrim(p_schema_version), '') is null
    or nullif(btrim(p_app_version), '') is null then
    raise exception 'invalid conflict resolution arguments';
  end if;
  if p_strategy in ('keep_local', 'manual')
    and p_resolved_snapshot is null then
    raise exception 'resolved snapshot is required';
  end if;
  if not public.has_conference_role(
    p_conference_id,
    array['owner', 'manager']
  ) then
    raise exception 'conference resolution access denied';
  end if;
  if not exists (
    select 1
      from public.devices as d
     where d.id = p_device_id
       and d.user_id = current_user_id
  ) then
    raise exception 'device does not belong to authenticated user';
  end if;

  perform 1
    from public.conferences as c
   where c.id = p_conference_id
   for update;
  if not found then
    raise exception 'conference not found';
  end if;

  select *
    into conflict_record
    from public.sync_conflicts as sc
   where sc.id = p_conflict_id
   for update;
  if not found or conflict_record.conference_id <> p_conference_id then
    raise exception 'conflict does not belong to conference';
  end if;

  select *
    into existing_operation
    from public.sync_operations as so
   where so.operation_id = p_resolution_operation_id;
  if found then
    if existing_operation.conference_id <> p_conference_id
      or existing_operation.user_id <> current_user_id
      or existing_operation.device_id <> p_device_id
      or existing_operation.operation_type <> 'conflict_resolution'
      or existing_operation.base_revision <> p_expected_revision
      or existing_operation.payload ->> 'conflictId' <> p_conflict_id::text
      or existing_operation.payload ->> 'strategy' <> p_strategy then
      raise exception 'resolution operation id belongs to another operation';
    end if;
    return jsonb_build_object(
      'success', true,
      'status', 'duplicate',
      'conflictId', p_conflict_id,
      'conferenceId', p_conference_id,
      'strategy', p_strategy,
      'operationId', p_resolution_operation_id,
      'previousRevision', existing_operation.base_revision,
      'resolvedRevision', existing_operation.resulting_revision
    );
  end if;

  select cs.revision
    into current_revision
    from public.conference_snapshots as cs
   where cs.conference_id = p_conference_id
   for update;
  if not found then
    current_revision := 0;
  end if;

  if conflict_record.status <> 'open'
    or conflict_record.actual_revision is distinct from p_expected_revision
    or current_revision <> p_expected_revision then
    return jsonb_build_object(
      'success', false,
      'status', 'conflict_changed',
      'conflictId', p_conflict_id,
      'conferenceId', p_conference_id,
      'operationId', p_resolution_operation_id,
      'expectedRevision', p_expected_revision,
      'actualRevision', current_revision
    );
  end if;

  if p_strategy = 'keep_server' then
    final_revision := current_revision;
    final_status := 'discarded';
  else
    next_revision := current_revision + 1;
    if current_revision = 0 then
      insert into public.conference_snapshots (
        conference_id,
        data,
        revision,
        schema_version,
        app_version,
        updated_by,
        updated_by_device_id,
        updated_at
      ) values (
        p_conference_id,
        p_resolved_snapshot,
        next_revision,
        p_schema_version,
        p_app_version,
        current_user_id,
        p_device_id,
        now()
      );
    else
      update public.conference_snapshots
         set data = p_resolved_snapshot,
             revision = next_revision,
             schema_version = p_schema_version,
             app_version = p_app_version,
             updated_by = current_user_id,
             updated_by_device_id = p_device_id,
             updated_at = now()
       where conference_id = p_conference_id;
    end if;
    final_revision := next_revision;
    final_status := 'resolved';
  end if;

  insert into public.sync_operations (
    operation_id,
    conference_id,
    user_id,
    device_id,
    operation_type,
    base_revision,
    resulting_revision,
    status,
    payload,
    created_at,
    processed_at
  ) values (
    p_resolution_operation_id,
    p_conference_id,
    current_user_id,
    p_device_id,
    'conflict_resolution',
    p_expected_revision,
    final_revision,
    'applied',
    jsonb_build_object(
      'conflictId', p_conflict_id,
      'strategy', p_strategy
    ),
    now(),
    now()
  );

  update public.sync_conflicts
     set status = final_status,
         resolution_strategy = p_strategy,
         resolved_at = now(),
         resolved_by = current_user_id,
         resolution_operation_id = p_resolution_operation_id,
         resolved_revision = final_revision
   where id = p_conflict_id;

  return jsonb_build_object(
    'success', true,
    'status', case
      when p_strategy = 'keep_server' then 'server_selected'
      else 'resolved'
    end,
    'conflictId', p_conflict_id,
    'conferenceId', p_conference_id,
    'strategy', p_strategy,
    'operationId', p_resolution_operation_id,
    'previousRevision', p_expected_revision,
    'resolvedRevision', final_revision
  );
end;
$$;

revoke all on function public.resolve_sync_conflict(
  uuid, uuid, uuid, uuid, bigint, text, jsonb, text, text
) from public;

grant execute on function public.resolve_sync_conflict(
  uuid, uuid, uuid, uuid, bigint, text, jsonb, text, text
) to authenticated;

commit;
