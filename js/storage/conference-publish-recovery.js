(function(global){
  'use strict';

  var MAX_RETRIES=3;
  var BACKOFF_SECONDS=Object.freeze([5,30,120]);
  var flights=Object.create(null);

  function result(ok,status,data,error,recovery){
    return {
      ok:ok,
      status:status,
      data:data||null,
      error:error||null,
      recovery:recovery||null
    };
  }

  function object(value){
    return !!value&&typeof value==='object'&&!Array.isArray(value);
  }

  function clone(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function uuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function lifecycle(appData,id){
    return appData&&appData.conferenceLifecycle&&
      appData.conferenceLifecycle.records&&
      appData.conferenceLifecycle.records[id]||null;
  }

  function conference(appData,id){
    var conferences=appData&&appData.conferences;
    if(!Array.isArray(conferences))return null;
    for(var index=0;index<conferences.length;index++){
      if(conferences[index]&&conferences[index].id===id){
        return conferences[index];
      }
    }
    return null;
  }

  function dependencies(options){
    options=object(options)?options:{};
    return {
      repository:options.repository||global.ConferenceRepository,
      manager:options.publishManager||global.ConferencePublishManager,
      access:options.systemAccess||global.SystemAccessService,
      auth:options.auth||global.SupabaseAuth,
      remote:options.remote||global.SupabaseSnapshotSync,
      links:options.links||global.ConferenceLinkStore,
      backup:options.backup||global.FullBackupService,
      navigator:options.navigator||global.navigator,
      clock:options.clock||function(){return new Date().toISOString();},
      getCurrentAppData:options.getCurrentAppData||
        function(){return global.appData;},
      applyAppData:options.applyAppData||
        function(value){global.appData=value;},
      persistAppData:options.persistAppData||function(value){
        if(!global.StorageRepository||
          typeof global.StorageRepository.saveAppSnapshot!=='function'){
          return Promise.reject(new Error('PERSISTENCE_UNAVAILABLE'));
        }
        return global.StorageRepository.saveAppSnapshot(value,{
          skipSyncQueue:true
        });
      }
    };
  }

  function sessionUserId(auth){
    var session=auth&&typeof auth.getSession==='function'
      ?auth.getSession():null;
    var state=auth&&typeof auth.getState==='function'
      ?auth.getState():null;
    return String(
      session&&session.user&&session.user.id||
      state&&state.user&&state.user.id||''
    );
  }

  function validAttempt(record,manager){
    var metadata=record&&record.publishMetadata;
    if(!metadata||!uuid(metadata.operationId)||
      !uuid(metadata.requestedCloudId)||
      metadata.publishIntent!=='publish_requested'){
      return false;
    }
    var checked=manager&&
      typeof manager.validateMetadata==='function'
      ?manager.validateMetadata(metadata,record.cloudLifecycle):null;
    return !!(checked&&checked.ok);
  }

  function inspectLinks(d,options){
    if(!d.links||typeof d.links.inspect!=='function'){
      return {ok:false,status:'link_store_unavailable'};
    }
    return d.links.inspect(options&&options.linkOptions);
  }

  function scanCandidates(appData,options){
    var d=dependencies(options);
    if(!object(appData)||!Array.isArray(appData.conferences)){
      return result(false,'app_data_invalid');
    }
    var inspected=inspectLinks(d,options);
    if(!inspected||!inspected.ok){
      return result(false,'conference_link_store_invalid');
    }
    var candidates=[];
    var rejected=[];
    appData.conferences.forEach(function(item){
      var id=item&&String(item.id||'');
      var record=lifecycle(appData,id);
      var link=inspected.data&&inspected.data[id]||null;
      if(!record||record.localLifecycle==='archived')return;
      var eligibleState=[
        'publishing','publish_failed'
      ].indexOf(record.cloudLifecycle)>=0;
      var finalizationPending=link&&
        link.linkStatus==='cloud_linked'&&
        record.cloudLifecycle!=='cloud_linked';
      if(!eligibleState&&!finalizationPending)return;
      if(!validAttempt(record,d.manager)){
        rejected.push({
          localConferenceId:id,
          reason:'invalid_publish_metadata'
        });
        return;
      }
      if(link&&link.remoteConferenceId!==
        record.publishMetadata.requestedCloudId){
        rejected.push({
          localConferenceId:id,
          reason:'cloud_id_mismatch'
        });
        return;
      }
      candidates.push({
        localConferenceId:id,
        operationId:record.publishMetadata.operationId,
        requestedCloudId:record.publishMetadata.requestedCloudId,
        lifecycle:record.cloudLifecycle,
        linkStatus:link&&link.linkStatus||null
      });
    });
    return result(true,'candidates_scanned',{
      candidates:candidates,
      rejected:rejected,
      cloudWritesStarted:false
    });
  }

  function isolationBlocked(d,id,options){
    if(!d.backup)return false;
    var marker=typeof d.backup.getFullRestoreCloudReviewMarker==='function'
      ?d.backup.getFullRestoreCloudReviewMarker({
        storage:options&&options.localStorage
      }):null;
    return !!(marker&&marker.pending)||
      typeof d.backup.isManualRelinkRequired==='function'&&
      d.backup.isManualRelinkRequired(id,{
        storage:options&&options.localStorage
      });
  }

  function freshAccess(d,userId){
    if(!d.access||typeof d.access.refresh!=='function'){
      return Promise.resolve(result(
        false,'authorization_service_unavailable'
      ));
    }
    return Promise.resolve(d.access.refresh()).then(function(access){
      if(!access||access.source!=='server'||access.fresh!==true||
        access.authenticated!==true||access.profileLoaded!==true||
        access.userId!==userId){
        return result(false,'fresh_authorization_required');
      }
      if(access.accountStatus==='blocked'){
        return result(false,'account_blocked',clone(access),null,
          'authorization_required');
      }
      if(access.accountStatus!=='approved'){
        return result(false,'account_pending',clone(access),null,
          'authorization_required');
      }
      return result(true,'access_verified',clone(access));
    }).catch(function(){
      return result(false,'fresh_authorization_required');
    });
  }

  function persist(d,value){
    return Promise.resolve(d.persistAppData(clone(value)))
      .then(function(){
        d.applyAppData(clone(value));
        return value;
      });
  }

  function updateRecovery(appData,id,state,values){
    var next=clone(appData);
    var metadata=next.conferenceLifecycle.records[id].publishMetadata;
    metadata.reconciliationState=state;
    Object.keys(values||{}).forEach(function(key){
      metadata[key]=values[key];
    });
    return next;
  }

  function retryFailure(context,status,error,recovery){
    var current=context.d.getCurrentAppData();
    var base=object(current)&&lifecycle(current,context.id)
      ?current:context.current;
    var metadata=lifecycle(base,context.id).publishMetadata;
    var count=metadata.retryCount+1;
    var exhausted=count>=MAX_RETRIES;
    var seconds=BACKOFF_SECONDS[
      Math.min(count-1,BACKOFF_SECONDS.length-1)
    ];
    var retryAfter=new Date(
      Date.parse(context.d.clock())+seconds*1000
    ).toISOString();
    var next=updateRecovery(
      base,context.id,
      exhausted?'reconciliation_failed':'retryable_same_operation',{
        retryCount:count,
        retryAfter:exhausted?null:retryAfter,
        lastReconciliationAt:context.d.clock(),
        lastPublishStage:'reconciliation_failed',
        lastPublishError:{
          code:String(status),
          stage:'reconciliation',
          remoteCode:error&&error.code||null
        }
      }
    );
    return persist(context.d,next).then(function(){
      context.current=next;
      return result(false,
        exhausted?'retry_limit_reached':status,{
          appData:clone(next),
          operationId:context.metadata.operationId,
          requestedCloudId:context.metadata.requestedCloudId
        },error||null,exhausted
          ?'requires_manual_review'
          :recovery||'safe_to_retry_same_operation');
    }).catch(function(){
      return result(false,'recovery_state_persistence_failed',
        null,null,'requires_manual_review');
    });
  }

  function manualStop(context,status,error){
    var current=context.d.getCurrentAppData();
    var base=object(current)&&lifecycle(current,context.id)
      ?current:context.current;
    var next=updateRecovery(
      base,context.id,'manual_review_required',{
        lastReconciliationAt:context.d.clock(),
        lastPublishStage:status,
        lastPublishError:{
          code:String(status),
          stage:'reconciliation',
          remoteCode:error&&error.code||null
        }
      }
    );
    return persist(context.d,next).then(function(){
      return result(false,status,{appData:clone(next)},error,
        'requires_manual_review');
    }).catch(function(){
      return result(false,'recovery_state_persistence_failed',
        null,null,'requires_manual_review');
    });
  }

  function saveFinalLink(context,revision,contentChanged){
    return context.d.links.save({
      localConferenceId:context.id,
      remoteConferenceId:context.metadata.requestedCloudId,
      remoteName:context.localConference.name,
      knownRevision:revision,
      linkStatus:'cloud_linked',
      initialOperationId:context.metadata.operationId,
      linkedAt:context.d.clock(),
      linkedByUserId:context.userId,
      lastVerifiedAt:context.d.clock(),
      syncState:{
        initialSnapshotComplete:true,
        pendingLocalChanges:contentChanged,
        snapshotContentVersion:
          context.metadata.snapshotContentVersion,
        currentContentVersion:context.currentVersion()
      }
    },context.options&&context.options.linkOptions);
  }

  function finalize(context,revision,snapshotWasUploaded){
    var latest=context.d.getCurrentAppData();
    var base=object(latest)&&lifecycle(latest,context.id)
      ?clone(latest):clone(context.current);
    var contentChanged=context.currentVersion()!==
      context.metadata.snapshotContentVersion;
    var link=saveFinalLink(context,revision,contentChanged);
    if(!link||!link.ok){
      return retryFailure(context,'conference_link_save_failed',
        null,'requires_reconciliation');
    }
    var record=lifecycle(base,context.id);
    record.cloudLifecycle='cloud_linked';
    record.publishMetadata=null;
    return persist(context.d,base).then(function(){
      return result(true,
        contentChanged?'cloud_linked_local_changes_pending':
          'cloud_linked',{
            appData:clone(base),
            link:clone(link.data),
            revision:revision,
            snapshotUploaded:snapshotWasUploaded,
            operationId:context.metadata.operationId,
            requestedCloudId:context.metadata.requestedCloudId
          });
    }).catch(function(){
      return result(false,'local_finalization_failed',{
        link:clone(link.data),
        operationId:context.metadata.operationId,
        requestedCloudId:context.metadata.requestedCloudId
      },null,'requires_reconciliation');
    });
  }

  function continueAfterCreation(context){
    return context.d.remote.verifyOwnerMembership({
      conferenceId:context.metadata.requestedCloudId,
      userId:context.userId
    }).then(function(membership){
      if(!membership||!membership.ok||
        membership.status!=='owner_verified'){
        return manualStop(context,
          'membership_verification_failed',
          membership&&membership.error);
      }
      return context.d.remote.inspectInitialSnapshot(
        context.metadata.requestedCloudId
      ).then(function(snapshot){
        if(!snapshot||!snapshot.ok){
          return retryFailure(context,'snapshot_inspection_failed',
            snapshot&&snapshot.error,'requires_reconciliation');
        }
        if(snapshot.status==='found'){
          return finalize(
            context,snapshot.data.revision,false
          );
        }
        if(snapshot.status!=='not_found'){
          return manualStop(context,'snapshot_state_invalid',
            snapshot.error);
        }
        var current=context.d.getCurrentAppData();
        var currentConference=conference(current,context.id);
        if(!currentConference){
          return manualStop(context,'local_conference_missing');
        }
        var currentVersion=context.currentVersion();
        var changed=currentVersion!==
          context.metadata.snapshotContentVersion;
        var updated=updateRecovery(
          current,context.id,'reconciling',{
            contentChangedBeforeInitialSnapshot:changed,
            currentContentVersion:currentVersion,
            lastReconciliationAt:context.d.clock(),
            lastPublishStage:'initial_snapshot_recovery'
          }
        );
        return persist(context.d,updated).then(function(){
          context.current=updated;
          context.metadata=lifecycle(
            updated,context.id
          ).publishMetadata;
          return context.d.remote.uploadInitialSnapshot({
            conferenceId:context.metadata.requestedCloudId,
            snapshot:clone(currentConference),
            schemaVersion:String(
              context.options&&context.options.schemaVersion||'1'
            ),
            appVersion:String(
              context.options&&context.options.appVersion||
              global.APP_RELEASE&&global.APP_RELEASE.version||
              'unknown'
            ),
            operationId:context.metadata.operationId
          });
        }).then(function(upload){
          if(!upload||!upload.ok||
            ['applied','duplicate'].indexOf(upload.status)<0){
            return retryFailure(context,'initial_snapshot_failed',
              upload&&upload.error,'safe_to_retry_same_operation');
          }
          var revision=upload.data&&upload.data.revision;
          if(!Number.isInteger(revision)||revision<1){
            return retryFailure(context,
              'revision_missing_or_invalid',null,
              'requires_reconciliation');
          }
          return finalize(context,revision,true);
        });
      });
    });
  }

  function run(appData,id,options){
    var d=dependencies(options);
    var scanned=scanCandidates(appData,options);
    if(!scanned.ok)return Promise.resolve(scanned);
    var candidate=scanned.data.candidates.filter(function(item){
      return item.localConferenceId===id;
    })[0];
    if(!candidate){
      return Promise.resolve(result(false,'not_recovery_candidate'));
    }
    if(d.navigator&&d.navigator.onLine===false){
      return Promise.resolve(result(false,'offline'));
    }
    if(isolationBlocked(d,id,options)){
      return Promise.resolve(result(false,'cloud_isolation_active'));
    }
    var record=lifecycle(appData,id);
    var metadata=record.publishMetadata;
    var userId=sessionUserId(d.auth);
    if(!uuid(userId)||userId!==metadata.requestedByUserId){
      return Promise.resolve(result(
        false,'requesting_user_changed',null,null,
        'requires_manual_review'
      ));
    }
    if(metadata.retryCount>=MAX_RETRIES){
      return Promise.resolve(result(
        false,'retry_limit_reached',null,null,
        'requires_manual_review'
      ));
    }
    if(metadata.retryAfter&&
      Date.parse(metadata.retryAfter)>Date.parse(d.clock())){
      return Promise.resolve(result(false,'retry_backoff_active',{
        retryAfter:metadata.retryAfter
      }));
    }
    if(!d.remote||
      typeof d.remote.inspectConferenceCreationOperation!=='function'||
      typeof d.remote.inspectInitialSnapshot!=='function'||
      typeof d.remote.verifyOwnerMembership!=='function'||
      typeof d.remote.createConferenceIdempotent!=='function'||
      typeof d.remote.uploadInitialSnapshot!=='function'){
      return Promise.resolve(result(
        false,'recovery_dependencies_unavailable'
      ));
    }
    var context={
      d:d,
      id:id,
      options:options,
      current:clone(appData),
      metadata:clone(metadata),
      localConference:clone(conference(appData,id)),
      userId:userId
    };
    context.currentVersion=function(){
      var current=d.getCurrentAppData();
      var currentRecord=lifecycle(current,id);
      return currentRecord&&
        Number.isInteger(currentRecord.localContentVersion)
        ?currentRecord.localContentVersion
        :metadata.currentContentVersion;
    };
    return freshAccess(d,userId).then(function(access){
      if(!access.ok)return {haltedResult:access};
      context.access=access.data;
      return d.remote.inspectConferenceCreationOperation({
        operationId:metadata.operationId,
        requestedConferenceId:metadata.requestedCloudId,
        userId:userId
      });
    }).then(function(operation){
      if(operation&&operation.haltedResult){
        return operation.haltedResult;
      }
      if(!operation||operation.ok===false){
        if(operation&&operation.status==='integrity_conflict'){
          return manualStop(context,'integrity_conflict',
            operation.error);
        }
        return retryFailure(context,'operation_inspection_failed',
          operation&&operation.error,'requires_reconciliation');
      }
      if(operation.status==='created'){
        if(!operation.data||
          operation.data.conferenceId!==metadata.requestedCloudId||
          operation.data.operationId!==metadata.operationId){
          return manualStop(context,'integrity_conflict');
        }
        return continueAfterCreation(context);
      }
      if(operation.status!=='not_found'){
        return manualStop(context,'operation_state_invalid');
      }
      if(!(context.access.canCreateConferences||
        context.access.isSystemOwner)){
        return manualStop(context,
          'conference_creation_not_authorized');
      }
      var link=d.links.get(id,options&&options.linkOptions);
      if(link&&link.linkStatus==='cloud_linked'){
        return manualStop(context,'integrity_conflict');
      }
      return d.remote.createConferenceIdempotent({
        operationId:metadata.operationId,
        requestedConferenceId:metadata.requestedCloudId,
        name:context.localConference.name,
        organizationId:String(context.localConference.organizationId||''),
        metadata:{localConferenceId:id}
      }).then(function(created){
        if(!created||!created.ok||
          ['created','duplicate'].indexOf(created.status)<0){
          var remoteCode=created&&created.error&&
            created.error.code;
          var authorizationError=[
            'AUTH_REQUIRED','SYSTEM_ACCESS_REQUIRED',
            'ACCOUNT_BLOCKED','ACCOUNT_PENDING',
            'CONFERENCE_CREATION_NOT_ALLOWED','ACCESS_DENIED'
          ].indexOf(remoteCode)>=0;
          var ambiguousError=!created||[
            'NETWORK_ERROR','SUPABASE_REQUEST_FAILED',
            'INVALID_CREATION_RESPONSE'
          ].indexOf(remoteCode)>=0;
          return retryFailure(context,
            authorizationError
              ?'authorization_failed'
              :ambiguousError
                ?'conference_creation_result_unknown'
                :'conference_creation_failed',
            created&&created.error,
            authorizationError
              ?'authorization_required'
              :ambiguousError
                ?'requires_reconciliation'
                :'safe_to_retry_same_operation');
        }
        if(!created.data||
          created.data.operationId!==metadata.operationId||
          created.data.conferenceId!==metadata.requestedCloudId){
          return manualStop(context,'integrity_conflict');
        }
        return continueAfterCreation(context);
      });
    }).catch(function(error){
      return retryFailure(context,'reconciliation_failed',{
        code:String(error&&error.code||'RECOVERY_FAILED')
      },'requires_reconciliation');
    });
  }

  function reconcileConference(appData,id,options){
    id=String(id||'');
    if(flights[id]){
      return Promise.resolve(result(
        false,'reconciliation_active'
      ));
    }
    var flight=run(appData,id,options).finally(function(){
      if(flights[id]===flight)delete flights[id];
    });
    flights[id]=flight;
    return flight;
  }

  function recoverCandidates(appData,options){
    var scan=scanCandidates(appData,options);
    if(!scan.ok)return Promise.resolve(scan);
    var d=dependencies(options);
    var sequence=Promise.resolve([]);
    scan.data.candidates.forEach(function(candidate){
      sequence=sequence.then(function(results){
        var current=d.getCurrentAppData();
        var source=object(current)?current:appData;
        return reconcileConference(
          source,candidate.localConferenceId,options
        ).catch(function(){
          return result(false,'candidate_recovery_failed',{
            localConferenceId:candidate.localConferenceId
          });
        }).then(function(candidateResult){
          results.push(candidateResult);
          return results;
        });
      });
    });
    return sequence.then(function(results){
      return result(true,'candidate_recovery_completed',{
        results:results
      });
    });
  }

  function getState(){
    return {
      activeConferenceIds:Object.keys(flights),
      maxRetries:MAX_RETRIES,
      backoffSeconds:BACKOFF_SECONDS.slice()
    };
  }

  function resetForTests(){
    flights=Object.create(null);
    return {ok:true,status:'reset'};
  }

  global.ConferencePublishRecovery=Object.freeze({
    scanCandidates:scanCandidates,
    reconcileConference:reconcileConference,
    recoverCandidates:recoverCandidates,
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
