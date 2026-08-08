begin;

do $$
begin
  if to_regprocedure('extensions.digest(text,text)') is null
    or to_regprocedure('extensions.crypt(text,text)') is null then
    raise exception 'PGCRYPTO_EXTENSION_FUNCTIONS_REQUIRED';
  end if;
  if has_schema_privilege('public','extensions','create')
    or has_schema_privilege('anon','extensions','create')
    or has_schema_privilege('authenticated','extensions','create') then
    raise exception 'EXTENSIONS_SCHEMA_CREATE_PRIVILEGE_INVALID';
  end if;
end;
$$;

alter function public.complete_first_system_bootstrap(text,text,text,uuid,text,text,uuid)
  set search_path=pg_catalog,public,extensions;
alter function public.manage_organization(uuid,uuid,text,uuid,text,text)
  set search_path=pg_catalog,public,extensions;

commit;
