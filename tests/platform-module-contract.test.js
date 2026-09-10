const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const source=fs.readFileSync('js/platform-integration.js','utf8');

function runtime(initialRoute='/'){
  let route=initialRoute;
  const calls=[];
  const listeners={};
  const window={
    document:{addEventListener(){}},
    ApplicationRouting:{
      getLogicalPathname:()=>route,
      resolveLogicalRoute:value=>'/preview/#'+value,
    },
    history:{
      pushState(_state,_title,value){calls.push(['push',value]);route=value.split('#')[1];},
      replaceState(_state,_title,value){calls.push(['replace',value]);route=value.split('#')[1];},
    },
    addEventListener(name,handler){listeners[name]=handler;},
    openConferenceWorkspace(){calls.push(['conference-open']);return true;},
    reconcileConferenceRoute(){calls.push(['conference-route',route]);return true;},
    openWarehouseWorkspace(options){calls.push(['warehouse',options]);return true;},
    showPlatformModules(){calls.push(['modules']);return true;},
    SupabaseAuth:{getAccountIdentity:()=>({authenticated:true,userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})},
    PlatformDeviceSession:{invokeModuleProtected:(module,operation,args)=>{calls.push(['protected',module,operation,args]);return Promise.resolve({ok:true});}},
    SyncSettingsUI:{signOut:()=>Promise.resolve(true)},
  };
  vm.runInNewContext(source,{window,Promise,Object,JSON,String,Error});
  return {window,calls,listeners,setRoute:value=>{route=value;}};
}

test('built-in modules remain registered and open through the common contract',()=>{
  const state=runtime('/');
  assert.deepStrictEqual(Array.from(state.window.PlatformIntegration.getRegisteredModules()),['conference','warehouse']);
  assert.strictEqual(state.window.PlatformIntegration.openModule('conference'),true);
  assert.strictEqual(state.window.PlatformIntegration.getActiveModuleId(),'conference');
  state.setRoute('/');
  assert.strictEqual(state.window.PlatformIntegration.openModule('warehouse'),true);
  assert.strictEqual(state.window.PlatformIntegration.getActiveModuleId(),'warehouse');
});

test('a feature module can mount, reconcile routes, and unmount without owning platform auth or device session',async()=>{
  const state=runtime('/');
  const lifecycle=[];
  state.window.PlatformIntegration.registerModule({
    id:'reservations',
    mount(context){
      lifecycle.push(['mount',context.route,context.explicitModuleEntry]);
      return context.services.invokeProtected('reservations','list_conference_options',{}).then(()=>true);
    },
    reconcileRoute(context){lifecycle.push(['route',context.route]);return true;},
    unmount(context){lifecycle.push(['unmount',context.nextModuleId]);},
  });

  assert.strictEqual(state.window.PlatformIntegration.openModule('reservations'),true);
  await Promise.resolve();
  assert.strictEqual(state.window.PlatformIntegration.getActiveModuleId(),'reservations');
  assert.deepStrictEqual(state.calls[0],['push','/preview/#/reservations']);
  assert.deepStrictEqual(state.calls[1],['protected','reservations','list_conference_options',{}]);

  state.setRoute('/reservations/reports');
  state.listeners.hashchange();
  assert.deepStrictEqual(lifecycle[1],['route','/reservations/reports']);

  state.setRoute('/warehouse');
  state.listeners.hashchange();
  assert.deepStrictEqual(lifecycle[2],['unmount','warehouse']);
  assert.strictEqual(state.window.PlatformIntegration.getActiveModuleId(),'warehouse');
});

test('unknown modules fail closed and cannot be opened',()=>{
  const state=runtime('/');
  assert.strictEqual(state.window.PlatformIntegration.openModule('unknown'),false);
  assert.strictEqual(state.window.PlatformIntegration.getActiveModuleId(),'');
});
