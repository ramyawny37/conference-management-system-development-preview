'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');

function load(extra){
  var sandbox=Object.assign({
    window:null,
    Date:Date,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Error:Error,
    Promise:Promise
  },extra||{});
  sandbox.window=sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(root,'js/storage/full-backup.js'),'utf8'),
    sandbox,
    {filename:'full-backup.js'}
  );
  return {api:sandbox.FullBackupService,sandbox:sandbox};
}

function loadActualCandidateNormalizer(){
  var sandbox={
    window:null,
    Date:Date,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Math:Math,
    Error:Error,
    Promise:Promise,
    console:{log:function(){},warn:function(){},error:function(){}},
    structuredClone:global.structuredClone,
    appData:data('live','Live')
  };
  sandbox.window=sandbox;
  [
    'utils.js',
    'core.js',
    'people.js',
    'js/conference/accounts.js'
  ].forEach(function(file){
    vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),
      sandbox,
      {filename:file}
    );
  });
  return sandbox;
}

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function data(id,name){
  return {
    version:'2.0.0',
    currentConferenceId:id,
    conferences:[{id:id,name:name}],
    templates:[],
    archives:[],
    backups:[],
    houseTemplates:[],
    peopleDb:{version:'1.0.0',people:[]}
  };
}

function fixture(api){
  var previous=data('previous','Previous');
  var incoming=data('incoming','Incoming');
  var document=api.buildFullBackupDocument(incoming,{
    createdAt:'2026-07-30T10:11:12.345Z',
    appVersion:'3.1.1'
  });
  var candidate=api.prepareFullRestoreCandidate(document,{
    supportedDataSchemaVersion:'2.0.0'
  });
  return {
    previous:previous,
    incoming:incoming,
    document:document,
    candidate:candidate,
    input:{
      confirmed:true,
      backupDocument:document,
      candidateResult:candidate,
      preview:{replacement:{willReplaceAllApplicationData:true}}
    }
  };
}

