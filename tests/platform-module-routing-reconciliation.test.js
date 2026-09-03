const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const integrationSource=fs.readFileSync('js/platform-integration.js','utf8');
const warehouseSource=fs.readFileSync('js/warehouse/workspace.js','utf8');
const html=fs.readFileSync('index.html','utf8');

function classList(){
  const values=new Set();
  return {values,add(...names){names.forEach(name=>values.add(name));},
    remove(...names){names.forEach(name=>values.delete(name));}};
}

function integrationRuntime(initialRoute){
  let route=initialRoute;
  const calls=[];
  const listeners={};
  const window={document:{addEventListener(){}},ApplicationRouting:{
    getLogicalPathname:()=>route,resolveLogicalRoute:value=>'/preview/#'+value
  },history:{pushState(_state,_title,value){calls.push(['push',value]);route=value.split('#')[1];}},
  addEventListener(name,handler){listeners[name]=handler;},
  showHomePage(){calls.push(['conference']);},showPlatformModules(){calls.push(['platform']);},
  openConferenceWorkspace(){calls.push(['conference-open']);},
  openWarehouseWorkspace(options){calls.push(['warehouse',options.route]);}};
  vm.runInNewContext(integrationSource,{window,Promise,Object,JSON,String});
  return {window,calls,listeners,setRoute:value=>{route=value;}};
}

test('module cards use static-safe hash routes and open peer modules',()=>{
  const state=integrationRuntime('/');
  assert.strictEqual(state.window.PlatformIntegration.openModule('conference'),true);
  assert.deepStrictEqual(state.calls,[['push','/preview/#/conference'],['conference-open']]);
  state.calls.length=0;
  state.setRoute('/');
  assert.strictEqual(state.window.PlatformIntegration.openModule('warehouse'),true);
  assert.deepStrictEqual(state.calls,[['push','/preview/#/warehouse'],['warehouse',undefined]]);
  assert.doesNotMatch(integrationSource,/location\.(?:assign|replace)|href\s*=\s*['"]\/(?:conference|warehouse)/);
});

test('one hash listener owns Back and Forward reconciliation',()=>{
  const state=integrationRuntime('/conference');
  assert.deepStrictEqual(Object.keys(state.listeners),['hashchange']);
  state.listeners.hashchange();
  assert.deepStrictEqual(state.calls,[['conference']]);
  state.calls.length=0;
  state.setRoute('/warehouse/approvals');
  state.listeners.hashchange();
  assert.deepStrictEqual(state.calls,[['warehouse','/warehouse/approvals']]);
  state.calls.length=0;
  state.setRoute('/');
  state.listeners.hashchange();
  assert.deepStrictEqual(state.calls,[['platform']]);
});

function warehouseRuntime(route){
  const shellClasses=classList();
  const buttons=[];
  const shell={classList:shellClasses};
  const node={innerHTML:'',querySelectorAll(){return buttons;}};
  const window={document:{getElementById:id=>id==='startupScreen'?shell:id==='warehouseWorkspace'?node:null},
    ApplicationRouting:{getLogicalPathname:()=>route,resolveLogicalRoute:value=>'/preview/#'+value},
    history:{pushState(){}},WarehouseTransport:{invoke:()=>new Promise(()=>{})}};
  vm.runInNewContext(warehouseSource,{window,Promise,Array,String});
  return {window,node,shellClasses};
}

for(const section of ['stores','documents','items','stock','approvals']){
  test(`#/warehouse/${section} opens the ${section} workspace`,()=>{
    const state=warehouseRuntime('/warehouse/'+section);
    state.window.openWarehouseWorkspace({route:'/warehouse/'+section});
    assert.strictEqual(state.shellClasses.values.has('platform-warehouse-active'),true);
    assert.strictEqual(state.shellClasses.values.has('platform-conference-active'),false);
    assert.match(state.node.innerHTML,new RegExp('data-warehouse-route="'+section+'"'));
    assert.match(state.node.innerHTML,new RegExp('btn btn-blue[^>]+data-warehouse-route="'+section+'"'));
  });
}

test('#/warehouse defaults to stores and launcher is structurally separate',()=>{
  const state=warehouseRuntime('/warehouse');
  state.window.openWarehouseWorkspace({route:'/warehouse'});
  assert.match(state.node.innerHTML,/btn btn-blue[^>]+data-warehouse-route="stores"/);
  assert.match(html,/<main class="platform-home"[\s\S]*?<\/main>[\s\S]*?id="conferenceWorkspace"[\s\S]*?id="warehouseWorkspace"/);
  assert.doesNotMatch(html,/id="warehouseWorkspace"[^>]+style="display:none"/);
});
