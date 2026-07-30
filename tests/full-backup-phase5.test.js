'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var MARKER='conference_manager_full_restore_pending_cloud_review';
var LINKS='conference_manager_sync_links';
var ATTEMPTS='conference_manager_linking_attempts_v1';
var MANUAL='conference_manager_full_restore_manual_relink_required';
var REMOTE_ONE='11111111-1111-4111-8111-111111111111';
var REMOTE_TWO='22222222-2222-4222-8222-222222222222';
var DEVICE_ONE='33333333-3333-4333-8333-333333333333';
var OPERATION_ONE='44444444-4444-4444-8444-444444444444';

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

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function marker(ids){
  return {
    version:1,
    createdAt:'2026-07-30T12:00:00.000Z',
    restoredConferenceIds:ids,
    sourceBackupCreatedAt:'2026-07-29T12:00:00.000Z',
    safetyBackupId:'safety-1'
  };
}

function appData(ids){
  return {
    version:'2.0.0',
    currentConferenceId:ids[0]||null,
    conferences:ids.map(function(id){return {id:id,name:id};})
  };
}

function link(local,remote){
  if(remote==='remote-1')remote=REMOTE_ONE;
  if(remote==='remote-2')remote=REMOTE_TWO;
  return {
    localConferenceId:local,
    remoteConferenceId:remote,
    linkStatus:'linked',
    knownRevision:1
  };
}

function queueOperation(overrides){
  return Object.assign({
    operationId:OPERATION_ONE,
    conferenceId:REMOTE_ONE,
    deviceId:DEVICE_ONE,
    baseRevision:0,
    snapshot:{id:'restored-1',name:'Restored'},
    schemaVersion:'2.0.0',
    appVersion:'3.1.1',
    status:'applied',
    attempts:0,
    createdAt:'2026-07-30T10:00:00.000Z',
    updatedAt:'2026-07-30T10:00:00.000Z'
  },overrides||{});
}

function appliedPendingResult(localConferenceId,overrides){
  var value={
    ok:true,
    status:'applied',
    data:{
      localConferenceId:localConferenceId,
      status:'applied',
      applicationState:{
        validationCompleted:true,
        backupStored:true,
        localSnapshotSaved:true,
        linkFinalized:true,
        pendingCompleted:true
      }
    }
  };
  return Object.assign(value,overrides||{});
}

function storage(initial,settings){
  var values=Object.assign({},initial||{});
  var events=[];
  var attemptReads=0;
  var attemptsMutationStarted=false;
  var linksMutationStarted=false;
  var markerRestoreAttempts=0;
  var manualWriteAttempts=0;
  settings=settings||{};
  return {
    events:events,
    getItem:function(key){
      events.push('get:'+key);
      if(key===ATTEMPTS){
        attemptReads++;
        if(settings.changeAttemptsOnThirdRead&&attemptReads===3){
          values[key]=JSON.stringify({
            changed:{
              localConferenceId:'changed',
              operationId:OPERATION_ONE,
              requestedConferenceId:REMOTE_TWO
            }
          });
        }
      }
      return Object.prototype.hasOwnProperty.call(values,key)
        ?values[key]
        :null;
    },
    setItem:function(key,value){
      events.push('set:'+key);
      if(key===LINKS&&value!==initial[LINKS]){
        linksMutationStarted=true;
      }
      if(settings.silentLinksRollbackMismatch&&key===LINKS&&
        linksMutationStarted&&value===initial[LINKS]){
        values[key]='{}';
        return;
      }
      if(settings.failLinksWrite&&key===LINKS&&
        value!==initial[LINKS]){
        throw new Error('LINK_WRITE_FAILED');
      }
      if(settings.failMarkerClearRollback&&key===MARKER){
        throw new Error('MARKER_ROLLBACK_FAILED');
      }
      if(settings.failAttemptsWrite&&key===ATTEMPTS&&
        value!==initial[ATTEMPTS]){
        throw new Error('ATTEMPTS_WRITE_FAILED');
      }
      if(key===ATTEMPTS&&value!==initial[ATTEMPTS]){
        attemptsMutationStarted=true;
      }
      if(settings.failAttemptsRollback&&key===ATTEMPTS&&
        attemptsMutationStarted&&value===initial[ATTEMPTS]){
        throw new Error('ATTEMPTS_ROLLBACK_FAILED');
      }
      if(settings.silentAttemptsRollbackMismatch&&key===ATTEMPTS&&
        attemptsMutationStarted&&value===initial[ATTEMPTS]){
        values[key]='{}';
        return;
      }
      if(settings.failFirstMarkerRestore&&key===MARKER&&
        value===initial[MARKER]){
        markerRestoreAttempts++;
        if(markerRestoreAttempts===1){
          throw new Error('MARKER_RESTORE_FAILED');
        }
      }
      if(settings.failFirstManualWrite&&key===MANUAL){
        manualWriteAttempts++;
        if(manualWriteAttempts===1){
          throw new Error('MANUAL_WRITE_FAILED');
        }
      }
      if(settings.mismatchAttemptsWrite&&key===ATTEMPTS&&
        value!==initial[ATTEMPTS]){
        values[key]=JSON.stringify({});
        return;
      }
      values[key]=value;
    },
    removeItem:function(key){
      events.push('remove:'+key);
      if(settings.failMarkerClear&&key===MARKER){
        throw new Error('MARKER_CLEAR_FAILED');
      }
      delete values[key];
    },
    value:function(key){return values[key];}
  };
}

