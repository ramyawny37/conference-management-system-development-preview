'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const source=fs.readFileSync('js/warehouse/workspace.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20260904143000_warehouse_category_code_allocation.sql','utf8');

test('normal Category UI omits manual code while guarded payload permits server allocation',()=>{
  assert.doesNotMatch(source,/field\('الكود','<input name="code"/);
  assert.doesNotMatch(source,/payload=\{code:d\.code,name:d\.name/);
  assert.match(source,/payload=\{name:d\.name,description:d\.description/);
  assert.match(migration,/array\['name'\],array\['code','name','description','parentId','status'\]/);
});

test('Category allocator is unique, transaction-safe, collision-safe and authoritative',()=>{
  assert.match(migration,/create sequence warehouse\.category_code_sequence/);
  assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\('warehouse-category-code-allocation'/);
  assert.match(migration,/'CAT-'\|\|lpad\(nextval\('warehouse\.category_code_sequence'\)::text,6,'0'\)/);
  assert.match(migration,/not exists\(select 1 from warehouse\.categories where code=candidate\)/);
  assert.match(migration,/identifier:=warehouse_private\.next_category_code\(\)/);
  assert.match(migration,/returning id,revision,code into row_id,next_revision,identifier/);
});

test('Category code remains stable on edit and idempotent replay',()=>{
  assert.match(migration,/if replay is not null then return replay/);
  assert.match(migration,/update warehouse\.categories set name=/);
  assert.doesNotMatch(migration,/update warehouse\.categories set code=/);
  assert.match(migration,/'identifier',identifier/);
  assert.match(migration,/complete_operation\(p_operation_id,result\)/);
});

test('controlled explicit Category codes remain supported only on create',()=>{
  assert.match(migration,/identifier:=nullif\(upper\(btrim\(p_payload->>'code'\)\),''\)/);
  assert.match(migration,/insert into warehouse\.categories\(code,name,description/);
  assert.doesNotMatch(migration,/update warehouse\.categories set code=/);
});

test('Unit keeps symbol contract and shows the clarified Arabic label and hint',()=>{
  assert.match(source,/field\('اختصار الوحدة','<input name="symbol"/);
  assert.match(source,/مثال: كجم، لتر، قطعة/);
  assert.match(source,/payload=\{name:d\.name,symbol:d\.symbol/);
  assert.match(migration,/array\['name','symbol','precision'\]/);
});

test('existing Item SKU and Unit code allocators and guarded protections are unchanged',()=>{
  assert.match(migration,/identifier:=warehouse_private\.next_item_sku\(\)/);
  assert.match(migration,/identifier:=warehouse_private\.next_unit_code\(\)/);
  assert.match(migration,/warehouse_private\.require_permission/);
  assert.match(migration,/warehouse_private\.begin_operation/);
  assert.match(migration,/p_expected_revision/);
  assert.match(migration,/warehouse_private\.write_audit/);
  assert.doesNotMatch(source,/delete_item|delete_category|delete_unit/);
});
