'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const integrationSource=fs.readFileSync('js/platform-integration.js','utf8');

function runtime(initialRoute){
  let route=initialRoute;
  const calls=[];
  const timers=[];
  const gateState={pipelineState:'idle',applicationVisible:false,gateState:'loading',allowed:false};
  const shellClasses=new Set();
  const elements={
    startupScreen:{classList:{add:value=>shellClasses.add(value),remove:value=>shellClasses.delete(value)}},
    reservationsWorkspace:{id:'reservationsWorkspace'},
    warehouseWorkspace:{id:'warehouseWorkspace'},
    conferenceWorkspace:{id:'conferenceWorkspace'}
  };
  const window={
    document:{addEventListener(){},getElementById:id=>elements[id]||null},
    ApplicationRouting:{
      getLogicalPathname:()=>route,
      resolveLogicalRoute:value=>'/preview/#'+value
    },
    history:{
      pushState(_state,_title,value){calls.push(['push',value]);route=value.split('#')[1]||'/';},
      replaceState(_state,_title,value){calls.push(['replace',value]);route=value.split('#')[1]||'/';}
    },
    addEventListener(){},
    setTimeout(handler){timers.push(handler);return timers.length;},
    clearTimeout(){},
    StartupAccessGate:{getState:()=>gateState,isAllowed:()=>gateState.allowed},
    PlatformDeviceSession:{invokeModuleProtected(module,operation,args){calls.push(['protected',module,operation,args]);return Promise.resolve({status:'allowed',moduleKey:module});}},
    reconcileConferenceRoute(){calls.push(['conference-route']);return true;},
    openWarehouseWorkspace(){calls.push(['warehouse']);return true;},
    showPlatformModules(){calls.push(['platform']);return true;}
  };
  vm.runInNewContext(integrationSource,{window,Promise,Object,JSON,String,Error});
  window.PlatformIntegration.registerModule({
    id:'reservations',
    mount(context){calls.push(['reservations-mount',context.route]);return true;},
    reconcileRoute(context){calls.push(['reservations-route',context.route]);return true;}
  });
  return {
    window,calls,timers,gateState,
    getRoute:()=>route,
    setRoute:value=>{route=value;},
    runNextTimer(){const handler=timers.shift();if(handler)handler();}
  };
}

test('Reservations refresh survives a delayed Conference startup route override',async()=>{
  const state=runtime('/reservations/bookings/new');
  state.window.PlatformIntegration.initialize();
  assert.equal(state.timers.length,1);
  assert.deepEqual(state.calls,[]);

  state.setRoute('/conference');
  state.gateState.pipelineState='completed';
  state.gateState.applicationVisible=true;
  state.gateState.gateState='allowed';
  state.gateState.allowed=true;

  state.runNextTimer();
  await new Promise(resolve=>setImmediate(resolve));

  assert.equal(state.getRoute(),'/reservations/bookings/new');
  assert.deepEqual(state.calls.map(call=>call.slice(0,3)),[
    ['replace','/preview/#/reservations/bookings/new'],
    ['protected','reservations','check_module_access'],
    ['reservations-mount','/reservations/bookings/new']
  ]);
  assert.equal(state.timers.length,0);
});

test('Reservations route is captured before Conference can overwrite it ahead of initialize',async()=>{
  const state=runtime('/reservations/bookings/new');

  // platform-integration.js has already loaded and must capture the browser route now.
  // Legacy Conference startup then overwrites the hash before initialize() is called.
  state.setRoute('/conference');
  state.gateState.pipelineState='completed';
  state.gateState.applicationVisible=true;
  state.gateState.gateState='allowed';
  state.gateState.allowed=true;

  state.window.PlatformIntegration.initialize();
  await new Promise(resolve=>setImmediate(resolve));

  assert.equal(state.getRoute(),'/reservations/bookings/new');
  assert.deepEqual(state.calls.map(call=>call.slice(0,3)),[
    ['replace','/preview/#/reservations/bookings/new'],
    ['protected','reservations','check_module_access'],
    ['reservations-mount','/reservations/bookings/new']
  ]);
});

test('an explicit peer-module route wins over a stale captured startup route',()=>{
  const state=runtime('/reservations/bookings/new');
  state.window.PlatformIntegration.initialize();
  state.setRoute('/warehouse/approvals');
  state.gateState.pipelineState='completed';
  state.gateState.applicationVisible=true;
  state.gateState.gateState='allowed';
  state.gateState.allowed=true;
  state.runNextTimer();
  assert.equal(state.getRoute(),'/warehouse/approvals');
  assert.equal(state.calls.some(call=>call[0]==='replace'),false);
});
