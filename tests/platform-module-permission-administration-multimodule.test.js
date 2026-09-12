'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const serviceSource=fs.readFileSync('js/sync/module-permission-administration-service.js','utf8');
const uiSource=fs.readFileSync('js/sync/module-permission-administration-ui.js','utf8');

function serviceRuntime(){
  const protectedCalls=[];
  const warehouseCalls=[];
  const sandbox={window:{
    crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    PlatformDeviceSession:{invokeProtected:(operation,args)=>{
      protectedCalls.push({operation,args});
      if(operation==='get_user_management_actor_capabilities')return Promise.resolve({status:'success',canManageAccount:true});
      if(operation==='list_module_permission_catalog_for_administration')return Promise.resolve([]);
      if(operation==='search_module_permission_candidates')return Promise.resolve([]);
      if(operation==='list_module_permission_grants')return Promise.resolve({status:'success',targetUserId:args.p_target_user_id,grants:[]});
      return Promise.resolve({grantId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
    }},
    WarehouseTransport:{invoke:(operation,args)=>{warehouseCalls.push({operation,args});return Promise.resolve([]);}}
  }};
  vm.runInNewContext(serviceSource,sandbox);
  return {api:sandbox.window.ModulePermissionAdministrationService,protectedCalls,warehouseCalls};
}

test('Warehouse and Reservations are the only selectable modules',()=>{
  const runtime=serviceRuntime();
  assert.deepEqual(Array.from(runtime.api.MODULE_KEYS),['warehouse','reservations']);
  assert.equal(runtime.api.isSupportedModule('warehouse'),true);
  assert.equal(runtime.api.isSupportedModule('reservations'),true);
  assert.equal(runtime.api.isSupportedModule('conference'),false);
});

test('selected module is forwarded to every generic administration operation',async()=>{
  const runtime=serviceRuntime();
  const user='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await runtime.api.probeAvailability('reservations');
  await runtime.api.searchCandidates('reservations','test');
  await runtime.api.listCatalog('reservations');
  await runtime.api.listGrants('reservations',user);
  await runtime.api.foundationMutation('reservations',{action:'grant',targetUserId:user,permissionKey:'module.access'});
  await runtime.api.catalogMutation('reservations',{action:'grant',targetUserId:user,permissionKey:'reservations.booking.view'});
  for(const call of runtime.protectedCalls.filter((item)=>item.operation!=='get_user_management_actor_capabilities'))assert.equal(call.args.p_module_key,'reservations');
});

test('business keys are exact-module only and cross-module requests fail closed',async()=>{
  const runtime=serviceRuntime();
  const user='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  assert.equal((await runtime.api.catalogMutation('warehouse',{action:'grant',targetUserId:user,permissionKey:'warehouse.store.view'})).ok,true);
  assert.equal((await runtime.api.catalogMutation('reservations',{action:'grant',targetUserId:user,permissionKey:'reservations.booking.view'})).ok,true);
  assert.equal((await runtime.api.catalogMutation('warehouse',{action:'grant',targetUserId:user,permissionKey:'reservations.booking.view'})).status,'invalid_input');
  assert.equal((await runtime.api.catalogMutation('reservations',{action:'grant',targetUserId:user,permissionKey:'warehouse.store.view'})).status,'invalid_input');
});

test('Store discovery is explicitly Warehouse-only',async()=>{
  const runtime=serviceRuntime();
  assert.equal((await runtime.api.listStores('reservations')).status,'invalid_input');
  assert.equal(runtime.warehouseCalls.length,0);
  assert.equal((await runtime.api.listStores('warehouse')).ok,true);
  assert.equal(runtime.warehouseCalls.length,1);
});

test('UI is module-selectable, resets stale state, and keeps resource controls Warehouse-only',()=>{
  assert.match(uiSource,/data-module-permission-module="warehouse"/);
  assert.match(uiSource,/data-module-permission-module="reservations"/);
  assert.match(uiSource,/مخازن|المخازن/);
  assert.match(uiSource,/الحجوزات/);
  assert.match(uiSource,/function selectModule/);
  assert.match(uiSource,/selected:null[\s\S]*candidates:\[\][\s\S]*grants:\[\][\s\S]*catalog:\[\][\s\S]*stores:\[\]/);
  assert.match(uiSource,/state\.moduleKey==='warehouse'/);
  assert.doesNotMatch(uiSource,/Organization|organization|مؤسسة|مؤتمر|فعالية/);
});

test('Device Session protection and actor-device override denial remain intact',()=>{
  assert.match(serviceSource,/PlatformDeviceSession\.invokeProtected/);
  assert.match(serviceSource,/ACTOR_DEVICE_OVERRIDE_DENIED/);
  assert.doesNotMatch(serviceSource+uiSource,/\.rpc\s*\(|\.from\s*\(/);
});
