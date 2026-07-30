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
      getCurrentConference:options.getCurrentConference||
        global.getCurrentConference,
      getAppData:options.getAppData||function(){return global.appData;},
      navigator:options.navigator||global.navigator,
      orchestrator:options.orchestrator||global.AutomaticSyncOrchestrator
    };
  }

  function skip(status,data){
    lastResult=result(true,status,Object.assign({linked:false},data||{}));
    return Promise.resolve(lastResult);
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
    if(global.FullBackupService&&
      typeof global.FullBackupService.isManualRelinkRequired==='function'&&
      global.FullBackupService.isManualRelinkRequired(conference.id)){
      return skip('manual_relink_required');
    }
    if(evaluationPromises[conference.id]){
      return evaluationPromises[conference.id];
    }
    var existing=d.links&&d.links.get(conference.id);
    if(existing&&existing.linkStatus==='linked'){
      return skip('already_linked',{
        linked:true,
        localConferenceId:conference.id,
        remoteConferenceId:existing.remoteConferenceId,
        revision:existing.knownRevision
      });
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
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
