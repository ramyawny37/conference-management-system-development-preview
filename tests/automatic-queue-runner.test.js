'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/automatic-queue-runner.js'
),'utf8');
var ids={
  first:'11111111-1111-4111-8111-111111111111',
  second:'22222222-2222-4222-8222-222222222222',
  device:'33333333-3333-4333-8333-333333333333'
};

function environment(){
  var scheduled=[];
  var sandbox={
    window:null,
    Promise:Promise,
    Date:Date,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Math:Math,
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    structuredClone:global.structuredClone,
    AutomaticSyncOrchestrator:{
      schedule:function(reason){scheduled.push(reason);}
    }
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'automatic-queue-runner.js'});
  return {window:sandbox,scheduled:scheduled};
}

function operation(id,conferenceId){
  return {
    operationId:id,
    conferenceId:conferenceId,
    status:'pending',
    attempts:0
  };
}

function options(overrides){
  var operations=[
    operation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ids.first)
  ];
  var links={};
  links[ids.first]={
    localConferenceId:'local-first',
    remoteConferenceId:ids.first,
    linkStatus:'linked',
    knownRevision:1,
    pendingLocalApplication:false
  };
  var value={
    connectivity:'online',
    reasons:['local_save'],
    jitterValue:0,
    preferences:{get:function(){
      return {cloudSyncEnabled:true,automaticSyncEnabled:true};
    }},
    clientLayer:{getState:function(){
      return {configured:true,available:true};
    }},
    auth:{getState:function(){return {authenticated:true};}},
    deviceIdentity:{getOrCreate:function(){return {id:ids.device};}},
    queue:{getReadyOperations:function(){
      return Promise.resolve({
        ok:true,
        data:{operations:operations.slice()}
      });
    }},
    linkStore:{
      findByRemoteId:function(remoteId){return links[remoteId]||null;},
      save:function(input){
        links[input.remoteConferenceId]=input;
        return {ok:true};
      }
    },
    pendingApplicationStore:{get:function(){
      return Promise.resolve({ok:false,status:'not_found'});
    }},
    processor:{processOperation:function(operationId){
      return Promise.resolve({
        ok:true,
        status:'applied',
        data:{
          operationId:operationId,
          revision:2,
          operation:{conferenceId:ids.first,attempts:1}
        }
      });
    }}
  };
  Object.keys(overrides||{}).forEach(function(key){value[key]=overrides[key];});
  value._operations=operations;
  value._links=links;
  return value;
}

