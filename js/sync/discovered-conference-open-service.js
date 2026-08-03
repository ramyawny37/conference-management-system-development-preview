(function(global){
  'use strict';
  var flights=Object.create(null);
  var transactionTail=Promise.resolve();
  var generation=0;
  var ROLES=['owner','manager','viewer','accommodation_viewer','transport_viewer'];

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function result(ok,status,data){return {ok:ok,status:status,data:data||null};}
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
      storage:options.storage||global.StorageRepository,
      repository:options.repository||global.ConferenceRepository,
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
        return result(true,'snapshot_downloaded',{
          snapshot:copy(downloaded.data.snapshot),revision:downloaded.data.revision,
          schemaVersion:downloaded.data.schemaVersion||null,
          appVersion:downloaded.data.appVersion||null
        });
      });
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
      ctx.localConferenceId=identity.id;
      if(manualRelinkPending(d,identity.id,ctx.options)){
        return result(false,'manual_relink_required');
      }
      if(identity.existing&&!conference(previous,identity.id)&&
        (!recovery||String(recovery.localConferenceId)!==String(identity.id))){
        return result(false,'link_recovery_required');
      }
      if(identity.existing&&conference(previous,identity.id)&&
        ['linked','cloud_linked'].indexOf(identity.existing.linkStatus)>=0){
        return {reuse:true,data:previous,localId:identity.id,link:identity.existing};
      }
      if(recovery&&recovery.revision!==ctx.snapshot.data.revision){
        return cleanupStaged(
          d,previous,recovery,remoteId,ctx,'recovery_cleaned_revision_changed'
        );
      }
      var local=copy(recovery?recovery.snapshot:ctx.snapshot.data.snapshot);
      local.id=recovery&&recovery.localConferenceId||identity.id;
      var normalizedBase=copy(previous);
      if(!conference(normalizedBase,local.id)){
        normalizedBase.conferences=(normalizedBase.conferences||[]).concat([local]);
      }
      var normalized=d.normalize(normalizedBase);
      var normalizedConference=conference(normalized,local.id);
      if(!normalizedConference)return result(false,'snapshot_malformed');
      if(!recovery){
        var added=d.repository&&typeof d.repository.addLocalConference==='function'
          ?d.repository.addLocalConference(previous,normalizedConference):null;
        if(!added||!added.ok)return result(false,'local_repository_rejected');
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
        promoted.conferenceImportRecovery=copy(
          verifiedStage.conferenceImportRecovery||{}
        );
        var promotionPromise=conference(previous,local.id)
          ?Promise.resolve(result(true,'persisted',{value:previous}))
          :persistGuarded(
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
            pendingLocalApplication:false
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
            return {data:verifiedCleanup,localId:local.id,link:finalLink};
          });
        });
      });
    }).then(function(prepared){
      if(prepared&&prepared.ok===false)return prepared;
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
          return persistGuarded(
            d,prepared.data,ctx,'activation_rollback_failed',prepared.data
          ).then(function(){return result(false,'sync_configuration_failed');});
        }
        var activationOk=false;
        try{
          activationOk=typeof d.activate==='function'&&
            d.activate(prepared.localId,{alreadyPersisted:true})===true;
        }catch(error){activationOk=false;}
        if(!activationOk){
          d.applyData(previousMemory);
          return persistGuarded(
            d,prepared.data,ctx,'activation_rollback_failed',prepared.data
          ).then(function(rollback){
            return rollback.ok?result(false,'runtime_activation_failed'):rollback;
          });
        }
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
  global.DiscoveredConferenceOpenService=Object.freeze({
    open:open,invalidate:invalidate,cleanupRecovery:cleanupRecovery
  });
})(window);
