(function(global){
  'use strict';

  var initialized=false;
  var bootstrapComplete=false;
  var initializationPromise=null;
  var evaluationPromises={};
  var lastResult=null;

  function result(ok,status,data){
    return {ok:ok,status:status,data:data||null};
  }

  function dependencies(options){
    options=options||{};
    return {
      preferences:options.preferences||global.AutomaticSyncPreferences,
      config:options.config||global.SupabaseRuntimeConfig,
      auth:options.auth||global.SupabaseAuth,
      links:options.links||global.ConferenceLinkStore,
      recovery:options.recovery||global.ConferencePublishRecovery,
      backup:options.backup||global.FullBackupService,
      integration:options.integration||global.OfflineFirstIntegration,
      storage:options.storage||global.StorageRepository,
      getCurrentConference:options.getCurrentConference||
        global.getCurrentConference,
      getAppData:options.getAppData||function(){return global.appData;},
      applyAppData:options.applyAppData||function(value){global.appData=value;},
      navigator:options.navigator||global.navigator,
      orchestrator:options.orchestrator||global.AutomaticSyncOrchestrator
    };
  }

  function skip(status,data){
    lastResult=result(true,status,Object.assign({linked:false},data||{}));
    return Promise.resolve(lastResult);
  }

  function fail(status,data){
    lastResult=result(false,status,Object.assign({linked:false},data||{}));
    return Promise.resolve(lastResult);
  }

  function uuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function repairLinkedLifecycle(d,conference,link){
    var data=typeof d.getAppData==='function'?d.getAppData():null;
    var records=data&&data.conferenceLifecycle&&
      data.conferenceLifecycle.records;
    var record=records&&records[conference.id];
    if(!record||record.cloudLifecycle!=='unpublished'){
      return Promise.resolve(result(true,'lifecycle_unchanged',{appData:data}));
    }
    if(String(record.localConferenceId||'')!==String(conference.id)||
      String(link.localConferenceId||'')!==String(conference.id)){
      return Promise.resolve(result(false,'linked_lifecycle_mismatch'));
    }
    if(!d.storage||typeof d.storage.saveAppSnapshot!=='function'){
      return Promise.resolve(result(false,'linked_lifecycle_restore_unavailable'));
    }
    var next=copy(data);
    next.conferenceLifecycle.records[conference.id].cloudLifecycle='cloud_linked';
    next.conferenceLifecycle.records[conference.id].publishMetadata=null;
    return Promise.resolve(d.storage.saveAppSnapshot(next,{skipSyncQueue:true}))
      .then(function(saved){
        if(saved&&saved.ok===false){
          return result(false,'linked_lifecycle_persistence_failed');
        }
        d.applyAppData(copy(next));
        return result(true,'linked_lifecycle_repaired',{appData:next});
      }).catch(function(){
        return result(false,'linked_lifecycle_persistence_failed');
      });
  }

  function isolated(d,localConferenceId,options){
    if(!d.backup)return false;
    var marker=typeof d.backup.getFullRestoreCloudReviewMarker==='function'
      ?d.backup.getFullRestoreCloudReviewMarker({
        storage:options&&options.localStorage
      }):null;
    return !!(marker&&marker.pending)||
      typeof d.backup.isManualRelinkRequired==='function'&&
      d.backup.isManualRelinkRequired(localConferenceId,{
        storage:options&&options.localStorage
      });
  }

  function restoreLinkedContext(d,conference,link,options){
    if(!link||['linked','cloud_linked'].indexOf(link.linkStatus)<0||
      String(link.localConferenceId||'')!==String(conference.id)||
      !uuid(String(link.remoteConferenceId||''))||
      !Number.isInteger(link.knownRevision)||link.knownRevision<1){
      return fail('linked_context_invalid');
    }
    if(!d.integration||
      typeof d.integration.configureConferenceSync!=='function'){
      return fail('linked_context_restore_unavailable');
    }
    return repairLinkedLifecycle(d,conference,link).then(function(repaired){
      if(!repaired.ok)return fail(repaired.status);
      var configured;
      try{
        configured=d.integration.configureConferenceSync(conference.id,{
          conferenceId:link.remoteConferenceId,
          baseRevision:link.knownRevision,
          schemaVersion:String(options.schemaVersion||'1'),
          appVersion:String(options.appVersion||
            global.APP_RELEASE&&global.APP_RELEASE.version||'unknown')
        });
      }catch(error){
        return fail('linked_context_restore_failed');
      }
      if(!configured||configured.ok!==true){
        return fail('linked_context_restore_failed');
      }
      return skip('already_linked',{
        linked:true,
        contextRestored:true,
        lifecycleRepaired:repaired.status==='linked_lifecycle_repaired',
        localConferenceId:conference.id,
        remoteConferenceId:link.remoteConferenceId,
        revision:link.knownRevision
      });
    });
  }

  function ensureLinkedLifecycle(localConferenceId,options){
    options=options&&typeof options==='object'?options:{};
    var d=dependencies(options);
    var conference=typeof d.getCurrentConference==='function'
      ?d.getCurrentConference():null;
    var link=d.links&&typeof d.links.get==='function'
      ?d.links.get(localConferenceId,options.linkOptions):null;
    if(!conference||String(conference.id||'')!==String(localConferenceId||'')||
      !link||['linked','cloud_linked'].indexOf(link.linkStatus)<0||
      String(link.localConferenceId||'')!==String(localConferenceId||'')||
      !uuid(String(link.remoteConferenceId||''))||
      !Number.isInteger(link.knownRevision)||link.knownRevision<1){
      return Promise.resolve(result(false,'linked_lifecycle_context_invalid'));
    }
    return repairLinkedLifecycle(d,conference,link);
  }

  function initialize(options){
    options=options&&typeof options==='object'?options:{};
    bootstrapComplete=true;
    if(initialized)return {
      ok:true,
      status:'already_initialized',
      promise:initializationPromise
    };
    initialized=true;
    var d=dependencies(options);
    initializationPromise=Promise.resolve().then(function(){
      if(!d.auth||typeof d.auth.initialize!=='function')return null;
      return d.auth.initialize();
    }).catch(function(){return null;}).then(function(authResult){
      if(d.orchestrator&&typeof d.orchestrator.schedule==='function'){
        d.orchestrator.schedule('auth_changed');
      }
      return authResult;
    });
    return {ok:true,status:'initialized',promise:initializationPromise};
  }

  function evaluate(options){
    options=options&&typeof options==='object'?options:{};
    var d=dependencies(options);
    if(!initialized||!bootstrapComplete)return skip('bootstrap_pending');
    var preferences=d.preferences&&typeof d.preferences.get==='function'
      ?d.preferences.get(options.preferenceOptions)
      :null;
    if(!preferences||!preferences.cloudSyncEnabled){
      return skip('cloud_sync_disabled');
    }
    if(!preferences.automaticSyncEnabled||
      preferences.automaticLinkingEnabled===false){
      return skip('automatic_sync_disabled');
    }
    if(options.connectivity!=='online'||
      d.navigator&&d.navigator.onLine===false){
      return skip('offline');
    }
    var configured=d.config&&d.config.getPublicState&&
      d.config.getPublicState().configured;
    if(!configured)return skip('supabase_unconfigured');
    var auth=d.auth&&d.auth.getState&&d.auth.getState();
    if(!auth||!auth.authenticated)return skip('auth_required');
    var conference=typeof d.getCurrentConference==='function'
      ?d.getCurrentConference()
      :null;
    if(!conference||!conference.id||!conference.name){
      return skip('conference_unavailable');
    }
    if(isolated(d,conference.id,options)){
      return skip('manual_relink_required');
    }
    if(evaluationPromises[conference.id]){
      return evaluationPromises[conference.id];
    }
    var existing=d.links&&d.links.get(conference.id);
    if(existing&&['linked','cloud_linked'].indexOf(existing.linkStatus)>=0){
      return restoreLinkedContext(d,conference,existing,options);
    }
    var currentAppData=typeof d.getAppData==='function'
      ?d.getAppData():null;
    if(!d.recovery||
      typeof d.recovery.scanCandidates!=='function'||
      typeof d.recovery.reconcileConference!=='function'){
      return skip('recovery_unavailable');
    }
    var scan=d.recovery.scanCandidates(
      currentAppData,options.recoveryOptions
    );
    var candidate=scan&&scan.ok&&scan.data&&
      scan.data.candidates.some(function(item){
        return item.localConferenceId===conference.id;
      });
    if(!candidate){
      return skip(scan&&scan.ok
        ?'no_existing_publish_attempt'
        :'recovery_scan_failed');
    }
    var flight=d.recovery.reconcileConference(
      currentAppData,conference.id,options.recoveryOptions
    ).then(function(recoveryResult){
      if(recoveryResult&&recoveryResult.ok&&
        (recoveryResult.status==='cloud_linked'||
          recoveryResult.status===
            'cloud_linked_local_changes_pending')){
        lastResult=result(true,'linked',Object.assign({
          linked:true,
          localConferenceId:conference.id
        },recoveryResult.data||{}));
        return lastResult;
      }
      lastResult=recoveryResult;
      return recoveryResult;
    }).catch(function(){
      lastResult=result(false,'recovery_failed',{linked:false});
      return lastResult;
    }).finally(function(){
      if(evaluationPromises[conference.id]===flight){
        delete evaluationPromises[conference.id];
      }
    });
    evaluationPromises[conference.id]=flight;
    return flight;
  }

  function ensureCurrentConferenceLinked(options){
    return evaluate(options);
  }

  function getState(){
    return {
      initialized:initialized,
      bootstrapComplete:bootstrapComplete,
      evaluatingConferenceIds:Object.keys(evaluationPromises),
      lastResult:lastResult
    };
  }

  function resetForTests(){
    initialized=false;
    bootstrapComplete=false;
    initializationPromise=null;
    evaluationPromises={};
    lastResult=null;
    return {ok:true,status:'reset'};
  }

  global.AutomaticConferenceLinking=Object.freeze({
    initialize:initialize,
    evaluate:evaluate,
    ensureCurrentConferenceLinked:ensureCurrentConferenceLinked,
    ensureLinkedLifecycle:ensureLinkedLifecycle,
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
