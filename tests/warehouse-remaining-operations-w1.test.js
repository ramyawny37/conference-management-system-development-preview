'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('js/warehouse/remaining-operations.js','utf8');
const workspace=fs.readFileSync('js/warehouse/workspace.js','utf8');
const context=fs.readFileSync('js/warehouse/current-store-context.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

test('Opening Balance is multi-line inbound-only, requires cost, skips approval, and posts securely',()=>{
  for(const text of ['الأرصدة الافتتاحية','الكمية الافتتاحية','تكلفة الوحدة الافتتاحية','قيمة السطر','يمكن تسجيل الرصيد الافتتاحي للصنف فقط قبل وجود أي حركة مخزنية سابقة له داخل هذا المخزن.'])assert.ok(source.includes(text),text);
  assert.match(source,/p_adjustment_kind:mode/);
  assert.match(source,/mode==='opening_balance'\?'in'/);
  assert.match(source,/if\(direction==='in'\)item\.inboundUnitCost/);
  assert.match(source,/data-wh-add-line/);
  assert.match(source,/opening\?'<button[^>]*data-wh-operation-action="post_adjustment"/);
  assert.match(workspace,/WAREHOUSE_OPENING_BALANCE_EXISTING_HISTORY/);
});

test('Transfers provide both stores, enforce difference, support lines, drafts, edits, post and reversal',()=>{
  for(const text of ['التحويلات بين المخازن','مخزن المصدر','مخزن الوجهة','تاريخ المستند','إضافة صنف'])assert.ok(source.includes(text),text);
  assert.match(source,/sourceStoreId===data\.destinationStoreId/);
  assert.match(source,/create_transfer_draft/);
  assert.match(source,/update_document_draft/);
  assert.match(source,/post_transfer/);
  assert.match(source,/create_reversal_request/);
  assert.match(source,/list_balances/);
  assert.doesNotMatch(source,/\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(/);
});

test('Adjustment modes enforce direction and preserve explicit approval lifecycle',()=>{
  for(const pair of [['adjustment','تسوية مخزنية'],['damage_loss','تلف / فاقد'],['correction','تصحيح']]){assert.ok(source.includes(pair[0]));assert.ok(source.includes(pair[1]));}
  assert.match(source,/fixedOut=mode==='damage_loss'/);
  assert.match(source,/submit_adjustment_for_approval/);
  assert.match(source,/decide_adjustment_approval/);
  assert.match(source,/post_adjustment/);
  for(const decision of ['approved','rejected'])assert.ok(source.includes(decision));
});

test('Approval Queue is authoritative, has both decisions, and never duplicates reversals',()=>{
  assert.match(source,/invoke\('list_approval_queue'/);
  assert.doesNotMatch(source,/invoke\('list_reversal_requests'/);
  assert.match(source,/decide_adjustment_approval/);
  assert.match(source,/decide_reversal_approval/);
  assert.match(workspace,/WAREHOUSE_CREATOR_SELF_APPROVAL_FORBIDDEN/);
  assert.match(workspace,/WAREHOUSE_APPROVAL_STATE_INVALID/);
});

test('History integrates current store, explicit fallback, filters, pagination, fields, and separate audit',()=>{
  assert.match(source,/current\(deps\)/);
  assert.match(source,/اختر مخزنًا لعرض الحركة الفعلية/);
  for(const key of ['p_document_id','p_item_id','p_document_kind','p_from','p_to','p_before_sequence'])assert.ok(source.includes(key),key);
  for(const key of ['sequence','movement_type','quantity','unit_cost','inventory_value','document_id','reversal_of_movement_id'])assert.ok(source.includes(key),key);
  assert.match(source,/response\.movements/);
  assert.match(source,/response\.audit/);
  assert.match(source,/warehouse-audit/);
});

test('Balances are read-only server values enriched only with Item Master display metadata',()=>{
  assert.match(source,/invoke\('list_balances'/);
  assert.match(source,/invoke\('list_item_master'/);
  for(const key of ['quantity_on_hand','weighted_average_unit_cost','inventory_value','calculated_at','last_movement_sequence'])assert.ok(source.includes(key),key);
  assert.match(source,/data-wh-balance-search/);
  assert.match(source,/data-wh-balance-category/);
  assert.doesNotMatch(source,/stock_balances|update_balance|quantity_on_hand\s*=/);
});

test('Reports use real secure sources, accurate authorization wording, and disable unsupported finance',()=>{
  for(const key of ['list_balances','list_history','list_documents + get_document','inventory_value · weighted_average_unit_cost · quantity_on_hand','authorize_report_export'])assert.ok(source.includes(key),key);
  assert.match(source,/تفويض التصدير/);
  assert.match(source,/تم التحقق من صلاحية التصدير/);
  assert.doesNotMatch(source,/تم تصدير الملف/);
  assert.match(source,/تقرير الحركة المالية للمستفيدين[\s\S]*قريبًا/);
});

test('Current Store strip stays synchronized without first-store fallback or cross-scope weakening',()=>{
  assert.match(workspace,/warehouse-store-context-strip/);
  assert.match(workspace,/querySelectorAll\('\[data-wh-current-store\]'\)/);
  assert.match(workspace,/peer\.value=selector\.value/);
  assert.doesNotMatch(workspace+source,/state\.stores\[0\]/);
  assert.match(context,/KEY_PREFIX\+user\+'\:'\+device/);
  assert.match(index,/remaining-operations\.js\?rev=warehouse-remaining-operations-v1/);
  assert.match(worker,/development-3-4-0-warehouse-remaining-operations-v1/);
  assert.match(worker,/remaining-operations\.js\?rev=warehouse-remaining-operations-v1/);
});

test('security boundaries remain transport-only with no delete or local business persistence',()=>{
  assert.match(workspace,/WarehouseTransport\.invoke/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|delete_document|delete_adjustment|delete_transfer/);
  assert.doesNotMatch(source+workspace,/SupabaseClientLayer|fetch\s*\(|document\.cookie/);
});
