'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');

const source=fs.readFileSync('js/warehouse/current-store-context.js','utf8');
const workspace=fs.readFileSync('js/warehouse/workspace.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');
const USER_A='11111111-1111-4111-8111-111111111111';
const USER_B='22222222-2222-4222-8222-222222222222';
const DEVICE='33333333-3333-4333-8333-333333333333';
const STORE_A='44444444-4444-4444-8444-444444444444';
const STORE_B='55555555-5555-4555-8555-555555555555';

function memoryStorage(){const values={};return {values,getItem:key=>values[key]||null,setItem:(key,value)=>{values[key]=String(value);},removeItem:key=>{delete values[key];}};}
function environment(shared){let userId=USER_A;const window={JSON,Object,Array,String,Error,localStorage:shared,BrowserStorageNamespace:{key:name=>'cms:development:test:'+name},SupabaseAuth:{getAccountIdentity:()=>({authenticated:true,userId})},SupabaseDeviceIdentity:{getCurrent:()=>({id:DEVICE})}};window.window=window;vm.runInNewContext(source,window);return {api:window.WarehouseCurrentStoreContext,setUser:value=>{userId=value;}};}
const active=[{id:STORE_A,name:'المخزن الرئيسي',status:'active'},{id:STORE_B,name:'مخزن غير نشط',status:'inactive'}];

test('current Warehouse store begins empty and never selects the first store automatically',()=>{
  const env=environment(memoryStorage());
  assert.equal(env.api.getCurrentWarehouseStore(),null);
  assert.equal(env.api.validateCurrentWarehouseStore(active),null);
  assert.equal(env.api.getCurrentWarehouseStore(),null);
  assert.throws(()=>env.api.getCurrentWarehouseStoreId(),error=>error.code==='WAREHOUSE_CURRENT_STORE_REQUIRED'&&error.message==='يرجى اختيار المخزن الحالي أولًا.');
});

test('explicit active-store selection persists by account and device and returns the exact id',()=>{
  const storage=memoryStorage(),first=environment(storage);
  assert.equal(first.api.setCurrentWarehouseStore(STORE_A,active).ok,true);
  assert.equal(first.api.getCurrentWarehouseStoreId(),STORE_A);
  const reloaded=environment(storage);
  assert.equal(reloaded.api.validateCurrentWarehouseStore(active).id,STORE_A);
  assert.equal(reloaded.api.getCurrentWarehouseStoreId(),STORE_A);
  assert.match(reloaded.api.getStorageKey(),new RegExp(USER_A+':'+DEVICE+'$'));
});

test('inactive, missing, and account-switched selections are isolated and invalidated',()=>{
  const storage=memoryStorage(),env=environment(storage);
  assert.equal(env.api.setCurrentWarehouseStore(STORE_B,active).ok,false);
  assert.equal(env.api.setCurrentWarehouseStore(STORE_A,active).ok,true);
  env.setUser(USER_B);
  assert.equal(env.api.getCurrentWarehouseStore(),null);
  assert.equal(env.api.setCurrentWarehouseStore(STORE_A,active).ok,true);
  env.setUser(USER_A);
  assert.equal(env.api.getCurrentWarehouseStoreId(),STORE_A);
  assert.equal(env.api.validateCurrentWarehouseStore([{id:STORE_A,name:'قديم',status:'inactive'}]),null);
  assert.equal(env.api.getCurrentWarehouseStore(),null);
});

test('Warehouse shell validates only secure discovered active stores and exposes explicit selection',()=>{
  assert.match(workspace,/invoke\('discover_stores',\{p_include_inactive:false\}\)/);
  assert.match(workspace,/validateCurrentWarehouseStore\(state\.stores\)/);
  assert.match(workspace,/data-wh-current-store/);
  assert.match(workspace,/store\.status==='active'/);
  assert.match(workspace,/setCurrentWarehouseStore\(selector\.value,state\.stores\)/);
  assert.doesNotMatch(workspace,/setCurrentWarehouseStore\(state\.stores\[0\]/);
  assert.doesNotMatch(source,/\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(/);
});

test('Issue helper blocks without context while Receipt retains its explicit destination store',()=>{
  assert.match(source,/WAREHOUSE_CURRENT_STORE_REQUIRED/);
  assert.match(workspace,/if\(s==='receipts'\)\{payload\.destinationStoreId=d\.storeId/);
  assert.match(workspace,/field\(storeLabel,'<select name="storeId" required>/);
  assert.ok(index.indexOf('js/warehouse/current-store-context.js')<index.indexOf('js/warehouse/workspace.js'));
  assert.match(index,/style\.css\?rev=warehouse-current-store-context-v1/);
  assert.match(worker,/\.\/style\.css\?rev=warehouse-current-store-context-v1/);
  assert.match(worker,/\.\/js\/warehouse\/current-store-context\.js\?rev=warehouse-current-store-context-v1/);
});
