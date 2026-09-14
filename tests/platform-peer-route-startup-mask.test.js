'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const source=fs.readFileSync('js/platform-integration.js','utf8');

function runtime(route){
  const style={visibility:'',priority:'',setProperty(name,value,priority){if(name==='visibility'){this.visibility=value;this.priority=priority||'';}},removeProperty(name){if(name==='visibility'){this.visibility='';this.priority='';}}};
  const conferenceWorkspace={style};
  const startupScreen={classList:{add(){},remove(){}}};
  const window={
    document:{addEventListener(){},getElementById(id){if(id==='conferenceWorkspace')return conferenceWorkspace;if(id==='startupScreen')return startupScreen;if(id==='reservationsWorkspace')return {};return null;}},
    ApplicationRouting:{getLogicalPathname:()=>route,resolveLogicalRoute:value=>'#'+value},
    history:{replaceState(){},pushState(){}},
    addEventListener(){},
    StartupAccessGate:{getState(){return {pipelineState:'completed',applicationVisible:true,gateState:'allowed'};},isAllowed(){return true;}},
    PlatformDeviceSession:{invokeModuleProtected(module){return Promise.resolve({status:'allowed',moduleKey:module});}},
    reconcileConferenceRoute(){return true;},
    openWarehouseWorkspace(){return true;},
    showPlatformModules(){return true;}
  };
  vm.runInNewContext(source,{window,Promise,Object,JSON,String,Error});
  window.PlatformIntegration.registerModule({id:'reservations',mount(){return true;}});
  return {window,style};
}

test('peer route masks Conference immediately before startup can flash it',()=>{
  const state=runtime('/reservations');
  assert.equal(state.style.visibility,'hidden');
  assert.equal(state.style.priority,'important');
});

test('mask clears when Reservations activation completes',async()=>{
  const state=runtime('/reservations');
  await state.window.PlatformIntegration.initialize();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.style.visibility,'');
  assert.equal(state.window.PlatformIntegration.getActiveModuleId(),'reservations');
});

test('Conference route never receives the peer startup mask',()=>{
  const state=runtime('/conference');
  assert.equal(state.style.visibility,'');
});
