begin;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_publication as publication
      join pg_catalog.pg_publication_rel as publication_relation
        on publication_relation.prpubid = publication.oid
      join pg_catalog.pg_class as relation
        on relation.oid = publication_relation.prrelid
      join pg_catalog.pg_namespace as relation_namespace
        on relation_namespace.oid = relation.relnamespace
     where publication.pubname = 'supabase_realtime'
       and relation_namespace.nspname = 'public'
       and relation.relname = 'conference_snapshots'
  ) then
    alter publication supabase_realtime
      add table public.conference_snapshots;
  end if;
end;
$$;

commit;
