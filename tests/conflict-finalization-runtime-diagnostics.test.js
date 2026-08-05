'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/member-runtime-diagnostics.js'
),'utf8');

function delay(){return new Promise(function(resolve){setTimeout(resolve,0);});}

async function run(){
  var reads=[];
  var writes=0;
  var renders=0;
  var draft={
    status:'executed',
    executionStatus:'finalizing',
    executionResult:{ok:true,status:'server_selected'},
    finalization:{
      pendingApplicationStored:true,
      revisionPublished:true,
      linkMetadataUpdated:false,
      queueUpdated:false
    }
  };
  var pending={
    status:'pending',resolvedRevision:18,
    applicationState:{validationCompleted:false,backupStored:false}
  };
  var sandbox={
    window:null,Promise:Promise,JSON:JSON,Object:Object,Array:Array,
    String:String,Number:Number,
    structuredClone:function(value){
      return JSON.parse(JSON.stringify(value));
    },
    getCurrentConference:function(){return {id:'local-1'};},
    AppIndexedDB:{
      getRecord:function(store){
        reads.push(store);
        return Promise.resolve(store==='conflict_resolution_drafts'
          ?draft:pending);
      },
      putRecord:function(){writes++;return Promise.resolve();}
    },
    ConferenceLinkStore:{
      get:function(){return {
        linkStatus:'needs_resolution',pendingLocalApplication:false,
        knownRevision:18,actualRevision:18
      };},
      getWriteDiagnostics:function(){return [{
        eventName:'LINK_STATUS_REGRESSION_DETECTED',writerName:'TestWriter'
      }];}
    },
    AutomaticSyncOrchestrator:{getState:function(){return {}; }},
    DiscoveredConferenceOpenService:{getState:function(){return {}; }},
    ConferenceRealtimeManager:{getState:function(){return {}; }},
    renderSettings:function(){renders++;}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{
    filename:'member-runtime-diagnostics.js'
  });

  sandbox.MemberRuntimeDiagnostics.read();
  await delay();
  var result=sandbox.MemberRuntimeDiagnostics.read();
  assert.deepStrictEqual(reads,[
    'conflict_resolution_drafts','pending_remote_applications'
  ]);
  assert.strictEqual(writes,0);
  assert.strictEqual(renders,1);
  assert.strictEqual(result['draft.exists'],true);
  assert.strictEqual(result['draft.status'],'executed');
  assert.strictEqual(result['draft.executionStatus'],'finalizing');
  assert.strictEqual(result['draft.executionResult'].status,'server_selected');
  assert.strictEqual(result['draft.finalizationState'].revisionPublished,true);
  assert.strictEqual(result['pending.exists'],true);
  assert.strictEqual(result['pending.status'],'pending');
  assert.strictEqual(result['pending.revision'],18);
  assert.strictEqual(result['pending.applicationState'].backupStored,false);
  assert.strictEqual(result['link.linkStatus'],'needs_resolution');
  assert.strictEqual(result['link.pendingLocalApplication'],false);
  assert.strictEqual(result['link.knownRevision'],18);
  assert.strictEqual(result['link.actualRevision'],18);
  assert.strictEqual(result.linkStatusWriteTrace.length,1);
  assert.strictEqual(result.linkStatusWriteTrace[0].writerName,'TestWriter');
  assert.strictEqual(result.firstIncompleteFlag,'linkMetadataUpdated');

  console.log('conflict finalization runtime diagnostics tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
