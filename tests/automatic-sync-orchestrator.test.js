'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');

function delay(milliseconds){
  return new Promise(function(resolve){setTimeout(resolve,milliseconds);});
}

function load(options){
  options=options||{};
  var handlers={};
  var networkCalls=0;
  var sandbox={
    Promise:Promise,
    Date:Date,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Math:Math,
    console:console,
    structuredClone:global.structuredClone,
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    navigator:{onLine:options.online!==false},
    localStorage:options.storage||{
      getItem:function(){return null;},
      setItem:function(){},
      removeItem:function(){}
    },
    addEventListener:function(type,handler){handlers[type]=handler;},
    removeEventListener:function(type,handler){
      if(handlers[type]===handler)delete handlers[type];
    }
  };
  sandbox.window=sandbox;
  sandbox.SupabaseAuth={
    getState:function(){
      return {authenticated:options.authenticated===true};
    }
  };
  sandbox.SupabaseClientLayer={
    getState:function(){
      return {
        configured:options.configured===true,
        available:options.available===true
      };
    },
    getClient:function(){
      if(!options.available)return null;
      return {
        from:function(){
          networkCalls++;
          return {
            select:function(){
              return {limit:function(){
                return Promise.resolve({error:null});
              }};
            }
          };
        }
      };
    }
  };
  [
    'js/sync/automatic-sync-preferences.js',
    'js/sync/sync-scheduler-state.js',
    'js/sync/automatic-sync-orchestrator.js'
  ].forEach(function(file){
    vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),
      sandbox,
      {filename:file}
    );
  });
  return {
    window:sandbox,
    handlers:handlers,
    networkCalls:function(){return networkCalls;}
  };
}

async function evaluate(environment,extra){
  var options=Object.assign({
    preferences:{get:function(){
      return {
        cloudSyncEnabled:true,
        automaticLinkingEnabled:true,
        automaticSyncEnabled:true
      };
    }}
  },extra||{});
  environment.window.AutomaticSyncOrchestrator.start(
    Object.assign({debounceMs:0},options)
  );
  await delay(5);
  return environment.window.AutomaticSyncOrchestrator.getState();
}

