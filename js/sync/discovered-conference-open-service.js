(function(global){
  'use strict';
  var RUNTIME_BUILD_REVISION='canonical-conference-schema-v1';
  var flights=Object.create(null);
  var refreshFlights=Object.create(null);
  var transactionTail=Promise.resolve();
  var generation=0;
  var MAX_DIAGNOSTICS=40;
  var diagnostics=[];
  var diagnosticState={
    runtimeBuildRevision:RUNTIME_BUILD_REVISION,
    latestCloudRevision:null,requestedRevision:null,downloadedRevision:null,
    extractedSnapshotValid:false,downloadedCounts:null,
    materializedCounts:null,persistedCounts:null,readAfterWriteCounts:null,
    knownRevisionBefore:null,knownRevisionAfter:null,
    contextBaseRevisionBefore:null,contextBaseRevisionAfter:null,
    currentConferenceResolved:false,currentConferenceContentComplete:false,
    lastRefreshStatus:null,lastRefreshBlockedReason:null,
    lastMaterializationStatus:null,lastActivationStatus:null,
    settingsConferenceResolved:false,
    lastLinkedRefreshAttemptAt:null,
    metadataRequestReached:false,downloadRequestReached:false,
    localMaterializedRevision:null,materializationTrusted:false,
    materializationComplete:false,activationReached:false,
    repositoryRejectionStatus:null,repositoryRejectionIssueCodes:[],
    repositoryVersion:null,
    linkedRefreshTrace:[],linkedRefreshCurrentStage:null,
    linkedRefreshExceptionStage:null
  };
  var ROLES=['owner','manager','viewer','accommodation_viewer','transport_viewer'];

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function object(value){
    return !!value&&typeof value==='object'&&!Array.isArray(value);
  }
  function uuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }
  function result(ok,status,data){return {ok:ok,status:status,data:data||null};}
  function diagnostic(stage,status,data){
    diagnostics.unshift({
      at:new Date().toISOString(),
      stage:String(stage||'unknown'),
      status:String(status||'unknown'),
      data:data&&typeof data==='object'?copy(data):null
    });
    diagnostics=diagnostics.slice(0,MAX_DIAGNOSTICS);
  }
  function traceRealtimePipeline(stage,data){
    var manager=global.ConferenceRealtimeManager;
    if(manager&&typeof manager.traceDiagnostic==='function'){
      manager.traceDiagnostic(stage,data);
    }
  }
  function getDiagnostics(){
    return {ok:true,status:'read',data:{events:copy(diagnostics)}};
  }
  function getState(){return copy(diagnosticState);}
  function repositoryRejectionDetails(repository,added){
    var contract=null;
    try{
      contract=repository&&typeof repository.getContract==='function'
        ?repository.getContract():null;
    }catch(error){contract=null;}
    var issueCodes=added&&Array.isArray(added.issues)
      ?added.issues.map(function(item){return String(item&&item.code||'');})
        .filter(function(code){return !!code;})
      :[];
    return {
      status:String(added&&added.status||'missing_result'),
      issueCodes:issueCodes,
      repositoryVersion:Number.isInteger(contract&&contract.schemaVersion)
        ?contract.schemaVersion:null
    };
  }
  function traceLinkedRefresh(stage,status,reason){
    diagnosticState.linkedRefreshCurrentStage=String(stage||'unknown');
    diagnosticState.linkedRefreshTrace.push({
      at:new Date().toISOString(),
      stage:diagnosticState.linkedRefreshCurrentStage,
      status:String(status||'reached'),
      reason:reason?String(reason):null
    });
    diagnosticState.linkedRefreshTrace=
      diagnosticState.linkedRefreshTrace.slice(-40);
  }
  function traceRefreshResult(value){
    if(value&&typeof value.status==='string'){
      diagnosticState.lastRefreshStatus=value.status;
      if(value.ok===false&&!diagnosticState.lastRefreshBlockedReason){
        diagnosticState.lastRefreshBlockedReason=value.status;
      }
      if(value.ok===true)diagnosticState.lastRefreshBlockedReason=null;
    }
    return value;
  }
  function userId(d){
    var state=d.auth&&d.auth.getState?d.auth.getState():null;
    return String(state&&state.user&&state.user.id||'');
  }
  function client(d){return d.clients&&d.clients.getClient?d.clients.getClient():null;}
  function deps(options){
    options=options||{};
    return {
      auth:options.auth||global.SupabaseAuth,
      clients:options.clientLayer||global.SupabaseClientLayer,
      discovery:options.discovery||global.StartupConferenceDiscovery,
      remote:options.remote||global.SupabaseSnapshotSync,
      members:options.members||global.ConferenceMembersService,
      device:options.device||global.CurrentDeviceAuthorizationService,
      systemAccess:options.systemAccess||global.SystemAccessService,
      links:options.links||global.ConferenceLinkStore,
      queue:options.queue||global.OfflineSyncQueue,
      storage:options.storage||global.StorageRepository,
      repository:options.repository||global.ConferenceRepository,
      publishing:options.publishing||global.ConferencePublishingEngine,
      recovery:options.recovery||global.ConferencePublishRecovery,
      remoteUpdates:options.remoteUpdateStore||global.RemoteUpdateStore,
      deviceIdentity:options.deviceIdentity||global.SupabaseDeviceIdentity,
      getData:options.getAppData||function(){return global.appData;},
      applyData:options.applyAppData||function(value){global.appData=value;},
      normalize:options.normalizeAppData||global.normalizeAppDataCandidate,
      makeId:options.makeLocalId||global.uid,
      activate:options.activate||global.activatePersistedConferenceById,
      integration:options.integration||global.OfflineFirstIntegration,
      backup:options.fullBackupService||options.backup||
        global.FullBackupService
    };
  }
  function backupOptions(options){
    return {storage:options&&options.localStorage};
  }
  function restoreIsolationPending(d,options){
    if(!d.backup)return false;
    try{
      if(typeof d.backup.isFullRestoreCloudReviewPending==='function'){
        return d.backup.isFullRestoreCloudReviewPending(
          backupOptions(options)
        )===true;
      }
      if(typeof d.backup.getFullRestoreCloudReviewMarker==='function'){
        var marker=d.backup.getFullRestoreCloudReviewMarker(
          backupOptions(options)
        );
        return !!(marker&&marker.pending);
      }
    }catch(error){
      return true;
    }
    return false;
  }
  function manualRelinkPending(d,localConferenceId,options){
    if(!d.backup||
      typeof d.backup.isManualRelinkRequired!=='function')return false;
    try{
      return d.backup.isManualRelinkRequired(
        localConferenceId,backupOptions(options)
      )===true;
    }catch(error){
      return true;
    }
  }
  function guardStatus(d,localConferenceId,options){
    if(options&&typeof options.runtimeContextGuard==='function'){
      try{
        if(options.runtimeContextGuard()!==true){
          return 'runtime_context_changed';
        }
      }catch(error){return 'runtime_context_changed';}
    }
    if(restoreIsolationPending(d,options))return 'restore_isolated';
    if(localConferenceId&&manualRelinkPending(
      d,localConferenceId,options
    ))return 'manual_relink_required';
    return null;
  }
  function alive(token,d,account,activeClient){
    return token===generation&&account===userId(d)&&activeClient===client(d);
  }
  function persistedData(value){return value&&value.data?value.data:value;}
  function read(d){return Promise.resolve(d.storage.getAppSnapshot()).then(persistedData);}
  function persistGuarded(d,value,ctx,failureStatus,rollback){
    if(!alive(ctx.token,d,ctx.account,ctx.client)){
      return Promise.resolve(result(false,'stale'));
    }
    var blocked=guardStatus(d,ctx.localConferenceId,ctx.options);
    if(blocked)return Promise.resolve(result(false,blocked));
    return Promise.resolve().then(function(){
      if(!alive(ctx.token,d,ctx.account,ctx.client))return result(false,'stale');
      return d.storage.saveAppSnapshot(value,{skipSyncQueue:true});
    }).then(function(saved){
      if(saved&&saved.ok===false)return result(false,failureStatus);
      return read(d).then(function(verified){
        if(alive(ctx.token,d,ctx.account,ctx.client)){
          return result(true,'persisted',{value:verified});
        }
        if(!rollback)return result(false,'stale');
        return Promise.resolve(d.storage.saveAppSnapshot(
          rollback,{skipSyncQueue:true}
        )).catch(function(){return null;}).then(function(){
          return result(false,'stale');
        });
      });
    }).catch(function(){return result(false,failureStatus);});
  }
  function linkMatches(link,input){
    return !!link&&String(link.localConferenceId)===String(input.localConferenceId)&&
      String(link.remoteConferenceId)===String(input.remoteConferenceId)&&
      link.linkStatus===input.linkStatus&&
      link.knownRevision===input.knownRevision&&
      link.pendingLocalApplication===(input.pendingLocalApplication===true);
  }
  function saveLinkGuarded(d,input,ctx,failureStatus){
    if(!alive(ctx.token,d,ctx.account,ctx.client))return result(false,'stale');
    var blocked=guardStatus(d,input.localConferenceId,ctx.options);
    if(blocked)return result(false,blocked);
    var previous=d.links.get(input.localConferenceId);
    var saved;
    try{saved=d.links.save(input);}catch(error){saved={ok:false};}
    var actual=d.links.get(input.localConferenceId);
    var remote=d.links.findByRemoteId(input.remoteConferenceId);
    var verified=linkMatches(actual,input)&&linkMatches(remote,input);
    if(!alive(ctx.token,d,ctx.account,ctx.client)){
      try{
        if(previous)d.links.save(previous);
        else d.links.remove(input.localConferenceId);
      }catch(error){}
      return result(false,'stale');
    }
    if(verified)return result(true,saved&&saved.ok?'saved':'ambiguous_write_verified',{
      link:actual
    });
    return result(false,failureStatus);
  }
  function removeLinkGuarded(d,localConferenceId,ctx,failureStatus){
    if(!alive(ctx.token,d,ctx.account,ctx.client))return result(false,'stale');
    var removed;
    try{removed=d.links.remove(localConferenceId);}catch(error){removed={ok:false};}
    if(!alive(ctx.token,d,ctx.account,ctx.client))return result(false,'stale');
    return removed&&removed.ok&&!d.links.get(localConferenceId)
      ?result(true,'removed')
      :result(false,failureStatus);
  }
  function compensatePendingLink(d,input){
    var saved;
    try{saved=d.links.save(input);}catch(error){saved={ok:false};}
    var actual=d.links.get(input.localConferenceId);
    return linkMatches(actual,input)
      ?result(true,saved&&saved.ok?'compensated':'ambiguous_compensation_verified')
      :result(false,'recovery_cleanup_compensation_failed');
  }
  function recoveryRoot(data){
    data.conferenceImportRecovery=data.conferenceImportRecovery&&
      typeof data.conferenceImportRecovery==='object'&&
      !Array.isArray(data.conferenceImportRecovery)
      ?data.conferenceImportRecovery:{};
    return data.conferenceImportRecovery;
  }
  function conference(data,id){
    return (data&&Array.isArray(data.conferences)?data.conferences:[])
      .find(function(item){return item&&String(item.id)===String(id);})||null;
  }
  function lifecycle(data,id){
    return data&&data.conferenceLifecycle&&data.conferenceLifecycle.records&&
      data.conferenceLifecycle.records[id]||null;
  }
  function markCloudLinkedLifecycle(data,id){
    var next=copy(data);
    next.conferenceLifecycle=object(next.conferenceLifecycle)
      ?next.conferenceLifecycle:{schemaVersion:1,records:{}};
    next.conferenceLifecycle.records=object(next.conferenceLifecycle.records)
      ?next.conferenceLifecycle.records:{};
    var record=lifecycle(next,id);
    if(!record){
      record={
        localConferenceId:String(id),
        localLifecycle:'active',
        cloudLifecycle:'cloud_linked',
        localContentVersion:0,
        publishMetadata:null
      };
      next.conferenceLifecycle.records[id]=record;
    }
    record.cloudLifecycle='cloud_linked';
    record.publishMetadata=null;
    return next;
  }
  function activeFor(id,service){
    var state=service&&typeof service.getState==='function'
      ?service.getState()
      :null;
    return !!(state&&Array.isArray(state.activeConferenceIds)&&
      state.activeConferenceIds.indexOf(id)>=0);
  }
  function hasConflict(link){
    return !!(link&&(
      link.linkStatus==='needs_resolution'||
      link.conflictId||
      ['active','pending','reviewed','changed'].indexOf(
        link.conflictStatus
      )>=0
    ));
  }
  function importRecoveryPending(data,localConferenceId){
    if(typeof global.isConferenceImportRecoveryPending!=='function')return false;
    try{
      return global.isConferenceImportRecoveryPending(
        data,
        localConferenceId
      )===true;
    }catch(error){
      return true;
    }
  }
  function queuePendingStatus(status){
    status=String(status||'').toLowerCase();
    return ['pending','processing','conflict'].indexOf(status)>=0||
      status==='failed';
  }
  function evaluateLinkedRefreshGuards(d,localConferenceId,link,stored,options){
    if(!link||!link.remoteConferenceId||
      ['linked','cloud_linked'].indexOf(link.linkStatus)<0){
      return Promise.resolve(result(false,'not_linked'));
    }
    if(link.pendingLocalApplication===true||
      link.linkStatus==='server_selected_pending_local_apply'){
      return Promise.resolve(result(false,'pending_local_application'));
    }
    if(link.pendingRemoteApplication===true||object(link.syncState)&&
      link.syncState.pendingRemoteApplication===true){
      return Promise.resolve(result(false,'pending_remote_application'));
    }
    if(hasConflict(link)){
      return Promise.resolve(result(false,'needs_resolution'));
    }
    if(object(link.syncState)&&
      link.syncState.pendingLocalChanges===true){
      return Promise.resolve(result(false,'local_changes_pending'));
    }
    if(importRecoveryPending(stored,localConferenceId)){
      return Promise.resolve(result(false,'import_recovery_pending'));
    }
    if(activeFor(localConferenceId,d.publishing)){
      return Promise.resolve(result(false,'publishing_active'));
    }
    if(activeFor(localConferenceId,d.recovery)){
      return Promise.resolve(result(false,'reconciliation_active'));
    }
    var blocked=guardStatus(d,localConferenceId,options);
    if(blocked)return Promise.resolve(result(false,blocked));
    var record=lifecycle(stored,localConferenceId);
    if(object(link.syncState)&&
      Number.isInteger(link.syncState.queuedLocalContentVersion)&&
      Number.isInteger(record&&record.localContentVersion)&&
      link.syncState.queuedLocalContentVersion!==record.localContentVersion){
      return Promise.resolve(result(false,'local_content_version_mismatch'));
    }
    if(!d.queue||typeof d.queue.getConferenceReadiness!=='function'){
      return Promise.resolve(result(true,'guards_passed'));
    }
    return Promise.resolve(d.queue.getConferenceReadiness(
      link.remoteConferenceId,
      options&&options.queueOptions
    )).then(function(readiness){
      var blocking=readiness&&readiness.data&&
        Array.isArray(readiness.data.blockingOperations)
        ?readiness.data.blockingOperations
        :[];
      var pending=blocking.some(function(operation){
        return queuePendingStatus(operation&&operation.status);
      });
      if(!readiness||readiness.ok!==true||readiness.status!=='stable'||pending){
        return result(false,'local_changes_pending',{
          queueStatus:readiness&&readiness.status||'not_stable'
        });
      }
      return result(true,'guards_passed');
    }).catch(function(){
      return result(false,'local_changes_pending');
    });
  }
  function recordRemoteReviewMarker(d,remoteConferenceId,revision,options){
    if(!d.remoteUpdates||typeof d.remoteUpdates.add!=='function'){
      return {ok:false,status:'store_unavailable'};
    }
    var identity=null;
    try{
      identity=d.deviceIdentity&&
        typeof d.deviceIdentity.getOrCreate==='function'
        ?d.deviceIdentity.getOrCreate()
        :null;
    }catch(error){
      identity=null;
    }
    var sourceDeviceId=String(identity&&identity.id||'');
    if(!uuid(remoteConferenceId)||!uuid(sourceDeviceId)||
      !Number.isInteger(revision)||revision<0){
      return {ok:false,status:'invalid_marker_input'};
    }
    return d.remoteUpdates.add({
      remoteConferenceId:remoteConferenceId,
      revision:revision,
      sourceDeviceId:sourceDeviceId,
      receivedAt:new Date().toISOString(),
      status:'unreviewed'
    },options&&options.remoteUpdateOptions);
  }
  function snapshotCounts(snapshot){
    var houses=Array.isArray(snapshot&&snapshot.houses)
      ?snapshot.houses
      :[];
    var activeRooms=0;
    var assignedPeople=0;
    houses.forEach(function(house){
      var floors=Array.isArray(house&&house.floors)?house.floors:[];
      floors.forEach(function(floor){
        var rooms=Array.isArray(floor&&floor.rooms)?floor.rooms:[];
        rooms.forEach(function(room){
          if(room&&room.closed!==true)activeRooms++;
          assignedPeople+=Array.isArray(room&&room.guests)
            ?room.guests.length
            :0;
          assignedPeople+=Array.isArray(room&&room.children)
            ?room.children.length
            :0;
        });
      });
    });
    function arrayCount(value){return Array.isArray(value)?value.length:0;}
    function nestedArrayCount(value){
      if(Array.isArray(value))return value.length+
        value.reduce(function(total,item){return total+nestedArrayCount(item);},0);
      if(!object(value))return 0;
      return Object.keys(value).reduce(function(total,key){
        return total+nestedArrayCount(value[key]);
      },0);
    }
    var financial=snapshot&&(
      snapshot.financialV3||snapshot.financial||snapshot.financialData
    );
    var accounts=snapshot&&snapshot.accounts;
    return {
      conferencePeopleDb:Array.isArray(
        snapshot&&snapshot.peopleDb&&snapshot.peopleDb.people
      )?snapshot.peopleDb.people.length:0,
      assignedPeople:assignedPeople,
      houses:houses.length,
      activeRooms:activeRooms,
      transports:Array.isArray(snapshot&&snapshot.transports)
        ?snapshot.transports.length
        :0,
      activityLog:Array.isArray(snapshot&&snapshot.activityLog)
        ?snapshot.activityLog.length
        :0,
      restaurantData:nestedArrayCount(snapshot&&(
        snapshot.restaurantV3||snapshot.restaurant||snapshot.restaurantData
      )),
      accommodationData:nestedArrayCount(snapshot&&(
        snapshot.accommodationV3||snapshot.accommodation||
        snapshot.accommodationData
      )),
      airConditioningData:nestedArrayCount(snapshot&&(
        snapshot.airConditioningV3||snapshot.airConditioning||
        snapshot.airConditioningData
      )),
      accounts:arrayCount(accounts)||nestedArrayCount(accounts),
      financialCollections:nestedArrayCount(financial)
    };
  }
  function snapshotShapeValid(snapshot){
    if(!object(snapshot)||['active','completed'].indexOf(snapshot.status)<0||
      !object(snapshot.peopleDb)||!Array.isArray(snapshot.peopleDb.people)||
      snapshot.houses!==undefined&&!Array.isArray(snapshot.houses)||
      snapshot.transports!==undefined&&!Array.isArray(snapshot.transports)||
      snapshot.activityLog!==undefined&&!Array.isArray(snapshot.activityLog)){
      return false;
    }
    return (snapshot.houses||[]).every(function(house){
      return object(house)&&Array.isArray(house.floors)&&
        house.floors.every(function(floor){
          return object(floor)&&Array.isArray(floor.rooms);
        });
    });
  }
  function materializedShapeValid(snapshot){
    return snapshotShapeValid(snapshot)&&Array.isArray(snapshot.houses)&&
      Array.isArray(snapshot.transports)&&Array.isArray(snapshot.activityLog);
  }
  function sameCounts(left,right){
    if(!object(left)||!object(right))return false;
    return Object.keys(snapshotCounts({})).every(function(key){
      return Number(left[key]||0)===Number(right[key]||0);
    });
  }
  function trustedMaterializationState(link,revision){
    var state=link&&object(link.syncState)?link.syncState:null;
    var trusted=!!(state&&
      state.materializationStatus==='verified'&&
      state.materializationSource==='downloaded'&&
      Number.isInteger(state.downloadedSnapshotRevision)&&
      state.downloadedSnapshotRevision===revision&&
      Number.isInteger(state.materializedSnapshotRevision)&&
      state.materializedSnapshotRevision===revision&&
      object(state.downloadedSnapshotCounts)&&
      object(state.materializedSnapshotCounts)&&
      sameCounts(
        state.downloadedSnapshotCounts,
        state.materializedSnapshotCounts
      )&&
      typeof state.materializationVerifiedAt==='string'&&
      state.materializationVerifiedAt.trim());
    return {trusted:trusted,state:state};
  }
  function localMaterialization(link,localConference,revision){
    var counts=snapshotCounts(localConference);
    var provenance=trustedMaterializationState(link,revision);
    var expected=provenance.trusted
      ?provenance.state.materializedSnapshotCounts
      :null;
    var shapeValid=materializedShapeValid(localConference);
    return {
      complete:shapeValid&&provenance.trusted&&
        sameCounts(counts,expected),
      shapeValid:shapeValid,
      verified:provenance.trusted,
      provenanceTrusted:provenance.trusted,
      counts:counts
    };
  }
  function verifiedMaterializationState(previous,revision,counts){
    return Object.assign({},object(previous)?previous:{},{
      pendingLocalChanges:false,
      lastRemoteApplyStatus:'applied',
      lastRemoteApplyAt:new Date().toISOString(),
      lastDownloadedRevision:revision,
      downloadedSnapshotRevision:revision,
      downloadedSnapshotCounts:copy(counts),
      materializedSnapshotRevision:revision,
      materializedSnapshotCounts:copy(counts),
      materializationVerifiedAt:new Date().toISOString(),
      materializationStatus:'verified',
      materializationSource:'downloaded'
    });
  }
  function activateUpToDateMaterialization(d,data,localConferenceId,details){
    traceLinkedRefresh('resolve_persisted_conference','entered',null);
    var resolved=conference(data,localConferenceId);
    if(!resolved||!materializedShapeValid(resolved)){
      diagnosticState.currentConferenceResolved=false;
      diagnosticState.settingsConferenceResolved=false;
      diagnosticState.lastActivationStatus='current_conference_unresolved';
      traceLinkedRefresh('resolve_persisted_conference','return',
        'current_conference_unresolved');
      return result(false,'current_conference_unresolved');
    }
    traceLinkedRefresh('resolve_persisted_conference','completed',null);
    var previousMemory=copy(d.getData());
    var activeData=copy(data);
    activeData.currentConferenceId=localConferenceId;
    traceLinkedRefresh('apply_runtime','entered',null);
    d.applyData(activeData);
    traceLinkedRefresh('apply_runtime','completed',null);
    diagnosticState.currentConferenceResolved=true;
    var activated=false;
    try{
      diagnosticState.activationReached=true;
      traceLinkedRefresh('activate_persisted_conference','entered',null);
      activated=typeof d.activate==='function'&&
        d.activate(localConferenceId,{
          alreadyPersisted:true,accessRole:details&&details.role||null
        })===true;
      traceLinkedRefresh('render','completed',activated?null:'activation_returned_false');
    }catch(error){
      traceLinkedRefresh('activate_persisted_conference','exception',
        error&&error.name||'Error');
      activated=false;
    }
    if(!activated){
      d.applyData(previousMemory);
      diagnosticState.currentConferenceResolved=false;
      diagnosticState.settingsConferenceResolved=false;
      diagnosticState.lastActivationStatus='runtime_activation_failed';
      traceLinkedRefresh('activate_persisted_conference','return',
        'runtime_activation_failed');
      return result(false,'runtime_activation_failed');
    }
    traceLinkedRefresh('activate_persisted_conference','completed',null);
    traceLinkedRefresh('resolve_settings','entered',null);
    var activationDiagnostics=
      typeof global.getMemberActivationDiagnostics==='function'
        ?global.getMemberActivationDiagnostics():null;
    diagnosticState.settingsConferenceResolved=activationDiagnostics&&
      Object.prototype.hasOwnProperty.call(
        activationDiagnostics,'settingsResolved'
      )?activationDiagnostics.settingsResolved===true:true;
    traceLinkedRefresh('resolve_settings','completed',null);
    diagnosticState.lastActivationStatus='activated';
    traceLinkedRefresh('completed','return','up_to_date');
    return result(true,'up_to_date',details);
  }
  function replaceConferenceSnapshot(data,localConferenceId,snapshot){
    var next=copy(data);
    next.conferences=Array.isArray(next.conferences)
      ?next.conferences.slice()
      :[];
    var index=-1;
    for(var cursor=0;cursor<next.conferences.length;cursor++){
      if(next.conferences[cursor]&&
        String(next.conferences[cursor].id)===String(localConferenceId)){
        index=cursor;
        break;
      }
    }
    if(index<0)return null;
    var mapped=copy(snapshot);
    mapped.id=String(localConferenceId);
    next.conferences[index]=mapped;
    return next;
  }
  function refreshExistingLinkedLocal(d,previous,identity,ctx){
    if(!identity.existing||!conference(previous,identity.id)||
      ['linked','cloud_linked'].indexOf(identity.existing.linkStatus)<0){
      return Promise.resolve(null);
    }
    var incomingRevision=ctx.snapshot&&ctx.snapshot.data&&ctx.snapshot.data.revision;
    var knownRevision=Number(identity.existing.knownRevision);
    if(!Number.isInteger(incomingRevision)||incomingRevision<1||
      !Number.isInteger(knownRevision)||incomingRevision<knownRevision||
      incomingRevision===knownRevision&&ctx.repairLocalMaterialization!==true){
      diagnostic('linked_refresh','up_to_date',{
        refreshed:false,
        downloadedRevision:Number.isInteger(incomingRevision)
          ?incomingRevision
          :null,
        knownRevision:Number.isInteger(knownRevision)
          ?knownRevision
          :null
      });
      var linkedData=markCloudLinkedLifecycle(previous,identity.id);
      if(!linkedData)return Promise.resolve(result(false,'link_recovery_required'));
      var previousLifecycle=lifecycle(previous,identity.id);
      var lifecyclePromise=previousLifecycle&&
        previousLifecycle.cloudLifecycle==='cloud_linked'
        ?Promise.resolve(result(true,'persisted',{value:previous}))
        :persistGuarded(
          d,linkedData,ctx,'linked_lifecycle_persistence_failed',previous
        );
      return lifecyclePromise.then(function(savedLifecycle){
        if(!savedLifecycle.ok)return savedLifecycle;
        return {
        noop:true,
        status:'up_to_date',
        reused:true,
        refreshed:false,
        data:savedLifecycle.data.value,
        localId:identity.id,
        link:identity.existing,
        revision:Number.isInteger(knownRevision)?knownRevision:null
        };
      });
    }
    var existingConference=conference(previous,identity.id);
    var incomingSnapshot=ctx.snapshot&&ctx.snapshot.data
      ?ctx.snapshot.data.snapshot
      :null;
    if(existingConference&&incomingSnapshot){
      var existingCounts=snapshotCounts(existingConference);
      var incomingCounts=snapshotCounts(incomingSnapshot);
      var destructiveZeroDrop=existingCounts.conferencePeopleDb>0&&
        incomingCounts.conferencePeopleDb===0&&
        existingCounts.transports>0&&incomingCounts.transports===0;
      if(destructiveZeroDrop){
        return Promise.resolve(result(false,'remote_update_review_required',{
          localConferenceId:identity.id,
          remoteConferenceId:ctx.remoteId,
          revision:incomingRevision
        }));
      }
    }
    var replaced=replaceConferenceSnapshot(
      previous,
      identity.id,
      ctx.snapshot.data.snapshot
    );
    if(!replaced)return Promise.resolve(result(false,'link_recovery_required'));
    var normalized=d.normalize(replaced);
    normalized=markCloudLinkedLifecycle(normalized,identity.id);
    if(!normalized)return Promise.resolve(result(false,'link_recovery_required'));
    var normalizedConference=conference(normalized,identity.id);
    if(!normalizedConference)return Promise.resolve(result(false,'snapshot_malformed'));
    var normalizedCounts=snapshotCounts(normalizedConference);
    diagnosticState.materializedCounts=copy(normalizedCounts);
    diagnosticState.lastMaterializationStatus=materializedShapeValid(
      normalizedConference
    )?'complete':'incomplete';
    if(!materializedShapeValid(normalizedConference)){
      return Promise.resolve(result(false,'snapshot_malformed'));
    }
    return persistGuarded(
      d,
      normalized,
      ctx,
      'linked_refresh_persistence_failed',
      previous
    ).then(function(saved){
      if(!saved.ok)return saved;
      var verified=saved.data.value;
      var verifiedConference=conference(verified,identity.id);
      if(!verifiedConference)return result(false,'linked_refresh_persistence_failed');
      var verifiedCounts=snapshotCounts(verifiedConference);
      diagnosticState.persistedCounts=copy(verifiedCounts);
      diagnosticState.readAfterWriteCounts=copy(verifiedCounts);
      var sameCounts=Object.keys(normalizedCounts).every(function(key){
        return normalizedCounts[key]===verifiedCounts[key];
      });
      if(!sameCounts||!materializedShapeValid(verifiedConference)){
        diagnosticState.lastMaterializationStatus='verification_failed';
        return result(false,'linked_refresh_verification_failed');
      }
      var linkInput=Object.assign({},identity.existing,{
        localConferenceId:identity.id,
        remoteConferenceId:ctx.remoteId,
        knownRevision:incomingRevision,
        actualRevision:null,
        linkStatus:'linked',
        pendingLocalApplication:false,
        conflictId:null,
        conflictStatus:null,
        resolutionStrategy:null,
        resolutionOperationId:null,
        resolvedRevision:null,
        syncState:verifiedMaterializationState(
          identity.existing.syncState,
          incomingRevision,
          verifiedCounts
        )
      });
      var linked=saveLinkGuarded(
        d,
        linkInput,
        ctx,
        'linked_refresh_link_failed'
      );
      if(!linked.ok)return linked;
      diagnosticState.knownRevisionAfter=incomingRevision;
      diagnosticState.currentConferenceContentComplete=true;
      diagnosticState.localMaterializedRevision=incomingRevision;
      diagnosticState.materializationTrusted=true;
      diagnosticState.materializationComplete=true;
      diagnosticState.lastMaterializationStatus='verified';
      diagnostic('linked_refresh','applied',{
        refreshed:true,
        downloadedRevision:incomingRevision,
        knownRevision:knownRevision,
        counts:verifiedCounts
      });
      return {
        reused:true,
        refreshed:true,
        data:verified,
        localId:identity.id,
        link:linked.data.link,
        revision:incomingRevision,
        counts:verifiedCounts
      };
    });
  }
  function localId(d,data,snapshot,remoteId){
    var exact=d.links.findByRemoteId(remoteId);
    if(exact)return {id:exact.localConferenceId,existing:exact};
    var proposed=String(snapshot&&snapshot.id||'');
    var used=function(id){
      var records=recoveryRoot(data);
      var reserved=Object.keys(records).some(function(key){
        return key!==remoteId&&records[key]&&
          String(records[key].localConferenceId)===String(id);
      });
      return !!conference(data,id)||!!d.links.get(id)||reserved;
    };
    if(proposed&&!used(proposed))return {id:proposed,existing:null};
    var generated='';
    do{generated=String(d.makeId());}while(!generated||used(generated));
    return {id:generated,existing:null};
  }
  function validateAccess(d,remoteId){
    return Promise.all([
      d.device.getStatus(),
      d.systemAccess.refresh(),
      d.remote.listAvailableConferences(),
      d.members.getCurrentAccess({remoteConferenceId:remoteId})
    ]).then(function(values){
      var deviceData=values[0]&&values[0].data||{};
      var system=values[1]||{};
      var available=values[2]&&values[2].ok&&values[2].data&&
        Array.isArray(values[2].data.conferences)?values[2].data.conferences:[];
      var listing=available.find(function(item){return item&&String(item.id)===remoteId;});
      var access=values[3];
      var role=String(access&&access.data&&access.data.role||'');
      if(!values[0]||!values[0].ok||
        String(deviceData.deviceAuthorizationStatus||'')!=='approved'){
        return result(false,'device_not_approved');
      }
      if(system.source!=='server'||system.fresh!==true||
        system.authenticated!==true||system.accountStatus!=='approved'){
        return result(false,'account_not_approved');
      }
      if(!listing||listing.deletedAt){return result(false,'conference_unavailable');}
      if(!access||!access.ok||access.status!=='available'||ROLES.indexOf(role)<0){
        return result(false,'membership_unavailable');
      }
      return result(true,'authorized',{listing:listing,role:role});
    });
  }
  function snapshotFor(d,remoteId,account){
    return d.remote.inspectInitialSnapshot(remoteId).then(function(inspected){
      if(!inspected||!inspected.ok||inspected.status!=='found'){
        return result(false,'snapshot_unavailable');
      }
      if(String(inspected.data&&inspected.data.schemaVersion||'')!=='1'||
        !String(inspected.data&&inspected.data.appVersion||'').trim()||
        !Number.isInteger(inspected.data&&inspected.data.revision)||
        inspected.data.revision<1){
        return result(false,'snapshot_unsupported');
      }
      var cached=d.discovery&&d.discovery.getRecord
        ?d.discovery.getRecord(remoteId):null;
      if(cached&&cached.authenticatedUserId===account&&
        cached.remoteConferenceId===remoteId&&
        cached.revision===inspected.data.revision&&cached.conference){
        diagnosticState.latestCloudRevision=inspected.data.revision;
        diagnosticState.requestedRevision=inspected.data.revision;
        diagnosticState.downloadedRevision=inspected.data.revision;
        diagnosticState.extractedSnapshotValid=snapshotShapeValid(
          cached.conference
        );
        diagnosticState.downloadedCounts=snapshotCounts(cached.conference);
        if(!diagnosticState.extractedSnapshotValid){
          return result(false,'snapshot_malformed');
        }
        return result(true,'snapshot_reused',{
          snapshot:copy(cached.conference),revision:inspected.data.revision,
          schemaVersion:inspected.data.schemaVersion||cached.schemaVersion||null,
          appVersion:inspected.data.appVersion||cached.appVersion||null
        });
      }
      return d.remote.downloadSnapshot(remoteId).then(function(downloaded){
        if(!downloaded||!downloaded.ok||downloaded.status!=='downloaded'||
          !downloaded.data||!downloaded.data.snapshot){
          return result(false,'snapshot_unavailable');
        }
        if(String(downloaded.data.schemaVersion||'')!=='1'||
          !String(downloaded.data.appVersion||'').trim()||
          !Number.isInteger(downloaded.data.revision)||
          downloaded.data.revision<1||
          typeof downloaded.data.snapshot!=='object'||
          Array.isArray(downloaded.data.snapshot)||
          ['active','completed'].indexOf(downloaded.data.snapshot.status)<0){
          return result(false,'snapshot_malformed');
        }
        diagnosticState.latestCloudRevision=inspected.data.revision;
        diagnosticState.requestedRevision=inspected.data.revision;
        diagnosticState.downloadedRevision=downloaded.data.revision;
        diagnosticState.extractedSnapshotValid=snapshotShapeValid(
          downloaded.data.snapshot
        );
        diagnosticState.downloadedCounts=snapshotCounts(
          downloaded.data.snapshot
        );
        if(!diagnosticState.extractedSnapshotValid){
          return result(false,'snapshot_malformed');
        }
        return result(true,'snapshot_downloaded',{
          snapshot:copy(downloaded.data.snapshot),revision:downloaded.data.revision,
          schemaVersion:downloaded.data.schemaVersion||null,
          appVersion:downloaded.data.appVersion||null
        });
      });
    });
  }
  function inspectSnapshotMetadata(d,remoteId){
    diagnosticState.metadataRequestReached=true;
    traceLinkedRefresh('metadata_request','entered',null);
    return Promise.resolve(d.remote.inspectInitialSnapshot(remoteId))
      .then(function(inspected){
        traceLinkedRefresh('metadata_received','reached',
          inspected&&inspected.status||'no_result');
        if(!inspected||!inspected.ok||inspected.status!=='found'){
          return result(false,'snapshot_unavailable');
        }
        if(String(inspected.data&&inspected.data.schemaVersion||'')!=='1'||
          !String(inspected.data&&inspected.data.appVersion||'').trim()||
          !Number.isInteger(inspected.data&&inspected.data.revision)||
          inspected.data.revision<1){
          return result(false,'snapshot_unsupported');
        }
        diagnosticState.latestCloudRevision=inspected.data.revision;
        return result(true,'snapshot_inspected',{
          revision:inspected.data.revision,
          schemaVersion:String(inspected.data.schemaVersion),
          appVersion:String(inspected.data.appVersion)
        });
      }).catch(function(){
        traceLinkedRefresh('metadata_request','return','snapshot_unavailable');
        return result(false,'snapshot_unavailable');
      });
  }
  function downloadSnapshotForRevision(d,remoteId,account,metadata){
    diagnosticState.downloadRequestReached=true;
    diagnosticState.requestedRevision=metadata.revision;
    var cached=d.discovery&&d.discovery.getRecord
      ?d.discovery.getRecord(remoteId)
      :null;
    if(cached&&cached.authenticatedUserId===account&&
      cached.remoteConferenceId===remoteId&&
      cached.revision===metadata.revision&&cached.conference){
      var cachedCounts=snapshotCounts(cached.conference);
      diagnosticState.downloadedRevision=metadata.revision;
      diagnosticState.extractedSnapshotValid=snapshotShapeValid(
        cached.conference
      );
      diagnosticState.downloadedCounts=copy(cachedCounts);
      if(!diagnosticState.extractedSnapshotValid){
        return Promise.resolve(result(false,'snapshot_malformed'));
      }
      traceRealtimePipeline('SNAPSHOT_DOWNLOADED',{
        revision:metadata.revision,
        source:'cache'
      });
      return Promise.resolve(result(true,'snapshot_reused',{
        snapshot:copy(cached.conference),
        revision:metadata.revision,
        schemaVersion:metadata.schemaVersion,
        appVersion:metadata.appVersion
      }));
    }
    return Promise.resolve(d.remote.downloadSnapshot(remoteId))
      .then(function(downloaded){
        if(!downloaded||!downloaded.ok||downloaded.status!=='downloaded' ||
          !downloaded.data||!downloaded.data.snapshot){
          return result(false,'snapshot_unavailable');
        }
        if(downloaded.data.revision!==metadata.revision||
          String(downloaded.data.schemaVersion||'')!=='1'||
          !String(downloaded.data.appVersion||'').trim()||
          typeof downloaded.data.snapshot!=='object'||
          Array.isArray(downloaded.data.snapshot)||
          ['active','completed'].indexOf(downloaded.data.snapshot.status)<0){
          return result(false,'snapshot_malformed');
        }
        diagnosticState.downloadedRevision=downloaded.data.revision;
        diagnosticState.extractedSnapshotValid=snapshotShapeValid(
          downloaded.data.snapshot
        );
        diagnosticState.downloadedCounts=snapshotCounts(
          downloaded.data.snapshot
        );
        if(!diagnosticState.extractedSnapshotValid){
          return result(false,'snapshot_malformed');
        }
        traceRealtimePipeline('SNAPSHOT_DOWNLOADED',{
          revision:downloaded.data.revision,
          source:'remote'
        });
        return result(true,'snapshot_downloaded',{
          snapshot:copy(downloaded.data.snapshot),
          revision:downloaded.data.revision,
          schemaVersion:String(downloaded.data.schemaVersion),
          appVersion:String(downloaded.data.appVersion)
        });
      }).catch(function(){
        return result(false,'snapshot_unavailable');
      });
  }
  function exactRecovery(data,remoteId,account){
    var record=recoveryRoot(data)[remoteId];
    if(!record)return null;
    return record.authenticatedUserId===account?record:{foreign:true};
  }
  function cleanupStaged(d,data,recovery,remoteId,ctx,status){
    var link=d.links.get(recovery.localConferenceId);
    if(link&&link.remoteConferenceId===remoteId&&
      link.linkStatus==='server_selected_pending_local_apply'){
      var removed=removeLinkGuarded(
        d,recovery.localConferenceId,ctx,'pending_link_cleanup_failed'
      );
      if(!removed.ok)return Promise.resolve(removed);
    }else if(link){
      return Promise.resolve(result(false,'usable_link_cleanup_denied'));
    }
    var next=copy(data);
    next.conferences=(next.conferences||[]).filter(function(item){
      return !item||String(item.id)!==String(recovery.localConferenceId);
    });
    delete recoveryRoot(next)[remoteId];
    return persistGuarded(d,next,ctx,'recovery_cleanup_failed',data)
      .then(function(saved){
        if(!saved.ok)return saved;
        return exactRecovery(saved.data.value,remoteId,ctx.account)||
          conference(saved.data.value,recovery.localConferenceId)
          ?result(false,'recovery_cleanup_unverified')
          :result(false,status);
      });
  }
  function runTransaction(ctx){
    var d=ctx.d,remoteId=ctx.remoteId,account=ctx.account,token=ctx.token;
    return read(d).then(function(stored){
      if(!alive(token,d,account,ctx.client))return result(false,'stale');
      if(restoreIsolationPending(d,ctx.options)){
        return result(false,'restore_isolated');
      }
      var previous=copy(stored||d.getData());
      var recovery=exactRecovery(previous,remoteId,account);
      if(recovery&&recovery.foreign)return result(false,'foreign_recovery');
      var identity=localId(d,previous,ctx.snapshot.data.snapshot,remoteId);
      if(ctx.forceLocalConferenceId&&
        String(ctx.forceLocalConferenceId)!==String(identity.id)){
        return result(false,'link_recovery_required');
      }
      ctx.localConferenceId=identity.id;
      if(manualRelinkPending(d,identity.id,ctx.options)){
        return result(false,'manual_relink_required');
      }
      if(identity.existing&&!conference(previous,identity.id)&&
        (!recovery||String(recovery.localConferenceId)!==String(identity.id))){
        return result(false,'link_recovery_required');
      }
      var refreshContext={
        d:d,
        remoteId:remoteId,
        account:account,
        client:ctx.client,
        token:token,
        localConferenceId:identity.id,
        options:ctx.options,
        snapshot:ctx.snapshot,
        repairLocalMaterialization:ctx.repairLocalMaterialization===true
      };
      return refreshExistingLinkedLocal(
        d,
        previous,
        identity,
        refreshContext
      ).then(function(refreshedReuse){
        if(refreshedReuse&&refreshedReuse.ok===false)return refreshedReuse;
        if(refreshedReuse)return refreshedReuse;
        if(recovery&&recovery.revision!==ctx.snapshot.data.revision){
          return cleanupStaged(
            d,previous,recovery,remoteId,ctx,'recovery_cleaned_revision_changed'
          );
        }
        var local=copy(recovery?recovery.snapshot:ctx.snapshot.data.snapshot);
        local.id=recovery&&recovery.localConferenceId||identity.id;
        var normalizedBase=copy(previous);
        if(conference(normalizedBase,local.id)){
          normalizedBase=replaceConferenceSnapshot(
            normalizedBase,
            local.id,
            local
          );
        }else{
          normalizedBase.conferences=(normalizedBase.conferences||[]).concat([local]);
        }
        var normalized=d.normalize(normalizedBase);
        var normalizedConference=conference(normalized,local.id);
        if(!normalizedConference)return result(false,'snapshot_malformed');
        var normalizedCounts=snapshotCounts(normalizedConference);
        diagnosticState.materializedCounts=copy(normalizedCounts);
        diagnosticState.lastMaterializationStatus=materializedShapeValid(
          normalizedConference
        )?'complete':'incomplete';
        if(!materializedShapeValid(normalizedConference)){
          return result(false,'snapshot_malformed');
        }
        if(!recovery){
          var added=d.repository&&typeof d.repository.addLocalConference==='function'
            ?d.repository.addLocalConference(previous,normalizedConference):null;
          if(!added||!added.ok){
            var rejection=repositoryRejectionDetails(d.repository,added);
            diagnosticState.repositoryRejectionStatus=rejection.status;
            diagnosticState.repositoryRejectionIssueCodes=
              rejection.issueCodes.slice();
            diagnosticState.repositoryVersion=rejection.repositoryVersion;
            diagnostic('local_repository','rejected',rejection);
            return result(false,'local_repository_rejected',rejection);
          }
          normalized=added.data;
        }
        var stagePromise;
        if(recovery){
          stagePromise=Promise.resolve(result(true,'persisted',{value:previous}));
        }else{
          var staged=copy(previous),root=recoveryRoot(staged);
          root[remoteId]={
            remoteConferenceId:remoteId,localConferenceId:local.id,
            revision:ctx.snapshot.data.revision,
            schemaVersion:ctx.snapshot.data.schemaVersion||null,
            authenticatedUserId:account,status:'normalized_persisted',
            snapshot:copy(normalizedConference)
          };
          stagePromise=persistGuarded(
            d,staged,ctx,'recovery_persistence_failed',previous
          );
        }
        return stagePromise.then(function(stageResult){
          if(!stageResult.ok)return stageResult;
          var verifiedStage=stageResult.data.value;
          var verified=exactRecovery(verifiedStage,remoteId,account);
          if(!verified||verified.foreign||verified.localConferenceId!==local.id){
            return result(false,'recovery_persistence_failed');
          }
          var pendingInput={
            localConferenceId:local.id,remoteConferenceId:remoteId,
            knownRevision:ctx.snapshot.data.revision,
            linkStatus:'server_selected_pending_local_apply',
            pendingLocalApplication:true
          };
          var pendingRead=d.links.get(local.id);
          var pending=linkMatches(pendingRead,pendingInput)
            ?result(true,'already_pending',{link:pendingRead})
            :saveLinkGuarded(d,pendingInput,ctx,'pending_link_failed');
          if(!pending.ok)return pending;
          var promoted=copy(normalized);
          promoted=markCloudLinkedLifecycle(promoted,local.id);
          if(!promoted)return result(false,'local_repository_rejected');
          promoted.conferenceImportRecovery=copy(
            verifiedStage.conferenceImportRecovery||{}
          );
          var promotionPromise=persistGuarded(
            d,promoted,ctx,'promotion_persistence_failed',verifiedStage
          );
          return promotionPromise.then(function(promotionResult){
            if(!promotionResult.ok)return promotionResult;
            var verifiedPromotion=promotionResult.data.value;
            if(!conference(verifiedPromotion,local.id)||
              !exactRecovery(verifiedPromotion,remoteId,account)){
              return result(false,'promotion_persistence_failed');
            }
            var linked=saveLinkGuarded(d,{
              localConferenceId:local.id,remoteConferenceId:remoteId,
              knownRevision:ctx.snapshot.data.revision,linkStatus:'linked',
              pendingLocalApplication:false,
              syncState:{
                pendingLocalChanges:false,
                lastRemoteApplyStatus:'applied',
                lastRemoteApplyAt:new Date().toISOString(),
                lastDownloadedRevision:ctx.snapshot.data.revision
              }
            },ctx,'link_finalization_failed');
            if(!linked.ok)return linked;
            var finalLink=linked.data.link;
            var cleaned=copy(verifiedPromotion);
            delete recoveryRoot(cleaned)[remoteId];
            return persistGuarded(
              d,cleaned,ctx,'recovery_cleanup_failed',verifiedPromotion
            ).then(function(cleanupResult){
              if(!cleanupResult.ok){
                var compensated=compensatePendingLink(d,pendingInput);
                return compensated.ok?cleanupResult:compensated;
              }
              var verifiedCleanup=cleanupResult.data.value;
              if(exactRecovery(verifiedCleanup,remoteId,account)){
                var compensation=compensatePendingLink(d,pendingInput);
                return compensation.ok
                  ?result(false,'recovery_cleanup_unverified')
                  :compensation;
              }
              var persistedConference=conference(verifiedCleanup,local.id);
              var persistedCounts=snapshotCounts(persistedConference);
              diagnosticState.persistedCounts=copy(persistedCounts);
              diagnosticState.readAfterWriteCounts=copy(persistedCounts);
              if(!materializedShapeValid(persistedConference)||
                !sameCounts(normalizedCounts,persistedCounts)){
                diagnosticState.lastMaterializationStatus='verification_failed';
                return result(false,'promotion_persistence_failed');
              }
              var trustedLink=saveLinkGuarded(d,Object.assign({},finalLink,{
                syncState:verifiedMaterializationState(
                  finalLink.syncState,
                  ctx.snapshot.data.revision,
                  persistedCounts
                )
              }),ctx,'link_finalization_failed');
              if(!trustedLink.ok)return trustedLink;
              finalLink=trustedLink.data.link;
              diagnosticState.lastMaterializationStatus='verified';
              diagnosticState.currentConferenceContentComplete=true;
              diagnosticState.localMaterializedRevision=
                ctx.snapshot.data.revision;
              diagnosticState.materializationTrusted=true;
              diagnosticState.materializationComplete=true;
              diagnosticState.knownRevisionAfter=ctx.snapshot.data.revision;
              return {data:verifiedCleanup,localId:local.id,link:finalLink};
            });
          });
        });
      });
    }).then(function(prepared){
      if(prepared&&prepared.ok===false)return prepared;
      if(ctx.refreshOnly===true){
        if(prepared&&prepared.noop===true){
          return activateUpToDateMaterialization(d,prepared.data,
            prepared.localId,{
            localConferenceId:prepared.localId,
            remoteConferenceId:remoteId,
            role:ctx.role,
            revision:prepared.revision
          });
        }
        var refreshBlocked=guardStatus(d,prepared.localId,ctx.options);
        if(refreshBlocked)return result(false,refreshBlocked);
        var refreshedData=copy(prepared.data);
        var shouldSelect=!refreshedData.currentConferenceId;
        if(shouldSelect)refreshedData.currentConferenceId=prepared.localId;
        var selectionPromise=shouldSelect
          ?persistGuarded(
            d,refreshedData,ctx,'activation_persistence_failed',prepared.data
          )
          :Promise.resolve(result(true,'persisted',{value:refreshedData}));
        return selectionPromise.then(function(selection){
          if(!selection.ok)return selection;
          var selectedData=selection.data.value;
          var selectedConference=conference(selectedData,prepared.localId);
          if(!selectedConference||!materializedShapeValid(selectedConference)){
            return result(false,'activation_persistence_failed');
          }
          var previousRefreshMemory=copy(d.getData());
          var contextBefore=d.integration&&
            typeof d.integration.getConferenceSyncState==='function'
            ?d.integration.getConferenceSyncState(prepared.localId)
            :null;
          diagnosticState.contextBaseRevisionBefore=contextBefore&&
            contextBefore.context&&
            Number.isInteger(contextBefore.context.baseRevision)
            ?contextBefore.context.baseRevision:null;
          traceRealtimePipeline('LOCAL_APPLY_STARTED',{
            revision:prepared.link.knownRevision
          });
          d.applyData(copy(selectedData));
          var refreshConfigured=d.integration&&
            typeof d.integration.configureConferenceSync==='function'
            ?d.integration.configureConferenceSync(prepared.localId,{
              conferenceId:remoteId,
              baseRevision:prepared.link.knownRevision,
              schemaVersion:String(ctx.snapshot.data.schemaVersion),
              appVersion:String(ctx.snapshot.data.appVersion)
            })
            :null;
          if(!refreshConfigured||refreshConfigured.ok===false){
            d.applyData(previousRefreshMemory);
            diagnosticState.lastActivationStatus='sync_configuration_failed';
            return result(false,'sync_configuration_failed');
          }
          diagnosticState.contextBaseRevisionAfter=prepared.link.knownRevision;
          var currentSelected=String(selectedData.currentConferenceId||'')===
            String(prepared.localId);
          var activated=true;
          if(currentSelected){
            try{
              diagnosticState.activationReached=true;
              activated=typeof d.activate==='function'&&
                d.activate(prepared.localId,{
                  alreadyPersisted:true,accessRole:ctx.role||null
                })===true;
            }catch(error){activated=false;}
          }
          if(!activated){
            d.applyData(previousRefreshMemory);
            diagnosticState.lastActivationStatus='runtime_activation_failed';
            return result(false,'runtime_activation_failed');
          }
          diagnosticState.currentConferenceResolved=currentSelected;
          diagnosticState.settingsConferenceResolved=currentSelected;
          diagnosticState.lastActivationStatus=currentSelected
            ?'activated':'preserved_other_current';
          traceRealtimePipeline('LOCAL_APPLY_COMPLETED',{
            revision:prepared.link.knownRevision,
            appDataUpdated:true,
            renderRefreshInvoked:currentSelected&&activated
          });
          return result(true,'opened',{
            localConferenceId:prepared.localId,
            remoteConferenceId:remoteId,
            role:ctx.role,
            revision:prepared.link.knownRevision
          });
        });
      }
      var activated=copy(prepared.data);
      activated.currentConferenceId=prepared.localId;
      return persistGuarded(
        d,activated,ctx,'activation_persistence_failed',prepared.data
      ).then(function(currentResult){
        if(!currentResult.ok)return currentResult;
        var verified=currentResult.data.value;
        if(verified.currentConferenceId!==prepared.localId||
          !conference(verified,prepared.localId)){
          return result(false,'activation_persistence_failed');
        }
        var previousMemory=copy(d.getData());
        var blocked=guardStatus(d,prepared.localId,ctx.options);
        if(blocked)return result(false,blocked);
        d.applyData(copy(verified));
        var configured=d.integration&&
          typeof d.integration.configureConferenceSync==='function'
          ?d.integration.configureConferenceSync(prepared.localId,{
            conferenceId:remoteId,baseRevision:prepared.link.knownRevision,
            schemaVersion:String(ctx.snapshot.data.schemaVersion),
            appVersion:String(ctx.snapshot.data.appVersion)
          }):null;
        if(!configured||configured.ok===false){
          d.applyData(previousMemory);
          diagnosticState.lastActivationStatus='sync_configuration_failed';
          return persistGuarded(
            d,prepared.data,ctx,'activation_rollback_failed',prepared.data
          ).then(function(){return result(false,'sync_configuration_failed');});
        }
        var activationOk=false;
        try{
          diagnosticState.activationReached=true;
          activationOk=typeof d.activate==='function'&&
            d.activate(prepared.localId,{
              alreadyPersisted:true,accessRole:ctx.role||null
            })===true;
        }catch(error){activationOk=false;}
        if(!activationOk){
          d.applyData(previousMemory);
          diagnosticState.lastActivationStatus='runtime_activation_failed';
          return persistGuarded(
            d,prepared.data,ctx,'activation_rollback_failed',prepared.data
          ).then(function(rollback){
            return rollback.ok?result(false,'runtime_activation_failed'):rollback;
          });
        }
        diagnosticState.contextBaseRevisionAfter=prepared.link.knownRevision;
        diagnosticState.currentConferenceResolved=true;
        diagnosticState.settingsConferenceResolved=true;
        diagnosticState.lastActivationStatus='activated';
        return result(true,'opened',{
          localConferenceId:prepared.localId,remoteConferenceId:remoteId,
          role:ctx.role,revision:prepared.link.knownRevision
        });
      });
    });
  }
  function open(remoteConferenceId,options){
    options=options&&typeof options==='object'?options:{};
    remoteConferenceId=String(remoteConferenceId||'');
    if(!remoteConferenceId)return Promise.resolve(result(false,'invalid_remote_id'));
    if(flights[remoteConferenceId])return flights[remoteConferenceId];
    diagnosticState.repositoryRejectionStatus=null;
    diagnosticState.repositoryRejectionIssueCodes=[];
    diagnosticState.repositoryVersion=null;
    var d=deps(options),account=userId(d),activeClient=client(d),token=++generation;
    if(restoreIsolationPending(d,options)){
      return Promise.resolve(result(false,'restore_isolated'));
    }
    var flight=validateAccess(d,remoteConferenceId).then(function(access){
      if(!access.ok||!alive(token,d,account,activeClient))return access.ok?result(false,'stale'):access;
      if(restoreIsolationPending(d,options)){
        return result(false,'restore_isolated');
      }
      return snapshotFor(d,remoteConferenceId,account).then(function(snapshot){
        if(!snapshot.ok||!alive(token,d,account,activeClient))return snapshot.ok?result(false,'stale'):snapshot;
        var task=function(){return runTransaction({d:d,remoteId:remoteConferenceId,
          account:account,client:activeClient,token:token,role:access.data.role,
          snapshot:snapshot,options:options});};
        var serialized=transactionTail.catch(function(){return null;}).then(task);
        transactionTail=serialized.catch(function(){return null;});
        return serialized;
      });
    }).finally(function(){if(flights[remoteConferenceId]===flight)delete flights[remoteConferenceId];});
    flights[remoteConferenceId]=flight;
    return flight;
  }
  function cleanupRecovery(remoteConferenceId,options){
    remoteConferenceId=String(remoteConferenceId||'');
    var d=deps(options),account=userId(d),activeClient=client(d),token=++generation;
    if(!remoteConferenceId||!account||!activeClient){
      return Promise.resolve(result(false,'prerequisites_missing'));
    }
    var task=function(){
      return read(d).then(function(stored){
        if(!alive(token,d,account,activeClient))return result(false,'stale');
        var recovery=exactRecovery(stored,remoteConferenceId,account);
        if(!recovery||recovery.foreign)return result(false,
          recovery&&recovery.foreign?'foreign_recovery':'recovery_not_found');
        return cleanupStaged(
          d,stored,recovery,remoteConferenceId,
          {token:token,account:account,client:activeClient},
          'recovery_cleaned'
        ).then(function(cleaned){
          return cleaned.status==='recovery_cleaned'
            ?result(true,'recovery_cleaned')
            :cleaned;
        });
      });
    };
    var flight=transactionTail.catch(function(){return null;}).then(task);
    transactionTail=flight.catch(function(){return null;});
    return flight;
  }
  function invalidate(){generation++;return result(true,'invalidated');}
  function refreshLinkedLocalConference(localConferenceId,options){
    options=options&&typeof options==='object'?options:{};
    localConferenceId=String(localConferenceId||'');
    if(!localConferenceId){
      return Promise.resolve(result(false,'invalid_local_id'));
    }
    if(refreshFlights[localConferenceId]){
      traceLinkedRefresh('enter','return','existing_refresh_flight');
      return refreshFlights[localConferenceId];
    }
    diagnosticState.linkedRefreshTrace=[];
    diagnosticState.linkedRefreshExceptionStage=null;
    traceLinkedRefresh('enter','entered',null);
    diagnosticState.lastLinkedRefreshAttemptAt=new Date().toISOString();
    diagnosticState.metadataRequestReached=false;
    diagnosticState.downloadRequestReached=false;
    diagnosticState.activationReached=false;
    diagnosticState.lastRefreshStatus='attempting';
    diagnosticState.lastRefreshBlockedReason=null;
    diagnosticState.latestCloudRevision=null;
    diagnosticState.knownRevisionBefore=null;
    diagnosticState.localMaterializedRevision=null;
    diagnosticState.materializationTrusted=false;
    diagnosticState.materializationComplete=false;
    diagnosticState.repositoryRejectionStatus=null;
    diagnosticState.repositoryRejectionIssueCodes=[];
    diagnosticState.repositoryVersion=null;
    diagnosticState.downloadedRevision=null;
    diagnosticState.downloadedCounts=null;
    diagnosticState.materializedCounts=null;
    diagnosticState.persistedCounts=null;
    diagnosticState.readAfterWriteCounts=null;
    diagnosticState.currentConferenceResolved=false;
    diagnosticState.currentConferenceContentComplete=false;
    diagnosticState.settingsConferenceResolved=false;
    var d=deps(options);
    var account=userId(d);
    var activeClient=client(d);
    var token=++generation;
    if(!account||!activeClient){
      traceLinkedRefresh('prerequisites','return','prerequisites_missing');
      return Promise.resolve(traceRefreshResult(
        result(false,'prerequisites_missing')
      ));
    }
    if(restoreIsolationPending(d,options)){
      traceLinkedRefresh('prerequisites','return','restore_isolated');
      return Promise.resolve(traceRefreshResult(result(false,'restore_isolated')));
    }
    var link=d.links&&typeof d.links.get==='function'
      ?d.links.get(localConferenceId)
      :null;
    if(!link||!link.remoteConferenceId||
      ['linked','cloud_linked'].indexOf(link.linkStatus)<0){
      traceLinkedRefresh('linked_conference','return','not_linked');
      return Promise.resolve(traceRefreshResult(result(false,'not_linked')));
    }
    var remoteId=String(link.remoteConferenceId||'');
    diagnosticState.knownRevisionBefore=Number.isInteger(
      Number(link.knownRevision)
    )?Number(link.knownRevision):null;
    diagnosticState.lastRefreshBlockedReason=null;
    var flight=read(d).then(function(stored){
      var initialGuards=evaluateLinkedRefreshGuards(
        d,
        localConferenceId,
        link,
        stored,
        options
      );
      return Promise.resolve(initialGuards).then(function(guarded){
        if(!guarded.ok){
          traceLinkedRefresh('initial_guards','return',guarded.status);
          if(guarded.status==='local_changes_pending'){
            return inspectSnapshotMetadata(d,remoteId).then(function(metadata){
              if(metadata.ok){
                recordRemoteReviewMarker(
                  d,remoteId,metadata.data.revision,options
                );
              }
              diagnosticState.lastRefreshStatus='blocked';
              diagnosticState.lastRefreshBlockedReason='local_changes_pending';
              return result(false,'remote_update_review_required',{
                localConferenceId:localConferenceId,
                remoteConferenceId:remoteId,
                revision:metadata.ok?metadata.data.revision:null
              });
            });
          }
          diagnosticState.lastRefreshStatus='blocked';
          diagnosticState.lastRefreshBlockedReason=guarded.status;
          return guarded;
        }
        return validateAccess(d,remoteId).then(function(access){
      if(!access.ok||!alive(token,d,account,activeClient)){
        return access.ok?result(false,'stale'):access;
      }
          return inspectSnapshotMetadata(d,remoteId).then(function(metadata){
            traceLinkedRefresh('metadata_received',metadata.ok?'completed':'return',
              metadata.status);
            if(!metadata.ok||!alive(token,d,account,activeClient)){
              return metadata.ok?result(false,'stale'):metadata;
            }
            var knownRevision=Number(link.knownRevision);
            var materialization=localMaterialization(
              link,
              conference(stored,localConferenceId),
              knownRevision
            );
            traceLinkedRefresh('trusted_check','completed',
              materialization.complete?'trusted_complete':'repair_required');
            diagnosticState.localMaterializedRevision=
              link.syncState&&Number.isInteger(
                link.syncState.materializedSnapshotRevision
              )?link.syncState.materializedSnapshotRevision:null;
            diagnosticState.materializationTrusted=
              materialization.provenanceTrusted===true;
            diagnosticState.materializationComplete=
              materialization.complete===true;
            diagnosticState.currentConferenceContentComplete=
              materialization.complete;
            if(metadata.data.revision<knownRevision){
              diagnosticState.lastRefreshStatus='revision_regressed';
              diagnosticState.lastRefreshBlockedReason='revision_regressed';
              traceLinkedRefresh('trusted_check','return','revision_regressed');
              return result(false,'revision_regressed');
            }
            if(metadata.data.revision===knownRevision&&
              materialization.complete){
              diagnostic('linked_refresh','up_to_date',{
                refreshed:false,
                downloadedRevision:metadata.data.revision,
                knownRevision:knownRevision
              });
              return activateUpToDateMaterialization(d,stored,
                localConferenceId,{
                localConferenceId:localConferenceId,
                remoteConferenceId:remoteId,
                role:access.data.role,
                revision:knownRevision
              });
            }
            var repairLocalMaterialization=
              metadata.data.revision===knownRevision&&
              !materialization.complete;
            return evaluateLinkedRefreshGuards(
              d,
              localConferenceId,
              link,
              stored,
              options
            ).then(function(preDownloadGuards){
              if(!preDownloadGuards.ok){
                traceLinkedRefresh('pre_download_guards','return',
                  preDownloadGuards.status);
                recordRemoteReviewMarker(
                  d,
                  remoteId,
                  metadata.data.revision,
                  options
                );
                diagnosticState.lastRefreshStatus='blocked';
                diagnosticState.lastRefreshBlockedReason=
                  preDownloadGuards.status;
                return result(
                  false,
                  preDownloadGuards.status==='local_changes_pending'
                    ?'local_changes_pending'
                    :'remote_update_review_required',
                  {
                    localConferenceId:localConferenceId,
                    remoteConferenceId:remoteId,
                    revision:metadata.data.revision
                  }
                );
              }
              return downloadSnapshotForRevision(
                d,
                remoteId,
                account,
                metadata.data
              ).then(function(snapshot){
                if(!snapshot.ok||!alive(token,d,account,activeClient)){
                  return snapshot.ok?result(false,'stale'):snapshot;
                }
        var task=function(){
          return runTransaction({
            d:d,
            remoteId:remoteId,
            account:account,
            client:activeClient,
            token:token,
            role:access.data.role,
            snapshot:snapshot,
            options:options,
            refreshOnly:true,
            repairLocalMaterialization:repairLocalMaterialization,
            forceLocalConferenceId:localConferenceId
          });
        };
        var serialized=transactionTail
          .catch(function(){return null;})
          .then(task);
        transactionTail=serialized.catch(function(){return null;});
        return serialized.then(function(done){
          if(done&&done.ok===true){
            diagnosticState.lastRefreshStatus=done.status;
            diagnosticState.lastRefreshBlockedReason=null;
            diagnostic('linked_refresh','completed',{
              refreshed:done.status==='opened'&&
                Number(done.data&&done.data.revision||0)>
                Number(link.knownRevision||0),
              resultStatus:done.status,
              resultRevision:done.data&&done.data.revision||null
            });
          }
          return done;
        });
              });
            });
          });
        });
      });
    }).then(function(done){
      if(done&&done.ok===false){
        traceRealtimePipeline('LOCAL_APPLY_BLOCKED',{
          reason:done.status||'unknown'
        });
      }
      if(!done||done.status!=='up_to_date'){
        traceLinkedRefresh('completed','return',
          done&&done.status||'no_result');
      }
      return traceRefreshResult(done);
    }).catch(function(error){
      diagnosticState.linkedRefreshExceptionStage=
        diagnosticState.linkedRefreshCurrentStage;
      traceLinkedRefresh(diagnosticState.linkedRefreshCurrentStage,
        'exception',error&&error.name||'Error');
      throw error;
    }).finally(function(){
      if(refreshFlights[localConferenceId]===flight){
        delete refreshFlights[localConferenceId];
      }
    });
    refreshFlights[localConferenceId]=flight;
    return flight;
  }
  global.DiscoveredConferenceOpenService=Object.freeze({
    open:open,
    invalidate:invalidate,
    cleanupRecovery:cleanupRecovery,
    refreshLinkedLocalConference:refreshLinkedLocalConference,
    getDiagnostics:getDiagnostics,
    getState:getState
  });
})(window);
