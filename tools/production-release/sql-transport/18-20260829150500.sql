begin;

do $$
begin
  if to_regprocedure('warehouse_private.require_permission(uuid,text,uuid)') is null
     or to_regprocedure('public.require_module_permission(uuid,text,text,text,text)') is null then
    raise exception 'WAREHOUSE_SECURE_READ_DEPENDENCY_MISMATCH' using errcode='55000';
  end if;
end;
$$;

create function warehouse_private.require_read_session(p_device_id uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare context jsonb;
begin
  context:=public.require_module_permission(p_device_id,'warehouse','module.access',null,null);
  return (context->>'actorUserId')::uuid;
end; $$;

create function warehouse_private.require_store_set(p_device_id uuid,p_permission text,p_store_ids uuid[]) returns void
language plpgsql stable security definer set search_path=pg_catalog,warehouse_private as $$
declare store_id uuid;
begin
  if coalesce(cardinality(p_store_ids),0)=0 then raise exception 'WAREHOUSE_RESOURCE_SCOPE_REQUIRED' using errcode='42501'; end if;
  foreach store_id in array p_store_ids loop
    perform warehouse_private.require_permission(p_device_id,p_permission,store_id);
  end loop;
end; $$;

create function warehouse.discover_stores(p_device_id uuid,p_include_inactive boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare store_row warehouse.stores%rowtype; result jsonb:='[]';
begin
  perform warehouse_private.require_read_session(p_device_id);
  for store_row in select * from warehouse.stores s where p_include_inactive or s.status='active' order by s.code,s.id loop
    begin
      perform warehouse_private.require_permission(p_device_id,'warehouse.store.view',store_row.id);
      result:=result||jsonb_build_array(jsonb_build_object('id',store_row.id,'code',store_row.code,'name',store_row.name,'store_type',store_row.store_type,'address',store_row.address,'notes',store_row.notes,'status',store_row.status,'revision',store_row.revision));
    exception when insufficient_privilege then null;
    end;
  end loop;
  return result;
end; $$;

create function warehouse.list_documents(p_device_id uuid,p_document_kind text default null,p_store_id uuid default null,p_status text default null,p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare row record; result jsonb:='[]'; accepted integer:=0; bounded_limit integer;
begin
  perform warehouse_private.require_read_session(p_device_id);
  if p_document_kind is not null and p_document_kind not in ('receipt','issue','transfer','opening_balance','adjustment','damage_loss','correction') then raise exception 'WAREHOUSE_DOCUMENT_KIND_INVALID' using errcode='22023'; end if;
  if p_status is not null and p_status not in ('draft','posted','reversed') then raise exception 'WAREHOUSE_DOCUMENT_STATUS_INVALID' using errcode='22023'; end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception 'WAREHOUSE_CURSOR_INVALID' using errcode='22023'; end if;
  bounded_limit:=least(greatest(coalesce(p_limit,50),1),100);
  for row in
    select * from (
      select d.id,d.document_number,'receipt'::text document_kind,d.destination_store_id store_id,null::uuid source_store_id,d.destination_store_id destination_store_id,d.document_date,d.supplier_reference context,d.notes,d.status,null::text approval_status,null::bigint submitted_revision,d.creator_user_id,d.posted_at,d.reversed_at,d.revision,d.created_at,d.updated_at,array[d.destination_store_id] store_ids from warehouse.receipt_documents d
      union all select d.id,d.document_number,'issue',d.source_store_id,d.source_store_id,null,d.document_date,d.purpose,d.notes,d.status,null,null,d.creator_user_id,d.posted_at,d.reversed_at,d.revision,d.created_at,d.updated_at,array[d.source_store_id] from warehouse.issue_documents d
      union all select d.id,d.document_number,'transfer',null,d.source_store_id,d.destination_store_id,d.document_date,null,d.notes,d.status,null,null,d.creator_user_id,d.posted_at,d.reversed_at,d.revision,d.created_at,d.updated_at,array[d.source_store_id,d.destination_store_id] from warehouse.transfer_documents d
      union all select d.id,d.document_number,d.adjustment_kind,d.store_id,null,null,d.document_date,d.reason,d.notes,d.status,d.approval_status,d.submitted_revision,d.creator_user_id,d.posted_at,d.reversed_at,d.revision,d.created_at,d.updated_at,array[d.store_id] from warehouse.adjustment_documents d
    ) documents
    where (p_document_kind is null or documents.document_kind=p_document_kind)
      and (p_store_id is null or p_store_id=any(documents.store_ids))
      and (p_status is null or documents.status=p_status)
      and (p_before_created_at is null or (documents.created_at,documents.id)<(p_before_created_at,p_before_id))
    order by documents.created_at desc,documents.id desc
  loop
    begin
      perform warehouse_private.require_store_set(p_device_id,'warehouse.store.view',row.store_ids);
      result:=result||jsonb_build_array(to_jsonb(row)-'store_ids'); accepted:=accepted+1;
      if accepted>=bounded_limit then exit; end if;
    exception when insufficient_privilege then null;
    end;
  end loop;
  return result;
end; $$;

create function warehouse.get_document(p_device_id uuid,p_document_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare header jsonb; kind text; stores uuid[]; lines jsonb;
begin
  perform warehouse_private.require_read_session(p_device_id);
  select r.document_kind into kind from warehouse.document_registry r where r.id=p_document_id and r.document_kind<>'reversal';
  if not found then raise exception 'WAREHOUSE_DOCUMENT_REQUIRED' using errcode='22023'; end if;
  if kind='receipt' then select array[d.destination_store_id],to_jsonb(d)-array['creator_device_id'] into stores,header from warehouse.receipt_documents d where d.id=p_document_id; select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') into lines from warehouse.receipt_lines l where l.document_id=p_document_id;
  elsif kind='issue' then select array[d.source_store_id],to_jsonb(d)-array['creator_device_id'] into stores,header from warehouse.issue_documents d where d.id=p_document_id; select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') into lines from warehouse.issue_lines l where l.document_id=p_document_id;
  elsif kind='transfer' then select array[d.source_store_id,d.destination_store_id],to_jsonb(d)-array['creator_device_id'] into stores,header from warehouse.transfer_documents d where d.id=p_document_id; select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') into lines from warehouse.transfer_lines l where l.document_id=p_document_id;
  else select array[d.store_id],to_jsonb(d)-array['creator_device_id','submitted_device_id'] into stores,header from warehouse.adjustment_documents d where d.id=p_document_id; select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') into lines from warehouse.adjustment_lines l where l.document_id=p_document_id; end if;
  perform warehouse_private.require_store_set(p_device_id,'warehouse.store.view',stores);
  perform warehouse_private.require_permission(p_device_id,'warehouse.item.view');
  return jsonb_build_object('header',header,'lines',lines);
end; $$;

create function warehouse.list_approval_queue(p_device_id uuid,p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare row record; result jsonb:='[]'; accepted integer:=0; bounded_limit integer;
begin
  perform warehouse_private.require_read_session(p_device_id);
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception 'WAREHOUSE_CURSOR_INVALID' using errcode='22023'; end if; bounded_limit:=least(greatest(coalesce(p_limit,50),1),100);
  for row in
    select * from (
      select 'adjustment'::text request_kind,d.id request_id,d.id document_id,d.document_number,d.adjustment_kind document_kind,array[d.store_id] store_ids,d.status lifecycle_status,d.approval_status,d.submitted_revision,d.creator_user_id requester_user_id,a.decision,a.reason decision_reason,d.created_at,d.submitted_at,a.decided_at,d.revision from warehouse.adjustment_documents d left join warehouse.approval_records a on a.document_kind='adjustment' and a.document_id=d.id and a.document_revision=d.submitted_revision where d.adjustment_kind<>'opening_balance' and d.approval_status in ('pending','approved','rejected')
      union all
      select 'reversal',r.id,r.original_document_id,registry.document_number,r.original_document_kind,(select array_agg(distinct m.store_id order by m.store_id) from warehouse.stock_movements m where m.document_id=r.original_document_id),r.status,r.status,r.submitted_revision,r.initiator_user_id,a.decision,a.reason,r.created_at,r.submitted_at,a.decided_at,r.revision from warehouse.reversal_requests r join warehouse.document_registry registry on registry.id=r.original_document_id left join warehouse.approval_records a on a.document_kind='reversal' and a.document_id=r.id and a.document_revision=r.submitted_revision where r.status in ('pending','approved','rejected')
    ) queue where p_before_created_at is null or (queue.created_at,queue.request_id)<(p_before_created_at,p_before_id) order by queue.created_at desc,queue.request_id desc
  loop begin perform warehouse_private.require_store_set(p_device_id,'warehouse.stock.approve',row.store_ids); result:=result||jsonb_build_array(to_jsonb(row)-'store_ids'||jsonb_build_object('store_ids',row.store_ids)); accepted:=accepted+1; if accepted>=bounded_limit then exit; end if; exception when insufficient_privilege then null; end; end loop;
  return result;
end; $$;

create function warehouse.list_reversal_requests(p_device_id uuid,p_status text default null,p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare row record; result jsonb:='[]'; accepted integer:=0; bounded_limit integer;
begin
  perform warehouse_private.require_read_session(p_device_id);
  if p_status is not null and p_status not in ('draft','pending','approved','rejected','posted') then raise exception 'WAREHOUSE_REVERSAL_STATUS_INVALID' using errcode='22023'; end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception 'WAREHOUSE_CURSOR_INVALID' using errcode='22023'; end if; bounded_limit:=least(greatest(coalesce(p_limit,50),1),100);
  for row in select r.*,registry.document_number original_document_number,(select array_agg(distinct m.store_id order by m.store_id) from warehouse.stock_movements m where m.document_id=r.original_document_id) store_ids,a.decision,a.reason decision_reason,a.decided_at from warehouse.reversal_requests r join warehouse.document_registry registry on registry.id=r.original_document_id left join warehouse.approval_records a on a.document_kind='reversal' and a.document_id=r.id and a.document_revision=r.submitted_revision where (p_status is null or r.status=p_status) and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id)) order by r.created_at desc,r.id desc
  loop begin perform warehouse_private.require_store_set(p_device_id,'warehouse.stock.adjust',row.store_ids); result:=result||jsonb_build_array(to_jsonb(row)-array['initiator_device_id','submitted_device_id','store_ids']||jsonb_build_object('store_ids',row.store_ids)); accepted:=accepted+1; if accepted>=bounded_limit then exit; end if; exception when insufficient_privilege then null; end; end loop;
  return result;
end; $$;

create function warehouse.list_history(p_device_id uuid,p_store_id uuid,p_document_id uuid default null,p_item_id uuid default null,p_document_kind text default null,p_from timestamptz default null,p_to timestamptz default null,p_before_sequence bigint default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare bounded_limit integer;
begin
  perform warehouse_private.require_read_session(p_device_id); perform warehouse_private.require_permission(p_device_id,'warehouse.reports.view',p_store_id); perform warehouse_private.require_permission(p_device_id,'warehouse.item.view');
  if p_from is not null and p_to is not null and p_from>p_to then raise exception 'WAREHOUSE_DATE_RANGE_INVALID' using errcode='22023'; end if; bounded_limit:=least(greatest(coalesce(p_limit,50),1),100);
  return jsonb_build_object(
    'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.sequence desc),'[]') from (select m.id,m.sequence,m.store_id,m.item_id,m.direction,m.movement_type,m.quantity,m.unit_cost,m.inventory_value,m.document_id,m.document_line_id,m.transfer_group_id,m.reversal_of_movement_id,m.occurred_at from warehouse.stock_movements m left join warehouse.document_registry r on r.id=m.document_id where m.store_id=p_store_id and (p_document_id is null or m.document_id=p_document_id) and (p_item_id is null or m.item_id=p_item_id) and (p_document_kind is null or r.document_kind=p_document_kind) and (p_from is null or m.occurred_at>=p_from) and (p_to is null or m.occurred_at<p_to) and (p_before_sequence is null or m.sequence<p_before_sequence) order by m.sequence desc limit bounded_limit) m),
    'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc,a.id desc),'[]') from (select a.id,a.event_type,a.affected_store_ids,a.document_id,a.document_kind,a.previous_state,a.new_state,a.document_revision,a.reason,a.policy_version,a.original_document_id,a.reversal_request_id,a.metadata,a.occurred_at from warehouse.business_audit a where p_store_id=any(a.affected_store_ids) and (p_document_id is null or a.document_id=p_document_id or a.original_document_id=p_document_id) and (p_document_kind is null or a.document_kind=p_document_kind) and (p_from is null or a.occurred_at>=p_from) and (p_to is null or a.occurred_at<p_to) order by a.occurred_at desc,a.id desc limit bounded_limit) a)
  );
end; $$;

revoke all on function warehouse_private.require_read_session(uuid),warehouse_private.require_store_set(uuid,text,uuid[]) from public,anon,authenticated;
revoke all on function warehouse.discover_stores(uuid,boolean),warehouse.list_documents(uuid,text,uuid,text,timestamptz,uuid,integer),warehouse.get_document(uuid,uuid),warehouse.list_approval_queue(uuid,timestamptz,uuid,integer),warehouse.list_reversal_requests(uuid,text,timestamptz,uuid,integer),warehouse.list_history(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,bigint,integer) from public,anon,authenticated;
grant execute on function warehouse.discover_stores(uuid,boolean),warehouse.list_documents(uuid,text,uuid,text,timestamptz,uuid,integer),warehouse.get_document(uuid,uuid),warehouse.list_approval_queue(uuid,timestamptz,uuid,integer),warehouse.list_reversal_requests(uuid,text,timestamptz,uuid,integer),warehouse.list_history(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,bigint,integer) to authenticated;

comment on function warehouse.discover_stores(uuid,boolean) is 'Warehouse V1 authorized store discovery. Deliberately unpaginated because the operational store set is small; stable code/id ordering is guaranteed.';

commit;