function environment(fix,settings){
  settings=settings||{};
  var events=[];
  var indexedData=plain(fix.previous);
  var saveCount=0;
  var safetyBackupRecord=null;
  var localBackupStore={};
  var localValues={
    conf_v5:JSON.stringify(fix.previous)
  };
  var applied=fix.previous;
  var repository={
    createLocalBackup:function(snapshot,reason){
      events.push('safety');
      assert.strictEqual(reason,'before_full_restore');
      if(settings.safetyDeferred)return settings.safetyDeferred.promise;
      if(settings.safetyFail)return Promise.resolve(false);
      safetyBackupRecord={
        backupId:'safety-1',
        snapshot:plain(snapshot),
        createdAt:'2026-07-30T10:12:00.000Z'
      };
      localBackupStore[safetyBackupRecord.backupId]=plain(safetyBackupRecord);
      return Promise.resolve(safetyBackupRecord);
    },
    getLocalBackup:function(backupId){
      return Promise.resolve(
        Object.prototype.hasOwnProperty.call(localBackupStore,backupId)
          ?plain(localBackupStore[backupId])
          :null
      );
    },
    saveAppSnapshot:function(snapshot,options){
      saveCount++;
      events.push(saveCount===1?'candidateIndexedDb':'rollbackIndexedDb');
      assert.strictEqual(options.skipSyncQueue,true);
      assert.strictEqual(
        options.source,
        saveCount===1?'full_restore':'full_restore_rollback'
      );
      if(settings.indexedFail&&saveCount===1){
        return Promise.reject(new Error('INDEXED_FAILED'));
      }
      if(settings.rollbackIndexedFail&&saveCount>1){
        return Promise.reject(new Error('ROLLBACK_INDEXED_FAILED'));
      }
      indexedData=plain(snapshot);
      return Promise.resolve('**app_snapshot**');
    },
    getAppSnapshot:function(){
      events.push('verifyIndexedDb');
      return Promise.resolve({
        data:settings.verificationMismatch
          ?{version:'wrong',currentConferenceId:null,conferences:[]}
          :plain(indexedData)
      });
    }
  };
  var storage={
    getItem:function(key){
      events.push('get:'+key);
      return Object.prototype.hasOwnProperty.call(localValues,key)
        ?localValues[key]
        :null;
    },
    setItem:function(key,value){
      events.push('set:'+key);
      if(settings.localWriteFail&&key==='conf_v5'&&
        value!==JSON.stringify(fix.previous)){
        throw new Error('QUOTA_EXCEEDED');
      }
      if(settings.rollbackLocalFail&&key==='conf_v5'&&
        value===JSON.stringify(fix.previous)&&saveCount>1){
        throw new Error('ROLLBACK_LOCAL_FAILED');
      }
      if(settings.markerReadBackMismatch&&
        key==='conference_manager_full_restore_pending_cloud_review'){
        localValues[key]='{"version":0}';
        return;
      }
      localValues[key]=value;
    },
    removeItem:function(key){
      events.push('remove:'+key);
      delete localValues[key];
    }
  };
  var orchestrator={
    stop:function(){events.push('orchestratorStop');},
    start:function(){events.push('orchestratorStart');}
  };
  var options={
    currentAppData:fix.previous,
    supportedDataSchemaVersion:'2.0.0',
    repository:repository,
    storage:storage,
    orchestrator:orchestrator,
    normalizeCandidate:function(candidate){
      events.push('normalize');
      candidate.normalized=true;
      return candidate;
    },
    applyAppData:function(value){
      events.push('applyGlobal');
      applied=plain(value);
    }
  };
  return {
    events:events,
    repository:repository,
    storage:storage,
    options:options,
    getIndexed:function(){return indexedData;},
    getLocal:function(key){return localValues[key];},
    getApplied:function(){return applied;},
    getSafetyBackup:function(){
      return safetyBackupRecord
        ?localBackupStore[safetyBackupRecord.backupId]
        :null;
    },
    readSafetyBackup:function(backupId){
      return repository.getLocalBackup(backupId);
    }
  };
}

function deferred(){
  var resolve;
  var reject;
  var promise=new Promise(function(res,rej){resolve=res;reject=rej;});
  return {promise:promise,resolve:resolve,reject:reject};
}

async function testSuccessfulRestore(api){
  var fix=fixture(api);
  var env=environment(fix);
  var inputBefore=JSON.stringify(fix.input);
  var previousBefore=JSON.stringify(fix.previous);
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,true);
  assert.strictEqual(result.sourceBackupCreatedAt,fix.document.createdAt);
  assert.strictEqual(result.safetyBackup.id,'safety-1');
  assert.deepStrictEqual(plain(result.persistence),{
    indexedDb:true,
    localStorage:true,
    verified:true
  });
  assert.strictEqual(result.reloadRequired,true);
  assert.strictEqual(result.summary.conferenceCount,1);
  assert.strictEqual(env.getApplied().currentConferenceId,'incoming');
  assert.strictEqual(env.getApplied().normalized,true);
  assert.strictEqual(env.getIndexed().currentConferenceId,'incoming');
  assert.strictEqual(
    JSON.parse(env.getLocal('conf_v5')).currentConferenceId,
    'incoming'
  );
  var marker=JSON.parse(
    env.getLocal('conference_manager_full_restore_pending_cloud_review')
  );
  assert.strictEqual(marker.version,1);
  assert.deepStrictEqual(marker.restoredConferenceIds,['incoming']);
  assert.strictEqual(marker.sourceBackupCreatedAt,fix.document.createdAt);
  assert.strictEqual(marker.safetyBackupId,'safety-1');
  assert.strictEqual(
    env.events.indexOf('safety')<
      env.events.indexOf('candidateIndexedDb'),
    true
  );
  assert.strictEqual(
    env.events.indexOf('applyGlobal')>
      env.events.indexOf('verifyIndexedDb'),
    true
  );
  assert.strictEqual(JSON.stringify(fix.input),inputBefore);
  assert.strictEqual(JSON.stringify(fix.previous),previousBefore);
  assert.strictEqual(api.isFullRestoreInProgress(),false);
}

