'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const DOCUMENTS=[
  {id:'none',document_number:'REC-NONE',status:'posted',revision:2},
  {id:'draft',document_number:'REC-DRAFT',status:'posted',revision:2},
  {id:'pending',document_number:'REC-PENDING',status:'posted',revision:2},
  {id:'approved',document_number:'REC-APPROVED',status:'posted',revision:2},
  {id:'rejected',document_number:'REC-REJECTED',status:'posted',revision:2},
  {id:'completed',document_number:'REC-COMPLETED',status:'reversed',revision:3}
];
const REVERSALS=[
  {id:'request-draft',original_document_id:'draft',status:'draft',revision:1,reason:'السبب الحالي'},
  {id:'request-pending',original_document_id:'pending',status:'pending',revision:2,reason:'سبب معلق'},
  {id:'request-approved',original_document_id:'approved',status:'approved',revision:2,reason:'سبب معتمد'},
  {id:'request-rejected',original_document_id:'rejected',status:'rejected',revision:2,reason:'سبب مرفوض',decision_reason:'قرار الرفض'},
  {id:'request-posted',original_document_id:'completed',status:'posted',revision:3,reason:'سبب مكتمل'}
];

function boot(kind){
  const calls=[];
  const dom=new JSDOM('<main id="startupScreen"></main><section id="warehouseWorkspace"></section>',{url:'https://example.test/#/warehouse/'+kind,runScripts:'outside-only'});
  const window=dom.window;
  window.AppIcons={icon:()=>''};window.showPlatformModules=()=>{};
  window.prompt=(_label,current)=>current;
  window.SupabaseAuth={getAccountIdentity:()=>({displayName:'مختبر'})};
  window.ApplicationRouting={getLogicalPathname:()=>'/warehouse/'+kind,resolveLogicalRoute:route=>'#'+route};
  window.WarehouseDeviceOperationContract={get:()=>({operationIdRequired:false})};
  window.WarehouseCurrentStoreContext={validateCurrentWarehouseStore:()=>null,getCurrentWarehouseStoreId:()=>{throw Object.assign(new Error(),{code:'WAREHOUSE_CURRENT_STORE_REQUIRED'});}};
  window.WarehouseTransport={invoke(name,args){calls.push({name,args});if(name==='discover_stores')return Promise.resolve([]);if(name==='list_item_master')return Promise.resolve({items:[],units:[],categories:[]});if(name==='discover_parties')return Promise.resolve([]);if(name==='list_documents')return Promise.resolve(DOCUMENTS.map(row=>Object.assign({document_kind:kind==='transfers'?'transfer':'receipt'},row)));if(name==='list_reversal_requests')return Promise.resolve(REVERSALS);if(name==='list_approval_queue')return Promise.resolve([]);if(name==='get_document')return Promise.resolve({header:DOCUMENTS.find(row=>row.id===args.p_document_id),lines:[]});return Promise.resolve({});}};
  for(const file of ['js/warehouse/historical-operations.js','js/warehouse/remaining-operations.js','js/warehouse/workspace.js'])window.eval(fs.readFileSync(file,'utf8'));
  return {window,calls,api:window.WarehouseWorkspace};
}
function row(window,id){return [...window.document.querySelectorAll('tbody tr')].find(entry=>entry.textContent.includes(id));}

