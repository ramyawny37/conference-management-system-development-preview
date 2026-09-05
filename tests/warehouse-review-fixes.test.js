'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const STORE_A='11111111-1111-4111-8111-111111111111';
const STORE_B='22222222-2222-4222-8222-222222222222';
const ITEM_ID='33333333-3333-4333-8333-333333333333';
const UNIT_ID='44444444-4444-4444-8444-444444444444';
const DOCUMENT_ID='8d1e8ca2-9860-4613-9aaf-bd37e08bced3';
const stores=[{id:STORE_A,name:'المكتب',status:'active'},{id:STORE_B,name:'المخزن الفرعي',status:'active'}];
const master={items:[{id:ITEM_ID,name:'كشكول ٦٠',sku:'PRD-000001',base_unit_id:UNIT_ID,status:'active'}],units:[{id:UNIT_ID,name:'قطعة',symbol:'قطعة',status:'active'}],categories:[]};

function boot(handler){
  const calls=[];
  const dom=new JSDOM('<main id="startupScreen"></main><section id="warehouseWorkspace"></section>',{url:'https://example.test/conference-management-system-development-preview/',runScripts:'outside-only'});
  const window=dom.window;
  window.AppIcons={icon:()=>''};window.showPlatformModules=()=>{};window.prompt=()=>'';
  window.SupabaseAuth={getAccountIdentity:()=>({authenticated:true,userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})};
  window.SupabaseDeviceIdentity={getCurrent:()=>({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})};
  window.BrowserStorageNamespace={key:name=>'cms:development:review:'+name};
  window.ApplicationRouting={resolveLogicalRoute:route=>'/conference-management-system-development-preview/#'+route,getLogicalPathname:()=>String(window.location.hash||'#/').slice(1)};
  window.WarehouseDeviceOperationContract={get:()=>({operationIdRequired:false,dispatchable:true})};
  window.WarehouseTransport={invoke:(name,args)=>{calls.push({name,args});return Promise.resolve().then(()=>handler(name,args,calls));}};
  for(const file of ['js/warehouse/current-store-context.js','js/warehouse/historical-operations.js','js/warehouse/party-management.js','js/warehouse/remaining-operations.js','js/warehouse/workspace.js'])window.eval(fs.readFileSync(file,'utf8'));
  return {window,api:window.WarehouseWorkspace,calls};
}
const tick=window=>new Promise(resolve=>window.setTimeout(resolve,0));

test('Edge classifier preserves only the exact approved opening-balance business error',()=>{
  const source=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
  const start=source.indexOf('function classified('),end=source.indexOf('\nDeno.serve',start);
  const runnable=source.slice(start,end).replace('error:unknown','error').replace(/error as \{code\?:unknown,message\?:unknown\}/g,'error');
  const sandbox={Set,String};vm.runInNewContext(runnable,sandbox);
  assert.deepEqual({...sandbox.classified({code:'55000',message:'WAREHOUSE_OPENING_BALANCE_EXISTING_HISTORY'})},{status:422,code:'WAREHOUSE_OPENING_BALANCE_EXISTING_HISTORY'});
  assert.deepEqual({...sandbox.classified({code:'55000',message:'WAREHOUSE_INTERNAL_TABLE_DETAIL'})},{status:500,code:'PLATFORM_DEVICE_OPERATION_FAILED'});
  assert.deepEqual({...sandbox.classified({code:'XX000',message:'sensitive sql text'})},{status:500,code:'PLATFORM_DEVICE_OPERATION_FAILED'});
});

test('approved Edge error survives Warehouse transport and displays the specific safe UI message',async()=>{
  const env=boot((name)=>{
    if(name==='discover_stores')return stores;
    if(name==='list_item_master')return master;
    if(name==='list_documents')return [{id:DOCUMENT_ID,document_number:'OPE-2026-00000081',document_date:'2026-09-05',document_kind:'opening_balance',status:'draft',revision:1}];
    if(name==='post_adjustment')throw {code:'WAREHOUSE_OPENING_BALANCE_EXISTING_HISTORY'};
    return [];
  });
  env.window.WarehouseRemainingOperations.setAdjustmentMode('opening_balance');
  await env.api.load('adjustments?mode=opening_balance');
  env.window.document.querySelector('[data-wh-operation-action="post_adjustment"]').click();
  await tick(env.window);
  assert.equal(env.window.document.querySelector('[data-wh-feedback]').textContent,'لا يمكن تسجيل رصيد افتتاحي لهذا الصنف لأن له حركة مخزنية سابقة في هذا المخزن.');
});

