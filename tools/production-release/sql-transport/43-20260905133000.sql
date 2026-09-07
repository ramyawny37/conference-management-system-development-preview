begin;

do $$
declare table_name text; constraint_name text;
begin
  foreach table_name in array array['receipt_documents','issue_documents','transfer_documents','adjustment_documents'] loop
    select c.conname into constraint_name
      from pg_constraint c
     where c.conrelid=format('warehouse.%I',table_name)::regclass
       and c.contype='c'
       and pg_get_constraintdef(c.oid) like '%status%draft%posted%reversed%'
       and pg_get_constraintdef(c.oid) not like '%posted_at%';
    if constraint_name is null then raise exception 'WAREHOUSE_DOCUMENT_STATUS_CONSTRAINT_REQUIRED'; end if;
    execute format('alter table warehouse.%I drop constraint %I',table_name,constraint_name);
    execute format('alter table warehouse.%I add constraint %I check(status in (''draft'',''posted'',''reversed'',''cancelled''))',table_name,constraint_name);

    constraint_name:=null;
    select c.conname into constraint_name
      from pg_constraint c
     where c.conrelid=format('warehouse.%I',table_name)::regclass
       and c.contype='c'
       and pg_get_constraintdef(c.oid) like '%posted_at%reversed_at%';
    if constraint_name is null then raise exception 'WAREHOUSE_DOCUMENT_LIFECYCLE_CONSTRAINT_REQUIRED'; end if;
    execute format('alter table warehouse.%I drop constraint %I',table_name,constraint_name);
    execute format('alter table warehouse.%I add constraint %I check((status in (''draft'',''cancelled'') and posted_at is null and reversed_at is null) or (status=''posted'' and posted_at is not null and reversed_at is null) or (status=''reversed'' and posted_at is not null and reversed_at is not null))',table_name,constraint_name);
  end loop;
end;
$$;

create function warehouse.cancel_document_draft(
  p_device_id uuid,
  p_operation_id uuid,
  p_document_kind text,
  p_document_id uuid,
  p_expected_revision bigint,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare permission text; stores uuid[]; context jsonb; second_context jsonb; authorization_contexts jsonb:='[]'; replay jsonb; current_status text; approval text; submitted bigint; new_revision bigint; result jsonb;
begin
  if p_operation_id is null or p_document_id is null or p_expected_revision is null then raise exception 'WAREHOUSE_CANCELLATION_ARGUMENTS_REQUIRED' using errcode='22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then raise exception 'WAREHOUSE_CANCELLATION_REASON_REQUIRED' using errcode='22023'; end if;
  if p_document_kind='receipt' then select array[destination_store_id],status into stores,current_status from warehouse.receipt_documents where id=p_document_id; permission:='warehouse.stock.receive';
  elsif p_document_kind='issue' then select array[source_store_id],status into stores,current_status from warehouse.issue_documents where id=p_document_id; permission:='warehouse.stock.issue';
  elsif p_document_kind='transfer' then select array[source_store_id,destination_store_id],status into stores,current_status from warehouse.transfer_documents where id=p_document_id; permission:='warehouse.stock.transfer';
  elsif p_document_kind in ('opening_balance','adjustment','damage_loss','correction') then select array[store_id],status,approval_status,submitted_revision into stores,current_status,approval,submitted from warehouse.adjustment_documents where id=p_document_id and adjustment_kind=p_document_kind; permission:='warehouse.stock.adjust';
  else raise exception 'WAREHOUSE_DOCUMENT_KIND_INVALID' using errcode='22023'; end if;
  if stores is null then raise exception 'WAREHOUSE_DOCUMENT_REQUIRED' using errcode='22023'; end if;
  context:=warehouse_private.require_permission(p_device_id,permission,stores[1]);
  authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(context,permission,stores[1]));
  if cardinality(stores)=2 then second_context:=warehouse_private.require_permission(p_device_id,permission,stores[2]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(second_context,permission,stores[2])); end if;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'cancel_'||p_document_kind||'_draft',p_document_id,stores,jsonb_build_object('revision',p_expected_revision,'reason',btrim(p_reason)));
  if replay is not null then return replay; end if;

  if p_document_kind='receipt' then select status into current_status from warehouse.receipt_documents where id=p_document_id for update;
  elsif p_document_kind='issue' then select status into current_status from warehouse.issue_documents where id=p_document_id for update;
  elsif p_document_kind='transfer' then select status into current_status from warehouse.transfer_documents where id=p_document_id for update;
  else select status,approval_status,submitted_revision into current_status,approval,submitted from warehouse.adjustment_documents where id=p_document_id and adjustment_kind=p_document_kind for update; end if;
  if current_status<>'draft' then raise exception 'WAREHOUSE_DOCUMENT_STATE_INVALID' using errcode='22023'; end if;
  if p_document_kind in ('adjustment','damage_loss','correction') and (approval<>'not_submitted' or submitted is not null) then raise exception 'WAREHOUSE_CANCELLATION_APPROVAL_STATE_INVALID' using errcode='22023'; end if;

  if p_document_kind='receipt' then update warehouse.receipt_documents set status='cancelled',revision=revision+1,updated_at=statement_timestamp() where id=p_document_id and status='draft' and revision=p_expected_revision returning revision into new_revision;
  elsif p_document_kind='issue' then update warehouse.issue_documents set status='cancelled',revision=revision+1,updated_at=statement_timestamp() where id=p_document_id and status='draft' and revision=p_expected_revision returning revision into new_revision;
  elsif p_document_kind='transfer' then update warehouse.transfer_documents set status='cancelled',revision=revision+1,updated_at=statement_timestamp() where id=p_document_id and status='draft' and revision=p_expected_revision returning revision into new_revision;
  else update warehouse.adjustment_documents set status='cancelled',revision=revision+1,updated_at=statement_timestamp() where id=p_document_id and adjustment_kind=p_document_kind and status='draft' and revision=p_expected_revision returning revision into new_revision; end if;
  if new_revision is null then raise exception 'WAREHOUSE_DOCUMENT_REVISION_CONFLICT' using errcode='40001'; end if;
  perform warehouse_private.write_audit(context,'document.draft_cancelled',permission,stores,p_operation_id,p_document_id,p_document_kind,'draft','cancelled',new_revision,btrim(p_reason),case when p_document_kind in ('opening_balance','adjustment','damage_loss','correction') then 'warehouse_approval_policy_v1' end,null,null,jsonb_build_object('stockMovement',false,'financialMutation',false),authorization_contexts);
  result:=jsonb_build_object('documentId',p_document_id,'documentKind',p_document_kind,'status','cancelled','revision',new_revision);
  return warehouse_private.complete_operation(p_operation_id,result);
end;
$$;

revoke all on function warehouse.cancel_document_draft(uuid,uuid,text,uuid,bigint,text) from public,anon,authenticated;
grant execute on function warehouse.cancel_document_draft(uuid,uuid,text,uuid,bigint,text) to service_role;

commit;
