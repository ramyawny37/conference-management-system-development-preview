begin;

do $$
begin
  if to_regclass('warehouse.stock_movements') is null
     or to_regclass('warehouse.business_operations') is null
     or to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'WAREHOUSE_RPC_DEPENDENCY_MISMATCH' using errcode='55000';
  end if;
end;
$$;

create function warehouse_private.canonical_intent_hash(p_intent jsonb) returns text
language sql immutable set search_path=pg_catalog,extensions
as $$ select encode(extensions.digest(convert_to(p_intent::text,'UTF8'),'sha256'),'hex') $$;

create function warehouse_private.canonicalize_intent(p_intent jsonb) returns jsonb
language sql immutable set search_path=pg_catalog
as $$
  select case when jsonb_typeof(p_intent->'lines')='array' then
    jsonb_set(p_intent,'{lines}',coalesce((select jsonb_agg(line order by line->>'itemId',coalesce(line->>'direction',''),coalesce(line->>'id',''),line::text) from jsonb_array_elements(p_intent->'lines') line),'[]'::jsonb))
  else p_intent end
$$;

create function warehouse_private.authorization_entry(p_context jsonb,p_permission text,p_store_id uuid default null) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select jsonb_build_object('permission',p_permission,'resourceType',case when p_store_id is null then null else 'store' end,'resourceId',case when p_store_id is null then null else p_store_id::text end,'authoritySource',p_context->>'authoritySource','grantId',p_context->'grantId')
$$;

