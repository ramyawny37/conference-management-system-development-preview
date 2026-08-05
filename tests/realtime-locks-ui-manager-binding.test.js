'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var localId='local-one';
var remoteId='11111111-1111-4111-8111-111111111111';
var managerStatus='subscribed';
var managerError=null;
var prepareCalls=0;
var legacyConnectCalls=0;
var renders=0;
var sandbox={
  window:null,Promise:Promise,JSON:JSON,Object:Object,String:String,
  Number:Number,Array:Array,Date:Date,structuredClone:global.structuredClone,
  appData:{conferences:[{id:localId}],currentConferenceId:localId},
  getCurrentConference:function(){return {id:localId};},
  renderSettings:function(){renders++;},
  ConferenceLinkStore:{get:function(){return {
    localConferenceId:localId,remoteConferenceId:remoteId,
    linkStatus:'cloud_linked',knownRevision:4
  };}},
  RemoteUpdateStore:{list:function(){return [];},add:function(){return {ok:true};}},
  SupabaseRuntimeConfig:{getPublicState:function(){return {configured:true};}},
  SupabaseAuth:{getState:function(){return {authenticated:true};}},
  SupabaseDeviceIdentity:{getOrCreate:function(){return {id:'device-one'};}},
  OfflineFirstIntegration:{connectRealtime:function(){
    legacyConnectCalls++;return Promise.resolve({ok:true});
  }},
  RealtimeSync:{},
  ConferenceRealtimeManager:{
    getState:function(){return {
      status:managerStatus,lastConnectedAt:'2026-08-05T10:00:00.000Z',
      lastEventAt:'2026-08-05T10:01:00.000Z',lastRevision:5,
      lastError:managerError
    };},
    getDiagnostics:function(){return [
      {stage:'CHANNEL_SUBSCRIBED',data:null},
      {stage:'LOCAL_APPLY_COMPLETED',data:{
        appDataUpdated:true,renderRefreshInvoked:true
      }}
    ];},
    prepareAndSubscribe:function(){
      prepareCalls++;
      return Promise.resolve({ok:true,status:'already_subscribed'});
    }
  },
  ConferenceLocks:{},SupabaseSnapshotSync:{},ConflictResolution:{}
};
sandbox.window=sandbox;
vm.runInNewContext(fs.readFileSync(path.join(
  __dirname,'../js/sync/realtime-locks-ui.js'
),'utf8'),sandbox,{filename:'realtime-locks-ui.js'});

var html=sandbox.RealtimeLocksUI.renderSection({
  localConference:{id:localId}
});
assert.ok(html.includes('Path: Automatic Realtime'));
assert.ok(html.includes('متصل'));
assert.ok(html.includes('Status: subscribed'));
assert.ok(html.includes('Last revision: 5'));
assert.ok(html.includes('LOCAL_APPLY_COMPLETED'));
assert.ok(html.includes('renderRefreshInvoked'));
assert.ok(html.includes('إعادة الاتصال اللحظي'));
assert.ok(!html.includes('بدء متابعة التحديثات'));

managerStatus='error';
managerError={code:'REALTIME_CHANNEL_ERROR'};
html=sandbox.RealtimeLocksUI.renderSection({localConference:{id:localId}});
assert.ok(html.includes('Status: error'));
assert.ok(html.includes('REALTIME_CHANNEL_ERROR'));

sandbox.RealtimeLocksUI.connectCurrent();
setImmediate(function(){
  assert.strictEqual(prepareCalls,1);
  assert.strictEqual(legacyConnectCalls,0);
  assert.strictEqual(renders,1);
  console.log('realtime locks UI manager binding tests: passed');
});
