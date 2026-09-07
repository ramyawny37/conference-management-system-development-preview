begin;

create or replace function warehouse_private.create_document_draft(
  p_device_id uuid,
  p_operation_id uuid,
  p_kind text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare permission text; stores uuid[]; context jsonb; second_context jsonb; authorization_contexts jsonb:='[]'; replay jsonb; actor uuid; document_id uuid:=gen_random_uuid(); number text; line jsonb; approval text;
begin
  if p_kind='opening_balance' then
    p_payload:=jsonb_set(
      p_payload,
      '{reason}',
      to_jsonb(coalesce(nullif(btrim(p_payload->>'reason'),''),'رصيد افتتاحي')),
      true
    );
  end if;

  if p_kind='receipt' then permission:='warehouse.stock.receive'; stores:=array[(p_payload->>'destinationStoreId')::uuid];
  elsif p_kind='issue' then permission:='warehouse.stock.issue'; stores:=array[(p_payload->>'sourceStoreId')::uuid];
  elsif p_kind='transfer' then permission:='warehouse.stock.transfer'; stores:=array[(p_payload->>'sourceStoreId')::uuid,(p_payload->>'destinationStoreId')::uuid];
  elsif p_kind in ('opening_balance','adjustment','damage_loss','correction') then permission:='warehouse.stock.adjust'; stores:=array[(p_payload->>'storeId')::uuid];
  else raise exception 'WAREHOUSE_DOCUMENT_KIND_INVALID' using errcode='22023'; end if;
  context:=warehouse_private.require_permission(p_device_id,permission,stores[1]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(context,permission,stores[1]));
  if array_length(stores,1)=2 then second_context:=warehouse_private.require_permission(p_device_id,permission,stores[2]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(second_context,permission,stores[2])); if stores[1]=stores[2] then raise exception 'WAREHOUSE_TRANSFER_STORES_MUST_DIFFER' using errcode='23514'; end if; end if;
  actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'create_'||p_kind||'_draft',null,stores,p_payload); if replay is not null then return replay; end if;
  perform warehouse_private.lock_active_store(stores[1]); if array_length(stores,1)=2 then perform warehouse_private.lock_active_store(stores[2]); end if;
  perform warehouse_private.validate_draft_lines(p_kind,p_payload);
  number:=warehouse_private.next_document_number(p_kind);
  insert into warehouse.document_registry(id,document_kind,document_number) values(document_id,p_kind,number);
  if p_kind='receipt' then
    insert into warehouse.receipt_documents(id,document_number,destination_store_id,document_date,supplier_reference,notes,creator_user_id,creator_device_id) values(document_id,number,stores[1],(p_payload->>'documentDate')::date,p_payload->>'supplierReference',p_payload->>'notes',actor,p_device_id);
    for line in select * from jsonb_array_elements(p_payload->'lines') loop insert into warehouse.receipt_lines(document_id,item_id,quantity,unit_cost,unit_price,notes) values(document_id,(line->>'itemId')::uuid,(line->>'quantity')::numeric,(line->>'unitCost')::numeric,coalesce((line->>'unitPrice')::numeric,0),line->>'notes'); end loop;
  elsif p_kind='issue' then
    insert into warehouse.issue_documents(id,document_number,source_store_id,document_date,purpose,notes,creator_user_id,creator_device_id) values(document_id,number,stores[1],(p_payload->>'documentDate')::date,p_payload->>'purpose',p_payload->>'notes',actor,p_device_id);
    for line in select * from jsonb_array_elements(p_payload->'lines') loop insert into warehouse.issue_lines(document_id,item_id,quantity,unit_price,notes) values(document_id,(line->>'itemId')::uuid,(line->>'quantity')::numeric,coalesce((line->>'unitPrice')::numeric,0),line->>'notes'); end loop;
  elsif p_kind='transfer' then
    insert into warehouse.transfer_documents(id,document_number,source_store_id,destination_store_id,document_date,notes,creator_user_id,creator_device_id) values(document_id,number,stores[1],stores[2],(p_payload->>'documentDate')::date,p_payload->>'notes',actor,p_device_id);
    for line in select * from jsonb_array_elements(p_payload->'lines') loop insert into warehouse.transfer_lines(document_id,item_id,quantity,notes) values(document_id,(line->>'itemId')::uuid,(line->>'quantity')::numeric,line->>'notes'); end loop;
  else
    approval:=case when p_kind='opening_balance' then 'not_required' else 'not_submitted' end;
    insert into warehouse.adjustment_documents(id,document_number,adjustment_kind,store_id,document_date,reason,notes,approval_status,creator_user_id,creator_device_id) values(document_id,number,p_kind,stores[1],(p_payload->>'documentDate')::date,p_payload->>'reason',p_payload->>'notes',approval,actor,p_device_id);
    for line in select * from jsonb_array_elements(p_payload->'lines') loop insert into warehouse.adjustment_lines(document_id,item_id,direction,quantity,inbound_unit_cost,notes) values(document_id,(line->>'itemId')::uuid,line->>'direction',(line->>'quantity')::numeric,(line->>'inboundUnitCost')::numeric,line->>'notes'); end loop;
  end if;
  perform warehouse_private.write_audit(context,'document.draft_created',permission,stores,p_operation_id,document_id,p_kind,null,'draft',1,p_payload->>'reason',case when p_kind in ('opening_balance','adjustment','damage_loss','correction') then 'warehouse_approval_policy_v1' end,null,null,'{}',authorization_contexts);
  return warehouse_private.complete_operation(p_operation_id,jsonb_build_object('documentId',document_id,'documentNumber',number,'documentKind',p_kind,'revision',1));
end;
$$;

commit;
