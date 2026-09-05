create or replace function warehouse_private.canonicalize_unit_lines(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse as $$
declare source_line jsonb; canonical jsonb:='[]'; item warehouse.items%rowtype; relation warehouse.item_units%rowtype; selected warehouse.units%rowtype; base warehouse.units%rowtype; entered numeric; raw_base_quantity numeric; base_quantity numeric; selected_cost numeric; selected_price numeric; uses_inbound_cost boolean;
begin
  if jsonb_typeof(p_payload->'lines')<>'array' then return p_payload; end if;
  for source_line in select * from jsonb_array_elements(p_payload->'lines') loop
    select * into item from warehouse.items where id=(source_line->>'itemId')::uuid for key share;
    select * into selected from warehouse.units where id=coalesce(nullif(source_line->>'unitId','')::uuid,item.base_unit_id) for key share;
    select * into base from warehouse.units where id=item.base_unit_id for key share;
    select * into relation from warehouse.item_units iu where iu.item_id=item.id and iu.unit_id=selected.id for key share;
    if relation.item_id is null then raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023'; end if;
    if relation.status<>'active' or selected.status<>'active' then raise exception 'WAREHOUSE_ITEM_UNIT_INACTIVE' using errcode='22023'; end if;
    if relation.conversion_factor<=0 or relation.conversion_factor>='Infinity'::numeric then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
    entered:=(source_line->>'quantity')::numeric;
    if entered<=0 or entered<>round(entered,selected.precision) then raise exception 'WAREHOUSE_UNIT_CONVERSION_PRECISION_INVALID' using errcode='22023'; end if;
    raw_base_quantity:=entered*relation.conversion_factor;
    if raw_base_quantity<=0 or raw_base_quantity<>round(raw_base_quantity,base.precision) then raise exception 'WAREHOUSE_UNIT_CONVERSION_PRECISION_INVALID' using errcode='22023'; end if;
    base_quantity:=round(raw_base_quantity,base.precision);
    uses_inbound_cost:=source_line ? 'inboundUnitCost';
    selected_cost:=case when uses_inbound_cost then nullif(source_line->>'inboundUnitCost','')::numeric else nullif(source_line->>'unitCost','')::numeric end;
    selected_price:=coalesce(nullif(source_line->>'actualUnitPrice','')::numeric,nullif(source_line->>'unitPrice','')::numeric);
    source_line:=source_line||jsonb_build_object('unitId',selected.id,'enteredQuantity',entered,'conversionFactorSnapshot',relation.conversion_factor,'quantity',base_quantity);
    if selected_cost is not null and uses_inbound_cost then source_line:=source_line||jsonb_build_object('selectedUnitCost',selected_cost,'inboundUnitCost',round(selected_cost/relation.conversion_factor,6));
    elsif selected_cost is not null then source_line:=source_line||jsonb_build_object('selectedUnitCost',selected_cost,'unitCost',round(selected_cost/relation.conversion_factor,6)); end if;
    if selected_price is not null then source_line:=source_line||jsonb_build_object('selectedUnitPrice',selected_price,'unitPrice',round(selected_price/relation.conversion_factor,6),'actualUnitPrice',round(selected_price/relation.conversion_factor,6)); end if;
    canonical:=canonical||jsonb_build_array(source_line);
  end loop;
  return jsonb_set(p_payload,'{lines}',canonical,false);
end; $$;
revoke all on function warehouse_private.canonicalize_unit_lines(jsonb) from public,anon,authenticated;

create or replace function warehouse_private.create_document_draft(p_device_id uuid,p_operation_id uuid,p_kind text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare canonical jsonb; result jsonb; created_document_id uuid;
begin
  canonical:=warehouse_private.canonicalize_unit_lines(p_payload);
  result:=warehouse_private.create_document_draft_pre_unit_conversion(p_device_id,p_operation_id,p_kind,canonical); created_document_id:=(result->>'documentId')::uuid;
  if (p_kind='receipt' and not exists(select 1 from warehouse.receipt_documents where id=created_document_id and status='draft')) or (p_kind='issue' and not exists(select 1 from warehouse.issue_documents where id=created_document_id and status='draft')) or (p_kind='transfer' and not exists(select 1 from warehouse.transfer_documents where id=created_document_id and status='draft')) or (p_kind in ('opening_balance','adjustment','damage_loss','correction') and not exists(select 1 from warehouse.adjustment_documents where id=created_document_id and status='draft')) then return result; end if;
  if p_kind='receipt' then update warehouse.receipt_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric,selected_unit_cost=(x->>'selectedUnitCost')::numeric,selected_unit_price=(x->>'selectedUnitPrice')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=created_document_id and l.item_id=(x->>'itemId')::uuid;
  elsif p_kind='issue' then update warehouse.issue_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric,selected_unit_price=(x->>'selectedUnitPrice')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=created_document_id and l.item_id=(x->>'itemId')::uuid;
  elsif p_kind='transfer' then update warehouse.transfer_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=created_document_id and l.item_id=(x->>'itemId')::uuid;
  else update warehouse.adjustment_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric,selected_unit_cost=(x->>'selectedUnitCost')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=created_document_id and l.item_id=(x->>'itemId')::uuid; end if;
  return result;
end; $$;
revoke all on function warehouse_private.create_document_draft(uuid,uuid,text,jsonb) from public,anon,authenticated;
