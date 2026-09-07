begin;

create or replace function warehouse.upsert_item_units(p_device_id uuid,p_operation_id uuid,p_item_id uuid,p_expected_revision bigint,p_units jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare context jsonb; replay jsonb; actor uuid; item warehouse.items%rowtype; entry jsonb; target_unit_id uuid; factor numeric; target_status text; result jsonb;
begin
  context:=warehouse_private.require_permission(p_device_id,'warehouse.item.update'); actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'warehouse.item_units.update',p_item_id,'{}',jsonb_build_object('revision',p_expected_revision,'units',p_units)); if replay is not null then return replay; end if;
  select * into item from warehouse.items where id=p_item_id for update;
  if item.id is null or item.revision<>p_expected_revision then raise exception 'WAREHOUSE_MASTER_REVISION_CONFLICT' using errcode='40001'; end if;
  if jsonb_typeof(p_units)<>'array' then raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_units) x group by x->>'unitId' having count(*)>1) then raise exception 'WAREHOUSE_ITEM_UNIT_DUPLICATE' using errcode='22023'; end if;
  for entry in select * from jsonb_array_elements(p_units) loop
    target_unit_id:=(entry->>'unitId')::uuid; factor:=(entry->>'conversionFactor')::numeric; target_status:=coalesce(entry->>'status','active');
    if factor<=0 or factor>='Infinity'::numeric then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
    if target_unit_id=item.base_unit_id and (factor<>1 or target_status<>'active') then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
    if not exists(select 1 from warehouse.units where id=target_unit_id) then raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023'; end if;
    insert into warehouse.item_units(item_id,unit_id,conversion_factor,status,created_by,updated_by) values(item.id,target_unit_id,factor,target_status,actor,actor)
    on conflict(item_id,unit_id) do update set conversion_factor=excluded.conversion_factor,status=excluded.status,updated_by=actor,updated_at=statement_timestamp(),revision=warehouse.item_units.revision+1;
  end loop;
  if not exists(select 1 from warehouse.item_units where item_id=item.id and unit_id=item.base_unit_id and conversion_factor=1 and status='active') then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
  update warehouse.items set revision=revision+1,updated_by=actor,updated_at=statement_timestamp() where id=item.id returning revision into item.revision;
  result:=jsonb_build_object('entityKind','itemUnits','entityId',item.id,'revision',item.revision);
  perform warehouse_private.write_audit(context,'item_units.changed','warehouse.item.update','{}',p_operation_id,null,'itemUnits',null,null,item.revision,null,null,null,null,result);
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

revoke all on function warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb) to service_role;

commit;
