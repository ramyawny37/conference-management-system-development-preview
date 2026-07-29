'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var ids={
  conflict:'11111111-1111-4111-8111-111111111111',
  conference:'22222222-2222-4222-8222-222222222222',
  source:'33333333-3333-4333-8333-333333333333',
  resolution:'44444444-4444-4444-8444-444444444444'
};

function delay(){
  return new Promise(function(resolve){setTimeout(resolve,0);});
}

function load(settings){
  settings=settings||{};
  var calls=[];
  var linkSaves=0;
  var renderCount=0;
  var confirmations=0;
  var currentConference={id:'local-1',name:'Local'};
  var releaseExecutor;
  var releaseApplication;
  var plan={
    conflictId:ids.conflict,
    conferenceId:ids.conference,
    strategy:'keep_local',
    baseRevision:5,
    actualRevision:5,
    sourceRevision:4,
    sourceOperationId:ids.source,
    resolutionOperationId:ids.resolution,
    schemaVersion:'1',
    appVersion:'4.0.0',
    resolvedSnapshot:{id:'local-1',name:'Local'},
    selectedPaths:[]
  };
  var executionResult=settings.executionResult||{
    ok:true,
    status:'resolved',
    data:{
      conflictId:ids.conflict,
      conferenceId:ids.conference,
      strategy:'keep_local',
      operationId:ids.resolution,
      resolvedRevision:6
    }
  };
  var planner={
    getConflict:function(){
      return Promise.resolve({ok:true,data:{
        conflictId:ids.conflict,
        conferenceId:ids.conference,
        operationId:ids.source,
        expectedRevision:4,
        actualRevision:5,
        serverSnapshot:{id:'local-1',name:'Remote'},
        createdAt:'2026-07-29T10:00:00.000Z'
      }});
    },
    compareSnapshots:function(){
      return {ok:true,data:{
        summary:{added:0,removed:0,changed:1},
        changes:[{path:'/name',type:'changed',
          localValue:'Local',serverValue:'Remote'}]
      }};
    },
    classifyConflict:function(){
      return {ok:true,data:{level:'low'}};
    },
    buildResolutionPlan:function(){
      return {ok:true,data:JSON.parse(JSON.stringify(plan))};
    },
    validateResolutionPlan:function(){
      return {ok:true};
    }
  };
  var links={
    get:function(){
      return {
        localConferenceId:'local-1',
        remoteConferenceId:ids.conference,
        remoteName:'Remote',
        knownRevision:4,
        actualRevision:5,
        linkStatus:'needs_resolution',
        conflictId:ids.conflict,
        conflictStatus:'active'
      };
    },
    save:function(input){
      linkSaves++;
      return {ok:true,data:input};
    }
  };
  var drafts={
    save:function(){
      calls.push('saveDraft');
      return Promise.resolve({ok:true,data:{
        executionStatus:'pending'
      }});
    },
    saveExecutionResult:function(localId,result){
      calls.push('saveExecutionResult');
      assert.strictEqual(localId,'local-1');
      assert.strictEqual(result.data.operationId,ids.resolution);
      return Promise.resolve(settings.saveExecutionFails
        ?{ok:false,status:'storage_failed'}
        :{ok:true,status:'executed'});
    },
    markStale:function(){
      calls.push('markStale');
      return Promise.resolve({ok:true,status:'stale'});
    },
    get:function(){
      return Promise.resolve({ok:false,status:'not_found'});
    }
  };
  var executor={
    executeResolutionPlan:function(input){
      calls.push('executeRpc');
      assert.strictEqual(input.resolutionOperationId,ids.resolution);
      if(!settings.deferExecutor){
        return Promise.resolve(executionResult);
      }
      return new Promise(function(resolve){
        releaseExecutor=function(){resolve(executionResult);};
      });
    }
  };
  var finalizer={
    finalize:function(localId){
      calls.push('finalize');
      assert.strictEqual(localId,'local-1');
      return Promise.resolve(settings.finalizationFails
        ?{ok:false,status:'finalization_incomplete'}
        :{ok:true,status:'finalization_completed',data:{
          pendingLocalApplication:settings.remoteWins===true
        }});
    }
  };
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Date:Date,
    Array:Array,
    structuredClone:global.structuredClone,
    APP_RELEASE:{version:'4.0.0'},
    getCurrentConference:function(){return currentConference;},
    renderSettings:function(){renderCount++;}
    ,
    confirm:function(){confirmations++;return true;},
    appData:{currentConferenceId:'local-1',
      conferences:[{id:'local-1',name:'Local'}]}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(
      root,'js/sync/conflict-resolution-ui.js'
    ),'utf8'),
    sandbox,
    {filename:'conflict-resolution-ui.js'}
  );
  var options={
    planner:planner,
    links:links,
    drafts:drafts,
    executor:executor,
    finalizer:finalizer,
    remote:{},
    queue:{
      markConflictResolved:function(){
        throw new Error('UI_QUEUE_FINALIZATION_USED');
      }
    },
    pending:{
      save:function(){throw new Error('UI_PENDING_SAVE_USED');},
      get:function(){return Promise.resolve({
        ok:true,data:{status:'pending',localConferenceId:'local-1'}
      });}
    },
    adapter:{
      apply:function(input){
        calls.push('applyRemote');
        assert.strictEqual(input.localConferenceId,'local-1');
        if(!settings.deferApplication){
          return Promise.resolve({ok:true,status:'applied'});
        }
        return new Promise(function(resolve){
          releaseApplication=function(){
            resolve({ok:true,status:'applied'});
          };
        });
      }
    }
  };
  sandbox.ConflictResolution=planner;
  sandbox.ConferenceLinkStore=links;
  sandbox.ConflictResolutionDraftStore=drafts;
  sandbox.ConflictExecutor=executor;
  sandbox.ConflictFinalizationService=finalizer;
  sandbox.SupabaseSnapshotSync=options.remote;
  sandbox.OfflineSyncQueue=options.queue;
  sandbox.PendingRemoteApplicationStore=options.pending;
  sandbox.LocalSnapshotApplication=options.adapter;
  return {
    ui:sandbox.ConflictResolutionUI,
    options:options,
    calls:calls,
    linkSaves:function(){return linkSaves;},
    renderCount:function(){return renderCount;},
    confirmations:function(){return confirmations;},
    switchConference:function(){
      currentConference={id:'local-2',name:'Other'};
    },
    releaseExecutor:function(){releaseExecutor();},
    releaseApplication:function(){releaseApplication();}
  };
}