function environment(api,settings){
  settings=settings||{};
  var restored=['restored-1'];
  var links={
    'restored-1':link('restored-1','remote-1'),
    'unaffected-1':link('unaffected-1','remote-2')
  };
  var markerValue=marker(restored);
  var store=storage({
    [MARKER]:JSON.stringify(markerValue),
    [LINKS]:JSON.stringify(links),
    [ATTEMPTS]:JSON.stringify({'restored-1':{
      localConferenceId:'restored-1',
      operationId:'operation-1',
      requestedConferenceId:'11111111-1111-4111-8111-111111111111'
    },'unaffected-1':{
      localConferenceId:'unaffected-1',
      operationId:'55555555-5555-4555-8555-555555555555',
      requestedConferenceId:REMOTE_TWO
    }})
  },settings);
  var events=[];
  var runtimeState={
    contexts:{'restored-1':true},
    remoteUpdates:{[REMOTE_ONE]:true},
    orchestratorStarted:false
  };
  var queue={
    getAllOperations:function(){
      events.push('queueRead');
      if(settings.queueDeferred)return settings.queueDeferred.promise;
      return Promise.resolve({
        ok:true,
        data:{operations:settings.operations||[]}
      });
    },
    delete:function(){events.push('queueDelete');}
  };
  var pending={
    get:function(id){
      events.push('pendingRead:'+id);
      if(settings.pendingResult){
        return Promise.resolve(settings.pendingResult);
      }
      if(settings.pendingApplication){
        return Promise.resolve({ok:true,status:'pending',data:{}});
      }
      return Promise.resolve({ok:false,status:'not_found'});
    }
  };
  var indexedDb={
    getRecord:function(storeName,id){
      events.push('indexedRead:'+storeName+':'+id);
      return Promise.resolve(settings.syncMetadata||null);
    }
  };
  var attempts={
    remove:function(id){
      events.push('attemptRemove:'+id);
      if(settings.attemptFail)return {ok:false,status:'storage_error'};
      var raw=store.getItem(ATTEMPTS);
      var value=raw?JSON.parse(raw):{};
      delete value[id];
      store.setItem(ATTEMPTS,JSON.stringify(value));
      return {ok:true,status:'removed'};
    }
  };
  var integration={
    removeConferenceSync:function(id){
      events.push('contextRemove:'+id);
      delete runtimeState.contexts[id];
      return {ok:true,status:'removed'};
    },
    clearRemoteUpdate:function(id){
      events.push('remoteClear:'+id);
      delete runtimeState.remoteUpdates[id];
      return {ok:true,status:'cleared'};
    }
  };
  var autoLinking={
    initialize:function(){events.push('autoLinkingInitialize');}
  };
  var orchestrator={
    start:function(){
      events.push('orchestratorStart');
      if(runtimeState.contexts['restored-1']){
        events.push('startWithOldContext');
      }
      runtimeState.orchestratorStarted=true;
      return {ok:true,status:'started'};
    },
    stop:function(){
      events.push('orchestratorStop');
      runtimeState.orchestratorStarted=false;
      return {ok:true,status:'stopped'};
    }
  };
  return {
    store:store,
    events:events,
    runtimeState:runtimeState,
    links:links,
    marker:markerValue,
    options:{
      currentAppData:appData(restored),
      storage:store,
      queue:queue,
      pendingRemoteApplications:pending,
      indexedDb:indexedDb,
      integration:integration,
      autoLinking:autoLinking,
      orchestrator:orchestrator
    }
  };
}

function deferred(){
  var resolve;
  var promise=new Promise(function(res){resolve=res;});
  return {promise:promise,resolve:resolve};
}

function hasCode(items,code){
  return items.some(function(item){return item.code===code;});
}

function testMarkerContract(api){
  var empty=storage({});
  assert.strictEqual(
    api.getFullRestoreCloudReviewMarker({storage:empty}).pending,
    false
  );
  var legacy=storage({[MARKER]:'1'});
  var legacyResult=api.getFullRestoreCloudReviewMarker({storage:legacy});
  assert.strictEqual(legacyResult.pending,true);
  assert.strictEqual(legacyResult.legacy,true);

  var validMarker=marker(['one']);
  var valid=storage({[MARKER]:JSON.stringify(validMarker)});
  var result=api.getFullRestoreCloudReviewMarker({storage:valid});
  assert.strictEqual(result.pending,true);
  assert.strictEqual(result.malformed,false);
  assert.deepStrictEqual(plain(result.marker),validMarker);

  var malformed=storage({[MARKER]:'{bad'});
  result=api.getFullRestoreCloudReviewMarker({storage:malformed});
  assert.strictEqual(result.pending,true);
  assert.strictEqual(result.malformed,true);
  assert.strictEqual(api.isFullRestoreCloudReviewPending({
    storage:malformed
  }),true);
}