async function testPreconditions(api){
  var fix=fixture(api);
  var env=environment(fix);
  var noConfirmation=plain(fix.input);
  noConfirmation.confirmed=false;
  var result=await api.executeFullRestore(noConfirmation,env.options);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_CONFIRMATION_REQUIRED');
  assert.strictEqual(env.events.indexOf('safety'),-1);

  var withErrors=fixture(api);
  withErrors.input.candidateResult.errors=[{code:'TEST_ERROR'}];
  env=environment(withErrors);
  result=await api.executeFullRestore(withErrors.input,env.options);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_CANDIDATE_HAS_ERRORS');
  assert.strictEqual(env.events.indexOf('safety'),-1);
  assert.strictEqual(api.isFullRestoreInProgress(),false);
}

async function testConcurrentLock(api){
  var fix=fixture(api);
  var waiting=deferred();
  var env=environment(fix,{safetyDeferred:waiting});
  var first=api.executeFullRestore(fix.input,env.options);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(api.isFullRestoreInProgress(),true);
  var second=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(second.errorCode,'FULL_RESTORE_ALREADY_IN_PROGRESS');
  waiting.resolve({
    backupId:'safety-1',
    snapshot:plain(fix.previous)
  });
  var result=await first;
  assert.strictEqual(result.success,true);
  assert.strictEqual(api.isFullRestoreInProgress(),false);
}

async function testSafetyFailure(api){
  var fix=fixture(api);
  var env=environment(fix,{safetyFail:true});
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,false);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_SAFETY_BACKUP_FAILED'
  );
  assert.strictEqual(env.events.indexOf('candidateIndexedDb'),-1);
  assert.strictEqual(env.events.indexOf('set:conf_v5'),-1);
  assert.strictEqual(env.getApplied().currentConferenceId,'previous');
  assert.strictEqual(api.isFullRestoreInProgress(),false);
}

async function testIndexedFailureAndRollback(api){
  var fix=fixture(api);
  var env=environment(fix,{indexedFail:true});
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,false);
  assert.strictEqual(result.failedStage,'indexeddb_write');
  assert.strictEqual(result.rollback.attempted,true);
  assert.strictEqual(result.rollback.success,true);
  assert.strictEqual(env.getIndexed().currentConferenceId,'previous');
  assert.strictEqual(env.getApplied().currentConferenceId,'previous');
  assert.strictEqual(env.getSafetyBackup().backupId,'safety-1');
}

async function testLocalFailureRollback(api){
  var fix=fixture(api);
  var env=environment(fix,{localWriteFail:true});
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,false);
  assert.strictEqual(result.failedStage,'local_storage_write');
  assert.strictEqual(result.rollback.success,true);
  assert.strictEqual(env.getIndexed().currentConferenceId,'previous');
  assert.strictEqual(
    JSON.parse(env.getLocal('conf_v5')).currentConferenceId,
    'previous'
  );
  assert.strictEqual(env.getApplied().currentConferenceId,'previous');
  assert.strictEqual(env.events.indexOf('applyGlobal'),-1);
  assert.strictEqual(env.getSafetyBackup().backupId,'safety-1');
}

async function testVerificationRollback(api){
  var fix=fixture(api);
  var env=environment(fix,{verificationMismatch:true});
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,false);
  assert.strictEqual(result.failedStage,'verification');
  assert.strictEqual(result.rollback.success,true);
  assert.strictEqual(env.getIndexed().currentConferenceId,'previous');
  assert.strictEqual(
    JSON.parse(env.getLocal('conf_v5')).currentConferenceId,
    'previous'
  );
}

