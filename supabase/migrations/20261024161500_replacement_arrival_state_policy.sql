begin;

-- Arrival belongs to a person and is never inherited by a replacement.
do $migration$
declare
  definition text;
  inherited text := 'p_extra_type,case when old_stay.arrived_at is null then null else statement_timestamp() end,' || chr(10) ||
                    '  case when old_stay.arrived_at is null then null else actor end,actor,actor';
  pending text := 'p_extra_type,null,null,actor,actor';
begin
  definition := pg_get_functiondef('public.replace_conference_accommodation(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text)'::regprocedure);
  if position(inherited in definition) = 0 then
    if position(pending in definition) > 0 then return; end if;
    raise exception 'REPLACEMENT_ARRIVAL_POLICY_SOURCE_MISMATCH';
  end if;
  execute replace(definition,inherited,pending);
end
$migration$;

comment on function public.replace_conference_accommodation(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text) is
  'Atomic idempotent occupant replacement. The successor starts pending arrival; arrival state is never inherited between people.';

commit;