async function run(){
  var disabled=load({authenticated:true,configured:true,available:true});
  assert.strictEqual(
    disabled.window.AutomaticSyncPreferences.get().cloudSyncEnabled,
    false
  );
  assert.strictEqual(
    disabled.window.SyncSchedulerState.create().connectivity,
    'unknown'
  );
  assert.strictEqual(
    disabled.window.SyncSchedulerState.isConnectivity('online'),
    true
  );
  var preferenceValues={};
  var preferenceCalls=[];
  var preferenceStorage={
    getItem:function(key){return preferenceValues[key]||null;},
    setItem:function(key,value){preferenceValues[key]=value;},
    removeItem:function(key){delete preferenceValues[key];}
  };
  disabled.window.AutomaticSyncOrchestrator={
    start:function(){preferenceCalls.push('start');},
    stop:function(){preferenceCalls.push('stop');},
    schedule:function(reason){preferenceCalls.push(reason);}
  };
  disabled.window.AutomaticSyncPreferences.set({
    cloudSyncEnabled:true,
    automaticSyncEnabled:true
  },{storage:preferenceStorage});
  disabled.window.AutomaticSyncPreferences.set({
    cloudSyncEnabled:false,
    automaticSyncEnabled:true
  },{storage:preferenceStorage});
  assert.deepStrictEqual(preferenceCalls,[
    'start','preferences_changed','stop'
  ]);
  disabled=load({authenticated:true,configured:true,available:true});
  disabled.window.AutomaticSyncOrchestrator.start({debounceMs:0});
  await delay(5);
  assert.strictEqual(
    disabled.window.AutomaticSyncOrchestrator.getState().conferenceState,
    'cloud_disabled'
  );
  assert.strictEqual(
    disabled.window.AutomaticSyncOrchestrator.getState().started,
    false
  );
  assert.strictEqual(Object.keys(disabled.handlers).length,0);
  assert.strictEqual(disabled.networkCalls(),0);

  var cloudEnabled=false;
  var restarted=load({
    authenticated:true,
    configured:true,
    available:true
  });
  var restartOptions={
    debounceMs:100,
    preferences:{get:function(){
      return {cloudSyncEnabled:cloudEnabled};
    }}
  };
  assert.strictEqual(
    restarted.window.AutomaticSyncOrchestrator.start(restartOptions).status,
    'cloud_disabled'
  );
  cloudEnabled=true;
  assert.strictEqual(
    restarted.window.AutomaticSyncOrchestrator.start(restartOptions).status,
    'started'
  );
  assert.strictEqual(
    restarted.window.AutomaticSyncOrchestrator
      .getState().conferenceState,
    'local_only'
  );
  restarted.window.AutomaticSyncOrchestrator.stop();

  var offline=load({online:false,authenticated:true,configured:true,available:true});
  assert.strictEqual((await evaluate(offline)).connectivity,'browser_offline');
  assert.strictEqual(offline.networkCalls(),0);

  var unauthenticated=load({configured:true,available:true});
  assert.strictEqual(
    (await evaluate(unauthenticated)).connectivity,
    'auth_required'
  );

  var unavailable=load({authenticated:true});
  assert.strictEqual(
    (await evaluate(unavailable)).connectivity,
    'service_unreachable'
  );

  var online=load({authenticated:true,configured:true,available:true});
  assert.strictEqual((await evaluate(online)).connectivity,'online');
  assert.strictEqual(online.networkCalls(),1);

  var blockedRuns=0;
  var unlinked=load({authenticated:true,configured:true,available:true});
  await evaluate(unlinked,{
    automaticLinking:{evaluate:function(){
      return Promise.resolve({
        ok:false,status:'create_failed',data:{linked:false}
      });
    }},
    queueRunner:{run:function(){
      blockedRuns++;
      return Promise.resolve({ok:true});
    }}
  });
  assert.strictEqual(blockedRuns,0);

  var linkedRuns=0;
  var newlyLinked=load({authenticated:true,configured:true,available:true});
  await evaluate(newlyLinked,{
    automaticLinking:{evaluate:function(){
      return Promise.resolve({
        ok:true,status:'linked',data:{linked:true}
      });
    }},
    queueRunner:{run:function(){
      linkedRuns++;
      return Promise.resolve({ok:true});
    }}
  });
  assert.strictEqual(linkedRuns,1);
  assert.strictEqual(
    newlyLinked.window.AutomaticSyncOrchestrator
      .getState().conferenceState,
    'linked'
  );
  var missingCurrentTrace=newlyLinked.window.AutomaticSyncOrchestrator
    .getState().preMetadataTrace;
  assert.ok(missingCurrentTrace.some(function(entry){
    return entry.stage==='currentConference'&&
      entry.reason==='no_current_conference';
  }));
  assert.strictEqual(JSON.stringify(missingCurrentTrace).indexOf(
    'conference-a'),-1);

  var currentConference={id:'conference-a'};
  var linkingCalls=[];
  var queueConferences=[];
  var resolveConferenceA;
  var switched=load({authenticated:true,configured:true,available:true});
  switched.window.AutomaticSyncOrchestrator.start({
    debounceMs:0,
    preferences:{get:function(){return {cloudSyncEnabled:true};}},
    getCurrentConference:function(){return currentConference;},
    automaticLinking:{evaluate:function(){
      linkingCalls.push(currentConference.id);
      if(currentConference.id==='conference-a'){
        return new Promise(function(resolve){
          resolveConferenceA=resolve;
        });
      }
      return Promise.resolve({
        ok:true,status:'linked',
        data:{linked:true,localConferenceId:'conference-b'}
      });
    }},
    queueRunner:{run:function(){
      queueConferences.push(currentConference.id);
      return Promise.resolve({ok:true});
    }}
  });
  await delay(5);
  currentConference={id:'conference-b'};
  switched.window.AutomaticSyncOrchestrator.schedule(
    'conference_changed',{debounceMs:0}
  );
  resolveConferenceA({
    ok:true,status:'linked',
    data:{linked:true,localConferenceId:'conference-a'}
  });
  await delay(20);
  assert.deepStrictEqual(linkingCalls,['conference-a','conference-b']);
  assert.deepStrictEqual(queueConferences,['conference-b']);

  var flapping=load({authenticated:true,configured:true,available:true});
  flapping.window.AutomaticSyncOrchestrator.start({
    debounceMs:20,
    preferences:{get:function(){return {cloudSyncEnabled:true};}}
  });
  flapping.handlers.online();
  flapping.handlers.offline();
  flapping.handlers.online();
  await delay(35);
  assert.strictEqual(flapping.networkCalls(),1);

  var checks=0;
  var resolveCheck;
  var single=load({authenticated:true,configured:true,available:true});
  single.window.AutomaticSyncOrchestrator.start({
    debounceMs:100,
    preferences:{get:function(){return {cloudSyncEnabled:true};}}
  });
  var checkOptions={
    preferences:{get:function(){return {cloudSyncEnabled:true};}},
    serviceCheck:function(){
      checks++;
      return new Promise(function(resolve){resolveCheck=resolve;});
    }
  };
  var first=single.window.AutomaticSyncOrchestrator
    .evaluateConnectivity(checkOptions);
  var second=single.window.AutomaticSyncOrchestrator
    .evaluateConnectivity(checkOptions);
  assert.strictEqual(first,second);
  assert.strictEqual(checks,0);
  await delay(0);
  assert.strictEqual(checks,1);
  single.window.AutomaticSyncOrchestrator.stop();
  resolveCheck({available:true});
  await first;
  assert.strictEqual(
    single.window.AutomaticSyncOrchestrator.getState().connectivity,
    'stopped'
  );
  assert.strictEqual(Object.keys(single.handlers).length,0);
  single.window.AutomaticSyncOrchestrator.start({
    debounceMs:100,
    preferences:{get:function(){return {cloudSyncEnabled:true};}}
  });
  assert.strictEqual(Object.keys(single.handlers).length,2);
  assert.strictEqual(
    single.window.AutomaticSyncOrchestrator.start().status,
    'already_started'
  );
  single.window.AutomaticSyncOrchestrator.stop();

  var followUp=load({
    authenticated:true,configured:true,available:true
  });
  var firstConnectivityResolve;
  var connectivityChecks=0;
  var concurrentChecks=0;
  var maximumConcurrentChecks=0;
  var followUpRunnerCalls=0;
  var runnerReasons=[];
  var followUpRemoteId='11111111-1111-4111-8111-111111111111';
  var followUpLink={
    localConferenceId:'local-follow-up',
    remoteConferenceId:followUpRemoteId,
    knownRevision:1,
    linkStatus:'linked'
  };
  var followUpOptions={
    debounceMs:0,
    preferences:{get:function(){return {
      cloudSyncEnabled:true,automaticSyncEnabled:true
    };}},
    getCurrentConference:function(){return {id:'local-follow-up'};},
    serviceCheck:function(){
      connectivityChecks++;
      concurrentChecks++;
      maximumConcurrentChecks=Math.max(
        maximumConcurrentChecks,concurrentChecks
      );
      if(connectivityChecks===1){
        return new Promise(function(resolve){
          firstConnectivityResolve=function(value){
            concurrentChecks--;
            resolve(value);
          };
        });
      }
      concurrentChecks--;
      return Promise.resolve({available:true});
    },
    stateResolver:{resolve:function(){return Promise.resolve({
      ok:true,status:'linked',data:{
        link:followUpLink,remoteConferenceId:followUpRemoteId
      }
    });}},
    integration:{getConferenceSyncState:function(){return {context:{
      localConferenceId:'local-follow-up',
      conferenceId:followUpRemoteId,
      baseRevision:1
    }};}},
    queueRunner:{run:function(options){
      followUpRunnerCalls++;
      runnerReasons.push(Array.from(options.reasons));
      return Promise.resolve({ok:true,status:'empty'});
    }}
  };
  followUp.window.AutomaticSyncOrchestrator.start(followUpOptions);
  assert.strictEqual(
    followUp.window.AutomaticSyncOrchestrator.getState().debouncePending,
    true
  );
  await delay(5);
  assert.strictEqual(connectivityChecks,1);
  assert.strictEqual(
    followUp.window.AutomaticSyncOrchestrator.getState()
      .evaluationInProgress,
    true
  );
  assert.deepStrictEqual(Array.from(
    followUp.window.AutomaticSyncOrchestrator.getState()
      .lastEvaluationReasons
  ),['startup']);
  followUp.window.AutomaticSyncOrchestrator.schedule(
    'local_save',followUpOptions
  );
  assert.strictEqual(
    followUp.window.AutomaticSyncOrchestrator.getState()
      .lastScheduledReason,
    'local_save'
  );
  assert.strictEqual(
    followUp.window.AutomaticSyncOrchestrator.getState().debouncePending,
    true
  );
  followUp.window.AutomaticSyncOrchestrator.schedule(
    'auth_changed',followUpOptions
  );
  await delay(5);
  assert.strictEqual(connectivityChecks,1);
  assert.strictEqual(followUpRunnerCalls,0);
  assert.strictEqual(
    followUp.window.AutomaticSyncOrchestrator.getState().followUpPending,
    true
  );
  assert.strictEqual(
    followUp.window.AutomaticSyncOrchestrator.getState()
      .lastRunnerInvocationAt,
    null
  );
  firstConnectivityResolve({available:false});
  await delay(15);
  assert.strictEqual(connectivityChecks,2);
  assert.strictEqual(maximumConcurrentChecks,1);
  assert.strictEqual(followUpRunnerCalls,1);
  assert.deepStrictEqual(runnerReasons,[['local_save','auth_changed']]);
  var followUpState=followUp.window.AutomaticSyncOrchestrator.getState();
  assert.strictEqual(followUpState.evaluationInProgress,false);
  assert.strictEqual(followUpState.followUpPending,false);
  assert.strictEqual(followUpState.scheduledReasonCount,0);
  assert.deepStrictEqual(Array.from(followUpState.lastEvaluationReasons),[
    'local_save','auth_changed'
  ]);
  assert.strictEqual(followUpState.lastResolverStatus,'linked');
  assert.ok(followUpState.lastEvaluationStartedAt);
  assert.ok(followUpState.lastEvaluationFinishedAt);
  assert.ok(followUpState.lastRunLinkedConferenceAt);
  assert.ok(followUpState.lastRunnerInvocationAt);
  assert.strictEqual(followUpState.lastRunnerResultStatus,'empty');
  assert.strictEqual(followUpState.lastRunnerWaitingReason,null);
  assert.ok(followUpState.preMetadataTrace.some(function(entry){
    return entry.stage==='refreshService'&&
      entry.reason==='service_not_registered';
  }));
  assert.strictEqual(followUpState.lastPreMetadataExitReason,
    'service_not_registered');
  followUp.window.AutomaticSyncOrchestrator.stop();
  assert.strictEqual(
    followUp.window.AutomaticSyncOrchestrator.getState().lastStopReason,
    'stopped'
  );

  var stoppedFollowUp=load({
    authenticated:true,configured:true,available:true
  });
  var stoppedResolve;
  var stoppedChecks=0;
  var stoppedRunnerCalls=0;
  var stoppedOptions=Object.assign({},followUpOptions,{
    serviceCheck:function(){
      stoppedChecks++;
      return new Promise(function(resolve){stoppedResolve=resolve;});
    },
    queueRunner:{run:function(){
      stoppedRunnerCalls++;
      return Promise.resolve({ok:true});
    }}
  });
  stoppedFollowUp.window.AutomaticSyncOrchestrator.start(stoppedOptions);
  await delay(5);
  stoppedFollowUp.window.AutomaticSyncOrchestrator.schedule(
    'local_save',stoppedOptions
  );
  await delay(5);
  stoppedFollowUp.window.AutomaticSyncOrchestrator.stop();
  stoppedResolve({available:true});
  await delay(10);
  assert.strictEqual(stoppedChecks,1);
  assert.strictEqual(stoppedRunnerCalls,0);
  assert.strictEqual(
    stoppedFollowUp.window.AutomaticSyncOrchestrator.getState().started,
    false
  );

  var wakeEnvironment=load({
    authenticated:true,configured:true,available:true
  });
  var wakeRunnerCalls=0;
  var wakeOptions=Object.assign({},followUpOptions,{
    debounceMs:0,
    preferences:{get:function(){return {
      cloudSyncEnabled:true,
      automaticLinkingEnabled:true,
      automaticSyncEnabled:true
    };}},
    serviceCheck:function(){return Promise.resolve({available:true});},
    queueRunner:{run:function(options){
      wakeRunnerCalls++;
      assert.ok(options.reasons.indexOf('local_save')>=0);
      return Promise.resolve({ok:true,status:'empty'});
    }}
  });
  var wakeResult=wakeEnvironment.window.AutomaticSyncOrchestrator
    .wakeForLocalSave(wakeOptions);
  assert.strictEqual(wakeResult.ok,true);
  assert.strictEqual(wakeResult.status,'wake_accepted');
  assert.strictEqual(wakeResult.data.started,true);
  assert.strictEqual(
    wakeEnvironment.window.AutomaticSyncOrchestrator.getState().started,
    true
  );
  assert.strictEqual(
    wakeEnvironment.window.AutomaticSyncOrchestrator.getState()
      .lastScheduledReason,
    'local_save'
  );
  var repeatedWake=wakeEnvironment.window.AutomaticSyncOrchestrator
    .wakeForLocalSave();
  assert.strictEqual(repeatedWake.ok,true);
  assert.strictEqual(repeatedWake.data.started,null);
  await delay(15);
  assert.strictEqual(wakeRunnerCalls,1);
  wakeEnvironment.window.AutomaticSyncOrchestrator.stop();

  var disabledWake=load({authenticated:true,configured:true,available:true});
  var disabledResult=disabledWake.window.AutomaticSyncOrchestrator
    .wakeForLocalSave({preferences:{get:function(){return {
      cloudSyncEnabled:false,
      automaticSyncEnabled:true
    };}}});
  assert.strictEqual(disabledResult.ok,false);
  assert.strictEqual(disabledResult.status,'cloud_disabled');
  assert.strictEqual(
    disabledWake.window.AutomaticSyncOrchestrator.getState().started,
    false
  );

  console.log('automatic-sync-orchestrator tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