async function testMarkerReadBackMismatchRollback(api){
  var fix=fixture(api);
  var env=environment(fix,{markerReadBackMismatch:true});
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,false);
  assert.strictEqual(result.failedStage,'verification');
  assert.strictEqual(result.rollback.success,true);
  assert.strictEqual(env.getIndexed().currentConferenceId,'previous');
  assert.strictEqual(
    JSON.parse(env.getLocal('conf_v5')).currentConferenceId,
    'previous'
  );
  assert.strictEqual(
    env.getLocal('conference_manager_full_restore_pending_cloud_review'),
    undefined
  );
  assert.strictEqual(env.getApplied().currentConferenceId,'previous');
  assert.strictEqual(env.events.indexOf('applyGlobal'),-1);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
  assert.strictEqual(env.getSafetyBackup().backupId,'safety-1');
}

async function testPartialApplyRollback(api){
  var fix=fixture(api);
  var env=environment(fix);
  var live=plain(fix.previous);
  var applyCalls=0;
  env.options.applyAppData=function(value){
    applyCalls++;
    if(applyCalls===1){
      live.currentConferenceId='partially-applied';
      live.conferences=[{id:'partial',name:'Partial'}];
      throw new Error('PARTIAL_APPLY_FAILED');
    }
    live=plain(value);
  };
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,false);
  assert.strictEqual(result.rollback.attempted,true);
  assert.strictEqual(result.rollback.success,true);
  assert.strictEqual(applyCalls,2);
  assert.deepStrictEqual(live,fix.previous);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
  assert.strictEqual(env.getSafetyBackup().backupId,'safety-1');
  assert.strictEqual(result.safetyBackup.id,'safety-1');
}

async function testApplyAndRuntimeRollbackFailure(api){
  var fix=fixture(api);
  var env=environment(fix);
  var applyCalls=0;
  env.options.applyAppData=function(value){
    applyCalls++;
    if(applyCalls===1){
      value.currentConferenceId='partially-applied';
      throw new Error('PARTIAL_APPLY_FAILED');
    }
    throw new Error('RUNTIME_ROLLBACK_FAILED');
  };
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,false);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_FAILED');
  assert.strictEqual(result.errorMessage,'PARTIAL_APPLY_FAILED');
  assert.strictEqual(result.rollback.success,false);
  assert.strictEqual(
    result.rollback.errors.some(function(error){
      return error.code==='FULL_RESTORE_GLOBAL_ROLLBACK_FAILED'&&
        error.message==='RUNTIME_ROLLBACK_FAILED';
    }),
    true
  );
  assert.strictEqual(applyCalls,2);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
  assert.ok(await env.readSafetyBackup(result.safetyBackup.id));
}

async function testSafetyBackupStoreSurvivesFailures(api){
  var fix=fixture(api);
  var cases=[
    {markerReadBackMismatch:true},
    {verificationMismatch:true}
  ];
  for(var index=0;index<cases.length;index++){
    var env=environment(fix,cases[index]);
    var result=await api.executeFullRestore(fix.input,env.options);
    assert.strictEqual(result.success,false);
    var stored=await env.readSafetyBackup(result.safetyBackup.id);
    assert.ok(stored);
    assert.strictEqual(stored.backupId,'safety-1');
    assert.deepStrictEqual(stored.snapshot,fix.previous);
  }
}

async function testInvalidMarkerRejected(api){
  var fix=fixture(api);
  var env=environment(fix);
  var savesBefore=env.events.length;
  await assert.rejects(function(){
    return api.persistFullRestoreCandidate(fix.incoming,{
      repository:env.options.repository,
      storage:env.options.storage,
      markerValue:{
        version:1,
        createdAt:'invalid-date',
        restoredConferenceIds:['incoming'],
        sourceBackupCreatedAt:null,
        safetyBackupId:null
      }
    });
  },function(error){
    return error&&error.code==='FULL_RESTORE_MARKER_INVALID';
  });
  assert.strictEqual(
    env.events.slice(savesBefore).indexOf('candidateIndexedDb'),
    -1
  );
}

