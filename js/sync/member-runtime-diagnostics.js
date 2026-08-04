(function(global){
  'use strict';
  var RUNTIME_BUILD_REVISION='member-linked-refresh-trace-v1';
  var SERVICE_WORKER_CACHE_REVISION='member-linked-refresh-trace-v1';
  var FIELDS=Object.freeze([
    'runtimeBuildRevision','serviceWorkerCacheRevision',
    'orchestratorStarted','lastScheduledReason',
    'lastLinkedRefreshAttemptAt','lastLinkedRefreshStatus',
    'lastLinkedRefreshBlockedReason','latestCloudRevision','knownRevision',
    'localMaterializedRevision','materializationTrusted',
    'materializationComplete','metadataRequestReached',
    'downloadRequestReached','downloadedRevision','downloadedCounts',
    'materializedCounts','persistedCounts','readAfterWriteCounts',
    'currentConferenceResolved','currentConferenceContentComplete',
    'activationReached','settingsConferenceResolved',
    'lastPreMetadataExitReason','preMetadataTrace',
    'linkedRefreshCurrentStage','linkedRefreshExceptionStage',
    'linkedRefreshTrace'
  ]);
  function copy(value){
    if(value===undefined)return null;
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function read(){
    var orchestrator=global.AutomaticSyncOrchestrator;
    var openService=global.DiscoveredConferenceOpenService;
    var orchestratorState=orchestrator&&typeof orchestrator.getState==='function'
      ?orchestrator.getState():{};
    var openState=openService&&typeof openService.getState==='function'
      ?openService.getState():{};
    var state={
      runtimeBuildRevision:RUNTIME_BUILD_REVISION,
      serviceWorkerCacheRevision:SERVICE_WORKER_CACHE_REVISION,
      orchestratorStarted:orchestratorState.started===true,
      lastScheduledReason:orchestratorState.lastScheduledReason||null,
      lastLinkedRefreshAttemptAt:openState.lastLinkedRefreshAttemptAt||null,
      lastLinkedRefreshStatus:openState.lastRefreshStatus||null,
      lastLinkedRefreshBlockedReason:openState.lastRefreshBlockedReason||null,
      latestCloudRevision:Number.isInteger(openState.latestCloudRevision)
        ?openState.latestCloudRevision:null,
      knownRevision:Number.isInteger(openState.knownRevisionBefore)
        ?openState.knownRevisionBefore:null,
      localMaterializedRevision:Number.isInteger(openState.localMaterializedRevision)
        ?openState.localMaterializedRevision:null,
      materializationTrusted:openState.materializationTrusted===true,
      materializationComplete:openState.materializationComplete===true,
      metadataRequestReached:openState.metadataRequestReached===true,
      downloadRequestReached:openState.downloadRequestReached===true,
      downloadedRevision:Number.isInteger(openState.downloadedRevision)
        ?openState.downloadedRevision:null,
      downloadedCounts:copy(openState.downloadedCounts),
      materializedCounts:copy(openState.materializedCounts),
      persistedCounts:copy(openState.persistedCounts),
      readAfterWriteCounts:copy(openState.readAfterWriteCounts),
      currentConferenceResolved:openState.currentConferenceResolved===true,
      currentConferenceContentComplete:
        openState.currentConferenceContentComplete===true,
      activationReached:openState.activationReached===true,
      settingsConferenceResolved:openState.settingsConferenceResolved===true,
      lastPreMetadataExitReason:
        orchestratorState.lastPreMetadataExitReason||null,
      preMetadataTrace:copy(orchestratorState.preMetadataTrace||[]),
      linkedRefreshCurrentStage:openState.linkedRefreshCurrentStage||null,
      linkedRefreshExceptionStage:openState.linkedRefreshExceptionStage||null,
      linkedRefreshTrace:copy(openState.linkedRefreshTrace||[])
    };
    var sanitized={};
    FIELDS.forEach(function(field){sanitized[field]=state[field];});
    return sanitized;
  }
  global.MemberRuntimeDiagnostics=Object.freeze({
    runtimeBuildRevision:RUNTIME_BUILD_REVISION,
    serviceWorkerCacheRevision:SERVICE_WORKER_CACHE_REVISION,
    fields:FIELDS.slice(),read:read
  });
})(window);
