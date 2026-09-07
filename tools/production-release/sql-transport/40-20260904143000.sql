begin;

create sequence warehouse.category_code_sequence;

create function warehouse_private.next_category_code() returns text
language plpgsql volatile
set search_path=pg_catalog,warehouse
as $$
declare candidate text;
begin
  perform pg_advisory_xact_lock(hashtextextended('warehouse-category-code-allocation',0));
  loop
    candidate := 'CAT-'||lpad(nextval('warehouse.category_code_sequence')::text,6,'0');
    exit when not exists(select 1 from warehouse.categories where code=candidate);
  end loop;
  return candidate;
end;
$$;

revoke all on function warehouse_private.next_category_code() from public,anon,authenticated;

create or replace function warehouse.upsert_item_master(p_device_id uuid,p_operation_id uuid,p_entity_kind text,p_entity_id uuid,p_expected_revision bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare permission text; context jsonb; replay jsonb; actor uuid; result jsonb; row_id uuid; next_revision bigint; identifier text;
begin
  permission:=case when p_entity_id is null then 'warehouse.item.create' else 'warehouse.item.update' end;
  context:=warehouse_private.require_permission(p_device_id,permission); actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,permission||':'||p_entity_kind,p_entity_id,'{}',jsonb_build_object('kind',p_entity_kind,'id',p_entity_id,'revision',p_expected_revision,'payload',p_payload)); if replay is not null then return replay; end if;
  if p_entity_kind='category' then
    perform warehouse_private.require_master_payload(p_payload,array['name'],array['code','name','description','parentId','status']);
    perform pg_advisory_xact_lock(hashtextextended('warehouse-category-hierarchy',0));
    if p_entity_id is null then
      identifier:=nullif(upper(btrim(p_payload->>'code')),'');
      if identifier is null then identifier:=warehouse_private.next_category_code(); else perform pg_advisory_xact_lock(hashtextextended('warehouse-category-code-allocation',0)); end if;
      insert into warehouse.categories(code,name,description,parent_id,status,created_by,updated_by)
      values(identifier,p_payload->>'name',nullif(p_payload->>'description',''),nullif(p_payload->>'parentId','')::uuid,coalesce(p_payload->>'status','active'),actor,actor)
      returning id,revision,code into row_id,next_revision,identifier;
    else
      perform 1 from warehouse.categories where id=p_entity_id for update;
      if p_payload->>'status'='inactive' and exists(select 1 from warehouse.items where category_id=p_entity_id and status='active') then raise exception 'WAREHOUSE_CATEGORY_HAS_ACTIVE_ITEMS' using errcode='55000'; end if;
      update warehouse.categories set name=p_payload->>'name',description=nullif(p_payload->>'description',''),parent_id=nullif(p_payload->>'parentId','')::uuid,status=coalesce(p_payload->>'status',status),updated_by=actor,updated_at=statement_timestamp(),revision=revision+1
      where id=p_entity_id and revision=p_expected_revision returning id,revision,code into row_id,next_revision,identifier;
    end if;
  elsif p_entity_kind='unit' then
    perform warehouse_private.require_master_payload(p_payload,array['name','symbol','precision'],array['code','name','symbol','precision','status']);
    if p_entity_id is null then
      identifier:=nullif(upper(btrim(p_payload->>'code')),'');
      if identifier is null then identifier:=warehouse_private.next_unit_code(); else perform pg_advisory_xact_lock(hashtextextended('warehouse-unit-code-allocation',0)); end if;
      insert into warehouse.units(code,name,symbol,precision,status,created_by,updated_by)
      values(identifier,p_payload->>'name',p_payload->>'symbol',(p_payload->>'precision')::smallint,coalesce(p_payload->>'status','active'),actor,actor)
      returning id,revision,code into row_id,next_revision,identifier;
    else
      perform 1 from warehouse.units where id=p_entity_id for update;
      if p_payload->>'status'='inactive' and exists(select 1 from warehouse.items where base_unit_id=p_entity_id and status='active') then raise exception 'WAREHOUSE_UNIT_HAS_ACTIVE_ITEMS' using errcode='55000'; end if;
      update warehouse.units set code=coalesce(nullif(upper(btrim(p_payload->>'code')),''),code),name=p_payload->>'name',symbol=p_payload->>'symbol',precision=(p_payload->>'precision')::smallint,status=coalesce(p_payload->>'status',status),updated_by=actor,updated_at=statement_timestamp(),revision=revision+1
      where id=p_entity_id and revision=p_expected_revision returning id,revision,code into row_id,next_revision,identifier;
    end if;
  elsif p_entity_kind='item' then
    perform warehouse_private.require_master_payload(p_payload,array['name','categoryId','baseUnitId'],array['sku','name','categoryId','baseUnitId','barcode','defaultPurchasePrice','defaultIssuePrice','minimumStock','status','notes']);
    perform 1 from warehouse.categories where id=(p_payload->>'categoryId')::uuid for key share;
    perform 1 from warehouse.units where id=(p_payload->>'baseUnitId')::uuid for key share;
    if not exists(select 1 from warehouse.categories where id=(p_payload->>'categoryId')::uuid and status='active') or not exists(select 1 from warehouse.units where id=(p_payload->>'baseUnitId')::uuid and status='active') then raise exception 'ACTIVE_CATEGORY_AND_UNIT_REQUIRED' using errcode='55000'; end if;
    if p_entity_id is null then
      identifier:=nullif(upper(btrim(p_payload->>'sku')),'');
      if identifier is null then identifier:=warehouse_private.next_item_sku(); else perform pg_advisory_xact_lock(hashtextextended('warehouse-item-sku-allocation',0)); end if;
      insert into warehouse.items(sku,name,category_id,base_unit_id,barcode,default_purchase_price,default_issue_price,minimum_stock,status,notes,created_by,updated_by)
      values(identifier,p_payload->>'name',(p_payload->>'categoryId')::uuid,(p_payload->>'baseUnitId')::uuid,nullif(p_payload->>'barcode',''),coalesce((p_payload->>'defaultPurchasePrice')::numeric,0),coalesce((p_payload->>'defaultIssuePrice')::numeric,0),coalesce((p_payload->>'minimumStock')::numeric,0),coalesce(p_payload->>'status','active'),p_payload->>'notes',actor,actor)
      returning id,revision,sku into row_id,next_revision,identifier;
    else
      update warehouse.items set sku=coalesce(nullif(upper(btrim(p_payload->>'sku')),''),sku),name=p_payload->>'name',category_id=(p_payload->>'categoryId')::uuid,base_unit_id=(p_payload->>'baseUnitId')::uuid,barcode=nullif(p_payload->>'barcode',''),default_purchase_price=coalesce((p_payload->>'defaultPurchasePrice')::numeric,default_purchase_price),default_issue_price=coalesce((p_payload->>'defaultIssuePrice')::numeric,default_issue_price),minimum_stock=coalesce((p_payload->>'minimumStock')::numeric,minimum_stock),status=coalesce(p_payload->>'status',status),notes=p_payload->>'notes',updated_by=actor,updated_at=statement_timestamp(),revision=revision+1
      where id=p_entity_id and revision=p_expected_revision returning id,revision,sku into row_id,next_revision,identifier;
    end if;
  else raise exception 'WAREHOUSE_MASTER_ENTITY_INVALID' using errcode='22023'; end if;
  if row_id is null then raise exception 'WAREHOUSE_MASTER_REVISION_CONFLICT' using errcode='40001'; end if;
  result:=jsonb_build_object('entityKind',p_entity_kind,'entityId',row_id,'revision',next_revision,'identifier',identifier);
  perform warehouse_private.write_audit(context,'item_master.changed',permission,'{}',p_operation_id,null,p_entity_kind,null,null,next_revision,null,null,null,null,result);
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

commit;
