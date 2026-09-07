begin;

create or replace function warehouse.post_reversal(p_device_id uuid,p_operation_id uuid,p_request_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare request warehouse.reversal_requests%rowtype; stores uuid[]; context jsonb; adjust_context_2 jsonb; post_context_1 jsonb; post_context_2 jsonb; approval_contexts jsonb; authorization_contexts jsonb:='[]'; replay jsonb; actor uuid; original record; balance warehouse.stock_balances%rowtype; movement_id uuid; movement_ids uuid[]:='{}'; movement_seq bigint; new_qty numeric(20,6); new_value numeric(26,6); reversal_document_id uuid:=gen_random_uuid(); result jsonb;
begin
  select * into request from warehouse.reversal_requests where id=p_request_id;
  select array_agg(distinct store_id order by store_id) into stores from warehouse.stock_movements where document_id=request.original_document_id;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.adjust',stores[1]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(context,'warehouse.stock.adjust',stores[1]));
  post_context_1:=warehouse_private.require_permission(p_device_id,'warehouse.stock.post',stores[1]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(post_context_1,'warehouse.stock.post',stores[1]));
  if array_length(stores,1)=2 then adjust_context_2:=warehouse_private.require_permission(p_device_id,'warehouse.stock.adjust',stores[2]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(adjust_context_2,'warehouse.stock.adjust',stores[2])); post_context_2:=warehouse_private.require_permission(p_device_id,'warehouse.stock.post',stores[2]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(post_context_2,'warehouse.stock.post',stores[2])); end if; actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'post_reversal',p_request_id,stores,jsonb_build_object('revision',p_expected_revision)); if replay is not null then return replay; end if;
  select * into request from warehouse.reversal_requests where id=p_request_id for update;
  if request.status<>'approved' or request.revision<>p_expected_revision or request.submitted_revision<>request.revision or not exists(select 1 from warehouse.approval_records where document_kind='reversal' and document_id=p_request_id and document_revision=p_expected_revision and decision='approved') then raise exception 'WAREHOUSE_APPROVED_REVERSAL_REQUIRED' using errcode='55000'; end if;
  select a.authorization_contexts into approval_contexts from warehouse.business_audit a where a.reversal_request_id=p_request_id and a.document_revision=p_expected_revision and a.event_type='reversal.approved' order by a.occurred_at desc limit 1;
  if approval_contexts is null then raise exception 'WAREHOUSE_REVERSAL_APPROVAL_AUDIT_REQUIRED' using errcode='55000'; end if; authorization_contexts:=authorization_contexts||approval_contexts;
  if request.original_document_kind='receipt' then perform 1 from warehouse.receipt_documents where id=request.original_document_id and status='posted' for update;
  elsif request.original_document_kind='issue' then perform 1 from warehouse.issue_documents where id=request.original_document_id and status='posted' for update;
  elsif request.original_document_kind='transfer' then perform 1 from warehouse.transfer_documents where id=request.original_document_id and status='posted' for update;
  else perform 1 from warehouse.adjustment_documents where id=request.original_document_id and status='posted' for update; end if;
  if not found then raise exception 'WAREHOUSE_POSTED_ORIGINAL_REQUIRED' using errcode='55000'; end if;
  perform 1 from warehouse.stock_balances b where (b.store_id,b.item_id) in (select m.store_id,m.item_id from warehouse.stock_movements m where m.document_id=request.original_document_id) order by b.store_id,b.item_id for update;
  if exists(select 1 from warehouse.stock_movements original_movement join warehouse.stock_movements later on later.store_id=original_movement.store_id and later.item_id=original_movement.item_id and later.sequence>original_movement.sequence where original_movement.document_id=request.original_document_id) then raise exception 'WAREHOUSE_REVERSAL_REQUIRES_LATEST_MOVEMENT_LINEAGE' using errcode='55000'; end if;
  -- Historical correction requires preserved store/item identity, not active status:
  -- deactivation must not make an otherwise valid immutable-history reversal impossible.
  if exists(select 1 from warehouse.stock_movements m left join warehouse.stores s on s.id=m.store_id left join warehouse.items i on i.id=m.item_id where m.document_id=request.original_document_id and (s.id is null or i.id is null)) then raise exception 'WAREHOUSE_REVERSAL_RESOURCE_IDENTITY_REQUIRED' using errcode='55000'; end if;
  insert into warehouse.document_registry(id,document_kind,document_number,original_document_id) values(reversal_document_id,'reversal',warehouse_private.next_document_number('reversal'),request.original_document_id);
  for original in select * from warehouse.stock_movements where document_id=request.original_document_id order by store_id,item_id,sequence loop
    select * into balance from warehouse.stock_balances where store_id=original.store_id and item_id=original.item_id for update;
    if original.direction='in' then
      if balance.quantity_on_hand<original.quantity then raise exception 'WAREHOUSE_NEGATIVE_STOCK_PROHIBITED' using errcode='23514'; end if;
      new_qty:=balance.quantity_on_hand-original.quantity; new_value:=round(balance.inventory_value-original.inventory_value,6); if new_qty=0 then new_value:=0; end if;
    else new_qty:=balance.quantity_on_hand+original.quantity; new_value:=round(balance.inventory_value+original.inventory_value,6); end if;
    insert into warehouse.stock_movements(store_id,item_id,direction,movement_type,quantity,unit_cost,inventory_value,document_id,document_line_id,transfer_group_id,reversal_of_movement_id,actor_user_id,actor_device_id,operation_id)
    values(original.store_id,original.item_id,case original.direction when 'in' then 'out' else 'in' end,'reversal',original.quantity,original.unit_cost,original.inventory_value,reversal_document_id,original.document_line_id,original.transfer_group_id,original.id,actor,p_device_id,p_operation_id) returning id,sequence into movement_id,movement_seq;
    movement_ids:=array_append(movement_ids,movement_id);
    update warehouse.stock_balances set quantity_on_hand=new_qty,inventory_value=new_value,weighted_average_unit_cost=case when new_qty=0 then 0 else round(new_value/new_qty,6) end,last_movement_sequence=movement_seq,revision=revision+1,calculated_at=statement_timestamp() where store_id=original.store_id and item_id=original.item_id;
  end loop;
  update warehouse.reversal_requests set status='posted',posted_at=statement_timestamp(),revision=revision+1,updated_at=statement_timestamp() where id=p_request_id;
  if request.original_document_kind='receipt' then update warehouse.receipt_documents set status='reversed',reversed_at=statement_timestamp(),updated_at=statement_timestamp() where id=request.original_document_id and status='posted';
  elsif request.original_document_kind='issue' then update warehouse.issue_documents set status='reversed',reversed_at=statement_timestamp(),updated_at=statement_timestamp() where id=request.original_document_id and status='posted';
  elsif request.original_document_kind='transfer' then update warehouse.transfer_documents set status='reversed',reversed_at=statement_timestamp(),updated_at=statement_timestamp() where id=request.original_document_id and status='posted';
  else update warehouse.adjustment_documents set status='reversed',reversed_at=statement_timestamp(),updated_at=statement_timestamp() where id=request.original_document_id and status='posted'; end if;
  if not found then raise exception 'WAREHOUSE_ORIGINAL_ALREADY_REVERSED' using errcode='55000'; end if;
  result:=jsonb_build_object('reversalRequestId',p_request_id,'reversalDocumentId',reversal_document_id,'status','posted','movementIds',to_jsonb(movement_ids));
  perform warehouse_private.write_audit(post_context_1,'reversal.posted','warehouse.stock.post',stores,p_operation_id,reversal_document_id,'reversal','approved','posted',p_expected_revision+1,request.reason,'warehouse_approval_policy_v1',request.original_document_id,p_request_id,jsonb_build_object('movementIds',movement_ids),authorization_contexts);
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

commit;
