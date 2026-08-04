'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var source=fs.readFileSync(path.resolve(__dirname,'../js/sync/conference-link-store.js'),'utf8');
var values={};
var sandbox={window:null,JSON:JSON,Object:Object,String:String,Array:Array,Date:Date,
  structuredClone:global.structuredClone,localStorage:{
    getItem:function(key){return values[key]||null;},
    setItem:function(key,value){values[key]=value;}
  }};
sandbox.window=sandbox;
vm.runInNewContext(source,sandbox);
var store=sandbox.ConferenceLinkStore;
var remote='11111111-1111-4111-8111-111111111111';
assert.strictEqual(store.save({localConferenceId:'local-a',remoteConferenceId:remote,
  knownRevision:8,linkStatus:'needs_resolution',conflictId:'conflict-1',
  conflictStatus:'active'}).ok,true);
assert.strictEqual(store.save({localConferenceId:'local-a',remoteConferenceId:remote,
  knownRevision:9,linkStatus:'linked',conflictId:null,conflictStatus:null,
  resolutionStrategy:null,resolutionOperationId:null}).ok,true);
var cleared=store.get('local-a');
assert.strictEqual(cleared.linkStatus,'linked');
assert.strictEqual(cleared.knownRevision,9);
assert.strictEqual(cleared.conflictId,null);
assert.strictEqual(cleared.conflictStatus,null);
console.log('conference link conflict clearing tests: passed');
