'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var values={};
var calls=[];
var orchestratorListener=null;
var renderCount=0;
var realtimeState={status:'inactive',generation:0,cloudConferenceId:null};
var currentConference={id:'local-a'};
var currentLink={
  localConferenceId:'local-a',
  remoteConferenceId:'remote-a',
  knownRevision:1,
  linkStatus:'linked'
};
var elements={
  sync_cloud_enabled:{checked:true},
  sync_automatic_linking_enabled:{checked:true},
  sync_automatic_sync_enabled:{checked:true},
  sync_preferences_message:{textContent:'',className:''}
};
var sandbox={
  window:null,
  Promise:Promise,
  JSON:JSON,
  Object:Object,
  String:String,
  Array:Array,
  Date:Date,
  localStorage:{
    getItem:function(key){return values[key]||null;},
    setItem:function(key,value){values[key]=String(value);},
    removeItem:function(key){delete values[key];}
  },
  document:{
    getElementById:function(id){return elements[id]||null;}
  },
  AutomaticSyncOrchestrator:{
    start:function(){calls.push('start');return {ok:true};},
    stop:function(){calls.push('stop');return {ok:true};},
    schedule:function(reason){calls.push(reason);return {ok:true};},
    subscribe:function(listener){
      orchestratorListener=listener;
      return function(){};
    }
  },
  getCurrentConference:function(){return currentConference;},
  ConferenceLinkStore:{
    get:function(id){
      return id===currentLink.localConferenceId?currentLink:null;
    }
  },
  ConferenceRealtimeManager:{
    getState:function(){return realtimeState;}
  },
  renderSettings:function(){renderCount++;},
  SupabaseRuntimeConfig:{
    getPublicState:function(){return {configured:true,url:'',maskedKey:''};}
  },
  SupabaseAuth:{
    getState:function(){return {initialized:true,authenticated:true,user:null};}
  },
  SupabaseDeviceIdentity:{
    getOrCreate:function(){return {id:'device-id',deviceName:'Device'};}
  },
  location:{origin:'https://example.test'}
};
sandbox.window=sandbox;

[
  'js/sync/automatic-sync-preferences.js',
  'js/sync/sync-settings-ui.js'
].forEach(function(file){
  vm.runInNewContext(
    fs.readFileSync(path.join(root,file),'utf8'),
    sandbox,
    {filename:file}
  );
});

var html=sandbox.SyncSettingsUI.renderSection();
assert.strictEqual(typeof orchestratorListener,'function');
assert.ok(html.indexOf('تفعيل المزامنة السحابية')>=0);
assert.ok(html.indexOf('تفعيل الربط التلقائي')>=0);
assert.ok(html.indexOf('تفعيل المزامنة التلقائية')>=0);

var saved=sandbox.SyncSettingsUI.saveAutomaticSyncPreferences();
assert.strictEqual(saved.ok,true);
assert.deepStrictEqual(calls,['start','preferences_changed']);
assert.strictEqual(
  sandbox.AutomaticSyncPreferences.get().cloudSyncEnabled,
  true
);
assert.ok(values.conference_manager_automatic_sync_preferences);
assert.strictEqual(values.automatic_sync_preferences,undefined);
var savedHtml=sandbox.SyncSettingsUI.renderSection();
assert.ok(savedHtml.indexOf(
  'id="sync_cloud_enabled" type="checkbox" checked'
)>=0);
sandbox.SyncSettingsUI.saveAutomaticSyncPreferences();
assert.deepStrictEqual(calls,[
  'start','preferences_changed','start','preferences_changed'
]);

orchestratorListener({
  conferenceState:'linked',
  linkedConferenceId:'local-a'
});
assert.strictEqual(renderCount,1);
orchestratorListener({
  conferenceState:'linked',
  linkedConferenceId:'local-a'
});
assert.strictEqual(renderCount,1);

realtimeState={
  status:'subscribed',generation:1,cloudConferenceId:'remote-a'
};
orchestratorListener({
  conferenceState:'linked',
  linkedConferenceId:'local-a'
});
assert.strictEqual(renderCount,2);

currentConference={id:'local-b'};
orchestratorListener({
  conferenceState:'linked',
  linkedConferenceId:'local-a'
});
assert.strictEqual(renderCount,2);

currentLink={
  localConferenceId:'local-b',
  remoteConferenceId:'remote-b',
  knownRevision:1,
  linkStatus:'linked'
};
orchestratorListener({
  conferenceState:'linked',
  linkedConferenceId:'local-b'
});
assert.strictEqual(renderCount,3);

elements.sync_cloud_enabled.checked=false;
sandbox.SyncSettingsUI.saveAutomaticSyncPreferences();
assert.deepStrictEqual(calls,[
  'start','preferences_changed','start','preferences_changed','stop'
]);

sandbox.localStorage.setItem=function(){};
elements.sync_cloud_enabled.checked=true;
var failed=sandbox.SyncSettingsUI.saveAutomaticSyncPreferences();
assert.strictEqual(failed.ok,false);
assert.strictEqual(failed.status,'storage_failed');
assert.strictEqual(elements.sync_cloud_enabled.checked,false);

console.log('sync settings preferences UI tests: passed');
