begin;

do $$
begin
  if to_regclass('public.platform_modules') is null
     or to_regprocedure('public.require_module_permission(uuid,text,text,text,text)') is null then
    raise exception 'PLATFORM_MODULE_AUTHORIZATION_FOUNDATION_REQUIRED' using errcode = '55000';
  end if;
end;
$$;

insert into public.platform_modules(module_key, display_name, status)
values
  ('conference', 'Conference Management', 'active'),
  ('warehouse', 'Warehouse Management', 'active'),
  ('reservations', 'Reservations', 'active'),
  ('custody', 'Custody & Advances', 'active')
on conflict (module_key) do update
set display_name = excluded.display_name,
    updated_at = case
      when public.platform_modules.display_name is distinct from excluded.display_name
        then statement_timestamp()
      else public.platform_modules.updated_at
    end
where public.platform_modules.status = 'active';

do $$
begin
  if exists (
    select 1
      from (values ('conference'), ('warehouse'), ('reservations'), ('custody')) expected(module_key)
      left join public.platform_modules modules using (module_key)
     where modules.module_key is null or modules.status <> 'active'
  ) then
    raise exception 'PLATFORM_MODULE_REGISTRATION_CONFLICT' using errcode = '55000';
  end if;
end;
$$;

commit;
