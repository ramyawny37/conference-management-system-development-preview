'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const source=fs.readFileSync('js/supabase/device-session.js','utf8');

function deferred(){
  let resolve,reject;
  const promise=new Promise((accept,deny)=>{resolve=accept;reject=deny;});
  return {promise,resolve,reject};
}

function runtime(beginFlights){
  const calls=[];
  const record={state:'active',deviceId:'device-1',bindingId:'binding-1',
    publicKeyThumbprint:'thumbprint-1',privateKey:{}};
  const client={functions:{invoke(name,request){
    calls.push({name,body:request.body});
    if(name==='platform-device-operation')
      return Promise.resolve({data:{ok:true,data:{operation:request.body.operation}}});
    if(request.body.action==='begin')return beginFlights.shift().promise;
    if(request.body.action==='establish')return Promise.resolve({data:{ok:true,data:{
      sessionId:'session-1',token:'secret-token',userId:'user-1',deviceId:'device-1',
      authorizationId:'authorization-1',bindingId:'binding-1',issuedAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+300000).toISOString()
    }}});
    if(request.body.action==='verify')
      return Promise.resolve({data:{ok:true,data:{verified:true,sessionId:request.body.sessionId}}});
    throw new Error('unexpected action');
  }}};
  const indexedDB={open(){
    const opening={result:{transaction(){return {objectStore(){return {getAll(){
      const request={result:[record]};queueMicrotask(()=>request.onsuccess());return request;
    }};}};},close(){}}};
    queueMicrotask(()=>opening.onsuccess());return opening;
  }};
  const window={indexedDB,crypto:{subtle:{
    exportKey(){return Promise.reject(new Error('non-exportable'));},
    sign(){return Promise.resolve(new Uint8Array([1,2,3]).buffer);}
  }},SupabaseClientLayer:{getClient(){return client;}},
  SupabaseDeviceIdentity:{getOrCreate(){return {id:'device-1'};}},
  SupabaseAuth:{initialize(){return Promise.resolve({authenticated:true,user:{id:'user-1'}});}},
  document:{dispatchEvent(){}},setTimeout(){return 1;},clearTimeout(){}};
  vm.runInNewContext(source,{window,indexedDB,Promise,Error,Date,Number,String,
    Uint8Array,TextEncoder,CustomEvent:function(){},btoa(value){return Buffer.from(value,'binary').toString('base64');},
    queueMicrotask});
  return {api:window.PlatformDeviceSession,calls};
}

function successfulBegin(flight){
  flight.resolve({data:{ok:true,data:{challengeId:'challenge-1',userId:'user-1',
    bindingId:'binding-1',deviceId:'device-1',publicKeyThumbprint:'thumbprint-1',
    purpose:'PLATFORM_DEVICE_SESSION_ESTABLISH',origin:'https://ramyawny37.github.io',
    signingPayload:'payload'}}});
}

async function drain(){for(let index=0;index<8;index+=1)await Promise.resolve();}
function actionCount(calls,action){return calls.filter(call=>call.body.action===action).length;}

test('five ensure callers share one establishment and later valid ensure only verifies',async()=>{
  const begin=deferred();const state=runtime([begin]);
  const requests=Array.from({length:5},()=>state.api.ensureValid());
  assert.ok(requests.every(request=>request===requests[0]));
  await drain();
  assert.equal(actionCount(state.calls,'begin'),1);
  successfulBegin(begin);
  const results=await Promise.all(requests);
  assert.ok(results.every(result=>result.verified===true));
  assert.equal(actionCount(state.calls,'begin'),1);
  assert.equal(actionCount(state.calls,'establish'),1);
  assert.equal(actionCount(state.calls,'verify'),1);
  await state.api.ensureValid();
  assert.equal(actionCount(state.calls,'begin'),1);
  assert.equal(actionCount(state.calls,'establish'),1);
  assert.equal(actionCount(state.calls,'verify'),2);
  assert.equal(state.api.getSession().token,undefined);
});

test('concurrent protected operations share the session establishment flight',async()=>{
  const begin=deferred();const state=runtime([begin]);
  const requests=Array.from({length:5},(_,index)=>
    state.api.invokeProtected('operation-'+index,{value:index}));
  await drain();
  assert.equal(actionCount(state.calls,'begin'),1);
  successfulBegin(begin);
  await Promise.all(requests);
  assert.equal(actionCount(state.calls,'begin'),1);
  assert.equal(actionCount(state.calls,'establish'),1);
  assert.equal(actionCount(state.calls,'verify'),1);
  assert.equal(state.calls.filter(call=>call.name==='platform-device-operation').length,5);
});

test('rejected establishment clears the flight and permits a later retry',async()=>{
  const failed=deferred();const retry=deferred();const state=runtime([failed,retry]);
  const requests=Array.from({length:5},()=>state.api.ensureValid());
  await drain();
  failed.reject({code:'BEGIN_FAILED'});
  const rejected=await Promise.allSettled(requests);
  assert.ok(rejected.every(result=>result.status==='rejected'));
  const later=state.api.ensureValid();
  await drain();
  assert.equal(actionCount(state.calls,'begin'),2);
  successfulBegin(retry);
  assert.equal((await later).verified,true);
  assert.equal(actionCount(state.calls,'establish'),1);
  assert.equal(actionCount(state.calls,'verify'),1);
});

test('session token remains tab-memory only',()=>{
  assert.doesNotMatch(source,/localStorage|sessionStorage|document\.cookie|BroadcastChannel/);
  assert.match(source,/var memorySession=null,expiryTimer=null,ensureFlight=null/);
});
