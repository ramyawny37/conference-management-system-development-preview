'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');

function loadFreshBrowser(storedConfig){
  var writes=[];
  var createCalls=[];
  var authClient={
    getSession:function(){
      return Promise.resolve({data:{session:null},error:null});
    },
    onAuthStateChange:function(){
      return {data:{subscription:{unsubscribe:function(){}}}};
    },
    signInWithPassword:function(input){
      return Promise.resolve({
        data:{session:{user:{id:'user-1',email:input.email}}},
        error:null
      });
    },
    stopAutoRefresh:function(){}
  };
  var sandbox={
    window:null,
    URL:URL,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Error:Error,
    atob:function(value){
      return Buffer.from(value,'base64').toString('utf8');
    },
    localStorage:{
      getItem:function(){
        return storedConfig?JSON.stringify(storedConfig):null;
      },
      setItem:function(key,value){writes.push({key:key,value:value});},
      removeItem:function(){}
    },
    supabase:{
      createClient:function(url,key,options){
        createCalls.push({url:url,key:key,options:options});
        return {
          auth:authClient,
          removeAllChannels:function(){}
        };
      }
    }
  };
  sandbox.window=sandbox;
  [
    'js/supabase/public-config.js',
    'js/supabase/runtime-config.js',
    'js/supabase/client.js',
    'js/supabase/auth.js'
  ].forEach(function(file){
    vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),
      sandbox,
      {filename:file}
    );
  });
  return {
    window:sandbox,
    writes:writes,
    createCalls:createCalls
  };
}

async function run(){
  var fresh=loadFreshBrowser();
  var authSchedules=[];
  fresh.window.AutomaticSyncOrchestrator={
    getState:function(){return {started:true};},
    schedule:function(reason){authSchedules.push(reason);}
  };
  assert.strictEqual(fresh.createCalls.length,1);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(fresh.window.SupabaseClientLayer.getState())),
    {configured:true,available:true,lastError:null}
  );
  assert.strictEqual(
    fresh.window.SupabaseRuntimeConfig.getPublicState().configured,
    true
  );
  assert.strictEqual(
    fresh.window.SupabaseRuntimeConfig.load().url,
    'https://gppwltrifgfxrkzvvxoe.supabase.co'
  );
  assert.strictEqual(fresh.writes.length,0);

  var stale=loadFreshBrowser({
    url:'https://different.supabase.co',
    publishableKey:'sb_publishable_old_browser_value'
  });
  assert.strictEqual(
    stale.createCalls[0].url,
    'https://gppwltrifgfxrkzvvxoe.supabase.co'
  );

  var initialized=await fresh.window.SupabaseAuth.initialize();
  assert.strictEqual(initialized.available,true);
  assert.strictEqual(initialized.authenticated,false);

  var signedIn=await fresh.window.SupabaseAuth.signInWithPassword(
    'user@example.com',
    'password'
  );
  assert.strictEqual(signedIn.success,true);
  assert.strictEqual(
    fresh.window.SupabaseAuth.getState().authenticated,
    true
  );
  assert.deepStrictEqual(authSchedules,['auth_changed']);
  console.log('supabase fresh browser bootstrap tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
