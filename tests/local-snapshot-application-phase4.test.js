'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var ids={
  conflict:'11111111-1111-4111-8111-111111111111',
  conference:'22222222-2222-4222-8222-222222222222',
  resolution:'33333333-3333-4333-8333-333333333333'
};

function copy(value){
  return JSON.parse(JSON.stringify(value));
}

function environment(failure){
  failure=failure||{};
  var remoteSnapshot={id:'local-1',name:'Remote'};
  var localSnapshot={id:'local-1',name:'Local'};
  var appData={currentConferenceId:'local-1',
    conferences:[copy(localSnapshot)]};
  var record={
    localConferenceId:'local-1',
    remoteConferenceId:ids.conference,
    conflictId:ids.conflict,
    resolutionStrategy:'keep_server',
    resolutionOperationId:ids.resolution,
    resolvedRevision:5,
    resolvedSnapshot:copy(remoteSnapshot),
    snapshotDigest:JSON.stringify(remoteSnapshot),
    status:'pending',
    applicationState:{
      validationCompleted:false,
      backupStored:false,
      localSnapshotSaved:false,
      linkFinalized:false,
      pendingCompleted:false
    }
  };
  var link={
    localConferenceId:'local-1',
    remoteConferenceId:ids.conference,
    knownRevision:5,
    actualRevision:5,
    linkStatus:'server_selected_pending_local_apply',
    conflictId:ids.conflict,
    conflictStatus:'resolved',
    resolutionOperationId:ids.resolution,
    resolvedRevision:5,
    pendingLocalApplication:true,
    lastResolvedAt:'2026-07-29T10:00:00.000Z'
  };
  var calls={
    flags:[],backup:0,backupEffects:0,save:0,saveEffects:0,
    link:0,linkEffects:0,mark:0,markEffects:0
  };
  var failedFlags={};
  var pending={
    get:function(){
      if(!record){
        return Promise.resolve({ok:false,status:'not_found',data:null});
      }
      return Promise.resolve({ok:true,status:record.status,data:copy(record)});
    },
    verify:function(input){
      return Promise.resolve(
        input.snapshotDigest===JSON.stringify(input.resolvedSnapshot)
      );
    },
    buildDigest:function(snapshot){
      return Promise.resolve(JSON.stringify(snapshot));
    },
    updateApplicationState:function(localId,input){
      var flag=Object.keys(input.patch)[0];
      calls.flags.push(flag);
      if(failure.flag===flag&&!failedFlags[flag]){
        failedFlags[flag]=true;
        return Promise.resolve({ok:false,status:'storage_failed'});
      }
      record.applicationState[flag]=true;
      return Promise.resolve({ok:true,data:copy(record)});
    },
    mark:function(){
      calls.mark++;
      if(record.status!=='applied'){
        record.status='applied';
        record.applicationState.pendingCompleted=true;
        calls.markEffects++;
      }
      if(failure.markResponse&&!failedFlags.mark){
        failedFlags.mark=true;
        return Promise.resolve({ok:false,status:'storage_failed'});
      }
      return Promise.resolve({ok:true,status:'applied',data:copy(record)});
    }
  };
  var backupRecord=null;
  var backups={
    create:function(input){
      calls.backup++;
      if(!backupRecord){
        backupRecord=copy(input);
        calls.backupEffects++;
      }else{
        assert.strictEqual(
          backupRecord.resolutionOperationId,
          input.resolutionOperationId
        );
      }
      if(failure.backupFailure)return Promise.resolve({ok:false});
      return Promise.resolve({
        ok:true,
        status:calls.backupEffects===calls.backup?'created':'duplicate',
        data:copy(backupRecord)
      });
    }
  };
  var repository={
    saveAppSnapshot:function(next,options){
      calls.save++;
      assert.strictEqual(options.source,'remote_resolution');
      assert.strictEqual(options.skipSyncQueue,true);
      if(failure.storageFailure)return Promise.reject(new Error('save'));
      if(JSON.stringify(appData)!==JSON.stringify(next)){
        appData=copy(next);
        calls.saveEffects++;
      }
      return Promise.resolve({ok:true});
    }
  };
  var links={
    get:function(){return copy(link);},
    save:function(input){
      calls.link++;
      if(link.linkStatus!==input.linkStatus||
        link.pendingLocalApplication!==input.pendingLocalApplication){
        link=copy(input);
        calls.linkEffects++;
      }
      if(failure.linkResponse&&!failedFlags.link){
        failedFlags.link=true;
        return {ok:false,status:'storage_error'};
      }
      return {ok:true,status:'saved',data:copy(link)};
    }
  };
  function loadService(){
    var sandbox={
      window:null,Promise:Promise,JSON:JSON,Object:Object,
      String:String,Number:Number,Array:Array,
      structuredClone:global.structuredClone
    };
    sandbox.window=sandbox;
    vm.runInNewContext(
      fs.readFileSync(path.join(
        root,'js/sync/local-snapshot-application.js'
      ),'utf8'),
      sandbox,
      {filename:'local-snapshot-application.js'}
    );
    return sandbox.LocalSnapshotApplication;
  }
  var options={
    repository:repository,
    backups:backups,
    pendingStore:pending,
    links:links,
    appData:appData,
    applyMemory:function(next){
      appData=copy(next);
      options.appData=appData;
    }
  };
  return {
    service:loadService(),
    reload:function(){this.service=loadService();},
    options:options,
    calls:calls,
    record:function(){return copy(record);},
    setRecord:function(next){record=copy(next);},
    link:function(){return copy(link);},
    setLink:function(next){link=copy(next);},
    appData:function(){return copy(appData);},
    backup:function(){return backupRecord&&copy(backupRecord);}
  };
}