function testPureReview(api){
  var calls=0;
  var candidate=appData(['restored-1']);
  var links={
    'restored-1':link('restored-1','remote-1'),
    other:link('other','remote-2'),
    malformed:{localConferenceId:'malformed'}
  };
  var review=api.buildPostRestoreCloudReview(
    candidate,
    links,
    marker(['restored-1'])
  );
  assert.strictEqual(review.affectedLinks.length,1);
  assert.strictEqual(review.unaffectedLinks.length,1);
  assert.strictEqual(review.malformedLinks.length,1);
  assert.deepStrictEqual(plain(review.restoredConferenceIds),['restored-1']);
  assert.strictEqual(calls,0);
  assert.strictEqual(
    api.buildPostRestoreCloudReview(candidate,[],marker(['restored-1']))
      .syncLinksRootValid,
    false
  );
}

async function testSuccessfulCleanup(api){
  var env=environment(api);
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.success,true);
  assert.strictEqual(result.affectedLinkCount,1);
  assert.deepStrictEqual(plain(result.removedConferenceIds),['restored-1']);
  assert.strictEqual(result.unaffectedLinkCount,1);
  assert.strictEqual(result.malformedLinkCount,0);
  assert.strictEqual(result.markerCleared,true);
  assert.strictEqual(result.syncRestarted,true);
  assert.strictEqual(result.requiresManualRelinking,true);
  var remaining=JSON.parse(env.store.value(LINKS));
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(remaining,'restored-1'),
    false
  );
  assert.ok(remaining['unaffected-1']);
  var remainingAttempts=JSON.parse(env.store.value(ATTEMPTS));
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(remainingAttempts,'restored-1'),
    false
  );
  assert.ok(remainingAttempts['unaffected-1']);
  assert.strictEqual(env.store.value(MARKER),undefined);
  assert.deepStrictEqual(
    JSON.parse(env.store.value(MANUAL)),
    ['restored-1']
  );
  assert.strictEqual(env.events.indexOf('queueDelete'),-1);
  assert.strictEqual(env.events.indexOf('attemptRemove:restored-1'),-1);
  assert.ok(
    env.events.indexOf('contextRemove:restored-1')<
      env.events.indexOf('autoLinkingInitialize')
  );
  assert.ok(
    env.events.indexOf('autoLinkingInitialize')<
      env.events.indexOf('orchestratorStart')
  );
  assert.strictEqual(env.events.indexOf('startWithOldContext'),-1);
  assert.strictEqual(env.runtimeState.contexts['restored-1'],undefined);
  assert.strictEqual(api.isPostRestoreCloudReviewInProgress(),false);

  var repeated=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(repeated.success,true);
  assert.strictEqual(repeated.alreadyCompleted,true);
}

async function testNoAffectedLinks(api){
  var env=environment(api);
  env.options.currentAppData=appData(['different']);
  env.store.setItem(MARKER,JSON.stringify(marker(['different'])));
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.success,true);
  assert.strictEqual(result.affectedLinkCount,0);
  assert.strictEqual(result.requiresManualRelinking,false);
  assert.strictEqual(result.markerCleared,true);
  assert.strictEqual(env.events.indexOf('orchestratorStart')>=0,true);
}

async function testMalformedRootBlocks(api){
  var env=environment(api);
  env.store.setItem(LINKS,'[]');
  var before=env.store.value(MARKER);
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.success,false);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_SYNC_LINKS_MALFORMED'
  );
  assert.strictEqual(env.store.value(MARKER),before);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
}

async function testMalformedLinkAndAttemptsBlock(api){
  var env=environment(api);
  var malformed=plain(env.links);
  malformed.broken={localConferenceId:'broken'};
  env.store.setItem(LINKS,JSON.stringify(malformed));
  var linksBefore=env.store.value(LINKS);
  var markerBefore=env.store.value(MARKER);
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_SYNC_LINKS_MALFORMED');
  assert.strictEqual(env.store.value(LINKS),linksBefore);
  assert.strictEqual(env.store.value(MARKER),markerBefore);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);

  env=environment(api);
  env.store.setItem(ATTEMPTS,'{corrupted');
  linksBefore=env.store.value(LINKS);
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_LINKING_ATTEMPTS_MALFORMED'
  );
  assert.strictEqual(env.store.value(ATTEMPTS),'{corrupted');
  assert.strictEqual(env.store.value(LINKS),linksBefore);
  assert.strictEqual(env.events.indexOf('attemptRemove:restored-1'),-1);

  env=environment(api);
  env.store.setItem(ATTEMPTS,JSON.stringify({
    'restored-1':{localConferenceId:'restored-1'}
  }));
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_LINKING_ATTEMPTS_MALFORMED'
  );
  assert.ok(env.store.value(ATTEMPTS).indexOf('restored-1')>=0);
  assert.strictEqual(env.events.indexOf('attemptRemove:restored-1'),-1);
}

