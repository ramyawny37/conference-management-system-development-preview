'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const integration=fs.readFileSync('js/platform-integration.js','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260912192000_platform_module_entry_access_gate.sql','utf8');
const script=fs.readFileSync('script.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');
const reservationsBundle=fs.readFileSync('modules/reservations/reservations-module.js','utf8');

function runtime(initialRoute,denyModule){
  let route=initialRoute;
  const calls=[];
  const listeners={};
  const classes=new Set();
  const elements={startupScreen:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},warehouseWorkspace:{},reservationsWorkspace:{}};
  const window={document:{addEventListener(){},getElementById:id=>elements[id]||null},ApplicationRouting:{getLogicalPathname:()=>route,resolveLogicalRoute:value=>'#'+value},history:{pushState(_s,_t,value){calls.push(['push',value]);route=value.slice(1);},replaceState(_s,_t,value){calls.push(['replace',value]);route=value.slice(1);}},addEventListener(name,handler){listeners[name]=handler;},showPlatformModules(){calls.push(['launcher']);},showToast(message){calls.push(['toast',message]);},openConferenceWorkspace(){calls.push(['conference']);return true;},reconcileConferenceRoute(){calls.push(['conference-route']);return true;},openWarehouseWorkspace(){calls.push(['warehouse-mount']);return true;},PlatformDeviceSession:{invokeModuleProtected(module,operation,args){calls.push(['check',module,operation,args]);return module===denyModule?Promise.reject({code:'MODULE_PERMISSION_REQUIRED'}):Promise.resolve({status:'allowed',moduleKey:module});}}};
  vm.runInNewContext(integration,{window,Promise,Object,JSON,String,Error});
  window.PlatformIntegration.registerModule({id:'reservations',mount(){calls.push(['reservations-mount']);return true;}});
  return {window,calls,classes,getRoute:()=>route};
}

for(const moduleId of ['warehouse','reservations']){
  test(moduleId+' card checks access before route push and mount',async()=>{
    const state=runtime('/');
    assert.equal(await state.window.PlatformIntegration.openModule(moduleId),true);
    assert.deepEqual(state.calls.slice(0,3).map(call=>call[0]),['check','push',moduleId+'-mount']);
  });
  test('denied '+moduleId+' card stays on launcher and never mounts',async()=>{
    const state=runtime('/',moduleId);
    assert.equal(await state.window.PlatformIntegration.openModule(moduleId),false);
    assert.equal(state.calls.some(call=>call[0]===moduleId+'-mount'),false);
    assert.equal(state.getRoute(),'/');
    assert.equal(state.calls.some(call=>call[0]==='launcher'),true);
  });
  test('direct '+moduleId+' route checks access before mount',async()=>{
    const state=runtime('/'+moduleId);
    assert.equal(await state.window.PlatformIntegration.reconcileRoute(),true);
    assert.deepEqual(state.calls.slice(0,2).map(call=>call[0]),['check',moduleId+'-mount']);
  });
}

test('Conference entry remains outside the generic module access gate',()=>{
  const state=runtime('/');
  assert.equal(state.window.PlatformIntegration.openModule('conference'),true);
  assert.equal(state.calls.some(call=>call[0]==='check'),false);
});

test('shared gate deduplicates concurrent checks and stale protected entry cannot replace Conference',async()=>{
  assert.match(integration,/if\(entryFlights\[id\]\)return entryFlights\[id\]/);
  let resolveAccess;
  const state=runtime('/');
  let checks=0;
  state.window.PlatformDeviceSession.invokeModuleProtected=(module)=>{checks+=1;return new Promise(resolve=>{resolveAccess=()=>resolve({status:'allowed',moduleKey:module});});};
  const first=state.window.PlatformIntegration.openModule('warehouse');
  const second=state.window.PlatformIntegration.openModule('warehouse');
  assert.equal(checks,1);
  assert.equal(state.window.PlatformIntegration.openModule('conference'),true);
  resolveAccess();
  assert.equal(await first,false);
  assert.equal(await second,false);
  assert.equal(state.calls.some(call=>call[0]==='warehouse-mount'),false);
});

test('Edge exposes check_module_access only for Warehouse and Reservations',()=>{
  assert.match(edge,/warehouse\.add\('check_module_access'\)/);
  assert.match(edge,/reservations\.add\('check_module_access'\)/);
  assert.doesNotMatch(edge,/conference\.add\('check_module_access'\)/);
  assert.match(edge,/MODULE_PERMISSION_REQUIRED/);
});

test('dispatcher delegates other operations and authorizes with the verified session device',()=>{
  assert.match(migration,/rename to execute_device_operation_pre_module_entry_access_gate/);
  assert.match(migration,/if p_module not in \('warehouse','reservations'\) or p_operation<>'check_module_access'[\s\S]*return platform\.execute_device_operation_pre_module_entry_access_gate/);
  assert.match(migration,/require_exact_jsonb_keys\(p_args,array\[\]::text\[\]\)/);
  assert.match(migration,/public\.require_module_permission\(verified_session\.device_id,p_module,'module\.access',null,null\)/);
  assert.match(migration,/from public,anon,authenticated,service_role[\s\S]*to postgres/);
});

test('route restores use PlatformIntegration and deterministic assets remain aligned',()=>{
  assert.doesNotMatch(script,/platformRoute\.indexOf\('\/warehouse'\)[\s\S]{0,180}openWarehouseWorkspace/);
  assert.match(index,/js\/platform-integration\.js\?rev=module-entry-access-gate-v1/);
  assert.match(worker,/\.\/js\/platform-integration\.js\?rev=module-entry-access-gate-v1/);
  assert.match(index,/script\.js\?rev=platform-module-entry-gate-v1/);
  assert.match(worker,/\.\/script\.js\?rev=platform-module-entry-gate-v1/);
  assert.match(index,/reservations-module\.js\?rev=mountable-bundle-v6/);
  assert.doesNotMatch(reservationsBundle,/check_module_access/);
});
