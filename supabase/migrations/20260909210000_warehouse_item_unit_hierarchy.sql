begin;

alter table warehouse.item_units
  add column reference_unit_id uuid,
  add column reference_quantity numeric(20,6);

update warehouse.item_units iu
set reference_unit_id=i.base_unit_id,
    reference_quantity=iu.conversion_factor
from warehouse.items i
where i.id=iu.item_id and iu.unit_id<>i.base_unit_id;

alter table warehouse.item_units
  add constraint warehouse_item_units_reference_pair_check check (
    (reference_unit_id is null and reference_quantity is null)
    or (reference_unit_id is not null and reference_quantity is not null and reference_quantity>0 and reference_quantity<'Infinity'::numeric)
  ),
  add constraint warehouse_item_units_reference_not_self_check check (reference_unit_id is null or reference_unit_id<>unit_id),
  add constraint warehouse_item_units_same_item_reference_fk foreign key(item_id,reference_unit_id)
    references warehouse.item_units(item_id,unit_id) on delete restrict deferrable initially deferred;

create or replace function warehouse_private.validate_and_derive_item_unit_graph(p_item_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_base_unit_id uuid; v_relation_count integer; v_resolved_count integer;
begin
  select i.base_unit_id into v_base_unit_id from warehouse.items i where i.id=p_item_id for key share;
  if v_base_unit_id is null then raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023'; end if;
  if not exists(select 1 from warehouse.item_units iu where iu.item_id=p_item_id and iu.unit_id=v_base_unit_id and iu.status='active' and iu.reference_unit_id is null and iu.reference_quantity is null and iu.conversion_factor=1) then
    raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023';
  end if;
  if exists(select 1 from warehouse.item_units iu where iu.item_id=p_item_id and iu.unit_id<>v_base_unit_id and (iu.reference_unit_id is null or iu.reference_quantity is null or iu.reference_quantity<=0)) then
    raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023';
  end if;
  if exists(select 1 from warehouse.item_units iu left join warehouse.item_units parent on parent.item_id=iu.item_id and parent.unit_id=iu.reference_unit_id where iu.item_id=p_item_id and iu.unit_id<>v_base_unit_id and parent.unit_id is null) then
    raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023';
  end if;
  if exists(select 1 from warehouse.item_units iu join warehouse.item_units parent on parent.item_id=iu.item_id and parent.unit_id=iu.reference_unit_id where iu.item_id=p_item_id and iu.status='active' and parent.status<>'active') then
    raise exception 'WAREHOUSE_ITEM_UNIT_INACTIVE' using errcode='22023';
  end if;
  select count(*) into v_relation_count from warehouse.item_units iu where iu.item_id=p_item_id;
  with recursive resolved(unit_id,factor,path) as (
    select v_base_unit_id,1::numeric,array[v_base_unit_id]
    union all
    select child.unit_id,resolved.factor*child.reference_quantity,resolved.path||child.unit_id
    from resolved join warehouse.item_units child on child.item_id=p_item_id and child.reference_unit_id=resolved.unit_id
    where not child.unit_id=any(resolved.path)
  ) select count(*) into v_resolved_count from resolved;
  if v_resolved_count<>v_relation_count then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
  begin
    if exists(
      with recursive resolved(unit_id,factor,path) as (
        select v_base_unit_id,1::numeric,array[v_base_unit_id]
        union all
        select child.unit_id,resolved.factor*child.reference_quantity,resolved.path||child.unit_id
        from resolved join warehouse.item_units child on child.item_id=p_item_id and child.reference_unit_id=resolved.unit_id
        where not child.unit_id=any(resolved.path)
      ) select 1 from resolved where factor<=0 or factor>=100000000000000::numeric
    ) then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
    with recursive resolved(unit_id,factor,path) as (
      select v_base_unit_id,1::numeric,array[v_base_unit_id]
      union all
      select child.unit_id,resolved.factor*child.reference_quantity,resolved.path||child.unit_id
      from resolved join warehouse.item_units child on child.item_id=p_item_id and child.reference_unit_id=resolved.unit_id
      where not child.unit_id=any(resolved.path)
    )
    update warehouse.item_units iu set conversion_factor=resolved.factor,updated_at=statement_timestamp()
    from resolved where iu.item_id=p_item_id and iu.unit_id=resolved.unit_id;
  exception when numeric_value_out_of_range then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end;
end $$;
revoke all on function warehouse_private.validate_and_derive_item_unit_graph(uuid) from public,anon,authenticated,service_role;
grant execute on function warehouse_private.validate_and_derive_item_unit_graph(uuid) to postgres;

create or replace function warehouse_private.enforce_item_unit_relationship() returns trigger language plpgsql set search_path='' as $$
declare v_base uuid;
begin
  select i.base_unit_id into v_base from warehouse.items i where i.id=new.item_id;
  if new.unit_id=v_base then
    if new.reference_unit_id is not null or new.reference_quantity is not null or new.conversion_factor<>1 or new.status<>'active' then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
  elsif new.reference_unit_id is null or new.reference_quantity is null or new.reference_quantity<=0 or new.reference_quantity>='Infinity'::numeric then
    raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023';
  end if;
  return new;
end $$;
create trigger item_units_relationship_guard before insert or update on warehouse.item_units for each row execute function warehouse_private.enforce_item_unit_relationship();

create or replace function warehouse_private.sync_item_base_unit() returns trigger language plpgsql set search_path=pg_catalog,warehouse,warehouse_private as $$
declare v_new_base_factor numeric;
begin
  if tg_op='UPDATE' and old.base_unit_id<>new.base_unit_id then
    select iu.conversion_factor into v_new_base_factor from warehouse.item_units iu where iu.item_id=new.id and iu.unit_id=new.base_unit_id and iu.status='active';
    if v_new_base_factor is null or v_new_base_factor<=0 then raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023'; end if;
    update warehouse.item_units iu set reference_unit_id=new.base_unit_id,reference_quantity=iu.conversion_factor/v_new_base_factor,conversion_factor=iu.conversion_factor/v_new_base_factor,updated_by=new.updated_by,updated_at=statement_timestamp(),revision=iu.revision+1 where iu.item_id=new.id and iu.unit_id<>new.base_unit_id;
  end if;
  insert into warehouse.item_units(item_id,unit_id,conversion_factor,reference_unit_id,reference_quantity,status,created_by,updated_by)
  values(new.id,new.base_unit_id,1,null,null,'active',new.updated_by,new.updated_by)
  on conflict(item_id,unit_id) do update set conversion_factor=1,reference_unit_id=null,reference_quantity=null,status='active',updated_by=new.updated_by,updated_at=statement_timestamp(),revision=warehouse.item_units.revision+1;
  perform warehouse_private.validate_and_derive_item_unit_graph(new.id);
  return new;
end $$;

create or replace function warehouse.upsert_item_units(p_device_id uuid,p_operation_id uuid,p_item_id uuid,p_expected_revision bigint,p_units jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare context jsonb; replay jsonb; actor uuid; item warehouse.items%rowtype; entry jsonb; target_unit_id uuid; target_reference_unit_id uuid; target_reference_quantity numeric; target_status text; result jsonb;
begin
  context:=warehouse_private.require_permission(p_device_id,'warehouse.item.update'); actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'warehouse.item_units.update',p_item_id,'{}',jsonb_build_object('revision',p_expected_revision,'units',p_units)); if replay is not null then return replay; end if;
  select * into item from warehouse.items where id=p_item_id for update;
  if item.id is null or item.revision<>p_expected_revision then raise exception 'WAREHOUSE_MASTER_REVISION_CONFLICT' using errcode='40001'; end if;
  if jsonb_typeof(p_units)<>'array' then raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_units) x group by x->>'unitId' having count(*)>1) then raise exception 'WAREHOUSE_ITEM_UNIT_DUPLICATE' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_units) x where x ?| array['conversionFactor','conversion_factor']) then raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023'; end if;
  for entry in select * from jsonb_array_elements(p_units) loop
    begin
      target_unit_id:=(entry->>'unitId')::uuid;
      target_reference_unit_id:=nullif(entry->>'referenceUnitId','')::uuid;
      target_reference_quantity:=nullif(entry->>'referenceQuantity','')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end;
    target_status:=coalesce(entry->>'status','active');
    if target_status not in('active','inactive') or not exists(select 1 from warehouse.units where id=target_unit_id) then raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023'; end if;
    if target_unit_id=item.base_unit_id then
      if target_reference_unit_id is not null or target_reference_quantity is not null or target_status<>'active' then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
      insert into warehouse.item_units(item_id,unit_id,conversion_factor,reference_unit_id,reference_quantity,status,created_by,updated_by) values(item.id,target_unit_id,1,null,null,'active',actor,actor)
      on conflict(item_id,unit_id) do update set conversion_factor=1,reference_unit_id=null,reference_quantity=null,status='active',updated_by=actor,updated_at=statement_timestamp(),revision=warehouse.item_units.revision+1;
    else
      if target_reference_unit_id is null or target_reference_quantity is null or target_reference_quantity<=0 or target_reference_quantity>='Infinity'::numeric or target_reference_unit_id=target_unit_id then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
      insert into warehouse.item_units(item_id,unit_id,conversion_factor,reference_unit_id,reference_quantity,status,created_by,updated_by) values(item.id,target_unit_id,1,target_reference_unit_id,target_reference_quantity,target_status,actor,actor)
      on conflict(item_id,unit_id) do update set reference_unit_id=excluded.reference_unit_id,reference_quantity=excluded.reference_quantity,status=excluded.status,updated_by=actor,updated_at=statement_timestamp(),revision=warehouse.item_units.revision+1;
    end if;
  end loop;
  perform warehouse_private.validate_and_derive_item_unit_graph(item.id);
  update warehouse.items set revision=revision+1,updated_by=actor,updated_at=statement_timestamp() where id=item.id returning revision into item.revision;
  result:=jsonb_build_object('entityKind','itemUnits','entityId',item.id,'revision',item.revision);
  perform warehouse_private.write_audit(context,'item_units.changed','warehouse.item.update','{}',p_operation_id,null,'itemUnits',null,null,item.revision,null,null,null,null,result);
  return warehouse_private.complete_operation(p_operation_id,result);
end $$;

revoke all on function warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb) to service_role;

commit;
