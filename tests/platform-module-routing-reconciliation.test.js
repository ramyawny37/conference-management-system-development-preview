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
  const shellClasses=classList();
  const elements={
    startupScreen:{classList:shellClasses},
    conferenceWorkspace:{id:'conferenceWorkspace'},
    warehouseWorkspace:{id:'warehouseWorkspace'},
    reservationsWorkspace:{id:'reservationsWorkspace'}
  };
  const window={document:{addEventListener(){},getElementById:id=>elements[id]||null},ApplicationRouting:{
    getLogicalPathname:()=>route,resolveLogicalRoute:value=>'/preview/#'+value
  },history:{pushState(_state,_title,value){calls.push(['push',value]);route=value.split('#')[1];}},
  addEventListener(name,handler){listeners[name]=handler;},
  reconcileConferenceRoute(){calls.push(['conference-route',route]);},
  showPlatformModules(){calls.push(['platform']);},
  openConferenceWorkspace(){calls.push(['conference-open']);},
  openWarehouseWorkspace(options){calls.push(['warehouse',options.route]);},
  PlatformDeviceSession:{invokeModuleProtected:(module,operation,args)=>{calls.push(['protected',module,operation,args]);return Promise.resolve({status:'allowed',moduleKey:module});}}};
  vm.runInNewContext(integrationSource,{window,Promise,Object,JSON,String});
  return {window,calls,listeners,shellClasses,elements,setRoute:value=>{route=value;}};
}

