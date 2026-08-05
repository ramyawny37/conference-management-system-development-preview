'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var root=path.resolve(__dirname,'..');
var diagnosticSource=fs.readFileSync(path.join(
  root,'js/sync/link-status-diagnostic-store.js'
),'utf8');
var linkSource=fs.readFileSync(path.join(
  root,'js/sync/conference-link-store.js'
),'utf8');

function storage(values,failWrites){
  return {
    getItem:function(key){return values[key]===undefined?null:values[key];},
    setItem:function(key,value){
      if(failWrites)throw new Error('WRITE_DENIED');
      values[key]=String(value);
    },
    removeItem:function(key){
      if(failWrites)throw new Error('REMOVE_DENIED');
      delete values[key];
    }
  };
}
function loadDiagnostic(local,session){
  var sandbox={
    window:null,JSON:JSON,Object:Object,String:String,Array:Array,Date:Date,
    Number:Number,Math:Math,Error:Error,localStorage:local,
    sessionStorage:session,structuredClone:global.structuredClone,
    crypto:{randomUUID:function(){
      return '00000000-0000-4000-8000-'+String(Math.random()).slice(2,14);
    }}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(diagnosticSource,sandbox,{
    filename:'link-status-diagnostic-store.js'
  });
  return sandbox;
}
function event(index){
  return {
    eventName:index%2?'LINK_STATUS_WRITE_ATTEMPT':
      'LINK_STATUS_REGRESSION_DETECTED',
    writerName:'writer-'+index,conferenceId:'local-id…',
    previousLinkStatus:'linked',nextLinkStatus:'needs_resolution',
    conflictId:'conflict…',conflictStatus:'active',
    pendingLocalApplication:false,knownRevision:index,
    incomingRevision:index+1,reason:'test',trigger:'test',
    stackTrace:['frame-a','frame-b'],timestamp:'2026-08-05T00:00:00.000Z'
  };
}

var localValues={
  conference_manager_sync_links:'links-unchanged',
  offline_sync_queue:'queue-unchanged',
  conflict_resolution_drafts:'drafts-unchanged',
  pending_remote_applications:'pending-unchanged'
};
var sessionValues={};
var local=storage(localValues,false);
var session=storage(sessionValues,false);
var first=loadDiagnostic(local,session);
for(var index=0;index<55;index++){
  assert.strictEqual(first.LinkStatusDiagnosticStore.append(event(index)).ok,true);
}
var beforeReload=first.LinkStatusDiagnosticStore.getState();
assert.strictEqual(beforeReload.records.length,50);
assert.strictEqual(beforeReload.records[0].writerName,'writer-5');
assert.strictEqual(beforeReload.records[49].writerName,'writer-54');
assert.ok(beforeReload.records[0].sessionId);
assert.ok(beforeReload.records[0].pageLoadId);
assert.deepStrictEqual(Array.from(beforeReload.records[0].stack),[
  'frame-a','frame-b'
]);

var second=loadDiagnostic(local,session);
var afterReload=second.LinkStatusDiagnosticStore.getState();
assert.strictEqual(afterReload.records.length,50);
assert.strictEqual(afterReload.records[0].writerName,'writer-5');
assert.strictEqual(afterReload.records[0].sessionId,
  beforeReload.records[0].sessionId);
assert.notStrictEqual(afterReload.pageLoadId,beforeReload.pageLoadId);
assert.ok(afterReload.regressionCount>0);
assert.strictEqual(afterReload.latestRegression.eventName,
  'LINK_STATUS_REGRESSION_DETECTED');

assert.strictEqual(second.LinkStatusDiagnosticStore.clear().ok,true);
assert.strictEqual(second.LinkStatusDiagnosticStore.list().length,0);
assert.strictEqual(localValues.conference_manager_sync_links,'links-unchanged');
assert.strictEqual(localValues.offline_sync_queue,'queue-unchanged');
assert.strictEqual(localValues.conflict_resolution_drafts,'drafts-unchanged');
assert.strictEqual(localValues.pending_remote_applications,'pending-unchanged');

var failing=loadDiagnostic(storage({},true),storage({},false));
assert.strictEqual(failing.LinkStatusDiagnosticStore.append(event(1)).ok,false);
assert.strictEqual(failing.LinkStatusDiagnosticStore.list().length,1);
assert.ok(failing.LinkStatusDiagnosticStore.getState().writeError);

var malformedValues={
  conference_manager_link_status_diagnostics_v1:'not-json'
};
var malformed=loadDiagnostic(
  storage(malformedValues,false),storage({},false)
);
assert.ok(malformed.LinkStatusDiagnosticStore.getState().readError);

var linkValues={};
var linkStorage=storage(linkValues,false);
var linkSandbox={
  window:null,JSON:JSON,Object:Object,String:String,Array:Array,Date:Date,
  Number:Number,Error:Error,structuredClone:global.structuredClone,
  localStorage:linkStorage
};
linkSandbox.window=linkSandbox;
vm.runInNewContext(linkSource,linkSandbox,{filename:'conference-link-store.js'});
var links=linkSandbox.ConferenceLinkStore;
var localId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
var remoteId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
assert.strictEqual(links.save({localConferenceId:localId,
  remoteConferenceId:remoteId,knownRevision:1,linkStatus:'linked'}).ok,true);
var appendObservedStatus=null;
linkSandbox.LinkStatusDiagnosticStore={append:function(){
  appendObservedStatus=JSON.parse(
    linkValues.conference_manager_sync_links
  )[localId].linkStatus;
  throw new Error('DIAGNOSTIC_FAILURE');
}};
var saved=links.save({localConferenceId:localId,
  remoteConferenceId:remoteId,knownRevision:1,
  actualRevision:2,linkStatus:'needs_resolution'},
  {diagnosticWriter:{writerName:'TestWriter'}});
assert.strictEqual(appendObservedStatus,'linked',
  'diagnostic append must run before the original link write');
assert.strictEqual(saved.ok,true,
  'diagnostic failure must not block the original link write');
assert.strictEqual(links.get(localId).linkStatus,'needs_resolution');

var writerTest=fs.readFileSync(path.join(
  root,'tests/conference-link-writer-diagnostics.test.js'
),'utf8');
[
  'AutomaticQueueRunner.saveConflictLink',
  'ConflictResolutionUI.loadConflict',
  'ConferenceSyncUI.previewRemote',
  'ConferenceSyncUI.syncNow',
  'RealtimeLocksUI.reviewRemote'
].forEach(function(writer){assert.ok(writerTest.indexOf(writer)>=0);});

var settingsSource=fs.readFileSync(path.join(
  root,'js/sync/sync-settings-ui.js'
),'utf8');
assert.ok(settingsSource.indexOf('مسح سجل تشخيص Link')>=0);
assert.ok(settingsSource.indexOf(
  'MemberRuntimeDiagnostics.clearPersistentLinkStatusTrace()'
)>=0);

console.log('link status diagnostic store tests: passed');
