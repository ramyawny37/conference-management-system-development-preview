const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const source=fs.readFileSync('js/warehouse/workspace.js','utf8');
const css=fs.readFileSync('style.css','utf8');

function classes(){
  const values=new Set();
  return {values,add(...names){names.forEach(name=>values.add(name));},
    remove(...names){names.forEach(name=>values.delete(name));},
    toggle(name,force){
      const next=force===undefined?!values.has(name):force;
      if(next)values.add(name);else values.delete(name);
      return next;
    }};
}

function runtime(initialRoute,responses){
  let route=initialRoute;
  const pushes=[];
  const shell={classList:classes()};
  const app={classList:classes()};
  const menu=[{},{setAttribute(){}}];
  const collapse={setAttribute(){}};
  const node={innerHTML:'',querySelectorAll(selector){
    if(selector==='[data-wh-menu]')return menu;
    return [];
  },querySelector(selector){
    if(selector==='[data-wh-menu]')return menu[0];
    if(selector==='[data-wh-collapse]')return collapse;
    if(selector==='.warehouse-app')return app;
    return null;
  }};
  const window={document:{getElementById:id=>id==='startupScreen'?shell:
    id==='warehouseWorkspace'?node:null,querySelector(){return null;}},
  ApplicationRouting:{getLogicalPathname:()=>route,
    resolveLogicalRoute:value=>'#/preview'+value},
  history:{pushState(_state,_title,value){pushes.push(value);
    route=value.replace('#/preview','');}},crypto:{randomUUID:()=>'operation-id'},
  WarehouseDeviceOperationContract:{get:()=>({operationIdRequired:false})},
  WarehouseTransport:{invoke(name){
    return responses?Promise.resolve(responses[name]):new Promise(()=>{});
  }},AppIcons:{icon:name=>'<svg data-icon="'+name+'"></svg>'},
  SupabaseAuth:{getAccountIdentity:()=>({displayName:'مستخدم فعلي',email:'user@example.test'})},
  showPlatformModules(){}};
  vm.runInNewContext(source,{window,Promise,Array,String,Object,JSON,Number,Date,Math});
  return {window,node,app,menu,collapse,pushes,route:()=>route};
}

test('Warehouse dashboard and child navigation retain canonical hash routes',()=>{
  const state=runtime('/warehouse');
  state.window.openWarehouseWorkspace({route:'/warehouse'});
  assert.equal(state.window.WarehouseWorkspace.getSection(),'');
  for(const child of ['items','stores','receipts','issues','transfers','adjustments',
    'approvals','history','balances','reports']){
    state.window.WarehouseWorkspace.navigate(child);
    assert.equal(state.route(),'/warehouse/'+child);
  }
  assert.deepEqual(state.pushes.map(value=>value.replace('#/preview','')),
    ['items','stores','receipts','issues','transfers','adjustments','approvals',
      'history','balances','reports'].map(value=>'/warehouse/'+value));
});

test('mobile drawer and desktop collapse do not mutate the active route',()=>{
  const state=runtime('/warehouse/issues');
  state.window.openWarehouseWorkspace({route:'/warehouse/issues'});
  state.menu[1].onclick();
  assert.equal(state.app.classList.values.has('menu-open'),true);
  assert.equal(state.route(),'/warehouse/issues');
  state.menu[0].onclick();
  assert.equal(state.app.classList.values.has('menu-open'),false);
  state.collapse.onclick();
  assert.equal(state.app.classList.values.has('sidebar-collapsed'),true);
  assert.equal(state.route(),'/warehouse/issues');
  assert.equal(state.pushes.length,0);
});

test('sidebar exposes only supported W1 routes and preserves aliases',()=>{
  const state=runtime('/warehouse/documents');
  state.window.openWarehouseWorkspace({route:'/warehouse/documents'});
  assert.equal(state.window.WarehouseWorkspace.getSection(),'receipts');
  for(const route of ['', 'items','issues','receipts','stores','reports','transfers',
    'approvals','adjustments','history','balances']){
    assert.match(state.node.innerHTML,new RegExp('data-wh-route="'+route+'"'));
  }
  assert.doesNotMatch(state.node.innerHTML,
    /الجهات والأشخاص|الحسابات والسداد|التوزيع والحملات|الإعدادات/);
  state.window.openWarehouseWorkspace({route:'/warehouse/stock'});
  assert.equal(state.window.WarehouseWorkspace.getSection(),'balances');
});

test('dashboard renders only live WarehouseTransport values',async()=>{
  const state=runtime('/warehouse',{
    discover_stores:[{id:'s1',status:'active'},{id:'s2',status:'inactive'}],
    list_item_master:{categories:[],units:[],items:[
      {id:'i1',status:'active'},{id:'i2',status:'inactive'}]},
    list_documents:[{id:'d1'},{id:'d2'}],list_approval_queue:[
      {request_kind:'adjustment',approval_status:'approved'},
      {request_kind:'adjustment',approval_status:'rejected'},
      {request_kind:'adjustment',approval_status:'pending'},
      {request_kind:'reversal',lifecycle_status:'pending'},
      {request_kind:'reversal',lifecycle_status:'approved'},
      {request_kind:'reversal',lifecycle_status:'rejected'}]
  });
  await state.window.openWarehouseWorkspace({route:'/warehouse'});
  assert.match(state.node.innerHTML,/لوحة التحكم/);
  assert.match(state.node.innerHTML,/الأصناف النشطة[\s\S]*?<strong>1<\/strong>/);
  assert.match(state.node.innerHTML,/المخازن المتاحة[\s\S]*?<strong>1<\/strong>/);
  assert.match(state.node.innerHTML,/المستندات الحديثة[\s\S]*?<strong>2<\/strong>/);
  assert.match(state.node.innerHTML,/بانتظار الاعتماد[\s\S]*?<strong>2<\/strong>/);
  assert.doesNotMatch(state.node.innerHTML,/تجريبية|demo|sample|mock/i);
  assert.match(source,/WarehouseTransport\.invoke/);
  assert.doesNotMatch(source,/\.rpc\(|\.schema\(|SupabaseClientLayer/);
});

test('restored shell keeps historical geometry without server dependencies',()=>{
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) 268px/);
  assert.match(css,/sidebar-collapsed\{grid-template-columns:minmax\(0,1fr\) 76px/);
  assert.match(css,/\.warehouse-topbar\{[\s\S]*?height:76px/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*?\.warehouse-drawer-backdrop/);
  assert.doesNotMatch(source,/next\/|\bReact\b|from\s+['"]react|vercel|gateway|document\.cookie|fetch\s*\(/i);
});

test('RTL Warehouse shell keeps the sidebar physically right of the main workspace',()=>{
  assert.match(css,/\.warehouse-app\{[\s\S]*?grid-template-areas:"main sidebar"[\s\S]*?direction:ltr/);
  assert.match(css,/\.warehouse-sidebar\{grid-area:sidebar;[\s\S]*?direction:rtl/);
  assert.match(css,/\.warehouse-main\{grid-area:main;[\s\S]*?direction:rtl/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*?\.warehouse-sidebar\{[\s\S]*?inset:0 0 0 auto[\s\S]*?transform:translateX\(105%\)/);
});
