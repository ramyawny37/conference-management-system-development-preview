'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var source=fs.readFileSync(path.join(
  root,'js/sync/conference-link-store.js'
),'utf8');
var values={};
var sandbox={
  window:null,JSON:JSON,Object:Object,String:String,Array:Array,Date:Date,
  Error:Error,Number:Number,structuredClone:global.structuredClone,
  localStorage:{
    getItem:function(key){return values[key]||null;},
    setItem:function(key,value){values[key]=value;}
  }
};
sandbox.window=sandbox;
vm.runInNewContext(source,sandbox,{filename:'conference-link-store.js'});
var store=sandbox.ConferenceLinkStore;
var localId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
var remoteId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

assert.strictEqual(store.save({
  localConferenceId:localId,remoteConferenceId:remoteId,
  linkStatus:'linked',knownRevision:18
}).ok,true);

// Simulate a writer retaining an old link while another path has already linked it.
var stale=store.get(localId);
stale.linkStatus='needs_resolution';
stale.conflictId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
stale.conflictStatus='active';
stale.actualRevision=19;
assert.strictEqual(store.save(stale,{diagnosticWriter:{
  writerName:'TestWriter',incomingRevision:19,
  reason:'test_conflict',trigger:'test'
}}).ok,true);

var saved=store.get(localId);
var trace=store.getWriteDiagnostics();
assert.strictEqual(saved.linkStatus,'needs_resolution');
assert.strictEqual(saved.actualRevision,19);
assert.strictEqual(trace.length,1);
assert.strictEqual(trace[0].eventName,'LINK_STATUS_REGRESSION_DETECTED');
assert.strictEqual(trace[0].writerName,'TestWriter');
assert.strictEqual(trace[0].previousLinkStatus,'linked');
assert.strictEqual(trace[0].nextLinkStatus,'needs_resolution');
assert.strictEqual(trace[0].knownRevision,18);
assert.strictEqual(trace[0].incomingRevision,19);
assert.strictEqual(trace[0].reason,'test_conflict');
assert.strictEqual(trace[0].trigger,'test');
assert.ok(Array.isArray(trace[0].stackTrace));
assert.ok(trace[0].timestamp);
assert.strictEqual(trace[0].conferenceId,'aaaaaaaa…');
assert.strictEqual(trace[0].conflictId,'cccccccc…');

var writers={
  'js/sync/automatic-queue-runner.js':[
    'AutomaticQueueRunner.saveConflictLink'
  ],
  'js/sync/conflict-resolution-ui.js':[
    'ConflictResolutionUI.loadConflict'
  ],
  'js/sync/conference-sync-ui.js':[
    'ConferenceSyncUI.previewRemote','ConferenceSyncUI.syncNow'
  ],
  'js/sync/realtime-locks-ui.js':[
    'RealtimeLocksUI.reviewRemote'
  ]
};
Object.keys(writers).forEach(function(file){
  var text=fs.readFileSync(path.join(root,file),'utf8');
  assert.ok(text.indexOf("linkStatus:'needs_resolution'")>=0,file);
  writers[file].forEach(function(writer){
    assert.ok(text.indexOf("writerName:'"+writer+"'")>=0,
      file+' missing '+writer);
  });
});

console.log('conference link writer diagnostics tests: passed');
