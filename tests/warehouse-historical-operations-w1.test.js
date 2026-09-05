'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const source=fs.readFileSync('js/warehouse/historical-operations.js','utf8');
const workspace=fs.readFileSync('js/warehouse/workspace.js','utf8');
const css=fs.readFileSync('style.css','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

test('historical Stores uses a create/edit dialog, searchable cards, and no persisted delete',()=>{
  for(const text of ['المخازن','تعريف مواقع التخزين وأنواعها فقط، دون أرصدة أو حركات.','إضافة مخزن','ابحث بالاسم أو الكود أو العنوان','الاسم','النوع','الحالة','العنوان','ملاحظات','رئيسي','فرعي','عبور','مرتجعات','نشط','غير نشط'])assert.ok(source.includes(text),text);
  assert.match(source,/discover_stores/);
  assert.match(source,/data-wh-store-open/);
  assert.match(source,/data-wh-historical-store/);
  assert.match(source,/data-wh-store-search/);
  assert.match(source,/create_store/);
  assert.match(source,/update_store/);
  assert.doesNotMatch(source,/delete_store|data-wh-store-toggle|استيراد|تصدير/);
  assert.doesNotMatch(source,/data-wh-store class="warehouse-form-grid"/);
});

test('historical Receipt restores Party supplier, one line, filters, totals, and secure lifecycle',()=>{
  for(const text of ['الاستلام والمشتريات','إثبات استلام الأصناف وتكلفتها دون حسابات موردين.','إنشاء مستند استلام','رقم المستند','التاريخ','البنود','القيمة','الحالة','إجراء','كل الحالات','مسودة','مرحّل','معكوس','PUR-2026-000001','المورد','المخزن','بند المستند','سعر الشراء','سعر الوحدة','إجمالي الاستلام'])assert.ok(source.includes(text),text);
  assert.match(source,/discover_parties',\{p_role:'supplier'/);
  assert.match(source,/supplierPartyId:data\.supplierId/);
  assert.match(source,/lines:\[\{itemId:data\.itemId,unitId:data\.unitId,quantity:Number\(data\.quantity\),unitCost:Number\(data\.unitCost\),unitPrice:Number\(data\.unitPrice\)\}\]/);
  assert.match(source,/رقم المستند سيُولد تلقائيًا عند الحفظ/);
  for(const operation of ['list_documents','get_document','create_receipt_draft','update_document_draft','post_receipt','create_reversal_request'])assert.ok(source.includes(operation),operation);
  assert.match(source,/data-wh-receipt-search/);
  assert.match(source,/data-wh-receipt-status/);
  assert.doesNotMatch(source,/supplier accounting|data-wh-receipt-add-line/i);
});

test('historical Issue restores current-store guarded multi-line Party and finance UX',()=>{
  for(const text of ['تسجيل صرف','اختر المستفيد وأضف الأصناف ثم احفظ العملية.','المستفيد / الشخص','الرصيد السابق','إضافة صنف','نوع الصرف','السعر الفعلي','الوحدة','المتاح','السعر المرجعي','سبب تغيير السعر','غير محدد','اختيار شخص مسجل','كتابة اسم يدويًا','اسم متلقي الهدية','المبلغ المدفوع الآن','المتبقي','الرصيد الناتج','حفظ الصرف','تم تسجيل الصرف بنجاح.','صرف جديد لنفس الشخص','صرف جديد','إنهاء'])assert.ok(source.includes(text),text);
  for(const pair of [['paid','مدفوع'],['subsidized','مدعم'],['free','مجاني'],['gift','هدية'],['registered_person','اختيار شخص مسجل'],['manual_recipient','كتابة اسم يدويًا']]){assert.ok(source.includes(pair[0]));assert.ok(source.includes(pair[1]));}
  assert.match(source,/getCurrentWarehouseStoreId\(\)/);
  assert.match(source,/يرجى اختيار المخزن الحالي أولًا/);
  assert.doesNotMatch(source,/data-wh-issue-store|first store fallback/i);
  assert.match(source,/discover_parties',\{p_role:'beneficiary'/);
  assert.match(source,/get_beneficiary_balance/);
  assert.match(source,/function loadBalances/);
  assert.match(source,/page\.length===100\?loadBalances/);
  assert.match(source,/issueState\.lines\.push\(newIssueLine\(\)\)/);
  assert.match(source,/issueState\.lines=issueState\.lines\.filter/);
  assert.match(source,/actualUnitPrice:issueActual/);
  assert.match(source,/priceOverrideReason/);
  assert.match(source,/paidNow:Number/);
});

test('single Issue save maps idempotently to create then post and renders server-backed results',()=>{
  const create=source.indexOf("invoke('create_issue_draft'");
  const post=source.indexOf("invoke('post_issue'",create);
  assert.ok(create>0&&post>create);
  assert.match(source,/createOperationId:global\.crypto\.randomUUID\(\)/);
  assert.match(source,/postOperationId:global\.crypto\.randomUUID\(\)/);
  assert.match(source,/p_operation_id:pending\.createOperationId/);
  assert.match(source,/p_operation_id:pending\.postOperationId/);
  assert.match(source,/p_expected_revision:pending\.revision/);
  assert.match(workspace,/if\(entry\.operationIdRequired&&!copy\.p_operation_id\)/);
  assert.match(workspace,/\['issues','history','balances','reports'\]\.indexOf\(state\.section\)>=0/);
  for(const key of ['previousBalance','operationTotal','paidNow','remaining','resultingBalance'])assert.match(source,new RegExp('posted\\.'+key));
  assert.doesNotMatch(source+workspace,/\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(/);
});

test('responsive structure and coherent active runtime cache revision are explicit',()=>{
  assert.match(css,/\.warehouse-store-grid\{grid-template-columns:repeat\(3/);
  assert.match(css,/@media\(max-width:1100px\)[^{]*\{[^}]*\.warehouse-form-grid[\s\S]*?\.warehouse-store-grid\{grid-template-columns:repeat\(2/);
  assert.match(css,/@media\(max-width:680px\)[\s\S]*?\.warehouse-store-grid[^{]*\{grid-template-columns:1fr/);
  assert.match(css,/\.warehouse-receipt-toolbar\+\.warehouse-table-card table\{min-width:760px\}/);
  assert.match(css,/\.warehouse-receipt-dialog-fields\{grid-template-columns:repeat\(2/);
  assert.match(css,/\.warehouse-issue-layout\{display:grid;grid-template-columns:minmax\(0,1fr\) 320px/);
  assert.match(css,/@media\(max-width:1200px\)[\s\S]*?\.warehouse-issue-layout\{grid-template-columns:1fr\}[\s\S]*?\.warehouse-issue-line-grid\{grid-template-columns:repeat\(2/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.warehouse-issue-line-grid\{grid-template-columns:1fr\}/);
  const historicalRevision='opening-balance-ux-correction-v1';
  const activeRevision='opening-balance-ux-correction-v1';
  assert.ok(index.includes('js/warehouse/historical-operations.js?rev='+historicalRevision));
  assert.ok(index.includes('js/warehouse/workspace.js?rev='+activeRevision));
  assert.ok(index.includes('style.css?rev=warehouse-remaining-operations-v1'));
  assert.ok(worker.includes("development-3-4-0-"+activeRevision));
  assert.ok(worker.includes("./js/warehouse/historical-operations.js?rev="+historicalRevision));
  assert.ok(worker.includes("./js/warehouse/workspace.js?rev="+activeRevision));
  assert.ok(worker.includes("./style.css?rev=warehouse-remaining-operations-v1"));
  assert.ok(index.indexOf('current-store-context.js')<index.indexOf('historical-operations.js')&&index.indexOf('historical-operations.js')<index.indexOf('workspace.js'));
});

test('safe Arabic error mapping covers the required backend failures without raw fallback',()=>{
  for(const code of ['WAREHOUSE_CURRENT_STORE_REQUIRED','WAREHOUSE_STORE_INACTIVE','WAREHOUSE_PARTY_INACTIVE','WAREHOUSE_PARTY_ROLE_MISMATCH','WAREHOUSE_DOCUMENT_REVISION_CONFLICT','WAREHOUSE_INSUFFICIENT_STOCK','WAREHOUSE_ISSUE_TYPE_INVALID','WAREHOUSE_PRICE_OVERRIDE_REASON_REQUIRED','WAREHOUSE_GIFT_RECIPIENT_INVALID','WAREHOUSE_PAID_NOW_INVALID','WAREHOUSE_ITEM_INACTIVE','MODULE_PERMISSION_REQUIRED','DEVICE_AUTHORIZATION_REQUIRED'])assert.ok(workspace.includes(code),code);
  assert.match(workspace,/تعذر إكمال العملية حاليًا\. راجع البيانات والصلاحيات ثم حاول مرة أخرى/);
});
