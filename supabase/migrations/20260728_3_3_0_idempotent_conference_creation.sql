begin;

create table public.conference_creation_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  conference_id uuid not null
    references public.conferences(id) on delete restrict,
  initial_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conference_creation_operations_user_operation_key
    unique (user_id, operation_id),
  constraint conference_creation_operations_conference_key
    unique (conference_id),
  constraint conference_creation_operations_metadata_object
    check (jsonb_typeof(initial_metadata) = 'object')
);

create index conference_creation_operations_user_created_idx
  on public.conference_creation_operations(user_id, created_at);

alter table public.conference_creation_operations enable row level security;

create policy conference_creation_operations_select_own
on public.conference_creation_operations for select
to authenticated
using (user_id = auth.uid());

revoke all on table public.conference_creation_operations from public;
revoke all on table public.conference_creation_operations from anon;
revoke all on table public.conference_creation_operations from authenticated;
grant select on table public.conference_creation_operations to authenticated;

create or replace function public.create_conference_idempotent(
  p_operation_id uuid,
  p_requested_conference_id uuid,
  p_name text,
  p_initial_metadata jsonb default '{}'::jsonb
)
returns jsonb
-- JSON contract:
-- {status, operationId, conferenceId, created, errorCode?}
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_metadata jsonb := coalesce(p_initial_metadata, '{}'::jsonb);
  existing_operation public.conference_creation_operations%rowtype;
  existing_conference_owner uuid;
  violated_constraint text;
begin
  if current_user_id is null then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'AUTH_REQUIRED',
      'operationId', p_operation_id
    );
  end if;
  if p_operation_id is null then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'INVALID_OPERATION_ID',
      'operationId', p_operation_id
    );
  end if;
  if p_requested_conference_id is null then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'INVALID_CONFERENCE_ID',
      'operationId', p_operation_id
    );
  end if;
  if normalized_name = '' or length(normalized_name) > 500
    or jsonb_typeof(normalized_metadata) <> 'object' then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'INVALID_REQUEST',
      'operationId', p_operation_id
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      current_user_id::text || ':conference-create:' || p_operation_id::text,
      0
    )
  );

  select *
    into existing_operation
    from public.conference_creation_operations as creation_operation
   where creation_operation.user_id = current_user_id
     and creation_operation.operation_id = p_operation_id;

  if found then
    if existing_operation.conference_id <> p_requested_conference_id then
      return jsonb_build_object(
        'status', 'operation_mismatch',
        'errorCode', 'OPERATION_RESULT_MISMATCH',
        'operationId', p_operation_id,
        'conferenceId', existing_operation.conference_id,
        'created', false
      );
    end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'operationId', existing_operation.operation_id,
      'conferenceId', existing_operation.conference_id,
      'created', false
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'conference-id:' || p_requested_conference_id::text,
      0
    )
  );

  select conference.owner_id
    into existing_conference_owner
    from public.conferences as conference
   where conference.id = p_requested_conference_id;

  if found then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'CONFERENCE_ID_ALREADY_USED',
      'operationId', p_operation_id,
      'created', false
    );
  end if;

  insert into public.conferences (id, name, owner_id)
  values (p_requested_conference_id, normalized_name, current_user_id);

  insert into public.conference_creation_operations (
    user_id,
    operation_id,
    conference_id,
    initial_metadata
  ) values (
    current_user_id,
    p_operation_id,
    p_requested_conference_id,
    normalized_metadata
  );

  return jsonb_build_object(
    'status', 'created',
    'operationId', p_operation_id,
    'conferenceId', p_requested_conference_id,
    'created', true
  );
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    select *
      into existing_operation
      from public.conference_creation_operations as creation_operation
     where creation_operation.user_id = current_user_id
       and creation_operation.operation_id = p_operation_id;
    if found and
      existing_operation.conference_id = p_requested_conference_id then
      return jsonb_build_object(
        'status', 'duplicate',
        'operationId', existing_operation.operation_id,
        'conferenceId', existing_operation.conference_id,
        'created', false
      );
    end if;
    if found then
      return jsonb_build_object(
        'status', 'operation_mismatch',
        'errorCode', 'OPERATION_RESULT_MISMATCH',
        'operationId', p_operation_id,
        'conferenceId', existing_operation.conference_id,
        'created', false
      );
    end if;
    if violated_constraint in (
      'conference_creation_operations_conference_key',
      'conferences_pkey'
    ) then
      return jsonb_build_object(
        'status', 'invalid_request',
        'errorCode', 'CONFERENCE_ID_ALREADY_USED',
        'operationId', p_operation_id,
        'created', false
      );
    end if;
    raise;
end;
$$;

revoke all on function public.create_conference_idempotent(
  uuid, uuid, text, jsonb
) from public;
revoke all on function public.create_conference_idempotent(
  uuid, uuid, text, jsonb
) from anon;
grant execute on function public.create_conference_idempotent(
  uuid, uuid, text, jsonb
) to authenticated;

commit;
