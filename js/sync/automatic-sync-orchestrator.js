(function(global){
  'use strict';

  var DEBOUNCE_MS=2000;
  var ALLOWED_REASONS=Object.freeze([
    'startup','local_save','online_event','offline_event','auth_changed',
    'conference_changed','manual_retry','backoff_elapsed',
    'preferences_changed'
  ]);
  var state=global.SyncSchedulerState.create();
  var listeners=[];
  var debounceTimer=null;
  var evaluationPromise=null;
  var connectivityPromise=null;
  var onlineHandler=null;
  var offlineHandler=null;
  var lastNotificationFingerprint=null;

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function publicState(){
    var snapshot=copy(state);
    var runner=global.AutomaticQueueRunner;
    if(runner&&typeof runner.getState==='function'){
      Object.assign(snapshot,runner.getState());
    }
    return snapshot;
  }

  function notify(){
    var snapshot=publicState();
    var fingerprint=JSON.stringify({
      started:snapshot.started,
      connectivity:snapshot.connectivity,
      conferenceState:snapshot.conferenceState,
      linkedConferenceId:snapshot.linkedConferenceId,
      queueStatus:snapshot.queueStatus,
      activeConferenceId:snapshot.activeConferenceId,
      pendingCount:snapshot.pendingCount,
      conflictCount:snapshot.conflictCount,
      nextRetryAt:snapshot.nextRetryAt,
      lastError:snapshot.lastError&&snapshot.lastError.code,
      lastSafeError:snapshot.lastSafeError&&snapshot.lastSafeError.code
    });
    if(fingerprint===lastNotificationFingerprint)return;
    lastNotificationFingerprint=fingerprint;
    listeners.slice().forEach(function(listener){
      try{listener(snapshot);}catch(error){}
    });
  }

  function updateConnectivity(value,error){
    if(!global.SyncSchedulerState.isConnectivity(value))return;
    state.connectivity=value;
    state.lastError=error?{
      code:String(error.code||'CONNECTIVITY_CHECK_FAILED'),
      message:'تعذر التحقق من خدمة المزامنة.'
    }:null;
    notify();
  }

  function preferences(options){
    var api=options&&options.preferences||global.AutomaticSyncPreferences;
    return api&&typeof api.get==='function'
      ?api.get(options&&options.preferenceOptions)
      :{cloudSyncEnabled:false};
  }

  function authState(options){
    var auth=options&&options.auth||global.SupabaseAuth;
    return auth&&typeof auth.getState==='function'
      ?auth.getState()
      :{authenticated:false};
  }

  function clientState(options){
    var layer=options&&options.clientLayer||global.SupabaseClientLayer;
    return {
      layer:layer,
      state:layer&&typeof layer.getState==='function'
        ?layer.getState()
        :{configured:false,available:false},
      client:layer&&typeof layer.getClient==='function'
        ?layer.getClient()
        :null
    };
  }

  function currentLocalConferenceId(options){
    var getter=options&&options.getCurrentConference||
      global.getCurrentConference;
    if(typeof getter!=='function')return null;
    try{
      var conference=getter();
      return conference&&conference.id
        ?String(conference.id)
        :null;
    }catch(error){
      return null;
    }
  }

  function defaultServiceCheck(client){
    return Promise.resolve().then(function(){
      return client.from('conference_members')
        .select('conference_id',{head:true,count:'exact'})
        .limit(1);
    }).then(function(response){
      if(response&&response.error)throw response.error;
      return {available:true};
    });
  }

  function evaluateConnectivity(options){
    options=options&&typeof options==='object'?options:{};
    if(connectivityPromise)return connectivityPromise;
    var generation=state.generation;
    if(!state.started&&options.allowWhenStopped!==true){
      return Promise.resolve(publicState());
    }
    var prefs=preferences(options);
    if(!prefs.cloudSyncEnabled){
      state.conferenceState='cloud_disabled';
      updateConnectivity('stopped');
      return Promise.resolve(publicState());
    }
    if(global.navigator&&global.navigator.onLine===false){
      state.conferenceState='offline_pending';
      updateConnectivity('browser_offline');
      return Promise.resolve(publicState());
    }
    var auth=authState(options);
    if(!auth.authenticated){
      state.conferenceState='auth_required';
      updateConnectivity('auth_required');
      return Promise.resolve(publicState());
    }
    var client=clientState(options);
    if((!client.state.configured||!client.state.available)&&
      global.SupabaseRuntimeConfig&&
      typeof global.SupabaseRuntimeConfig.configureClient==='function'){
      global.SupabaseRuntimeConfig.configureClient();
      client=clientState(options);
    }
    if(!client.state.configured||!client.state.available||!client.client){
      updateConnectivity('service_unreachable');
      return Promise.resolve(publicState());
    }
    state.checkingConnectivity=true;
    updateConnectivity('checking');
    var checker=typeof options.serviceCheck==='function'
      ?options.serviceCheck
      :defaultServiceCheck;
    var flight=Promise.resolve().then(function(){
      return checker(client.client);
    }).then(function(result){
      if(generation!==state.generation||!state.started)return publicState();
      if(result&&result.authRequired===true){
        state.conferenceState='auth_required';
        updateConnectivity('auth_required');
      }else if(result&&result.available===true){
        updateConnectivity('online');
      }else{
        updateConnectivity('service_unreachable');
      }
      return publicState();
    }).catch(function(error){
      if(generation===state.generation&&state.started){
        var code=String(error&&error.code||'');
        var authFailure=code==='401'||code==='403'||
          code==='PGRST301'||code==='AUTH_REQUIRED';
        if(authFailure){
          state.conferenceState='auth_required';
          updateConnectivity('auth_required');
        }else updateConnectivity('service_unreachable',error);
      }
      return publicState();
    }).then(function(result){
      if(generation===state.generation){
        state.checkingConnectivity=false;
        state.lastConnectivityCheckAt=new Date().toISOString();
      }
      if(connectivityPromise===flight)connectivityPromise=null;
      return result;
    },function(){
      if(generation===state.generation)state.checkingConnectivity=false;
      if(connectivityPromise===flight)connectivityPromise=null;
      return publicState();
    });
    connectivityPromise=flight;
    return connectivityPromise;
  }

  function evaluateScheduled(options){
    if(evaluationPromise)return evaluationPromise;
    var generation=state.generation;
    var reasons=state.scheduledReasons.slice();
    state.evaluating=true;
    var flight=Promise.resolve().then(function(){
      if(generation!==state.generation||!state.started)return publicState();
      state.scheduledReasons=[];
      return evaluateConnectivity(options).then(function(connectivityState){
        if(generation!==state.generation||!state.started||
          connectivityState.connectivity!=='online'||
          reasons.indexOf('offline_event')>=0&&reasons.length===1){
          return connectivityState;
        }
        var linkingLocalConferenceId=currentLocalConferenceId(options);
        var resolver=options.stateResolver||
          global.ConferenceSyncStateResolver;
        var resolveState=function(){
          if(!linkingLocalConferenceId||!resolver||
            typeof resolver.resolve!=='function'){
            return Promise.resolve(null);
          }
          return resolver.resolve({
            localConferenceId:linkingLocalConferenceId
          },options.stateResolverOptions);
        };
        var staleResult=function(){
          if(currentLocalConferenceId(options)===linkingLocalConferenceId){
            return false;
          }
          state.conferenceState='link_stale';
          state.linkedConferenceId=null;
          global.setTimeout(function(){
            if(state.started)schedule('conference_changed',options);
          },0);
          return true;
        };
        var runLinkedConference=function(connectivityState){
          if(staleResult())return Promise.resolve(publicState());
          state.conferenceState='linked';
          state.linkedConferenceId=linkingLocalConferenceId;
          notify();
          var runner=options.queueRunner||global.AutomaticQueueRunner;
          if(!runner||typeof runner.run!=='function'){
            return Promise.resolve(publicState());
          }
          return runner.run(Object.assign({},options.queueRunnerOptions||{},{
            connectivity:connectivityState.connectivity,
            reasons:reasons,
            orchestrator:global.AutomaticSyncOrchestrator
          })).then(function(){
            return resolveState().then(function(afterRun){
              if(staleResult())return publicState();
              if(afterRun&&afterRun.ok){
                state.conferenceState=afterRun.status;
                if(afterRun.status!=='linked'){
                  state.linkedConferenceId=null;
                }
              }
              return publicState();
            });
          });
        };
        var recoverOrRoute=function(resolved,connectivityState){
          if(staleResult())return Promise.resolve(publicState());
          if(resolved&&resolved.ok&&
            resolved.status==='finalizing_conflict'){
            state.conferenceState='finalizing_conflict';
            state.linkedConferenceId=null;
            notify();
            var finalizer=options.finalizationService||
              global.ConflictFinalizationService;
            if(!finalizer||typeof finalizer.finalize!=='function'){
              return Promise.resolve(publicState());
            }
            return finalizer.finalize(
              linkingLocalConferenceId,
              options.finalizationOptions
            ).then(function(){
              if(staleResult())return publicState();
              return resolveState().then(function(afterFinalization){
                if(afterFinalization&&afterFinalization.ok){
                  state.conferenceState=afterFinalization.status;
                  if(afterFinalization.status==='linked'){
                    return runLinkedConference(connectivityState);
                  }
                }
                return publicState();
              });
            });
          }
          if(resolved&&resolved.ok&&resolved.status==='linked'){
            return runLinkedConference(connectivityState);
          }
          if(resolved&&resolved.ok&&
            resolved.status!=='local_only'){
            state.conferenceState=resolved.status;
            state.linkedConferenceId=null;
            return Promise.resolve(publicState());
          }
          var linker=options.automaticLinking||
            global.AutomaticConferenceLinking;
          var linking=linker&&typeof linker.evaluate==='function'
            ?linker.evaluate(Object.assign(
              {},options.automaticLinkingOptions||{},{
                connectivity:connectivityState.connectivity,
                reason:reasons.join(',')
              }
            ))
            :Promise.resolve({
              ok:true,status:'unavailable',data:{linked:true}
            });
          return linking.then(function(linkResult){
            if(staleResult())return publicState();
            if(linker&&(!linkResult||!linkResult.data||
              linkResult.data.linked!==true)){
              return publicState();
            }
            return runLinkedConference(connectivityState);
          });
        };
        return resolveState().then(function(resolved){
          return recoverOrRoute(resolved,connectivityState);
        });
      });
    }).then(function(result){
      if(generation===state.generation){
        state.lastEvaluationAt=new Date().toISOString();
      }
      return result;
    }).finally(function(){
      if(generation===state.generation)state.evaluating=false;
      if(evaluationPromise===flight)evaluationPromise=null;
      if(generation===state.generation)notify();
    });
    evaluationPromise=flight;
    return evaluationPromise;
  }

  function schedule(reason,options){
    reason=String(reason||'');
    options=options&&typeof options==='object'?options:{};
    if(ALLOWED_REASONS.indexOf(reason)<0){
      return {ok:false,status:'invalid_reason'};
    }
    if(!state.started)return {ok:false,status:'stopped'};
    if(state.scheduledReasons.indexOf(reason)<0){
      state.scheduledReasons.push(reason);
    }
    if(debounceTimer)global.clearTimeout(debounceTimer);
    debounceTimer=global.setTimeout(function(){
      debounceTimer=null;
      evaluateScheduled(options);
    },Number.isInteger(options.debounceMs)
      ?Math.max(0,options.debounceMs)
      :DEBOUNCE_MS);
    notify();
    return {ok:true,status:'scheduled',data:{reasons:state.scheduledReasons.slice()}};
  }

  function start(options){
    options=options&&typeof options==='object'?options:{};
    if(state.started)return {ok:true,status:'already_started'};
    if(!preferences(options).cloudSyncEnabled){
      state.conferenceState='cloud_disabled';
      state.connectivity='stopped';
      state.lastError=null;
      notify();
      return {ok:true,status:'cloud_disabled'};
    }
    state.started=true;
    state.generation++;
    state.connectivity='unknown';
    state.conferenceState='local_only';
    state.linkedConferenceId=null;
    onlineHandler=function(){schedule('online_event',options);};
    offlineHandler=function(){schedule('offline_event',options);};
    if(global.addEventListener){
      global.addEventListener('online',onlineHandler);
      global.addEventListener('offline',offlineHandler);
    }
    schedule('startup',options);
    notify();
    return {ok:true,status:'started'};
  }

  function clearScheduledWork(){
    if(debounceTimer){
      global.clearTimeout(debounceTimer);
      debounceTimer=null;
    }
    state.scheduledReasons=[];
    notify();
    return {ok:true,status:'cleared'};
  }

  function stop(){
    if(onlineHandler&&global.removeEventListener){
      global.removeEventListener('online',onlineHandler);
      global.removeEventListener('offline',offlineHandler);
    }
    onlineHandler=null;
    offlineHandler=null;
    clearScheduledWork();
    state.started=false;
    state.generation++;
    connectivityPromise=null;
    evaluationPromise=null;
    state.evaluating=false;
    state.checkingConnectivity=false;
    state.connectivity='stopped';
    if(global.AutomaticQueueRunner&&
      typeof global.AutomaticQueueRunner.stop==='function'){
      global.AutomaticQueueRunner.stop();
    }
    notify();
    return {ok:true,status:'stopped'};
  }

  function subscribe(listener){
    if(typeof listener!=='function')return function(){};
    listeners.push(listener);
    return function(){
      var index=listeners.indexOf(listener);
      if(index>=0)listeners.splice(index,1);
    };
  }

  global.AutomaticSyncOrchestrator=Object.freeze({
    debounceMs:DEBOUNCE_MS,
    triggerReasons:ALLOWED_REASONS,
    start:start,
    stop:stop,
    schedule:schedule,
    evaluateConnectivity:evaluateConnectivity,
    getState:publicState,
    subscribe:subscribe,
    clearScheduledWork:clearScheduledWork
  });
})(window);
