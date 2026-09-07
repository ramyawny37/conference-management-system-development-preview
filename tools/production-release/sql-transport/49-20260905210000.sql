create or replace function warehouse.create_issue_draft(p_device_id uuid,p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
#variable_conflict use_variable
declare result jsonb; created_document_id uuid; beneficiary warehouse.parties%rowtype; beneficiary_id uuid; line jsonb; item record; issue_line warehouse.issue_lines%rowtype; issue_type text; actual numeric; selected_actual numeric; reference numeric; selected_reference numeric; reason text; gift_mode text; gift_party uuid; gift_name text; paid numeric; context jsonb;
begin
  beneficiary_id:=nullif(p_payload->>'beneficiaryPartyId','')::uuid; if beneficiary_id is null then raise exception 'WAREHOUSE_BENEFICIARY_REQUIRED' using errcode='22023'; end if;
  result:=warehouse.create_issue_draft_inventory_core(p_device_id,p_operation_id,p_payload); created_document_id:=(result->>'documentId')::uuid;
  if exists(select 1 from warehouse.issue_documents where id=created_document_id and finance_extension_version=1) then return result; end if;
  beneficiary:=warehouse_private.require_active_party(beneficiary_id,'beneficiary'); paid:=coalesce((p_payload->>'paidNow')::numeric,0); if paid<0 then raise exception 'WAREHOUSE_PAID_NOW_INVALID' using errcode='22023'; end if;
  for line in select * from jsonb_array_elements(p_payload->'lines') loop
    select i.id,i.default_issue_price into item from warehouse.items i where i.id=(line->>'itemId')::uuid for key share;
    select l.* into issue_line from warehouse.issue_lines l where l.document_id=created_document_id and l.item_id=item.id;
    issue_type:=coalesce(line->>'issueType','paid'); if issue_type not in ('paid','subsidized','free','gift') then raise exception 'WAREHOUSE_ISSUE_TYPE_INVALID' using errcode='22023'; end if;
    reference:=item.default_issue_price; selected_reference:=reference*issue_line.conversion_factor_snapshot;
    selected_actual:=case when issue_type in ('free','gift') then 0 else coalesce((line->>'actualUnitPrice')::numeric,(line->>'unitPrice')::numeric,selected_reference) end; if selected_actual<0 then raise exception 'WAREHOUSE_ISSUE_PRICE_INVALID' using errcode='22023'; end if;
    actual:=round(selected_actual/issue_line.conversion_factor_snapshot,6);
    reason:=nullif(btrim(line->>'priceOverrideReason'),''); if issue_type in ('paid','subsidized') and selected_actual<>selected_reference and (reason is null or char_length(reason)>500) then raise exception 'WAREHOUSE_PRICE_OVERRIDE_REASON_REQUIRED' using errcode='22023'; end if;
    gift_mode:=case when issue_type='gift' then coalesce(line->>'giftRecipientMode','unknown') else 'unknown' end; gift_party:=nullif(line->>'giftRecipientPartyId','')::uuid; gift_name:=nullif(btrim(line->>'giftRecipientName'),'');
    if gift_mode not in ('unknown','registered_person','manual_recipient') or (gift_mode='registered_person' and gift_party is null) or (gift_mode='manual_recipient' and gift_name is null) or (gift_mode='unknown' and (gift_party is not null or gift_name is not null)) then raise exception 'WAREHOUSE_GIFT_RECIPIENT_INVALID' using errcode='22023'; end if;
    if gift_mode='registered_person' then perform warehouse_private.require_active_party(gift_party,null); gift_name:=null; elsif gift_mode='manual_recipient' then gift_party:=null; else gift_party:=null; gift_name:=null; end if;
    update warehouse.issue_lines set unit_price=actual,selected_unit_price=selected_actual,issue_type=issue_type,reference_unit_price=reference,price_override_reason=reason,gift_recipient_mode=gift_mode,gift_recipient_party_id=gift_party,gift_recipient_name=gift_name where id=issue_line.id;
  end loop;
  if paid>(select coalesce(sum(case when entered_quantity is not null and selected_unit_price is not null then entered_quantity*selected_unit_price else quantity*unit_price end),0) from warehouse.issue_lines where document_id=created_document_id) then raise exception 'WAREHOUSE_PAID_NOW_INVALID' using errcode='22023'; end if;
  update warehouse.issue_documents set beneficiary_party_id=beneficiary_id,paid_now=paid,beneficiary_name_snapshot=beneficiary.name,beneficiary_phone_snapshot=beneficiary.phone,finance_extension_version=1,finance_extension_operation_id=p_operation_id where id=created_document_id and status='draft';
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.issue',(select source_store_id from warehouse.issue_documents where id=created_document_id));
  perform warehouse_private.write_audit(context,'issue.financial_intent_assigned','warehouse.stock.issue',array[(select source_store_id from warehouse.issue_documents where id=created_document_id)],p_operation_id,created_document_id,'issue',null,'draft',1,null,null,null,null,jsonb_build_object('beneficiaryAssigned',true,'paidNow',paid,'priceOverrides',(select count(*) from warehouse.issue_lines l where l.document_id=created_document_id and l.price_override_reason is not null),'giftLines',(select count(*) from warehouse.issue_lines l where l.document_id=created_document_id and l.issue_type='gift')));
  return result;
end; $$;

create or replace function warehouse.post_issue(p_device_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare result jsonb; document warehouse.issue_documents%rowtype; context jsonb; actor uuid; previous numeric; total numeric; entry_id uuid;
begin
  result:=warehouse.post_issue_inventory_core(p_device_id,p_operation_id,p_document_id,p_expected_revision);
  select * into document from warehouse.issue_documents where id=p_document_id;
  if document.beneficiary_party_id is null then raise exception 'WAREHOUSE_BENEFICIARY_REQUIRED' using errcode='22023'; end if;
  if document.operation_total_snapshot is not null then return result; end if;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.issue',document.source_store_id); actor:=(context->>'actorUserId')::uuid;
  perform warehouse_private.require_active_party(document.beneficiary_party_id,'beneficiary');
  insert into warehouse.beneficiary_balances(beneficiary_party_id) values(document.beneficiary_party_id) on conflict do nothing;
  select balance into previous from warehouse.beneficiary_balances where beneficiary_party_id=document.beneficiary_party_id for update;
  select coalesce(sum(case when entered_quantity is not null and selected_unit_price is not null then entered_quantity*selected_unit_price else quantity*unit_price end),0) into total from warehouse.issue_lines where document_id=p_document_id;
  if document.paid_now<0 or document.paid_now>total then raise exception 'WAREHOUSE_PAID_NOW_INVALID' using errcode='22023'; end if;
  if total>0 then insert into warehouse.beneficiary_financial_entries(beneficiary_party_id,issue_document_id,entry_type,amount,operation_id,actor_user_id,actor_device_id) values(document.beneficiary_party_id,p_document_id,'issue_charge',total,p_operation_id,actor,p_device_id) returning id into entry_id; end if;
  if document.paid_now>0 then insert into warehouse.beneficiary_financial_entries(beneficiary_party_id,issue_document_id,entry_type,amount,operation_id,actor_user_id,actor_device_id) values(document.beneficiary_party_id,p_document_id,'issue_payment',-document.paid_now,p_operation_id,actor,p_device_id) returning id into entry_id; end if;
  update warehouse.beneficiary_balances set balance=previous+total-document.paid_now,revision=revision+1,last_entry_id=entry_id,calculated_at=statement_timestamp() where beneficiary_party_id=document.beneficiary_party_id;
  update warehouse.issue_documents set previous_balance_snapshot=previous,operation_total_snapshot=total,remaining_snapshot=total-document.paid_now,resulting_balance_snapshot=previous+total-document.paid_now where id=p_document_id;
  perform warehouse_private.write_audit(context,'issue.finance_applied','warehouse.stock.issue',array[document.source_store_id],p_operation_id,p_document_id,'issue','draft','posted',p_expected_revision+1,null,null,null,null,jsonb_build_object('paidNow',document.paid_now,'operationTotal',total,'priceOverrides',(select count(*) from warehouse.issue_lines where document_id=p_document_id and price_override_reason is not null),'giftLines',(select count(*) from warehouse.issue_lines where document_id=p_document_id and issue_type='gift')));
  return result||jsonb_build_object('previousBalance',previous,'operationTotal',total,'paidNow',document.paid_now,'remaining',total-document.paid_now,'resultingBalance',previous+total-document.paid_now);
end; $$;

create or replace function warehouse.get_document(p_device_id uuid,p_document_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,warehouse as $$
declare result jsonb; header jsonb; current_balance numeric:=0; draft_total numeric:=0; paid numeric:=0;
begin
  result:=warehouse.get_document_inventory_core(p_device_id,p_document_id); header:=result->'header';
  if header->>'document_kind'='issue' then
    paid:=coalesce((header->>'paid_now')::numeric,0);
    if header->>'status'='draft' then
      if nullif(header->>'beneficiary_party_id','') is not null then select coalesce(balance,0) into current_balance from warehouse.beneficiary_balances where beneficiary_party_id=(header->>'beneficiary_party_id')::uuid; end if;
      select coalesce(sum(case when nullif(x->>'entered_quantity','') is not null and nullif(x->>'selected_unit_price','') is not null then (x->>'entered_quantity')::numeric*(x->>'selected_unit_price')::numeric else (x->>'quantity')::numeric*(x->>'unit_price')::numeric end),0) into draft_total from jsonb_array_elements(result->'lines') x;
    end if;
    result:=result||jsonb_build_object('financial',jsonb_build_object('previousBalance',case when header->>'status'='draft' then current_balance else (header->>'previous_balance_snapshot')::numeric end,'operationTotal',case when header->>'status'='draft' then draft_total else (header->>'operation_total_snapshot')::numeric end,'paidNow',paid,'remaining',case when header->>'status'='draft' then draft_total-paid else (header->>'remaining_snapshot')::numeric end,'resultingBalance',case when header->>'status'='draft' then current_balance+draft_total-paid else (header->>'resulting_balance_snapshot')::numeric end));
  end if;
  return result;
end; $$;
