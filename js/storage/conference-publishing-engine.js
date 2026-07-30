(function(global){
  'use strict';

  var flights=Object.create(null);

  function outcome(ok,status,data,error,recovery){
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

  function createUuid(cryptoAdapter){
    if(cryptoAdapter&&typeof cryptoAdapter.randomUUID==='function'){
      return cryptoAdapter.randomUUID();
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }

  function errorValue(code,stage,source){
    return {
      code:String(code||'PUBLISH_FAILED'),
      stage:String(stage||'unknown'),
      remoteCode:source&&source.code?String(source.code):null
    };
  }

  function dependencies(options){
    options=object(options)?options:{};
    return {
      repository:options.repository||global.ConferenceRepository,
      publishManager:options.publishManager||
        global.ConferencePublishManager,
      systemAccess:options.systemAccess||global.SystemAccessService,
      auth:options.auth||global.SupabaseAuth,
      remote:options.remote||global.SupabaseSnapshotSync,
      links:options.links||global.ConferenceLinkStore,
      backup:options.backup||global.FullBackupService,
      storage:options.storage||global.StorageRepository,
      navigator:options.navigator||global.navigator,
      crypto:options.crypto||global.crypto,
      clock:options.clock||function(){return new Date().toISOString();},
      getCurrentAppData:options.getCurrentAppData||
        function(){return global.appData;},
      applyAppData:options.applyAppData||function(value){
        global.appData=value;
      },
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

  function findConference(appData,localConferenceId){
    if(!object(appData)||!Array.isArray(appData.conferences))return null;
    for(var index=0;index<appData.conferences.length;index++){
      if(appData.conferences[index]&&
        appData.conferences[index].id===localConferenceId){
        return appData.conferences[index];
      }
    }
    return null;
  }

  function lifecycle(appData,localConferenceId){
    return appData&&appData.conferenceLifecycle&&
      appData.conferenceLifecycle.records&&
      appData.conferenceLifecycle.records[localConferenceId]||null;
  }

  function restoreBlocked(backup,localConferenceId,options){
    if(!backup)return false;
    var marker=typeof backup.getFullRestoreCloudReviewMarker==='function'
      ?backup.getFullRestoreCloudReviewMarker({
        storage:options&&options.localStorage
      }):null;
    if(marker&&marker.pending)return true;
    return typeof backup.isManualRelinkRequired==='function'&&
      backup.isManualRelinkRequired(localConferenceId,{
        storage:options&&options.localStorage
      });
  }

  function persist(d,value,source){
    return Promise.resolve(d.persistAppData(clone(value)))
      .then(function(){
        d.applyAppData(clone(value));
        return value;
      });
  }

  function updateAttempt(appData,localConferenceId,values,state){
    var next=clone(appData);
    var record=next.conferenceLifecycle.records[localConferenceId];
    record.cloudLifecycle=state;
    record.publishMetadata=Object.assign(
      {},record.publishMetadata,values
    );
    return next;
  }

  function failAttempt(context,code,stage,remoteError,recovery){
    var d=context.d;
    var now=d.clock();
    if([
      'authorization_failed','conference_creation_failed',
      'membership_verification_failed','initial_snapshot_failed',
      'revision_missing_or_invalid'
    ].indexOf(code)>=0){
      saveLink(context,'link_failed',0,{
        pendingLocalChanges:false,
        initialSnapshotComplete:false,
        failureCode:code
      });
    }
    var latest=d.getCurrentAppData();
    var failureBase=object(latest)&&
      lifecycle(latest,context.localConferenceId)
      ?clone(latest):clone(context.current);
    failureBase.conferenceLifecycle.records[context.localConferenceId]
      .publishMetadata=clone(
        context.current.conferenceLifecycle.records[
          context.localConferenceId
        ].publishMetadata
      );
    var failed=updateAttempt(
      failureBase,
      context.localConferenceId,
      {
        lastAttemptAt:now,
        lastPublishStage:stage,
        lastPublishError:errorValue(code,stage,remoteError),
        currentContentVersion:context.currentVersion()
      },
      'publish_failed'
    );
    return persist(d,failed,context.source)
      .then(function(){
        context.current=failed;
        return outcome(false,code,{
          appData:clone(failed),
          operationId:context.operationId,
          requestedCloudId:context.requestedCloudId
        },errorValue(code,stage,remoteError),recovery);
      })
      .catch(function(){
        return outcome(false,'publish_failure_persistence_failed',{
          appData:clone(context.current),
          operationId:context.operationId,
          requestedCloudId:context.requestedCloudId
        },errorValue('PUBLISH_FAILURE_PERSISTENCE_FAILED',stage),
        'requires_reconciliation');
      });
  }

  function validateStart(d,appData,localConferenceId,confirmation,options){
    if(!d.repository||
      typeof d.repository.validateLifecycleRecord!=='function'||
      !d.links||typeof d.links.get!=='function'||
      typeof d.links.save!=='function'||!d.remote||
      typeof d.remote.createConferenceIdempotent!=='function'||
      typeof d.remote.verifyOwnerMembership!=='function'||
      typeof d.remote.uploadInitialSnapshot!=='function'){
      return outcome(false,'publishing_dependencies_unavailable');
    }
    var conference=findConference(appData,localConferenceId);
    var record=lifecycle(appData,localConferenceId);
    var checked=record&&d.repository&&
      d.repository.validateLifecycleRecord(record,localConferenceId);
    if(!conference)return outcome(false,'conference_not_found');
    if(!checked||!checked.ok)return outcome(false,'lifecycle_invalid');
    if(record.cloudLifecycle!=='ready_to_publish'||
      !record.publishMetadata||
      record.publishMetadata.publishIntent!=='publish_requested'){
      return outcome(false,'not_ready_to_publish');
    }
    if(record.publishMetadata.operationId||
      record.publishMetadata.requestedCloudId){
      return outcome(false,'invalid_existing_attempt',null,null,
        'requires_reconciliation');
    }
    if(!object(confirmation)||confirmation.confirmed!==true||
      !uuid(confirmation.userId)||
      !confirmation.confirmedAt||
      Number.isNaN(Date.parse(confirmation.confirmedAt))){
      return outcome(false,'confirmation_required');
    }
    var authenticatedUserId=sessionUserId(d.auth);
    if(!uuid(authenticatedUserId)){
      return outcome(false,'authentication_required');
    }
    if(authenticatedUserId!==confirmation.userId||
      authenticatedUserId!==record.publishMetadata.requestedByUserId){
      return outcome(false,'requesting_user_changed');
    }
    if(d.navigator&&d.navigator.onLine===false){
      return outcome(false,'offline');
    }
    if(restoreBlocked(d.backup,localConferenceId,options)){
      return outcome(false,'cloud_isolation_active');
    }
    if(d.links&&typeof d.links.inspect==='function'){
      var inspected=d.links.inspect(options&&options.linkOptions);
      if(!inspected||!inspected.ok){
        return outcome(false,'conference_link_store_invalid');
      }
    }
    var existing=d.links&&d.links.get(localConferenceId,
      options&&options.linkOptions);
    if(existing)return outcome(false,'conference_link_exists');
    return outcome(true,'start_valid',{
      conference:clone(conference),
      record:clone(record),
      userId:authenticatedUserId
    });
  }

  function validFreshAccess(access,userId){
    return access&&access.authenticated===true&&
      access.profileLoaded===true&&access.fresh===true&&
      access.source==='server'&&access.userId===userId&&
      typeof access.checkedAt==='string'&&
      !Number.isNaN(Date.parse(access.checkedAt))&&
      access.accountStatus==='approved'&&
      (access.canCreateConferences===true||
        access.isSystemOwner===true);
  }

  function refreshAccess(d,userId){
    if(!d.systemAccess||
      typeof d.systemAccess.refresh!=='function'){
      return Promise.resolve(outcome(
        false,'authorization_service_unavailable'
      ));
    }
    return Promise.resolve(d.systemAccess.refresh())
      .then(function(access){
        if(!validFreshAccess(access,userId)){
          var status=access&&access.accountStatus;
          return outcome(false,
            status==='pending'?'account_pending':
              status==='blocked'?'account_blocked':
                'authorization_failed'
          );
        }
        return outcome(true,'authorized',clone(access));
      })
      .catch(function(){
        return outcome(false,'authorization_failed');
      });
  }

  function currentVersion(context){
    var current=context.d.getCurrentAppData();
    var record=lifecycle(current,context.localConferenceId);
    return record&&Number.isInteger(record.localContentVersion)
      ?record.localContentVersion
      :context.snapshotContentVersion;
  }

  function saveLink(context,status,revision,syncState){
    return context.d.links.save({
      localConferenceId:context.localConferenceId,
      remoteConferenceId:context.requestedCloudId,
      remoteName:context.conference.name,
      knownRevision:revision,
      linkStatus:status,
      initialOperationId:context.operationId,
      linkedAt:status==='cloud_linked'?context.d.clock():null,
      linkedByUserId:context.userId,
      syncState:syncState,
      lastVerifiedAt:status==='cloud_linked'?context.d.clock():null
    },context.options&&context.options.linkOptions);
  }

  function run(appData,localConferenceId,confirmation,options){
    var d=dependencies(options);
    var start=validateStart(
      d,appData,localConferenceId,confirmation,options
    );
    if(!start.ok)return Promise.resolve(start);
    return refreshAccess(d,start.data.userId).then(function(access){
      if(!access.ok)return access;
      var operationId;
      var requestedCloudId;
      try{
        operationId=createUuid(d.crypto);
        requestedCloudId=createUuid(d.crypto);
      }catch(error){
        return outcome(false,'secure_identifier_unavailable');
      }
      if(!uuid(operationId)||!uuid(requestedCloudId)||
        operationId===requestedCloudId){
        return outcome(false,'secure_identifier_unavailable');
      }
      var now=d.clock();
      var snapshot=clone(start.data.conference);
      var snapshotVersion=start.data.record.localContentVersion;
      var context={
        d:d,
        source:appData,
        current:null,
        localConferenceId:localConferenceId,
        conference:start.data.conference,
        userId:start.data.userId,
        operationId:operationId,
        requestedCloudId:requestedCloudId,
        snapshotContentVersion:snapshotVersion,
        options:options
      };
      context.currentVersion=function(){return currentVersion(context);};
      context.current=updateAttempt(appData,localConferenceId,{
        confirmationAt:confirmation.confirmedAt,
        operationId:operationId,
        requestedCloudId:requestedCloudId,
        attemptStartedAt:now,
        lastAttemptAt:now,
        lastPublishStage:'attempt_persisted',
        lastPublishError:null,
        snapshotContentVersion:snapshotVersion,
        currentContentVersion:snapshotVersion,
        lastAccessCheck:{
          userId:access.data.userId,
          checkedAt:access.data.checkedAt,
          source:'server',
          fresh:true,
          authenticated:true,
          accountStatus:access.data.accountStatus,
          canCreateConferences:access.data.canCreateConferences,
          isSystemOwner:access.data.isSystemOwner
        }
      },'publishing');

      return persist(d,context.current,appData)
        .catch(function(){return null;})
        .then(function(persisted){
          if(!persisted){
            return outcome(false,'attempt_persistence_failed',null,
              errorValue('ATTEMPT_PERSISTENCE_FAILED','local_prepare'),
              'terminal_local_validation_error');
          }
          var pending=saveLink(context,'linking',0,{
            pendingLocalChanges:false,
            initialSnapshotComplete:false
          });
          if(!pending||!pending.ok){
            return failAttempt(context,
              'conference_link_save_failed','pending_link',null,
              'safe_to_retry_same_operation');
          }
          return d.remote.createConferenceIdempotent({
            operationId:operationId,
            requestedConferenceId:requestedCloudId,
            name:start.data.conference.name,
            metadata:{localConferenceId:localConferenceId}
          }).then(function(created){
            if(!created||!created.ok||
              ['created','duplicate'].indexOf(created.status)<0){
              var remoteCode=created&&created.error&&
                created.error.code;
              var authorizationFailure=[
                'AUTH_REQUIRED','SYSTEM_ACCESS_REQUIRED',
                'ACCOUNT_PENDING','ACCOUNT_BLOCKED',
                'CONFERENCE_CREATION_NOT_ALLOWED','ACCESS_DENIED'
              ].indexOf(remoteCode)>=0;
              var ambiguous=!created||
                created.error&&[
                  'NETWORK_ERROR','SUPABASE_REQUEST_FAILED',
                  'INVALID_CREATION_RESPONSE'
                ].indexOf(created.error.code)>=0;
              return failAttempt(context,
                authorizationFailure?'authorization_failed':
                  ambiguous?'conference_creation_result_unknown':
                    'conference_creation_failed',
                'conference_creation',created&&created.error,
                authorizationFailure?'authorization_required':
                  ambiguous?'requires_reconciliation':
                    'safe_to_retry_same_operation');
            }
            if(!created.data||
              created.data.operationId!==operationId||
              created.data.conferenceId!==requestedCloudId){
              return failAttempt(context,
                'conference_creation_result_unknown',
                'conference_creation',null,'requires_reconciliation');
            }
            return d.remote.verifyOwnerMembership({
              conferenceId:requestedCloudId,
              userId:context.userId
            }).then(function(membership){
              if(!membership||!membership.ok||
                membership.status!=='owner_verified'){
                return failAttempt(context,
                  'membership_verification_failed',
                  'membership_verification',
                  membership&&membership.error,
                  'requires_reconciliation');
              }
              return d.remote.uploadInitialSnapshot({
                conferenceId:requestedCloudId,
                snapshot:snapshot,
                schemaVersion:String(options&&options.schemaVersion||'1'),
                appVersion:String(options&&options.appVersion||
                  global.APP_RELEASE&&global.APP_RELEASE.version||'unknown'),
                operationId:operationId
              }).then(function(upload){
                if(!upload||!upload.ok||
                  ['applied','duplicate'].indexOf(upload.status)<0){
                  return failAttempt(context,'initial_snapshot_failed',
                    'initial_snapshot',upload&&upload.error,
                    'requires_reconciliation');
                }
                var revision=upload.data&&upload.data.revision;
                if(!Number.isInteger(revision)||revision<1){
                  return failAttempt(context,
                    'revision_missing_or_invalid','initial_snapshot',
                    null,'requires_reconciliation');
                }
                var latestVersion=context.currentVersion();
                var changed=latestVersion!==snapshotVersion;
                var finalLink=saveLink(
                  context,'cloud_linked',revision,{
                    pendingLocalChanges:changed,
                    initialSnapshotComplete:true,
                    snapshotContentVersion:snapshotVersion,
                    currentContentVersion:latestVersion
                  }
                );
                if(!finalLink||!finalLink.ok){
                  return failAttempt(context,
                    'conference_link_save_failed','final_link',
                    null,'requires_reconciliation');
                }
                var latestAppData=d.getCurrentAppData();
                var finalData=clone(
                  object(latestAppData)?latestAppData:context.current
                );
                var finalRecord=lifecycle(
                  finalData,localConferenceId
                );
                if(!finalRecord){
                  return failAttempt(context,
                    'local_finalization_failed','local_finalization',
                    null,'requires_reconciliation');
                }
                finalRecord.cloudLifecycle='cloud_linked';
                finalRecord.publishMetadata=null;
                return persist(d,finalData,appData)
                  .then(function(){
                    return outcome(true,
                      changed?'cloud_linked_local_changes_pending':
                        'cloud_linked',{
                          appData:clone(finalData),
                          link:clone(finalLink.data),
                          operationId:operationId,
                          requestedCloudId:requestedCloudId,
                          revision:revision,
                          localContentChanged:changed
                        });
                  })
                  .catch(function(){
                    return outcome(false,
                      'local_finalization_failed',{
                        operationId:operationId,
                        requestedCloudId:requestedCloudId,
                        link:clone(finalLink.data)
                      },errorValue(
                        'LOCAL_FINALIZATION_FAILED',
                        'local_finalization'
                      ),'requires_reconciliation');
                  });
              });
            });
          }).catch(function(error){
            return failAttempt(context,
              'conference_creation_result_unknown',
              'unexpected_exception',error,
              'requires_reconciliation');
          });
        });
    });
  }

  function publishConference(
    appData,localConferenceId,confirmation,options
  ){
    localConferenceId=String(localConferenceId||'');
    if(flights[localConferenceId]){
      return Promise.resolve(outcome(
        false,'publishing_attempt_active',null,null,
        'requires_reconciliation'
      ));
    }
    var flight=run(
      appData,localConferenceId,confirmation,options
    ).finally(function(){
      if(flights[localConferenceId]===flight){
        delete flights[localConferenceId];
      }
    });
    flights[localConferenceId]=flight;
    return flight;
  }

  function getState(){
    return {activeConferenceIds:Object.keys(flights)};
  }

  function resetForTests(){
    flights=Object.create(null);
    return {ok:true,status:'reset'};
  }

  global.ConferencePublishingEngine=Object.freeze({
    publishConference:publishConference,
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