async function testQueueAndPendingBlock(api){
  var env=environment(api,{
    operations:[queueOperation({status:'pending'})]
  });
  var linksBefore=env.store.value(LINKS);
  var markerBefore=env.store.value(MARKER);
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_QUEUE_REVIEW_REQUIRED');
  assert.strictEqual(env.store.value(LINKS),linksBefore);
  assert.strictEqual(env.store.value(MARKER),markerBefore);
  assert.strictEqual(env.events.indexOf('queueDelete'),-1);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);

  env=environment(api,{pendingApplication:true});
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_PENDING_REMOTE_APPLICATION_REVIEW_REQUIRED'
  );
  assert.ok(env.store.value(MARKER));

  env=environment(api,{
    operations:[queueOperation({status:'future_status'})]
  });
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_QUEUE_REVIEW_REQUIRED');

  env=environment(api,{
    operations:[queueOperation({status:undefined})]
  });
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_QUEUE_OPERATION_INVALID');

  env=environment(api,{pendingResult:{ok:false,status:'read_failed'}});
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_PENDING_REMOTE_APPLICATION_REVIEW_FAILED'
  );

  env=environment(api,{pendingResult:{ok:true,status:'future_status'}});
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_PENDING_REMOTE_APPLICATION_REVIEW_FAILED'
  );

  env=environment(api);
  env.options.pendingRemoteApplications=null;
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_PENDING_REMOTE_APPLICATION_REVIEW_UNAVAILABLE'
  );
}

async function testMalformedQueueRecordsBlock(api){
  var malformed=[
    null,
    [],
    'invalid',
    queueOperation({operationId:undefined}),
    queueOperation({conferenceId:undefined}),
    queueOperation({deviceId:undefined}),
    queueOperation({status:undefined}),
    queueOperation({baseRevision:-1}),
    queueOperation({baseRevision:null}),
    queueOperation({snapshot:undefined}),
    queueOperation({snapshot:[]}),
    queueOperation({schemaVersion:undefined}),
    queueOperation({appVersion:undefined}),
    queueOperation({attempts:undefined}),
    queueOperation({attempts:-1}),
    queueOperation({attempts:0.5}),
    queueOperation({createdAt:undefined}),
    queueOperation({updatedAt:undefined}),
    queueOperation({createdAt:'invalid-date'}),
    queueOperation({updatedAt:'invalid-date'})
  ];
  for(var index=0;index<malformed.length;index++){
    var env=environment(api,{operations:[malformed[index]]});
    var markerBefore=env.store.value(MARKER);
    var result=await api.completePostRestoreCloudReview(env.options);
    assert.strictEqual(
      result.errorCode,
      'FULL_RESTORE_QUEUE_OPERATION_INVALID'
    );
    assert.strictEqual(env.store.value(MARKER),markerBefore);
    assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
    assert.strictEqual(env.events.indexOf('orchestratorStop'),-1);
  }
}

async function testValidQueueContractPasses(api){
  var validSnapshots=[
    {id:'plain'},
    new Date('2026-07-30T10:00:00.000Z')
  ];
  for(var index=0;index<validSnapshots.length;index++){
    var env=environment(api,{
      operations:[queueOperation({
        baseRevision:0,
        snapshot:validSnapshots[index]
      })]
    });
    var result=await api.completePostRestoreCloudReview(env.options);
    assert.strictEqual(result.success,true);
    assert.strictEqual(result.errorCode,undefined);
  }
}

async function testQueueSnapshotContractRejectsInvalidValues(api){
  var invalidSnapshots=[[],null,'snapshot',1,true];
  for(var index=0;index<invalidSnapshots.length;index++){
    var env=environment(api,{
      operations:[queueOperation({snapshot:invalidSnapshots[index]})]
    });
    var result=await api.completePostRestoreCloudReview(env.options);
    assert.strictEqual(
      result.errorCode,
      'FULL_RESTORE_QUEUE_OPERATION_INVALID'
    );
  }
}

function testUuidVersionsMatchLinkStore(api){
  [1,2,3,4,5].forEach(function(version){
    var remote='aaaaaaaa-aaaa-'+version+'aaa-8aaa-aaaaaaaaaaaa';
    var review=api.buildPostRestoreCloudReview(
      appData(['restored-1']),
      {'restored-1':link('restored-1',remote)},
      marker(['restored-1'])
    );
    assert.strictEqual(review.malformedLinks.length,0);
  });
  [6,7,8].forEach(function(version){
    var remote='aaaaaaaa-aaaa-'+version+'aaa-8aaa-aaaaaaaaaaaa';
    var review=api.buildPostRestoreCloudReview(
      appData(['restored-1']),
      {'restored-1':link('restored-1',remote)},
      marker(['restored-1'])
    );
    assert.strictEqual(review.malformedLinks.length,1);
  });
  assert.strictEqual(
    api.buildPostRestoreCloudReview(
      appData(['restored-1']),
      {'restored-1':link('restored-1','invalid')},
      marker(['restored-1'])
    ).malformedLinks.length,
    1
  );
}

async function testPendingApplicationContract(api){
  var cases=[
    {ok:true,status:'applied'},
    appliedPendingResult('different'),
    {
      ok:true,
      status:'failed',
      data:{
        localConferenceId:'restored-1',
        status:'failed',
        applicationState:{pendingCompleted:false}
      }
    },
    appliedPendingResult('restored-1',{
      data:{
        localConferenceId:'restored-1',
        status:'applied',
        applicationState:{
          validationCompleted:true,
          backupStored:true,
          localSnapshotSaved:true,
          linkFinalized:true,
          pendingCompleted:false
        }
      }
    }),
    appliedPendingResult('restored-1',{status:'cancelled'})
  ];
  for(var index=0;index<cases.length;index++){
    var env=environment(api,{pendingResult:cases[index]});
    var markerBefore=env.store.value(MARKER);
    var result=await api.completePostRestoreCloudReview(env.options);
    assert.strictEqual(
      result.errorCode,
      'FULL_RESTORE_PENDING_REMOTE_APPLICATION_REVIEW_FAILED'
    );
    assert.strictEqual(env.store.value(MARKER),markerBefore);
    assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
  }
}

