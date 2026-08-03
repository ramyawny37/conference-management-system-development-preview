'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/automatic-conference-linking.js'
),'utf8');

function environment(settings){
  settings=settings||{};
  var conference=settings.conference===undefined
    ?{id:'local-1',name:'Conference'}:settings.conference;
  var calls={
    scan:0,reconcile:0,schedule:0,configure:0,
    configureLocalId:null,configureOptions:null
  };
  var candidates=settings.candidates||[];
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Array:Array,
    structuredClone:structuredClone,
    navigator:{onLine:settings.online!==false},
    appData:settings.appData||{
      conferences:conference?[conference]:[]
    },
    AutomaticSyncPreferences:{get:function(){
      return Object.assign({
        cloudSyncEnabled:true,
        automaticSyncEnabled:true,
        automaticLinkingEnabled:true
      },settings.preferences||{});
    }},
    SupabaseRuntimeConfig:{getPublicState:function(){
      return {configured:settings.configured!==false};
    }},
    SupabaseAuth:{
      initialize:function(){return Promise.resolve();},
      getState:function(){
        return {authenticated:settings.authenticated!==false};
      }
    },
    ConferenceLinkStore:{get:function(){
      return settings.existingLink||null;
    }},
    FullBackupService:{
      getFullRestoreCloudReviewMarker:function(){
        return {pending:settings.restoreMarker===true};
      },
      isManualRelinkRequired:function(){
        return settings.manualRelink===true;
      }
    },
    OfflineFirstIntegration:settings.integrationUnavailable
      ?null:{configureConferenceSync:function(localId,options){
        calls.configure++;
        calls.configureLocalId=localId;
        calls.configureOptions=options;
        return settings.configureFailure
          ?{ok:false,status:'error'}
          :{ok:true,status:'configured'};
      }},
    ConferencePublishRecovery:{
      scanCandidates:function(){
        calls.scan++;
        return settings.scanFailure
          ?{ok:false,status:'invalid'}
          :{ok:true,status:'candidates_scanned',data:{
            candidates:candidates
          }};
      },
      reconcileConference:function(appData,id){
        calls.reconcile++;
        if(settings.gate)return settings.gate.promise;
        return Promise.resolve({
          ok:true,
          status:'cloud_linked',
          data:{localConferenceId:id}
        });
      }
    },
    AutomaticSyncOrchestrator:{schedule:function(){
      calls.schedule++;
    }},
    getCurrentConference:function(){return conference;}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{
    filename:'automatic-conference-linking.js'
  });
  sandbox.AutomaticConferenceLinking.initialize();
  return {window:sandbox,calls:calls};
}

function evaluate(env){
  return env.window.AutomaticConferenceLinking.evaluate({
    connectivity:'online',
    reason:'test'
  });
}