async function interrupted(flag){
  var env=environment({flag:flag});
  assert.strictEqual(
    (await env.service.apply(
      {localConferenceId:'local-1'},env.options
    )).status,
    'application_incomplete'
  );
  env.reload();
  assert.strictEqual(
    (await env.service.apply(
      {localConferenceId:'local-1'},env.options
    )).ok,
    true
  );
  return env;
}

async function run(){
  var complete=environment();
  var applied=await complete.service.apply(
    {localConferenceId:'local-1'},complete.options
  );
  assert.strictEqual(applied.status,'applied');
  assert.strictEqual(complete.calls.backupEffects,1);
  assert.strictEqual(complete.calls.saveEffects,1);
  assert.strictEqual(complete.calls.linkEffects,1);
  assert.strictEqual(complete.calls.markEffects,1);
  assert.strictEqual(complete.link().knownRevision,5);
  assert.strictEqual(complete.link().remoteConferenceId,ids.conference);
  assert.strictEqual(complete.link().linkStatus,'linked');
  assert.strictEqual(complete.link().pendingLocalApplication,false);
  assert.strictEqual(complete.record().status,'applied');
  assert.strictEqual(complete.appData().conferences[0].name,'Remote');
  complete.reload();
  assert.strictEqual(
    (await complete.service.apply(
      {localConferenceId:'local-1'},complete.options
    )).status,
    'already_applied'
  );
  assert.strictEqual(complete.calls.backupEffects,1);
  assert.strictEqual(complete.calls.saveEffects,1);
  assert.strictEqual(complete.calls.linkEffects,1);
  assert.strictEqual(complete.calls.markEffects,1);

  var backupWindow=await interrupted('backupStored');
  assert.strictEqual(backupWindow.calls.backup,2);
  assert.strictEqual(backupWindow.calls.backupEffects,1);

  var saveWindow=await interrupted('localSnapshotSaved');
  assert.strictEqual(saveWindow.calls.save,1);
  assert.strictEqual(saveWindow.calls.saveEffects,1);
  assert.strictEqual(saveWindow.calls.backupEffects,1);

  var linkWindow=await interrupted('linkFinalized');
  assert.strictEqual(linkWindow.calls.link,1);
  assert.strictEqual(linkWindow.calls.linkEffects,1);
  assert.strictEqual(linkWindow.link().remoteConferenceId,ids.conference);

  var pendingWindow=environment({markResponse:true});
  assert.strictEqual(
    (await pendingWindow.service.apply(
      {localConferenceId:'local-1'},pendingWindow.options
    )).status,
    'application_incomplete'
  );
  pendingWindow.reload();
  assert.strictEqual(
    (await pendingWindow.service.apply(
      {localConferenceId:'local-1'},pendingWindow.options
    )).status,
    'already_applied'
  );
  assert.strictEqual(pendingWindow.calls.markEffects,1);

  var rejectionMutations=[
    function(env){env.setRecord(null);},
    function(env){
      var record=env.record();record.localConferenceId='other';
      env.setRecord(record);
    },
    function(env){
      var record=env.record();record.remoteConferenceId=ids.conflict;
      env.setRecord(record);
    },
    function(env){
      var record=env.record();record.conflictId=ids.conference;
      env.setRecord(record);
    },
    function(env){
      var record=env.record();record.resolutionOperationId=ids.conflict;
      env.setRecord(record);
    },
    function(env){
      var record=env.record();record.resolvedRevision=9;
      env.setRecord(record);
    },
    function(env){
      var record=env.record();record.snapshotDigest='bad';
      env.setRecord(record);
    },
    function(env){
      var link=env.link();link.linkStatus='linked';
      env.setLink(link);
    },
    function(env){
      var record=env.record();record.resolvedSnapshot=null;
      env.setRecord(record);
    }
  ];
  for(var index=0;index<rejectionMutations.length;index++){
    var rejected=environment();
    rejectionMutations[index](rejected);
    var beforeData=rejected.appData();
    var beforeLink=rejected.link();
    var rejectedResult=await rejected.service.apply(
      {localConferenceId:'local-1'},rejected.options
    );
    assert.strictEqual(rejectedResult.ok,false);
    assert.deepStrictEqual(rejected.appData(),beforeData);
    assert.deepStrictEqual(rejected.link(),beforeLink);
    assert.strictEqual(rejected.calls.backupEffects,0);
    assert.strictEqual(rejected.calls.saveEffects,0);
    assert.strictEqual(rejected.calls.markEffects,0);
  }

  var backupFailure=environment({backupFailure:true});
  assert.strictEqual(
    (await backupFailure.service.apply(
      {localConferenceId:'local-1'},backupFailure.options
    )).ok,
    false
  );
  assert.strictEqual(backupFailure.calls.saveEffects,0);
  assert.strictEqual(backupFailure.calls.linkEffects,0);

  var storageFailure=environment({storageFailure:true});
  assert.strictEqual(
    (await storageFailure.service.apply(
      {localConferenceId:'local-1'},storageFailure.options
    )).ok,
    false
  );
  assert.strictEqual(storageFailure.link().linkStatus,
    'server_selected_pending_local_apply');
  assert.strictEqual(storageFailure.link().pendingLocalApplication,true);
  assert.strictEqual(storageFailure.calls.linkEffects,0);
  assert.strictEqual(storageFailure.calls.markEffects,0);

  console.log('local snapshot application phase 4 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
