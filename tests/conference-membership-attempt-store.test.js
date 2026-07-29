'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/conference-membership-attempt-store.js'
),'utf8');
var ids={
  actor:'11111111-1111-4111-8111-111111111111',
  conference:'22222222-2222-4222-8222-222222222222',
  target:'33333333-3333-4333-8333-333333333333',
  operation:'44444444-4444-4444-8444-444444444444',
  other:'55555555-5555-4555-8555-555555555555'
};

function load(){
  var records={};
  var repository={
    get:function(key){return records[key]||null;},
    put:function(key,value){
      records[key]=JSON.parse(JSON.stringify(value));
    },
    delete:function(key){delete records[key];}
  };
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Date:Date,
    Array:Array,
    structuredClone:global.structuredClone
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{
    filename:'conference-membership-attempt-store.js'
  });
  return {
    store:sandbox.ConferenceMembershipAttemptStore,
    options:{repository:repository},
    records:records
  };
}

function fakeIndexedDb(){
  var records={};
  var createdStores=[];
  function asyncRequest(action){
    var request={result:null,error:null};
    setTimeout(function(){
      try{
        request.result=action();
        if(request.onsuccess)request.onsuccess();
      }catch(error){
        request.error=error;
        if(request.onerror)request.onerror();
      }
    },0);
    return request;
  }
  var objectStore={
    get:function(key){
      return asyncRequest(function(){return records[key]||null;});
    },
    put:function(value){
      return asyncRequest(function(){
        records[value.attemptKey]=JSON.parse(JSON.stringify(value));
        return value.attemptKey;
      });
    },
    delete:function(key){
      return asyncRequest(function(){delete records[key];});
    }
  };
  var db={
    objectStoreNames:{
      contains:function(name){
        return createdStores.indexOf(name)>=0;
      }
    },
    createObjectStore:function(name){
      createdStores.push(name);
      return objectStore;
    },
    transaction:function(){
      return {objectStore:function(){return objectStore;}};
    },
    close:function(){}
  };
  return {
    createdStores:createdStores,
    factory:{open:function(name,version){
      var request={result:db,error:null};
      setTimeout(function(){
        if(request.onupgradeneeded){
          request.onupgradeneeded({target:{result:db}});
        }
        if(request.onsuccess)request.onsuccess();
      },0);
      assert.strictEqual(name,'conference_manager_membership_attempts');
      assert.strictEqual(version,1);
      return request;
    }}
  };
}

function input(overrides){
  return Object.assign({
    version:1,
    actorUserId:ids.actor,
    remoteConferenceId:ids.conference,
    targetUserId:ids.target,
    action:'add_manager',
    operationId:ids.operation
  },overrides||{});
}

async function run(){
  var env=load();
  assert.strictEqual(
    env.store.databaseName,
    'conference_manager_membership_attempts'
  );
  assert.strictEqual(env.store.databaseVersion,1);
  assert.strictEqual(env.store.storeName,'membership_attempts_v1');

  var indexed=load();
  var fake=fakeIndexedDb();
  var indexedSaved=await indexed.store.save(input(),{
    indexedDB:fake.factory
  });
  assert.strictEqual(indexedSaved.status,'saved');
  assert.deepStrictEqual(fake.createdStores,['membership_attempts_v1']);
  indexed.store.close();

  var saved=await env.store.save(input(),env.options);
  assert.strictEqual(saved.status,'saved');
  assert.strictEqual(saved.data.operationId,ids.operation);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(saved.data,'email'),
    false
  );
  var createdAt=saved.data.createdAt;

  var read=await env.store.get(input(),env.options);
  assert.strictEqual(read.ok,true);
  assert.strictEqual(read.data.createdAt,createdAt);

  var preserved=await env.store.save(input(),env.options);
  assert.strictEqual(preserved.status,'preserved');
  assert.strictEqual(preserved.data.operationId,ids.operation);

  var mismatch=await env.store.save(input({
    operationId:ids.other
  }),env.options);
  assert.strictEqual(mismatch.status,'operation_mismatch');

  var otherActor=input({
    actorUserId:ids.other,
    operationId:ids.other
  });
  assert.notStrictEqual(
    env.store.buildAttemptKey(input()),
    env.store.buildAttemptKey(otherActor)
  );
  assert.strictEqual(
    (await env.store.save(otherActor,env.options)).status,
    'saved'
  );

  var removeIntent=input({
    action:'remove_manager',
    operationId:ids.other
  });
  assert.notStrictEqual(
    env.store.buildAttemptKey(input()),
    env.store.buildAttemptKey(removeIntent)
  );

  assert.strictEqual(
    (await env.store.save(input({targetUserId:'invalid'}),env.options))
      .status,
    'invalid'
  );
  assert.strictEqual(
    (await env.store.save(input({action:'invalid'}),env.options)).status,
    'invalid'
  );

  assert.strictEqual(
    (await env.store.remove(input(),env.options)).status,
    'removed'
  );
  assert.strictEqual(
    (await env.store.get(input(),env.options)).status,
    'not_found'
  );

  var failed=load();
  failed.options.repository.get=function(){
    return Promise.reject(new Error('read'));
  };
  assert.strictEqual(
    (await failed.store.get(input(),failed.options)).status,
    'read_failed'
  );

  var sourceText=source;
  [
    'appData',
    'StorageRepository',
    'OfflineSyncQueue',
    'SupabaseSnapshotSync',
    'ConferenceLinkStore'
  ].forEach(function(forbidden){
    assert.strictEqual(sourceText.indexOf(forbidden),-1);
  });

  console.log('conference membership attempt store tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
