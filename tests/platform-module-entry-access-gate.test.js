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
const reservationsRevision='reservations-person-live-0d9db39-v1';

function runtime(initialRoute,denyModule){
  let route=initialRoute;
  const calls=[];
  const listeners={};
  const classes=new Set();
  const elements={startupScreen:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},warehouseWorkspace:{},reservationsWorkspace:{}};
  const window={document:{addEventListener(name,handler){listeners[name]=handler;},getElementById:id=>elements[id]||null},ApplicationRouting:{getLogicalPathname:()=>route,resolveLogicalRoute:value=>'#'+value,resolveConferenceTabRoute:id=>'/conference/app/'+['accommodation','transportation','accounts','reports','cards','search','settings'][id],resolveConferenceSettingsRoute:()=>'/conference/app/settings/houses'},history:{pushState(_s,_t,value){calls.push(['push',value]);route=value.slice(1);},replaceState(_s,_t,value){calls.push(['replace',value]);route=value.slice(1);}},addEventListener(name,handler){listeners[name]=handler;},showPlatformModules(){calls.push(['launcher']);},showToast(message){calls.push(['toast',message]);},openConferenceWorkspace(){calls.push(['conference']);return true;},reconcileConferenceRoute(){calls.push(['conference-route']);return true;},openWarehouseWorkspace(){calls.push(['warehouse-mount']);return true;},PlatformDeviceSession:{invokeModuleProtected(module,operation,args){calls.push(['check',module,operation,args]);return module===denyModule?Promise.reject({code:'MODULE_PERMISSION_REQUIRED'}):Promise.resolve({status:'allowed',moduleKey:module});}}};
  vm.runInNewContext(integration,{window,Promise,Object,JSON,String,Error});
  window.PlatformIntegration.registerModule({id:'reservations',mount(){calls.push(['reservations-mount']);return true;}});
  return {window,calls,classes,listeners,getRoute:()=>route};
}

for(const moduleId of ['conference','warehouse','reservations']){
  test(moduleId+' card checks access before route push and mount',async()=>{
    const state=runtime('/');
    assert.equal(await state.window.PlatformIntegration.openModule(moduleId),true);
    assert.deepEqual(state.calls.slice(0,3).map(call=>call[0]),['check','push',moduleId==='conference'?'conference':moduleId+'-mount']);
  });
  test('denied '+moduleId+' navigation preserves the current route and never mounts',async()=>{
    const state=runtime('/conference',moduleId);
    assert.equal(await state.window.PlatformIntegration.openModule(moduleId),false);
    assert.equal(state.calls.some(call=>call[0]===moduleId+'-mount'),false);
    assert.equal(state.getRoute(),'/conference');
    assert.equal(state.calls.some(call=>call[0]==='launcher'),false);
  });
  test('direct '+moduleId+' route checks access before mount',async()=>{
    const state=runtime('/'+moduleId);
    assert.equal(await state.window.PlatformIntegration.reconcileRoute(),true);
    assert.deepEqual(state.calls.slice(0,2).map(call=>call[0]),['check',moduleId==='conference'?'conference-route':moduleId+'-mount']);
  });
}

test('shared gate deduplicates concurrent checks',async()=>{
  assert.match(integration,/if\(entryFlights\[id\]\)return entryFlights\[id\]/);
  let resolveAccess;
  const state=runtime('/');
  let checks=0;
  state.window.PlatformDeviceSession.invokeModuleProtected=(module)=>{checks+=1;return new Promise(resolve=>{resolveAccess=()=>resolve({status:'allowed',moduleKey:module});});};
  const first=state.window.PlatformIntegration.openModule('warehouse');
  const second=state.window.PlatformIntegration.openModule('warehouse');
  assert.equal(checks,1);
  resolveAccess();
  assert.equal(await first,false);
  assert.equal(await second,true);
  assert.equal(state.calls.filter(call=>call[0]==='warehouse-mount').length,1);
});

test('active Conference subnav navigates immediately without another access check',async()=>{
  const state=runtime('/conference');
  await state.window.PlatformIntegration.reconcileRoute();
  state.calls.length=0;
  const item={getAttribute:name=>name==='data-conference-tab'?'0':'',closest:selector=>selector==='[data-conference-tab]'?item:null};
  state.listeners.click({target:item});
  assert.deepEqual(state.calls,[['push','#/conference/app/accommodation'],['conference-route']]);
  assert.equal(state.getRoute(),'/conference/app/accommodation');
});

test('Edge exposes check_module_access for every protected module',()=>{
  assert.match(edge,/warehouse\.add\('check_module_access'\)/);
  assert.match(edge,/reservations\.add\('check_module_access'\)/);
  assert.match(edge,/conference\.add\('check_module_access'\)/);
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
  assert.match(index,/js\/platform-integration\.js\?rev=conference-canonical-hydration-v1/);
  assert.match(worker,/\.\/js\/platform-integration\.js\?rev=conference-canonical-hydration-v1/);
  assert.match(index,/script\.js\?rev=conference-tab-render-lifecycle-v1/);
  assert.match(worker,/\.\/script\.js\?rev=conference-tab-render-lifecycle-v1/);
  for(const asset of ['reservations-module.js','reservations-module.css']){
    const reference=`modules/reservations/${asset}?rev=${reservationsRevision}`;
    assert.ok(index.includes(reference),`index missing ${reference}`);
    assert.ok(worker.includes(`./${reference}`),`service worker missing ${reference}`);
  }
  assert.doesNotMatch(reservationsBundle,/check_module_access/);
});
