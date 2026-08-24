'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const authSource=fs.readFileSync(path.join(root,'js/supabase/auth.js'),'utf8');
const settingsSource=fs.readFileSync(
  path.join(root,'js/sync/sync-settings-ui.js'),'utf8'
);

function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}

function account(id,email){
  return {id,email,user_metadata:{display_name:id}};
}

function createHarness(persistedSession,delayed){
  let session=persistedSession;
  let listener=null;
  let getSessionCalls=0;
  let signInCalls=0;
  let signUpCalls=0;
  const restoration=delayed?deferred():null;
  const replacement={user:account('replacement-account','replacement@example.test')};
  const backendAuth={
    getSession(){
      getSessionCalls++;
      return restoration?restoration.promise:
        Promise.resolve({data:{session}});
    },
    onAuthStateChange(callback){
      listener=callback;
      return {data:{subscription:{unsubscribe(){}}}};
    },
    signInWithPassword(){
      signInCalls++;
      session=replacement;
      if(listener)listener('SIGNED_IN',session);
      return Promise.resolve({data:{session,user:session.user}});
    },
    signUp(){
      signUpCalls++;
      return Promise.resolve({data:{session:null,user:null}});
    },
    signOut(){
      session=null;
      if(listener)listener('SIGNED_OUT',null);
      return Promise.resolve({data:{}});
    }
  };
  const elements={
    sync_auth_email:{value:'replacement@example.test'},
    sync_auth_password:{value:'ReplacementPass1!'},
    sync_signup_display_name:{value:'Replacement Account'},
    sync_signup_email:{value:'replacement@example.test'},
    sync_signup_password:{value:'ReplacementPass1!'},
    sync_signup_password_confirm:{value:'ReplacementPass1!'},
    sync_auth_message:{textContent:'',className:'',style:{}},
    sync_signup_diagnostics:{textContent:'',style:{display:'none'}}
  };
  const document={
    getElementById:id=>elements[id]||null,
    querySelectorAll:()=>[]
  };
  const window={
    document,
    SupabaseClientLayer:{getClient:()=>({auth:backendAuth})},
    SupabaseRuntimeConfig:{configureClient:()=>({available:true})},
    AutomaticSyncOrchestrator:{getState:()=>({started:false})},
    renderSettings(){},
    setTimeout,
    clearTimeout
  };
  window.window=window;
  const context=vm.createContext({window,document,Promise,Date,Object,Array,
    String,JSON,RegExp,Error,setTimeout,clearTimeout,console});
  vm.runInContext(authSource,context,{filename:'auth.js'});
  vm.runInContext(settingsSource,context,{filename:'sync-settings-ui.js'});
  return {
    window,
    restoration,
    restoredSession:persistedSession,
    resolveRestoration(){
      restoration.resolve({data:{session}});
    },
    counts(){return {getSessionCalls,signInCalls,signUpCalls};}
  };
}

async function settle(){
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
}

(async function(){
  const existing={user:account('persisted-account','persisted@example.test')};

  let harness=createHarness(existing,true);
  harness.window.SyncSettingsUI.signIn();
  assert.strictEqual(harness.counts().signInCalls,0);
  harness.resolveRestoration();
  await settle();
  assert.strictEqual(harness.counts().signInCalls,0);
  assert.strictEqual(
    harness.window.SupabaseAuth.getAccountIdentity().userId,'persisted-account'
  );

  harness=createHarness(existing,true);
  harness.window.SyncSettingsUI.signUp();
  assert.strictEqual(harness.counts().signUpCalls,0);
  harness.resolveRestoration();
  await settle();
  assert.strictEqual(harness.counts().signUpCalls,0);
  assert.strictEqual(
    harness.window.SupabaseAuth.getAccountIdentity().userId,'persisted-account'
  );

  harness=createHarness(null,true);
  harness.window.SyncSettingsUI.signIn();
  harness.resolveRestoration();
  await settle();
  assert.strictEqual(harness.counts().signInCalls,1);

  harness=createHarness(null,true);
  harness.window.SyncSettingsUI.signUp();
  harness.resolveRestoration();
  await settle();
  assert.strictEqual(harness.counts().signUpCalls,1);

  harness=createHarness(existing,false);
  await harness.window.SupabaseAuth.initialize();
  harness.window.SyncSettingsUI.signIn();
  await settle();
  harness.window.SyncSettingsUI.signUp();
  await settle();
  assert.strictEqual(harness.counts().signInCalls,0);
  assert.strictEqual(harness.counts().signUpCalls,0);

  await harness.window.SupabaseAuth.signOut();
  harness.window.document.getElementById('sync_auth_password').value=
    'ReplacementPass1!';
  harness.window.SyncSettingsUI.signIn();
  await settle();
  assert.strictEqual(harness.counts().signInCalls,1);

  harness=createHarness(existing,true);
  const initializationOne=harness.window.SupabaseAuth.initialize();
  const initializationTwo=harness.window.SupabaseAuth.initialize();
  assert.strictEqual(initializationOne,initializationTwo);
  harness.window.SyncSettingsUI.signIn();
  harness.resolveRestoration();
  const results=await Promise.all([initializationOne,initializationTwo]);
  await settle();
  assert.strictEqual(harness.counts().getSessionCalls,1);
  assert.strictEqual(results[0].user.id,'persisted-account');
  assert.strictEqual(results[1].user.id,'persisted-account');
  assert.strictEqual(harness.counts().signInCalls,0);

  console.log('auth session restoration race tests: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
