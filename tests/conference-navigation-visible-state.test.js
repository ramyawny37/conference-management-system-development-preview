'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const source=fs.readFileSync('script.js','utf8');

function extract(name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,name);
  let at=source.indexOf('{',start),depth=0,quote='',escape=false;
  for(;at<source.length;at++){
    const char=source[at];
    if(quote){
      if(escape)escape=false;
      else if(char==='\\')escape=true;
      else if(char===quote)quote='';
      continue;
    }
    if(char==='"'||char==="'"||char==='`'){quote=char;continue;}
    if(char==='{')depth++;
    else if(char==='}'&&!--depth)return source.slice(start,at+1);
  }
  throw new Error(name);
}

function runtime(withConference=true){
  const dom=new JSDOM('<body><main id="startupScreen"><section id="platformHomeWorkspace"></section><section id="conferenceWorkspace"></section></main><header id="applicationTopbar"></header><section id="applicationBody">'+
    '<button data-conference-tab="0"></button><button data-conference-tab="6"></button>'+Array.from({length:7},(_,id)=>'<div id="tab'+id+'"'+(id?' style="display:none"':'')+'></div>').join('')+'</section></body>',{url:'https://example.test/#/conference/app/accommodation'});
  const window=dom.window;
  let route='/conference/app/accommodation';
  const conference={id:'conference-1'};
  const appData={currentConferenceId:withConference?conference.id:null,conferences:withConference?[conference]:[]};
  const names=['accommodation','transportation','accounts','reports','cards','search','settings'];
  window.ApplicationRouting={
    getLogicalPathname:()=>route,
    resolveLogicalRoute:value=>'#'+value,
    resolveConferenceTabRoute:id=>'/conference/app/'+names[id],
    getConferenceRoute(value){
      value=value===undefined?route:value;
      if(value==='/conference')return {kind:'home'};
      const match=/^\/conference\/app\/([^/]+)(?:\/(houses))?$/.exec(value);
      if(!match)return {kind:'invalid'};
      return {kind:'application',tabId:names.indexOf(match[1]),tabName:match[1],settingsView:match[2]};
    }
  };
  window.history.pushState=(_state,_title,value)=>{route=String(value).replace(/^#/,'');};
  window.history.replaceState=(_state,_title,value)=>{route=String(value).replace(/^#/,'');};
  window.StartupAccessGate={isAllowed:()=>true};
  window.ConferenceActivationAuthorization={};
  const context={window,document:window.document,CustomEvent:window.CustomEvent,Number,String,parseInt,isFinite,
    appData,currentTab:0,settingsTab:'general',startupClockTimer:null,currentConferenceRuntimeActivationDecision:withConference?{ok:true,active:true,conferenceId:conference.id}:null,
    currentApplicationView:'application',ge:id=>window.document.getElementById(id),getCurrentConference:()=>withConference?conference:null,
    isValidApplicationTab:id=>id>=0&&id<7,getValidApplicationTabIds:()=>[0,1,2,3,4,5,6],getApplicationTabIdByName:name=>name==='settings'?6:null,
    saveApplicationView(){},saveLastTab(){},showToast(){},renderTab(id){window.document.getElementById('tab'+id).textContent='content-'+id;},
    save(){return true;},updateStartupDateTime(){},setInterval(){return 1;},clearInterval(){},resetAdministrativeViewScroll(){},showStartupConferenceList(){},showPlatformModules(){},openStartupScreen(){return true;}};
  vm.runInNewContext(['getPlatformShellPathname','replacePlatformShellPathname','pushPlatformShellPathname','getCanonicalConferenceRoute','setConferenceApplicationPathname','openConferenceWorkspace','setApplicationMode','switchTab','reconcileConferenceRoute','navigateConferenceRoute','openSettingsFromHome'].map(extract).join('\n'),context);
  return {context,window,getRoute:()=>route,currentId:()=>appData.currentConferenceId};
}

function assertVisible(state,tabId,route){
  assert.equal(state.getRoute(),route);
  for(let id=0;id<7;id++){
    const node=state.window.document.getElementById('tab'+id),visible=id===tabId;
    assert.equal(node.style.display,visible?'':'none');
    assert.equal(node.hidden,!visible);
    assert.equal(node.getAttribute('aria-hidden'),visible?'false':'true');
    if(visible)assert.equal(node.textContent,'content-'+id);
  }
  const active=state.window.document.querySelector('[data-conference-tab].active');
  assert.equal(active&&Number(active.getAttribute('data-conference-tab')),tabId);
}

test('rapid repeated Conference navigation keeps URL, subnav, and visible content atomic',()=>{
  const state=runtime(true);
  for(const [tabId,route] of [[6,'/conference/app/settings'],[0,'/conference/app/accommodation'],[6,'/conference/app/settings'],[0,'/conference/app/accommodation']]){
    assert.equal(state.context.navigateConferenceRoute(route),true);
    assertVisible(state,tabId,route);
    assert.equal(state.currentId(),'conference-1');
  }
});

test('Conference Houses is visible without an active conference',()=>{
  const state=runtime(false);
  const route='/conference/app/settings/houses';
  assert.equal(state.context.navigateConferenceRoute(route),true);
  assertVisible(state,6,route);
  assert.equal(state.currentId(),null);
});

test('the startup settings tile uses the same canonical route transition',()=>{
  const state=runtime(true);
  assert.equal(state.context.openSettingsFromHome(),true);
  assertVisible(state,6,'/conference/app/settings');
});

test('late and failed hydration cannot repaint a previously active tab',async()=>{
  let release,reject,transportRenders=0;
  const current={id:'conference-1'};
  const context={window:{CanonicalConferenceTransport:{isLinked:()=>true,hydrate:()=>new Promise((resolve,rejectPromise)=>{release=resolve;reject=rejectPromise;})}},Promise,String,
    currentTab:6,getCurrentConference:()=>current,renderTransports(){transportRenders++;},showToast(){}};
  vm.runInNewContext(extract('hydrateCanonicalConferenceTransport'),context);
  const slow=context.hydrateCanonicalConferenceTransport(current.id,{silent:true});
  release({status:'ready'});
  await slow;
  assert.equal(transportRenders,0);
  const failed=context.hydrateCanonicalConferenceTransport(current.id,{silent:true});
  reject(new Error('HYDRATION_FAILED'));
  await assert.rejects(failed,/HYDRATION_FAILED/);
  assert.equal(transportRenders,0);
});
