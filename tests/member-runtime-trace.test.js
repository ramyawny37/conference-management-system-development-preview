const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const marker='canonical-conference-schema-v1';
const cacheMarker='pwa-deterministic-update-test-v1';
const source=fs.readFileSync(path.join(
  root,'js/sync/member-runtime-diagnostics.js'),'utf8');
const sandbox={window:null,structuredClone:value=>JSON.parse(JSON.stringify(value)),
  AutomaticSyncOrchestrator:{getState:()=>({
    started:true,lastScheduledReason:'startup',
    linkedConferenceId:'sensitive-local-id',token:'sensitive-token'
  })},
  DiscoveredConferenceOpenService:{getState:()=>({
    lastLinkedRefreshAttemptAt:'2026-08-04T01:02:03.000Z',
    lastRefreshStatus:'up_to_date',lastRefreshBlockedReason:null,
    latestCloudRevision:4,knownRevisionBefore:4,
    localMaterializedRevision:4,materializationTrusted:true,
    materializationComplete:true,metadataRequestReached:true,
    downloadRequestReached:false,downloadedRevision:4,
    downloadedCounts:{houses:0,activeRooms:0},
    materializedCounts:{houses:0,activeRooms:0},
    persistedCounts:{houses:0,activeRooms:0},
    readAfterWriteCounts:{houses:0,activeRooms:0},
    currentConferenceResolved:true,currentConferenceContentComplete:true,
    activationReached:false,settingsConferenceResolved:true,
    remoteConferenceId:'sensitive-remote-id',conferenceName:'sensitive-name',
    accessToken:'sensitive-token',
    linkedRefreshCurrentStage:'trusted_check',
    linkedRefreshExceptionStage:null,
    linkedRefreshTrace:[{at:'2026-08-04T01:02:03.000Z',
      stage:'trusted_check',status:'completed',reason:'trusted_complete'}]
  })},
  ConferenceRealtimeManager:{
    getState:()=>({local:{status:'subscribed',reason:'subscribed',
      lastError:null,lastConnectedAt:'2026-08-04T01:02:04.000Z',
      lastEventAt:null}}),
    getDiagnostics:()=>[{stage:'START_SUBSCRIBE',
      at:'2026-08-04T01:02:04.000Z',
      data:{localConferenceIdPresent:true}}]
  }
};
sandbox.window=sandbox;
vm.runInNewContext(source,sandbox);
const service=sandbox.MemberRuntimeDiagnostics;
const first=service.read();
const second=service.read();
assert.deepStrictEqual(first,second,'diagnostic reads must not mutate runtime state');
assert.strictEqual(first.runtimeBuildRevision,marker);
assert.strictEqual(first.serviceWorkerCacheRevision,cacheMarker);
assert.strictEqual(first.orchestratorStarted,true);
assert.strictEqual(first.lastScheduledReason,'startup');
assert.strictEqual(first.materializationTrusted,true);
assert.strictEqual(first.downloadRequestReached,false);
assert.strictEqual(first.realtimeManagerState[0].status,'subscribed');
assert.strictEqual(first.realtimeTrace[0].stage,'START_SUBSCRIBE');
assert.deepStrictEqual(Object.keys(first),Array.from(service.fields));
const serialized=JSON.stringify(first);
['sensitive-local-id','sensitive-remote-id','sensitive-name','sensitive-token',
  'remoteConferenceId','conferenceName','accessToken','token'].forEach(value=>{
  assert.strictEqual(serialized.includes(value),false,
    'sanitized diagnostics leaked '+value);
});

const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
assert.ok(worker.includes("const CACHE_REVISION = '"+cacheMarker+"';"));
[
  'js/sync/member-runtime-diagnostics.js?rev='+cacheMarker,
  'core.js?rev='+marker,
  'people.js?rev='+marker,
  'houses.js?rev='+marker,
  'script.js?rev='+marker
].forEach(asset=>{
  assert.ok(index.includes('src="'+asset+'"'),'index missing '+asset);
  assert.ok(worker.includes("'./"+asset+"'"),'CORE_ASSETS missing '+asset);
});
const settingsSource=fs.readFileSync(path.join(
  root,'js/sync/sync-settings-ui.js'),'utf8');
assert.ok(settingsSource.includes('تشخيص مزامنة هذا الجهاز'));
assert.ok(source.includes(marker));
assert.ok(index.includes(
  'js/sync/sync-settings-ui.js?rev='+cacheMarker));
assert.ok(index.includes(
  'js/sync/automatic-sync-orchestrator.js?rev=local-save-queue-wake-v1'));
assert.ok(index.includes(
  'js/sync/conference-realtime-manager.js?rev='+
  'realtime-already-subscribed-completion-v1'));

console.log('member runtime trace tests passed');