async function testOperationallyMalformedLinksBlock(api){
  var malformed=[
    link('restored-1','not-a-uuid'),
    link('restored-1',REMOTE_ONE),
    link('restored-1',REMOTE_ONE)
  ];
  delete malformed[1].linkStatus;
  delete malformed[2].knownRevision;
  malformed.push(Object.assign(
    link('restored-1',REMOTE_ONE),
    {knownRevision:-1}
  ));
  for(var index=0;index<malformed.length;index++){
    var env=environment(api);
    var links=plain(env.links);
    links['restored-1']=malformed[index];
    env.store.setItem(LINKS,JSON.stringify(links));
    var markerBefore=env.store.value(MARKER);
    var result=await api.completePostRestoreCloudReview(env.options);
    assert.strictEqual(result.errorCode,'FULL_RESTORE_SYNC_LINKS_MALFORMED');
    assert.strictEqual(env.store.value(MARKER),markerBefore);
    assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
  }
}

async function testLinkingAttemptsAtomicGuards(api){
  var env=environment(api,{changeAttemptsOnThirdRead:true});
  var markerBefore=env.store.value(MARKER);
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_LINKING_ATTEMPTS_CHANGED'
  );
  assert.strictEqual(env.store.value(MARKER),markerBefore);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);

  env=environment(api,{mismatchAttemptsWrite:true});
  var attemptsBefore=env.store.value(ATTEMPTS);
  markerBefore=env.store.value(MARKER);
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_LINKING_ATTEMPT_CLEANUP_FAILED'
  );
  assert.strictEqual(env.store.value(ATTEMPTS),attemptsBefore);
  assert.strictEqual(env.store.value(MARKER),markerBefore);
  assert.strictEqual(result.rollback.success,true);

  env=environment(api,{
    mismatchAttemptsWrite:true,
    failAttemptsRollback:true
  });
  markerBefore=env.store.value(MARKER);
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_FAIL_SAFE_FAILED'
  );
  assert.strictEqual(
    result.originalErrorCode,
    'FULL_RESTORE_LINKING_ATTEMPT_CLEANUP_FAILED'
  );
  assert.strictEqual(result.rollback.success,false);
  assert.strictEqual(result.failSafe.attemptsRestored,false);
  assert.strictEqual(env.store.value(MARKER),markerBefore);
  assert.strictEqual(result.failSafe.markerRestored,true);
  assert.strictEqual(result.failSafe.manualRelinkPreserved,true);
}

async function testRestartFailureDoesNotChangeRuntime(api){
  var env=environment(api);
  env.options.autoLinking={
    initialize:function(){
      env.events.push('autoLinkingInitialize');
      return {ok:false};
    }
  };
  var linksBefore=env.store.value(LINKS);
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_AUTOMATIC_LINKING_RESTART_FAILED'
  );
  assert.strictEqual(result.rollback.success,true);
  assert.strictEqual(env.store.value(LINKS),linksBefore);
  assert.ok(env.events.indexOf('contextRemove:restored-1')>=0);
  assert.ok(
    env.events.indexOf('contextRemove:restored-1')<
      env.events.indexOf('autoLinkingInitialize')
  );
  assert.ok(env.store.value(MARKER));
  assert.strictEqual(
    api.isManualRelinkRequired('restored-1',{storage:env.store}),
    true
  );
  assert.deepStrictEqual(plain(result.failSafe),{
    attempted:true,
    runtimeStopped:true,
    linksRestored:true,
    attemptsRestored:true,
    markerRestored:true,
    manualRelinkPreserved:true,
    success:true
  });

  env=environment(api);
  env.options.orchestrator={
    start:function(){
      env.events.push('orchestratorStart');
      env.runtimeState.orchestratorStarted=true;
      return {ok:false};
    },
    stop:function(){
      env.events.push('orchestratorStop');
      env.runtimeState.orchestratorStarted=false;
      return {ok:true,status:'stopped'};
    }
  };
  linksBefore=env.store.value(LINKS);
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_SYNC_RESTART_FAILED');
  assert.strictEqual(result.rollback.success,true);
  assert.strictEqual(env.store.value(LINKS),linksBefore);
  assert.ok(
    env.events.indexOf('contextRemove:restored-1')<
      env.events.indexOf('orchestratorStart')
  );
  assert.ok(env.store.value(MARKER));
  assert.strictEqual(
    api.isManualRelinkRequired('restored-1',{storage:env.store}),
    true
  );
  assert.strictEqual(
    env.events[env.events.length-1],
    'orchestratorStop'
  );
  assert.strictEqual(env.runtimeState.orchestratorStarted,false);
  assert.strictEqual(result.failSafe.markerRestored,true);
  assert.strictEqual(result.failSafe.manualRelinkPreserved,true);
}

