const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const source=fs.readFileSync('js/warehouse/workspace.js','utf8');
const historical=fs.readFileSync('js/warehouse/historical-operations.js','utf8');
const css=fs.readFileSync('style.css','utf8');
const contract=fs.readFileSync('js/supabase/warehouse-device-operation-contract.js','utf8');

function functionBody(name,next){
  const start=source.indexOf('function '+name+'(');
  const end=source.indexOf('function '+next+'(',start+1);
  assert.notEqual(start,-1,'missing '+name);
  assert.notEqual(end,-1,'missing boundary '+next);
  return source.slice(start,end);
}

test('Items screen restores historical entity routes, guarded create/edit, and empty-state UX',()=>{
  const body=functionBody('masters','stores');
  assert.match(body,/invoke\('list_item_master'/);
  assert.match(source,/mutate\('upsert_item_master'/);
  assert.match(source,/p_entity_id:current\.id\|\|null/);
  assert.match(source,/p_expected_revision:current\.id\?Number\(current\.revision\):0/);
  assert.match(source,/items\/categories/);
  assert.match(source,/items\/units/);
  assert.match(source,/أقسام بيانات الأصناف/);
  assert.match(body,/data-wh-master-open/);
  assert.match(source,/data-wh-master-edit/);
  assert.match(body,/masterEmpty\(\)/);
  assert.match(body,/data-wh-filter-input/);
  assert.match(body,/data-wh-category-filter/);
  assert.match(body,/data-wh-status-filter/);
  assert.match(source,/role="dialog"/);
  assert.match(source,/defaultPurchasePrice/);
  assert.match(source,/defaultIssuePrice/);
  assert.match(source,/minimumStock/);
  assert.match(source,/description:d\.description/);
  assert.doesNotMatch(source,/p_entity_kind:d\.kind/);
  assert.doesNotMatch(body,/delete_item|create_category|create_unit/);
});

test('Item Master sub-routes resolve relative and full paths without falling back to Items',()=>{
  const masterView=Function('global','return ('+functionBody('masterView','masterRoute')+')')({
    ApplicationRouting:{getLogicalPathname:()=>'/warehouse/items'}
  });
  const masterRoute=Function('return ('+functionBody('masterRoute','masterTabs')+')')();
  for(const [route,view] of [
    ['items','item'],
    ['items/categories','category'],
    ['items/units','unit'],
    ['/warehouse/items','item'],
    ['/warehouse/items/categories','category'],
    ['/warehouse/items/units','unit']
  ])assert.equal(masterView(route),view,route);
  for(const view of ['item','category','unit','category','item','unit']){
    assert.equal(masterView(masterRoute(view)),view,'switch to '+view);
  }
});

test('Stores screen preserves discover/create/update and revision-aware editing only',()=>{
  const body=functionBody('stores','kind');
  assert.match(body,/WarehouseHistoricalOperations\.stores/);
  assert.match(historical,/invoke\('discover_stores',\{p_include_inactive:true\}/);
  assert.match(historical,/data-wh-store-open/);
  assert.match(historical,/data-wh-historical-store/);
  assert.match(historical,/mutate\('create_store'/);
  assert.match(historical,/mutate\('update_store'/);
  assert.match(historical,/args\.p_expected_revision=Number\(current\.revision\)/);
  assert.match(historical,/statusBadge\(store\.status\)/);
  assert.doesNotMatch(historical,/delete_store/);
});

test('Receipts screen uses the secure Party-backed lifecycle',()=>{
  assert.match(historical,/invoke\('list_documents'/);
  assert.match(historical,/invoke\('get_document'/);
  assert.match(historical,/mutate\('create_receipt_draft'/);
  assert.match(historical,/mutate\('update_document_draft'/);
  assert.match(historical,/mutate\('post_receipt'/);
  assert.match(historical,/mutate\('create_reversal_request'/);
  assert.match(historical,/supplierPartyId:data\.supplierId/);
  assert.match(historical,/p_document_kind:'receipt'/);
  assert.match(historical,/p_expected_revision:Number\(form\.dataset\.rev\)/);
});

test('Issues screen uses secure current-store and Party-backed create/post orchestration',()=>{
  assert.match(historical,/getCurrentWarehouseStoreId\(\)/);
  assert.match(historical,/invoke\('create_issue_draft'/);
  assert.match(historical,/invoke\('post_issue'/);
  assert.match(historical,/beneficiaryPartyId:issueState\.beneficiaryId/);
  assert.match(historical,/giftRecipientMode/);
  assert.match(historical,/paidNow/);
  assert.match(historical,/subsidized/);
  assert.doesNotMatch(historical,/campaign|auth users|conference members/i);
});

test('Round 2 remains transport-only and renders only live or explicit empty/error states',()=>{
  ['list_item_master','upsert_item_master','discover_stores','create_store','update_store',
    'list_documents','get_document','create_receipt_draft','create_issue_draft',
    'update_document_draft','post_receipt','post_issue'].forEach(operation=>{
    assert.match(contract,new RegExp("\\['"+operation+"'"));
  });
  assert.match(source,/WarehouseTransport\.invoke/);
  assert.match(source,/لم تُستخدم بيانات بديلة/);
  assert.doesNotMatch(source+historical,/demo|sample|mock|\.rpc\(|\.schema\(|SupabaseClientLayer|fetch\s*\(|document\.cookie/i);
  assert.doesNotMatch(source+historical,/next\/|\bReact\b|vercel|gateway/i);
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
