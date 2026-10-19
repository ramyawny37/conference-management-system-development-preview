'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var authority=fs.readFileSync(path.join(
  root,
  'supabase/migrations/20261010202000_platform_account_authority_cutover.sql'
),'utf8');
var startup=fs.readFileSync(path.join(
  root,
  'supabase/migrations/20261010202200_startup_platform_system_access.sql'
),'utf8');
var retirement=fs.readFileSync(path.join(
  root,
  'supabase/migrations/20261010202600_system_access_device_authority_cutover.sql'
),'utf8');

assert.match(authority,/from platform\.profiles/i);
assert.match(authority,/from platform\.user_roles/i);
assert.doesNotMatch(authority,/from public\.system_user_(?:access|roles)/i);
assert.match(startup,/get_my_platform_system_access/i);
assert.match(startup,/platform\.profiles/i);
assert.match(startup,/platform\.user_roles/i);
assert.doesNotMatch(startup,/system_user_(?:access|roles)/i);
assert.match(retirement,/drop table public\.system_user_access/i);
assert.match(retirement,/drop table public\.system_user_roles/i);

function storage(){
  var values={};
  return {
    getItem:function(key){return values[key]||null;},
    setItem:function(key,value){values[key]=value;},
    removeItem:function(key){delete values[key];}
  };
}

function query(response,isSingle){
  var builder={
    select:function(){return builder;},
    eq:function(){return builder;},
    maybeSingle:function(){return Promise.resolve(response);},
    then:function(resolve,reject){
      return Promise.resolve(response).then(resolve,reject);
    }
  };
  if(!isSingle)delete builder.maybeSingle;
  return builder;
}

function loadService(options){
  options=options||{};
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Array:Array,
    Date:Date,
    Error:Error,
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    structuredClone:structuredClone,
    localStorage:options.storage||storage(),
    navigator:options.navigator||{onLine:true},
    document:options.document,
    SupabaseAuth:options.auth,
    SupabaseClientLayer:options.clientLayer
  };
  sandbox.window=sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(
      root,'js/supabase/system-access-service.js'
    ),'utf8'),
    sandbox,
    {filename:'system-access-service.js'}
  );
  return sandbox;
}

function auth(userId){
  var user=userId?{id:userId}:null;
  return {
    getState:function(){
      return {authenticated:!!user,user:user};
    },
    getSession:function(){
      return user?{user:user}:null;
    }
  };
}

function clientLayer(userId,access,roles,error){
  return {
    getClient:function(){
      return {
        rpc:function(name){
          assert.strictEqual(name,'get_my_platform_system_access');
          return Promise.resolve({
            data:error?null:{
              userId:userId,
              accountStatus:access&&access.account_status,
              systemRoles:roles||[]
            },
            error:error||null
          });
        }
      };
    }
  };
}

async function run(){
  var userId='11111111-1111-4111-8111-111111111111';

  var unauthenticated=loadService({auth:auth(null)});
  var noSession=await unauthenticated.SystemAccessService.load();
  assert.strictEqual(noSession.status,'not_authenticated');
  assert.strictEqual(noSession.authenticated,false);

  var cache=storage();
  var approved=loadService({
    storage:cache,
    auth:auth(userId),
    clientLayer:clientLayer(userId,{
      account_status:'approved'
    },['system_owner'])
  });
  var ownerState=await approved.SystemAccessService.load();
  assert.strictEqual(ownerState.status,'approved');
  assert.strictEqual(ownerState.accountStatus,'approved');
  assert.strictEqual(ownerState.isSystemOwner,true);
  assert.strictEqual(ownerState.source,'server');
  assert.strictEqual(ownerState.fresh,true);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(ownerState,'canCreateConferences'),
    false
  );
  assert.strictEqual(
    typeof approved.SystemAccessService.canCreateConference,
    'undefined'
  );

  var pending=loadService({
    auth:auth(userId),
    clientLayer:clientLayer(userId,{
      account_status:'pending'
    },[])
  });
  var pendingState=await pending.SystemAccessService.load();
  assert.strictEqual(pendingState.accountStatus,'pending');

  var createControl={
    style:{},disabled:false,attributes:{},
    setAttribute:function(name,value){this.attributes[name]=value;},
    removeAttribute:function(name){delete this.attributes[name];}
  };
  var memberUi=loadService({
    auth:auth(userId),
    clientLayer:clientLayer(userId,{
      account_status:'approved'
    },[]),
    document:{
      querySelectorAll:function(){return [createControl];},
      querySelector:function(){return null;},
      getElementById:function(){return null;}
    }
  });
  await memberUi.SystemAccessService.load();
  assert.strictEqual(createControl.disabled,false);

  var offline=loadService({
    storage:cache,
    navigator:{onLine:false},
    auth:auth(userId)
  });
  var cachedState=await offline.SystemAccessService.load();
  assert.strictEqual(cachedState.status,'offline');
  assert.strictEqual(cachedState.profileLoaded,false);
  assert.strictEqual(cachedState.fresh,false);
  assert.strictEqual(cachedState.isSystemOwner,false);
  assert.strictEqual(cachedState.accountStatus,null);

  var failed=loadService({
    auth:auth(userId),
    clientLayer:clientLayer(userId,null,null,{
      code:'FETCH_FAILED',
      message:'network request failed'
    })
  });
  var failedState=await failed.SystemAccessService.load();
  assert.strictEqual(failedState.status,'offline');
  assert.strictEqual(failedState.profileLoaded,false);
  assert.notStrictEqual(failedState.accountStatus,'pending');

  var index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  var script=fs.readFileSync(path.join(root,'script.js'),'utf8');
  var serviceWorker=fs.readFileSync(
    path.join(root,'service-worker.js'),'utf8'
  );
  assert.ok(
    index.indexOf('js/supabase/auth.js')<
    index.indexOf('js/supabase/system-access-service.js')
  );
  assert.ok(
    index.indexOf('js/supabase/system-access-service.js')<
    index.indexOf('js/supabase/device-identity.js')
  );
  assert.doesNotMatch(script,/systemAccessAllowsConferenceCreation/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(
      root,'js/supabase/system-access-service.js'
    ),'utf8'),
    /can_create_conferences|canCreateConferences|canCreateConference/
  );
  assert.match(serviceWorker,/js\/supabase\/system-access-service\.js/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'js/supabase/system-access-service.js'),'utf8'),/client\.from\('system_user_(access|roles)'\)/);

  console.log('system access foundation tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
