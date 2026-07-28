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

  console.log('automatic-sync-orchestrator tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
