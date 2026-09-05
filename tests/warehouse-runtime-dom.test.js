'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

const STORE_ID='11111111-1111-4111-8111-111111111111';
const ITEM_ID='22222222-2222-4222-8222-222222222222';
const UNIT_ID='33333333-3333-4333-8333-333333333333';
const CATEGORY_ID='44444444-4444-4444-8444-444444444444';
const master={
  items:[{id:ITEM_ID,name:'ورق طباعة',sku:'PAPER-A4',base_unit_id:UNIT_ID,category_id:CATEGORY_ID,status:'active'}],
  units:[{id:UNIT_ID,name:'رزمة',symbol:'رزمة',status:'active'}],
  categories:[{id:CATEGORY_ID,name:'مستلزمات مكتبية',status:'active'}]
};
const stores=[{id:STORE_ID,name:'المخزن الرئيسي',status:'active'}];

function result(name){
  if(name==='discover_stores')return stores;
  if(name==='list_item_master')return master;
  if(name==='discover_parties'||name==='list_documents'||name==='list_approval_queue')return [];
  if(name==='list_balances')return [{item_id:ITEM_ID,quantity_on_hand:12,weighted_average_unit_cost:7.5,inventory_value:90,calculated_at:'2026-09-05T10:00:00Z',last_movement_sequence:41}];
  if(name==='list_history')return {movements:[{sequence:41,occurred_at:'2026-09-05T10:00:00Z',item_id:ITEM_ID,direction:'in',movement_type:'opening',quantity:12,unit_cost:7.5,inventory_value:90,document_number:'OB-41'}],audit:[{created_at:'2026-09-05T10:01:00Z',action:'posted',actor_name:'مدير المخزن',document_id:'OB-41'}]};
  if(name==='authorize_report_export')return {authorized:true};
  return [];
}

