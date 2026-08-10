const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const marker='canonical-conference-schema-v1';
const cacheMarker='legacy-conference-preflight-v2';
const shellMarker='template-floor-conference-sync-v1';
const houseMarker='template-floor-conference-sync-v1';
const scriptMarker='template-floor-conference-sync-v1';
const privacyMarker='diagnostics-privacy-hardening-v1';
const realtimeMarker='template-sync-isolation-v1';
const source=fs.readFileSync(path.join(
  root,'js/sync/member-runtime-diagnostics.js'),'utf8');
const sandbox={window:null,structuredClone:value=>JSON.parse(JSON.stringify(value)),
  AutomaticSyncOrchestrator:{getState:()=>({
    started:true,lastScheduledReason:'startup',
    lastRealtimeListenerResult:{accepted:true,revision:5},
    lastScheduledReasons:{reason:'conference_changed',
      before:['local_save'],after:['local_save','conference_changed']},
    lastEvaluationReasons:['conference_changed'],
    lastRefreshDecision:{reasons:['conference_changed'],
      conferenceChanged:true,allowed:true,skipReason:null},
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
      data:{localConferenceIdPresent:true}}],
    getEventDiagnostics:()=>({lastAcceptedRevision:5,
      lastPostQueueClassification:'remote_change_detected',
      lastDropStage:null,lastDropReason:null,
      lastNotifyResult:{executed:true,classification:'remote_change_detected'}})
  },
  ConferenceLocks:{getState:()=>({lastReleaseDiagnostic:{
    rpcName:'release_conference_section_lock',outcome:'response_error',
    deviceId:'22222222...2222',lockToken:'333333...3333'
  }})}
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
assert.strictEqual(first['realtime.lastAcceptedRevision'],5);
assert.strictEqual(first['realtime.lastPostQueueClassification'],
  'remote_change_detected');
assert.strictEqual(first['orchestrator.lastRealtimeListenerResult'].accepted,
  true);
assert.strictEqual(first['orchestrator.lastScheduledReasons'].reason,
  'conference_changed');
assert.strictEqual(first['orchestrator.lastRefreshDecision'].allowed,true);
assert.strictEqual(first['lock.lastReleaseDiagnostic'].outcome,'response_error');
assert.strictEqual(first['lock.lastReleaseDiagnostic'].lockToken,undefined);
assert.deepStrictEqual(Object.keys(first),Array.from(service.fields));
const serialized=JSON.stringify(first);
['sensitive-local-id','sensitive-remote-id','sensitive-name','sensitive-token',
  'remoteConferenceId','conferenceName','accessToken','token',
  '333333...3333','22222222...2222'].forEach(value=>{
  assert.strictEqual(serialized.includes(value),false,
    'sanitized diagnostics leaked '+value);
});

const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
assert.ok(worker.includes("const CACHE_REVISION = '"+shellMarker+"';"));
[
  'js/sync/member-runtime-diagnostics.js?rev='+cacheMarker,
  'js/sync/conference-realtime-manager.js?rev='+realtimeMarker,
  'js/sync/automatic-sync-orchestrator.js?rev=realtime-reconnect-catchup-v1',
  'js/sync/conference-locks.js?rev=conference-lock-release-diagnostics-v1',
  'core.js?rev='+marker,
  'people.js?rev='+marker,
  'houses.js?rev='+houseMarker,
  'script.js?rev='+scriptMarker
].forEach(asset=>{
  assert.ok(index.includes('src="'+asset+'"'),'index missing '+asset);
  assert.ok(worker.includes("'./"+asset+"'"),'CORE_ASSETS missing '+asset);
});
const settingsSource=fs.readFileSync(path.join(
  root,'js/sync/sync-settings-ui.js'),'utf8');
assert.ok(settingsSource.includes('تشخيص مزامنة هذا الجهاز'));
assert.ok(source.includes(marker));
assert.ok(index.includes(
  'js/sync/sync-settings-ui.js?rev='+privacyMarker));

console.log('member runtime trace tests passed');