async function prepare(environment){
  assert.strictEqual((await environment.ui.loadConflict({
    localConferenceId:'local-1',
    localSnapshot:{id:'local-1',name:'Local'}
  },environment.options)).ok,true);
  assert.strictEqual(
    environment.ui.buildPlan('keep_local',environment.options).ok,
    true
  );
}

async function run(){
  var success=load();
  await prepare(success);
  var reviewLinkWrites=success.linkSaves();
  assert.strictEqual(
    (await success.ui.execute(success.options)).status,
    'finalization_completed'
  );
  assert.deepStrictEqual(success.calls,[
    'saveDraft','executeRpc','saveExecutionResult','finalize'
  ]);
  assert.strictEqual(success.linkSaves(),reviewLinkWrites);

  var saveFailure=load({saveExecutionFails:true});
  await prepare(saveFailure);
  assert.strictEqual(
    (await saveFailure.ui.execute(saveFailure.options)).status,
    'execution_result_storage_failed'
  );
  assert.strictEqual(saveFailure.calls.indexOf('finalize'),-1);

  var finalizationFailure=load({finalizationFails:true});
  await prepare(finalizationFailure);
  assert.strictEqual(
    (await finalizationFailure.ui.execute(
      finalizationFailure.options
    )).status,
    'finalization_incomplete'
  );
  assert.deepStrictEqual(finalizationFailure.calls,[
    'saveDraft','executeRpc','saveExecutionResult','finalize'
  ]);

  var duplicate=load({executionResult:{
    ok:true,status:'duplicate',data:{
      conflictId:ids.conflict,
      conferenceId:ids.conference,
      strategy:'keep_local',
      operationId:ids.resolution,
      resolvedRevision:6
    }
  }});
  await prepare(duplicate);
  await duplicate.ui.execute(duplicate.options);
  assert.deepStrictEqual(duplicate.calls,[
    'saveDraft','executeRpc','saveExecutionResult','finalize'
  ]);

  var changed=load({executionResult:{
    ok:true,status:'conflict_changed',data:{
      conflictId:ids.conflict,
      conferenceId:ids.conference,
      operationId:ids.resolution,
      expectedRevision:5,
      actualRevision:7
    }
  }});
  await prepare(changed);
  assert.strictEqual(
    (await changed.ui.execute(changed.options)).status,
    'conflict_changed'
  );
  assert.deepStrictEqual(changed.calls,[
    'saveDraft','executeRpc','markStale'
  ]);

  var doubleClick=load({deferExecutor:true});
  await prepare(doubleClick);
  var first=doubleClick.ui.execute(doubleClick.options);
  await delay();
  assert.strictEqual(
    (await doubleClick.ui.execute(doubleClick.options)).status,
    'busy'
  );
  doubleClick.releaseExecutor();
  await first;

  var stale=load({deferExecutor:true});
  await prepare(stale);
  stale.ui.executeCurrent();
  await delay();
  stale.switchConference();
  stale.releaseExecutor();
  await delay();
  await delay();
  assert.strictEqual(stale.renderCount(),0);

  var uiSource=fs.readFileSync(path.join(
    root,'js/sync/conflict-resolution-ui.js'
  ),'utf8');
  var executorSource=fs.readFileSync(path.join(
    root,'js/sync/conflict-executor.js'
  ),'utf8');
  var finalizerSource=fs.readFileSync(path.join(
    root,'js/sync/conflict-finalization-service.js'
  ),'utf8');
  [uiSource,executorSource,finalizerSource].forEach(function(source){
    assert.strictEqual(/\bknownRevision\s*:/.test(source),false);
  });
  assert.strictEqual(
    /links\.save\([\s\S]{0,350}\bactualRevision\s*:/.test(uiSource),
    false
  );
  assert.strictEqual(
    /markConflictResolved\s*\(/.test(uiSource),
    false
  );
  assert.strictEqual(
    /\.pending\.save\s*\(/.test(uiSource),
    false
  );
  assert.strictEqual(
    /\.markCompleted\s*\(/.test(uiSource),
    false
  );

  var application=load({deferApplication:true});
  application.ui.applyCurrentServer();
  await delay();
  assert.strictEqual(application.confirmations(),1);
  application.ui.applyCurrentServer();
  assert.strictEqual(application.confirmations(),1);
  application.switchConference();
  application.releaseApplication();
  await delay();
  await delay();
  assert.strictEqual(application.renderCount(),0);
  assert.deepStrictEqual(application.calls,['applyRemote']);

  console.log('conflict resolution UI phase 3.5 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