async function testVerifiedRollbackAndFailSafeContinuation(api){
  async function runRollbackCase(settings){
    var env=environment(api,settings);
    env.options.autoLinking={
      initialize:function(){
        env.events.push('autoLinkingInitialize');
        return {ok:false};
      }
    };
    var result=await api.completePostRestoreCloudReview(env.options);
    assert.strictEqual(result.errorCode,'FULL_RESTORE_FAIL_SAFE_FAILED');
    assert.strictEqual(
      result.originalErrorCode,
      'FULL_RESTORE_AUTOMATIC_LINKING_RESTART_FAILED'
    );
    assert.strictEqual(result.rollback.success,false);
    assert.strictEqual(result.failSafe.success,false);
    assert.strictEqual(result.failSafe.markerRestored,true);
    assert.strictEqual(result.failSafe.manualRelinkPreserved,true);
    assert.strictEqual(result.failSafe.runtimeStopped,true);
    assert.strictEqual(
      JSON.parse(env.store.value(MARKER)).safetyBackupId,
      'safety-1'
    );
    return {env:env,result:result};
  }

  var checked=await runRollbackCase({silentLinksRollbackMismatch:true});
  assert.strictEqual(checked.result.rollback.linksRestored,false);
  assert.strictEqual(checked.result.rollback.attemptsRestored,true);
  assert.strictEqual(checked.result.failSafe.linksRestored,false);

  checked=await runRollbackCase({silentAttemptsRollbackMismatch:true});
  assert.strictEqual(checked.result.rollback.linksRestored,true);
  assert.strictEqual(checked.result.rollback.attemptsRestored,false);
  assert.strictEqual(checked.result.failSafe.attemptsRestored,false);

  var env=environment(api,{failFirstMarkerRestore:true});
  env.options.autoLinking={
    initialize:function(){return {ok:false};}
  };
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.failSafe.markerRestored,true);
  assert.strictEqual(result.failSafe.manualRelinkPreserved,true);

  env=environment(api,{failFirstManualWrite:true});
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.failSafe.markerRestored,true);
  assert.strictEqual(result.failSafe.manualRelinkPreserved,true);

  env=environment(api);
  var stopCalls=0;
  env.options.orchestrator={
    start:function(){throw new Error('START_MUST_NOT_RUN');},
    stop:function(){
      stopCalls++;
      if(stopCalls===1)throw new Error('FIRST_STOP_FAILED');
      return {ok:true,status:'stopped'};
    }
  };
  result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(stopCalls,2);
  assert.strictEqual(result.failSafe.runtimeStopped,true);
  assert.strictEqual(result.failSafe.markerRestored,true);
  assert.strictEqual(result.failSafe.manualRelinkPreserved,true);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
}

async function testAbsentStorageKeysRollback(api){
  var env=environment(api);
  env.store.removeItem(LINKS);
  env.store.removeItem(ATTEMPTS);
  env.store.removeItem(MANUAL);
  env.events.length=0;
  var writtenValues=[];
  var originalSet=env.store.setItem;
  env.store.setItem=function(key,value){
    writtenValues.push({key:key,value:value});
    return originalSet.call(env.store,key,value);
  };
  env.options.autoLinking={
    initialize:function(){return {ok:false};}
  };
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_AUTOMATIC_LINKING_RESTART_FAILED'
  );
  [LINKS,ATTEMPTS,MANUAL].forEach(function(key){
    assert.strictEqual(env.store.value(key),undefined);
    assert.ok(env.store.events.indexOf('remove:'+key)>=0);
  });
  writtenValues.forEach(function(write){
    assert.notStrictEqual(write.value,'null');
    assert.notStrictEqual(write.value,'undefined');
  });
  assert.strictEqual(env.store.value(MARKER),JSON.stringify(env.marker));
  assert.strictEqual(result.rollback.linksRestored,true);
  assert.strictEqual(result.rollback.attemptsRestored,true);
}

async function testRejectedInitializePromiseEntersFailSafe(api){
  var env=environment(api);
  var initialized=false;
  var linksBefore=env.store.value(LINKS);
  var attemptsBefore=env.store.value(ATTEMPTS);
  env.options.autoLinking={
    initialize:function(){
      initialized=true;
      env.events.push('autoLinkingInitialize');
      return {
        ok:true,
        promise:Promise.reject(new Error('INITIALIZE_PROMISE_REJECTED'))
      };
    }
  };
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(initialized,true);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_CLOUD_REVIEW_FAILED');
  assert.strictEqual(env.store.value(LINKS),linksBefore);
  assert.strictEqual(env.store.value(ATTEMPTS),attemptsBefore);
  assert.strictEqual(env.store.value(MARKER),JSON.stringify(env.marker));
  assert.strictEqual(
    api.isManualRelinkRequired('restored-1',{storage:env.store}),
    true
  );
  assert.ok(env.events.indexOf('orchestratorStop')>=0);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
  assert.strictEqual(result.failSafe.success,true);
}

async function testFinalVerificationCancelsStartupTimer(api){
  var env=environment(api);
  var timer=null;
  var queueRuns=0;
  var networkRuns=0;
  var processReadyCalls=0;
  env.options.orchestrator={
    start:function(){
      env.events.push('orchestratorStart');
      timer=setTimeout(function(){
        queueRuns++;
        networkRuns++;
        processReadyCalls++;
      },20);
      env.store.setItem(MARKER,JSON.stringify(env.marker));
      return {ok:true,status:'started'};
    },
    stop:function(){
      env.events.push('orchestratorStop');
      if(timer!==null){
        clearTimeout(timer);
        timer=null;
      }
      return {ok:true,status:'stopped'};
    }
  };
  var result=await api.completePostRestoreCloudReview(env.options);
  await new Promise(function(resolve){setTimeout(resolve,40);});
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_FINAL_STATE_VERIFY_FAILED'
  );
  assert.strictEqual(timer,null);
  assert.strictEqual(queueRuns,0);
  assert.strictEqual(networkRuns,0);
  assert.strictEqual(processReadyCalls,0);
  assert.strictEqual(result.failSafe.runtimeStopped,true);
  assert.ok(env.store.value(MARKER));
}

