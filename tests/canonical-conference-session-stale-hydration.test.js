'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(file){
  const requests=[];
  const listeners={};
  const window={
    crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000000'},
    PlatformDeviceSession:{invokeModuleProtected(_module,operation,args){
      const item=deferred();requests.push({operation,args,...item});return item.promise;
    }},
    addEventListener(name,fn){(listeners[name]??=[]).push(fn);},
    dispatchEvent(event){for(const fn of listeners[event.type]||[])fn(event);},
  };
  window.window=window;
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{window,Date,Math,Promise,JSON,Error,Number,String,Array,Object});
  return {window,requests,reset(){window.dispatchEvent({type:'platform-session-reset'});window.CanonicalConferenceTransport?.clear();window.CanonicalConferenceRestaurant?.clear();}};
}
const cases=[
  {file:'js/supabase/canonical-conference-transport.js',api:'CanonicalConferenceTransport',state:'getState',response:id=>({conferenceId:id,vehicles:[],assignments:[],canManage:true})},
  {file:'js/supabase/canonical-conference-restaurant.js',api:'CanonicalConferenceRestaurant',state:'getState',response:id=>({conferenceId:id,settings:{},participations:[],canManage:true})}
];
for(const item of cases){
  test(item.api+' rejects a late hydration result after session reset',async()=>{
    const h=harness(item.file),service=h.window[item.api];
    const pending=service.hydrate('conference-A','conference-A');
    assert.equal(h.requests.length,1);
    h.reset();
    h.requests[0].resolve(item.response('conference-A'));
    await assert.rejects(pending);
    assert.equal(service[item.state]('conference-A'),null);
  });
  test(item.api+' rejects mismatched response conference identity',async()=>{
    const h=harness(item.file),service=h.window[item.api];
    const pending=service.hydrate('conference-A','conference-A');
    h.requests[0].resolve(item.response('conference-B'));
    await assert.rejects(pending);
    assert.equal(service[item.state]('conference-A'),null);
  });
  test(item.api+' stale request cannot overwrite a newer hydration',async()=>{
    const h=harness(item.file),service=h.window[item.api];
    const stale=service.hydrate('conference-A','conference-A');
    h.reset();
    const fresh=service.hydrate('conference-A','conference-A');
    assert.equal(h.requests.length,2);
    h.requests[1].resolve(item.response('conference-A'));
    await fresh;
    h.requests[0].resolve(item.response('conference-A'));
    await assert.rejects(stale);
    assert.ok(service[item.state]('conference-A'));
  });
}
