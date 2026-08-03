'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');

function delay(milliseconds){
  return new Promise(function(resolve){setTimeout(resolve,milliseconds);});
}

function load(){
  var sandbox={
    window:null,
    Promise:Promise,
    Date:Date,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Math:Math,
    structuredClone:global.structuredClone,
    navigator:{onLine:true},
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    addEventListener:function(){},
    removeEventListener:function(){},
    SupabaseAuth:{getState:function(){return {authenticated:true};}},
    SupabaseClientLayer:{
      getState:function(){return {configured:true,available:true};},
      getClient:function(){return {};}
    }
  };
  sandbox.window=sandbox;
  [
    'js/sync/sync-scheduler-state.js',
    'js/sync/automatic-sync-orchestrator.js'
  ].forEach(function(file){
    vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),
      sandbox,
      {filename:file}
    );
  });
  return sandbox;
}

function baseOptions(overrides){
  return Object.assign({
    debounceMs:0,
    getCurrentConference:function(){return {id:'local-a'};},
    preferences:{get:function(){
      return {cloudSyncEnabled:true,automaticSyncEnabled:true};
    }},
    serviceCheck:function(){return Promise.resolve({available:true});}
  },overrides||{});
}

async function run(){
  var remoteId='11111111-1111-4111-8111-111111111111';
  var linkedRecord={
    localConferenceId:'local-a',
    remoteConferenceId:remoteId,
    knownRevision:2,
    linkStatus:'linked'
  };
  var recovery=load();
  var statuses=['finalizing_conflict','linked','linked'];
  var finalizations=0;
  var runnerCalls=0;
  var linkingCalls=0;
  recovery.AutomaticSyncOrchestrator.start(baseOptions({
    stateResolver:{resolve:function(){
      return Promise.resolve({
        ok:true,status:statuses.shift()||'linked',
        data:{link:linkedRecord,remoteConferenceId:remoteId}
      });
    }},
    integration:{getConferenceSyncState:function(){return {
      context:{
        localConferenceId:'local-a',
        conferenceId:remoteId,
        baseRevision:2
      }
    };}},
    finalizationService:{finalize:function(){
      finalizations++;
      return Promise.resolve({
        ok:true,status:'finalization_completed'
      });
    }},
    automaticLinking:{evaluate:function(){
      linkingCalls++;
      return Promise.resolve({ok:true,data:{linked:true}});
    }},
    queueRunner:{run:function(){
      runnerCalls++;
      return Promise.resolve({ok:true,status:'empty'});
    }}
  }));
  await delay(10);
  assert.strictEqual(finalizations,1);
  assert.strictEqual(linkingCalls,0);
  assert.strictEqual(runnerCalls,1);
  assert.strictEqual(
    recovery.AutomaticSyncOrchestrator.getState().conferenceState,
    'linked'
  );

  var pending=load();
  var pendingRuns=0;
  var applyCalls=0;
  pending.LocalSnapshotApplication={apply:function(){applyCalls++;}};
  pending.AutomaticSyncOrchestrator.start(baseOptions({
    stateResolver:{resolve:function(){
      return Promise.resolve({
        ok:true,status:'pending_local_application'
      });
    }},
    queueRunner:{run:function(){
      pendingRuns++;
      return Promise.resolve({ok:true});
    }}
  }));
  await delay(10);
  assert.strictEqual(pendingRuns,0);
  assert.strictEqual(applyCalls,0);
  assert.strictEqual(
    pending.AutomaticSyncOrchestrator.getState().conferenceState,
    'pending_local_application'
  );

  var notifications=load();
  var notified=[];
  notifications.AutomaticSyncOrchestrator.subscribe(function(snapshot){
    notified.push([
      snapshot.connectivity,
      snapshot.conferenceState,
      snapshot.queueStatus
    ].join('|'));
  });
  notifications.AutomaticSyncOrchestrator.start(baseOptions({
    stateResolver:{resolve:function(){
      return Promise.resolve({ok:true,status:'needs_resolution'});
    }}
  }));
  await delay(10);
  for(var index=1;index<notified.length;index++){
    assert.notStrictEqual(notified[index],notified[index-1]);
  }

  var compatible=load();
  var compatibleEvaluateCalls=0;
  var compatibleRunnerCalls=0;
  compatible.AutomaticSyncOrchestrator.start(baseOptions({
    stateResolver:{resolve:function(){return Promise.resolve({
      ok:true,status:'linked',
      data:{link:linkedRecord,remoteConferenceId:remoteId}
    });}},
    integration:{getConferenceSyncState:function(){return {context:{
      localConferenceId:'local-a',conferenceId:remoteId,baseRevision:2
    }};}},
    automaticLinking:{evaluate:function(){
      compatibleEvaluateCalls++;
    }},
    queueRunner:{run:function(){
      compatibleRunnerCalls++;
      return Promise.resolve({ok:true,status:'empty'});
    }}
  }));
  await delay(10);
  assert.strictEqual(compatibleEvaluateCalls,0);
  assert.strictEqual(compatibleRunnerCalls,1);

  var restored=load();
  var restoredContext=null;
  var restoreEvaluateCalls=0;
  var restoreRunnerCalls=0;
  var restoreResolveCalls=0;
  restored.AutomaticSyncOrchestrator.start(baseOptions({
    stateResolver:{resolve:function(){
      restoreResolveCalls++;
      return Promise.resolve({
        ok:true,status:'linked',
        data:{link:linkedRecord,remoteConferenceId:remoteId}
      });
    }},
    integration:{getConferenceSyncState:function(){return {
      context:restoredContext
    };}},
    automaticLinking:{evaluate:function(){
      restoreEvaluateCalls++;
      restoredContext={
        localConferenceId:'local-a',
        conferenceId:remoteId,
        baseRevision:2
      };
      return Promise.resolve({
        ok:true,status:'already_linked',data:{
          linked:true,contextRestored:true
        }
      });
    }},
    queueRunner:{run:function(){
      restoreRunnerCalls++;
      return Promise.resolve({ok:true,status:'empty'});
    }}
  }));
  await delay(10);
  assert.strictEqual(restoreEvaluateCalls,1);
  assert.ok(restoreResolveCalls>=2);
  assert.strictEqual(restoreRunnerCalls,1);
  assert.strictEqual(
    restored.AutomaticSyncOrchestrator.getState().conferenceState,
    'linked'
  );

  for(var mismatch of [
    {
      localConferenceId:'local-a',
      conferenceId:'22222222-2222-4222-8222-222222222222',
      baseRevision:2
    },
    {
      localConferenceId:'local-a',
      conferenceId:remoteId,
      baseRevision:1
    }
  ]){
    var mismatched=load();
    var mismatchEvaluateCalls=0;
    var mismatchRunnerCalls=0;
    mismatched.AutomaticSyncOrchestrator.start(baseOptions({
      stateResolver:{resolve:function(){return Promise.resolve({
        ok:true,status:'linked',
        data:{link:linkedRecord,remoteConferenceId:remoteId}
      });}},
      integration:{getConferenceSyncState:function(){return {
        context:mismatch
      };}},
      automaticLinking:{evaluate:function(){
        mismatchEvaluateCalls++;
        return Promise.resolve({
          ok:false,status:'linked_context_restore_failed',
          data:{linked:false}
        });
      }},
      queueRunner:{run:function(){
        mismatchRunnerCalls++;
        return Promise.resolve({ok:true});
      }}
    }));
    await delay(10);
    assert.strictEqual(mismatchEvaluateCalls,1);
    assert.strictEqual(mismatchRunnerCalls,0);
    assert.strictEqual(
      mismatched.AutomaticSyncOrchestrator.getState().conferenceState,
      'linked_context_missing'
    );
  }

  var unavailable=load();
  var unavailableEvaluateCalls=0;
  var unavailableRunnerCalls=0;
  unavailable.AutomaticSyncOrchestrator.start(baseOptions({
    stateResolver:{resolve:function(){return Promise.resolve({
      ok:true,status:'linked',
      data:{link:linkedRecord,remoteConferenceId:remoteId}
    });}},
    automaticLinking:{evaluate:function(){unavailableEvaluateCalls++;}},
    queueRunner:{run:function(){unavailableRunnerCalls++;}}
  }));
  await delay(10);
  assert.strictEqual(unavailableEvaluateCalls,0);
  assert.strictEqual(unavailableRunnerCalls,0);
  assert.strictEqual(
    unavailable.AutomaticSyncOrchestrator.getState().conferenceState,
    'linked_context_unavailable'
  );

  var cloudLinked=load();
  var cloudEvaluateCalls=0;
  var cloudRunnerCalls=0;
  var cloudRecord=Object.assign({},linkedRecord,{
    linkStatus:'cloud_linked'
  });
  cloudLinked.AutomaticSyncOrchestrator.start(baseOptions({
    stateResolver:{resolve:function(){return Promise.resolve({
      ok:true,status:'linked',
      data:{link:cloudRecord,remoteConferenceId:remoteId}
    });}},
    integration:{getConferenceSyncState:function(){return {context:null};}},
    automaticLinking:{evaluate:function(){cloudEvaluateCalls++;}},
    queueRunner:{run:function(){cloudRunnerCalls++;}}
  }));
  await delay(10);
  assert.strictEqual(cloudEvaluateCalls,0);
  assert.strictEqual(cloudRunnerCalls,0);
  assert.strictEqual(
    cloudLinked.AutomaticSyncOrchestrator.getState().conferenceState,
    'linked_context_missing'
  );

  for(var isolationMode of ['restore','manual']){
    var isolated=load();
    var isolatedEvaluateCalls=0;
    var isolatedRunnerCalls=0;
    isolated.AutomaticSyncOrchestrator.start(baseOptions({
      stateResolver:{resolve:function(){return Promise.resolve({
        ok:true,status:'linked',
        data:{link:linkedRecord,remoteConferenceId:remoteId}
      });}},
      integration:{getConferenceSyncState:function(){return {context:null};}},
      fullBackupService:{
        isFullRestoreCloudReviewPending:function(){
          return isolationMode==='restore';
        },
        isManualRelinkRequired:function(){
          return isolationMode==='manual';
        }
      },
      automaticLinking:{evaluate:function(){isolatedEvaluateCalls++;}},
      queueRunner:{run:function(){isolatedRunnerCalls++;}}
    }));
    await delay(10);
    assert.strictEqual(isolatedEvaluateCalls,0);
    assert.strictEqual(isolatedRunnerCalls,0);
    assert.strictEqual(
      isolated.AutomaticSyncOrchestrator.getState().conferenceState,
      isolationMode==='restore'
        ?'restore_isolated':'manual_relink_required'
    );
  }

  console.log('automatic-sync-orchestrator phase 5 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
