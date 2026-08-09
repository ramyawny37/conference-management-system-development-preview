'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const authSource=fs.readFileSync(path.join(root,'js/supabase/auth.js'),'utf8');
const uiSource=fs.readFileSync(
  path.join(root,'js/sync/sync-settings-ui.js'),'utf8'
);

function authEnvironment(handler){
  const auth={signUp:handler};
  const window={
    location:{origin:'https://development.example.test'},
    SupabaseClientLayer:{getClient:()=>({auth})},
    SupabaseRuntimeConfig:{load:()=>({emailRedirectTo:''})}
  };
  vm.runInNewContext(authSource,{window,Promise,Date,Object,String});
  return window.SupabaseAuth;
}

function uiEnvironment(result){
  const elements={
    sync_signup_display_name:{value:'Test User'},
    sync_signup_email:{value:'USER@EXAMPLE.TEST'},
    sync_signup_password:{value:'StrongPass1!'},
    sync_signup_password_confirm:{value:'StrongPass1!'},
    sync_auth_message:{textContent:'',className:''},
    sync_signup_diagnostics:{textContent:'',style:{display:'none'}}
  };
  const window={
    document:{
      getElementById:id=>elements[id]||null,
      querySelectorAll:()=>[]
    },
    SupabaseRuntimeConfig:{configureClient:()=>({available:true})},
    SupabaseAuth:{
      initialize:()=>Promise.resolve(),
      signUp:()=>Promise.resolve(result)
    },
    renderSettings:()=>{}
  };
  vm.runInNewContext(uiSource,{window,Promise,JSON,String,Array,Object});
  return {ui:window.SyncSettingsUI,elements};
}

async function settle(){
  await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));
}

async function run(){
  const email='private.person@example.test';
  const password='NeverExpose-Password-42';
  const accessToken='eyJhbGciOiJIUzI1NiJ9.private.signature';
  const refreshToken='refresh-token-private-value';
  const publishableKey='sb_publishable_privatevalue';
  const auth=authEnvironment(()=>Promise.resolve({
    data:{user:null,session:null},
    error:{
      code:'over_email_send_rate_limit',
      status:429,
      message:'Email '+email+' password='+password+' access_token='+
        accessToken+' refresh_token='+refreshToken+' apikey='+publishableKey
    }
  }));
  const failed=await auth.signUp(email,password,{display_name:'Private Name'});
  assert.strictEqual(failed.success,false);
  assert.strictEqual(failed.diagnostics.stage,'AUTH_SIGNUP');
  assert.strictEqual(failed.diagnostics.authStage,'AUTH_SIGNUP_FAILED');
  assert.strictEqual(failed.diagnostics.errorCode,'over_email_send_rate_limit');
  assert.strictEqual(failed.diagnostics.httpStatus,'429');
  assert.strictEqual(failed.diagnostics.userPresent,false);
  assert.strictEqual(failed.diagnostics.sessionPresent,false);
  const safeTrace=JSON.stringify(failed.diagnostics);
  [email,password,accessToken,refreshToken,publishableKey,'Private Name']
    .forEach(secret=>assert(!safeTrace.includes(secret),'diagnostic leaked '+secret));
  assert(safeTrace.includes('[REDACTED_EMAIL]'));

  const successWithoutSession=await authEnvironment(()=>Promise.resolve({
    data:{user:{id:'user-id'},session:null},error:null
  })).signUp(email,password,{});
  assert.strictEqual(successWithoutSession.diagnostics.authStage,
    'AUTH_SIGNUP_SUCCEEDED');
  assert.strictEqual(successWithoutSession.diagnostics.userPresent,true);
  assert.strictEqual(successWithoutSession.diagnostics.sessionPresent,false);

  const successAuth=authEnvironment(()=>Promise.resolve({
    data:{user:{id:'user-id'},session:{user:{id:'user-id'}}},error:null
  }));
  const successWithSession=await successAuth.signUp(email,password,{});
  assert.strictEqual(successWithSession.diagnostics.userPresent,true);
  assert.strictEqual(successWithSession.diagnostics.sessionPresent,true);
  const startupFailure=successAuth.markSignUpStartupAccessFailed({
    code:'SYSTEM_ACCESS_LOAD_FAILED',message:'failed for '+email
  });
  assert.strictEqual(startupFailure.authStage,
    'AUTH_SIGNUP_SUCCEEDED_BUT_STARTUP_ACCESS_FAILED');
  assert(!JSON.stringify(startupFailure).includes(email));

  const exception=await authEnvironment(()=>Promise.reject(
    new Error('Network failed for '+email+' token='+accessToken)
  )).signUp(email,password,{});
  assert.strictEqual(exception.diagnostics.authStage,'AUTH_SIGNUP_FAILED');
  assert.strictEqual(exception.diagnostics.errorCode,'AUTH_SIGNUP_EXCEPTION');
  assert(!JSON.stringify(exception.diagnostics).includes(email));
  assert(!JSON.stringify(exception.diagnostics).includes(accessToken));

  const known=uiEnvironment({
    success:false,
    error:{code:'weak_password'},
    diagnostics:{authStage:'AUTH_SIGNUP_FAILED'}
  });
  known.ui.signUp();
  await settle();
  assert.strictEqual(known.elements.sync_auth_message.textContent,
    'كلمة المرور غير قوية بما يكفي.');

  const unknown=uiEnvironment({
    success:false,
    error:{code:'over_email_send_rate_limit',message:'raw '+email},
    diagnostics:failed.diagnostics
  });
  unknown.ui.signUp();
  await settle();
  assert.strictEqual(unknown.elements.sync_auth_message.textContent,
    'تعذر إنشاء الحساب. رمز الخطأ: over_email_send_rate_limit');
  assert(unknown.elements.sync_signup_diagnostics.textContent.includes(
    '"httpStatus": "429"'
  ));
  assert(!unknown.elements.sync_signup_diagnostics.textContent.includes(email));
  assert(!unknown.elements.sync_auth_message.textContent.includes('raw'));

  const noCode=uiEnvironment({
    success:false,error:{},diagnostics:{
      authStage:'AUTH_SIGNUP_FAILED',success:false,errorCode:null,
      httpStatus:null,sanitizedMessage:'',userPresent:false,
      sessionPresent:false,timestamp:new Date().toISOString()
    }
  });
  noCode.ui.signUp();
  await settle();
  assert.strictEqual(noCode.elements.sync_auth_message.textContent,
    'تعذر إنشاء الحساب. يرجى مراجعة تشخيص التسجيل.');

  console.log('signup auth diagnostics tests: passed');
}

run().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