async function testPartialRollbackFailure(api){
  var fix=fixture(api);
  var env=environment(fix,{
    verificationMismatch:true,
    rollbackIndexedFail:true,
    rollbackLocalFail:true
  });
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,false);
  assert.strictEqual(result.rollback.attempted,true);
  assert.strictEqual(result.rollback.success,false);
  assert.strictEqual(result.rollback.errors.length,2);
  assert.strictEqual(result.safetyBackup.created,true);
  assert.strictEqual(result.safetyBackup.id,'safety-1');
  assert.strictEqual(api.isFullRestoreInProgress(),false);
}

async function testNoForbiddenSideEffects(){
  var calls=[];
  var loaded=load({
    fetch:function(){calls.push('fetch');},
    save:function(){calls.push('save');},
    OfflineSyncQueue:{
      enqueueSnapshotOperation:function(){calls.push('queue');}
    },
    appData:{sentinel:true}
  });
  var api=loaded.api;
  var fix=fixture(api);
  var env=environment(fix);
  env.options.applyAppData=function(){calls.push('apply');};
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,true);
  assert.strictEqual(calls.indexOf('fetch'),-1);
  assert.strictEqual(calls.indexOf('save'),-1);
  assert.strictEqual(calls.indexOf('queue'),-1);
  assert.strictEqual(calls.indexOf('apply')>=0,true);
  assert.deepStrictEqual(loaded.sandbox.appData,{sentinel:true});
}

async function testNormalizationIsolation(api){
  var fix=fixture(api);
  var env=environment(fix);
  var live=fix.previous;
  env.options.normalizeCandidate=function(candidate){
    assert.notStrictEqual(candidate,fix.input.candidateResult.candidateAppData);
    candidate.conferences[0].name='Normalized';
    return JSON.parse(JSON.stringify(candidate));
  };
  env.options.applyAppData=function(value){live=value;};
  var result=await api.executeFullRestore(fix.input,env.options);
  assert.strictEqual(result.success,true);
  assert.strictEqual(live.conferences[0].name,'Normalized');
  assert.doesNotThrow(function(){JSON.stringify(live);});
  assert.strictEqual(fix.previous.conferences[0].name,'Previous');
}

function testActualNormalizerDoesNotTouchGlobal(){
  var sandbox=loadActualCandidateNormalizer();
  var before=JSON.stringify(sandbox.appData);
  var candidate={
    version:'2.0.0',
    currentConferenceId:'candidate',
    conferences:[{id:'candidate',name:'Candidate'}]
  };
  var normalized=sandbox.normalizeAppDataCandidate(candidate);
  assert.strictEqual(JSON.stringify(sandbox.appData),before);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(candidate,'trash'),
    false
  );
  assert.ok(normalized.trash);
  assert.ok(Array.isArray(normalized.templates));
  assert.doesNotThrow(function(){JSON.stringify(normalized);});
}

async function run(){
  var api=load().api;
  await testSuccessfulRestore(api);
  await testPreconditions(api);
  await testConcurrentLock(api);
  await testSafetyFailure(api);
  await testIndexedFailureAndRollback(api);
  await testLocalFailureRollback(api);
  await testVerificationRollback(api);
  await testMarkerReadBackMismatchRollback(api);
  await testPartialApplyRollback(api);
  await testApplyAndRuntimeRollbackFailure(api);
  await testSafetyBackupStoreSurvivesFailures(api);
  await testInvalidMarkerRejected(api);
  await testPartialRollbackFailure(api);
  await testNoForbiddenSideEffects();
  await testNormalizationIsolation(api);
  testActualNormalizerDoesNotTouchGlobal();
  console.log('Full backup phase 4 tests passed.');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
