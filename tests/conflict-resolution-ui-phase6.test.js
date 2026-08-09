'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/conflict-resolution-ui.js'
),'utf8');

function delay(){
  return new Promise(function(resolve){setTimeout(resolve,0);});
}

function plan(){
  return {
    conflictId:'conflict-a',
    conferenceId:'remote-a',
    strategy:'keep_server',
    sourceOperationId:'source-a',
    resolutionOperationId:'resolution-a',
    sourceRevision:1,
    actualRevision:2,
    baseRevision:2,
    resolvedSnapshot:{id:'local-a'},
    selectedPaths:[]
  };
}

function load(settings){
  settings=settings||{};
  var sideEffects=[];
  var link=Object.assign({
    localConferenceId:'local-a',
    remoteConferenceId:'remote-a',
    linkStatus:'needs_resolution',
    conflictStatus:'active',
    conflictId:'conflict-a',
    resolutionOperationId:'resolution-a',
    resolvedRevision:2,
    pendingLocalApplication:false
  },settings.link||{});
  var pending=settings.pending||null;
  var draft=settings.draft||null;
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
    ConferenceLinkStore:{get:function(){return link;}},
    ConflictResolution:{
      validateResolutionPlan:function(){return {ok:true};}
    },
    PendingRemoteApplicationStore:{
      get:function(){
        if(settings.pendingReadFails){
          return Promise.resolve({ok:false,status:'read_failed'});
        }
        return Promise.resolve(pending
          ?{ok:true,data:pending}
          :{ok:false,status:'not_found'});
      },
      verify:function(){return Promise.resolve(
        settings.pendingVerified!==false
      );}
    },
    ConflictResolutionDraftStore:{
      get:function(){
        if(settings.draftReadFails){
          return Promise.resolve({ok:false,status:'read_failed'});
        }
        return Promise.resolve(draft
          ?{ok:true,data:draft}
          :{ok:false,status:'not_found'});
      }
    },
    ConflictExecutor:{executeResolutionPlan:function(){
      sideEffects.push('executor');
    }},
    ConflictFinalizationService:{finalize:function(){
      sideEffects.push('finalizer');
    }},
    LocalSnapshotApplication:{apply:function(){
      sideEffects.push('application');
    }},
    renderSettings:function(){},
    DiagnosticsPrivacyPolicy:{canViewConferenceDiagnostics:function(){return true;}}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{
    filename:'conflict-resolution-ui.js'
  });
  return {
    ui:sandbox.ConflictResolutionUI,
    input:{localConference:{id:'local-a',name:'Local'}},
    sideEffects:sideEffects
  };
}

async function rendered(settings){
  var environment=load(settings);
  environment.ui.renderSection(environment.input);
  await delay();
  return {
    html:environment.ui.renderSection(environment.input),
    sideEffects:environment.sideEffects
  };
}

async function run(){
  var finalizing=await rendered({draft:{
    executionStatus:'finalizing',
    plan:plan()
  }});
  assert.ok(finalizing.html.indexOf(
    'ConflictResolutionUI.finalizeCurrent()'
  )>=0);

  var completed=await rendered({draft:{
    executionStatus:'completed',
    plan:plan()
  }});
  assert.strictEqual(completed.html.indexOf(
    'ConflictResolutionUI.finalizeCurrent()'
  ),-1);

  var trustedPending={
    status:'pending',
    localConferenceId:'local-a',
    remoteConferenceId:'remote-a',
    conflictId:'conflict-a',
    resolutionOperationId:'resolution-a',
    resolvedRevision:2
  };
  var trusted=await rendered({
    link:{
      linkStatus:'server_selected_pending_local_apply',
      pendingLocalApplication:true
    },
    pending:trustedPending
  });
  assert.ok(trusted.html.indexOf(
    'ConflictResolutionUI.applyCurrentServer()'
  )>=0);

  var mismatched=await rendered({
    link:{
      linkStatus:'server_selected_pending_local_apply',
      pendingLocalApplication:true
    },
    pending:Object.assign({},trustedPending,{
      remoteConferenceId:'remote-other'
    })
  });
  assert.strictEqual(mismatched.html.indexOf(
    'ConflictResolutionUI.applyCurrentServer()'
  ),-1);

  var applied=await rendered({
    link:{
      linkStatus:'server_selected_pending_local_apply',
      pendingLocalApplication:true
    },
    pending:Object.assign({},trustedPending,{status:'applied'})
  });
  assert.strictEqual(applied.html.indexOf(
    'ConflictResolutionUI.applyCurrentServer()'
  ),-1);

  var failedRead=await rendered({draftReadFails:true});
  [
    'ConflictResolutionUI.executeCurrent()',
    'ConflictResolutionUI.finalizeCurrent()',
    'ConflictResolutionUI.applyCurrentServer()',
    'ConflictResolutionUI.reviewCurrent()'
  ].forEach(function(action){
    assert.strictEqual(failedRead.html.indexOf(action),-1);
  });

  [
    finalizing,completed,trusted,mismatched,applied,failedRead
  ].forEach(function(item){
    assert.deepStrictEqual(item.sideEffects,[]);
  });

  console.log('conflict resolution UI phase 6 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
