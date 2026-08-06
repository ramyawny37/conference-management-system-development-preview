(function(global){
  'use strict';
  var RUNTIME_BUILD_REVISION='canonical-conference-schema-v1';
  var SERVICE_WORKER_CACHE_REVISION='realtime-drop-instrumentation-v1';
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
    'realtimeManagerState','realtimeTrace','linkStatusWriteTrace',
    'realtime.lastAcceptedRevision',
    'realtime.lastPostQueueClassification','realtime.lastDropStage',
    'realtime.lastDropReason','realtime.lastNotifyResult',
    'orchestrator.lastRealtimeListenerResult',
    'orchestrator.lastScheduledReasons',
    'orchestrator.lastEvaluationReasons',
    'orchestrator.lastRefreshDecision',
    'persistentLinkStatusWriteTrace','persistentRegressionCount',
    'latestPersistentRegression','traceStorageReadError',
    'lastPreMetadataExitReason','preMetadataTrace',
    'linkedRefreshCurrentStage','linkedRefreshExceptionStage',
    'linkedRefreshTrace','activationCurrentStage','activationExceptionStage',
    'activationTrace',
    'lock.section','lock.lockOwnerDeviceId','lock.lockOwnerUserId',
    'lock.lockOwnerEmail','lock.acquiredAt','lock.expiresAt',
    'lock.serverNow','lock.heartbeatAt','lock.isExpired',
    'lock.localManagerState','lock.lastAcquireResult',
    'lock.lastRenewResult','lock.lastReleaseResult',
    'lock.lastReleaseDiagnostic','lock.heartbeatTimerCount',
    'draft.exists','draft.status','draft.executionStatus',
    'draft.executionResult','draft.finalizationState',
    'pending.exists','pending.status','pending.revision',
    'pending.applicationState','link.linkStatus',
    'link.pendingLocalApplication','link.knownRevision',
    'link.actualRevision','firstIncompleteFlag'
  ]);
  var conflictRead={
    localConferenceId:null,loading:false,loaded:false,generation:0,
    draft:null,pending:null,link:null,firstIncompleteFlag:null
  };
  function copy(value){
    if(value===undefined)return null;
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function shortId(value){var text=String(value||'');return text?text.slice(0,8)+'…'+text.slice(-4):null;}
  function realtimeStates(manager){
    var values=manager&&typeof manager.getState==='function'
      ?manager.getState():{};
    return Object.keys(values||{}).map(function(key){
      var value=values[key]||{};
      return {
        status:value.status||null,
        reason:value.reason||null,
        lastError:value.lastError&&value.lastError.code||null,
        lastConnectedAt:value.lastConnectedAt||null,
        lastEventAt:value.lastEventAt||null
      };
    });
  }
  function incompleteFlag(draft){
    var finalization=draft&&draft.finalization||{};
    var flags=[
      'pendingApplicationStored','revisionPublished',
      'linkMetadataUpdated','queueUpdated'
    ];
    for(var index=0;index<flags.length;index++){
      if(finalization[flags[index]]!==true)return flags[index];
    }
    return draft&&draft.executionStatus==='completed'
      ?null:'draftCompleted';
  }
  function requestConflictRead(localConferenceId){
    localConferenceId=String(localConferenceId||'');
    if(!localConferenceId||conflictRead.loading&&
      conflictRead.localConferenceId===localConferenceId||
      conflictRead.loaded&&conflictRead.localConferenceId===localConferenceId){
      return;
    }
    var repository=global.AppIndexedDB;
    if(!repository||typeof repository.getRecord!=='function')return;
    var token=++conflictRead.generation;
    conflictRead={
      localConferenceId:localConferenceId,loading:true,loaded:false,
      generation:token,draft:null,pending:null,link:null,
      firstIncompleteFlag:null
    };
    Promise.all([
      repository.getRecord('conflict_resolution_drafts',localConferenceId),
      repository.getRecord('pending_remote_applications',localConferenceId)
    ]).then(function(records){
      if(token!==conflictRead.generation)return;
      var links=global.ConferenceLinkStore;
      var link=links&&typeof links.get==='function'
        ?links.get(localConferenceId):null;
      conflictRead.loading=false;
      conflictRead.loaded=true;
      conflictRead.draft=copy(records[0]);
      conflictRead.pending=copy(records[1]);
      conflictRead.link=copy(link);
      conflictRead.firstIncompleteFlag=incompleteFlag(records[0]);
      if(typeof global.renderSettings==='function')global.renderSettings();
    }).catch(function(){
      if(token!==conflictRead.generation)return;
      conflictRead.loading=false;
      conflictRead.loaded=true;
      if(typeof global.renderSettings==='function')global.renderSettings();
    });
  }
  function read(){
    var orchestrator=global.AutomaticSyncOrchestrator;
    var openService=global.DiscoveredConferenceOpenService;
    var orchestratorState=orchestrator&&typeof orchestrator.getState==='function'
      ?orchestrator.getState():{};
    var openState=openService&&typeof openService.getState==='function'
      ?openService.getState():{};
    var activationState=typeof global.getMemberActivationDiagnostics==='function'
      ?global.getMemberActivationDiagnostics():{};
    var realtimeManager=global.ConferenceRealtimeManager;
    var realtimeEventDiagnostics=realtimeManager&&
      typeof realtimeManager.getEventDiagnostics==='function'
      ?realtimeManager.getEventDiagnostics():{};
    var current=typeof global.getCurrentConference==='function'
      ?global.getCurrentConference():null;
    var localConferenceId=current&&String(current.id||'')||'';
    requestConflictRead(localConferenceId);
    var conflict=conflictRead.localConferenceId===localConferenceId
      ?conflictRead:{};
    var draft=conflict.draft||null;
    var pending=conflict.pending||null;
    var link=conflict.link||null;
    var persistentStore=global.LinkStatusDiagnosticStore;
    var persistentState=persistentStore&&
      typeof persistentStore.getState==='function'
      ?persistentStore.getState():{};
    var editLock=global.ConferenceEditLockManager&&
      typeof global.ConferenceEditLockManager.getDiagnostics==='function'
      ?global.ConferenceEditLockManager.getDiagnostics():{};
    var lockData=editLock.lock||{};
    var lockClientState=global.ConferenceLocks&&
      typeof global.ConferenceLocks.getState==='function'
      ?global.ConferenceLocks.getState():{};
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
      realtimeManagerState:copy(realtimeStates(realtimeManager)),
      realtimeTrace:copy(realtimeManager&&
        typeof realtimeManager.getDiagnostics==='function'
          ?realtimeManager.getDiagnostics():[]),
      'realtime.lastAcceptedRevision':Number.isInteger(
        realtimeEventDiagnostics.lastAcceptedRevision
      )?realtimeEventDiagnostics.lastAcceptedRevision:null,
      'realtime.lastPostQueueClassification':
        realtimeEventDiagnostics.lastPostQueueClassification||null,
      'realtime.lastDropStage':
        realtimeEventDiagnostics.lastDropStage||null,
      'realtime.lastDropReason':
        realtimeEventDiagnostics.lastDropReason||null,
      'realtime.lastNotifyResult':copy(
        realtimeEventDiagnostics.lastNotifyResult||null
      ),
      'orchestrator.lastRealtimeListenerResult':copy(
        orchestratorState.lastRealtimeListenerResult||null
      ),
      'orchestrator.lastScheduledReasons':copy(
        orchestratorState.lastScheduledReasons||null
      ),
      'orchestrator.lastEvaluationReasons':copy(
        orchestratorState.lastEvaluationReasons||[]
      ),
      'orchestrator.lastRefreshDecision':copy(
        orchestratorState.lastRefreshDecision||null
      ),
      linkStatusWriteTrace:copy(global.ConferenceLinkStore&&
        typeof global.ConferenceLinkStore.getWriteDiagnostics==='function'
          ?global.ConferenceLinkStore.getWriteDiagnostics():[]),
      persistentLinkStatusWriteTrace:copy(persistentState.records||[]),
      persistentRegressionCount:Number.isInteger(
        persistentState.regressionCount
      )?persistentState.regressionCount:0,
      latestPersistentRegression:copy(
        persistentState.latestRegression||null
      ),
      traceStorageReadError:persistentState.readError||null,
      lastPreMetadataExitReason:
        orchestratorState.lastPreMetadataExitReason||null,
      preMetadataTrace:copy(orchestratorState.preMetadataTrace||[]),
      linkedRefreshCurrentStage:openState.linkedRefreshCurrentStage||null,
      linkedRefreshExceptionStage:openState.linkedRefreshExceptionStage||null,
      linkedRefreshTrace:copy(openState.linkedRefreshTrace||[]),
      activationCurrentStage:activationState.currentStage||null,
      activationExceptionStage:activationState.exceptionStage||null,
      activationTrace:copy(activationState.trace||[]),
      'lock.section':editLock.section||'accommodation',
      'lock.lockOwnerDeviceId':shortId(lockData.deviceId),
      'lock.lockOwnerUserId':lockData.userId||null,
      'lock.lockOwnerEmail':null,
      'lock.acquiredAt':lockData.acquiredAt||null,
      'lock.expiresAt':lockData.expiresAt||null,
      'lock.serverNow':lockData.serverNow||null,
      'lock.heartbeatAt':lockData.lastRenewedAt||null,
      'lock.isExpired':typeof lockData.isExpired==='boolean'?lockData.isExpired:null,
      'lock.localManagerState':editLock.status||'viewing',
      'lock.lastAcquireResult':copy(editLock.lastAcquireResult),
      'lock.lastRenewResult':copy(editLock.lastRenewResult),
      'lock.lastReleaseResult':copy(editLock.lastReleaseResult),
      'lock.lastReleaseDiagnostic':copy(
        lockClientState.lastReleaseDiagnostic||null
      ),
      'lock.heartbeatTimerCount':Number.isInteger(editLock.heartbeatTimerCount)?editLock.heartbeatTimerCount:0,
      'draft.exists':conflict.loaded===true?!!draft:null,
      'draft.status':draft&&draft.status||null,
      'draft.executionStatus':draft&&draft.executionStatus||null,
      'draft.executionResult':copy(draft&&draft.executionResult),
      'draft.finalizationState':copy(draft&&draft.finalization),
      'pending.exists':conflict.loaded===true?!!pending:null,
      'pending.status':pending&&pending.status||null,
      'pending.revision':pending&&Number.isInteger(pending.resolvedRevision)
        ?pending.resolvedRevision:null,
      'pending.applicationState':copy(pending&&pending.applicationState),
      'link.linkStatus':link&&link.linkStatus||null,
      'link.pendingLocalApplication':link&&
        typeof link.pendingLocalApplication==='boolean'
        ?link.pendingLocalApplication:null,
      'link.knownRevision':link&&Number.isInteger(link.knownRevision)
        ?link.knownRevision:null,
      'link.actualRevision':link&&Number.isInteger(link.actualRevision)
        ?link.actualRevision:null,
      firstIncompleteFlag:conflict.loaded===true
        ?conflict.firstIncompleteFlag:null
    };
    var sanitized={};
    FIELDS.forEach(function(field){sanitized[field]=state[field];});
    return sanitized;
  }
  function clearPersistentLinkStatusTrace(){
    var store=global.LinkStatusDiagnosticStore;
    var result=store&&typeof store.clear==='function'
      ?store.clear():{ok:false,status:'unavailable'};
    if(typeof global.renderSettings==='function')global.renderSettings();
    return result;
  }
  global.MemberRuntimeDiagnostics=Object.freeze({
    runtimeBuildRevision:RUNTIME_BUILD_REVISION,
    serviceWorkerCacheRevision:SERVICE_WORKER_CACHE_REVISION,
    fields:FIELDS.slice(),read:read,
    clearPersistentLinkStatusTrace:clearPersistentLinkStatusTrace
  });
})(window);
