'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var webcrypto=require('crypto').webcrypto;

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/storage/storage-repository.js'
),'utf8');
var arbitrationSource=fs.readFileSync(path.resolve(
  __dirname,'../js/storage/local-persistence-arbitration.js'
),'utf8');

function environment(results,options){
  options=options||{};
  var saved=[];
  var handled=[];
  var wakes=[];
  var index=0;
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    Array:Array,String:String,Number:Number,Date:Date,
    TextEncoder:TextEncoder,Uint8Array:Uint8Array,crypto:webcrypto,
    SK:'conf_v5',BrowserStorageNamespace:{environment:'development'},
    localStorage:{getItem:function(){return null;},setItem:function(){}},
    structuredClone:global.structuredClone,
    AppIndexedDB:{
      stores:{conferences:'conferences'},
      getAppSnapshot:function(){return Promise.resolve(null);},
      validateAppSnapshot:function(){return {valid:false};},
      saveAppSnapshot:function(snapshot){
        saved.push(snapshot);
        return Promise.resolve({ok:true,status:'saved'});
      }
    },
    OfflineFirstIntegration:{
      handleLocalSave:function(snapshot){
        handled.push(snapshot);
        return Promise.resolve(results[index++]);
      }
    },
    AutomaticSyncOrchestrator:{
      wakeForLocalSave:function(wakeOptions){
        wakes.push(wakeOptions||null);
        return environmentOptions.forceWakeFailure
          ?{ok:false,status:'start_failed'}
          :{ok:true,status:'wake_accepted'};
      }
    }
  };
  var environmentOptions=options;
  sandbox.window=sandbox;
  vm.runInNewContext(arbitrationSource,sandbox,{filename:'local-persistence-arbitration.js'});
  vm.runInNewContext(source,sandbox,{filename:'storage-repository.js'});
  return {window:sandbox,saved:saved,handled:handled,wakes:wakes};
}

async function run(){
  var queued={ok:true,status:'queued',data:{queueStatus:'enqueued'}};
  var coalesced={ok:true,status:'queued',data:{queueStatus:'coalesced'}};
  var env=environment([queued,coalesced]);
  var first={currentConferenceId:'local',conferences:[{
    id:'local',transports:[{id:'bus-1'}],houses:[]
  }]};
  var second={currentConferenceId:'local',conferences:[{
    id:'local',transports:[{id:'bus-1'}],houses:[{id:'house-1'}]
  }]};
  await Promise.all([
    env.window.StorageRepository.saveAppSnapshot(first),
    env.window.StorageRepository.saveAppSnapshot(second)
  ]);
  assert.strictEqual(env.saved.length,2);
  assert.strictEqual(env.handled.length,2);
  assert.strictEqual(env.wakes.length,2);
  assert.strictEqual(env.handled[0].conferences[0].transports.length,1);
  assert.strictEqual(env.handled[1].conferences[0].houses.length,1);

  var skipped=environment([{
    ok:true,status:'skipped',data:{reason:'CONFERENCE_NOT_CONFIGURED'}
  }]);
  await skipped.window.StorageRepository.saveAppSnapshot(first);
  assert.strictEqual(skipped.wakes.length,0);

  var localOnly=environment([queued]);
  await localOnly.window.StorageRepository.saveAppSnapshot(first,{
    skipSyncQueue:true
  });
  assert.strictEqual(localOnly.handled.length,0);
  assert.strictEqual(localOnly.wakes.length,0);

  var failedWake=environment([queued],{forceWakeFailure:true});
  var persisted=await failedWake.window.StorageRepository.saveAppSnapshot(
    second
  );
  assert.strictEqual(persisted.status,'persisted');
  assert.strictEqual(failedWake.saved.length,1);
  assert.strictEqual(failedWake.handled.length,1);
  assert.strictEqual(failedWake.wakes.length,1);

  console.log('local save queue wake tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
