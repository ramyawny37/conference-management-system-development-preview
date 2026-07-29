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
  resolution:'44444444-4444-4444-8444-444444444444',
  device:'55555555-5555-4555-8555-555555555555'
};

function copy(value){
  return JSON.parse(JSON.stringify(value));
}

function makeDraft(strategy){
  var revision=strategy==='keep_server'?5:6;
  return {
    localConferenceId:'local-1',
    conflictId:ids.conflict,
    resolutionOperationId:ids.resolution,
    plan:{
      conflictId:ids.conflict,
      conferenceId:ids.conference,
      strategy:strategy,
      baseRevision:5,
      actualRevision:5,
      sourceRevision:4,
      sourceOperationId:ids.source,
      resolutionOperationId:ids.resolution,
      schemaVersion:'1',
      appVersion:'4.0.0',
      resolvedSnapshot:{id:'local-1',name:'Resolved'}
    },
    status:'executed',
    executionStatus:'executed',
    executionResult:{
      ok:true,
      status:strategy==='keep_server'?'server_selected':'resolved',
      data:{
        conflictId:ids.conflict,
        conferenceId:ids.conference,
        strategy:strategy,
        operationId:ids.resolution,
        resolvedRevision:revision,
        resolvedSnapshot:{id:'local-1',name:'Resolved'}
      }
    },
    resolvedRevision:revision,
    finalization:{
      pendingApplicationStored:false,
      revisionPublished:false,
      linkMetadataUpdated:false,
      queueUpdated:false,
      draftCompleted:false
    }
  };
}

function environment(strategy,failure){
  failure=failure||{};
  if(typeof failure==='string')failure={flag:failure};
  var draft=makeDraft(strategy);
  var link={
    localConferenceId:'local-1',
    remoteConferenceId:ids.conference,
    remoteName:'Remote',
    knownRevision:4,
    actualRevision:5,
    linkStatus:'needs_resolution',
    conflictId:ids.conflict,
    conflictStatus:'active',
    pendingLocalApplication:false
  };
  var calls={
    pending:0,
    publisher:0,
    link:0,
    queue:0,
    queueEffects:0,
    pendingEffects:0,
    publisherEffects:0,
    completed:0,
    flags:[]
  };
  var failed=false;
  var drafts={
    get:function(){
      return Promise.resolve({ok:true,data:copy(draft)});
    },
    updateFinalization:function(localId,patch){
      var flag=Object.keys(patch)[0];
      calls.flags.push(flag);
      if(flag===failure.flag&&!failed){
        failed=true;
        return Promise.resolve({ok:false,status:'storage_failed'});
      }
      draft.finalization[flag]=true;
      draft.executionStatus='finalizing';
      draft.status='finalizing';
      return Promise.resolve({ok:true,data:copy(draft)});
    },
    markCompleted:function(){
      calls.completed++;
      draft.finalization.draftCompleted=true;
      draft.executionStatus='completed';
      draft.status='completed';
      if(failure.completionResponse&&!failed){
        failed=true;
        return Promise.resolve({ok:false,status:'storage_failed'});
      }
      return Promise.resolve({ok:true,status:'completed'});
    }
  };
  var pendingRecord=null;
  var pending={
    save:function(input){
      calls.pending++;
      if(pendingRecord){
        assert.strictEqual(
          pendingRecord.resolutionOperationId,
          input.resolutionOperationId
        );
        return Promise.resolve({
          ok:true,status:'duplicate',data:copy(pendingRecord)
        });
      }
      pendingRecord=copy(input);
      pendingRecord.status='pending';
      calls.pendingEffects++;
      return Promise.resolve({
        ok:true,status:'pending',data:copy(pendingRecord)
      });
    }
  };
  var links={
    get:function(){return copy(link);},
    save:function(input){
      calls.link++;
      link=copy(input);
      return {ok:true,status:'saved',data:copy(link)};
    }
  };
  var queue={
    resolution:null,
    markConflictResolved:function(operationId,input){
      calls.queue++;
      assert.strictEqual(operationId,ids.source);
      assert.strictEqual(input.resolutionOperationId,ids.resolution);
      if(queue.resolution){
        assert.deepStrictEqual(queue.resolution,copy(input));
      }else{
        queue.resolution=copy(input);
        calls.queueEffects++;
      }
      return Promise.resolve({ok:true,status:'resolved'});
    }
  };
  var publisher={
    publishConferenceRevision:function(input){
      calls.publisher++;
      assert.strictEqual(input.remoteConferenceId,ids.conference);
      assert.strictEqual(input.revision,draft.resolvedRevision);
      assert.strictEqual(input.allowActiveConflict,true);
      if(link.knownRevision!==input.revision||
        link.actualRevision!==input.revision){
        link.knownRevision=input.revision;
        link.actualRevision=input.revision;
        calls.publisherEffects++;
      }
      return Promise.resolve({
        ok:true,status:'revision_published',data:{revision:input.revision}
      });
    }
  };
  function loadService(){
    var sandbox={
      window:null,
      Promise:Promise,
      JSON:JSON,
      Object:Object,
      String:String,
      Number:Number,
      Date:Date,
      structuredClone:global.structuredClone
    };
    sandbox.window=sandbox;
    vm.runInNewContext(
      fs.readFileSync(path.join(
        root,'js/sync/conflict-finalization-service.js'
      ),'utf8'),
      sandbox,
      {filename:'conflict-finalization-service.js'}
    );
    return sandbox.ConflictFinalizationService;
  }
  return {
    service:loadService(),
    reloadService:loadService,
    options:{
      drafts:drafts,
      pending:pending,
      links:links,
      queue:queue,
      publisher:publisher,
      deviceIdentity:{getOrCreate:function(){return {id:ids.device};}}
    },
    calls:calls,
    draft:function(){return copy(draft);},
    link:function(){return copy(link);},
    pending:function(){return pendingRecord&&copy(pendingRecord);}
  };
}