async function run(){
  var offline=environment({online:false});
  assert.strictEqual((await evaluate(offline)).status,'offline');
  assert.strictEqual(offline.calls.scan,0);

  var unauthenticated=environment({authenticated:false});
  assert.strictEqual(
    (await evaluate(unauthenticated)).status,'auth_required'
  );

  var disabled=environment({
    preferences:{automaticSyncEnabled:false}
  });
  assert.strictEqual(
    (await evaluate(disabled)).status,'automatic_sync_disabled'
  );

  var missing=environment({conference:null});
  assert.strictEqual(
    (await evaluate(missing)).status,'conference_unavailable'
  );

  var legacyLinked=environment({existingLink:{
    localConferenceId:'local-1',
    remoteConferenceId:'11111111-1111-4111-8111-111111111111',
    knownRevision:2,
    linkStatus:'linked'
  }});
  assert.strictEqual(
    (await evaluate(legacyLinked)).status,'already_linked'
  );
  assert.strictEqual(legacyLinked.calls.configure,1);
  assert.strictEqual(legacyLinked.calls.configureLocalId,'local-1');
  assert.strictEqual(
    legacyLinked.calls.configureOptions.conferenceId,
    '11111111-1111-4111-8111-111111111111'
  );
  assert.strictEqual(legacyLinked.calls.configureOptions.baseRevision,2);
  assert.strictEqual(legacyLinked.calls.scan,0);
  assert.strictEqual(legacyLinked.calls.reconcile,0);

  var invalidLinks=[
    {
      localConferenceId:'different-local',
      remoteConferenceId:'11111111-1111-4111-8111-111111111111',
      knownRevision:2,linkStatus:'linked'
    },
    {
      localConferenceId:'local-1',remoteConferenceId:'invalid',
      knownRevision:2,linkStatus:'linked'
    },
    {
      localConferenceId:'local-1',
      remoteConferenceId:'11111111-1111-4111-8111-111111111111',
      knownRevision:0,linkStatus:'linked'
    }
  ];
  for(var invalidLink of invalidLinks){
    var invalid=environment({existingLink:invalidLink});
    assert.strictEqual(
      (await evaluate(invalid)).status,'linked_context_invalid'
    );
    assert.strictEqual(invalid.calls.configure,0);
    assert.strictEqual(invalid.calls.scan,0);
    assert.strictEqual(invalid.calls.reconcile,0);
  }

  var unavailable=environment({
    existingLink:legacyLinked.window.ConferenceLinkStore.get(),
    integrationUnavailable:true
  });
  assert.strictEqual(
    (await evaluate(unavailable)).status,
    'linked_context_restore_unavailable'
  );
  assert.strictEqual(unavailable.calls.scan,0);
  assert.strictEqual(unavailable.calls.reconcile,0);

  var failedRestore=environment({
    existingLink:legacyLinked.window.ConferenceLinkStore.get(),
    configureFailure:true
  });
  assert.strictEqual(
    (await evaluate(failedRestore)).status,
    'linked_context_restore_failed'
  );
  assert.strictEqual(failedRestore.calls.configure,1);
  assert.strictEqual(failedRestore.calls.scan,0);
  assert.strictEqual(failedRestore.calls.reconcile,0);

  for(var isolation of [
    {manualRelink:true},
    {restoreMarker:true}
  ]){
    var isolated=environment(Object.assign({
      existingLink:legacyLinked.window.ConferenceLinkStore.get()
    },isolation));
    assert.strictEqual(
      (await evaluate(isolated)).status,'manual_relink_required'
    );
    assert.strictEqual(isolated.calls.configure,0);
    assert.strictEqual(isolated.calls.scan,0);
    assert.strictEqual(isolated.calls.reconcile,0);
  }

  var unpublished=environment();
  assert.strictEqual(
    (await evaluate(unpublished)).status,
    'no_existing_publish_attempt'
  );
  assert.strictEqual(unpublished.calls.scan,1);
  assert.strictEqual(unpublished.calls.reconcile,0);

  for(var state of [
    'unpublished','local_only','waiting_for_authorization',
    'ready_to_publish'
  ]){
    var ignored=environment({appData:{
      conferences:[{id:'local-1',name:'Conference'}],
      conferenceLifecycle:{schemaVersion:1,records:{
        'local-1':{
          localConferenceId:'local-1',
          localLifecycle:'active',
          cloudLifecycle:state,
          localContentVersion:0,
          publishMetadata:null
        }
      }}
    }});
    assert.strictEqual(
      (await evaluate(ignored)).status,
      'no_existing_publish_attempt'
    );
    assert.strictEqual(ignored.calls.reconcile,0);
  }

  var candidate=environment({candidates:[{
    localConferenceId:'local-1',
    operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    requestedCloudId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  }]});
  assert.strictEqual((await evaluate(candidate)).status,'linked');
  assert.strictEqual(candidate.calls.reconcile,1);

  var resolveGate;
  var gatePromise=new Promise(function(resolve){resolveGate=resolve;});
  var concurrent=environment({
    candidates:[{localConferenceId:'local-1'}],
    gate:{promise:gatePromise}
  });
  var first=evaluate(concurrent);
  var second=evaluate(concurrent);
  await Promise.resolve();
  resolveGate({ok:true,status:'cloud_linked'});
  await Promise.all([first,second]);
  assert.strictEqual(concurrent.calls.reconcile,1);

  var scanFailure=environment({scanFailure:true});
  assert.strictEqual(
    (await evaluate(scanFailure)).status,'recovery_scan_failed'
  );
  assert.strictEqual(scanFailure.calls.reconcile,0);

  assert.strictEqual(
    candidate.window.AutomaticConferenceLinking
      .initialize().status,
    'already_initialized'
  );
  assert.strictEqual(
    candidate.window.AutomaticConferenceLinking
      .getState().evaluatingConferenceIds.length,
    0
  );

  console.log('automatic conference linking tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