test('module cards use static-safe hash routes and open peer modules',async()=>{
  const state=integrationRuntime('/');
  assert.strictEqual(state.window.PlatformIntegration.openModule('conference'),true);
  assert.deepStrictEqual(state.calls,[['push','/preview/#/conference'],['conference-open']]);
  state.calls.length=0;
  state.setRoute('/');
  assert.strictEqual(await state.window.PlatformIntegration.openModule('warehouse'),true);
  assert.deepStrictEqual(state.calls.map(call=>call.slice(0,3)),[['protected','warehouse','check_module_access'],['push','/preview/#/warehouse'],['warehouse',undefined]]);
  assert.deepStrictEqual(Object.keys(state.calls[0][3]),[]);
  assert.doesNotMatch(integrationSource,/location\.(?:assign|replace)|href\s*=\s*['"]\/(?:conference|warehouse)/);
});

test('one hash listener owns Back and Forward reconciliation',async()=>{
  const state=integrationRuntime('/conference');
  assert.deepStrictEqual(Object.keys(state.listeners),['hashchange']);
  state.listeners.hashchange();
  assert.deepStrictEqual(state.calls,[['conference-route','/conference']]);
  state.calls.length=0;
  state.setRoute('/conference/app/reports');
  state.listeners.hashchange();
  assert.deepStrictEqual(state.calls,[['conference-route','/conference/app/reports']]);
  state.calls.length=0;
  state.setRoute('/warehouse/approvals');
  await state.listeners.hashchange();
  assert.deepStrictEqual(state.calls.map(call=>call.slice(0,3)),[['protected','warehouse','check_module_access'],['warehouse','/warehouse/approvals']]);
  assert.deepStrictEqual(Object.keys(state.calls[0][3]),[]);
  state.calls.length=0;
  state.setRoute('/');
  state.listeners.hashchange();
  assert.deepStrictEqual(state.calls,[['platform']]);
});

test('delayed reconciliation delegates the current canonical Conference route',()=>{
  const state=integrationRuntime('/conference/app/settings');
  state.window.PlatformIntegration.initialize();
  assert.deepStrictEqual(state.calls,[['conference-route','/conference/app/settings']]);
});

test('routing has one hashchange owner and no competing popstate owner',()=>{
  const state=integrationRuntime('/');
  assert.deepStrictEqual(Object.keys(state.listeners),['hashchange']);
  assert.doesNotMatch(integrationSource,/addEventListener\(['"]popstate/);
});

test('generic module routes receive their container and unmount when switching modules',async()=>{
  const state=integrationRuntime('/reservations');
  const lifecycle=[];
  state.window.PlatformIntegration.registerModule({
    id:'reservations',
    mount(context){lifecycle.push(['mount',context.container&&context.container.id]);return true;},
    unmount(context){lifecycle.push(['unmount',context.nextModuleId]);}
  });
  assert.strictEqual(await state.window.PlatformIntegration.reconcileRoute(),true);
  assert.deepStrictEqual(lifecycle,[['mount','reservationsWorkspace']]);
  assert.strictEqual(state.shellClasses.values.has('platform-reservations-active'),true);
  state.setRoute('/warehouse');
  await state.listeners.hashchange();
  assert.deepStrictEqual(lifecycle,[['mount','reservationsWorkspace'],['unmount','warehouse']]);
  assert.strictEqual(state.shellClasses.values.has('platform-reservations-active'),false);
  assert.strictEqual(state.window.PlatformIntegration.openModule('unknown'),false);
});

function warehouseRuntime(route){
  const shellClasses=classList();
  const buttons=[];
  const shell={classList:shellClasses};
  const node={innerHTML:'',querySelectorAll(){return buttons;},querySelector(){return null;}};
  const window={document:{getElementById:id=>id==='startupScreen'?shell:id==='warehouseWorkspace'?node:null,querySelector(){return null;}},
    ApplicationRouting:{getLogicalPathname:()=>route,resolveLogicalRoute:value=>'/preview/#'+value},
    history:{pushState(){}},crypto:{randomUUID:()=> 'operation-id'},WarehouseDeviceOperationContract:{get:()=>({operationIdRequired:false})},WarehouseTransport:{invoke:()=>new Promise(()=>{})}};
  vm.runInNewContext(warehouseSource,{window,Promise,Array,String,Object,JSON,Number,Date,Math});
  return {window,node,shellClasses};
}

for(const section of ['stores','documents','items','stock','approvals']){
  test(`#/warehouse/${section} opens the ${section} workspace`,()=>{
    const state=warehouseRuntime('/warehouse/'+section);
    state.window.openWarehouseWorkspace({route:'/warehouse/'+section});
    assert.strictEqual(state.shellClasses.values.has('platform-warehouse-active'),true);
    assert.strictEqual(state.shellClasses.values.has('platform-conference-active'),false);
    const normalized={documents:'receipts',stock:'balances'}[section]||section;
    assert.match(state.node.innerHTML,new RegExp('data-wh-route="'+normalized+'"'));
    assert.match(state.node.innerHTML,new RegExp('warehouse-nav-item active[^>]*>[^<]*<i>'));
  });
}

test('#/warehouse defaults to the Warehouse dashboard and launcher is structurally separate',()=>{
  const state=warehouseRuntime('/warehouse');
  state.window.openWarehouseWorkspace({route:'/warehouse'});
  assert.match(state.node.innerHTML,/warehouse-nav-item active[^>]*data-wh-route=""|data-wh-route=""[^>]*warehouse-nav-item active/);
  assert.match(html,/<main class="platform-home"[\s\S]*?<\/main>[\s\S]*?id="conferenceWorkspace"[\s\S]*?id="warehouseWorkspace"/);
  assert.doesNotMatch(html,/id="warehouseWorkspace"[^>]+style="display:none"/);
});

test('expanded Warehouse routes and protected transport boundary are static-safe',()=>{
  for(const route of ['items','stores','receipts','issues','transfers','adjustments','approvals','history','balances','reports'])assert.match(warehouseSource,new RegExp("'"+route+"'"));
  assert.doesNotMatch(warehouseSource,/\.schema\(|\.rpc\(|SupabaseClientLayer|stage_import|next\/|vercel/i);
  assert.match(warehouseSource,/WarehouseTransport\.invoke/);
  assert.match(warehouseSource,/documents:'receipts',stock:'balances'/);
});
