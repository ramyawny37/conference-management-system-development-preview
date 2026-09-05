begin;

create table warehouse.item_units (
  item_id uuid not null references warehouse.items(id),
  unit_id uuid not null references warehouse.units(id),
  conversion_factor numeric(20,6) not null check (conversion_factor>0 and conversion_factor<'Infinity'::numeric),
  status text not null default 'active' check (status in ('active','inactive')),
  revision bigint not null default 1 check (revision>0),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key(item_id,unit_id)
);

alter table warehouse.item_units enable row level security;
revoke all on warehouse.item_units from public,anon,authenticated;

insert into warehouse.item_units(item_id,unit_id,conversion_factor,status,created_by,updated_by,created_at,updated_at)
select i.id,i.base_unit_id,1,'active',i.created_by,i.updated_by,i.created_at,i.updated_at from warehouse.items i;

alter table warehouse.receipt_lines add column selected_unit_id uuid references warehouse.units(id), add column entered_quantity numeric(20,6), add column conversion_factor_snapshot numeric(20,6), add column selected_unit_cost numeric(20,6), add column selected_unit_price numeric(20,6);
alter table warehouse.issue_lines add column selected_unit_id uuid references warehouse.units(id), add column entered_quantity numeric(20,6), add column conversion_factor_snapshot numeric(20,6), add column selected_unit_price numeric(20,6);
alter table warehouse.transfer_lines add column selected_unit_id uuid references warehouse.units(id), add column entered_quantity numeric(20,6), add column conversion_factor_snapshot numeric(20,6);
alter table warehouse.adjustment_lines add column selected_unit_id uuid references warehouse.units(id), add column entered_quantity numeric(20,6), add column conversion_factor_snapshot numeric(20,6), add column selected_unit_cost numeric(20,6);

alter table warehouse.receipt_lines disable trigger receipt_lines_posted_immutable;
alter table warehouse.issue_lines disable trigger issue_lines_posted_immutable;
alter table warehouse.transfer_lines disable trigger transfer_lines_posted_immutable;
alter table warehouse.adjustment_lines disable trigger adjustment_lines_posted_immutable;

update warehouse.receipt_lines l set selected_unit_id=i.base_unit_id,entered_quantity=l.quantity,conversion_factor_snapshot=1,selected_unit_cost=l.unit_cost,selected_unit_price=l.unit_price from warehouse.items i where i.id=l.item_id;
update warehouse.issue_lines l set selected_unit_id=i.base_unit_id,entered_quantity=l.quantity,conversion_factor_snapshot=1,selected_unit_price=l.unit_price from warehouse.items i where i.id=l.item_id;
update warehouse.transfer_lines l set selected_unit_id=i.base_unit_id,entered_quantity=l.quantity,conversion_factor_snapshot=1 from warehouse.items i where i.id=l.item_id;
update warehouse.adjustment_lines l set selected_unit_id=i.base_unit_id,entered_quantity=l.quantity,conversion_factor_snapshot=1,selected_unit_cost=l.inbound_unit_cost from warehouse.items i where i.id=l.item_id;

alter table warehouse.receipt_lines enable trigger receipt_lines_posted_immutable;
alter table warehouse.issue_lines enable trigger issue_lines_posted_immutable;
alter table warehouse.transfer_lines enable trigger transfer_lines_posted_immutable;
alter table warehouse.adjustment_lines enable trigger adjustment_lines_posted_immutable;

create function warehouse_private.default_legacy_unit_snapshot() returns trigger language plpgsql set search_path=pg_catalog,warehouse as $$
declare base_unit uuid;
begin
  select base_unit_id into base_unit from warehouse.items where id=new.item_id;
  new.selected_unit_id:=coalesce(new.selected_unit_id,base_unit);
  new.entered_quantity:=coalesce(new.entered_quantity,new.quantity);
  new.conversion_factor_snapshot:=coalesce(new.conversion_factor_snapshot,1);
  if tg_table_name='receipt_lines' then new.selected_unit_cost:=coalesce(new.selected_unit_cost,new.unit_cost); new.selected_unit_price:=coalesce(new.selected_unit_price,new.unit_price);
  elsif tg_table_name='issue_lines' then new.selected_unit_price:=coalesce(new.selected_unit_price,new.unit_price);
  elsif tg_table_name='adjustment_lines' then new.selected_unit_cost:=coalesce(new.selected_unit_cost,new.inbound_unit_cost); end if;
  return new;
