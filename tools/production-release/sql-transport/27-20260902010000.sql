begin;

do $$
declare
  configured_schemas text;
begin
  select substring(setting from char_length('pgrst.db_schemas=') + 1)
    into configured_schemas
    from pg_roles as roles
    cross join lateral unnest(coalesce(roles.rolconfig, array[]::text[])) as setting
   where roles.rolname = 'authenticator'
     and setting like 'pgrst.db_schemas=%';

  if configured_schemas is distinct from 'public, graphql_public, platform'
     and configured_schemas is distinct from 'public, graphql_public, platform, warehouse' then
    raise exception 'WAREHOUSE_POSTGREST_SCHEMA_RECONCILIATION_PRECONDITION_FAILED'
      using errcode = '55000';
  end if;
end;
$$;

alter role authenticator
  set pgrst.db_schemas = 'public, graphql_public, platform, warehouse';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

commit;