async function run(){
  var local=environment('keep_local');
  var localResult=await local.service.finalize('local-1',local.options);
  assert.strictEqual(localResult.ok,true);
  assert.strictEqual(local.calls.pending,0);
  assert.strictEqual(local.calls.publisher,1);
  assert.strictEqual(local.calls.link,1);
  assert.strictEqual(local.calls.queue,1);
  assert.strictEqual(local.link().knownRevision,6);
  assert.strictEqual(local.link().actualRevision,6);
  assert.strictEqual(local.link().pendingLocalApplication,false);
  assert.strictEqual(local.link().linkStatus,'linked');
  assert.deepStrictEqual(local.calls.flags,[
    'pendingApplicationStored',
    'revisionPublished',
    'linkMetadataUpdated',
    'queueUpdated'
  ]);

  var remote=environment('keep_server');
  var remoteResult=await remote.service.finalize('local-1',remote.options);
  assert.strictEqual(remoteResult.ok,true);
  assert.strictEqual(remote.calls.pending,1);
  assert.strictEqual(remote.pending().status,'pending');
  assert.strictEqual(remote.link().knownRevision,5);
  assert.strictEqual(remote.link().actualRevision,5);
  assert.strictEqual(remote.link().pendingLocalApplication,true);
  assert.strictEqual(
    remote.link().linkStatus,
    'server_selected_pending_local_apply'
  );
  assert.strictEqual(remote.calls.queue,1);

  var pendingInterrupted=environment('keep_server',{
    flag:'pendingApplicationStored'
  });
  assert.strictEqual(
    (await pendingInterrupted.service.finalize(
      'local-1',pendingInterrupted.options
    )).status,
    'finalization_incomplete'
  );
  var firstPending=copy(pendingInterrupted.pending());
  pendingInterrupted.service=pendingInterrupted.reloadService();
  assert.strictEqual(
    (await pendingInterrupted.service.finalize(
      'local-1',pendingInterrupted.options
    )).ok,
    true
  );
  assert.strictEqual(pendingInterrupted.calls.pending,2);
  assert.strictEqual(pendingInterrupted.calls.pendingEffects,1);
  assert.deepStrictEqual(pendingInterrupted.pending(),firstPending);

  var interrupted=environment('keep_server','revisionPublished');
  var first=await interrupted.service.finalize(
    'local-1',interrupted.options
  );
  assert.strictEqual(first.ok,false);
  assert.strictEqual(first.status,'finalization_incomplete');
  assert.strictEqual(interrupted.calls.pending,1);
  assert.strictEqual(interrupted.calls.publisher,1);
  assert.strictEqual(interrupted.calls.link,0);
  assert.strictEqual(interrupted.calls.queue,0);
  interrupted.service=interrupted.reloadService();
  var resumed=await interrupted.service.finalize(
    'local-1',interrupted.options
  );
  assert.strictEqual(resumed.ok,true);
  assert.strictEqual(interrupted.calls.pending,1);
  assert.strictEqual(interrupted.calls.publisher,2);
  assert.strictEqual(interrupted.calls.publisherEffects,1);
  assert.strictEqual(interrupted.calls.link,1);
  assert.strictEqual(interrupted.calls.queue,1);

  var completedAgain=await interrupted.service.finalize(
    'local-1',interrupted.options
  );
  assert.strictEqual(completedAgain.status,'already_completed');
  assert.strictEqual(interrupted.calls.pending,1);
  assert.strictEqual(interrupted.calls.publisher,2);
  assert.strictEqual(interrupted.calls.link,1);
  assert.strictEqual(interrupted.calls.queue,1);

  var linkInterrupted=environment('keep_server',{
    flag:'linkMetadataUpdated'
  });
  assert.strictEqual(
    (await linkInterrupted.service.finalize(
      'local-1',linkInterrupted.options
    )).status,
    'finalization_incomplete'
  );
  var remoteIdBefore=linkInterrupted.link().remoteConferenceId;
  var conflictIdBefore=linkInterrupted.link().conflictId;
  linkInterrupted.service=linkInterrupted.reloadService();
  assert.strictEqual(
    (await linkInterrupted.service.finalize(
      'local-1',linkInterrupted.options
    )).ok,
    true
  );
  assert.strictEqual(linkInterrupted.calls.link,2);
  assert.strictEqual(
    linkInterrupted.link().remoteConferenceId,
    remoteIdBefore
  );
  assert.strictEqual(linkInterrupted.link().conflictId,conflictIdBefore);
  assert.strictEqual(
    linkInterrupted.link().linkStatus,
    'server_selected_pending_local_apply'
  );

  var queueInterrupted=environment('manual',{flag:'queueUpdated'});
  assert.strictEqual(
    (await queueInterrupted.service.finalize(
      'local-1',queueInterrupted.options
    )).status,
    'finalization_incomplete'
  );
  queueInterrupted.service=queueInterrupted.reloadService();
  assert.strictEqual(
    (await queueInterrupted.service.finalize(
      'local-1',queueInterrupted.options
    )).ok,
    true
  );
  assert.strictEqual(queueInterrupted.calls.queue,2);
  assert.strictEqual(queueInterrupted.calls.queueEffects,1);
  assert.strictEqual(
    queueInterrupted.link().resolutionOperationId,
    ids.resolution
  );

  var completionInterrupted=environment('keep_local',{
    completionResponse:true
  });
  assert.strictEqual(
    (await completionInterrupted.service.finalize(
      'local-1',completionInterrupted.options
    )).status,
    'finalization_incomplete'
  );
  assert.strictEqual(
    completionInterrupted.draft().executionStatus,
    'completed'
  );
  var completionCounts=copy(completionInterrupted.calls);
  completionInterrupted.service=completionInterrupted.reloadService();
  assert.strictEqual(
    (await completionInterrupted.service.finalize(
      'local-1',completionInterrupted.options
    )).status,
    'already_completed'
  );
  assert.strictEqual(
    completionInterrupted.calls.publisher,
    completionCounts.publisher
  );
  assert.strictEqual(completionInterrupted.calls.link,completionCounts.link);
  assert.strictEqual(
    completionInterrupted.calls.queue,
    completionCounts.queue
  );

  var rejectedPromises=[
    function(draft){
      draft.executionResult.status='conflict_changed';
      draft.executionResult.ok=true;
    },
    function(draft){
      draft.executionResult={ok:true,status:'resolved',data:null};
    },
    function(draft){
      draft.executionResult.data.resolvedRevision=99;
    },
    function(draft){
      draft.executionResult.data.conferenceId=ids.conflict;
    },
    function(draft){
      draft.executionResult.data.conflictId=ids.conference;
    },
    function(draft){
      draft.executionResult.data.operationId=ids.source;
    }
  ].map(function(mutate){
    var rejectedEnvironment=environment('keep_local');
    var badDraft=rejectedEnvironment.draft();
    mutate(badDraft);
    var initialFlags=copy(badDraft.finalization);
    rejectedEnvironment.options.drafts.get=function(){
      return Promise.resolve({ok:true,data:copy(badDraft)});
    };
    return rejectedEnvironment.service.finalize(
        'local-1',rejectedEnvironment.options
      ).then(function(rejected){
        assert.strictEqual(
          rejected.status,
          'untrusted_execution_result'
        );
        assert.deepStrictEqual(badDraft.finalization,initialFlags);
        assert.strictEqual(rejectedEnvironment.calls.pending,0);
        assert.strictEqual(rejectedEnvironment.calls.publisher,0);
        assert.strictEqual(rejectedEnvironment.calls.link,0);
        assert.strictEqual(rejectedEnvironment.calls.queue,0);
      });
  });
  await Promise.all(rejectedPromises);

  var lockEnvironment=environment('keep_local');
  var lockReads=0;
  var releaseSame;
  lockEnvironment.options.drafts.get=function(){
    lockReads++;
    return new Promise(function(resolve){releaseSame=resolve;});
  };
  var sameFirst=lockEnvironment.service.finalize(
    'local-1',lockEnvironment.options
  );
  var sameSecond=lockEnvironment.service.finalize(
    'local-1',lockEnvironment.options
  );
  assert.strictEqual(sameFirst,sameSecond);
  assert.strictEqual(lockReads,1);
  var rejectedDraft=lockEnvironment.draft();
  rejectedDraft.executionResult.status='conflict_changed';
  releaseSame({ok:true,data:rejectedDraft});
  await sameFirst;
  lockEnvironment.options.drafts.get=function(){
    lockReads++;
    return Promise.resolve({ok:true,data:rejectedDraft});
  };
  await lockEnvironment.service.finalize(
    'local-1',lockEnvironment.options
  );
  assert.strictEqual(lockReads,2);

  var parallelEnvironment=environment('keep_local');
  var releases={};
  var parallelReads=[];
  parallelEnvironment.options.drafts.get=function(localId){
    parallelReads.push(localId);
    return new Promise(function(resolve){releases[localId]=resolve;});
  };
  var conferenceA=parallelEnvironment.service.finalize(
    'local-a',parallelEnvironment.options
  );
  var conferenceB=parallelEnvironment.service.finalize(
    'local-b',parallelEnvironment.options
  );
  assert.deepStrictEqual(parallelReads,['local-a','local-b']);
  var parallelDraft=parallelEnvironment.draft();
  parallelDraft.executionResult.status='conflict_changed';
  releases['local-a']({ok:true,data:parallelDraft});
  releases['local-b']({ok:true,data:parallelDraft});
  await Promise.all([conferenceA,conferenceB]);

  var records={};
  var indexedDb={
    getRecord:function(store,key){
      return Promise.resolve(records[store+'::'+key]||null);
    },
    putRecord:function(store,record){
      records[store+'::'+record.localConferenceId]=copy(record);
      return Promise.resolve(record);
    }
  };
  var draftSandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Array:Array,
    Date:Date,
    structuredClone:global.structuredClone,
    AppIndexedDB:indexedDb
  };
  draftSandbox.window=draftSandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(
      root,'js/sync/conflict-resolution-draft-store.js'
    ),'utf8'),
    draftSandbox,
    {filename:'conflict-resolution-draft-store.js'}
  );
  var persisted=makeDraft('keep_local');
  assert.strictEqual(
    (await draftSandbox.ConflictResolutionDraftStore.save(
      'local-persisted',persisted.plan
    )).ok,
    true
  );
  assert.strictEqual(
    (await draftSandbox.ConflictResolutionDraftStore.saveExecutionResult(
      'local-persisted',persisted.executionResult
    )).status,
    'executed'
  );
  var persistedRead=await draftSandbox.ConflictResolutionDraftStore.get(
    'local-persisted'
  );
  assert.strictEqual(persistedRead.data.executionStatus,'executed');
  assert.strictEqual(
    persistedRead.data.executionResult.data.operationId,
    ids.resolution
  );
  assert.strictEqual(persistedRead.data.resolvedRevision,6);

  var pendingSandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Array:Array,
    Uint8Array:Uint8Array,
    TextEncoder:TextEncoder,
    crypto:require('crypto').webcrypto,
    structuredClone:global.structuredClone,
    AppIndexedDB:indexedDb
  };
  pendingSandbox.window=pendingSandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(
      root,'js/sync/pending-remote-application-store.js'
    ),'utf8'),
    pendingSandbox,
    {filename:'pending-remote-application-store.js'}
  );
  var pendingInput={
    localConferenceId:'local-1',
    remoteConferenceId:ids.conference,
    conflictId:ids.conflict,
    resolutionStrategy:'keep_server',
    resolutionOperationId:ids.resolution,
    resolvedRevision:5,
    resolvedSnapshot:{id:'local-1',name:'Remote'}
  };
  assert.strictEqual(
    (await pendingSandbox.PendingRemoteApplicationStore
      .save(pendingInput)).status,
    'pending'
  );
  assert.strictEqual(
    (await pendingSandbox.PendingRemoteApplicationStore
      .save(pendingInput)).status,
    'duplicate'
  );
  var mismatched=copy(pendingInput);
  mismatched.resolutionOperationId=ids.source;
  assert.strictEqual(
    (await pendingSandbox.PendingRemoteApplicationStore
      .save(mismatched)).status,
    'pending_mismatch'
  );

  console.log('conflict finalization phase 3 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
