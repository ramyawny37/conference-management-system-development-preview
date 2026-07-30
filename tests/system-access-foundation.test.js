'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var migration=fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260730_5_0_0_system_access_foundation.sql'
),'utf8');

[
  /\bbegin\s*;/i,
  /\bcommit\s*;/i,
  /create table public\.system_user_access/i,
  /account_status in \('pending', 'approved', 'blocked'\)/i,
  /can_create_conferences boolean not null default false/i,
  /create table public\.system_user_roles/i,
  /primary key \(user_id, role\)/i,
  /role in \('system_owner', 'system_admin'\)/i,
  /create table public\.system_access_audit_log/i,
  /alter table public\.system_user_access enable row level security/i,
  /alter table public\.system_user_roles enable row level security/i,
  /alter table public\.system_access_audit_log enable row level security/i,
  /create or replace function public\.is_system_owner/i,
  /create or replace function public\.is_system_admin/i,
  /create or replace function public\.is_account_approved/i,
  /create or replace function public\.can_user_create_conferences/i,
  /set search_path = pg_catalog, public/gi,
  /create or replace function public\.approve_system_user/i,
  /create or replace function public\.block_system_user/i,
  /create or replace function public\.unblock_system_user/i,
  /create or replace function public\.set_user_conference_creation_permission/i,
  /create or replace function public\.grant_system_role/i,
  /create or replace function public\.revoke_system_role/i,
  /LAST_SYSTEM_OWNER_REQUIRED/i,
  /SYSTEM_OWNER_REQUIRED/i,
  /create or replace function public\.create_conference_idempotent/i,
  /ACCOUNT_PENDING/i,
  /ACCOUNT_BLOCKED/i,
  /CONFERENCE_CREATION_NOT_ALLOWED/i,
  /owner_id = auth\.uid\(\)[\s\S]*can_user_create_conferences\(auth\.uid\(\)\)/i
].forEach(function(pattern){
  assert.match(migration,pattern);
});

assert.match(
  migration,
  /insert into public\.system_user_access[\s\S]*select[\s\S]*from public\.conferences[\s\S]*from public\.conference_members[\s\S]*from auth\.users as users[\s\S]*on conflict \(user_id\) do nothing/i
);
assert.match(
  migration,
  /insert into public\.system_user_access[\s\S]*values \(new\.id, 'pending', false\)[\s\S]*on conflict \(user_id\) do nothing/i
);
assert.doesNotMatch(
  migration,
  /grant\s+(insert|update|delete|all)\s+on table public\.system_user_(access|roles)\s+to authenticated/i
);
assert.doesNotMatch(migration, /['"][^'"]+@[^'"]+['"]/);
assert.doesNotMatch(
  migration,
  /alter table public\.conference_members|update public\.conference_members|delete from public\.conference_members/i
);
assert.ok(
  (migration.match(/from auth\.users as users/gi)||[]).length>=2,
  'backfill must close the trigger replacement window'
);

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
        from:function(table){
          if(table==='system_user_access'){
            return query({
              data:error?null:Object.assign({user_id:userId},access),
              error:error||null
            },true);
          }
          return query({
            data:error?null:(roles||[]).map(function(role){
              return {user_id:userId,role:role};
            }),
            error:error||null
          },false);
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
      account_status:'approved',
      can_create_conferences:false
    },['system_owner'])
  });
  var ownerState=await approved.SystemAccessService.load();
  assert.strictEqual(ownerState.status,'approved');
  assert.strictEqual(ownerState.isSystemOwner,true);
  assert.strictEqual(ownerState.canCreateConferences,true);
  assert.strictEqual(ownerState.source,'server');
  assert.strictEqual(ownerState.fresh,true);
  assert.strictEqual(
    approved.SystemAccessService.canCreateConference(),
    true
  );

  var pending=loadService({
    auth:auth(userId),
    clientLayer:clientLayer(userId,{
      account_status:'pending',
      can_create_conferences:false
    },[])
  });
  var pendingState=await pending.SystemAccessService.load();
  assert.strictEqual(pendingState.accountStatus,'pending');
  assert.strictEqual(
    pending.SystemAccessService.canCreateConference(),
    false
  );

  var offline=loadService({
    storage:cache,
    navigator:{onLine:false},
    auth:auth(userId)
  });
  var cachedState=await offline.SystemAccessService.load();
  assert.strictEqual(cachedState.status,'offline');
  assert.strictEqual(cachedState.accountStatus,'approved');
  assert.strictEqual(cachedState.source,'cache');
  assert.strictEqual(cachedState.fresh,false);
  assert.strictEqual(
    offline.SystemAccessService.canCreateConference(),
    false
  );

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
  assert.match(script,/!access\.profileLoaded\|\|!access\.fresh/);
  assert.match(script,/systemAccessAllowsConferenceCreation/);
  assert.match(index,/data-system-conference-create/);
  assert.match(serviceWorker,/js\/supabase\/system-access-service\.js/);

  console.log('system access foundation tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
