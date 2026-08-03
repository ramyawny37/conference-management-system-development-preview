'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var automaticSource=fs.readFileSync(path.join(
  root,'js/sync/automatic-conference-linking.js'
),'utf8');
var integrationSource=fs.readFileSync(path.join(
  root,'js/sync/offline-first-integration.js'
),'utf8');

var remoteId='11111111-1111-4111-8111-111111111111';
var deviceId='22222222-2222-4222-8222-222222222222';
var userId='33333333-3333-4333-8333-333333333333';
var localId='local-1';
var knownRevision=2;

async function run(){
  var calls={coalesce:0,scan:0,reconcile:0,schedule:0};
  var link={
    localConferenceId:localId,
    remoteConferenceId:remoteId,
    knownRevision:knownRevision,
    linkStatus:'linked'
  };
  var conference={
    id:localId,
    name:'Conference',
    status:'active',
    peopleDb:{version:'1.0.0',people:[]},
    houses:[],
    transports:[],
    activityLog:[]
  };
  var appData={
    currentConferenceId:localId,
    conferences:[conference],
    conferenceLifecycle:{schemaVersion:1,records:{}}
  };
  appData.conferenceLifecycle.records[localId]={
    localConferenceId:localId,
    localLifecycle:'active',
    cloudLifecycle:'cloud_linked',
    localContentVersion:1,
    publishMetadata:null
  };

  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Array:Array,
    Number:Number,
    Date:Date,
    structuredClone:structuredClone,
    navigator:{onLine:true},
    appData:appData,
    APP_RELEASE:{version:'3.1.1'},
    AutomaticSyncPreferences:{get:function(){return {
      cloudSyncEnabled:true,
      automaticSyncEnabled:true,
      automaticLinkingEnabled:true
    };}},
    SupabaseRuntimeConfig:{getPublicState:function(){
      return {configured:true};
    }},
    SupabaseAuth:{
      initialize:function(){return Promise.resolve();},
      getState:function(){return {authenticated:true};},
      getSession:function(){return {user:{id:userId}};}
    },
    SupabaseDeviceIdentity:{getOrCreate:function(){return {id:deviceId};}},
    ConferenceLinkStore:{
      get:function(id){return id===localId?structuredClone(link):null;},
      findByRemoteId:function(id){
        return id===remoteId?structuredClone(link):null;
      }
    },
    FullBackupService:{
      getFullRestoreCloudReviewMarker:function(){return {pending:false};},
      isManualRelinkRequired:function(){return false;}
    },
    ConferencePublishRecovery:{
      scanCandidates:function(){calls.scan++;},
      reconcileConference:function(){calls.reconcile++;}
    },
    OfflineSyncQueue:{
      coalesceSnapshotOperation:function(input){
        calls.coalesce++;
        assert.strictEqual(input.localConferenceId,localId);
        assert.strictEqual(input.conferenceId,remoteId);
        assert.strictEqual(input.baseRevision,knownRevision);
        return Promise.resolve({
          ok:true,
          status:'enqueued',
          data:{operation:{baseRevision:input.baseRevision}}
        });
      }
    },
    AutomaticSyncOrchestrator:{schedule:function(){calls.schedule++;}},
    getCurrentConference:function(){return conference;}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(integrationSource,sandbox,{
    filename:'offline-first-integration.js'
  });
  vm.runInNewContext(automaticSource,sandbox,{
    filename:'automatic-conference-linking.js'
  });

  sandbox.AutomaticConferenceLinking.initialize();
  var restored=await sandbox.AutomaticConferenceLinking.evaluate({
    connectivity:'online'
  });
  assert.strictEqual(restored.ok,true);
  assert.strictEqual(restored.status,'already_linked');
  assert.strictEqual(restored.data.contextRestored,true);
  assert.strictEqual(calls.coalesce,0);
  assert.strictEqual(calls.scan,0);
  assert.strictEqual(calls.reconcile,0);

  var restoredState=sandbox.OfflineFirstIntegration
    .getConferenceSyncState(localId);
  assert.strictEqual(restoredState.context.conferenceId,remoteId);
  assert.strictEqual(restoredState.context.baseRevision,knownRevision);

  var saved=await sandbox.OfflineFirstIntegration
    .handleLocalSave(structuredClone(appData));
  assert.strictEqual(saved.ok,true);
  assert.strictEqual(saved.status,'queued');
  assert.notStrictEqual(
    saved.data&&saved.data.reason,'CONFERENCE_NOT_CONFIGURED'
  );
  assert.strictEqual(calls.coalesce,1);

  console.log('automatic conference context restore tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
