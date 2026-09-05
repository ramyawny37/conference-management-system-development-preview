'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const STORE_ID='11111111-1111-4111-8111-111111111111';
const ITEM_ID='33333333-3333-4333-8333-333333333333';
const UNIT_ID='44444444-4444-4444-8444-444444444444';
const stores=[{id:STORE_ID,name:'المخزن',status:'active'}];
const master={items:[{id:ITEM_ID,name:'صنف',sku:'SKU-1',base_unit_id:UNIT_ID,status:'active'}],units:[{id:UNIT_ID,name:'قطعة',symbol:'قطعة',status:'active'}],categories:[]};

function boot(documents){
  const dom=new JSDOM('<main id="startupScreen"></main><section id="warehouseWorkspace"></section>',{url:'https://example.test/conference-management-system-development-preview/',runScripts:'outside-only'});
  const window=dom.window;
  window.AppIcons={icon:()=>''};window.showPlatformModules=()=>{};window.prompt=()=>'';
  window.SupabaseAuth={getAccountIdentity:()=>({authenticated:true,userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})};
  window.SupabaseDeviceIdentity={getCurrent:()=>({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})};
  window.BrowserStorageNamespace={key:name=>'cms:development:opening-balance:'+name};
  window.ApplicationRouting={resolveLogicalRoute:route=>'#/warehouse/'+route,getLogicalPathname:()=>String(window.location.hash||'#/').slice(1)};
  window.WarehouseDeviceOperationContract={get:()=>({operationIdRequired:false,dispatchable:true})};
  window.WarehouseTransport={invoke:name=>Promise.resolve(name==='discover_stores'?stores:name==='list_item_master'?master:name==='list_documents'?(documents||[]):[])};
  for(const file of ['js/warehouse/current-store-context.js','js/warehouse/historical-operations.js','js/warehouse/party-management.js','js/warehouse/remaining-operations.js','js/warehouse/workspace.js'])window.eval(fs.readFileSync(file,'utf8'));
  return {window,api:window.WarehouseWorkspace};
}

test('opening balance begins with one removable line and adds exactly one per click',async()=>{
  const env=boot([]);
  env.window.WarehouseRemainingOperations.setAdjustmentMode('opening_balance');
  await env.api.load('adjustments?mode=opening_balance');
  const document=env.window.document;
  assert.equal(document.querySelectorAll('[data-wh-operation-line]').length,1);
  document.querySelector('[data-wh-add-line]').click();
  assert.equal(document.querySelectorAll('[data-wh-operation-line]').length,2);
  document.querySelector('[data-wh-remove-line]').click();
  assert.equal(document.querySelectorAll('[data-wh-operation-line]').length,1);
  document.querySelector('[data-wh-remove-line]').click();
  assert.equal(document.querySelectorAll('[data-wh-operation-line]').length,1);
});

test('opening balance reason remains optional with an existing draft and no blank editor line is added',async()=>{
  const env=boot([{id:'8d1e8ca2-9860-4613-9aaf-bd37e08bced3',document_number:'OPE-2026-00000081',document_kind:'opening_balance',document_date:'2026-09-05',status:'draft',revision:2}]);
  env.window.WarehouseRemainingOperations.setAdjustmentMode('opening_balance');
  await env.api.load('adjustments?mode=opening_balance');
  assert.equal(env.window.document.querySelectorAll('[data-wh-operation-line]').length,1);
  assert.equal(env.window.document.querySelector('[name="reason"]').required,false);
});

test('all non-opening adjustment modes continue to require a reason',async()=>{
  const env=boot([]);
  for(const mode of ['adjustment','correction','damage_loss']){
    env.window.WarehouseRemainingOperations.setAdjustmentMode(mode);
    await env.api.load('adjustments?mode='+mode);
    assert.equal(env.window.document.querySelector('[name="reason"]').required,true,mode);
    assert.equal(env.window.document.querySelectorAll('[data-wh-operation-line]').length,1,mode);
  }
});
