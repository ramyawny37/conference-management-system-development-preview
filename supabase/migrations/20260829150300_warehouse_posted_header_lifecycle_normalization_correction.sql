begin;

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
    if new.status='reversed'
       and new.reversed_at is not null
       and old.reversed_at is null
       and new.posted_at is not distinct from old.posted_at
       and new.posted_at is not null
       and new.revision is not distinct from old.revision
       and (
         to_jsonb(new) || jsonb_build_object(
           'status',to_jsonb(old.status),
           'reversed_at',to_jsonb(old.reversed_at),
           'updated_at',to_jsonb(old.updated_at)
         )
       ) is not distinct from to_jsonb(old) then
      return new;
    end if;

    raise exception 'WAREHOUSE_POSTED_DOCUMENT_IMMUTABLE' using errcode='55000';
  end if;

  return new;
end; $$;

commit;
