create or replace function warehouse.decide_adjustment_approval(p_device_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_revision bigint,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare d warehouse.adjustment_documents%rowtype; context jsonb; replay jsonb; actor uuid; result jsonb; system_owner_self_approval boolean:=false; policy_version text:='warehouse_approval_policy_v1';
begin
  select * into d from warehouse.adjustment_documents where id=p_document_id;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.approve',d.store_id); actor:=(context->>'actorUserId')::uuid;
  if actor=d.creator_user_id then
    system_owner_self_approval:=public.is_system_owner(actor);
    if not system_owner_self_approval then raise exception 'WAREHOUSE_CREATOR_SELF_APPROVAL_FORBIDDEN' using errcode='42501'; end if;
    policy_version:='warehouse_approval_policy_v2_system_owner_self_approval';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'WAREHOUSE_APPROVAL_DECISION_INVALID' using errcode='22023'; end if;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'decide_adjustment_approval',p_document_id,array[d.store_id],jsonb_build_object('revision',p_expected_revision,'decision',p_decision,'reason',p_reason)); if replay is not null then return replay; end if;
  perform 1 from warehouse.adjustment_documents where id=p_document_id for update;
  update warehouse.adjustment_documents set approval_status=p_decision,updated_at=statement_timestamp() where id=p_document_id and status='draft' and approval_status='pending' and revision=p_expected_revision and submitted_revision=revision returning revision into d.revision;
  if not found then raise exception 'WAREHOUSE_APPROVAL_STATE_INVALID' using errcode='55000'; end if;
  insert into warehouse.approval_records(document_kind,document_id,document_revision,decision,policy_version,initiator_user_id,approver_user_id,approver_device_id,reason) values('adjustment',p_document_id,d.revision,p_decision,policy_version,d.creator_user_id,actor,p_device_id,p_reason);
  result:=jsonb_build_object('documentId',p_document_id,'approvalStatus',p_decision,'revision',d.revision);
  perform warehouse_private.write_audit(context,'approval.'||p_decision,'warehouse.stock.approve',array[d.store_id],p_operation_id,p_document_id,d.adjustment_kind,'pending',p_decision,d.revision,p_reason,policy_version,null,null,jsonb_build_object('systemOwnerSelfApproval',system_owner_self_approval));
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

create or replace function warehouse.decide_reversal_approval(p_device_id uuid,p_operation_id uuid,p_request_id uuid,p_expected_revision bigint,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare request warehouse.reversal_requests%rowtype; stores uuid[]; context jsonb; actor uuid; replay jsonb; result jsonb; system_owner_self_approval boolean:=false; policy_version text:='warehouse_approval_policy_v1';
begin
  select * into request from warehouse.reversal_requests where id=p_request_id;
  select array_agg(distinct store_id order by store_id) into stores from warehouse.stock_movements where document_id=request.original_document_id;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.approve',stores[1]); if array_length(stores,1)=2 then perform warehouse_private.require_permission(p_device_id,'warehouse.stock.approve',stores[2]); end if; actor:=(context->>'actorUserId')::uuid;
  if actor=request.initiator_user_id then
    system_owner_self_approval:=public.is_system_owner(actor);
    if not system_owner_self_approval then raise exception 'WAREHOUSE_REVERSAL_INITIATOR_SELF_APPROVAL_FORBIDDEN' using errcode='42501'; end if;
    policy_version:='warehouse_approval_policy_v2_system_owner_self_approval';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'WAREHOUSE_APPROVAL_DECISION_INVALID' using errcode='22023'; end if;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'decide_reversal_approval',p_request_id,stores,jsonb_build_object('revision',p_expected_revision,'decision',p_decision,'reason',p_reason)); if replay is not null then return replay; end if;
  perform 1 from warehouse.reversal_requests where id=p_request_id for update;
  update warehouse.reversal_requests set status=p_decision,updated_at=statement_timestamp() where id=p_request_id and status='pending' and revision=p_expected_revision and submitted_revision=revision returning revision into request.revision;
  if not found then raise exception 'WAREHOUSE_REVERSAL_APPROVAL_STATE_INVALID' using errcode='55000'; end if;
  insert into warehouse.approval_records(document_kind,document_id,document_revision,decision,policy_version,initiator_user_id,approver_user_id,approver_device_id,reason) values('reversal',p_request_id,request.revision,p_decision,policy_version,request.initiator_user_id,actor,p_device_id,p_reason);
  result:=jsonb_build_object('reversalRequestId',p_request_id,'status',p_decision,'revision',request.revision);
  perform warehouse_private.write_audit(context,'reversal.'||p_decision,'warehouse.stock.approve',stores,p_operation_id,request.original_document_id,request.original_document_kind,'pending',p_decision,request.revision,p_reason,policy_version,request.original_document_id,p_request_id,jsonb_build_object('systemOwnerSelfApproval',system_owner_self_approval));
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;