function boot(){
  const dom=new JSDOM('<main id="startupScreen"></main><section id="warehouseWorkspace"></section>',{url:'https://example.test/conference-management-system-development-preview/',runScripts:'outside-only'});
  const window=dom.window;
  window.AppIcons={icon:()=>''};
  window.showPlatformModules=()=>{};
  window.prompt=()=>'';
  window.SupabaseAuth={getAccountIdentity:()=>({authenticated:true,userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',displayName:'مختبر'})};
  window.SupabaseDeviceIdentity={getCurrent:()=>({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})};
  window.BrowserStorageNamespace={key:name=>'cms:development:test:'+name};
  window.ApplicationRouting={resolveLogicalRoute:route=>'/conference-management-system-development-preview/#'+route,getLogicalPathname:()=>String(window.location.hash||'#/').slice(1)};
  window.WarehouseDeviceOperationContract={get:()=>({operationIdRequired:false})};
  window.WarehouseTransport={invoke:name=>Promise.resolve(result(name))};
  for(const file of ['js/warehouse/current-store-context.js','js/warehouse/historical-operations.js','js/warehouse/party-management.js','js/warehouse/remaining-operations.js','js/warehouse/workspace.js'])window.eval(fs.readFileSync(file,'utf8'));
  return {dom,window,api:window.WarehouseWorkspace};
}

test('Receipts horizontal navigation performs a real DOM click into Opening Balance',async()=>{
  const {window,api}=boot();
  await api.load('receipts');
  const button=[...window.document.querySelectorAll('.warehouse-operations-nav [data-wh-route]')].find(node=>node.textContent==='أرصدة افتتاحية');
  assert.ok(button);
  button.click();
  await new Promise(resolve=>window.setTimeout(resolve,0));
  assert.equal(window.location.hash,'#/warehouse/adjustments?mode=opening_balance');
  assert.equal(window.WarehouseRemainingOperations.getAdjustmentMode(),'opening_balance');
  const text=window.document.getElementById('warehouseWorkspace').textContent;
  for(const expected of ['الأرصدة الافتتاحية','المخزن','التاريخ','السبب','الملاحظات','الصنف','الكمية الافتتاحية','تكلفة الوحدة الافتتاحية','قيمة السطر','إضافة صنف'])assert.match(text,new RegExp(expected));
  assert.equal(window.document.querySelectorAll('[data-wh-operation-line]').length,2);
  assert.equal(window.document.querySelectorAll('[data-wh-remove-line]').length,2);
  assert.doesNotMatch(text,/إرسال للاعتماد/);
});

test('Balances DOM resolves business metadata and keeps server values authoritative',async()=>{
  const {window,api}=boot();
  window.WarehouseCurrentStoreContext.setCurrentWarehouseStore(STORE_ID,stores);
  await api.load('balances');
  const row=window.document.querySelector('[data-wh-balance-row]');
  assert.ok(row);
  for(const expected of ['ورق طباعة','PAPER-A4','رزمة','12','7.5','90'])assert.match(row.textContent,new RegExp(expected));
  assert.notEqual(row.querySelector('strong').textContent,ITEM_ID);
});

test('History DOM is detailed, translated, metadata-resolved, and separates audit',async()=>{
  const {window,api}=boot();
  window.WarehouseCurrentStoreContext.setCurrentWarehouseStore(STORE_ID,stores);
  await api.load('history');
  const movement=window.document.querySelector('.warehouse-table-card tbody tr');
  for(const expected of ['41','ورق طباعة','رصيد افتتاحي','12','7.5','90','OB-41'])assert.match(movement.textContent,new RegExp(expected));
  const audit=window.document.querySelector('.warehouse-audit');
  assert.ok(audit);
  assert.match(audit.textContent,/سجل التدقيق التشغيلي/);
  assert.match(audit.textContent,/مدير المخزن/);
  assert.ok(window.document.querySelector('[name="documentId"]'));
  assert.ok(window.document.querySelector('[name="itemId"]'));
  assert.ok(window.document.querySelector('[name="documentKind"]'));
  assert.ok(window.document.querySelector('[name="from"]'));
  assert.ok(window.document.querySelector('[name="to"]'));
});

test('Reports DOM has seven real entries and accurate authorization language',async()=>{
  const {window,api}=boot();
  window.WarehouseCurrentStoreContext.setCurrentWarehouseStore(STORE_ID,stores);
  await api.load('reports');
  const grid=window.document.querySelector('.warehouse-report-grid');
  assert.equal(grid.querySelectorAll(':scope > button[data-wh-route]').length,7);
  assert.doesNotMatch(grid.textContent,/WAREHOUSE_UI_BACKEND_GAP/);
  assert.match(grid.textContent,/قريبًا — لا يتوفر عقد قراءة آمن للسجل المالي بعد/);
  assert.match(grid.textContent,/تفويض التصدير/);
  grid.querySelector('[data-wh-authorize-export]').click();
  await new Promise(resolve=>window.setTimeout(resolve,0));
  assert.match(grid.querySelector('[data-wh-export-result]').textContent,/تم التحقق من صلاحية التصدير/);
  assert.doesNotMatch(grid.textContent,/تم التصدير/);
});

test('Current Store Context stays synchronized and never auto-selects the first store',async()=>{
  const {window,api}=boot();
  await api.load('balances');
  let selectors=window.document.querySelectorAll('[data-wh-current-store]');
  assert.equal(selectors.length,2);
  assert.equal(selectors[0].value,'');
  assert.equal(selectors[1].value,'');
  assert.match(window.document.querySelector('.warehouse-store-context-strip').textContent,/المخزن الحالي: لم يتم الاختيار/);
  selectors[0].value=STORE_ID;
  selectors[0].dispatchEvent(new window.Event('change',{bubbles:true}));
  await new Promise(resolve=>window.setTimeout(resolve,0));
  selectors=window.document.querySelectorAll('[data-wh-current-store]');
  assert.equal(selectors[0].value,STORE_ID);
  assert.equal(selectors[1].value,STORE_ID);
});

test('every supported operation tab changes the route through a DOM click and Returns stays disabled',async()=>{
  const expected={
    'حركة المخزون':'history','رصيد المخازن':'balances','أرصدة افتتاحية':'adjustments?mode=opening_balance','استلام / مشتريات':'receipts',
    'صرف وتوزيع':'issues','تحويلات':'transfers','تلف وفقد':'adjustments?mode=damage_loss','تسويات':'adjustments?mode=adjustment'
  };
  for(const [label,route] of Object.entries(expected)){
    const {window,api}=boot();
    await api.load('receipts');
    const button=[...window.document.querySelectorAll('.warehouse-operations-nav [data-wh-route]')].find(node=>node.textContent===label);
    assert.ok(button,label);
    button.click();
    assert.equal(window.location.hash,'#/warehouse/'+route,label);
  }
  const {window,api}=boot();
  await api.load('receipts');
  const returns=[...window.document.querySelectorAll('.warehouse-operations-nav [aria-disabled="true"]')].find(node=>node.textContent==='مرتجعات');
  assert.ok(returns);
  assert.equal(returns.tagName,'SPAN');
});

test('runtime exposes one global authority and workspace contains no local legacy renderers',()=>{
  const {window}=boot();
  assert.ok(Object.isFrozen(window.WarehouseRemainingOperations));
  assert.deepEqual(Object.keys(window.WarehouseRemainingOperations).sort(),['adjustments','approvals','balances','getAdjustmentMode','history','reports','setAdjustmentMode','transfers']);
  const source=fs.readFileSync('js/warehouse/workspace.js','utf8');
  assert.doesNotMatch(source,/function approvals\(\)/);
  assert.doesNotMatch(source,/function scoped\(/);
  assert.doesNotMatch(source,/function reports\(\)/);
  assert.doesNotMatch(source,/WAREHOUSE_UI_BACKEND_GAP/);
  assert.match(source,/WAREHOUSE_REMAINING_OPERATIONS_UNAVAILABLE/);
});
