begin;

do $$
begin
  if to_regclass('public.platform_modules') is null
     or to_regclass('public.module_permission_catalog') is null
     or to_regclass('public.module_permission_grants') is null
     or to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)') is null
     or to_regprocedure('public.require_current_approved_device(uuid)') is null then
    raise exception 'WAREHOUSE_PLATFORM_FOUNDATION_CONTRACT_MISMATCH' using errcode = '55000';
  end if;
end;
$$;

insert into public.platform_modules(module_key, display_name, status)
values ('warehouse', 'Warehouse Management', 'active')
on conflict (module_key) do update
set display_name = excluded.display_name,
    updated_at = case
      when public.platform_modules.display_name is distinct from excluded.display_name
        then statement_timestamp()
      else public.platform_modules.updated_at
    end
where public.platform_modules.status = 'active';

do $$
declare
  unexpected text[];
begin
  if exists (
    select 1 from public.platform_modules
     where module_key = 'warehouse' and status <> 'active'
  ) then
    raise exception 'WAREHOUSE_MODULE_REGISTRATION_CONFLICT' using errcode = '55000';
  end if;

  with expected(permission_key, display_name, description, scope_mode, resource_type, sensitive) as (
    values
      ('warehouse.store.view','View stores','View Warehouse stores within the granted scope.','both','store',false),
      ('warehouse.store.create','Create stores','Create a Warehouse store.','module',null,true),
      ('warehouse.store.update','Update stores','Update or deactivate a Warehouse store.','both','store',true),
      ('warehouse.item.view','View item master','View Warehouse categories, units, and items.','module',null,false),
      ('warehouse.item.create','Create item master','Create Warehouse categories, units, and items.','module',null,true),
      ('warehouse.item.update','Update item master','Update or deactivate Warehouse categories, units, and items.','module',null,true),
      ('warehouse.stock.receive','Receive stock','Create and edit receipt documents for a store.','both','store',true),
      ('warehouse.stock.issue','Issue stock','Create and edit issue documents for a store.','both','store',true),
      ('warehouse.stock.transfer','Transfer stock','Create and edit transfers with authority over both stores.','both','store',true),
      ('warehouse.stock.adjust','Adjust stock','Create opening, adjustment, damage, loss, correction, and reversal requests.','both','store',true),
      ('warehouse.stock.approve','Approve stock changes','Approve controlled stock adjustments and reversals.','both','store',true),
      ('warehouse.stock.post','Post stock changes','Post or reverse stock documents into the immutable ledger.','both','store',true),
      ('warehouse.reports.view','View Warehouse reports','View inventory reports within the granted scope.','both','store',false),
      ('warehouse.reports.export','Export Warehouse reports','Authorize an inventory report export within the granted scope.','both','store',true),
      ('warehouse.import.stage','Stage Warehouse imports','Authorize validation and staging only; does not authorize business posting.','module',null,true)
  )
  select array_agg(expected.permission_key order by expected.permission_key)
    into unexpected
    from expected
    join public.module_permission_catalog catalog using (permission_key)
   where catalog.module_key <> 'warehouse'
      or catalog.display_name <> expected.display_name
      or catalog.description <> expected.description
      or catalog.allowed_scope_mode <> expected.scope_mode
      or catalog.allowed_resource_type is distinct from expected.resource_type
      or catalog.sensitive_mutation <> expected.sensitive
      or catalog.status <> 'active'
      or catalog.catalog_version <> 1
      or catalog.retired_at is not null;

  if unexpected is not null then
    raise exception 'WAREHOUSE_PERMISSION_CATALOG_CONFLICT: %', unexpected using errcode = '55000';
  end if;

  with expected(permission_key, display_name, description, scope_mode, resource_type, sensitive) as (
    values
      ('warehouse.store.view','View stores','View Warehouse stores within the granted scope.','both','store',false),
      ('warehouse.store.create','Create stores','Create a Warehouse store.','module',null,true),
      ('warehouse.store.update','Update stores','Update or deactivate a Warehouse store.','both','store',true),
      ('warehouse.item.view','View item master','View Warehouse categories, units, and items.','module',null,false),
      ('warehouse.item.create','Create item master','Create Warehouse categories, units, and items.','module',null,true),
      ('warehouse.item.update','Update item master','Update or deactivate Warehouse categories, units, and items.','module',null,true),
      ('warehouse.stock.receive','Receive stock','Create and edit receipt documents for a store.','both','store',true),
      ('warehouse.stock.issue','Issue stock','Create and edit issue documents for a store.','both','store',true),
      ('warehouse.stock.transfer','Transfer stock','Create and edit transfers with authority over both stores.','both','store',true),
      ('warehouse.stock.adjust','Adjust stock','Create opening, adjustment, damage, loss, correction, and reversal requests.','both','store',true),
      ('warehouse.stock.approve','Approve stock changes','Approve controlled stock adjustments and reversals.','both','store',true),
      ('warehouse.stock.post','Post stock changes','Post or reverse stock documents into the immutable ledger.','both','store',true),
      ('warehouse.reports.view','View Warehouse reports','View inventory reports within the granted scope.','both','store',false),
      ('warehouse.reports.export','Export Warehouse reports','Authorize an inventory report export within the granted scope.','both','store',true),
      ('warehouse.import.stage','Stage Warehouse imports','Authorize validation and staging only; does not authorize business posting.','module',null,true)
  )
  insert into public.module_permission_catalog(
    permission_key,module_key,display_name,description,status,
    allowed_scope_mode,allowed_resource_type,sensitive_mutation,catalog_version
  )
  select permission_key,'warehouse',display_name,description,'active',
         scope_mode,resource_type,sensitive,1
    from expected
  on conflict (permission_key) do nothing;
end;
$$;

commit;
