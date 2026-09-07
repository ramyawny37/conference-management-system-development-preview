begin;

-- Party master and beneficiary finance remain inside the active Warehouse
-- authorization boundary. Inventory value and beneficiary money are separate.
insert into public.module_permission_catalog(permission_key,module_key,display_name,description,status,allowed_scope_mode,allowed_resource_type,sensitive_mutation,catalog_version)
values
  ('warehouse.party.view','warehouse','View Warehouse parties','View supplier and beneficiary parties.','active','module',null,false,1),
  ('warehouse.party.manage','warehouse','Manage Warehouse parties','Create and update supplier and beneficiary parties.','active','module',null,true,1)
on conflict (permission_key) do nothing;

create table warehouse.parties (
  id uuid primary key default gen_random_uuid(),
  name text not null check(name=btrim(name) and char_length(name) between 2 and 160),
  phone text check(phone is null or (phone=btrim(phone) and char_length(phone)<=40)),
  governorate text check(governorate is null or (governorate=btrim(governorate) and char_length(governorate)<=120)),
  city text check(city is null or (city=btrim(city) and char_length(city)<=120)),
  status text not null default 'active' check(status in ('active','inactive')),
  notes text check(notes is null or char_length(notes)<=2000),
  revision bigint not null default 1 check(revision>0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check(updated_at>=created_at)
);
create table warehouse.party_roles (
  party_id uuid not null references warehouse.parties(id) on delete restrict,
  role text not null check(role in ('supplier','beneficiary')),
  created_at timestamptz not null default statement_timestamp(),
  primary key(party_id,role)
);

alter table warehouse.receipt_documents
  add column supplier_party_id uuid references warehouse.parties(id) on delete restrict,
  add column supplier_name_snapshot text,
  add column supplier_phone_snapshot text,
  add column supplier_governorate_snapshot text,
  add column supplier_city_snapshot text;

alter table warehouse.issue_documents
  add column beneficiary_party_id uuid references warehouse.parties(id) on delete restrict,
  add column paid_now numeric(20,6) not null default 0 check(paid_now>=0),
  add column beneficiary_name_snapshot text,
  add column beneficiary_phone_snapshot text,
  add column previous_balance_snapshot numeric(26,6),
  add column operation_total_snapshot numeric(26,6),
  add column remaining_snapshot numeric(26,6),
  add column resulting_balance_snapshot numeric(26,6);

alter table warehouse.issue_lines
  add column issue_type text not null default 'paid' check(issue_type in ('paid','subsidized','free','gift')),
  add column reference_unit_price numeric(20,6) not null default 0 check(reference_unit_price>=0),
  add column price_override_reason text check(price_override_reason is null or char_length(btrim(price_override_reason)) between 2 and 500),
  add column gift_recipient_mode text not null default 'unknown' check(gift_recipient_mode in ('unknown','registered_person','manual_recipient')),
  add column gift_recipient_party_id uuid references warehouse.parties(id) on delete restrict,
  add column gift_recipient_name text check(gift_recipient_name is null or char_length(btrim(gift_recipient_name)) between 2 and 160),
  add constraint issue_line_distribution_consistency check(
    (issue_type<>'gift' and gift_recipient_mode='unknown' and gift_recipient_party_id is null and gift_recipient_name is null)
    or (issue_type='gift' and gift_recipient_mode='unknown' and gift_recipient_party_id is null and gift_recipient_name is null)
    or (issue_type='gift' and gift_recipient_mode='registered_person' and gift_recipient_party_id is not null and gift_recipient_name is null)
    or (issue_type='gift' and gift_recipient_mode='manual_recipient' and gift_recipient_party_id is null and gift_recipient_name is not null)
  ),
  add constraint issue_line_free_gift_zero check(issue_type not in ('free','gift') or unit_price=0);

create table warehouse.beneficiary_financial_entries (
  id uuid primary key default gen_random_uuid(),
  beneficiary_party_id uuid not null references warehouse.parties(id) on delete restrict,
  issue_document_id uuid not null references warehouse.issue_documents(id) on delete restrict,
  entry_type text not null check(entry_type in ('issue_charge','issue_payment','reversal_charge','reversal_payment')),
  amount numeric(26,6) not null check(amount<>0),
  operation_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_device_id uuid not null,
  reversal_of_entry_id uuid references warehouse.beneficiary_financial_entries(id) on delete restrict,
  occurred_at timestamptz not null default statement_timestamp(),
  unique(operation_id,entry_type,issue_document_id),
  unique(reversal_of_entry_id),
  check((entry_type like 'reversal_%')=(reversal_of_entry_id is not null))
);
create table warehouse.beneficiary_balances (
  beneficiary_party_id uuid primary key references warehouse.parties(id) on delete restrict,
  balance numeric(26,6) not null default 0,
  revision bigint not null default 1 check(revision>0),
  last_entry_id uuid references warehouse.beneficiary_financial_entries(id) on delete restrict,
  calculated_at timestamptz not null default statement_timestamp()
);

alter table warehouse.parties enable row level security;
alter table warehouse.party_roles enable row level security;
alter table warehouse.beneficiary_financial_entries enable row level security;
alter table warehouse.beneficiary_balances enable row level security;
revoke all on warehouse.parties,warehouse.party_roles,warehouse.beneficiary_financial_entries,warehouse.beneficiary_balances from public,anon,authenticated;

create trigger beneficiary_financial_entries_immutable before update or delete on warehouse.beneficiary_financial_entries for each row execute function warehouse_private.reject_immutable_mutation();

create function warehouse_private.require_active_party(p_party_id uuid,p_role text) returns warehouse.parties
language plpgsql security definer set search_path=pg_catalog,warehouse as $$
declare party warehouse.parties%rowtype;
begin
  select p.* into party from warehouse.parties p where p.id=p_party_id for key share;
  if not found then raise exception 'WAREHOUSE_PARTY_REQUIRED' using errcode='22023'; end if;
  if party.status<>'active' then raise exception 'WAREHOUSE_PARTY_INACTIVE' using errcode='55000'; end if;
  if p_role is not null and not exists(select 1 from warehouse.party_roles r where r.party_id=p_party_id and r.role=p_role) then raise exception 'WAREHOUSE_PARTY_ROLE_MISMATCH' using errcode='55000'; end if;
  return party;
end; $$;

create function warehouse.discover_parties(p_device_id uuid,p_role text default null,p_include_inactive boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
begin
  perform warehouse_private.require_permission(p_device_id,'warehouse.party.view');
  if p_role is not null and p_role not in ('supplier','beneficiary') then raise exception 'WAREHOUSE_PARTY_ROLE_INVALID' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p)-array['created_by','updated_by']||jsonb_build_object('roles',(select jsonb_agg(r.role order by r.role) from warehouse.party_roles r where r.party_id=p.id)) order by p.name,p.id)
    from warehouse.parties p where (p_include_inactive or p.status='active') and (p_role is null or exists(select 1 from warehouse.party_roles r where r.party_id=p.id and r.role=p_role))),'[]');
