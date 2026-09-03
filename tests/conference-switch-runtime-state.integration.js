'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var stateSource=fs.readFileSync(path.join(root,'state.js'),'utf8');
var scriptSource=fs.readFileSync(path.join(root,'script.js'),'utf8');

function extract(source,name,nextName){
  var start=source.indexOf('function '+name+'(');
  var end=source.indexOf('\nfunction '+nextName+'(',start);
  assert.ok(start>=0&&end>start,name+' source missing');
  return source.slice(start,end);
}

var writes=[];
var schedules=[];
var lifecycleCalls=0;
var conferences=[
  {id:'A',name:'A',status:'active',houses:[{id:'ha',floors:[{id:'fa',rooms:[
    {id:'ra',closed:false,guests:[{id:'pa'}],children:[]}
  ]}]}],peopleDb:{people:[{id:'pa'}]},transports:[{id:'ta'}]},
  {id:'B',name:'B',status:'active',houses:[{id:'hb',floors:[{id:'fb',rooms:[
    {id:'rb',closed:false,guests:[{id:'pb'}],children:[{id:'cb'}]}
  ]}]}],peopleDb:{people:[{id:'pb'},{id:'cb'}]},transports:[{id:'tb'}]}
];
var sandbox={
  window:null,appData:{currentConferenceId:'A',conferences:conferences},
  currentConferenceRuntimeAccessRole:'viewer',
  currentConferenceRuntimeAccessRoles:{A:null,B:'viewer'},
  applicationStorageState:{},SK:'conf_v5',Date:Date,JSON:JSON,
  localStorage:{setItem:function(key,value){writes.push(JSON.parse(value));}},
  StorageRepository:{saveAppSnapshot:function(snapshot,options){
    assert.strictEqual(options.skipSyncQueue,true);
    writes.push(JSON.parse(JSON.stringify(snapshot)));
    return Promise.resolve();
  }},
  ConferenceRepository:{recordLocalChange:function(){lifecycleCalls++;}},
  AutomaticSyncOrchestrator:{schedule:function(reason){schedules.push(reason);}},
  ConferenceActivationAuthorization:{
    canDisplay:function(id){return id==='A'||id==='B';}
  },
  isConferenceImportRecoveryPending:function(){return false;},
  setCurrentConference:function(){},syncCurrentConferenceRefs:function(){},
  getCurrentConference:function(){return sandbox.appData.conferences.find(function(c){
    return c.id===sandbox.appData.currentConferenceId;
  });},
  ge:function(){return null;},setApplicationMode:function(){},
  refreshPeopleDatalist:function(){},renderAccommodation:function(){},
  renderTransports:function(){},renderSettings:function(){},currentTab:0,
  switchTab:function(){return true;},restoreLastApplicationTab:function(){},
  getCanonicalConferenceRoute:function(){return null;},
  getStoredLastTab:function(){return 0;},
  setConferenceApplicationPathname:function(){return true;},
  openStartupScreen:function(){return true;},
  showToast:function(){},console:console,Promise:Promise
};
sandbox.window=sandbox;
vm.runInNewContext(
  extract(stateSource,'saveCurrentConferenceSelection','getStorageUsageReport')+'\n'+
  extract(scriptSource,'setCurrentConferenceById','completeCurrentConference'),
  sandbox
);

assert.strictEqual(sandbox.setCurrentConferenceById('B',{skipToast:true}),true);
assert.strictEqual(sandbox.currentConferenceRuntimeAccessRole,'viewer');
assert.strictEqual(sandbox.appData.currentConferenceId,'B');
assert.strictEqual(sandbox.getCurrentConference().houses[0].id,'hb');
assert.strictEqual(lifecycleCalls,0);
assert.deepStrictEqual(schedules,['conference_changed']);
assert.strictEqual(sandbox.setCurrentConferenceById('A',{skipToast:true}),true);
assert.strictEqual(sandbox.currentConferenceRuntimeAccessRole,null);
assert.strictEqual(sandbox.getCurrentConference().houses[0].id,'ha');
assert.strictEqual(sandbox.getCurrentConference().houses[0].floors[0].rooms[0].guests.length,1);
assert.strictEqual(lifecycleCalls,0);
assert.deepStrictEqual(schedules,['conference_changed','conference_changed']);
assert.strictEqual(writes[writes.length-1].currentConferenceId,'A');
console.log('conference switch runtime state integration tests: passed');