end; $$;
create trigger receipt_lines_unit_snapshot_default before insert on warehouse.receipt_lines for each row execute function warehouse_private.default_legacy_unit_snapshot();
create trigger issue_lines_unit_snapshot_default before insert on warehouse.issue_lines for each row execute function warehouse_private.default_legacy_unit_snapshot();
create trigger transfer_lines_unit_snapshot_default before insert on warehouse.transfer_lines for each row execute function warehouse_private.default_legacy_unit_snapshot();
create trigger adjustment_lines_unit_snapshot_default before insert on warehouse.adjustment_lines for each row execute function warehouse_private.default_legacy_unit_snapshot();

alter table warehouse.receipt_lines alter column selected_unit_id set not null,alter column entered_quantity set not null,alter column conversion_factor_snapshot set not null,add check(entered_quantity>0 and conversion_factor_snapshot>0),add check(quantity=round(entered_quantity*conversion_factor_snapshot,6));
alter table warehouse.issue_lines alter column selected_unit_id set not null,alter column entered_quantity set not null,alter column conversion_factor_snapshot set not null,add check(entered_quantity>0 and conversion_factor_snapshot>0),add check(quantity=round(entered_quantity*conversion_factor_snapshot,6));
alter table warehouse.transfer_lines alter column selected_unit_id set not null,alter column entered_quantity set not null,alter column conversion_factor_snapshot set not null,add check(entered_quantity>0 and conversion_factor_snapshot>0),add check(quantity=round(entered_quantity*conversion_factor_snapshot,6));
alter table warehouse.adjustment_lines alter column selected_unit_id set not null,alter column entered_quantity set not null,alter column conversion_factor_snapshot set not null,add check(entered_quantity>0 and conversion_factor_snapshot>0),add check(quantity=round(entered_quantity*conversion_factor_snapshot,6));