end; $$;

create function warehouse.create_party(p_device_id uuid,p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare context jsonb; replay jsonb; actor uuid; party_id uuid:=gen_random_uuid(); roles text[]; role_name text; result jsonb;
begin
  context:=warehouse_private.require_permission(p_device_id,'warehouse.party.manage'); actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'create_party',null,'{}',p_payload); if replay is not null then return replay; end if;
  select array_agg(distinct value order by value) into roles from jsonb_array_elements_text(coalesce(p_payload->'roles','[]'));
  if coalesce(cardinality(roles),0)=0 or exists(select 1 from unnest(roles) x where x not in ('supplier','beneficiary')) then raise exception 'WAREHOUSE_PARTY_ROLE_INVALID' using errcode='22023'; end if;
  insert into warehouse.parties(id,name,phone,governorate,city,status,notes,created_by,updated_by)
  values(party_id,btrim(p_payload->>'name'),nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'governorate'),''),nullif(btrim(p_payload->>'city'),''),coalesce(p_payload->>'status','active'),nullif(p_payload->>'notes',''),actor,actor);
  foreach role_name in array roles loop insert into warehouse.party_roles(party_id,role) values(party_id,role_name); end loop;
  result:=jsonb_build_object('partyId',party_id,'revision',1,'roles',roles);
  perform warehouse_private.write_audit(context,'party.created','warehouse.party.manage','{}',p_operation_id,null,'party',null,'active',1,null,null,null,null,jsonb_build_object('partyId',party_id,'roles',roles));
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

