'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const migration=fs.readFileSync('supabase/migrations/20260904130000_warehouse_item_master_historical_contract.sql','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
const source=fs.readFileSync('js/warehouse/workspace.js','utf8');
const css=fs.readFileSync('style.css','utf8');

test('authoritative allocators are transaction locked, constraint compatible, and replay safe',()=>{
  assert.match(migration,/create sequence warehouse\.item_sku_sequence/);
  assert.match(migration,/create sequence warehouse\.unit_code_sequence/);
  assert.match(migration,/'PRD-'\|\|lpad\(nextval\('warehouse\.item_sku_sequence'\)::text,6,'0'\)/);
  assert.match(migration,/'UNT-'\|\|lpad\(nextval\('warehouse\.unit_code_sequence'\)::text,6,'0'\)/);
  assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\('warehouse-item-sku-allocation'/);
  assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\('warehouse-unit-code-allocation'/);
  assert.match(migration,/if replay is not null then return replay/);
  assert.match(migration,/'identifier',identifier/);
  assert.match(migration,/identifier:=warehouse_private\.next_item_sku\(\)/);
  assert.match(migration,/identifier:=warehouse_private\.next_unit_code\(\)/);
  assert.match(migration,/coalesce\(nullif\(upper\(btrim\(p_payload->>'sku'\)\),''\),sku\)/);
  assert.match(migration,/coalesce\(nullif\(upper\(btrim\(p_payload->>'code'\)\),''\),code\)/);
});

test('historical payload semantics stay exact and category description is bounded',()=>{
  assert.match(migration,/add column description text null/);
  assert.match(migration,/char_length\(description\) <= 2000/);
  assert.match(migration,/array\['code','name'\],array\['code','name','description','parentId','status'\]/);
  assert.match(migration,/array\['name','symbol','precision'\],array\['code','name','symbol','precision','status'\]/);
  assert.match(migration,/array\['name','categoryId','baseUnitId'\],array\['sku','name','categoryId','baseUnitId'/);
  assert.match(migration,/WAREHOUSE_MASTER_PAYLOAD_INVALID/);
  assert.match(migration,/WAREHOUSE_MASTER_PAYLOAD_REQUIRED/);
});

test('validation, authorization, conflict, and server errors have distinct safe HTTP classes',()=>{
  assert.match(edge,/sqlState\.startsWith\('22'\)\|\|sqlState\.startsWith\('23'\)/);
  assert.match(edge,/status:422,code:'WAREHOUSE_VALIDATION_FAILED'/);
  assert.match(edge,/sqlState==='42501'/);
  assert.match(edge,/status:403/);
  assert.match(edge,/sqlState==='40001'/);
  assert.match(edge,/status:409/);
  assert.match(edge,/status:500,code:'PLATFORM_DEVICE_OPERATION_FAILED'/);
  assert.doesNotMatch(edge,/error:\{code:safe\.code,message:/);
});

test('restored UI separates screens and never asks for generated identifiers',()=>{
  for(const text of ['الأصناف','التصنيفات','الوحدات','إضافة ','صنف','تصنيف','وحدة','سعر الشراء الافتراضي','سعر الصرف الافتراضي','الحد الأدنى للمخزون','الباركود','دقة الكسور'])assert.ok(source.includes(text),text);
  assert.match(source,/data-wh-master-route/);
  assert.match(source,/data-wh-master-open/);
  assert.match(source,/data-wh-category-filter/);
  assert.match(source,/data-wh-status-filter/);
  assert.match(source,/warehouse-dialog/);
  assert.doesNotMatch(source,/name="sku"|name="unitCode"/);
  assert.match(css,/\.warehouse-master-tabs/);
  assert.match(css,/\.warehouse-dialog/);
  assert.match(css,/@media\(max-width:760px\)/);
});

test('mutation cleanup runs on both branches and leaves the form retryable',()=>{
  assert.match(source,/function finishMutation\(\)/);
  assert.match(source,/removeAttribute\('aria-busy'\)/);
  assert.match(source,/button\.disabled=false/);
  assert.ok((source.match(/finishMutation\(\)/g)||[]).length>=3);
  assert.match(source,/\},function\(e\)\{finishMutation\(\);feedback/);
});
