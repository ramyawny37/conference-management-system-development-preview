'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const ITEM_ONE='468551ef-1dff-4b80-b0cb-fac9c92d68ef';
const BASE_ONE='f173ea57-2338-44dd-96bf-a26945f8a683';
const PACK_ONE='53242751-d802-4c23-bbc5-12ce544e1e5d';
const ITEM_TWO='11111111-1111-4111-8111-111111111111';
const BASE_TWO='22222222-2222-4222-8222-222222222222';
const PACK_TWO='33333333-3333-4333-8333-333333333333';

function tick(){return new Promise(resolve=>setTimeout(resolve,0));}
function change(window,node,value,eventName){node.value=value;node.dispatchEvent(new window.Event(eventName||'change',{bubbles:true}));}
async function boot(){
  const dom=new JSDOM('<main id="warehouseWorkspace"></main>',{url:'https://example.test/',runScripts:'outside-only'}),window=dom.window,calls=[];
  const master={items:[{id:ITEM_ONE,name:'اختبار تحويل الوحدات',base_unit_id:BASE_ONE,default_issue_price:10,status:'active'},{id:ITEM_TWO,name:'صنف ثان',base_unit_id:BASE_TWO,default_issue_price:5,status:'active'}],units:[{id:BASE_ONE,name:'قطعة',symbol:'قطعة',status:'active'},{id:PACK_ONE,name:'باكو',symbol:'باكو',status:'active'},{id:BASE_TWO,name:'وحدة',symbol:'وحدة',status:'active'},{id:PACK_TWO,name:'علبة',symbol:'علبة',status:'active'}],itemUnits:[{item_id:ITEM_ONE,unit_id:BASE_ONE,conversion_factor:1,status:'active'},{item_id:ITEM_ONE,unit_id:PACK_ONE,conversion_factor:10,status:'active'},{item_id:ITEM_TWO,unit_id:BASE_TWO,conversion_factor:1,status:'active'},{item_id:ITEM_TWO,unit_id:PACK_TWO,conversion_factor:4,status:'active'}]};
  window.WarehouseCurrentStoreContext={getCurrentWarehouseStoreId:()=> '44444444-4444-4444-8444-444444444444'};
  window.eval(fs.readFileSync('js/warehouse/historical-operations.js','utf8'));
  const deps={state:{stores:[{id:'44444444-4444-4444-8444-444444444444',name:'المخزن'}],master:{}},esc:value=>String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),field:(label,control)=>'<label><span>'+label+'</span>'+control+'</label>',heading:(title,description)=>'<header><h2>'+title+'</h2><p>'+description+'</p></header>',icon:()=>'',render:(section,html)=>{window.document.getElementById('warehouseWorkspace').innerHTML=html;},setBusy:()=>{},feedback:()=>{},navigate:()=>{},invoke:(name,args)=>{calls.push({name,args});if(name==='discover_parties')return Promise.resolve([{id:'55555555-5555-4555-8555-555555555555',name:'مستفيد',status:'active'}]);if(name==='list_item_master')return Promise.resolve(master);if(name==='list_balances')return Promise.resolve([{item_id:ITEM_ONE,quantity_on_hand:30},{item_id:ITEM_TWO,quantity_on_hand:20}]);if(name==='get_beneficiary_balance')return Promise.resolve({balance:0});if(name==='create_issue_draft')return Promise.resolve({documentId:'66666666-6666-4666-8666-666666666666',documentNumber:'ISS-TEST',revision:1});if(name==='post_issue')return Promise.resolve({previousBalance:0,operationTotal:120,paidNow:0,remaining:120,resultingBalance:120});return Promise.resolve([]);}};
  await window.WarehouseHistoricalOperations.issues(deps);
  change(window,window.document.querySelector('[data-wh-beneficiary]'),'55555555-5555-4555-8555-555555555555');await tick();
  return {window,calls};
}

async function selectFirstPack(env){
  const {window}=env;
  change(window,window.document.querySelector('[data-wh-issue-item]'),ITEM_ONE);
  assert.equal(window.document.querySelector('[data-wh-issue-unit]').value,BASE_ONE);
  change(window,window.document.querySelector('[data-wh-issue-unit]'),PACK_ONE);
  assert.equal(window.document.querySelector('[data-wh-issue-unit]').value,PACK_ONE);
}

