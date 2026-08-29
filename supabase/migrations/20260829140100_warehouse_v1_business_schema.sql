begin;

do $$
begin
  if not exists (
    select 1 from public.platform_modules where module_key='warehouse' and status='active'
  ) or (select count(*) from public.module_permission_catalog
         where module_key='warehouse' and status='active') <> 15 then
    raise exception 'WAREHOUSE_CATALOG_REQUIRED' using errcode='55000';
  end if;
end;
$$;

create schema warehouse;
create schema warehouse_private;
revoke all on schema warehouse from public, anon, authenticated;
revoke all on schema warehouse_private from public, anon, authenticated;

create sequence warehouse.stock_movement_sequence;
create sequence warehouse.store_code_sequence;
create sequence warehouse.document_number_sequence;

create table warehouse.stores (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('STR-'||lpad(nextval('warehouse.store_code_sequence')::text,6,'0')),
  name text not null check(name=btrim(name) and char_length(name) between 2 and 160),
  store_type text not null check(store_type in ('main','branch','transit','returns')),
  address text not null check(address=btrim(address) and char_length(address) between 5 and 500),
  status text not null default 'active' check(status in ('active','inactive')),
  notes text check(notes is null or char_length(notes)<=2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  revision bigint not null default 1 check(revision>0),
  check(code ~ '^STR-[0-9]{6,}$'), check(updated_at>=created_at)
);

create table warehouse.categories (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  name text not null check(name=btrim(name) and char_length(name) between 2 and 120),
  parent_id uuid references warehouse.categories(id) on delete restrict,
  status text not null default 'active' check(status in ('active','inactive')),
  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  revision bigint not null default 1 check(revision>0),
  check(code=upper(btrim(code)) and code ~ '^[A-Z0-9_-]{2,64}$'), check(parent_id is null or parent_id<>id)
);

create table warehouse.units (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  name text not null check(name=btrim(name) and char_length(name) between 2 and 120),
  symbol text not null check(symbol=btrim(symbol) and char_length(symbol) between 1 and 16),
  precision smallint not null default 0 check(precision between 0 and 6),
  status text not null default 'active' check(status in ('active','inactive')),
  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  revision bigint not null default 1 check(revision>0),
  check(code=upper(btrim(code)) and code ~ '^[A-Z0-9_-]{2,64}$')
);

create table warehouse.items (
  id uuid primary key default gen_random_uuid(), sku text not null unique,
  name text not null check(name=btrim(name) and char_length(name) between 2 and 160),
  category_id uuid not null references warehouse.categories(id) on delete restrict,
  base_unit_id uuid not null references warehouse.units(id) on delete restrict,
  barcode text unique check(barcode is null or (barcode=btrim(barcode) and barcode ~ '^[0-9A-Za-z-]{1,64}$')),
  default_purchase_price numeric(20,6) not null default 0 check(default_purchase_price>=0),
  default_issue_price numeric(20,6) not null default 0 check(default_issue_price>=0),
  minimum_stock numeric(20,6) not null default 0 check(minimum_stock>=0),
  status text not null default 'active' check(status in ('active','inactive')),
  notes text check(notes is null or char_length(notes)<=2000),
  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  revision bigint not null default 1 check(revision>0),
  check(sku=upper(btrim(sku)) and sku ~ '^[A-Z0-9_-]{2,64}$')
);

create table warehouse.document_registry (
  id uuid primary key, document_kind text not null check(document_kind in ('receipt','issue','transfer','opening_balance','adjustment','damage_loss','correction','reversal')),
  document_number text not null unique,
  original_document_id uuid references warehouse.document_registry(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  check(original_document_id is null or original_document_id<>id),
  unique(id,document_number,document_kind)
);

create table warehouse.receipt_documents (
  id uuid primary key default gen_random_uuid(), document_number text not null unique,
  document_kind text generated always as ('receipt') stored,
  destination_store_id uuid not null references warehouse.stores(id) on delete restrict,
  document_date date not null, supplier_reference text, notes text,
  status text not null default 'draft' check(status in ('draft','posted','reversed')),
  creator_user_id uuid not null references auth.users(id), creator_device_id uuid not null,
  posted_at timestamptz, reversed_at timestamptz, revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  check((status='draft' and posted_at is null and reversed_at is null) or (status='posted' and posted_at is not null and reversed_at is null) or (status='reversed' and posted_at is not null and reversed_at is not null)),
  foreign key(id,document_number,document_kind) references warehouse.document_registry(id,document_number,document_kind) on delete restrict
);
create table warehouse.receipt_lines (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references warehouse.receipt_documents(id) on delete cascade,
  item_id uuid not null references warehouse.items(id) on delete restrict, quantity numeric(20,6) not null check(quantity>0),
  unit_cost numeric(20,6) not null check(unit_cost>=0), unit_price numeric(20,6) not null default 0 check(unit_price>=0), notes text,
  unique(document_id,item_id)
);

create table warehouse.issue_documents (
  id uuid primary key default gen_random_uuid(), document_number text not null unique,
  document_kind text generated always as ('issue') stored,
  source_store_id uuid not null references warehouse.stores(id) on delete restrict,
  document_date date not null, purpose text not null check(char_length(btrim(purpose)) between 2 and 500), notes text,
  status text not null default 'draft' check(status in ('draft','posted','reversed')),
  creator_user_id uuid not null references auth.users(id), creator_device_id uuid not null,
  posted_at timestamptz, reversed_at timestamptz, revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  check((status='draft' and posted_at is null and reversed_at is null) or (status='posted' and posted_at is not null and reversed_at is null) or (status='reversed' and posted_at is not null and reversed_at is not null)),
  foreign key(id,document_number,document_kind) references warehouse.document_registry(id,document_number,document_kind) on delete restrict
);
create table warehouse.issue_lines (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references warehouse.issue_documents(id) on delete cascade,
  item_id uuid not null references warehouse.items(id) on delete restrict, quantity numeric(20,6) not null check(quantity>0),
  unit_price numeric(20,6) not null default 0 check(unit_price>=0), notes text, unique(document_id,item_id)
);

create table warehouse.transfer_documents (
  id uuid primary key default gen_random_uuid(), document_number text not null unique,
  document_kind text generated always as ('transfer') stored,
  source_store_id uuid not null references warehouse.stores(id) on delete restrict,
  destination_store_id uuid not null references warehouse.stores(id) on delete restrict,
  document_date date not null, notes text, status text not null default 'draft' check(status in ('draft','posted','reversed')),
  creator_user_id uuid not null references auth.users(id), creator_device_id uuid not null,
  posted_at timestamptz, reversed_at timestamptz, revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  check(source_store_id<>destination_store_id),
  check((status='draft' and posted_at is null and reversed_at is null) or (status='posted' and posted_at is not null and reversed_at is null) or (status='reversed' and posted_at is not null and reversed_at is not null)),
  foreign key(id,document_number,document_kind) references warehouse.document_registry(id,document_number,document_kind) on delete restrict
);
create table warehouse.transfer_lines (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references warehouse.transfer_documents(id) on delete cascade,
  item_id uuid not null references warehouse.items(id) on delete restrict, quantity numeric(20,6) not null check(quantity>0), notes text,
  unique(document_id,item_id)
);

create table warehouse.adjustment_documents (
  id uuid primary key default gen_random_uuid(), document_number text not null unique,
  adjustment_kind text not null check(adjustment_kind in ('opening_balance','adjustment','damage_loss','correction')),
  store_id uuid not null references warehouse.stores(id) on delete restrict,
  document_date date not null, reason text not null check(char_length(btrim(reason)) between 3 and 500), notes text,
  status text not null default 'draft' check(status in ('draft','posted','reversed')),
  approval_status text not null check(approval_status in ('not_required','not_submitted','pending','approved','rejected')),
  submitted_revision bigint check(submitted_revision is null or submitted_revision>0),
  submitted_by uuid references auth.users(id) on delete restrict,
  submitted_device_id uuid,
  submitted_at timestamptz,
  approval_policy_version text not null default 'warehouse_approval_policy_v1' check(approval_policy_version='warehouse_approval_policy_v1'),
  creator_user_id uuid not null references auth.users(id), creator_device_id uuid not null,
  posted_at timestamptz, reversed_at timestamptz, revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  check((adjustment_kind='opening_balance' and approval_status='not_required') or (adjustment_kind<>'opening_balance' and approval_status in ('not_submitted','pending','approved','rejected'))),
  check((approval_status in ('pending','approved','rejected') and submitted_revision is not null and submitted_by is not null and submitted_device_id is not null and submitted_at is not null) or (approval_status in ('not_required','not_submitted') and submitted_revision is null and submitted_by is null and submitted_device_id is null and submitted_at is null)),
  check((status='draft' and posted_at is null and reversed_at is null) or (status='posted' and posted_at is not null and reversed_at is null) or (status='reversed' and posted_at is not null and reversed_at is not null)),
  foreign key(id,document_number,adjustment_kind) references warehouse.document_registry(id,document_number,document_kind) on delete restrict
);
create table warehouse.adjustment_lines (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references warehouse.adjustment_documents(id) on delete cascade,
  item_id uuid not null references warehouse.items(id) on delete restrict, direction text not null check(direction in ('in','out')),
  quantity numeric(20,6) not null check(quantity>0), inbound_unit_cost numeric(20,6), notes text,
  unique(document_id,item_id,direction),
  check((direction='in' and inbound_unit_cost is not null and inbound_unit_cost>=0) or (direction='out' and inbound_unit_cost is null))
);

create table warehouse.approval_records (
  id uuid primary key default gen_random_uuid(), document_kind text not null check(document_kind in ('adjustment','reversal')),
  document_id uuid not null, document_revision bigint not null check(document_revision>0),
  decision text not null check(decision in ('approved','rejected')),
  policy_version text not null check(policy_version='warehouse_approval_policy_v1'),
  initiator_user_id uuid not null references auth.users(id), approver_user_id uuid not null references auth.users(id),
  approver_device_id uuid not null, reason text not null check(char_length(btrim(reason)) between 3 and 500),
  decided_at timestamptz not null default statement_timestamp(),
  check(initiator_user_id<>approver_user_id), unique(document_kind,document_id,document_revision)
);

create table warehouse.reversal_requests (
  id uuid primary key default gen_random_uuid(), original_document_id uuid not null references warehouse.document_registry(id) on delete restrict unique,
  original_document_kind text not null check(original_document_kind in ('receipt','issue','transfer','opening_balance','adjustment','damage_loss','correction')),
  reason text not null check(char_length(btrim(reason)) between 3 and 500),
  status text not null default 'draft' check(status in ('draft','pending','approved','rejected','posted')),
  policy_version text not null default 'warehouse_approval_policy_v1' check(policy_version='warehouse_approval_policy_v1'),
  initiator_user_id uuid not null references auth.users(id), initiator_device_id uuid not null,
  revision bigint not null default 1 check(revision>0),
  submitted_revision bigint check(submitted_revision is null or submitted_revision>0),
  submitted_by uuid references auth.users(id) on delete restrict, submitted_device_id uuid, submitted_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  check((status='posted' and posted_at is not null) or (status<>'posted' and posted_at is null)),
  check((status in ('pending','approved','rejected','posted') and submitted_revision is not null and submitted_by is not null and submitted_device_id is not null and submitted_at is not null) or (status='draft' and submitted_revision is null and submitted_by is null and submitted_device_id is null and submitted_at is null))
);

create table warehouse.business_operations (
  operation_id uuid primary key, actor_user_id uuid not null references auth.users(id), actor_device_id uuid not null,
  operation_kind text not null, target_id uuid, affected_store_ids uuid[] not null default '{}',
  intent_hash text not null check(intent_hash ~ '^[0-9a-f]{64}$'), status text not null check(status in ('processing','applied','rejected')),
  result jsonb, error_code text, created_at timestamptz not null default statement_timestamp(), completed_at timestamptz,
  check((status='processing' and completed_at is null) or (status in ('applied','rejected') and completed_at is not null)),
  check((status='applied' and result is not null and error_code is null) or status<>'applied')
);

create table warehouse.stock_movements (
  id uuid primary key default gen_random_uuid(), sequence bigint not null unique default nextval('warehouse.stock_movement_sequence'),
  store_id uuid not null references warehouse.stores(id) on delete restrict, item_id uuid not null references warehouse.items(id) on delete restrict,
  direction text not null check(direction in ('in','out')), movement_type text not null check(movement_type in ('opening','receipt','issue','transfer_out','transfer_in','adjustment_in','adjustment_out','damage','loss','reversal')),
  quantity numeric(20,6) not null check(quantity>0), unit_cost numeric(20,6) not null check(unit_cost>=0),
  inventory_value numeric(26,6) not null check(inventory_value>=0), costing_method text not null default 'weighted_average' check(costing_method='weighted_average'),
  costing_version integer not null default 1 check(costing_version=1), document_id uuid not null, document_line_id uuid not null,
  transfer_group_id uuid, reversal_of_movement_id uuid references warehouse.stock_movements(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id), actor_device_id uuid not null,
  operation_id uuid not null references warehouse.business_operations(operation_id), occurred_at timestamptz not null default statement_timestamp(),
  unique(document_line_id,direction,movement_type), check(inventory_value=round(quantity*unit_cost,6))
);
create index stock_movements_store_item_sequence_idx on warehouse.stock_movements(store_id,item_id,sequence);
create index stock_movements_document_idx on warehouse.stock_movements(document_id,sequence);

create table warehouse.stock_balances (
  store_id uuid not null references warehouse.stores(id) on delete restrict,
  item_id uuid not null references warehouse.items(id) on delete restrict,
  quantity_on_hand numeric(20,6) not null default 0 check(quantity_on_hand>=0),
  inventory_value numeric(26,6) not null default 0 check(inventory_value>=0),
  weighted_average_unit_cost numeric(20,6) not null default 0 check(weighted_average_unit_cost>=0),
  last_movement_sequence bigint not null default 0 check(last_movement_sequence>=0), revision bigint not null default 1 check(revision>0),
  calculated_at timestamptz not null default statement_timestamp(), primary key(store_id,item_id),
  check((quantity_on_hand=0 and inventory_value=0 and weighted_average_unit_cost=0) or quantity_on_hand>0)
);

create table warehouse.business_audit (
  id uuid primary key default gen_random_uuid(), event_type text not null, actor_user_id uuid not null references auth.users(id),
  actor_device_id uuid not null, effective_permission text not null, authority_source text not null,
  grant_id uuid, affected_store_ids uuid[] not null default '{}', operation_id uuid,
  document_id uuid, document_kind text, previous_state text, new_state text, document_revision bigint,
  reason text, policy_version text, original_document_id uuid, reversal_request_id uuid,
  authorization_contexts jsonb not null,
  metadata jsonb not null default '{}', occurred_at timestamptz not null default statement_timestamp(),
  check(jsonb_typeof(metadata)='object'),
  check(jsonb_typeof(authorization_contexts)='array' and jsonb_array_length(authorization_contexts)>0)
);

alter table warehouse.stores enable row level security;
alter table warehouse.categories enable row level security;
alter table warehouse.units enable row level security;
alter table warehouse.items enable row level security;
alter table warehouse.document_registry enable row level security;
alter table warehouse.receipt_documents enable row level security;
alter table warehouse.receipt_lines enable row level security;
alter table warehouse.issue_documents enable row level security;
alter table warehouse.issue_lines enable row level security;
alter table warehouse.transfer_documents enable row level security;
alter table warehouse.transfer_lines enable row level security;
alter table warehouse.adjustment_documents enable row level security;
alter table warehouse.adjustment_lines enable row level security;
alter table warehouse.approval_records enable row level security;
alter table warehouse.reversal_requests enable row level security;
alter table warehouse.business_operations enable row level security;
alter table warehouse.stock_movements enable row level security;
alter table warehouse.stock_balances enable row level security;
alter table warehouse.business_audit enable row level security;

revoke all on all tables in schema warehouse from public, anon, authenticated;
revoke all on all sequences in schema warehouse from public, anon, authenticated;

commit;