async function run(){
  var env=environment();
  var runner=env.window.AutomaticQueueRunner;
  assert.strictEqual(runner.calculateBackoffDelay(1,0),5000);
  assert.strictEqual(runner.calculateBackoffDelay(2,-1),12000);
  assert.strictEqual(runner.calculateBackoffDelay(5,1),360000);

  var calls=0;
  var disabled=options({
    preferences:{get:function(){
      return {cloudSyncEnabled:false,automaticSyncEnabled:true};
    }},
    processor:{processOperation:function(){calls++;}}
  });
  assert.strictEqual((await runner.run(disabled)).status,'waiting');
  assert.strictEqual(calls,0);

  runner.resetForTests();
  calls=0;
  var disabledManual=options({
    reasons:['manual_retry'],
    preferences:{get:function(){
      return {cloudSyncEnabled:false,automaticSyncEnabled:false};
    }},
    processor:{processOperation:function(){calls++;}}
  });
  assert.strictEqual((await runner.run(disabledManual)).status,'waiting');
  assert.strictEqual(calls,0);

  runner.resetForTests();
  var automaticOff=options({
    preferences:{get:function(){
      return {cloudSyncEnabled:true,automaticSyncEnabled:false};
    }}
  });
  assert.strictEqual((await runner.run(automaticOff)).status,'waiting');
  automaticOff.reasons=['manual_retry'];
  assert.strictEqual((await runner.run(automaticOff)).status,'completed');

  runner.resetForTests();
  calls=0;
  var offlineManual=options({
    connectivity:'browser_offline',
    reasons:['manual_retry'],
    processor:{processOperation:function(){calls++;}}
  });
  assert.strictEqual((await runner.run(offlineManual)).status,'waiting');
  assert.strictEqual(calls,0);

  runner.resetForTests();
  var absentSession=options({
    reasons:['manual_retry'],
    auth:{getState:function(){return {authenticated:false};}}
  });
  assert.strictEqual(
    (await runner.run(absentSession)).data.reason,
    'AUTH_REQUIRED'
  );

  var waitingCases=[
    options({connectivity:'browser_offline'}),
    options({clientLayer:{getState:function(){
      return {configured:false,available:false};
    }}}),
    options({deviceIdentity:{getOrCreate:function(){return null;}}})
  ];
  for(var waitingIndex=0;waitingIndex<waitingCases.length;waitingIndex++){
    runner.resetForTests();
    assert.strictEqual((await runner.run(waitingCases[waitingIndex])).status,
      'waiting');
  }

  runner.resetForTests();
  var empty=options();
  empty._operations.length=0;
  assert.strictEqual((await runner.run(empty)).status,'empty');

  runner.resetForTests();
  var unlinkedCalls=0;
  var unlinked=options({
    linkStore:{findByRemoteId:function(){return null;}},
    processor:{processOperation:function(){unlinkedCalls++;}}
  });
  assert.strictEqual((await runner.run(unlinked)).status,'empty');
  assert.strictEqual(unlinkedCalls,0);

  runner.resetForTests();
  var resolution=options();
  resolution.reasons=['manual_retry'];
  resolution._links[ids.first].linkStatus='needs_resolution';
  assert.strictEqual((await runner.run(resolution)).status,'empty');

  runner.resetForTests();
  var blocked=options({
    reasons:['manual_retry'],
    pendingApplicationStore:{get:function(){
      return Promise.resolve({ok:true,data:{status:'pending'}});
    }}
  });
  assert.strictEqual((await runner.run(blocked)).status,'empty');

  runner.resetForTests();
  var backoffBypassCalls=0;
  var backoffBypass=options({
    reasons:['local_save'],
    processor:{processOperation:function(){
      backoffBypassCalls++;
      return Promise.resolve({
        ok:true,status:'failed',data:{operation:{attempts:1}},
        error:{code:'NETWORK_ERROR'}
      });
    }}
  });
  await runner.run(backoffBypass);
  backoffBypass.reasons=['manual_retry'];
  backoffBypass.processor={processOperation:function(){
    backoffBypassCalls++;
    return Promise.resolve({ok:true,status:'applied',data:{
      revision:2,operation:{conferenceId:ids.first}
    }});
  }};
  await runner.run(backoffBypass);
  assert.strictEqual(backoffBypassCalls,2);

  runner.resetForTests();
  var success=options();
  var successResult=await runner.run(success);
  assert.strictEqual(successResult.data.processed,1);
  assert.ok(runner.getState().lastSuccessfulSyncAt);

  runner.resetForTests();
  var duplicate=options({
    processor:{processOperation:function(){
      return Promise.resolve({ok:true,status:'duplicate',data:{
        revision:2,operation:{conferenceId:ids.first}
      }});
    }}
  });
  assert.strictEqual((await runner.run(duplicate)).data.results[0].status,
    'duplicate');

  runner.resetForTests();
  var conflict=options({
    processor:{processOperation:function(){
      return Promise.resolve({
        ok:true,status:'conflict',
        data:{actualRevision:3,conflictId:'conflict-1'}
      });
    }}
  });
  await runner.run(conflict);
  assert.strictEqual(conflict._links[ids.first].linkStatus,'needs_resolution');
  assert.strictEqual(runner.getState().conflictCount,1);

  runner.resetForTests();
  var failure=options({
    processor:{processOperation:function(){
      return Promise.resolve({
        ok:true,status:'failed',
        data:{operation:{attempts:1}},
        error:{code:'NETWORK_ERROR'}
      });
    }}
  });
  await runner.run(failure);
  assert.strictEqual(runner.getState().queueStatus,'backoff');
  assert.ok(runner.getState().nextRetryAt);
  runner.stop();
  assert.strictEqual(runner.getState().nextRetryAt,null);

  runner.resetForTests();
  var permanent=options({
    processor:{processOperation:function(){
      return Promise.resolve({
        ok:true,status:'failed',data:{operation:{attempts:1}},
        error:{code:'SCHEMA_VALIDATION_FAILED'}
      });
    }}
  });
  await runner.run(permanent);
  assert.strictEqual(runner.getState().queueStatus,'error');
  assert.strictEqual(runner.getState().nextRetryAt,null);

  runner.resetForTests();
  var authExpired=options({
    processor:{processOperation:function(){
      return Promise.resolve({
        ok:true,status:'failed',data:{operation:{attempts:1}},
        error:{code:'AUTH_REQUIRED'}
      });
    }}
  });
  await runner.run(authExpired);
  assert.strictEqual(runner.getState().queueStatus,'waiting_for_auth');

  runner.resetForTests();
  var processed=[];
  var fair=options({
    processor:{processOperation:function(operationId){
      processed.push(operationId);
      return Promise.resolve({ok:true,status:'applied',data:{
        operation:{conferenceId:ids.first},revision:2
      }});
    }}
  });
  fair._links[ids.second]={
    localConferenceId:'local-second',
    remoteConferenceId:ids.second,
    linkStatus:'linked',
    knownRevision:1
  };
  fair.linkStore={
    findByRemoteId:function(remoteId){return fair._links[remoteId]||null;},
    save:function(){return {ok:true};}
  };
  fair._operations.push(
    operation('cccccccc-cccc-4ccc-8ccc-cccccccccccc',ids.second),
    operation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ids.first)
  );
  fair.queue={getReadyOperations:function(){
    return Promise.resolve({ok:true,data:{operations:fair._operations.slice()}});
  }};
  fair.limit=2;
  await runner.run(fair);
  assert.deepStrictEqual(processed,[
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ]);

  runner.resetForTests();
  var release;
  var singleCalls=0;
  var single=options({
    processor:{processOperation:function(){
      singleCalls++;
      return new Promise(function(resolve){release=resolve;});
    }}
  });
  var first=runner.run(single);
  var second=runner.run(single);
  assert.strictEqual(first,second);
  await new Promise(function(resolve){setTimeout(resolve,0);});
  release({ok:true,status:'applied',data:{
    operation:{conferenceId:ids.first},revision:2
  }});
  await first;
  assert.strictEqual(singleCalls,1);
  assert.deepStrictEqual(env.scheduled,['manual_retry']);
  runner.stop();

  console.log('automatic-queue-runner tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
