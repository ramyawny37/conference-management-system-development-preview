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
  var recovery=load();
  var statuses=['finalizing_conflict','linked','linked'];
  var finalizations=0;
  var runnerCalls=0;
  var linkingCalls=0;
  recovery.AutomaticSyncOrchestrator.start(baseOptions({
    stateResolver:{resolve:function(){
      return Promise.resolve({
        ok:true,status:statuses.shift()||'linked'
      });
    }},
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

  console.log('automatic-sync-orchestrator phase 5 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
