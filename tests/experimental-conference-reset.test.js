'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var source=fs.readFileSync(path.join(__dirname,'../js/sync/experimental-conference-reset.js'),'utf8');
var indexSource=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
var workerSource=fs.readFileSync(path.join(__dirname,'../service-worker.js'),'utf8');
assert.strictEqual(indexSource.includes('js/sync/experimental-conference-reset.js'),false);
assert.strictEqual(workerSource.includes('js/sync/experimental-conference-reset.js'),false);
var events=[],linkPresent=true,appData={currentConferenceId:'local-a',conferences:[{id:'local-a'},{id:'keep'}],conferenceLifecycle:{records:{'local-a':{},keep:{}}}};
var sandbox={window:null,Promise:Promise,String:String,Date:Date,Error:Error,appData:appData,
  AutomaticSyncOrchestrator:{stop:function(){events.push('stop');return {promise:Promise.resolve()};},start:function(){events.push('restart');}},
  ConferenceEditLockManager:{release:function(){events.push('release');return Promise.resolve();},authorizeReset:function(){return 'reset-token';}},
  OfflineSyncQueue:{discardConferenceOperations:function(id){events.push('discard:'+id);return Promise.resolve({ok:true,data:{count:2}});},getOperationsByConference:function(){events.push('verify-queue');return Promise.resolve({ok:true,data:{operations:[]}});}},
  SupabaseClientLayer:{getClient:function(){return {
    from:function(table){
      assert.strictEqual(table,'conferences');
      return {update:function(value){
        assert.ok(value.deleted_at);
        return {eq:function(key,id){
          events.push('archive:'+id);
          return Promise.resolve({error:null});
        }};
      }};
    }
  };}},
  OfflineFirstIntegration:{removeConferenceSync:function(id){events.push('remove-context:'+id);return {ok:true};},getConferenceSyncState:function(){return {context:null};}},
  ConferenceLinkStore:{get:function(){return linkPresent?{localConferenceId:'local-a',remoteConferenceId:'22222222-2222-4222-8222-222222222222'}:null;},remove:function(id){events.push('unlink:'+id);linkPresent=false;return {ok:true};}},
  save:function(options){events.push('save');assert.strictEqual(options.skipSyncQueue,true);assert.strictEqual(options.lockAuthorization,'reset-token');return true;}
};sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
(async function(){
  var refused=await sandbox.ExperimentalConferenceReset.reset('local-a');assert.strictEqual(refused.status,'confirmation_required');assert.deepStrictEqual(events,[]);
  var result=await sandbox.ExperimentalConferenceReset.reset('local-a',{confirmed:true});assert.strictEqual(result.ok,true);assert.strictEqual(result.data.discardedOperations,2);
  assert.deepStrictEqual(events,['stop','release','discard:22222222-2222-4222-8222-222222222222','archive:22222222-2222-4222-8222-222222222222','remove-context:local-a','unlink:local-a','verify-queue','save','restart']);
  assert.deepStrictEqual(appData.conferences,[{id:'keep'}]);assert.strictEqual(appData.conferenceLifecycle.records['local-a'],undefined);assert.strictEqual(appData.currentConferenceId,null);
  var failureEvents=[];
  var failedSandbox={window:null,Promise:Promise,String:String,Date:Date,Error:Error,appData:{currentConferenceId:'x',conferences:[{id:'x'}]},
    AutomaticSyncOrchestrator:{stop:function(){failureEvents.push('stop');return {promise:Promise.resolve()};}},ConferenceEditLockManager:{release:function(){return Promise.resolve();}},
    OfflineSyncQueue:{discardConferenceOperations:function(){failureEvents.push('discard');return Promise.resolve({ok:false});}},ConferenceLinkStore:{get:function(){return {remoteConferenceId:'22222222-2222-4222-8222-222222222222'};}},save:function(){failureEvents.push('save');return true;}}
  ;failedSandbox.window=failedSandbox;vm.runInNewContext(source,failedSandbox);var failed=await failedSandbox.ExperimentalConferenceReset.reset('x',{confirmed:true});
  assert.strictEqual(failed.ok,false);assert.strictEqual(failed.status,'reset_failed');assert.strictEqual(failed.data.failedStage,'discard_queue');assert.deepStrictEqual(failureEvents,['stop','discard'],'partial failure must not report success or save local deletion');
  console.log('experimental conference reset tests: passed');
})().catch(function(e){console.error(e);process.exitCode=1;});
