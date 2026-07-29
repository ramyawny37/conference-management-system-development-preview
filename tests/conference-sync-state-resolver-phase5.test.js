'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/conference-sync-state-resolver.js'
),'utf8');

function load(records){
  records=records||{};
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    ConferenceLinkStore:{
      get:function(){return records.link||null;}
    },
    ConflictResolutionDraftStore:{
      get:function(){
        return Promise.resolve(records.draft
          ?{ok:true,data:records.draft}
          :{ok:false,status:'not_found'});
      }
    },
    PendingRemoteApplicationStore:{
      get:function(){
        return Promise.resolve(records.pending
          ?{ok:true,data:records.pending}
          :{ok:false,status:'not_found'});
      }
    }
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{
    filename:'conference-sync-state-resolver.js'
  });
  return sandbox.ConferenceSyncStateResolver;
}

function linked(overrides){
  return Object.assign({
    localConferenceId:'local-a',
    remoteConferenceId:'remote-a',
    linkStatus:'linked',
    conflictStatus:'none',
    pendingLocalApplication:false
  },overrides||{});
}

async function run(){
  assert.strictEqual((await load({}).resolve({
    localConferenceId:'local-a'
  })).status,'local_only');

  assert.strictEqual((await load({link:linked()}).resolve({
    localConferenceId:'local-a'
  })).status,'linked');

  assert.strictEqual((await load({
    link:linked({conflictStatus:'active'})
  }).resolve({localConferenceId:'local-a'})).status,'needs_resolution');

  assert.strictEqual((await load({
    link:linked({pendingLocalApplication:true})
  }).resolve({localConferenceId:'local-a'})).status,
  'pending_local_application');

  assert.strictEqual((await load({
    link:linked(),
    pending:{status:'pending'}
  }).resolve({localConferenceId:'local-a'})).status,
  'pending_local_application');

  var resumable={
    executionStatus:'executed',
    executionResult:{ok:true,status:'resolved'}
  };
  assert.strictEqual((await load({
    link:linked({conflictStatus:'active'}),
    draft:resumable
  }).resolve({localConferenceId:'local-a'})).status,
  'finalizing_conflict');

  var records={
    link:linked(),
    pending:{status:'pending'}
  };
  var before=await load(records).resolve({localConferenceId:'local-a'});
  var after=await load(records).resolve({localConferenceId:'local-a'});
  assert.strictEqual(before.status,after.status);
  assert.strictEqual(after.status,'pending_local_application');

  var readFailure=load({link:linked()});
  assert.strictEqual((await readFailure.resolve({
    localConferenceId:'local-a'
  },{
    drafts:{get:function(){return Promise.reject(new Error('read'));}},
    pending:{get:function(){
      return Promise.resolve({ok:false,status:'not_found'});
    }},
    links:{get:function(){return linked();}}
  })).status,'error');

  console.log('conference-sync-state-resolver phase 5 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