create function warehouse_private.canonicalize_unit_lines(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse as $$
declare source_line jsonb; canonical jsonb:='[]'; item warehouse.items%rowtype; relation warehouse.item_units%rowtype; selected warehouse.units%rowtype; base warehouse.units%rowtype; entered numeric; raw_base_quantity numeric; base_quantity numeric; selected_cost numeric; selected_price numeric;
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
    selected_cost:=nullif(source_line->>'unitCost','')::numeric; selected_price:=coalesce(nullif(source_line->>'actualUnitPrice','')::numeric,nullif(source_line->>'unitPrice','')::numeric);
    source_line:=source_line||jsonb_build_object('unitId',selected.id,'enteredQuantity',entered,'conversionFactorSnapshot',relation.conversion_factor,'quantity',base_quantity);
    if selected_cost is not null then source_line:=source_line||jsonb_build_object('selectedUnitCost',selected_cost,'unitCost',round(selected_cost/relation.conversion_factor,6)); end if;
    if selected_price is not null then source_line:=source_line||jsonb_build_object('selectedUnitPrice',selected_price,'unitPrice',round(selected_price/relation.conversion_factor,6),'actualUnitPrice',round(selected_price/relation.conversion_factor,6)); end if;
    canonical:=canonical||jsonb_build_array(source_line);
  end loop;
  return jsonb_set(p_payload,'{lines}',canonical,false);
end; $$;
revoke all on function warehouse_private.canonicalize_unit_lines(jsonb) from public,anon,authenticated;

alter function warehouse_private.create_document_draft(uuid,uuid,text,jsonb) rename to create_document_draft_pre_unit_conversion;
create function warehouse_private.create_document_draft(p_device_id uuid,p_operation_id uuid,p_kind text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare canonical jsonb; result jsonb; document_id uuid;
begin
  canonical:=warehouse_private.canonicalize_unit_lines(p_payload);
  result:=warehouse_private.create_document_draft_pre_unit_conversion(p_device_id,p_operation_id,p_kind,canonical); document_id:=(result->>'documentId')::uuid;
  if (p_kind='receipt' and not exists(select 1 from warehouse.receipt_documents where id=document_id and status='draft')) or (p_kind='issue' and not exists(select 1 from warehouse.issue_documents where id=document_id and status='draft')) or (p_kind='transfer' and not exists(select 1 from warehouse.transfer_documents where id=document_id and status='draft')) or (p_kind in ('opening_balance','adjustment','damage_loss','correction') and not exists(select 1 from warehouse.adjustment_documents where id=document_id and status='draft')) then return result; end if;
  if p_kind='receipt' then update warehouse.receipt_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric,selected_unit_cost=(x->>'selectedUnitCost')::numeric,selected_unit_price=(x->>'selectedUnitPrice')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=document_id and l.item_id=(x->>'itemId')::uuid;
  elsif p_kind='issue' then update warehouse.issue_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric,selected_unit_price=(x->>'selectedUnitPrice')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=document_id and l.item_id=(x->>'itemId')::uuid;
  elsif p_kind='transfer' then update warehouse.transfer_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=document_id and l.item_id=(x->>'itemId')::uuid;
  else update warehouse.adjustment_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric,selected_unit_cost=(x->>'selectedUnitCost')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=document_id and l.item_id=(x->>'itemId')::uuid; end if;
  return result;
end; $$;
revoke all on function warehouse_private.create_document_draft(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function warehouse_private.create_document_draft_pre_unit_conversion(uuid,uuid,text,jsonb) from public,anon,authenticated;

alter function warehouse.update_document_draft(uuid,uuid,text,uuid,bigint,jsonb) rename to update_document_draft_pre_unit_conversion;
create function warehouse.update_document_draft(p_device_id uuid,p_operation_id uuid,p_document_kind text,p_document_id uuid,p_expected_revision bigint,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare canonical jsonb; result jsonb;
begin
  canonical:=warehouse_private.canonicalize_unit_lines(p_payload);
  result:=warehouse.update_document_draft_pre_unit_conversion(p_device_id,p_operation_id,p_document_kind,p_document_id,p_expected_revision,canonical);
  if (p_document_kind='receipt' and not exists(select 1 from warehouse.receipt_documents where id=p_document_id and status='draft')) or (p_document_kind='issue' and not exists(select 1 from warehouse.issue_documents where id=p_document_id and status='draft')) or (p_document_kind='transfer' and not exists(select 1 from warehouse.transfer_documents where id=p_document_id and status='draft')) or (p_document_kind in ('opening_balance','adjustment','damage_loss','correction') and not exists(select 1 from warehouse.adjustment_documents where id=p_document_id and status='draft')) then return result; end if;
  if p_document_kind='receipt' then update warehouse.receipt_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric,selected_unit_cost=(x->>'selectedUnitCost')::numeric,selected_unit_price=(x->>'selectedUnitPrice')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=p_document_id and l.item_id=(x->>'itemId')::uuid;
  elsif p_document_kind='issue' then update warehouse.issue_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric,selected_unit_price=(x->>'selectedUnitPrice')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=p_document_id and l.item_id=(x->>'itemId')::uuid;
  elsif p_document_kind='transfer' then update warehouse.transfer_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=p_document_id and l.item_id=(x->>'itemId')::uuid;
  else update warehouse.adjustment_lines l set selected_unit_id=(x->>'unitId')::uuid,entered_quantity=(x->>'enteredQuantity')::numeric,conversion_factor_snapshot=(x->>'conversionFactorSnapshot')::numeric,selected_unit_cost=(x->>'selectedUnitCost')::numeric from jsonb_array_elements(canonical->'lines') x where l.document_id=p_document_id and l.item_id=(x->>'itemId')::uuid; end if;
  return result;
end; $$;
revoke all on function warehouse.update_document_draft_pre_unit_conversion(uuid,uuid,text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function warehouse.update_document_draft(uuid,uuid,text,uuid,bigint,jsonb) to service_role;

create or replace function warehouse.list_item_master(p_device_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
begin
  perform warehouse_private.require_permission(p_device_id,'warehouse.item.view');
  return jsonb_build_object('categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.code),'[]') from warehouse.categories c),'units',(select coalesce(jsonb_agg(to_jsonb(u) order by u.code),'[]') from warehouse.units u),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.sku),'[]') from warehouse.items i),'itemUnits',(select coalesce(jsonb_agg(to_jsonb(iu) order by iu.item_id,iu.unit_id),'[]') from warehouse.item_units iu));
end; $$;

create function warehouse_private.enforce_item_base_unit() returns trigger language plpgsql set search_path=pg_catalog,warehouse as $$
begin
  if old.base_unit_id<>new.base_unit_id and exists(select 1 from warehouse.stock_movements where item_id=old.id) then raise exception 'WAREHOUSE_BASE_UNIT_CHANGE_WITH_HISTORY' using errcode='55000'; end if;
  return new;
end; $$;
create trigger items_base_unit_history_guard before update of base_unit_id on warehouse.items for each row execute function warehouse_private.enforce_item_base_unit();

create function warehouse_private.sync_item_base_unit() returns trigger language plpgsql set search_path=pg_catalog,warehouse as $$
begin
  insert into warehouse.item_units(item_id,unit_id,conversion_factor,status,created_by,updated_by)
  values(new.id,new.base_unit_id,1,'active',new.updated_by,new.updated_by)
  on conflict(item_id,unit_id) do update set conversion_factor=1,status='active',updated_by=new.updated_by,updated_at=statement_timestamp(),revision=warehouse.item_units.revision+1;
  return new;
end; $$;
create trigger items_base_unit_relation after insert or update of base_unit_id on warehouse.items for each row execute function warehouse_private.sync_item_base_unit();

create function warehouse.upsert_item_units(p_device_id uuid,p_operation_id uuid,p_item_id uuid,p_expected_revision bigint,p_units jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare context jsonb; replay jsonb; actor uuid; item warehouse.items%rowtype; entry jsonb; unit_id uuid; factor numeric; status text; result jsonb;
begin
  context:=warehouse_private.require_permission(p_device_id,'warehouse.item.update'); actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'warehouse.item_units.update',p_item_id,'{}',jsonb_build_object('revision',p_expected_revision,'units',p_units)); if replay is not null then return replay; end if;
  select * into item from warehouse.items where id=p_item_id for update;
  if item.id is null or item.revision<>p_expected_revision then raise exception 'WAREHOUSE_MASTER_REVISION_CONFLICT' using errcode='40001'; end if;
  if jsonb_typeof(p_units)<>'array' then raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_units) x group by x->>'unitId' having count(*)>1) then raise exception 'WAREHOUSE_ITEM_UNIT_DUPLICATE' using errcode='22023'; end if;
  for entry in select * from jsonb_array_elements(p_units) loop
    unit_id:=(entry->>'unitId')::uuid; factor:=(entry->>'conversionFactor')::numeric; status:=coalesce(entry->>'status','active');
    if factor<=0 or factor>='Infinity'::numeric then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
    if unit_id=item.base_unit_id and (factor<>1 or status<>'active') then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
    if not exists(select 1 from warehouse.units where id=unit_id) then raise exception 'WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED' using errcode='22023'; end if;
    insert into warehouse.item_units(item_id,unit_id,conversion_factor,status,created_by,updated_by) values(item.id,unit_id,factor,status,actor,actor)
    on conflict(item_id,unit_id) do update set conversion_factor=excluded.conversion_factor,status=excluded.status,updated_by=actor,updated_at=statement_timestamp(),revision=warehouse.item_units.revision+1;
  end loop;
  if not exists(select 1 from warehouse.item_units where item_id=item.id and unit_id=item.base_unit_id and conversion_factor=1 and status='active') then raise exception 'WAREHOUSE_CONVERSION_FACTOR_INVALID' using errcode='22023'; end if;
  update warehouse.items set revision=revision+1,updated_by=actor,updated_at=statement_timestamp() where id=item.id returning revision into item.revision;
  result:=jsonb_build_object('entityKind','itemUnits','entityId',item.id,'revision',item.revision);
  perform warehouse_private.write_audit(context,'item_units.changed','warehouse.item.update','{}',p_operation_id,null,'itemUnits',null,null,item.revision,null,null,null,null,result);
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;
revoke all on function warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb) to service_role;

alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) rename to execute_device_operation_pre_item_units;
create function platform.execute_device_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_module text,p_operation text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,platform,platform_private,warehouse,warehouse_private as $$
declare session platform_private.device_sessions%rowtype;
begin
  if p_module<>'warehouse' or p_operation<>'upsert_item_units' then return platform.execute_device_operation_pre_item_units(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args); end if;
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
  if p_args is null or jsonb_typeof(p_args)<>'object' or p_args?'p_device_id' or p_args?'p_actor_device_id' then raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023'; end if;
  select item.* into session from platform_private.device_sessions item join platform.device_key_bindings binding on binding.id=item.binding_id join platform.user_device_authorizations uda on uda.id=item.device_authorization_id join platform.devices device on device.id=item.device_id join platform.profiles profile on profile.user_id=item.user_id
  where item.id=p_session_id and item.user_id=p_user_id and item.token_hash=p_token_hash and item.purpose='PLATFORM_DEVICE_SESSION' and item.revoked_at is null and item.expires_at>statement_timestamp() and binding.user_id=item.user_id and binding.device_id=item.device_id and binding.device_authorization_id=item.device_authorization_id and binding.public_key_thumbprint=item.public_key_thumbprint and binding.algorithm='ECDSA_P256_SHA256' and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null and uda.user_id=item.user_id and uda.device_id=item.device_id and uda.status='approved' and uda.revoked_at is null and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null and profile.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true);
  perform set_config('platform.phase1c_context',jsonb_build_object('purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',session.id,'user_id',session.user_id,'device_id',session.device_id,'authorization_id',session.device_authorization_id,'binding_id',session.binding_id,'token_hash',encode(p_token_hash,'hex'))::text,true);
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_item_id','p_expected_revision','p_units']);
  return warehouse.upsert_item_units(session.device_id,(p_args->>'p_operation_id')::uuid,(p_args->>'p_item_id')::uuid,(p_args->>'p_expected_revision')::bigint,p_args->'p_units');
end; $$;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),platform.execute_device_operation_pre_item_units(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),platform.execute_device_operation_pre_item_units(uuid,uuid,bytea,text,text,jsonb) to service_role;

commit;