test('receipt rows expose the complete server-backed reversal lifecycle without duplicate creation',async()=>{
  const harness=boot('receipts');await harness.api.load('receipts');const {window,calls}=harness;
  assert.ok(calls.some(call=>call.name==='list_reversal_requests'));
  assert.ok(row(window,'REC-NONE').querySelector('[data-wh-receipt-reverse]'));
  assert.equal(row(window,'REC-DRAFT').querySelector('[data-wh-receipt-reverse]'),null);
  assert.ok(row(window,'REC-DRAFT').querySelector('[data-wh-reversal-submit]'));
  assert.match(row(window,'REC-DRAFT').textContent,/طلب عكس — مسودة.*السبب الحالي/);
  assert.match(row(window,'REC-PENDING').textContent,/بانتظار الاعتماد/);
  assert.equal(row(window,'REC-PENDING').querySelector('[data-wh-reversal-submit],[data-wh-reversal-post]'),null);
  assert.ok(row(window,'REC-APPROVED').querySelector('[data-wh-reversal-post]'));
  assert.match(row(window,'REC-REJECTED').textContent,/مرفوض.*قرار الرفض/);
  assert.ok(row(window,'REC-REJECTED').querySelector('[data-wh-reversal-submit]'));
  assert.match(row(window,'REC-COMPLETED').textContent,/تم تنفيذ العكس/);
  assert.equal(row(window,'REC-COMPLETED').querySelector('button:not([data-wh-receipt-detail])'),null);
});

test('submit and post actions preserve request id, current reason, and expected revision',async()=>{
  const harness=boot('receipts');await harness.api.load('receipts');
  row(harness.window,'REC-DRAFT').querySelector('[data-wh-reversal-submit]').click();
  await new Promise(resolve=>harness.window.setTimeout(resolve,0));
  const submit=harness.calls.find(call=>call.name==='submit_reversal_request');
  assert.deepEqual(JSON.parse(JSON.stringify(submit.args)),{p_request_id:'request-draft',p_expected_revision:1,p_reason:'السبب الحالي'});
  const fresh=boot('receipts');await fresh.api.load('receipts');
  row(fresh.window,'REC-APPROVED').querySelector('[data-wh-reversal-post]').click();
  await new Promise(resolve=>fresh.window.setTimeout(resolve,0));
  const post=fresh.calls.find(call=>call.name==='post_reversal');
  assert.deepEqual(JSON.parse(JSON.stringify(post.args)),{p_request_id:'request-approved',p_expected_revision:2});
});

test('transfer reversal actions use the same guarded discovery and lifecycle controls',async()=>{
  const harness=boot('transfers');await harness.api.load('transfers');
  assert.ok(harness.calls.some(call=>call.name==='list_reversal_requests'));
  assert.ok(row(harness.window,'REC-NONE').querySelector('[data-wh-transfer-reversal]'));
  assert.ok(row(harness.window,'REC-DRAFT').querySelector('[data-wh-reversal-submit]'));
  assert.ok(row(harness.window,'REC-APPROVED').querySelector('[data-wh-reversal-post]'));
  assert.equal(row(harness.window,'REC-PENDING').querySelector('[data-wh-reversal-submit],[data-wh-reversal-post]'),null);
});

test('approval screen remains queue-authoritative and excludes draft reversal discovery',async()=>{
  const harness=boot('approvals');await harness.api.load('approvals');
  assert.ok(harness.calls.some(call=>call.name==='list_approval_queue'));
  assert.equal(harness.calls.some(call=>call.name==='list_reversal_requests'),false);
  assert.doesNotMatch(harness.window.document.getElementById('warehouseWorkspace').textContent,/السبب الحالي|طلب عكس — مسودة/);
});

test('receipt detail renders a real status badge without exposing literal badge markup',async()=>{
  const harness=boot('receipts');await harness.api.load('receipts');
  row(harness.window,'REC-NONE').querySelector('[data-wh-receipt-detail]').click();
  const panel=harness.window.document.querySelector('[data-wh-receipt-detail-panel]');
  assert.ok(panel.querySelector('.warehouse-status.posted'));
  assert.doesNotMatch(panel.textContent,/<span class="warehouse-status/);
});

test('reversal UI remains transport-only with no direct stock or local persistence',()=>{
  const source=['js/warehouse/workspace.js','js/warehouse/historical-operations.js','js/warehouse/remaining-operations.js'].map(file=>fs.readFileSync(file,'utf8')).join('\n');
  assert.doesNotMatch(source,/\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(|localStorage|sessionStorage/);
  for(const operation of ['list_reversal_requests','create_reversal_request','submit_reversal_request','post_reversal'])assert.ok(source.includes(operation),operation);
});
