begin;
do $migration$
declare
  signature regprocedure := 'public.mutate_conference_accommodation_operations(uuid,uuid,uuid,text,jsonb)'::regprocedure;
  definition text;
  marker text := 'select new_values into result from platform.audit_events';
  replacement text := 'select ae.new_values into result from platform.audit_events ae';
begin
  definition := pg_get_functiondef(signature);
  if position(replacement in definition)>0 then return; end if;
  if position(marker in definition)=0 then
    raise exception 'CONFERENCE_ACCOMMODATION_AUDIT_LOOKUP_MARKER_MISSING' using errcode='55000';
  end if;
  execute replace(definition,marker,replacement);
end $migration$;
commit;
