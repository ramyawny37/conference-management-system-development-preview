'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const migration=fs.readFileSync('supabase/migrations/20260905210000_warehouse_issue_financial_unit_conversion_fix.sql','utf8');
const financialExpression=/case when entered_quantity is not null and selected_unit_price is not null then entered_quantity\*selected_unit_price else quantity\*unit_price end/;

test('Issue create enrichment preserves selected price and normalizes base unit price',()=>{
  assert.match(migration,/create or replace function warehouse\.create_issue_draft/);
  assert.match(migration,/selected_reference:=reference\*issue_line\.conversion_factor_snapshot/);
  assert.match(migration,/actual:=round\(selected_actual\/issue_line\.conversion_factor_snapshot,6\)/);
  assert.match(migration,/unit_price=actual,selected_unit_price=selected_actual/);
  assert.match(migration,/created_document_id uuid/);
  assert.doesNotMatch(migration,/\bdocument_id uuid;/);
});

test('post Issue totals transaction-unit snapshots with legacy fallback',()=>{
  const post=migration.slice(migration.indexOf('create or replace function warehouse.post_issue'),migration.indexOf('create or replace function warehouse.get_document'));
  assert.match(post,financialExpression);
  assert.match(post,/beneficiary_financial_entries[\s\S]*'issue_charge',total/);
  assert.match(post,/balance=previous\+total-document\.paid_now/);
  assert.match(post,/operation_total_snapshot=total/);
  assert.match(post,/issue\.finance_applied[\s\S]*'operationTotal',total/);
  assert.match(post,/post_issue_inventory_core/);
});

test('draft document preview uses the same unit-aware total',()=>{
  const read=migration.slice(migration.indexOf('create or replace function warehouse.get_document'));
  assert.match(read,/entered_quantity'[\s\S]*selected_unit_price'[\s\S]*quantity'[\s\S]*unit_price'/);
  assert.match(read,/draft_total-paid/);
  assert.match(read,/current_balance\+draft_total-paid/);
});

test('alternate, multiple, base, legacy, paid and previous-balance arithmetic is exact',()=>{
  const total=line=>line.enteredQuantity!=null&&line.selectedUnitPrice!=null?line.enteredQuantity*line.selectedUnitPrice:line.quantity*line.unitPrice;
  assert.deepEqual({quantity:1*10,selectedUnitPrice:120,unitPrice:120/10,total:total({enteredQuantity:1,selectedUnitPrice:120,quantity:10,unitPrice:12})},{quantity:10,selectedUnitPrice:120,unitPrice:12,total:120});
  assert.equal(total({enteredQuantity:2,selectedUnitPrice:120,quantity:20,unitPrice:12}),240);
  assert.equal(total({enteredQuantity:3,selectedUnitPrice:12,quantity:3,unitPrice:12}),36);
  assert.equal(total({enteredQuantity:null,selectedUnitPrice:null,quantity:3,unitPrice:12}),36);
  const operationTotal=120,paidNow=50,previousBalance=200;
  assert.deepEqual({remaining:operationTotal-paidNow,resultingBalance:previousBalance+operationTotal-paidNow},{remaining:70,resultingBalance:270});
});

test('migration does not rewrite historical inventory or financial data',()=>{
  assert.doesNotMatch(migration,/update warehouse\.(stock_movements|stock_balances|beneficiary_financial_entries)/i);
  assert.doesNotMatch(migration,/ISS-2026-00000087|ISS-2026-00000088|OPE-2026-00000081/);
  assert.doesNotMatch(migration,/delete from|alter table|create table/i);
});
