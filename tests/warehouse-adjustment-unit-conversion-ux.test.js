'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const STORE='11111111-1111-4111-8111-111111111111';
const ITEM='22222222-2222-4222-8222-222222222222';
const BASE='33333333-3333-4333-8333-333333333333';
const PACK='44444444-4444-4444-8444-444444444444';
const master={items:[{id:ITEM,name:'صنف',sku:'SKU-1',base_unit_id:BASE,status:'active'}],units:[{id:BASE,name:'قطعة',symbol:'قطعة',status:'active'},{id:PACK,name:'باكو',symbol:'باكو',status:'active'}],itemUnits:[{item_id:ITEM,unit_id:PACK,conversion_factor:10,status:'active'}]};

function boot(){
  const calls=[],dom=new JSDOM('<main id="startupScreen"></main><section id="warehouseWorkspace"></section>',{url:'https://example.test/',runScripts:'outside-only'}),window=dom.window;
  window.AppIcons={icon:()=>''};window.showPlatformModules=()=>{};window.prompt=()=>'';window.crypto={randomUUID:()=>'55555555-5555-4555-8555-555555555555'};
  window.SupabaseAuth={getAccountIdentity:()=>({authenticated:true,userId:'a'})};window.SupabaseDeviceIdentity={getCurrent:()=>({id:'b'})};window.BrowserStorageNamespace={key:x=>x};window.ApplicationRouting={resolveLogicalRoute:x=>x,getLogicalPathname:()=>'/'};window.WarehouseDeviceOperationContract={get:()=>({operationIdRequired:false,dispatchable:true})};
  window.WarehouseTransport={invoke:(name,args)=>{calls.push({name,args});return Promise.resolve(name==='discover_stores'?[{id:STORE,name:'المخزن',status:'active'}]:name==='list_item_master'?master:[]);}};
  for(const file of ['js/warehouse/current-store-context.js','js/warehouse/historical-operations.js','js/warehouse/party-management.js','js/warehouse/remaining-operations.js','js/warehouse/workspace.js'])window.eval(fs.readFileSync(file,'utf8'));
  return {window,calls};
}

async function loadMode(env,mode){env.window.WarehouseRemainingOperations.setAdjustmentMode(mode);await env.window.WarehouseWorkspace.load('adjustments?mode='+mode);return env.window.document.querySelector('[data-wh-adjustment-form]');}
function selectLine(window,form,unit,quantity){const item=form.querySelector('[name="itemId"]');item.value=ITEM;item.dispatchEvent(new window.Event('change',{bubbles:true}));const unitSelect=form.querySelector('[name="unitId"]');unitSelect.value=unit;unitSelect.dispatchEvent(new window.Event('change',{bubbles:true}));const quantityInput=form.querySelector('[name="quantity"]');quantityInput.value=String(quantity);quantityInput.dispatchEvent(new window.Event('input',{bubbles:true}));}

test('adjustment conversion summary uses configured item-unit factor and base unit stays concise',async()=>{
  const env=boot(),form=await loadMode(env,'adjustment');
  selectLine(env.window,form,PACK,1);
  assert.equal(form.querySelector('[data-wh-unit-conversion]').innerHTML,'1 باكو × 10 = 10 قطعة<br>الكمية الأساسية: 10 قطعة');
  selectLine(env.window,form,BASE,3);
  assert.equal(form.querySelector('[data-wh-unit-conversion]').textContent,'الكمية الأساسية: 3 قطعة');
});

test('damage and loss renders no inbound-cost control and sends no inbound cost or conversion authority',async()=>{
  const env=boot(),form=await loadMode(env,'damage_loss');
  assert.equal(form.querySelector('[data-wh-inbound-cost]'),null);
  assert.equal(form.querySelector('[name="inboundUnitCost"]'),null);
  selectLine(env.window,form,PACK,2);form.querySelector('[name="storeId"]').value=STORE;form.querySelector('[name="reason"]').value='تلف';
  form.dispatchEvent(new env.window.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('button[type="submit"]')}));
  await new Promise(resolve=>env.window.setTimeout(resolve,0));
  const line=env.calls.find(call=>call.name==='create_adjustment_draft').args.p_payload.lines[0];
  assert.deepEqual({...line},{itemId:ITEM,unitId:PACK,direction:'out',quantity:2,notes:null});
  assert.equal(line.conversionFactor,undefined);
});

test('adjustment and correction preserve inbound-cost lifecycle while opening balance keeps its dedicated cost',async()=>{
  for(const mode of ['adjustment','correction']){
    const env=boot(),form=await loadMode(env,mode),direction=form.querySelector('[name="direction"]'),cost=form.querySelector('[data-wh-inbound-cost]'),input=cost.querySelector('input');
    assert.equal(input.required,true);assert.equal(cost.hidden,false);
    direction.value='out';direction.dispatchEvent(new env.window.Event('change',{bubbles:true}));assert.equal(input.required,false);assert.equal(cost.hidden,true);
    direction.value='in';direction.dispatchEvent(new env.window.Event('change',{bubbles:true}));assert.equal(input.required,true);assert.equal(cost.hidden,false);
  }
  const opening=boot(),form=await loadMode(opening,'opening_balance'),cost=form.querySelector('[data-wh-inbound-cost]');
  assert.match(cost.textContent,/تكلفة الوحدة الافتتاحية/);assert.equal(cost.hidden,false);assert.equal(cost.querySelector('input').required,true);
});