async function testMultipleManualRelinkVerificationContinues(api){
  var env=environment(api);
  var ids=['restored-1','restored-2'];
  env.marker.restoredConferenceIds=ids.slice();
  env.store.setItem(MARKER,JSON.stringify(env.marker));
  env.options.currentAppData=appData(ids);
  var links=plain(env.links);
  links['restored-2']=link('restored-2',REMOTE_TWO);
  env.store.setItem(LINKS,JSON.stringify(links));
  env.options.autoLinking={initialize:function(){return {ok:false};}};
  var originalGet=env.store.getItem;
  var originalSet=env.store.setItem;
  var manualWritten=false;
  var verificationReads=0;
  env.store.setItem=function(key,value){
    if(key===MANUAL)manualWritten=true;
    return originalSet.call(env.store,key,value);
  };
  env.store.getItem=function(key){
    var value=originalGet.call(env.store,key);
    if(key===MANUAL&&manualWritten){
      verificationReads++;
      return JSON.stringify(['restored-2']);
    }
    return value;
  };
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.errorCode,'FULL_RESTORE_FAIL_SAFE_FAILED');
  assert.strictEqual(result.failSafe.manualRelinkPreserved,false);
  assert.ok(verificationReads>=2);
  assert.deepStrictEqual(
    JSON.parse(env.store.value(MANUAL)).sort(),
    ids.slice().sort()
  );
}

async function testSafetyBackupRecordSurvivesCloudFailures(api){
  function safetyRepository(){
    var records={
      'safety-1':{
        backupId:'safety-1',
        snapshot:{currentConferenceId:'before-restore'}
      }
    };
    return {
      getLocalBackup:function(id){
        return Promise.resolve(records[id]?plain(records[id]):null);
      }
    };
  }
  var cases=[
    {pendingApplication:true},
    {silentLinksRollbackMismatch:true}
  ];
  for(var index=0;index<cases.length;index++){
    var repository=safetyRepository();
    var env=environment(api,cases[index]);
    env.options.autoLinking={initialize:function(){return {ok:false};}};
    var result=await api.completePostRestoreCloudReview(env.options);
    assert.strictEqual(result.success,false);
    var stored=await repository.getLocalBackup('safety-1');
    assert.ok(stored);
    assert.strictEqual(stored.backupId,'safety-1');
    assert.strictEqual(
      JSON.parse(env.store.value(MARKER)).safetyBackupId,
      stored.backupId
    );
  }
}

async function testLinkWriteFailureRollback(api){
  var env=environment(api,{failLinksWrite:true});
  var linksBefore=env.store.value(LINKS);
  var markerBefore=env.store.value(MARKER);
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_SYNC_LINKS_WRITE_FAILED'
  );
  assert.strictEqual(result.rollback.attempted,true);
  assert.strictEqual(result.rollback.success,true);
  assert.strictEqual(env.store.value(LINKS),linksBefore);
  assert.strictEqual(env.store.value(MARKER),markerBefore);
  assert.strictEqual(env.events.indexOf('orchestratorStart'),-1);
}

async function testCleanupFailureRollback(api){
  var env=environment(api,{failAttemptsWrite:true});
  var linksBefore=env.store.value(LINKS);
  var attemptsBefore=env.store.value(ATTEMPTS);
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    result.errorCode,
    'FULL_RESTORE_LINKING_ATTEMPT_CLEANUP_FAILED'
  );
  assert.strictEqual(result.rollback.success,true);
  assert.strictEqual(env.store.value(LINKS),linksBefore);
  assert.strictEqual(env.store.value(ATTEMPTS),attemptsBefore);
  assert.ok(env.store.value(MARKER));
}

async function testConcurrentLock(api){
  var wait=deferred();
  var env=environment(api,{queueDeferred:wait});
  var first=api.completePostRestoreCloudReview(env.options);
  await Promise.resolve();
  assert.strictEqual(api.isPostRestoreCloudReviewInProgress(),true);
  var second=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(
    second.errorCode,
    'FULL_RESTORE_CLOUD_REVIEW_ALREADY_IN_PROGRESS'
  );
  wait.resolve({ok:true,data:{operations:[]}});
  var result=await first;
  assert.strictEqual(result.success,true);
  assert.strictEqual(api.isPostRestoreCloudReviewInProgress(),false);
}

async function testNoNetworkOrSupabase(){
  var calls=[];
  var loaded=load({
    fetch:function(){calls.push('fetch');},
    SupabaseSnapshotSync:{
      uploadSnapshot:function(){calls.push('upload');}
    },
    supabase:{
      remove:function(){calls.push('remoteDelete');}
    }
  });
  var api=loaded.api;
  var env=environment(api);
  var result=await api.completePostRestoreCloudReview(env.options);
  assert.strictEqual(result.success,true);
  assert.deepStrictEqual(calls,[]);
}

