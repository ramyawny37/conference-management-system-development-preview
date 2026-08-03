(function(global){
  'use strict';

  var preparing=Object.create(null);
  var validating=Object.create(null);

  function result(ok,status,data,error){
    return {
      ok:ok,
      status:status,
      data:data||null,
      error:error||null
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

  function dependencies(options){
    options=object(options)?options:{};
    return {
      repository:options.repository||global.ConferenceRepository,
      links:options.links||global.ConferenceLinkStore,
      queue:options.queue||global.OfflineSyncQueue,
      membership:options.membership||global.ConferenceMembersService,
      systemAccess:options.systemAccess||global.SystemAccessService,
      auth:options.auth||global.SupabaseAuth,
      backup:options.backup||global.FullBackupService,
      publishing:options.publishing||global.ConferencePublishingEngine,
      recovery:options.recovery||global.ConferencePublishRecovery,
      device:options.device||global.SupabaseDeviceIdentity,
      integration:options.integration||global.OfflineFirstIntegration,
      navigator:options.navigator||global.navigator
    };
  }

  function lifecycle(appData,id){
    return appData&&appData.conferenceLifecycle&&
      appData.conferenceLifecycle.records&&
      appData.conferenceLifecycle.records[id]||null;
  }

  function conference(appData,id){
    var values=appData&&appData.conferences;
    if(!Array.isArray(values))return null;
    for(var index=0;index<values.length;index++){
      if(values[index]&&values[index].id===id)return values[index];
    }
    return null;
  }

  function userId(auth){
    var session=auth&&typeof auth.getSession==='function'
      ?auth.getSession():null;
    var state=auth&&typeof auth.getState==='function'
      ?auth.getState():null;
    return String(
      session&&session.user&&session.user.id||
      state&&state.user&&state.user.id||''
    );
  }

  function deviceId(device){
    try{
      var identity=device&&typeof device.getOrCreate==='function'
        ?device.getOrCreate():null;
      return identity&&uuid(String(identity.id||''))
        ?String(identity.id):null;
    }catch(error){
      return null;
    }
  }

  function isolated(d,id,options){
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

  function activeFor(id,service){
    var state=service&&typeof service.getState==='function'
      ?service.getState():null;
    return !!(state&&Array.isArray(state.activeConferenceIds)&&
      state.activeConferenceIds.indexOf(id)>=0);
  }

  function conflict(link){
    return !!(link&&(
      link.linkStatus==='needs_resolution'||
      link.conflictId||
      ['active','pending','reviewed','changed'].indexOf(
        link.conflictStatus
      )>=0
    ));
  }

  function legacyLinkAllowed(link,options){
    var classifier=options&&options.classifyLegacyLink;
    if(typeof classifier==='function'){
      try{return classifier(clone(link))===true;}
      catch(error){return false;}
    }
    // Explicit compatibility adapter for the pre-Phase-2.3 contract.
    return !!(link&&['linked','unsynced'].indexOf(
      link.linkStatus
    )>=0);
  }

  function validLink(link,record,options){
    if(!link||!uuid(link.remoteConferenceId)||
      !Number.isInteger(link.knownRevision)||
      link.knownRevision<1||conflict(link)){
      return false;
    }
    if(link.linkStatus==='cloud_linked'){
      return !!(record&&record.localLifecycle==='active'&&
        record.cloudLifecycle==='cloud_linked'&&
        object(link.syncState)&&
        link.syncState.initialSnapshotComplete===true);
    }
    return legacyLinkAllowed(link,options);
  }

  function freshAuthorization(d,link,options){
    if(!d.systemAccess||
      typeof d.systemAccess.refresh!=='function'||
      !d.membership||
      typeof d.membership.getCurrentAccess!=='function'){
      return Promise.resolve(result(
        false,'authorization_unavailable'
      ));
    }
    var authenticatedUserId=userId(d.auth);
    if(!uuid(authenticatedUserId)){
      return Promise.resolve(result(false,'authentication_required'));
    }
    return Promise.resolve(d.systemAccess.refresh()).then(function(access){
      if(!access||access.source!=='server'||access.fresh!==true||
        access.authenticated!==true||
        access.userId!==authenticatedUserId){
        return {haltedResult:result(
          false,'fresh_system_access_required'
        )};
      }
      if(access.accountStatus==='blocked'){
        return {haltedResult:result(false,'account_blocked')};
      }
      if(access.accountStatus!=='approved'){
        return {haltedResult:result(
          false,'account_not_approved'
        )};
      }
      return d.membership.getCurrentAccess({
        remoteConferenceId:link.remoteConferenceId
      },options&&options.membershipOptions);
    }).then(function(access){
      if(access&&access.haltedResult)return access.haltedResult;
      if(!access||!access.ok||access.status!=='available'||
        !access.data||access.data.userId!==authenticatedUserId||
        ['owner','manager'].indexOf(access.data.role)<0||
        access.data.canSync!==true){
        return result(false,'membership_write_denied');
      }
      return result(true,'write_authorized',{
        userId:authenticatedUserId,
        role:access.data.role
      });
    }).catch(function(){
      return result(false,'authorization_failed');
    });
  }

  function inspectScope(appData,id,options){
    var d=dependencies(options);
    var local=conference(appData,id);
    if(global.isConferenceImportRecoveryPending&&
      global.isConferenceImportRecoveryPending(appData,id)){
      return result(false,'import_recovery_pending');
    }
    var record=lifecycle(appData,id);
    if(!local)return result(false,'conference_not_found');
    if(record&&record.localLifecycle==='archived'){
      return result(false,'conference_archived');
    }
    if(d.links&&typeof d.links.inspect==='function'){
      var inspected=d.links.inspect(options&&options.linkOptions);
      if(!inspected||!inspected.ok){
        return result(false,'conference_link_store_invalid');
      }
    }
    var link=d.links&&typeof d.links.get==='function'
      ?d.links.get(id,options&&options.linkOptions):null;
    if(!link)return result(false,'conference_link_missing');
    if(!validLink(link,record,options)){
      return result(false,'conference_link_invalid');
    }
    if(isolated(d,id,options)){
      return result(false,'cloud_isolation_active');
    }
    if(activeFor(id,d.publishing)){
      return result(false,'publishing_active');
    }
    if(activeFor(id,d.recovery)){
      return result(false,'reconciliation_active');
    }
    return result(true,'scope_valid',{
      conference:clone(local),
      lifecycle:record?clone(record):null,
      link:clone(link),
      legacy:link.linkStatus!=='cloud_linked'
    });
  }

  function validateOperation(operation,options){
    operation=object(operation)?operation:{};
    var localId=String(operation.localConferenceId||'');
    var d=dependencies(options);
    if(!localId){
      var legacy=d.links&&
        typeof d.links.findByRemoteId==='function'
        ?d.links.findByRemoteId(
          operation.conferenceId,
          options&&options.linkOptions
        ):null;
      localId=legacy&&String(legacy.localConferenceId||'');
    }
    if(!localId){
      return Promise.resolve(result(false,'local_conference_missing'));
    }
    if(validating[localId]){
      return validating[localId];
    }
    var appData=options&&options.appData||global.appData;
    var scope=inspectScope(appData,localId,options);
    if(!scope.ok)return Promise.resolve(scope);
    if(operation.queueSchemaVersion===1&&scope.data.legacy){
      return Promise.resolve(result(
        false,'legacy_link_contract_mismatch'
      ));
    }
    var link=scope.data.link;
    if(operation.conferenceId!==link.remoteConferenceId||
      operation.cloudConferenceId&&
        operation.cloudConferenceId!==link.remoteConferenceId){
      return Promise.resolve(result(false,'cloud_id_mismatch'));
    }
    if(operation.baseRevision!==link.knownRevision){
      return Promise.resolve(result(false,'base_revision_mismatch'));
    }
    if(d.navigator&&d.navigator.onLine===false){
      return Promise.resolve(result(false,'offline'));
    }
    var flight=freshAuthorization(d,link,options).finally(function(){
      if(validating[localId]===flight)delete validating[localId];
    });
    validating[localId]=flight;
    return flight;
  }

  function idempotencyKey(id,link,version){
    return [
      'snapshot',id,link.remoteConferenceId,
      String(link.knownRevision),String(version)
    ].join('|');
  }

  function clearPendingMarker(d,link,operation,options){
    var syncState=Object.assign({},link.syncState||{},{
      pendingLocalChanges:false,
      queuedLocalContentVersion:operation.localContentVersion,
      queuedOperationId:operation.operationId,
      queuedIdempotencyKey:operation.idempotencyKey
    });
    return d.links.save(Object.assign({},link,{
      syncState:syncState
    }),options&&options.linkOptions);
  }

  function prepareConference(appData,id,options){
    id=String(id||'');
    if(preparing[id])return preparing[id];
    var d=dependencies(options);
    var scope=inspectScope(appData,id,options);
    if(!scope.ok)return Promise.resolve(scope);
    var link=scope.data.link;
    if(link.linkStatus!=='cloud_linked'){
      return Promise.resolve(result(true,'legacy_managed',{
        localConferenceId:id
      }));
    }
    if(!link.syncState.pendingLocalChanges){
      return Promise.resolve(result(true,'no_local_changes',{
        localConferenceId:id
      }));
    }
    if(d.navigator&&d.navigator.onLine===false){
      return Promise.resolve(result(false,'offline'));
    }
    var record=scope.data.lifecycle;
    var version=record&&record.localContentVersion;
    if(!Number.isInteger(version)||version<0){
      return Promise.resolve(result(false,'local_content_version_invalid'));
    }
    var key=idempotencyKey(id,link,version);
    var identity=deviceId(d.device);
    if(!identity)return Promise.resolve(result(
      false,'device_identity_unavailable'
    ));
    if(!d.queue||
      typeof d.queue.getAllOperations!=='function'||
      typeof d.queue.coalesceSnapshotOperation!=='function'){
      return Promise.resolve(result(false,'queue_unavailable'));
    }
    var authorization;
    var flight=freshAuthorization(d,link,options).then(function(access){
      if(!access.ok)return access;
      authorization=access.data;
      return d.queue.getAllOperations();
    }).then(function(read){
      if(!read||read.ok===false)return read;
      if(read.status!=='listed'||!read.data||
        !Array.isArray(read.data.operations)){
        return result(false,'queue_read_failed');
      }
      var existing=read.data.operations.filter(function(operation){
        return operation.idempotencyKey===key;
      })[0];
      if(existing){
        var cleared=clearPendingMarker(
          d,link,existing,options
        );
        return cleared&&cleared.ok
          ?result(true,'already_prepared',{
              operation:clone(existing)
            })
          :result(false,'link_marker_update_failed',{
              operation:clone(existing)
            });
      }
      var snapshot=clone(scope.data.conference);
      return d.queue.coalesceSnapshotOperation({
        localConferenceId:id,
        conferenceId:link.remoteConferenceId,
        operationType:'snapshot',
        baseRevision:link.knownRevision,
        localContentVersion:version,
        snapshot:snapshot,
        schemaVersion:String(
          options&&options.schemaVersion||'1'
        ),
        appVersion:String(
          options&&options.appVersion||
          global.APP_RELEASE&&global.APP_RELEASE.version||'unknown'
        ),
        deviceId:identity,
        createdByUserId:authorization.userId,
        idempotencyKey:key
      },options&&options.queueOptions).then(function(queued){
        if(!queued||!queued.ok)return result(
          false,'queue_operation_save_failed'
        );
        var operation=queued.data&&queued.data.operation||
          queued.data;
        var cleared=clearPendingMarker(
          d,link,operation,options
        );
        if(!cleared||!cleared.ok){
          return result(false,'link_marker_update_failed',{
            operation:clone(operation)
          });
        }
        if(d.integration&&
          typeof d.integration.configureConferenceSync==='function'){
          d.integration.configureConferenceSync(id,{
            conferenceId:link.remoteConferenceId,
            baseRevision:link.knownRevision,
            schemaVersion:String(
              options&&options.schemaVersion||'1'
            ),
            appVersion:String(
              options&&options.appVersion||
              global.APP_RELEASE&&global.APP_RELEASE.version||
              'unknown'
            )
          });
        }
        return result(true,'prepared',{
          operation:clone(operation),
          link:clone(cleared.data)
        });
      });
    }).catch(function(){
      return result(false,'queue_preparation_failed');
    }).finally(function(){
      if(preparing[id]===flight)delete preparing[id];
    });
    preparing[id]=flight;
    return flight;
  }

  function prepareCandidates(appData,options){
    if(!object(appData)||!Array.isArray(appData.conferences)){
      return Promise.resolve(result(false,'app_data_invalid'));
    }
    var sequence=Promise.resolve([]);
    appData.conferences.forEach(function(item){
      var id=item&&String(item.id||'');
      if(!id)return;
      sequence=sequence.then(function(results){
        return prepareConference(appData,id,options)
          .catch(function(){
            return result(false,'candidate_preparation_failed',{
              localConferenceId:id
            });
          }).then(function(prepared){
            results.push(prepared);
            return results;
          });
      });
    });
    return sequence.then(function(results){
      return result(true,'candidates_prepared',{results:results});
    });
  }

  function getState(){
    return {
      preparingConferenceIds:Object.keys(preparing),
      validatingConferenceIds:Object.keys(validating),
      pendingFlagName:'pendingLocalChanges'
    };
  }

  function resetForTests(){
    preparing=Object.create(null);
    validating=Object.create(null);
    return {ok:true,status:'reset'};
  }

  global.ConferenceQueueIntegration=Object.freeze({
    idempotencyKey:idempotencyKey,
    inspectScope:inspectScope,
    validateOperation:validateOperation,
    prepareConference:prepareConference,
    prepareCandidates:prepareCandidates,
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