create function warehouse.update_party(p_device_id uuid,p_operation_id uuid,p_party_id uuid,p_expected_revision bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare context jsonb; replay jsonb; actor uuid; roles text[]; role_name text; next_revision bigint; old_status text; result jsonb;
begin
  context:=warehouse_private.require_permission(p_device_id,'warehouse.party.manage'); actor:=(context->>'actorUserId')::uuid;
  replay:=warehouse_private.begin_operation(p_operation_id,context,'update_party',p_party_id,'{}',jsonb_build_object('revision',p_expected_revision,'payload',p_payload)); if replay is not null then return replay; end if;
  select status into old_status from warehouse.parties where id=p_party_id for update;
  if not found then raise exception 'WAREHOUSE_PARTY_REQUIRED' using errcode='22023'; end if;
  select array_agg(distinct value order by value) into roles from jsonb_array_elements_text(coalesce(p_payload->'roles','[]'));
  if coalesce(cardinality(roles),0)=0 or exists(select 1 from unnest(roles) x where x not in ('supplier','beneficiary')) then raise exception 'WAREHOUSE_PARTY_ROLE_INVALID' using errcode='22023'; end if;
  update warehouse.parties set name=btrim(p_payload->>'name'),phone=nullif(btrim(p_payload->>'phone'),''),governorate=nullif(btrim(p_payload->>'governorate'),''),city=nullif(btrim(p_payload->>'city'),''),status=p_payload->>'status',notes=nullif(p_payload->>'notes',''),updated_by=actor,updated_at=statement_timestamp(),revision=revision+1
   where id=p_party_id and revision=p_expected_revision returning revision into next_revision;
  if not found then raise exception 'WAREHOUSE_PARTY_REVISION_CONFLICT' using errcode='40001'; end if;
  delete from warehouse.party_roles where party_id=p_party_id; foreach role_name in array roles loop insert into warehouse.party_roles(party_id,role) values(p_party_id,role_name); end loop;
  result:=jsonb_build_object('partyId',p_party_id,'revision',next_revision,'status',p_payload->>'status','roles',roles);
  perform warehouse_private.write_audit(context,'party.updated','warehouse.party.manage','{}',p_operation_id,null,'party',old_status,p_payload->>'status',next_revision,null,null,null,null,jsonb_build_object('partyId',p_party_id,'roles',roles));
  return warehouse_private.complete_operation(p_operation_id,result);
end; $$;

-- Normalize authoritative party snapshots and issue pricing after the existing
-- inventory draft operation. The marker columns make applied-operation replay a no-op.
alter table warehouse.receipt_documents add column party_extension_version smallint not null default 0, add column party_extension_operation_id uuid;
alter table warehouse.issue_documents add column finance_extension_version smallint not null default 0, add column finance_extension_operation_id uuid;

alter function warehouse.create_receipt_draft(uuid,uuid,jsonb) rename to create_receipt_draft_inventory_core;
create function warehouse.create_receipt_draft(p_device_id uuid,p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
#variable_conflict use_variable
declare result jsonb; document_id uuid; party warehouse.parties%rowtype; supplier_id uuid; context jsonb;
begin
  result:=warehouse.create_receipt_draft_inventory_core(p_device_id,p_operation_id,p_payload); document_id:=(result->>'documentId')::uuid;
  if exists(select 1 from warehouse.receipt_documents where id=document_id and party_extension_version=1) then return result; end if;
  supplier_id:=nullif(p_payload->>'supplierPartyId','')::uuid;
  if supplier_id is not null then party:=warehouse_private.require_active_party(supplier_id,'supplier'); end if;
  update warehouse.receipt_documents set supplier_party_id=supplier_id,supplier_name_snapshot=party.name,supplier_phone_snapshot=party.phone,supplier_governorate_snapshot=party.governorate,supplier_city_snapshot=party.city,party_extension_version=1,party_extension_operation_id=p_operation_id where id=document_id and status='draft';
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.receive',(select destination_store_id from warehouse.receipt_documents where id=document_id));
  perform warehouse_private.write_audit(context,'receipt.supplier_assigned','warehouse.stock.receive',array[(select destination_store_id from warehouse.receipt_documents where id=document_id)],p_operation_id,document_id,'receipt',null,'draft',1,null,null,null,null,jsonb_build_object('supplierAssigned',supplier_id is not null));
  return result;
end; $$;

alter function warehouse.create_issue_draft(uuid,uuid,jsonb) rename to create_issue_draft_inventory_core;
create function warehouse.create_issue_draft(p_device_id uuid,p_operation_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
#variable_conflict use_variable
declare result jsonb; document_id uuid; beneficiary warehouse.parties%rowtype; beneficiary_id uuid; line jsonb; item record; issue_line_id uuid; issue_type text; actual numeric; reference numeric; reason text; gift_mode text; gift_party uuid; gift_name text; paid numeric; context jsonb;
begin
  beneficiary_id:=nullif(p_payload->>'beneficiaryPartyId','')::uuid; if beneficiary_id is null then raise exception 'WAREHOUSE_BENEFICIARY_REQUIRED' using errcode='22023'; end if;
  result:=warehouse.create_issue_draft_inventory_core(p_device_id,p_operation_id,p_payload); document_id:=(result->>'documentId')::uuid;
  if exists(select 1 from warehouse.issue_documents where id=document_id and finance_extension_version=1) then return result; end if;
  beneficiary:=warehouse_private.require_active_party(beneficiary_id,'beneficiary'); paid:=coalesce((p_payload->>'paidNow')::numeric,0); if paid<0 then raise exception 'WAREHOUSE_PAID_NOW_INVALID' using errcode='22023'; end if;
  for line in select * from jsonb_array_elements(p_payload->'lines') loop
    select i.id,i.default_issue_price into item from warehouse.items i where i.id=(line->>'itemId')::uuid for key share;
    issue_type:=coalesce(line->>'issueType','paid'); if issue_type not in ('paid','subsidized','free','gift') then raise exception 'WAREHOUSE_ISSUE_TYPE_INVALID' using errcode='22023'; end if;
    reference:=item.default_issue_price; actual:=case when issue_type in ('free','gift') then 0 else coalesce((line->>'actualUnitPrice')::numeric,(line->>'unitPrice')::numeric,reference) end; if actual<0 then raise exception 'WAREHOUSE_ISSUE_PRICE_INVALID' using errcode='22023'; end if;
    reason:=nullif(btrim(line->>'priceOverrideReason'),''); if issue_type in ('paid','subsidized') and actual<>reference and (reason is null or char_length(reason)>500) then raise exception 'WAREHOUSE_PRICE_OVERRIDE_REASON_REQUIRED' using errcode='22023'; end if;
    gift_mode:=case when issue_type='gift' then coalesce(line->>'giftRecipientMode','unknown') else 'unknown' end; gift_party:=nullif(line->>'giftRecipientPartyId','')::uuid; gift_name:=nullif(btrim(line->>'giftRecipientName'),'');
    if gift_mode not in ('unknown','registered_person','manual_recipient') or (gift_mode='registered_person' and gift_party is null) or (gift_mode='manual_recipient' and gift_name is null) or (gift_mode='unknown' and (gift_party is not null or gift_name is not null)) then raise exception 'WAREHOUSE_GIFT_RECIPIENT_INVALID' using errcode='22023'; end if;
    if gift_mode='registered_person' then perform warehouse_private.require_active_party(gift_party,null); gift_name:=null; elsif gift_mode='manual_recipient' then gift_party:=null; else gift_party:=null; gift_name:=null; end if;
    select l.id into issue_line_id from warehouse.issue_lines l where l.document_id=document_id and l.item_id=item.id;
    update warehouse.issue_lines set unit_price=actual,issue_type=issue_type,reference_unit_price=reference,price_override_reason=reason,gift_recipient_mode=gift_mode,gift_recipient_party_id=gift_party,gift_recipient_name=gift_name where id=issue_line_id;
  end loop;
  if paid>(select coalesce(sum(quantity*unit_price),0) from warehouse.issue_lines where document_id=document_id) then raise exception 'WAREHOUSE_PAID_NOW_INVALID' using errcode='22023'; end if;
  update warehouse.issue_documents set beneficiary_party_id=beneficiary_id,paid_now=paid,beneficiary_name_snapshot=beneficiary.name,beneficiary_phone_snapshot=beneficiary.phone,finance_extension_version=1,finance_extension_operation_id=p_operation_id where id=document_id and status='draft';
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.issue',(select source_store_id from warehouse.issue_documents where id=document_id));
  perform warehouse_private.write_audit(context,'issue.financial_intent_assigned','warehouse.stock.issue',array[(select source_store_id from warehouse.issue_documents where id=document_id)],p_operation_id,document_id,'issue',null,'draft',1,null,null,null,null,jsonb_build_object('beneficiaryAssigned',true,'paidNow',paid,'priceOverrides',(select count(*) from warehouse.issue_lines l where l.document_id=(result->>'documentId')::uuid and l.price_override_reason is not null),'giftLines',(select count(*) from warehouse.issue_lines l where l.document_id=(result->>'documentId')::uuid and l.issue_type='gift')));
  return result;
end; $$;

alter function warehouse.update_document_draft(uuid,uuid,text,uuid,bigint,jsonb) rename to update_document_draft_inventory_core;
create function warehouse.update_document_draft(p_device_id uuid,p_operation_id uuid,p_document_kind text,p_document_id uuid,p_expected_revision bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare result jsonb; party warehouse.parties%rowtype; party_id uuid; line jsonb; item record; issue_type text; actual numeric; reference numeric; reason text; gift_mode text; gift_party uuid; gift_name text; paid numeric; context jsonb;
begin
  result:=warehouse.update_document_draft_inventory_core(p_device_id,p_operation_id,p_document_kind,p_document_id,p_expected_revision,p_payload);
  if p_document_kind='receipt' then
    if exists(select 1 from warehouse.receipt_documents where id=p_document_id and party_extension_operation_id=p_operation_id) then return result; end if;
    party_id:=nullif(p_payload->>'supplierPartyId','')::uuid; if party_id is not null then party:=warehouse_private.require_active_party(party_id,'supplier'); end if;
    update warehouse.receipt_documents set supplier_party_id=party_id,supplier_name_snapshot=party.name,supplier_phone_snapshot=party.phone,supplier_governorate_snapshot=party.governorate,supplier_city_snapshot=party.city,party_extension_version=1,party_extension_operation_id=p_operation_id where id=p_document_id and status='draft';
    context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.receive',(select destination_store_id from warehouse.receipt_documents where id=p_document_id)); perform warehouse_private.write_audit(context,'receipt.supplier_assigned','warehouse.stock.receive',array[(select destination_store_id from warehouse.receipt_documents where id=p_document_id)],p_operation_id,p_document_id,'receipt','draft','draft',(result->>'revision')::bigint,null,null,null,null,jsonb_build_object('supplierAssigned',party_id is not null));
  elsif p_document_kind='issue' then
    if exists(select 1 from warehouse.issue_documents where id=p_document_id and finance_extension_operation_id=p_operation_id) then return result; end if;
    party_id:=nullif(p_payload->>'beneficiaryPartyId','')::uuid; if party_id is null then raise exception 'WAREHOUSE_BENEFICIARY_REQUIRED' using errcode='22023'; end if; party:=warehouse_private.require_active_party(party_id,'beneficiary');
    paid:=coalesce((p_payload->>'paidNow')::numeric,0); if paid<0 then raise exception 'WAREHOUSE_PAID_NOW_INVALID' using errcode='22023'; end if;
    for line in select * from jsonb_array_elements(p_payload->'lines') loop
      select i.id,i.default_issue_price into item from warehouse.items i where i.id=(line->>'itemId')::uuid for key share;
      issue_type:=coalesce(line->>'issueType','paid'); if issue_type not in ('paid','subsidized','free','gift') then raise exception 'WAREHOUSE_ISSUE_TYPE_INVALID' using errcode='22023'; end if;
      reference:=item.default_issue_price; actual:=case when issue_type in ('free','gift') then 0 else coalesce((line->>'actualUnitPrice')::numeric,(line->>'unitPrice')::numeric,reference) end; if actual<0 then raise exception 'WAREHOUSE_ISSUE_PRICE_INVALID' using errcode='22023'; end if;
      reason:=nullif(btrim(line->>'priceOverrideReason'),''); if issue_type in ('paid','subsidized') and actual<>reference and (reason is null or char_length(reason)>500) then raise exception 'WAREHOUSE_PRICE_OVERRIDE_REASON_REQUIRED' using errcode='22023'; end if;
      gift_mode:=case when issue_type='gift' then coalesce(line->>'giftRecipientMode','unknown') else 'unknown' end; gift_party:=nullif(line->>'giftRecipientPartyId','')::uuid; gift_name:=nullif(btrim(line->>'giftRecipientName'),'');
      if gift_mode not in ('unknown','registered_person','manual_recipient') or (gift_mode='registered_person' and gift_party is null) or (gift_mode='manual_recipient' and gift_name is null) or (gift_mode='unknown' and (gift_party is not null or gift_name is not null)) then raise exception 'WAREHOUSE_GIFT_RECIPIENT_INVALID' using errcode='22023'; end if;
      if gift_mode='registered_person' then perform warehouse_private.require_active_party(gift_party,null); gift_name:=null; elsif gift_mode='manual_recipient' then gift_party:=null; else gift_party:=null; gift_name:=null; end if;
      update warehouse.issue_lines set unit_price=actual,issue_type=issue_type,reference_unit_price=reference,price_override_reason=reason,gift_recipient_mode=gift_mode,gift_recipient_party_id=gift_party,gift_recipient_name=gift_name where document_id=p_document_id and item_id=item.id;
    end loop;
    if paid>(select coalesce(sum(quantity*unit_price),0) from warehouse.issue_lines where document_id=p_document_id) then raise exception 'WAREHOUSE_PAID_NOW_INVALID' using errcode='22023'; end if;
    update warehouse.issue_documents set beneficiary_party_id=party_id,paid_now=paid,beneficiary_name_snapshot=party.name,beneficiary_phone_snapshot=party.phone,finance_extension_version=1,finance_extension_operation_id=p_operation_id where id=p_document_id and status='draft';
    context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.issue',(select source_store_id from warehouse.issue_documents where id=p_document_id)); perform warehouse_private.write_audit(context,'issue.financial_intent_assigned','warehouse.stock.issue',array[(select source_store_id from warehouse.issue_documents where id=p_document_id)],p_operation_id,p_document_id,'issue','draft','draft',(result->>'revision')::bigint,null,null,null,null,jsonb_build_object('beneficiaryAssigned',true,'paidNow',paid,'priceOverrides',(select count(*) from warehouse.issue_lines where document_id=p_document_id and price_override_reason is not null),'giftLines',(select count(*) from warehouse.issue_lines where document_id=p_document_id and issue_type='gift')));
  end if;
  return result;
end; $$;

-- Posting remains inventory-authoritative in the existing function. Finance is
-- appended before this wrapper transaction commits, and unique keys make replay exact.
alter function warehouse.post_issue(uuid,uuid,uuid,bigint) rename to post_issue_inventory_core;
create function warehouse.post_issue(p_device_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_revision bigint) returns jsonb
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
  select coalesce(sum(quantity*unit_price),0) into total from warehouse.issue_lines where document_id=p_document_id;
  if document.paid_now<0 or document.paid_now>total then raise exception 'WAREHOUSE_PAID_NOW_INVALID' using errcode='22023'; end if;
  if total>0 then insert into warehouse.beneficiary_financial_entries(beneficiary_party_id,issue_document_id,entry_type,amount,operation_id,actor_user_id,actor_device_id) values(document.beneficiary_party_id,p_document_id,'issue_charge',total,p_operation_id,actor,p_device_id) returning id into entry_id; end if;
  if document.paid_now>0 then insert into warehouse.beneficiary_financial_entries(beneficiary_party_id,issue_document_id,entry_type,amount,operation_id,actor_user_id,actor_device_id) values(document.beneficiary_party_id,p_document_id,'issue_payment',-document.paid_now,p_operation_id,actor,p_device_id) returning id into entry_id; end if;
  update warehouse.beneficiary_balances set balance=previous+total-document.paid_now,revision=revision+1,last_entry_id=entry_id,calculated_at=statement_timestamp() where beneficiary_party_id=document.beneficiary_party_id;
  -- Lifecycle-only snapshot write is explicitly allowed by the trigger replacement below.
  update warehouse.issue_documents set previous_balance_snapshot=previous,operation_total_snapshot=total,remaining_snapshot=total-document.paid_now,resulting_balance_snapshot=previous+total-document.paid_now where id=p_document_id;
  perform warehouse_private.write_audit(context,'issue.finance_applied','warehouse.stock.issue',array[document.source_store_id],p_operation_id,p_document_id,'issue','draft','posted',p_expected_revision+1,null,null,null,null,jsonb_build_object('paidNow',document.paid_now,'operationTotal',total,'priceOverrides',(select count(*) from warehouse.issue_lines where document_id=p_document_id and price_override_reason is not null),'giftLines',(select count(*) from warehouse.issue_lines where document_id=p_document_id and issue_type='gift')));
  return result||jsonb_build_object('previousBalance',previous,'operationTotal',total,'paidNow',document.paid_now,'remaining',total-document.paid_now,'resultingBalance',previous+total-document.paid_now);
end; $$;

-- Permit only the new immutable financial snapshots to be populated once as part
-- of the posted transaction; all other posted business fields remain immutable.
create or replace function warehouse_private.protect_posted_header() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'WAREHOUSE_DOCUMENT_DELETE_PROHIBITED' using errcode='55000'; end if;
  if old.status='reversed' then raise exception 'WAREHOUSE_REVERSED_DOCUMENT_IMMUTABLE' using errcode='55000'; end if;
  if old.status='posted' then
    if new.status='posted' and to_jsonb(old)?'operation_total_snapshot'
       and to_jsonb(old)->'previous_balance_snapshot'='null'::jsonb and to_jsonb(old)->'operation_total_snapshot'='null'::jsonb and to_jsonb(old)->'remaining_snapshot'='null'::jsonb and to_jsonb(old)->'resulting_balance_snapshot'='null'::jsonb
       and to_jsonb(new)->'previous_balance_snapshot'<>'null'::jsonb and to_jsonb(new)->'operation_total_snapshot'<>'null'::jsonb and to_jsonb(new)->'remaining_snapshot'<>'null'::jsonb and to_jsonb(new)->'resulting_balance_snapshot'<>'null'::jsonb
       and (to_jsonb(new)||jsonb_build_object('previous_balance_snapshot',to_jsonb(old)->'previous_balance_snapshot','operation_total_snapshot',to_jsonb(old)->'operation_total_snapshot','remaining_snapshot',to_jsonb(old)->'remaining_snapshot','resulting_balance_snapshot',to_jsonb(old)->'resulting_balance_snapshot')) is not distinct from to_jsonb(old) then return new; end if;
    if new.status='reversed' and new.reversed_at is not null and old.reversed_at is null and new.posted_at is not distinct from old.posted_at and new.posted_at is not null and new.revision is not distinct from old.revision
       and (to_jsonb(new)||jsonb_build_object('status',to_jsonb(old.status),'reversed_at',to_jsonb(old.reversed_at),'updated_at',to_jsonb(old.updated_at))||case when to_jsonb(old)?'document_kind' then jsonb_build_object('document_kind',to_jsonb(old)->'document_kind') else '{}'::jsonb end) is not distinct from to_jsonb(old) then return new; end if;
    raise exception 'WAREHOUSE_POSTED_DOCUMENT_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end; $$;

-- Wrap the proven stock reversal. Financial compensation is in the same transaction.
alter function warehouse.post_reversal(uuid,uuid,uuid,bigint) rename to post_reversal_inventory_core;
create function warehouse.post_reversal(p_device_id uuid,p_operation_id uuid,p_request_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
declare result jsonb; request warehouse.reversal_requests%rowtype; original_entry warehouse.beneficiary_financial_entries%rowtype; balance_row warehouse.beneficiary_balances%rowtype; context jsonb; actor uuid; compensation_id uuid;
begin
  result:=warehouse.post_reversal_inventory_core(p_device_id,p_operation_id,p_request_id,p_expected_revision);
  select * into request from warehouse.reversal_requests where id=p_request_id;
  if request.original_document_kind<>'issue' then return result; end if;
  if exists(select 1 from warehouse.beneficiary_financial_entries e join warehouse.beneficiary_financial_entries r on r.reversal_of_entry_id=e.id where e.issue_document_id=request.original_document_id) then return result; end if;
  select * into original_entry from warehouse.beneficiary_financial_entries where issue_document_id=request.original_document_id order by occurred_at,id limit 1;
  if not found then return result; end if;
  context:=warehouse_private.require_permission(p_device_id,'warehouse.stock.adjust',(select source_store_id from warehouse.issue_documents where id=request.original_document_id)); actor:=(context->>'actorUserId')::uuid;
  select * into balance_row from warehouse.beneficiary_balances where beneficiary_party_id=original_entry.beneficiary_party_id for update;
  for original_entry in select * from warehouse.beneficiary_financial_entries where issue_document_id=request.original_document_id and reversal_of_entry_id is null order by occurred_at,id loop
    insert into warehouse.beneficiary_financial_entries(beneficiary_party_id,issue_document_id,entry_type,amount,operation_id,actor_user_id,actor_device_id,reversal_of_entry_id)
    values(original_entry.beneficiary_party_id,original_entry.issue_document_id,case original_entry.entry_type when 'issue_charge' then 'reversal_charge' else 'reversal_payment' end,-original_entry.amount,p_operation_id,actor,p_device_id,original_entry.id) returning id into compensation_id;
  end loop;
  update warehouse.beneficiary_balances set balance=balance_row.balance-(select coalesce(sum(amount),0) from warehouse.beneficiary_financial_entries where issue_document_id=request.original_document_id and reversal_of_entry_id is null),revision=revision+1,last_entry_id=compensation_id,calculated_at=statement_timestamp() where beneficiary_party_id=original_entry.beneficiary_party_id;
  perform warehouse_private.write_audit(context,'issue.finance_reversed','warehouse.stock.adjust',array[(select source_store_id from warehouse.issue_documents where id=request.original_document_id)],p_operation_id,request.original_document_id,'issue','posted','reversed',p_expected_revision+1,request.reason,'warehouse_approval_policy_v1',request.original_document_id,p_request_id,jsonb_build_object('financialCompensated',true));
  return result||jsonb_build_object('financialCompensated',true);
end; $$;

-- Secure read responses expose snapshots/balances, never device identities.
alter function warehouse.get_document(uuid,uuid) rename to get_document_inventory_core;
create function warehouse.get_document(p_device_id uuid,p_document_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,warehouse as $$
declare result jsonb; header jsonb; current_balance numeric:=0;
begin
  result:=warehouse.get_document_inventory_core(p_device_id,p_document_id); header:=result->'header';
  if header->>'document_kind'='issue' then
    if header->>'status'='draft' and nullif(header->>'beneficiary_party_id','') is not null then select coalesce(balance,0) into current_balance from warehouse.beneficiary_balances where beneficiary_party_id=(header->>'beneficiary_party_id')::uuid; end if;
    result:=result||jsonb_build_object('financial',jsonb_build_object('previousBalance',case when header->>'status'='draft' then current_balance else (header->>'previous_balance_snapshot')::numeric end,'operationTotal',case when header->>'status'='draft' then (select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) from jsonb_array_elements(result->'lines') x) else (header->>'operation_total_snapshot')::numeric end,'paidNow',coalesce((header->>'paid_now')::numeric,0),'remaining',case when header->>'status'='draft' then (select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) from jsonb_array_elements(result->'lines') x)-coalesce((header->>'paid_now')::numeric,0) else (header->>'remaining_snapshot')::numeric end,'resultingBalance',case when header->>'status'='draft' then current_balance+(select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) from jsonb_array_elements(result->'lines') x)-coalesce((header->>'paid_now')::numeric,0) else (header->>'resulting_balance_snapshot')::numeric end));
  end if;
  return result;
end; $$;

create or replace function warehouse.get_beneficiary_balance(p_device_id uuid,p_party_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,warehouse,warehouse_private as $$
begin
  perform warehouse_private.require_permission(p_device_id,'warehouse.party.view'); perform warehouse_private.require_active_party(p_party_id,'beneficiary');
  return jsonb_build_object('beneficiaryPartyId',p_party_id,'balance',coalesce((select balance from warehouse.beneficiary_balances where beneficiary_party_id=p_party_id),0),'revision',coalesce((select revision from warehouse.beneficiary_balances where beneficiary_party_id=p_party_id),0));
end; $$;

alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) rename to execute_device_operation_pre_party_finance;
create function platform.execute_device_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_module text,p_operation text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,platform,platform_private,warehouse,warehouse_private as $$
declare session platform_private.device_sessions%rowtype; result jsonb;
begin
  if p_module<>'warehouse' or p_operation not in ('discover_parties','create_party','update_party','get_beneficiary_balance') then
    return platform.execute_device_operation_pre_party_finance(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args);
  end if;
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
  if p_args is null or jsonb_typeof(p_args)<>'object' or p_args?'p_device_id' or p_args?'p_actor_device_id' then raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023'; end if;
  select item.* into session from platform_private.device_sessions item
  join platform.device_key_bindings binding on binding.id=item.binding_id
  join platform.user_device_authorizations uda on uda.id=item.device_authorization_id
  join platform.devices device on device.id=item.device_id join platform.profiles profile on profile.user_id=item.user_id
  where item.id=p_session_id and item.user_id=p_user_id and item.token_hash=p_token_hash and item.purpose='PLATFORM_DEVICE_SESSION' and item.revoked_at is null and item.expires_at>statement_timestamp()
    and binding.user_id=item.user_id and binding.device_id=item.device_id and binding.device_authorization_id=item.device_authorization_id and binding.public_key_thumbprint=item.public_key_thumbprint and binding.algorithm='ECDSA_P256_SHA256' and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
    and uda.user_id=item.user_id and uda.device_id=item.device_id and uda.status='approved' and uda.revoked_at is null and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null and profile.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true);
  perform set_config('platform.phase1c_context',jsonb_build_object('purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',session.id,'user_id',session.user_id,'device_id',session.device_id,'authorization_id',session.device_authorization_id,'binding_id',session.binding_id,'token_hash',encode(p_token_hash,'hex'))::text,true);
  if p_operation='discover_parties' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_role','p_include_inactive']); result:=warehouse.discover_parties(session.device_id,p_args->>'p_role',(p_args->>'p_include_inactive')::boolean);
  elsif p_operation='create_party' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_payload']); result:=warehouse.create_party(session.device_id,(p_args->>'p_operation_id')::uuid,p_args->'p_payload');
  elsif p_operation='update_party' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_party_id','p_expected_revision','p_payload']); result:=warehouse.update_party(session.device_id,(p_args->>'p_operation_id')::uuid,(p_args->>'p_party_id')::uuid,(p_args->>'p_expected_revision')::bigint,p_args->'p_payload');
  else perform platform_private.require_exact_jsonb_keys(p_args,array['p_party_id']); result:=warehouse.get_beneficiary_balance(session.device_id,(p_args->>'p_party_id')::uuid); end if;
  return result;
end; $$;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),platform.execute_device_operation_pre_party_finance(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),platform.execute_device_operation_pre_party_finance(uuid,uuid,bytea,text,text,jsonb) to service_role;

revoke all on function warehouse.discover_parties(uuid,text,boolean),warehouse.create_party(uuid,uuid,jsonb),warehouse.update_party(uuid,uuid,uuid,bigint,jsonb),warehouse.get_beneficiary_balance(uuid,uuid),warehouse.get_document(uuid,uuid),warehouse.create_receipt_draft(uuid,uuid,jsonb),warehouse.create_issue_draft(uuid,uuid,jsonb),warehouse.update_document_draft(uuid,uuid,text,uuid,bigint,jsonb),warehouse.post_issue(uuid,uuid,uuid,bigint),warehouse.post_reversal(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function warehouse.discover_parties(uuid,text,boolean),warehouse.create_party(uuid,uuid,jsonb),warehouse.update_party(uuid,uuid,uuid,bigint,jsonb),warehouse.get_beneficiary_balance(uuid,uuid),warehouse.get_document(uuid,uuid),warehouse.create_receipt_draft(uuid,uuid,jsonb),warehouse.create_issue_draft(uuid,uuid,jsonb),warehouse.update_document_draft(uuid,uuid,text,uuid,bigint,jsonb),warehouse.post_issue(uuid,uuid,uuid,bigint),warehouse.post_reversal(uuid,uuid,uuid,bigint) to service_role;

commit;
