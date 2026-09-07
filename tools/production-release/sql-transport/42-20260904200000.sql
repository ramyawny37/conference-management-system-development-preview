begin;

-- A stored generated column is null in NEW while a BEFORE UPDATE trigger runs.
-- Normalize only that generated value while proving that the initial four
-- financial snapshots are the sole business values changed on the posted row.
create or replace function warehouse_private.protect_posted_header() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then
    raise exception 'WAREHOUSE_DOCUMENT_DELETE_PROHIBITED' using errcode='55000';
  end if;

  if old.status='reversed' then
    raise exception 'WAREHOUSE_REVERSED_DOCUMENT_IMMUTABLE' using errcode='55000';
  end if;

  if old.status='posted' then
    if new.status='posted'
       and to_jsonb(old) ? 'operation_total_snapshot'
       and to_jsonb(old)->'previous_balance_snapshot'='null'::jsonb
       and to_jsonb(old)->'operation_total_snapshot'='null'::jsonb
       and to_jsonb(old)->'remaining_snapshot'='null'::jsonb
       and to_jsonb(old)->'resulting_balance_snapshot'='null'::jsonb
       and to_jsonb(new)->'previous_balance_snapshot'<>'null'::jsonb
       and to_jsonb(new)->'operation_total_snapshot'<>'null'::jsonb
       and to_jsonb(new)->'remaining_snapshot'<>'null'::jsonb
       and to_jsonb(new)->'resulting_balance_snapshot'<>'null'::jsonb
       and (
         to_jsonb(new)
         || jsonb_build_object(
           'previous_balance_snapshot',to_jsonb(old)->'previous_balance_snapshot',
           'operation_total_snapshot',to_jsonb(old)->'operation_total_snapshot',
           'remaining_snapshot',to_jsonb(old)->'remaining_snapshot',
           'resulting_balance_snapshot',to_jsonb(old)->'resulting_balance_snapshot'
         )
         || case
              when to_jsonb(old) ? 'document_kind'
              then jsonb_build_object('document_kind',to_jsonb(old)->'document_kind')
              else '{}'::jsonb
            end
       ) is not distinct from to_jsonb(old) then
      return new;
    end if;

    -- Preserve the existing, exact posted-to-reversed lifecycle exception.
    if new.status='reversed'
       and new.reversed_at is not null
       and old.reversed_at is null
       and new.posted_at is not distinct from old.posted_at
       and new.posted_at is not null
       and new.revision is not distinct from old.revision
       and (
         to_jsonb(new)
         || jsonb_build_object(
           'status',to_jsonb(old.status),
           'reversed_at',to_jsonb(old.reversed_at),
           'updated_at',to_jsonb(old.updated_at)
         )
         || case
              when to_jsonb(old) ? 'document_kind'
              then jsonb_build_object('document_kind',to_jsonb(old)->'document_kind')
              else '{}'::jsonb
            end
       ) is not distinct from to_jsonb(old) then
      return new;
    end if;

    raise exception 'WAREHOUSE_POSTED_DOCUMENT_IMMUTABLE' using errcode='55000';
  end if;

  return new;
end; $$;

commit;
