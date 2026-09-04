const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const source=fs.readFileSync('js/warehouse/workspace.js','utf8');
const css=fs.readFileSync('style.css','utf8');
const contract=fs.readFileSync('js/supabase/warehouse-device-operation-contract.js','utf8');

function functionBody(name,next){
  const start=source.indexOf('function '+name+'(');
  const end=source.indexOf('function '+next+'(',start+1);
  assert.notEqual(start,-1,'missing '+name);
  assert.notEqual(end,-1,'missing boundary '+next);
  return source.slice(start,end);
}

test('Items screen uses live master operations with create, edit, revision and empty-state UX',()=>{
  const body=functionBody('masters','stores');
  assert.match(body,/invoke\('list_item_master'/);
  assert.match(source,/mutate\('upsert_item_master'/);
  assert.match(source,/p_entity_id:r\.id,p_expected_revision:Number\(r\.revision\)/);
  assert.match(body,/data-wh-master/);
  assert.match(body,/data-wh-master-edit/);
  assert.match(body,/warehouse-empty|empty\(\)/);
  assert.match(body,/data-wh-filter-input/);
  assert.doesNotMatch(body,/delete_item|create_category|create_unit/);
});

test('Stores screen preserves discover/create/update and revision-aware editing only',()=>{
  const body=functionBody('stores','kind');
  assert.match(body,/invoke\('discover_stores',\{p_include_inactive:true\}/);
  assert.match(body,/data-wh-store/);
  assert.match(body,/data-wh-store-edit/);
  assert.match(source,/mutate\('create_store'/);
  assert.match(source,/mutate\('update_store'/);
  assert.match(source,/p_expected_revision:Number\(r\.revision\)/);
  assert.match(body,/statusBadge\(s\.status\)/);
  assert.doesNotMatch(body,/delete_store/);
});

test('Receipts screen uses the exact live document lifecycle without supplier or payment APIs',()=>{
  const body=functionBody('documents','draftPayload');
  assert.match(body,/invoke\('list_documents'/);
  assert.match(source,/invoke\('get_document'/);
  assert.match(source,/name='create_receipt_draft'/);
  assert.match(source,/mutate\('update_document_draft'/);
  assert.match(source,/receipts:'post_receipt'/);
  assert.match(source,/p_document_kind:kind\(s\)/);
  assert.match(source,/p_expected_revision:Number\(update\.dataset\.rev\)/);
  assert.doesNotMatch(source,/supplierReference|supplier_id|payment|accounting/i);
});

test('Issues screen uses the exact live document lifecycle without people or campaign integration',()=>{
  assert.match(source,/name='create_issue_draft'/);
  assert.match(source,/issues:'post_issue'/);
  assert.match(source,/payload\.sourceStoreId=d\.storeId/);
  assert.match(source,/payload\.purpose=d\.reason\|\|'صرف تشغيلي'/);
  assert.doesNotMatch(source,/beneficiary|campaign|giftRecipient|paidNow|subsidized/i);
});

test('Round 2 remains transport-only and renders only live or explicit empty/error states',()=>{
  ['list_item_master','upsert_item_master','discover_stores','create_store','update_store',
    'list_documents','get_document','create_receipt_draft','create_issue_draft',
    'update_document_draft','post_receipt','post_issue'].forEach(operation=>{
    assert.match(contract,new RegExp("\\['"+operation+"'"));
  });
  assert.match(source,/WarehouseTransport\.invoke/);
  assert.match(source,/لم تُستخدم بيانات بديلة/);
  assert.doesNotMatch(source,/demo|sample|mock|\.rpc\(|\.schema\(|SupabaseClientLayer|fetch\s*\(|document\.cookie/i);
  assert.doesNotMatch(source,/next\/|\bReact\b|vercel|gateway/i);
});

test('Core screen layout is keyboard, touch and mobile responsive without page-level overflow',()=>{
  assert.match(css,/\.warehouse-form-grid\{display:grid/);
  assert.match(css,/\.warehouse-document-layout\{display:grid/);
  assert.match(css,/\.warehouse-account\{min-width:0;max-width:/);
  assert.match(css,/@media\(max-width:680px\)[\s\S]*?\.warehouse-form-grid[\s\S]*?grid-template-columns:1fr/);
  assert.match(css,/@media\(max-width:430px\)[\s\S]*?min-height:44px/);
  assert.match(css,/\.warehouse-field input:focus,\.warehouse-field select:focus/);
  assert.match(css,/\.warehouse-table-card\{[^}]*overflow-x:auto/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) 268px/);
  assert.match(css,/sidebar-collapsed\{grid-template-columns:minmax\(0,1fr\) 76px/);
});