create function warehouse_private.require_permission(p_device_id uuid,p_permission text,p_store_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,warehouse as $$
declare result jsonb; canonical_resource text;
begin
  canonical_resource := case when p_store_id is null then null else p_store_id::text end;
  result := public.require_effective_module_permission(
    p_device_id,'warehouse',p_permission,
    case when p_store_id is null then null else 'store' end,canonical_resource
  );
  if p_store_id is not null and not exists(select 1 from warehouse.stores s where s.id=p_store_id) then
    raise exception 'WAREHOUSE_STORE_REQUIRED' using errcode='22023';
  end if;
  return result;
end; $$;

create function warehouse_private.require_active_store(p_store_id uuid) returns warehouse.stores
language plpgsql stable security definer set search_path=pg_catalog,warehouse as $$
declare result warehouse.stores%rowtype;
begin
  select * into result from warehouse.stores where id=p_store_id and status='active';
  if not found then raise exception 'ACTIVE_WAREHOUSE_STORE_REQUIRED' using errcode='55000'; end if;
  return result;
end; $$;

create function warehouse_private.lock_active_store(p_store_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,warehouse as $$
begin
  perform 1 from warehouse.stores where id=p_store_id and status='active' for key share;
  if not found then raise exception 'ACTIVE_WAREHOUSE_STORE_REQUIRED' using errcode='55000'; end if;
end; $$;

create function warehouse_private.lock_active_item_master(p_item_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,warehouse as $$
begin
  perform 1 from warehouse.items i join warehouse.categories c on c.id=i.category_id and c.status='active' join warehouse.units u on u.id=i.base_unit_id and u.status='active' where i.id=p_item_id and i.status='active' for key share of i,c,u;
  if not found then raise exception 'ACTIVE_WAREHOUSE_ITEM_MASTER_REQUIRED' using errcode='55000'; end if;
end; $$;

create function warehouse_private.begin_operation(
  p_operation_id uuid,p_context jsonb,p_kind text,p_target_id uuid,p_store_ids uuid[],p_intent jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare existing warehouse.business_operations%rowtype; actor_id uuid; device_id uuid; intent_hash text;
begin
  actor_id := (p_context->>'actorUserId')::uuid; device_id := (p_context->>'actorDeviceId')::uuid;
  intent_hash := warehouse_private.canonical_intent_hash(warehouse_private.canonicalize_intent(p_intent));
  insert into warehouse.business_operations(operation_id,actor_user_id,actor_device_id,operation_kind,target_id,affected_store_ids,intent_hash,status)
  values(p_operation_id,actor_id,device_id,p_kind,p_target_id,coalesce(p_store_ids,'{}'),intent_hash,'processing')
  on conflict(operation_id) do nothing;
  select * into existing from warehouse.business_operations where operation_id=p_operation_id for update;
  if existing.actor_user_id<>actor_id or existing.actor_device_id<>device_id or existing.operation_kind<>p_kind
     or existing.target_id is distinct from p_target_id or existing.affected_store_ids<>coalesce(p_store_ids,'{}')
     or existing.intent_hash<>intent_hash then
    raise exception 'WAREHOUSE_IDEMPOTENCY_CONFLICT' using errcode='22023';
  end if;
  if existing.status='applied' then return existing.result; end if;
  if existing.status<>'processing' then raise exception 'WAREHOUSE_OPERATION_NOT_REPLAYABLE' using errcode='55000'; end if;
  return null;
end; $$;

create function warehouse_private.complete_operation(p_operation_id uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse as $$
begin
  update warehouse.business_operations set status='applied',result=p_result,completed_at=statement_timestamp()
   where operation_id=p_operation_id and status='processing';
  if not found then raise exception 'WAREHOUSE_OPERATION_COMPLETION_INVALID' using errcode='55000'; end if;
  return p_result;
end; $$;

create function warehouse_private.write_audit(p_context jsonb,p_event text,p_permission text,p_stores uuid[],p_operation uuid,p_document uuid,p_kind text,p_old text,p_new text,p_revision bigint,p_reason text default null,p_policy text default null,p_original uuid default null,p_reversal uuid default null,p_metadata jsonb default '{}',p_authorization_contexts jsonb default null) returns void
language plpgsql security definer set search_path=pg_catalog,warehouse as $$
begin
  insert into warehouse.business_audit(event_type,actor_user_id,actor_device_id,effective_permission,authority_source,grant_id,affected_store_ids,operation_id,document_id,document_kind,previous_state,new_state,document_revision,reason,policy_version,original_document_id,reversal_request_id,metadata,authorization_contexts)
  values(p_event,(p_context->>'actorUserId')::uuid,(p_context->>'actorDeviceId')::uuid,p_permission,p_context->>'authoritySource',nullif(p_context->>'grantId','')::uuid,coalesce(p_stores,'{}'),p_operation,p_document,p_kind,p_old,p_new,p_revision,p_reason,p_policy,p_original,p_reversal,coalesce(p_metadata,'{}'),coalesce(p_authorization_contexts,jsonb_build_array(warehouse_private.authorization_entry(p_context,p_permission,case when cardinality(p_stores)=1 then p_stores[1] end))));
end; $$;

create function warehouse_private.reject_immutable_mutation() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin raise exception 'WAREHOUSE_IMMUTABLE_HISTORY' using errcode='55000'; end; $$;
create trigger stock_movements_immutable before update or delete on warehouse.stock_movements for each row execute function warehouse_private.reject_immutable_mutation();
create trigger business_audit_immutable before update or delete on warehouse.business_audit for each row execute function warehouse_private.reject_immutable_mutation();
create trigger approvals_immutable before update or delete on warehouse.approval_records for each row execute function warehouse_private.reject_immutable_mutation();
create trigger document_registry_immutable before update or delete on warehouse.document_registry for each row execute function warehouse_private.reject_immutable_mutation();

create function warehouse_private.verify_document_registry_correspondence() returns trigger
language plpgsql security definer set search_path=pg_catalog,warehouse as $$
begin
  if (new.document_kind='receipt' and not exists(select 1 from warehouse.receipt_documents d where d.id=new.id and d.document_number=new.document_number))
     or (new.document_kind='issue' and not exists(select 1 from warehouse.issue_documents d where d.id=new.id and d.document_number=new.document_number))
     or (new.document_kind='transfer' and not exists(select 1 from warehouse.transfer_documents d where d.id=new.id and d.document_number=new.document_number))
     or (new.document_kind in ('opening_balance','adjustment','damage_loss','correction') and not exists(select 1 from warehouse.adjustment_documents d where d.id=new.id and d.document_number=new.document_number and d.adjustment_kind=new.document_kind))
     or (new.document_kind='reversal' and not exists(select 1 from warehouse.reversal_requests r where r.original_document_id=new.original_document_id and r.status='posted')) then
    raise exception 'WAREHOUSE_DOCUMENT_REGISTRY_CORRESPONDENCE_REQUIRED' using errcode='23514';
  end if;
  return null;
end; $$;
create constraint trigger document_registry_correspondence after insert on warehouse.document_registry deferrable initially deferred for each row execute function warehouse_private.verify_document_registry_correspondence();

create function warehouse_private.protect_applied_operation() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or old.status='applied' then raise exception 'WAREHOUSE_APPLIED_OPERATION_IMMUTABLE' using errcode='55000'; end if;
  return new;
end; $$;
create trigger applied_operations_immutable before update or delete on warehouse.business_operations for each row execute function warehouse_private.protect_applied_operation();

create function warehouse_private.protect_posted_header() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'WAREHOUSE_DOCUMENT_DELETE_PROHIBITED' using errcode='55000'; end if;
  if tg_op='UPDATE' and old.status in ('posted','reversed') and to_jsonb(new)-array['status','reversed_at','updated_at'] is distinct from to_jsonb(old)-array['status','reversed_at','updated_at'] then
    raise exception 'WAREHOUSE_POSTED_DOCUMENT_IMMUTABLE' using errcode='55000';
  end if;
  if tg_op='UPDATE' and old.status='reversed' then raise exception 'WAREHOUSE_REVERSED_DOCUMENT_IMMUTABLE' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
create trigger receipt_posted_immutable before update or delete on warehouse.receipt_documents for each row execute function warehouse_private.protect_posted_header();
create trigger issue_posted_immutable before update or delete on warehouse.issue_documents for each row execute function warehouse_private.protect_posted_header();
create trigger transfer_posted_immutable before update or delete on warehouse.transfer_documents for each row execute function warehouse_private.protect_posted_header();
create trigger adjustment_posted_immutable before update or delete on warehouse.adjustment_documents for each row execute function warehouse_private.protect_posted_header();

create function warehouse_private.protect_document_line() returns trigger language plpgsql security definer set search_path=pg_catalog,warehouse as $$
declare parent_id uuid; parent_status text;
begin
  parent_id:=case when tg_op='DELETE' then old.document_id else new.document_id end;
  execute format('select status from warehouse.%I where id=$1',tg_argv[0]) into parent_status using parent_id;
  if parent_status in ('posted','reversed') then raise exception 'WAREHOUSE_POSTED_DOCUMENT_LINE_IMMUTABLE' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
create trigger receipt_lines_posted_immutable before insert or update or delete on warehouse.receipt_lines for each row execute function warehouse_private.protect_document_line('receipt_documents');
create trigger issue_lines_posted_immutable before insert or update or delete on warehouse.issue_lines for each row execute function warehouse_private.protect_document_line('issue_documents');
create trigger transfer_lines_posted_immutable before insert or update or delete on warehouse.transfer_lines for each row execute function warehouse_private.protect_document_line('transfer_documents');
create trigger adjustment_lines_posted_immutable before insert or update or delete on warehouse.adjustment_lines for each row execute function warehouse_private.protect_document_line('adjustment_documents');

create function warehouse_private.reject_category_cycle() returns trigger language plpgsql set search_path=pg_catalog,warehouse as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('warehouse-category-hierarchy',0));
  if new.parent_id is not null and exists(
    with recursive ancestors(id) as (
      select new.parent_id union all select c.parent_id from warehouse.categories c join ancestors a on c.id=a.id where c.parent_id is not null
    ) select 1 from ancestors where id=new.id
  ) then raise exception 'WAREHOUSE_CATEGORY_CYCLE' using errcode='23514'; end if;
  return new;
end; $$;
create trigger categories_reject_cycle before insert or update of parent_id on warehouse.categories for each row execute function warehouse_private.reject_category_cycle();

create function warehouse_private.validate_draft_lines(p_kind text,p_payload jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare line jsonb;
begin
  if jsonb_typeof(p_payload->'lines')<>'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'WAREHOUSE_DOCUMENT_LINES_REQUIRED' using errcode='23514'; end if;
  for line in select * from jsonb_array_elements(p_payload->'lines') loop
    perform warehouse_private.lock_active_item_master((line->>'itemId')::uuid);
    if p_kind='opening_balance' and coalesce(line->>'direction','in')<>'in' then raise exception 'WAREHOUSE_OPENING_BALANCE_INBOUND_ONLY' using errcode='23514'; end if;
    if p_kind='damage_loss' and line->>'direction'<>'out' then raise exception 'WAREHOUSE_DAMAGE_LOSS_OUTBOUND_ONLY' using errcode='23514'; end if;
  end loop;
end; $$;

create function warehouse_private.enforce_adjustment_line_kind() returns trigger
language plpgsql security definer set search_path=pg_catalog,warehouse as $$
declare kind text;
begin
  select adjustment_kind into kind from warehouse.adjustment_documents where id=new.document_id;
  if kind='opening_balance' and new.direction<>'in' then raise exception 'WAREHOUSE_OPENING_BALANCE_INBOUND_ONLY' using errcode='23514'; end if;
  if kind='damage_loss' and new.direction<>'out' then raise exception 'WAREHOUSE_DAMAGE_LOSS_OUTBOUND_ONLY' using errcode='23514'; end if;
  return new;
end; $$;
create trigger adjustment_lines_kind_invariant before insert or update on warehouse.adjustment_lines for each row execute function warehouse_private.enforce_adjustment_line_kind();

create function warehouse_private.validate_adjustment_document(p_document_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare document_kind text; line record; line_count integer:=0;
begin
  select adjustment_kind into document_kind from warehouse.adjustment_documents where id=p_document_id;
  for line in select item_id,direction from warehouse.adjustment_lines where document_id=p_document_id order by item_id,direction loop
    line_count:=line_count+1; perform warehouse_private.lock_active_item_master(line.item_id);
    if document_kind='opening_balance' and line.direction<>'in' then raise exception 'WAREHOUSE_OPENING_BALANCE_INBOUND_ONLY' using errcode='23514'; end if;
    if document_kind='damage_loss' and line.direction<>'out' then raise exception 'WAREHOUSE_DAMAGE_LOSS_OUTBOUND_ONLY' using errcode='23514'; end if;
  end loop;
  if line_count=0 then raise exception 'WAREHOUSE_DOCUMENT_LINES_REQUIRED' using errcode='23514'; end if;
end; $$;

create function warehouse.list_stores(p_device_id uuid,p_store_id uuid default null) returns setof warehouse.stores
language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
begin
  perform warehouse_private.require_permission(p_device_id,'warehouse.store.view',p_store_id);
  return query select * from warehouse.stores s where p_store_id is null or s.id=p_store_id order by s.code;
end; $$;

create function warehouse.create_store(p_device_id uuid,p_operation_id uuid,p_name text,p_type text,p_address text,p_notes text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare context jsonb; replay jsonb; actor uuid; row warehouse.stores%rowtype; intent jsonb;
begin
  context:=warehouse_private.require_permission(p_device_id,'warehouse.store.create'); actor:=(context->>'actorUserId')::uuid;
  intent:=jsonb_build_object('name',p_name,'type',p_type,'address',p_address,'notes',p_notes);
  replay:=warehouse_private.begin_operation(p_operation_id,context,'create_store',null,'{}',intent); if replay is not null then return replay; end if;
  insert into warehouse.stores(name,store_type,address,notes,created_by,updated_by) values(btrim(p_name),p_type,btrim(p_address),p_notes,actor,actor) returning * into row;
  perform warehouse_private.write_audit(context,'store.created','warehouse.store.create',array[row.id],p_operation_id,null,null,null,'active',row.revision,null,null,null,null,jsonb_build_object('storeId',row.id));
  return warehouse_private.complete_operation(p_operation_id,jsonb_build_object('storeId',row.id,'code',row.code,'revision',row.revision));
end; $$;

create function warehouse.update_store(p_device_id uuid,p_operation_id uuid,p_store_id uuid,p_expected_revision bigint,p_name text,p_type text,p_address text,p_status text,p_notes text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare context jsonb; replay jsonb; actor uuid; row warehouse.stores%rowtype; intent jsonb;
begin
  context:=warehouse_private.require_permission(p_device_id,'warehouse.store.update',p_store_id); actor:=(context->>'actorUserId')::uuid;
  intent:=jsonb_build_object('id',p_store_id,'revision',p_expected_revision,'name',p_name,'type',p_type,'address',p_address,'status',p_status,'notes',p_notes);
  replay:=warehouse_private.begin_operation(p_operation_id,context,'update_store',p_store_id,array[p_store_id],intent); if replay is not null then return replay; end if;
  perform 1 from warehouse.stores where id=p_store_id for update;
  if p_status='inactive' and (
    exists(select 1 from warehouse.receipt_documents where destination_store_id=p_store_id and status='draft')
    or exists(select 1 from warehouse.issue_documents where source_store_id=p_store_id and status='draft')
    or exists(select 1 from warehouse.transfer_documents where (source_store_id=p_store_id or destination_store_id=p_store_id) and status='draft')
    or exists(select 1 from warehouse.adjustment_documents where store_id=p_store_id and status='draft')
    or exists(select 1 from warehouse.reversal_requests r join warehouse.stock_movements m on m.document_id=r.original_document_id where m.store_id=p_store_id and r.status in ('draft','pending','approved'))
  ) then raise exception 'WAREHOUSE_STORE_HAS_UNRESOLVED_WORK' using errcode='55000'; end if;
  update warehouse.stores set name=btrim(p_name),store_type=p_type,address=btrim(p_address),status=p_status,notes=p_notes,updated_by=actor,updated_at=statement_timestamp(),revision=revision+1
   where id=p_store_id and revision=p_expected_revision returning * into row;
  if not found then raise exception 'WAREHOUSE_STORE_REVISION_CONFLICT' using errcode='40001'; end if;
  perform warehouse_private.write_audit(context,'store.updated','warehouse.store.update',array[p_store_id],p_operation_id,null,null,null,row.status,row.revision,null);
  return warehouse_private.complete_operation(p_operation_id,jsonb_build_object('storeId',row.id,'status',row.status,'revision',row.revision));
end; $$;

create function warehouse.list_item_master(p_device_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
begin
  perform warehouse_private.require_permission(p_device_id,'warehouse.item.view');
  return jsonb_build_object('categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.code),'[]') from warehouse.categories c),'units',(select coalesce(jsonb_agg(to_jsonb(u) order by u.code),'[]') from warehouse.units u),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.sku),'[]') from warehouse.items i));
end; $$;

create function warehouse.upsert_item_master(p_device_id uuid,p_operation_id uuid,p_entity_kind text,p_entity_id uuid,p_expected_revision bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare permission text; context jsonb; replay jsonb; actor uuid; result jsonb; row_id uuid; next_revision bigint;
begin
  permission:=case when p_entity_id is null then 'warehouse.item.create' else 'warehouse.item.update' end;
  context:=warehouse_private.require_permission(p_device_id,permission); actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,permission||':'||p_entity_kind,p_entity_id,'{}',jsonb_build_object('kind',p_entity_kind,'id',p_entity_id,'revision',p_expected_revision,'payload',p_payload)); if replay is not null then return replay; end if;
  if p_entity_kind='category' then
    perform pg_advisory_xact_lock(hashtextextended('warehouse-category-hierarchy',0));
    if p_entity_id is null then insert into warehouse.categories(code,name,parent_id,status,created_by,updated_by) values(upper(btrim(p_payload->>'code')),p_payload->>'name',nullif(p_payload->>'parentId','')::uuid,coalesce(p_payload->>'status','active'),actor,actor) returning id,revision into row_id,next_revision;
    else perform 1 from warehouse.categories where id=p_entity_id for update; if p_payload->>'status'='inactive' and exists(select 1 from warehouse.items where category_id=p_entity_id and status='active') then raise exception 'WAREHOUSE_CATEGORY_HAS_ACTIVE_ITEMS' using errcode='55000'; end if; update warehouse.categories set code=upper(btrim(p_payload->>'code')),name=p_payload->>'name',parent_id=nullif(p_payload->>'parentId','')::uuid,status=p_payload->>'status',updated_by=actor,updated_at=statement_timestamp(),revision=revision+1 where id=p_entity_id and revision=p_expected_revision returning id,revision into row_id,next_revision; end if;
  elsif p_entity_kind='unit' then
    if p_entity_id is null then insert into warehouse.units(code,name,symbol,precision,status,created_by,updated_by) values(upper(btrim(p_payload->>'code')),p_payload->>'name',p_payload->>'symbol',(p_payload->>'precision')::smallint,coalesce(p_payload->>'status','active'),actor,actor) returning id,revision into row_id,next_revision;
    else perform 1 from warehouse.units where id=p_entity_id for update; if p_payload->>'status'='inactive' and exists(select 1 from warehouse.items where base_unit_id=p_entity_id and status='active') then raise exception 'WAREHOUSE_UNIT_HAS_ACTIVE_ITEMS' using errcode='55000'; end if; update warehouse.units set code=upper(btrim(p_payload->>'code')),name=p_payload->>'name',symbol=p_payload->>'symbol',precision=(p_payload->>'precision')::smallint,status=p_payload->>'status',updated_by=actor,updated_at=statement_timestamp(),revision=revision+1 where id=p_entity_id and revision=p_expected_revision returning id,revision into row_id,next_revision; end if;
  elsif p_entity_kind='item' then
    perform 1 from warehouse.categories where id=(p_payload->>'categoryId')::uuid for key share;
    perform 1 from warehouse.units where id=(p_payload->>'baseUnitId')::uuid for key share;
    if not exists(select 1 from warehouse.categories where id=(p_payload->>'categoryId')::uuid and status='active') or not exists(select 1 from warehouse.units where id=(p_payload->>'baseUnitId')::uuid and status='active') then raise exception 'ACTIVE_CATEGORY_AND_UNIT_REQUIRED' using errcode='55000'; end if;
    if p_entity_id is null then insert into warehouse.items(sku,name,category_id,base_unit_id,barcode,default_purchase_price,default_issue_price,minimum_stock,status,notes,created_by,updated_by) values(upper(btrim(p_payload->>'sku')),p_payload->>'name',(p_payload->>'categoryId')::uuid,(p_payload->>'baseUnitId')::uuid,nullif(p_payload->>'barcode',''),coalesce((p_payload->>'defaultPurchasePrice')::numeric,0),coalesce((p_payload->>'defaultIssuePrice')::numeric,0),coalesce((p_payload->>'minimumStock')::numeric,0),coalesce(p_payload->>'status','active'),p_payload->>'notes',actor,actor) returning id,revision into row_id,next_revision;
    else update warehouse.items set sku=upper(btrim(p_payload->>'sku')),name=p_payload->>'name',category_id=(p_payload->>'categoryId')::uuid,base_unit_id=(p_payload->>'baseUnitId')::uuid,barcode=nullif(p_payload->>'barcode',''),default_purchase_price=(p_payload->>'defaultPurchasePrice')::numeric,default_issue_price=(p_payload->>'defaultIssuePrice')::numeric,minimum_stock=(p_payload->>'minimumStock')::numeric,status=p_payload->>'status',notes=p_payload->>'notes',updated_by=actor,updated_at=statement_timestamp(),revision=revision+1 where id=p_entity_id and revision=p_expected_revision returning id,revision into row_id,next_revision; end if;
  else raise exception 'WAREHOUSE_MASTER_ENTITY_INVALID' using errcode='22023'; end if;
  if row_id is null then raise exception 'WAREHOUSE_MASTER_REVISION_CONFLICT' using errcode='40001'; end if;
  result:=jsonb_build_object('entityKind',p_entity_kind,'entityId',row_id,'revision',next_revision);
  perform warehouse_private.write_audit(context,'item_master.changed',permission,'{}',p_operation_id,null,p_entity_kind,null,null,next_revision,null,null,null,null,result);
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

create function warehouse_private.next_document_number(p_kind text) returns text language sql volatile set search_path=pg_catalog,warehouse as $$
  select upper(left(p_kind,3))||'-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('warehouse.document_number_sequence')::text,8,'0')
$$;

create function warehouse_private.create_document_draft(p_device_id uuid,p_operation_id uuid,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare permission text; stores uuid[]; context jsonb; second_context jsonb; authorization_contexts jsonb:='[]'; replay jsonb; actor uuid; document_id uuid:=gen_random_uuid(); number text; line jsonb; approval text;
begin
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
end; $$;

create function warehouse.create_receipt_draft(p_device_id uuid,p_operation_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=pg_catalog,warehouse_private as $$ select warehouse_private.create_document_draft(p_device_id,p_operation_id,'receipt',p_payload) $$;
create function warehouse.create_issue_draft(p_device_id uuid,p_operation_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=pg_catalog,warehouse_private as $$ select warehouse_private.create_document_draft(p_device_id,p_operation_id,'issue',p_payload) $$;
create function warehouse.create_transfer_draft(p_device_id uuid,p_operation_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=pg_catalog,warehouse_private as $$ select warehouse_private.create_document_draft(p_device_id,p_operation_id,'transfer',p_payload) $$;
create function warehouse.create_adjustment_draft(p_device_id uuid,p_operation_id uuid,p_adjustment_kind text,p_payload jsonb) returns jsonb language sql security definer set search_path=pg_catalog,warehouse_private as $$ select warehouse_private.create_document_draft(p_device_id,p_operation_id,p_adjustment_kind,p_payload) $$;

create function warehouse.update_document_draft(p_device_id uuid,p_operation_id uuid,p_document_kind text,p_document_id uuid,p_expected_revision bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare permission text; store_ids uuid[]; context jsonb; second_context jsonb; authorization_contexts jsonb:='[]'; replay jsonb; new_revision bigint; approval text;
begin
  if p_document_kind='receipt' then select array[destination_store_id] into store_ids from warehouse.receipt_documents where id=p_document_id; permission:='warehouse.stock.receive';
  elsif p_document_kind='issue' then select array[source_store_id] into store_ids from warehouse.issue_documents where id=p_document_id; permission:='warehouse.stock.issue';
  elsif p_document_kind='transfer' then select array[source_store_id,destination_store_id] into store_ids from warehouse.transfer_documents where id=p_document_id; permission:='warehouse.stock.transfer';
  elsif p_document_kind in ('opening_balance','adjustment','damage_loss','correction') then select array[store_id] into store_ids from warehouse.adjustment_documents where id=p_document_id and adjustment_kind=p_document_kind; permission:='warehouse.stock.adjust';
  else raise exception 'WAREHOUSE_DOCUMENT_KIND_INVALID' using errcode='22023'; end if;
  if store_ids is null then raise exception 'WAREHOUSE_DOCUMENT_REQUIRED' using errcode='22023'; end if;
  context:=warehouse_private.require_permission(p_device_id,permission,store_ids[1]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(context,permission,store_ids[1])); if array_length(store_ids,1)=2 then second_context:=warehouse_private.require_permission(p_device_id,permission,store_ids[2]); authorization_contexts:=authorization_contexts||jsonb_build_array(warehouse_private.authorization_entry(second_context,permission,store_ids[2])); end if;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'update_'||p_document_kind||'_draft',p_document_id,store_ids,jsonb_build_object('revision',p_expected_revision,'payload',p_payload)); if replay is not null then return replay; end if;
  if p_document_kind='receipt' then perform 1 from warehouse.receipt_documents where id=p_document_id for update;
  elsif p_document_kind='issue' then perform 1 from warehouse.issue_documents where id=p_document_id for update;
  elsif p_document_kind='transfer' then perform 1 from warehouse.transfer_documents where id=p_document_id for update;
  else perform 1 from warehouse.adjustment_documents where id=p_document_id and adjustment_kind=p_document_kind for update; end if;
  perform warehouse_private.lock_active_store(store_ids[1]); if array_length(store_ids,1)=2 then perform warehouse_private.lock_active_store(store_ids[2]); end if;
  perform warehouse_private.validate_draft_lines(p_document_kind,p_payload);
  if p_document_kind in ('opening_balance','adjustment','damage_loss','correction') then
    approval:=case when p_document_kind='opening_balance' then 'not_required' else 'not_submitted' end;
    update warehouse.adjustment_documents set document_date=(p_payload->>'documentDate')::date,reason=p_payload->>'reason',notes=p_payload->>'notes',approval_status=approval,submitted_revision=null,submitted_by=null,submitted_device_id=null,submitted_at=null,revision=revision+1,updated_at=statement_timestamp() where id=p_document_id and status='draft' and revision=p_expected_revision returning revision into new_revision;
    delete from warehouse.adjustment_lines where document_id=p_document_id;
    insert into warehouse.adjustment_lines(document_id,item_id,direction,quantity,inbound_unit_cost,notes) select p_document_id,(x->>'itemId')::uuid,x->>'direction',(x->>'quantity')::numeric,(x->>'inboundUnitCost')::numeric,x->>'notes' from jsonb_array_elements(p_payload->'lines') x;
  elsif p_document_kind='receipt' then
    update warehouse.receipt_documents set document_date=(p_payload->>'documentDate')::date,supplier_reference=p_payload->>'supplierReference',notes=p_payload->>'notes',revision=revision+1,updated_at=statement_timestamp() where id=p_document_id and status='draft' and revision=p_expected_revision returning revision into new_revision;
    delete from warehouse.receipt_lines where document_id=p_document_id;
    insert into warehouse.receipt_lines(document_id,item_id,quantity,unit_cost,unit_price,notes) select p_document_id,(x->>'itemId')::uuid,(x->>'quantity')::numeric,(x->>'unitCost')::numeric,coalesce((x->>'unitPrice')::numeric,0),x->>'notes' from jsonb_array_elements(p_payload->'lines') x;
  elsif p_document_kind='issue' then
    update warehouse.issue_documents set document_date=(p_payload->>'documentDate')::date,purpose=p_payload->>'purpose',notes=p_payload->>'notes',revision=revision+1,updated_at=statement_timestamp() where id=p_document_id and status='draft' and revision=p_expected_revision returning revision into new_revision;
    delete from warehouse.issue_lines where document_id=p_document_id;
    insert into warehouse.issue_lines(document_id,item_id,quantity,unit_price,notes) select p_document_id,(x->>'itemId')::uuid,(x->>'quantity')::numeric,coalesce((x->>'unitPrice')::numeric,0),x->>'notes' from jsonb_array_elements(p_payload->'lines') x;
  elsif p_document_kind='transfer' then
    update warehouse.transfer_documents set document_date=(p_payload->>'documentDate')::date,notes=p_payload->>'notes',revision=revision+1,updated_at=statement_timestamp() where id=p_document_id and status='draft' and revision=p_expected_revision returning revision into new_revision;
    delete from warehouse.transfer_lines where document_id=p_document_id;
    insert into warehouse.transfer_lines(document_id,item_id,quantity,notes) select p_document_id,(x->>'itemId')::uuid,(x->>'quantity')::numeric,x->>'notes' from jsonb_array_elements(p_payload->'lines') x;
  else
    raise exception 'WAREHOUSE_DOCUMENT_KIND_INVALID' using errcode='22023';
  end if;
  if new_revision is null then raise exception 'WAREHOUSE_DOCUMENT_REVISION_CONFLICT' using errcode='40001'; end if;
  perform warehouse_private.write_audit(context,'document.draft_updated',permission,store_ids,p_operation_id,p_document_id,p_document_kind,'draft','draft',new_revision,p_payload->>'reason','warehouse_approval_policy_v1',null,null,'{}',authorization_contexts);
  return warehouse_private.complete_operation(p_operation_id,jsonb_build_object('documentId',p_document_id,'revision',new_revision));
end; $$;

create function warehouse.submit_adjustment_for_approval(p_device_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare d warehouse.adjustment_documents%rowtype; context jsonb; replay jsonb; result jsonb;
begin
  select * into d from warehouse.adjustment_documents where id=p_document_id;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.adjust',d.store_id);
  if d.adjustment_kind='opening_balance' then raise exception 'WAREHOUSE_APPROVAL_NOT_REQUIRED' using errcode='22023'; end if;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'submit_adjustment_approval',p_document_id,array[d.store_id],jsonb_build_object('revision',p_expected_revision)); if replay is not null then return replay; end if;
  perform 1 from warehouse.adjustment_documents where id=p_document_id for update;
  perform warehouse_private.validate_adjustment_document(p_document_id);
  update warehouse.adjustment_documents set approval_status='pending',revision=revision+1,submitted_revision=revision+1,submitted_by=(context->>'actorUserId')::uuid,submitted_device_id=p_device_id,submitted_at=statement_timestamp(),updated_at=statement_timestamp() where id=p_document_id and status='draft' and revision=p_expected_revision and approval_status in ('not_submitted','rejected') returning revision into d.revision;
  if not found then raise exception 'WAREHOUSE_APPROVAL_SUBMISSION_INVALID' using errcode='55000'; end if;
  result:=jsonb_build_object('documentId',p_document_id,'approvalStatus','pending','revision',d.revision);
  perform warehouse_private.write_audit(context,'approval.submitted','warehouse.stock.adjust',array[d.store_id],p_operation_id,p_document_id,d.adjustment_kind,'draft','draft',d.revision,null,'warehouse_approval_policy_v1');
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

create function warehouse.decide_adjustment_approval(p_device_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_revision bigint,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare d warehouse.adjustment_documents%rowtype; context jsonb; replay jsonb; actor uuid; result jsonb;
begin
  select * into d from warehouse.adjustment_documents where id=p_document_id;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.approve',d.store_id); actor:=(context->>'actorUserId')::uuid;
  if actor=d.creator_user_id then raise exception 'WAREHOUSE_CREATOR_SELF_APPROVAL_FORBIDDEN' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'WAREHOUSE_APPROVAL_DECISION_INVALID' using errcode='22023'; end if;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'decide_adjustment_approval',p_document_id,array[d.store_id],jsonb_build_object('revision',p_expected_revision,'decision',p_decision,'reason',p_reason)); if replay is not null then return replay; end if;
  perform 1 from warehouse.adjustment_documents where id=p_document_id for update;
  update warehouse.adjustment_documents set approval_status=p_decision,updated_at=statement_timestamp() where id=p_document_id and status='draft' and approval_status='pending' and revision=p_expected_revision and submitted_revision=revision returning revision into d.revision;
  if not found then raise exception 'WAREHOUSE_APPROVAL_STATE_INVALID' using errcode='55000'; end if;
  insert into warehouse.approval_records(document_kind,document_id,document_revision,decision,policy_version,initiator_user_id,approver_user_id,approver_device_id,reason) values('adjustment',p_document_id,d.revision,p_decision,'warehouse_approval_policy_v1',d.creator_user_id,actor,p_device_id,p_reason);
  result:=jsonb_build_object('documentId',p_document_id,'approvalStatus',p_decision,'revision',d.revision);
  perform warehouse_private.write_audit(context,'approval.'||p_decision,'warehouse.stock.approve',array[d.store_id],p_operation_id,p_document_id,d.adjustment_kind,'pending',p_decision,d.revision,p_reason,'warehouse_approval_policy_v1');
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

-- Posting is intentionally centralized in a private helper; public entry points remain kind-specific.
create function warehouse_private.post_document(p_device_id uuid,p_operation_id uuid,p_kind text,p_document_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare stores uuid[]; kind_permission text; context jsonb; kind_context_2 jsonb; post_context_1 jsonb; post_context_2 jsonb; approval_contexts jsonb; authorization_contexts jsonb:='[]'; replay jsonb; actor uuid; line record; balance warehouse.stock_balances%rowtype; movement_seq bigint; movement_ids uuid[]:='{}'; transfer_group uuid; approval text; submitted_revision bigint; creator uuid; status_now text; movement_id uuid; out_cost numeric(20,6); new_qty numeric(20,6); new_value numeric(26,6); result jsonb;
begin
  if p_kind='receipt' then select array[destination_store_id],status,creator_user_id into stores,status_now,creator from warehouse.receipt_documents where id=p_document_id; kind_permission:='warehouse.stock.receive';
  elsif p_kind='issue' then select array[source_store_id],status,creator_user_id into stores,status_now,creator from warehouse.issue_documents where id=p_document_id; kind_permission:='warehouse.stock.issue';
  elsif p_kind='transfer' then select array[source_store_id,destination_store_id],status,creator_user_id into stores,status_now,creator from warehouse.transfer_documents where id=p_document_id; kind_permission:='warehouse.stock.transfer'; transfer_group:=gen_random_uuid();
  elsif p_kind='adjustment_document' then select array[store_id],status,creator_user_id,approval_status,submitted_revision,adjustment_kind into stores,status_now,creator,approval,submitted_revision,p_kind from warehouse.adjustment_documents where id=p_document_id; kind_permission:='warehouse.stock.adjust';
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
  else select status,approval_status,submitted_revision,adjustment_kind into status_now,approval,submitted_revision,p_kind from warehouse.adjustment_documents where id=p_document_id for update; end if;
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

create function warehouse.post_receipt(p_device_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_revision bigint) returns jsonb language sql security definer set search_path=pg_catalog,warehouse_private as $$ select warehouse_private.post_document(p_device_id,p_operation_id,'receipt',p_document_id,p_expected_revision) $$;
create function warehouse.post_issue(p_device_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_revision bigint) returns jsonb language sql security definer set search_path=pg_catalog,warehouse_private as $$ select warehouse_private.post_document(p_device_id,p_operation_id,'issue',p_document_id,p_expected_revision) $$;
create function warehouse.post_transfer(p_device_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_revision bigint) returns jsonb language sql security definer set search_path=pg_catalog,warehouse_private as $$ select warehouse_private.post_document(p_device_id,p_operation_id,'transfer',p_document_id,p_expected_revision) $$;
create function warehouse.post_adjustment(p_device_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_revision bigint) returns jsonb language sql security definer set search_path=pg_catalog,warehouse_private as $$ select warehouse_private.post_document(p_device_id,p_operation_id,'adjustment_document',p_document_id,p_expected_revision) $$;

create function warehouse.create_reversal_request(p_device_id uuid,p_operation_id uuid,p_original_document_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare registry warehouse.document_registry%rowtype; stores uuid[]; original_status text; context jsonb; replay jsonb; actor uuid; request_id uuid; result jsonb;
begin
  select * into registry from warehouse.document_registry where id=p_original_document_id;
  if registry.id is null or registry.document_kind='reversal' then raise exception 'WAREHOUSE_POSTED_ORIGINAL_REQUIRED' using errcode='55000'; end if;
  if registry.document_kind='receipt' then select array[destination_store_id],status into stores,original_status from warehouse.receipt_documents where id=registry.id;
  elsif registry.document_kind='issue' then select array[source_store_id],status into stores,original_status from warehouse.issue_documents where id=registry.id;
  elsif registry.document_kind='transfer' then select array[source_store_id,destination_store_id],status into stores,original_status from warehouse.transfer_documents where id=registry.id;
  else select array[store_id],status into stores,original_status from warehouse.adjustment_documents where id=registry.id; end if;
  if stores is null then raise exception 'WAREHOUSE_POSTED_ORIGINAL_REQUIRED' using errcode='55000'; end if;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.adjust',stores[1]); if array_length(stores,1)=2 then perform warehouse_private.require_permission(p_device_id,'warehouse.stock.adjust',stores[2]); end if; actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'create_reversal_request',p_original_document_id,stores,jsonb_build_object('reason',p_reason)); if replay is not null then return replay; end if;
  if original_status<>'posted' then raise exception 'WAREHOUSE_POSTED_ORIGINAL_REQUIRED' using errcode='55000'; end if;
  if registry.document_kind='receipt' then perform 1 from warehouse.receipt_documents where id=registry.id and status='posted' for update;
  elsif registry.document_kind='issue' then perform 1 from warehouse.issue_documents where id=registry.id and status='posted' for update;
  elsif registry.document_kind='transfer' then perform 1 from warehouse.transfer_documents where id=registry.id and status='posted' for update;
  else perform 1 from warehouse.adjustment_documents where id=registry.id and status='posted' for update; end if;
  insert into warehouse.reversal_requests(original_document_id,original_document_kind,reason,status,initiator_user_id,initiator_device_id) values(registry.id,registry.document_kind,p_reason,'draft',actor,p_device_id) returning id into request_id;
  result:=jsonb_build_object('reversalRequestId',request_id,'status','draft','revision',1);
  perform warehouse_private.write_audit(context,'reversal.created','warehouse.stock.adjust',stores,p_operation_id,p_original_document_id,registry.document_kind,'posted','posted',1,p_reason,'warehouse_approval_policy_v1',p_original_document_id,request_id);
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

create function warehouse.submit_reversal_request(p_device_id uuid,p_operation_id uuid,p_request_id uuid,p_expected_revision bigint,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare request warehouse.reversal_requests%rowtype; stores uuid[]; context jsonb; replay jsonb; result jsonb;
begin
  select * into request from warehouse.reversal_requests where id=p_request_id;
  select array_agg(distinct store_id order by store_id) into stores from warehouse.stock_movements where document_id=request.original_document_id;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.adjust',stores[1]); if array_length(stores,1)=2 then perform warehouse_private.require_permission(p_device_id,'warehouse.stock.adjust',stores[2]); end if;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'submit_reversal_request',p_request_id,stores,jsonb_build_object('revision',p_expected_revision,'reason',p_reason)); if replay is not null then return replay; end if;
  perform 1 from warehouse.reversal_requests where id=p_request_id for update;
  update warehouse.reversal_requests set reason=p_reason,status='pending',revision=revision+1,submitted_revision=revision+1,submitted_by=(context->>'actorUserId')::uuid,submitted_device_id=p_device_id,submitted_at=statement_timestamp(),updated_at=statement_timestamp()
   where id=p_request_id and status in ('draft','rejected') and revision=p_expected_revision returning * into request;
  if not found then raise exception 'WAREHOUSE_REVERSAL_SUBMISSION_INVALID' using errcode='55000'; end if;
  result:=jsonb_build_object('reversalRequestId',p_request_id,'status','pending','revision',request.revision);
  perform warehouse_private.write_audit(context,'reversal.submitted','warehouse.stock.adjust',stores,p_operation_id,request.original_document_id,request.original_document_kind,'draft','pending',request.revision,p_reason,'warehouse_approval_policy_v1',request.original_document_id,p_request_id);
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

create function warehouse.decide_reversal_approval(p_device_id uuid,p_operation_id uuid,p_request_id uuid,p_expected_revision bigint,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare request warehouse.reversal_requests%rowtype; stores uuid[]; context jsonb; actor uuid; replay jsonb; result jsonb;
begin
  select * into request from warehouse.reversal_requests where id=p_request_id;
  select array_agg(distinct store_id order by store_id) into stores from warehouse.stock_movements where document_id=request.original_document_id;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.approve',stores[1]); if array_length(stores,1)=2 then perform warehouse_private.require_permission(p_device_id,'warehouse.stock.approve',stores[2]); end if; actor:=(context->>'actorUserId')::uuid;
  if actor=request.initiator_user_id then raise exception 'WAREHOUSE_REVERSAL_INITIATOR_SELF_APPROVAL_FORBIDDEN' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'WAREHOUSE_APPROVAL_DECISION_INVALID' using errcode='22023'; end if;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'decide_reversal_approval',p_request_id,stores,jsonb_build_object('revision',p_expected_revision,'decision',p_decision,'reason',p_reason)); if replay is not null then return replay; end if;
  perform 1 from warehouse.reversal_requests where id=p_request_id for update;
  update warehouse.reversal_requests set status=p_decision,updated_at=statement_timestamp() where id=p_request_id and status='pending' and revision=p_expected_revision and submitted_revision=revision returning revision into request.revision;
  if not found then raise exception 'WAREHOUSE_REVERSAL_APPROVAL_STATE_INVALID' using errcode='55000'; end if;
  insert into warehouse.approval_records(document_kind,document_id,document_revision,decision,policy_version,initiator_user_id,approver_user_id,approver_device_id,reason) values('reversal',p_request_id,request.revision,p_decision,'warehouse_approval_policy_v1',request.initiator_user_id,actor,p_device_id,p_reason);
  result:=jsonb_build_object('reversalRequestId',p_request_id,'status',p_decision,'revision',request.revision);
  perform warehouse_private.write_audit(context,'reversal.'||p_decision,'warehouse.stock.approve',stores,p_operation_id,request.original_document_id,request.original_document_kind,'pending',p_decision,request.revision,p_reason,'warehouse_approval_policy_v1',request.original_document_id,p_request_id);
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

create function warehouse.post_reversal(p_device_id uuid,p_operation_id uuid,p_request_id uuid,p_expected_revision bigint) returns jsonb
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
  if exists(select 1 from warehouse.stock_movements original join warehouse.stock_movements later on later.store_id=original.store_id and later.item_id=original.item_id and later.sequence>original.sequence where original.document_id=request.original_document_id) then raise exception 'WAREHOUSE_REVERSAL_REQUIRES_LATEST_MOVEMENT_LINEAGE' using errcode='55000'; end if;
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

create function warehouse.view_stock(p_device_id uuid,p_store_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
begin
  perform warehouse_private.require_permission(p_device_id,'warehouse.store.view',p_store_id); perform warehouse_private.require_permission(p_device_id,'warehouse.item.view');
  return jsonb_build_object('balances',(select coalesce(jsonb_agg(to_jsonb(b) order by b.item_id),'[]') from warehouse.stock_balances b where b.store_id=p_store_id),'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.sequence),'[]') from warehouse.stock_movements m where m.store_id=p_store_id));
end; $$;

create function warehouse.authorize_report_export(p_device_id uuid,p_store_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,warehouse_private as $$
declare context jsonb;
begin
  perform warehouse_private.require_permission(p_device_id,'warehouse.reports.view',p_store_id);
  context:=warehouse_private.require_permission(p_device_id,'warehouse.reports.export',p_store_id);
  return jsonb_build_object('authorized',true,'storeId',p_store_id,'authoritySource',context->>'authoritySource');
end; $$;

create function warehouse.stage_import(p_device_id uuid,p_operation_id uuid,p_manifest jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,warehouse_private as $$
declare context jsonb;
begin
  context:=warehouse_private.require_permission(p_device_id,'warehouse.import.stage');
  raise exception 'WAREHOUSE_IMPORT_STAGING_DEFERRED' using errcode='0A000';
end; $$;

revoke all on all functions in schema warehouse_private from public,anon,authenticated;
revoke all on all functions in schema warehouse from public,anon;
revoke all on all functions in schema warehouse from authenticated;
grant usage on schema warehouse to authenticated;
grant execute on function warehouse.list_stores(uuid,uuid),warehouse.create_store(uuid,uuid,text,text,text,text),warehouse.update_store(uuid,uuid,uuid,bigint,text,text,text,text,text),warehouse.list_item_master(uuid),warehouse.upsert_item_master(uuid,uuid,text,uuid,bigint,jsonb),warehouse.create_receipt_draft(uuid,uuid,jsonb),warehouse.create_issue_draft(uuid,uuid,jsonb),warehouse.create_transfer_draft(uuid,uuid,jsonb),warehouse.create_adjustment_draft(uuid,uuid,text,jsonb),warehouse.update_document_draft(uuid,uuid,text,uuid,bigint,jsonb),warehouse.submit_adjustment_for_approval(uuid,uuid,uuid,bigint),warehouse.decide_adjustment_approval(uuid,uuid,uuid,bigint,text,text),warehouse.post_receipt(uuid,uuid,uuid,bigint),warehouse.post_issue(uuid,uuid,uuid,bigint),warehouse.post_transfer(uuid,uuid,uuid,bigint),warehouse.post_adjustment(uuid,uuid,uuid,bigint),warehouse.create_reversal_request(uuid,uuid,uuid,text),warehouse.submit_reversal_request(uuid,uuid,uuid,bigint,text),warehouse.decide_reversal_approval(uuid,uuid,uuid,bigint,text,text),warehouse.post_reversal(uuid,uuid,uuid,bigint),warehouse.view_stock(uuid,uuid),warehouse.authorize_report_export(uuid,uuid),warehouse.stage_import(uuid,uuid,jsonb) to authenticated;

commit;
