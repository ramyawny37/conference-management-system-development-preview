const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const migration=fs.readFileSync('supabase/migrations/20260904160000_warehouse_party_financial_ledger.sql','utf8');
const contract=fs.readFileSync('js/supabase/warehouse-device-operation-contract.js','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');

test('party foundation is role based, guarded, revisioned and RLS protected',()=>{
  assert.match(migration,/create table warehouse\.parties/);
  assert.match(migration,/create table warehouse\.party_roles/);
  assert.match(migration,/role in \('supplier','beneficiary'\)/);
  assert.match(migration,/warehouse\.party\.view/);
  assert.match(migration,/warehouse\.party\.manage/);
  assert.match(migration,/WAREHOUSE_PARTY_REVISION_CONFLICT/);
  assert.match(migration,/begin_operation\(p_operation_id,context,'create_party'/);
  assert.match(migration,/alter table warehouse\.parties enable row level security/);
  assert.match(migration,/revoke all on warehouse\.parties,warehouse\.party_roles/);
});

test('receipt supplier is authoritative and snapshot compatible',()=>{
  for(const field of ['supplier_party_id','supplier_name_snapshot','supplier_phone_snapshot','supplier_governorate_snapshot','supplier_city_snapshot'])assert.match(migration,new RegExp(field));
  assert.match(migration,/require_active_party\(supplier_id,'supplier'\)/);
  assert.doesNotMatch(migration,/drop column supplier_reference|rename column supplier_reference/i);
});

test('issue line semantics use authoritative prices and structured gifts',()=>{
  assert.match(migration,/issue_type in \('paid','subsidized','free','gift'\)/);
  assert.match(migration,/reference_unit_price/);
  assert.match(migration,/item\.default_issue_price/);
  assert.match(migration,/WAREHOUSE_PRICE_OVERRIDE_REASON_REQUIRED/);
  assert.match(migration,/gift_recipient_mode.*unknown.*registered_person.*manual_recipient/s);
  assert.match(migration,/require_active_party\(gift_party,null\)/);
  assert.match(migration,/issue_type not in \('free','gift'\) or unit_price=0/);
});

test('beneficiary ledger is immutable and separate from inventory balances',()=>{
  assert.match(migration,/create table warehouse\.beneficiary_financial_entries/);
  assert.match(migration,/create table warehouse\.beneficiary_balances/);
  assert.match(migration,/beneficiary_financial_entries_immutable/);
  assert.match(migration,/previous\+total-document\.paid_now/);
  assert.doesNotMatch(migration,/update warehouse\.stock_balances set balance/i);
});

test('post and reversal wrap inventory and finance in one SQL transaction',()=>{
  assert.match(migration,/begin;[\s\S]*alter function warehouse\.post_issue[\s\S]*issue\.finance_applied[\s\S]*alter function warehouse\.post_reversal[\s\S]*issue\.finance_reversed[\s\S]*commit;/);
  assert.match(migration,/unique\(reversal_of_entry_id\)/);
  assert.match(migration,/if document\.operation_total_snapshot is not null then return result/);
  assert.match(migration,/WAREHOUSE_PAID_NOW_INVALID/);
});

test('new calls use the unified device session dispatcher and Edge allowlist',()=>{
  for(const operation of ['discover_parties','create_party','update_party','get_beneficiary_balance']){
    assert.match(contract,new RegExp(`'${operation}'`));
    assert.match(edge,new RegExp(`'${operation}'`));
    assert.match(migration,new RegExp(operation));
  }
  assert.match(migration,/profile\.account_status='approved'/);
  assert.match(migration,/uda\.status='approved'/);
  assert.doesNotMatch(migration,/inventory\.parties\./);
});

test('safe deterministic party errors are classified',()=>{
  assert.match(edge,/endsWith\('_INACTIVE'\)/);
  assert.match(edge,/endsWith\('_MISMATCH'\)/);
  assert.match(edge,/endsWith\('_REVISION_CONFLICT'\)/);
});
