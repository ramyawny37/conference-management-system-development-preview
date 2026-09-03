'use strict';

const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const gateSource=fs.readFileSync('js/sync/startup-access-gate.js','utf8');
const integrationSource=fs.readFileSync('js/platform-integration.js','utf8');
const conferenceRoutes=['/conference','/conference/app/accommodation',
  '/conference/app/transportation','/conference/app/accounts',
  '/conference/app/reports','/conference/app/cards','/conference/app/search',
  '/conference/app/settings'];

function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}

function runtime(initialRoute,holdPipeline){
  let route=initialRoute;
  const calls=[];
  const listeners={};
  const ids=['startupAccessGate','applicationTopbar','applicationBody',
    'startupScreen','globalConferenceHeader',
    'device_authorization_administration_root','tab0','tab1','tab2','tab3',
    'tab4','tab5','tab6'];
  const nodes={};
  ids.forEach(id=>{nodes[id]={style:{display:id==='startupAccessGate'
    ?'flex':'none'},innerHTML:''};});
  const window={document:{getElementById:id=>nodes[id],addEventListener(){}},
    addEventListener(name,handler){listeners[name]=handler;},
    ApplicationRouting:{getLogicalPathname:()=>route,
      resolveLogicalRoute:value=>'#'+value},
    history:{pushState(_state,_title,value){route=value.slice(1);}},
    SupabaseAuth:{initialize:()=>Promise.resolve(),
      getState:()=>({authenticated:true,user:{id:'approved-user'}})},
    SupabaseClientLayer:{getClient:()=>({auth:{onAuthStateChange:()=>
      ({data:{subscription:{}}})}})},
    FirstSystemBootstrapService:{getStatus:()=>
      Promise.resolve({ok:true,status:'completed'})},
    SystemAccessService:{initialize:()=>Promise.resolve(),
      refresh:()=>Promise.resolve(),getState:()=>
      ({accountStatus:'approved',fresh:true})},
    CurrentDeviceAuthorizationUI:{initialize:()=>Promise.resolve(),
      refresh:()=>Promise.resolve(),getState:()=>({status:'approved'})},
    reconcileConferenceRoute(){calls.push(['premature-conference',route]);},
    openWarehouseWorkspace(options){calls.push(['premature-warehouse',options.route]);},
    showPlatformModules(){calls.push(['premature-platform',route]);}};
  const context={window,Promise,Date,Error,Object,JSON,String,
    setTimeout:()=>0,clearTimeout(){}};
  vm.runInNewContext(gateSource,context);
  vm.runInNewContext(integrationSource,context);
  const pipeline=holdPipeline?deferred():null;
  const run=window.StartupAccessGate.run({completeApplicationStartup(){
    calls.push(['restore',route]);
    const render=()=>{
      if(route.indexOf('/conference/app/')===0){
        nodes.applicationBody.style.display='block';
      }else{
        nodes.startupScreen.style.display='flex';
      }
    };
    if(!pipeline){render();return true;}
    return pipeline.promise.then(()=>{calls.push(['restore-latest',route]);render();});
  }});
  return {window,nodes,calls,listeners,run,pipeline,
    setRoute:value=>{route=value;}};
}

for(const route of conferenceRoutes){
  test('cold refresh restores '+route+' only after authorization startup',async()=>{
    const state=runtime(route);
    const result=await state.run;
    assert.strictEqual(result.status,'allowed');
    assert.deepStrictEqual(state.calls,[['restore',route]]);
    assert.strictEqual(state.window.StartupAccessGate.getState().pipelineState,
      'completed');
    assert.strictEqual(state.window.StartupAccessGate.getState().applicationVisible,
      true);
  });
}

test('Warehouse cold refresh waits for the authoritative startup restore',async()=>{
  const state=runtime('/warehouse/approvals');
  assert.strictEqual((await state.run).status,'allowed');
  assert.deepStrictEqual(state.calls,[['restore','/warehouse/approvals']]);
});

test('rapid startup hash changes restore only the latest route',async()=>{
  const state=runtime('/conference/app/accommodation',true);
  await new Promise(resolve=>setImmediate(resolve));
  state.setRoute('/conference/app/settings');
  state.listeners.hashchange();
  state.pipeline.resolve();
  assert.strictEqual((await state.run).status,'allowed');
  assert.deepStrictEqual(state.calls,[
    ['restore','/conference/app/accommodation'],
    ['restore-latest','/conference/app/settings']
  ]);
  assert.deepStrictEqual(Object.keys(state.listeners),['hashchange']);
});