async function testManualRelinkIsolation(){
  var values={
    [MANUAL]:JSON.stringify(['restored-1'])
  };
  var local={
    getItem:function(key){return values[key]||null;},
    setItem:function(key,value){values[key]=value;},
    removeItem:function(key){delete values[key];}
  };
  var loaded=load({localStorage:local,navigator:{onLine:true}});
  var sandbox=loaded.sandbox;
  [
    'js/sync/automatic-conference-linking.js',
    'js/sync/conference-link-store.js'
  ].forEach(function(file){
    vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),
      sandbox,
      {filename:file}
    );
  });
  var serviceCalls=0;
  var initialized=sandbox.AutomaticConferenceLinking.initialize({
    auth:{initialize:function(){return Promise.resolve();}},
    orchestrator:{schedule:function(){}}
  });
  await initialized.promise;
  var result=await sandbox.AutomaticConferenceLinking.evaluate({
    connectivity:'online',
    preferences:{get:function(){
      return {
        cloudSyncEnabled:true,
        automaticSyncEnabled:true,
        automaticLinkingEnabled:true
      };
    }},
    config:{getPublicState:function(){return {configured:true};}},
    auth:{getState:function(){return {authenticated:true};}},
    getCurrentConference:function(){
      return {id:'restored-1',name:'Restored'};
    },
    links:{get:function(){return null;}},
    service:{ensureConferenceLinked:function(){
      serviceCalls++;
      return Promise.resolve({ok:true,data:{linked:true}});
    }}
  });
  assert.strictEqual(result.status,'manual_relink_required');
  assert.strictEqual(serviceCalls,0);

  var saved=sandbox.ConferenceLinkStore.save({
    localConferenceId:'restored-1',
    remoteConferenceId:'11111111-1111-4111-8111-111111111111',
    linkStatus:'linked',
    knownRevision:1
  },{storage:local});
  assert.strictEqual(saved.ok,true);
  assert.strictEqual(
    loaded.api.isManualRelinkRequired('restored-1',{storage:local}),
    false
  );
}

function testConferenceLinkRollbackFailure(){
  var values={
    [LINKS]:'{}',
    [MANUAL]:JSON.stringify(['restored-1'])
  };
  var linkWrites=0;
  var local={
    getItem:function(key){
      return Object.prototype.hasOwnProperty.call(values,key)
        ?values[key]
        :null;
    },
    setItem:function(key,value){
      if(key===LINKS){
        linkWrites++;
        if(linkWrites>1)throw new Error('ROLLBACK_FAILED');
      }
      values[key]=value;
    },
    removeItem:function(key){
      if(key===MANUAL){
        delete values[key];
        throw new Error('MANUAL_CLEAR_FAILED');
      }
      delete values[key];
    }
  };
  var loaded=load({localStorage:local});
  vm.runInNewContext(
    fs.readFileSync(
      path.join(root,'js/sync/conference-link-store.js'),
      'utf8'
    ),
    loaded.sandbox,
    {filename:'js/sync/conference-link-store.js'}
  );
  var result=loaded.sandbox.ConferenceLinkStore.save({
    localConferenceId:'restored-1',
    remoteConferenceId:'11111111-1111-4111-8111-111111111111',
    linkStatus:'linked',
    knownRevision:1
  },{storage:local});
  assert.strictEqual(result.ok,false);
  assert.strictEqual(result.status,'rollback_failed');
  assert.strictEqual(result.rollback.attempted,true);
  assert.strictEqual(result.rollback.success,false);
  assert.strictEqual(result.linkState.localConferenceId,'restored-1');
  assert.strictEqual(result.manualRelinkRequired,true);
  assert.strictEqual(result.isolationPreserved,true);
  assert.strictEqual(result.rollbackError,'SYNC_LINK_ROLLBACK_FAILED');
  assert.deepStrictEqual(JSON.parse(values[MANUAL]),['restored-1']);
}

async function run(){
  var api=load().api;
  testMarkerContract(api);
  testPureReview(api);
  await testSuccessfulCleanup(api);
  await testNoAffectedLinks(api);
  await testMalformedRootBlocks(api);
  await testMalformedLinkAndAttemptsBlock(api);
  await testQueueAndPendingBlock(api);
  await testMalformedQueueRecordsBlock(api);
  await testValidQueueContractPasses(api);
  await testQueueSnapshotContractRejectsInvalidValues(api);
  testUuidVersionsMatchLinkStore(api);
  await testPendingApplicationContract(api);
  await testOperationallyMalformedLinksBlock(api);
  await testLinkingAttemptsAtomicGuards(api);
  await testRestartFailureDoesNotChangeRuntime(api);
  await testVerifiedRollbackAndFailSafeContinuation(api);
  await testAbsentStorageKeysRollback(api);
  await testRejectedInitializePromiseEntersFailSafe(api);
  await testFinalVerificationCancelsStartupTimer(api);
  await testMultipleManualRelinkVerificationContinues(api);
  await testSafetyBackupRecordSurvivesCloudFailures(api);
  await testLinkWriteFailureRollback(api);
  await testCleanupFailureRollback(api);
  await testConcurrentLock(api);
  await testNoNetworkOrSupabase();
  await testManualRelinkIsolation();
  testConferenceLinkRollbackFailure();
  console.log('Full backup phase 5 tests passed.');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
