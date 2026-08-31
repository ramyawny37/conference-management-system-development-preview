const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
const integration=fs.readFileSync('js/platform-integration.js','utf8');
const gateway=fs.readFileSync('server/platform-gateway.cjs','utf8');

test('shell registers all module cards through the platform contract',()=>{
  for(const id of ['conference','warehouse','reservations','custody'])
    assert.match(html,new RegExp(`data-platform-module="${id}"`));
  assert.match(integration,/\/api\/platform\/context/);
  assert.match(integration,/module\.available===true/);
  assert.doesNotMatch(html,/data-platform-module="[^"]+"[^>]+onclick=/);
});

function navigationRuntime(pathname,modules){
  const cards={};
  for(const module of modules){
    cards[module.id]={disabled:false,onclick:null,attributes:{},
      setAttribute(name,value){this.attributes[name]=value;},
      classList:{toggle(){}}};
  }
  const assigned=[];let workspaceOpens=0;
  const window={Promise,navigator:{platform:'test'},location:{pathname,
    assign(route){assigned.push(route);}},fetch(){return Promise.resolve({ok:true,
      json(){return Promise.resolve({modules});}});},document:{querySelector(selector){
      const match=selector.match(/data-platform-module="([^"]+)"/);
      return match?cards[match[1]]||null:null;}},
    openConferenceWorkspace(){workspaceOpens+=1;}};
  vm.runInNewContext(integration,{window,Promise,Object,Array,String,Error,JSON});
  return window.PlatformIntegration.initialize().then(()=>({window,cards,assigned,
    workspaceOpens:()=>workspaceOpens}));
}

test('available cards use the hydrated registry route and unavailable cards remain inert',async()=>{
  const modules=[
    {id:'conference',routePrefix:'/conference',available:true},
    {id:'warehouse',routePrefix:'/warehouse',available:true},
    {id:'reservations',routePrefix:'/reservations',available:false},
    {id:'custody',routePrefix:'/custody',available:true}
  ];
  const runtime=await navigationRuntime('/',modules);
  runtime.cards.conference.onclick();
  runtime.cards.warehouse.onclick();
  runtime.cards.custody.onclick();
  assert.deepStrictEqual(runtime.assigned,['/conference','/warehouse','/custody']);
  assert.strictEqual(runtime.cards.reservations.disabled,true);
  assert.strictEqual(runtime.cards.reservations.onclick,null);
  assert.strictEqual(runtime.cards.conference.attributes['aria-disabled'],'false');
});

test('direct available Conference route activates its workspace without redirecting',async()=>{
  const runtime=await navigationRuntime('/conference',[
    {id:'conference',routePrefix:'/conference',available:true}
  ]);
  assert.strictEqual(runtime.workspaceOpens(),1);
  assert.deepStrictEqual(runtime.assigned,[]);
});

test('gateway is development locked and secret-bearing device credentials stay HttpOnly',()=>{
  assert.match(gateway,/gppwltrifgfxrkzvvxoe/);
  assert.doesNotMatch(gateway,/mpezfbvcdfxpgflehuot/);
  assert.match(gateway,/platform-device-secret/);
  assert.match(gateway,/HttpOnly/);
  assert.match(gateway,/require_module_permission/);
});
