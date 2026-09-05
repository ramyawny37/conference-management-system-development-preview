'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const source=fs.readFileSync('js/warehouse/workspace.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20260904143000_warehouse_category_code_allocation.sql','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

function functionBody(name,next){
  const start=source.indexOf('function '+name+'(');
  const end=source.indexOf('function '+next+'(',start+1);
  assert.notEqual(start,-1,'missing '+name);
  assert.notEqual(end,-1,'missing boundary '+next);
  return source.slice(start,end);
}

const esc=Function('return ('+functionBody('esc','arr')+')')();
const val=Function('return ('+functionBody('val','section')+')')();
const field=Function('esc','return ('+functionBody('field','statusBadge')+')')(esc);
const options=()=>'';
const state={master:{categories:[],units:[],items:[]}};
const masterDialog=Function('field','esc','val','options','state','return ('+functionBody('masterDialog','itemRows')+')')(field,esc,val,options,state);

test('real Category create and edit renderer omits manual code while payload permits server allocation',()=>{
  const createMarkup=masterDialog('category',{});
  const editMarkup=masterDialog('category',{id:'category-id',code:'CAT-000001',name:'Existing',status:'active',revision:2});
  for(const markup of [createMarkup,editMarkup]){
    assert.match(markup,/data-kind="category"/);
    assert.doesNotMatch(markup,/name="code"/);
    assert.doesNotMatch(markup,/الكود\s*(?:<em>)?\*/);
    assert.match(markup,/name="name"[^>]*required/);
    assert.match(markup,/name="description"/);
    assert.match(markup,/name="status"/);
  }
  assert.doesNotMatch(source,/payload=\{code:d\.code,name:d\.name/);
  assert.match(source,/payload=\{name:d\.name,description:d\.description/);
  assert.match(migration,/array\['name'\],array\['code','name','description','parentId','status'\]/);
});

test('runtime and precache use the reconciled Warehouse workspace revision',()=>{
  const asset='js/warehouse/workspace.js?rev=warehouse-remaining-operations-v1';
  assert.ok(index.includes('<script src="'+asset+'"></script>'));
  assert.ok(worker.includes("'./"+asset+"'"));
  assert.doesNotMatch(index,/workspace\.js\?rev=warehouse-original-items-secure-restoration-v1/);
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
  const markup=masterDialog('unit',{});
  assert.match(markup,/اختصار الوحدة/);
  assert.match(markup,/name="symbol"[^>]*required/);
  assert.match(markup,/مثال: كجم، لتر، قطعة/);
  assert.match(source,/payload=\{name:d\.name,symbol:d\.symbol/);
  assert.match(migration,/array\['name','symbol','precision'\]/);
});

test('real Item renderer remains unchanged and separate from Category code allocation',()=>{
  const markup=masterDialog('item',{});
  assert.match(markup,/name="categoryId"[^>]*required/);
  assert.match(markup,/name="unitId"[^>]*required/);
  assert.match(markup,/name="barcode"/);
  assert.doesNotMatch(markup,/name="code"/);
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
