begin;

create or replace function warehouse_private.post_document(p_device_id uuid,p_operation_id uuid,p_kind text,p_document_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare stores uuid[]; kind_permission text; context jsonb; kind_context_2 jsonb; post_context_1 jsonb; post_context_2 jsonb; approval_contexts jsonb; authorization_contexts jsonb:='[]'; replay jsonb; actor uuid; line record; balance warehouse.stock_balances%rowtype; movement_seq bigint; movement_ids uuid[]:='{}'; transfer_group uuid; approval text; submitted_revision bigint; creator uuid; status_now text; movement_id uuid; out_cost numeric(20,6); new_qty numeric(20,6); new_value numeric(26,6); result jsonb;
begin
  if p_kind='receipt' then select array[destination_store_id],status,creator_user_id into stores,status_now,creator from warehouse.receipt_documents where id=p_document_id; kind_permission:='warehouse.stock.receive';
  elsif p_kind='issue' then select array[source_store_id],status,creator_user_id into stores,status_now,creator from warehouse.issue_documents where id=p_document_id; kind_permission:='warehouse.stock.issue';
  elsif p_kind='transfer' then select array[source_store_id,destination_store_id],status,creator_user_id into stores,status_now,creator from warehouse.transfer_documents where id=p_document_id; kind_permission:='warehouse.stock.transfer'; transfer_group:=gen_random_uuid();
  elsif p_kind='adjustment_document' then select array[d.store_id],d.status,d.creator_user_id,d.approval_status,d.submitted_revision,d.adjustment_kind into stores,status_now,creator,approval,submitted_revision,p_kind from warehouse.adjustment_documents d where d.id=p_document_id; kind_permission:='warehouse.stock.adjust';
  else raise exception 'WAREHOUSE_DOCUMENT_KIND_INVALID' using errcode='22023'; end if;
  if stores is null then raise exception 'WAREHOUSE_DOCUMENT_REQUIRED' using errcode='22023'; end if;
  context:=warehouse_private.require_permission(p_device_id,kind_permission,stores[1]);
  authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(context,kind_permission,stores[1]));
  post_context_1:=warehouse_private.require_permission(p_device_id,'warehouse.stock.post',stores[1]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(post_context_1,'warehouse.stock.post',stores[1]));
  if array_length(stores,1)=2 then kind_context_2:=warehouse_private.require_permission(p_device_id,kind_permission,stores[2]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(kind_context_2,kind_permission,stores[2])); post_context_2:=warehouse_private.require_permission(p_device_id,'warehouse.stock.post',stores[2]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(post_context_2,'warehouse.stock.post',stores[2])); end if;
  actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'post_'||p_kind,p_document_id,stores,jsonb_build_object('revision',p_expected_revision)); if replay is not null then return replay; end if;
  if p_kind='receipt' then select status into status_now from warehouse.receipt_documents where id=p_document_id for update;
  elsif p_kind='issue' then select status into status_now from warehouse.issue_documents where id=p_document_id for update;
  elsif p_kind='transfer' then select status into status_now from warehouse.transfer_documents where id=p_document_id for update;
  else select d.status,d.approval_status,d.submitted_revision,d.adjustment_kind into status_now,approval,submitted_revision,p_kind from warehouse.adjustment_documents d where d.id=p_document_id for update; end if;
  if status_now<>'draft' then raise exception 'WAREHOUSE_DRAFT_REQUIRED' using errcode='55000'; end if;
  perform warehouse_private.lock_active_store(stores[1]); if array_length(stores,1)=2 then perform warehouse_private.lock_active_store(stores[2]); end if;
  if p_kind in ('adjustment','damage_loss','correction') and (approval<>'approved' or submitted_revision<>p_expected_revision) then raise exception 'WAREHOUSE_CURRENT_REVISION_APPROVAL_REQUIRED' using errcode='42501'; end if;
  if p_kind in ('adjustment','damage_loss','correction') then select a.authorization_contexts into approval_contexts from warehouse.business_audit a where a.document_id=p_document_id and a.document_revision=p_expected_revision and a.event_type='approval.approved' order by a.occurred_at desc limit 1; if approval_contexts is null then raise exception 'WAREHOUSE_APPROVAL_AUDIT_REQUIRED' using errcode='55000'; end if; authorization_contexts:=authorization_contexts||approval_contexts; end if;
  -- Materialize missing projection rows, then lock every affected key in canonical order.
  insert into warehouse.stock_balances(store_id,item_id)
  select affected.store_id,affected.item_id from (
    select stores[1] store_id,l.item_id from warehouse.receipt_lines l where p_kind='receipt' and l.document_id=p_document_id
    union select stores[1],l.item_id from warehouse.issue_lines l where p_kind='issue' and l.document_id=p_document_id
    union select stores[1],l.item_id from warehouse.transfer_lines l where p_kind='transfer' and l.document_id=p_document_id
    union select stores[2],l.item_id from warehouse.transfer_lines l where p_kind='transfer' and l.document_id=p_document_id
    union select stores[1],l.item_id from warehouse.adjustment_lines l where p_kind in ('opening_balance','adjustment','damage_loss','correction') and l.document_id=p_document_id
  ) affected on conflict do nothing;
  perform 1 from warehouse.stock_balances b where (b.store_id,b.item_id) in (
    select affected.store_id,affected.item_id from (
      select stores[1] store_id,l.item_id from warehouse.receipt_lines l where p_kind='receipt' and l.document_id=p_document_id
      union select stores[1],l.item_id from warehouse.issue_lines l where p_kind='issue' and l.document_id=p_document_id
      union select stores[1],l.item_id from warehouse.transfer_lines l where p_kind='transfer' and l.document_id=p_document_id
      union select stores[2],l.item_id from warehouse.transfer_lines l where p_kind='transfer' and l.document_id=p_document_id
      union select stores[1],l.item_id from warehouse.adjustment_lines l where p_kind in ('opening_balance','adjustment','damage_loss','correction') and l.document_id=p_document_id
    ) affected
  ) order by b.store_id,b.item_id for update;
  if p_kind='opening_balance' and exists(
    select 1 from warehouse.adjustment_lines l join warehouse.stock_movements m on m.store_id=stores[1] and m.item_id=l.item_id
     where l.document_id=p_document_id
  ) then raise exception 'WAREHOUSE_OPENING_BALANCE_EXISTING_HISTORY' using errcode='55000'; end if;
  if p_kind='opening_balance' and exists(select 1 from warehouse.adjustment_lines where document_id=p_document_id and direction<>'in') then raise exception 'WAREHOUSE_OPENING_BALANCE_INBOUND_ONLY' using errcode='23514'; end if;
  if p_kind='damage_loss' and exists(select 1 from warehouse.adjustment_lines where document_id=p_document_id and direction<>'out') then raise exception 'WAREHOUSE_DAMAGE_LOSS_OUTBOUND_ONLY' using errcode='23514'; end if;
  if p_kind in ('adjustment','damage_loss','correction') and not exists(select 1 from warehouse.approval_records where document_kind='adjustment' and document_id=p_document_id and document_revision=p_expected_revision and decision='approved') then raise exception 'WAREHOUSE_CURRENT_REVISION_APPROVAL_RECORD_REQUIRED' using errcode='42501'; end if;
  -- With all keys locked, transfer OUT precedes its matching IN so value is preserved.
  for line in
    select * from (
      select l.id line_id,l.item_id,l.quantity,l.unit_cost inbound_cost,'in' direction,stores[1] store_id,'receipt' movement_type from warehouse.receipt_lines l where p_kind='receipt' and l.document_id=p_document_id
      union all select l.id,l.item_id,l.quantity,null,'out',stores[1],'issue' from warehouse.issue_lines l where p_kind='issue' and l.document_id=p_document_id
      union all select l.id,l.item_id,l.quantity,null,'out',stores[1],'transfer_out' from warehouse.transfer_lines l where p_kind='transfer' and l.document_id=p_document_id
      union all select l.id,l.item_id,l.quantity,null,'in',stores[2],'transfer_in' from warehouse.transfer_lines l where p_kind='transfer' and l.document_id=p_document_id
      union all select l.id,l.item_id,l.quantity,l.inbound_unit_cost,l.direction,stores[1],case when p_kind='opening_balance' then 'opening' when p_kind='damage_loss' and l.direction='out' then 'damage' else 'adjustment_'||l.direction end from warehouse.adjustment_lines l where p_kind in ('opening_balance','adjustment','damage_loss','correction') and l.document_id=p_document_id
    ) ordered_lines order by item_id,case when direction='out' then 0 else 1 end,store_id
  loop
    perform warehouse_private.lock_active_item_master(line.item_id);
    insert into warehouse.stock_balances(store_id,item_id) values(line.store_id,line.item_id) on conflict do nothing;
    select * into balance from warehouse.stock_balances where store_id=line.store_id and item_id=line.item_id for update;
    if line.direction='out' then
      if balance.quantity_on_hand<line.quantity then raise exception 'WAREHOUSE_NEGATIVE_STOCK_PROHIBITED' using errcode='23514'; end if;
      out_cost:=balance.weighted_average_unit_cost; new_qty:=balance.quantity_on_hand-line.quantity; new_value:=round(balance.inventory_value-(line.quantity*out_cost),6);
      if new_qty=0 then new_value:=0; out_cost:=balance.weighted_average_unit_cost; end if;
    else
      if line.movement_type='transfer_in' then
        select unit_cost into out_cost from warehouse.stock_movements where transfer_group_id=transfer_group and item_id=line.item_id and movement_type='transfer_out';
      else out_cost:=line.inbound_cost; end if;
      if out_cost is null then raise exception 'WAREHOUSE_INBOUND_COST_REQUIRED' using errcode='23514'; end if;
      new_qty:=balance.quantity_on_hand+line.quantity; new_value:=round(balance.inventory_value+(line.quantity*out_cost),6);
    end if;
    insert into warehouse.stock_movements(store_id,item_id,direction,movement_type,quantity,unit_cost,inventory_value,document_id,document_line_id,transfer_group_id,actor_user_id,actor_device_id,operation_id)
    values(line.store_id,line.item_id,line.direction,line.movement_type,line.quantity,out_cost,round(line.quantity*out_cost,6),p_document_id,line.line_id,transfer_group,actor,p_device_id,p_operation_id) returning id,sequence into movement_id,movement_seq;
    movement_ids:=array_append(movement_ids,movement_id);
    update warehouse.stock_balances set quantity_on_hand=new_qty,inventory_value=new_value,weighted_average_unit_cost=case when new_qty=0 then 0 else round(new_value/new_qty,6) end,last_movement_sequence=movement_seq,revision=revision+1,calculated_at=statement_timestamp() where store_id=line.store_id and item_id=line.item_id;
  end loop;
  if cardinality(movement_ids)=0 then raise exception 'WAREHOUSE_DOCUMENT_LINES_REQUIRED' using errcode='23514'; end if;
  if p_kind='receipt' then update warehouse.receipt_documents set status='posted',posted_at=statement_timestamp(),updated_at=statement_timestamp(),revision=revision+1 where id=p_document_id and revision=p_expected_revision;
  elsif p_kind='issue' then update warehouse.issue_documents set status='posted',posted_at=statement_timestamp(),updated_at=statement_timestamp(),revision=revision+1 where id=p_document_id and revision=p_expected_revision;
  elsif p_kind='transfer' then update warehouse.transfer_documents set status='posted',posted_at=statement_timestamp(),updated_at=statement_timestamp(),revision=revision+1 where id=p_document_id and revision=p_expected_revision;
  else update warehouse.adjustment_documents set status='posted',posted_at=statement_timestamp(),updated_at=statement_timestamp(),revision=revision+1 where id=p_document_id and revision=p_expected_revision; end if;
  if not found then raise exception 'WAREHOUSE_DOCUMENT_REVISION_CONFLICT' using errcode='40001'; end if;
  result:=jsonb_build_object('documentId',p_document_id,'documentKind',p_kind,'status','posted','movementIds',to_jsonb(movement_ids));
  perform warehouse_private.write_audit(post_context_1,'document.posted','warehouse.stock.post',stores,p_operation_id,p_document_id,p_kind,'draft','posted',p_expected_revision+1,null,case when p_kind in ('opening_balance','adjustment','damage_loss','correction') then 'warehouse_approval_policy_v1' end,null,null,jsonb_build_object('movementIds',movement_ids),authorization_contexts);
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

commit;