test('alternate Issue unit survives price, quantity, type, and override-reason edits and reaches the payload',async()=>{
  const env=await boot(),{window,calls}=env;await selectFirstPack(env);
  change(window,window.document.querySelector('[data-wh-issue-price]'),'120');
  assert.equal(window.document.querySelector('[data-wh-issue-unit]').value,PACK_ONE,'price edit');
  change(window,window.document.querySelector('[data-wh-issue-quantity]'),'1','input');
  assert.equal(window.document.querySelector('[data-wh-issue-unit]').value,PACK_ONE,'quantity edit');
  change(window,window.document.querySelector('[data-wh-issue-type]'),'subsidized');
  assert.equal(window.document.querySelector('[data-wh-issue-unit]').value,PACK_ONE,'issue-type edit');
  change(window,window.document.querySelector('[data-wh-issue-price]'),'120');
  change(window,window.document.querySelector('[data-wh-issue-reason]'),'رامي','input');
  assert.equal(window.document.querySelector('[data-wh-issue-unit]').value,PACK_ONE,'override-reason edit');
  const text=window.document.querySelector('.warehouse-issue-line-info').textContent;
  assert.match(text,/الوحدة المختارة:\s*باكو/);assert.match(text,/تعادل:\s*10 قطعة/);assert.match(text,/المتاح:\s*30 قطعة/);
  window.document.querySelector('[data-wh-issue-save]').click();await tick();await tick();
  const create=calls.find(call=>call.name==='create_issue_draft');assert.ok(create);
  assert.deepEqual({...create.args.p_payload.lines[0]},{itemId:ITEM_ONE,unitId:PACK_ONE,quantity:1,unitPrice:120,actualUnitPrice:120,issueType:'subsidized',priceOverrideReason:'رامي',giftRecipientMode:'unknown',giftRecipientPartyId:null,giftRecipientName:null});
  assert.equal(create.args.p_payload.lines[0].conversionFactor,undefined);
});

test('Issue rows retain selected units independently when another item is added and changed',async()=>{
  const env=await boot(),{window}=env;await selectFirstPack(env);
  window.document.querySelector('[data-wh-issue-add]').click();
  let rows=window.document.querySelectorAll('[data-wh-issue-line]');
  change(window,rows[1].querySelector('[data-wh-issue-item]'),ITEM_TWO);
  rows=window.document.querySelectorAll('[data-wh-issue-line]');
  change(window,rows[1].querySelector('[data-wh-issue-unit]'),PACK_TWO);
  rows=window.document.querySelectorAll('[data-wh-issue-line]');
  assert.equal(rows[0].querySelector('[data-wh-issue-unit]').value,PACK_ONE);
  assert.equal(rows[1].querySelector('[data-wh-issue-unit]').value,PACK_TWO);
  change(window,rows[1].querySelector('[data-wh-issue-item]'),ITEM_TWO);
  rows=window.document.querySelectorAll('[data-wh-issue-line]');
  assert.equal(rows[0].querySelector('[data-wh-issue-unit]').value,PACK_ONE);
  assert.equal(rows[1].querySelector('[data-wh-issue-unit]').value,BASE_TWO);
});

test('Issue conversion arithmetic preserves selected-unit finance and base-unit stock semantics',()=>{
  assert.deepEqual({enteredQuantity:1,factor:10,baseQuantity:1*10,selectedUnitPrice:120,baseUnitPrice:120/10,financialTotal:1*120,stockConsumption:1*10},{enteredQuantity:1,factor:10,baseQuantity:10,selectedUnitPrice:120,baseUnitPrice:12,financialTotal:120,stockConsumption:10});
  assert.deepEqual({enteredQuantity:1,factor:1,baseQuantity:1*1,baseUnitPrice:120/1,stockConsumption:1*1},{enteredQuantity:1,factor:1,baseQuantity:1,baseUnitPrice:120,stockConsumption:1});
});
