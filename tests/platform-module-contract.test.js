const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const source=fs.readFileSync('js/platform-integration.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

function runtime(initialRoute='/'){
  let route=initialRoute;
  const calls=[];
  const listeners={};
  const classes=new Set();
  const elements={startupScreen:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},conferenceWorkspace:{},warehouseWorkspace:{},reservationsWorkspace:{id:'reservationsWorkspace'}};
  const window={
    document:{addEventListener(){},getElementById:id=>elements[id]||null},
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
  return {window,calls,listeners,classes,elements,setRoute:value=>{route=value;}};
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
      lifecycle.push(['mount',context.route,context.explicitModuleEntry,context.container&&context.container.id]);
      return context.services.invokeProtected('reservations','list_conference_options',{}).then(()=>true);
    },
    reconcileRoute(context){lifecycle.push(['route',context.route]);return true;},
    unmount(context){lifecycle.push(['unmount',context.nextModuleId]);},
  });

  assert.strictEqual(state.window.PlatformIntegration.openModule('reservations'),true);
  await Promise.resolve();
  assert.strictEqual(state.window.PlatformIntegration.getActiveModuleId(),'reservations');
  assert.deepStrictEqual(lifecycle[0],['mount','/reservations',true,'reservationsWorkspace']);
  assert.strictEqual(state.classes.has('platform-reservations-active'),true);
  assert.deepStrictEqual(state.calls[0],['push','/preview/#/reservations']);
  assert.deepStrictEqual(state.calls[1],['protected','reservations','list_conference_options',{}]);

  state.setRoute('/reservations/reports');
  state.listeners.hashchange();
  assert.deepStrictEqual(lifecycle[1],['route','/reservations/reports']);

  state.setRoute('/warehouse');
  state.listeners.hashchange();
  assert.deepStrictEqual(lifecycle[2],['unmount','warehouse']);
  assert.strictEqual(state.window.PlatformIntegration.getActiveModuleId(),'warehouse');
  assert.strictEqual(state.classes.has('platform-reservations-active'),false);
});

test('platform owns module Conference context and clears it on logout',async()=>{
  const state=runtime('/');
  const services=state.window.PlatformIntegration.getModuleServices();
  assert.strictEqual(services.getSelectedConferenceId(),'');
  assert.strictEqual(services.setSelectedConferenceId('conference-a'),'conference-a');
  assert.strictEqual(services.getSelectedConferenceId(),'conference-a');
  await state.window.PlatformIntegration.logout();
  assert.strictEqual(services.getSelectedConferenceId(),'');
});

test('unknown modules fail closed and cannot be opened',()=>{
  const state=runtime('/');
  assert.strictEqual(state.window.PlatformIntegration.openModule('unknown'),false);
  assert.strictEqual(state.window.PlatformIntegration.getActiveModuleId(),'');
});

test('Reservations launcher and static bundle stay inside the unified Platform artifact',()=>{
  assert.match(index,/data-platform-module="reservations" class="platform-module-card platform-module-card-available"/);
  assert.match(index,/id="reservationsWorkspace"/);
  assert.match(index,/modules\/reservations\/reservations-module\.js\?rev=mountable-bundle-v3/);
  assert.match(index,/modules\/reservations\/reservations-module\.css\?rev=mountable-bundle-v3/);
  assert.match(worker,/\.\/modules\/reservations\/reservations-module\.js\?rev=mountable-bundle-v3/);
  assert.match(worker,/\.\/modules\/reservations\/reservations-module\.css\?rev=mountable-bundle-v3/);
  assert.ok(fs.existsSync('modules/reservations/reservations-module.js'));
  assert.ok(fs.existsSync('modules/reservations/reservations-module.css'));
  assert.doesNotMatch(fs.readFileSync('modules/reservations/reservations-module.js','utf8'),/supabase\.co|createClient\(|platform-device-session/);
});