test('document review resolves item name, SKU and unit, localizes direction, and uses valid table markup',async()=>{
  const env=boot(name=>{
    if(name==='discover_stores')return stores;
    if(name==='list_item_master')return master;
    if(name==='list_documents')return [{id:DOCUMENT_ID,document_number:'OPE-2026-00000081',document_date:'2026-09-05',document_kind:'opening_balance',status:'draft',revision:1}];
    if(name==='get_document')return {header:{id:DOCUMENT_ID,document_number:'OPE-2026-00000081',document_kind:'opening_balance',status:'draft',revision:1},lines:[{item_id:ITEM_ID,direction:'in',quantity:6,inbound_unit_cost:0}]};
    return [];
  });
  env.window.WarehouseRemainingOperations.setAdjustmentMode('opening_balance');
  await env.api.load('adjustments?mode=opening_balance');
  const listRow=env.window.document.querySelector('[data-wh-operation-detail]').closest('tr');
  assert.equal(listRow.parentElement.tagName,'TBODY');
  assert.equal(listRow.closest('table').querySelectorAll('thead th').length,5);
  env.window.document.querySelector('[data-wh-operation-detail]').click();await tick(env.window);
  const detail=env.window.document.querySelector('[data-wh-operation-detail-panel]');
  for(const expected of ['كشكول ٦٠','PRD-000001','قطعة','إضافة'])assert.match(detail.textContent,new RegExp(expected));
  assert.doesNotMatch(detail.textContent,new RegExp(ITEM_ID));
  assert.doesNotMatch(detail.textContent,/(^|\s)(in|out)(\s|$)/);
});

test('Store card navigation selects the viewed store without replacing current operational context',async()=>{
  const env=boot((name,args)=>name==='discover_stores'?stores:name==='list_item_master'?master:name==='list_balances'?[]:name==='list_history'?{movements:[],audit:[]}:name==='list_documents'?[]:[]);
  env.window.WarehouseCurrentStoreContext.setCurrentWarehouseStore(STORE_A,stores);
  await env.api.load('stores');
  const card=[...env.window.document.querySelectorAll('[data-wh-store-card]')].find(node=>node.textContent.includes('المخزن الفرعي'));
  card.querySelector('[data-wh-store-view="balances"]').click();await tick(env.window);
  assert.equal(env.window.location.hash,'#/warehouse/balances?store='+STORE_B);
  assert.ok(env.calls.some(call=>call.name==='list_balances'&&call.args.p_store_id===STORE_B));
  assert.equal(env.window.WarehouseCurrentStoreContext.getCurrentWarehouseStoreId(),STORE_A);
  await env.api.load('stores');
  const historyCard=[...env.window.document.querySelectorAll('[data-wh-store-card]')].find(node=>node.textContent.includes('المخزن الفرعي'));
  historyCard.querySelector('[data-wh-store-view="history"]').click();await tick(env.window);
  assert.equal(env.window.location.hash,'#/warehouse/history?store='+STORE_B);
  assert.ok(env.calls.some(call=>call.name==='list_history'&&call.args.p_store_id===STORE_B));
  assert.equal(env.window.WarehouseCurrentStoreContext.getCurrentWarehouseStoreId(),STORE_A);
});

