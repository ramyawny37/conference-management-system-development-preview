'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var source=fs.readFileSync(path.join(__dirname,'../js/sync/conference-edit-lock-manager.js'),'utf8');
var stateSource=fs.readFileSync(path.join(__dirname,'../state.js'),'utf8');
var remote='22222222-2222-4222-8222-222222222222',owner=null,expires=0,clock=100000;
function device(id,online){
  var intervals=[],queueWrites=0,storageWrites=0;
  var conference={id:'local-a',name:'before'},appData={currentConferenceId:'local-a',conferences:[conference]};
  var sandbox={window:null,Date:{now:function(){return clock;},parse:Date.parse},Promise:Promise,JSON:JSON,
    navigator:{onLine:online!==false},document:null,addEventListener:function(){},
    setInterval:function(fn,ms){intervals.push({fn:fn,ms:ms});return intervals.length;},clearInterval:function(){},
    appData:appData,getCurrentConference:function(){return appData.conferences[0];},ConferenceLinkStore:{get:function(){return {linkStatus:'linked',remoteConferenceId:remote};}},
    ConferenceLocks:{
      acquireLock:function(){if(!owner||expires<=clock){owner=id;expires=clock+120000;}return Promise.resolve({ok:true,status:owner===id?'acquired':'locked',data:{owned:owner===id,deviceId:owner,expiresAt:new Date(expires).toISOString()}});},
      renewLock:function(){if(owner!==id||expires<=clock)return Promise.resolve({ok:true,status:'expired',data:{owned:false}});expires=clock+120000;return Promise.resolve({ok:true,status:'renewed',data:{owned:true,deviceId:id,expiresAt:new Date(expires).toISOString()}});},
      releaseLock:function(){if(owner===id)owner=null;return Promise.resolve({ok:true,status:'released',data:{owned:false}});},
      getOwnedLock:function(){return owner===id?{owned:true}:null;}
    },showToast:function(){},OfflineFirstIntegration:{handleLocalSave:function(){queueWrites++;}},StorageRepository:{saveAppSnapshot:function(){storageWrites++;return Promise.resolve();}}
  };sandbox.window=sandbox;vm.runInNewContext(source,sandbox);return {api:sandbox.ConferenceEditLockManager,intervals:intervals,appData:appData,conference:conference,queueWrites:function(){return queueWrites;},storageWrites:function(){return storageWrites;}};
}
(async function(){
  var a=device('A'),b=device('B');
  var results=await Promise.all([a.api.begin('local-a'),b.api.begin('local-a')]);
  assert.strictEqual(results.filter(function(r){return r.data.owned;}).length,1,'atomic race has one owner');
  assert.strictEqual(a.api.getState().canWrite,true);
  assert.strictEqual(b.api.getState().canWrite,false);
  b.conference.name='blocked-change';
  assert.strictEqual(b.api.guard(b.appData).ok,false,'B is read-only');
  assert.strictEqual(b.appData.conferences[0].name,'before','blocked save restores in-memory conference snapshot');
  assert.strictEqual(b.queueWrites(),0,'blocked B creates no queue operation');
  assert.strictEqual(b.storageWrites(),0,'blocked B writes neither localStorage nor IndexedDB');
  assert.strictEqual(a.intervals[0].ms,40000);assert.strictEqual(a.api.ttlSeconds,120);
  await a.api.begin('local-a');assert.strictEqual(a.intervals.length,1,'repeated begin creates no duplicate heartbeat');
  await a.api.release();await b.api.begin('local-a');assert.strictEqual(b.api.getState().canWrite,true,'B acquires after release');
  assert.strictEqual(a.api.guard(a.appData).ok,false,'A is read-only after transfer');
  clock+=121000;var reclaimed=device('C');await reclaimed.api.begin('local-a');assert.strictEqual(reclaimed.api.getState().canWrite,true,'TTL permits recovery');
  var offline=device('D',false);var off=await offline.api.begin('local-a');assert.strictEqual(off.status,'offline');assert.strictEqual(offline.api.guard(offline.appData).ok,false);
  var template=device('T');template.api.begin('local-a');assert.strictEqual(template.api.guard(template.appData,{skipConferenceTracking:true}).ok,true,'isolated template save is allowed when conference snapshot is unchanged');
  var resolveAcquire,ownedOld=false,currentId='old';
  var lateSandbox={window:null,JSON:JSON,Promise:Promise,Date:Date,navigator:{onLine:true},document:null,
    addEventListener:function(){},setInterval:function(){return 1;},clearInterval:function(){},
    appData:{conferences:[{id:'old'},{id:'new'}]},getCurrentConference:function(){return {id:currentId};},
    ConferenceLinkStore:{get:function(id){return {linkStatus:'linked',remoteConferenceId:id==='old'?remote:'33333333-3333-4333-8333-333333333333'};}},
    ConferenceLocks:{acquireLock:function(id){if(id===remote)return new Promise(function(resolve){resolveAcquire=function(){ownedOld=true;resolve({ok:true,status:'acquired',data:{owned:true,expiresAt:new Date(Date.now()+120000).toISOString()}});};});return Promise.resolve({ok:true,status:'acquired',data:{owned:true,expiresAt:new Date(Date.now()+120000).toISOString()}});},getOwnedLock:function(id){return id===remote&&ownedOld?{owned:true}:null;},releaseLock:function(){ownedOld=false;return Promise.resolve({ok:true,status:'released'});},renewLock:function(){return Promise.resolve({ok:true,data:{owned:true,expiresAt:new Date(Date.now()+120000).toISOString()}});}}
  };lateSandbox.window=lateSandbox;vm.runInNewContext(source,lateSandbox);
  var lateAcquire=lateSandbox.ConferenceEditLockManager.begin('old');
  var oldRelease=lateSandbox.ConferenceEditLockManager.release();
  resolveAcquire();await oldRelease;currentId='new';await lateSandbox.ConferenceEditLockManager.begin('new');
  var lateResult=await lateAcquire;assert.strictEqual(lateResult.status,'stale_ignored');assert.strictEqual(lateSandbox.ConferenceEditLockManager.getState().localConferenceId,'new','late old acquire cannot grant current write access');
  assert.match(stateSource,/ConferenceEditLockManager\.guard[\s\S]*?return false;[\s\S]*?var json;/,'central guard must precede persistence');
  assert.doesNotMatch(source,/disconnectRealtime|stopAll|OfflineSyncQueue/,'read-only lock must not stop realtime or invoke queue');
  var writes={local:0,indexed:0,queue:0,mutation:0};
  var stateSandbox={window:null,console:console,Promise:Promise,JSON:JSON,Date:Date,
    localStorage:{getItem:function(){return null;},setItem:function(){writes.local++;}},
    ConferenceEditLockManager:{guard:function(data,options){return {ok:!!(options&&options.skipConferenceTracking)};},committed:function(){}},
    StorageRepository:{saveAppSnapshot:function(data,options){writes.indexed++;if(!options||!options.skipSyncQueue)writes.queue++;return Promise.resolve();}},
    getCurrentConference:function(){return {id:'local-a'};},updateCurrentConferenceData:function(){writes.mutation++;},ge:function(){return null;}}
  ;stateSandbox.window=stateSandbox;vm.createContext(stateSandbox);vm.runInContext(stateSource,stateSandbox);
  vm.runInContext("appData={version:'2.0.0',currentConferenceId:'local-a',conferences:[{id:'local-a',name:'unchanged'}],templates:[],archives:[],backups:[],houseTemplates:[],peopleDb:{version:'1.0.0',people:[]}}",stateSandbox);
  var before=vm.runInContext('JSON.stringify(appData)',stateSandbox);assert.strictEqual(stateSandbox.save(),false);
  assert.strictEqual(vm.runInContext('JSON.stringify(appData)',stateSandbox),before);assert.deepStrictEqual(writes,{local:0,indexed:0,queue:0,mutation:0},'blocked save changes no memory or storage and creates no queue operation');
  assert.strictEqual(stateSandbox.save({skipConferenceTracking:true,skipCurrentConferenceUpdate:true,skipSyncQueue:true}),true,'isolated template save succeeds without lock');
  assert.strictEqual(writes.local,1);assert.strictEqual(writes.indexed,1);assert.strictEqual(writes.queue,0);
  console.log('conference exclusive edit lock tests: passed');
})().catch(function(e){console.error(e);process.exitCode=1;});
