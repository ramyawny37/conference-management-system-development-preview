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
const gateSource=fs.readFileSync(
  path.join(root,'js/sync/startup-access-gate.js'),'utf8'
);
const scriptSource=fs.readFileSync(path.join(root,'script.js'),'utf8');
const updateStart=scriptSource.indexOf('function updateLogoText()');
const updateEnd=scriptSource.indexOf('\nfunction accommodationIcon',updateStart);

function user(id,name,email){
  return {id,email,user_metadata:{display_name:name}};
}

(async function(){
  const firstUser=user(
    '11111111-1111-4111-8111-111111111111',
    'Authenticated Account',
    'first@example.test'
  );
  const secondUser=user(
    '22222222-2222-4222-8222-222222222222',
    'Second Account',
    'second@example.test'
  );
  let persistedSession={user:firstUser};
  let listener=null;
  let signInCalls=0;
  let signUpCalls=0;
  let settingsRenderCalls=0;
  const backendAuth={
    getSession(){return Promise.resolve({data:{session:persistedSession}});},
    onAuthStateChange(callback){listener=callback;return {
      data:{subscription:{unsubscribe(){}}}
    };},
    signInWithPassword(){
      signInCalls++;
      persistedSession={user:secondUser};
      if(listener)listener('SIGNED_IN',persistedSession);
      return Promise.resolve({data:{session:persistedSession,user:secondUser}});
    },
    signUp(){signUpCalls++;return Promise.resolve({data:{session:null}});},
    signOut(){
      persistedSession=null;
      if(listener)listener('SIGNED_OUT',null);
      return Promise.resolve({data:{}});
    }
  };
  const label={textContent:''};
  const signedOut={style:{display:''}};
  const signedIn={style:{display:'none'}};
  const startupName={textContent:''};
  const startupActions={querySelector(selector){
    if(selector==='[data-startup-auth-signed-out]')return signedOut;
    if(selector==='[data-startup-auth-signed-in]')return signedIn;
    if(selector==='[data-startup-auth-account-name]')return startupName;
    return null;
  }};
  const logo={querySelector:selector=>
    selector==='.application-account-label'?label:null};
  const elements={
    'logo-text':logo,
    startupAuthActions:startupActions,
    sync_auth_email:{value:'second@example.test'},
    sync_auth_password:{value:'SecondPass1!'},
    sync_signup_display_name:{value:'Blocked Signup'},
    sync_signup_email:{value:'blocked@example.test'},
    sync_signup_password:{value:'BlockedPass1!'},
    sync_signup_password_confirm:{value:'BlockedPass1!'},
    sync_auth_message:{textContent:'',className:'',style:{}},
    sync_signup_diagnostics:{textContent:'',style:{display:'none'}},
    sync_account_panel:{}
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
    getCurrentConference:()=>({
      accountOwner:{name:'Conference Person'},
      peopleDb:{people:[{fullName:'Conference Person'}]}
    }),
    renderGlobalConferenceHeader(){},
    renderSettings(){settingsRenderCalls++;},
    setTimeout,
    clearTimeout,
    structuredClone:value=>JSON.parse(JSON.stringify(value))
  };
  window.window=window;
  window.ge=id=>elements[id]||null;
  const context=vm.createContext({window,document,Promise,Date,Object,Array,
    String,JSON,RegExp,Error,setTimeout,clearTimeout,console});
  context.ge=window.ge;
  context.renderGlobalConferenceHeader=window.renderGlobalConferenceHeader;

  vm.runInContext(authSource,context,{filename:'auth.js'});
  await window.SupabaseAuth.initialize();
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(window.SupabaseAuth.getAccountIdentity())),
    {authenticated:true,userId:firstUser.id,
      displayName:'Authenticated Account',email:'first@example.test',
      label:'Authenticated Account'}
  );

  vm.runInContext(
    scriptSource.slice(updateStart,updateEnd),context,
    {filename:'script-account-label.js'}
  );
  window.updateLogoText=context.updateLogoText;
  window.updateLogoText();
  assert.strictEqual(label.textContent,'Authenticated Account');
  assert.notStrictEqual(label.textContent,'Conference Person');
  assert.strictEqual(signedOut.style.display,'none');
  assert.strictEqual(signedIn.style.display,'');
  assert.strictEqual(startupName.textContent,'Authenticated Account');

  vm.runInContext(gateSource,context,{filename:'startup-access-gate.js'});
  assert.strictEqual(
    window.StartupAccessGate.showAuthView('login').status,'authenticated'
  );
  assert.strictEqual(
    window.StartupAccessGate.showAuthView('signup').status,'authenticated'
  );

  vm.runInContext(settingsSource,context,{filename:'sync-settings-ui.js'});
  listener('TOKEN_REFRESHED',{user:user(
    firstUser.id,'Refreshed Account','refreshed@example.test'
  )});
  assert.strictEqual(settingsRenderCalls,1,
    'external auth-state changes must refresh an open account panel');
  assert.strictEqual(label.textContent,'Refreshed Account');

  listener('USER_UPDATED',{user:{id:firstUser.id,
    email:'email-fallback@example.test',user_metadata:{}}});
  assert.strictEqual(
    window.SupabaseAuth.getAccountIdentity().label,
    'email-fallback@example.test'
  );
  assert.strictEqual(label.textContent,'email-fallback@example.test');
  assert.strictEqual(startupName.textContent,'email-fallback@example.test');

  listener('USER_UPDATED',{user:{id:firstUser.id,user_metadata:{}}});
  assert.strictEqual(
    window.SupabaseAuth.getAccountIdentity().label,'صاحب الحساب'
  );
  assert.strictEqual(label.textContent,'صاحب الحساب');
  assert.strictEqual(startupName.textContent,'صاحب الحساب');
  assert.notStrictEqual(label.textContent,'Conference Person');
  assert(settingsSource.includes('var accountName=identity.label;'));
  assert(gateSource.includes('escapeHtml(identity.label)'));

  listener('USER_UPDATED',{user:firstUser});
  window.SyncSettingsUI.signIn();
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
  window.SyncSettingsUI.signUp();
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.strictEqual(signInCalls,0,'active session must block sign-in');
  assert.strictEqual(signUpCalls,0,'active session must block signup');

  window.SyncSettingsUI.signOut();
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.strictEqual(
    window.SupabaseAuth.getAccountIdentity().authenticated,false
  );

  elements.sync_auth_password.value='SecondPass1!';
  window.SyncSettingsUI.signIn();
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.strictEqual(signInCalls,1,'explicit logout must allow account switch');
  assert.strictEqual(
    window.SupabaseAuth.getAccountIdentity().userId,secondUser.id
  );
  assert.strictEqual(label.textContent,'Second Account');
  assert.strictEqual(signedOut.style.display,'none');
  assert.strictEqual(signedIn.style.display,'');

  console.log('authenticated account identity tests: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