test('Balances continues after 100 rows without duplicates and store changes reset the cursor',async()=>{
  const items=Array.from({length:102},(_,index)=>({id:'item-'+String(index+1).padStart(3,'0'),name:'صنف '+(index+1),sku:'SKU-'+(index+1),base_unit_id:UNIT_ID,status:'active'}));
  const pages={};
  const env=boot((name,args)=>{
    if(name==='discover_stores')return stores;
    if(name==='list_item_master')return {items,units:master.units,categories:[]};
    if(name==='list_balances'){
      (pages[args.p_store_id]||(pages[args.p_store_id]=[])).push(args.p_before_item_id);
      if(args.p_store_id===STORE_B)return [{item_id:'item-102',quantity_on_hand:1,weighted_average_unit_cost:1,inventory_value:1}];
      if(!args.p_before_item_id)return items.slice(0,100).map(item=>({item_id:item.id,quantity_on_hand:1,weighted_average_unit_cost:2,inventory_value:2}));
      return [{item_id:'item-100',quantity_on_hand:1,weighted_average_unit_cost:2,inventory_value:2},{item_id:'item-101',quantity_on_hand:1,weighted_average_unit_cost:2,inventory_value:2}];
    }
    return [];
  });
  await env.api.load('balances?store='+STORE_A);
  assert.equal(env.window.document.querySelectorAll('[data-wh-balance-row]').length,100);
  env.window.document.querySelector('[data-wh-balances-more]').click();await tick(env.window);
  assert.deepEqual(pages[STORE_A],[null,'item-100']);
  assert.equal(env.window.document.querySelectorAll('[data-wh-balance-row]').length,101);
  const select=env.window.document.querySelector('[data-wh-balance-store-select]');select.value=STORE_B;select.dispatchEvent(new env.window.Event('change',{bubbles:true}));await tick(env.window);
  assert.deepEqual(pages[STORE_B],[null]);
  assert.equal(env.window.document.querySelectorAll('[data-wh-balance-row]').length,1);
  assert.match(env.window.document.querySelector('[data-wh-balance-row]').textContent,/صنف 102/);
});

test('History uses authorized document numbers, Arabic directions, and actual audit fields',async()=>{
  const env=boot(name=>{
    if(name==='discover_stores')return stores;
    if(name==='list_item_master')return master;
    if(name==='list_documents')return [{id:DOCUMENT_ID,document_number:'OPE-2026-00000081'}];
    if(name==='list_history')return {movements:[{sequence:2,occurred_at:'2026-09-05T09:00:00Z',item_id:ITEM_ID,direction:'out',movement_type:'issue',quantity:1,unit_cost:0,inventory_value:0,document_id:DOCUMENT_ID}],audit:[{occurred_at:'2026-09-05T09:01:00Z',event_type:'document.posted',document_kind:'opening_balance',document_id:DOCUMENT_ID,reason:'اختبار'}]};
    return [];
  });
  await env.api.load('history?store='+STORE_A);
  const movement=env.window.document.querySelector('.warehouse-table-card tbody tr');
  assert.match(movement.textContent,/خصم/);assert.match(movement.textContent,/OPE-2026-00000081/);assert.doesNotMatch(movement.textContent,new RegExp(DOCUMENT_ID));
  const audit=env.window.document.querySelector('.warehouse-audit');
  for(const expected of ['2026-09-05T09:01:00Z','document.posted','opening_balance','OPE-2026-00000081','اختبار'])assert.match(audit.textContent,new RegExp(expected));
  assert.doesNotMatch(audit.textContent,/المنفذ/);
});

test('Reports and top search accurately disclose their limited current behavior',async()=>{
  const env=boot(name=>name==='discover_stores'?stores:[]);await env.api.load('reports');
  const text=env.window.document.getElementById('warehouseWorkspace').textContent;
  assert.match(text,/مداخل إلى شاشات القراءة الآمنة/);assert.match(text,/لا ينشئ ملفًا/);assert.doesNotMatch(text,/تقارير مبنية.*فعلية فقط/);
  const search=env.window.document.querySelector('.warehouse-search input');assert.equal(search.disabled,true);assert.match(search.getAttribute('aria-label'),/غير متاح/);
});

test('opening-balance invariant and established guarded lifecycles remain source-enforced',()=>{
  const sql=fs.readFileSync('supabase/migrations/20260829150000_warehouse_post_document_revision_ambiguity_correction.sql','utf8');
  const remaining=fs.readFileSync('js/warehouse/remaining-operations.js','utf8');
  const historical=fs.readFileSync('js/warehouse/historical-operations.js','utf8');
  assert.match(sql,/WAREHOUSE_OPENING_BALANCE_EXISTING_HISTORY/);
  for(const operation of ['create_transfer_draft','post_transfer','submit_adjustment_for_approval','decide_adjustment_approval','create_reversal_request'])assert.match(remaining,new RegExp(operation));
  for(const operation of ['create_receipt_draft','post_receipt','create_issue_draft','post_issue'])assert.match(historical,new RegExp(operation));
  assert.doesNotMatch(remaining+historical,/\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|delete_document/);
});
