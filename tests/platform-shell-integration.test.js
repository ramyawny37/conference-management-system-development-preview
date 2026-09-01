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

function navigationRuntime(pathname,modules,contextFailure){
  const cards={};
  const documentListeners={};
  for(const module of modules){
    const state={textContent:module.id==='conference'?'AVAILABLE':'UNAVAILABLE',dataset:{},classList:{add(){},remove(){}}};
    cards[module.id]={disabled:false,onclick:null,attributes:{},state,
      setAttribute(name,value){this.attributes[name]=value;},
      classList:{toggle(){}},
      closest(selector){return selector==='[data-platform-module]'?this:null;},
      getAttribute(name){return name==='data-platform-module'?module.id:this.attributes[name];},
      querySelector(selector){return selector==='.platform-module-state'?this.state:null;},
      click(){
        if(this.disabled)return;
        const event={target:this,defaultPrevented:false,
          preventDefault(){this.defaultPrevented=true;}};
        if(typeof this.onclick==='function')this.onclick(event);
        for(const listener of documentListeners.click||[])listener(event);
      }};
  }
  const assigned=[];let workspaceOpens=0;
  const window={Promise,navigator:{platform:'test'},location:{pathname,
    assign(route){assigned.push(route);}},fetch(){return Promise.resolve(contextFailure
      ?{ok:false,status:401,json(){return Promise.resolve({error:'PLATFORM_SESSION_INVALID'});}}
      :{ok:true,json(){return Promise.resolve({modules});}});},document:{addEventListener(type,listener){
      (documentListeners[type]||(documentListeners[type]=[])).push(listener);
    },querySelector(selector){
      if(selector==='[data-platform-module="conference"] .platform-module-state-available')return cards.conference&&cards.conference.state;
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
  runtime.cards.conference.click();
  runtime.cards.warehouse.click();
  runtime.cards.custody.click();
  assert.deepStrictEqual(runtime.assigned,['/conference','/warehouse','/custody']);
  assert.strictEqual(runtime.cards.reservations.disabled,true);
  assert.strictEqual(runtime.cards.reservations.onclick,null);
  assert.strictEqual(runtime.cards.conference.onclick,null);
  assert.strictEqual(runtime.cards.conference.attributes['aria-disabled'],'false');
  assert.strictEqual(runtime.cards.warehouse.state.textContent,'AVAILABLE');
  assert.strictEqual(runtime.cards.custody.state.textContent,'AVAILABLE');
  assert.strictEqual(runtime.cards.reservations.state.textContent,'UNAVAILABLE');
});

test('direct available Conference route activates its workspace without redirecting',async()=>{
  const runtime=await navigationRuntime('/conference',[
    {id:'conference',routePrefix:'/conference',available:true}
  ]);
  assert.strictEqual(runtime.workspaceOpens(),1);
  assert.deepStrictEqual(runtime.assigned,[]);
});

test('rendered available Conference card navigates even when initial context hydration fails',async()=>{
  const failed=await navigationRuntime('/',[
    {id:'conference',routePrefix:'/conference',available:true}
  ],true);
  failed.cards.conference.click();
  assert.strictEqual(failed.cards.conference.disabled,false);
  assert.deepStrictEqual(failed.assigned,['/conference']);
});

test('gateway is development locked and secret-bearing device credentials stay HttpOnly',()=>{
  assert.match(gateway,/gppwltrifgfxrkzvvxoe/);
  assert.doesNotMatch(gateway,/mpezfbvcdfxpgflehuot/);
  assert.match(gateway,/platform-device-secret/);
  assert.match(gateway,/HttpOnly/);
  assert.match(gateway,/moduleAccessFor/);
  assert.match(gateway,/list_module_permission_grants/);
  assert.doesNotMatch(gateway,/\.rpc\("require_module_permission"/);
});
