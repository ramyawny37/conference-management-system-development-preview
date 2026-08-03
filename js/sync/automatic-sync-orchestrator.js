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
  var evaluationFollowUpRequested=false;
  var connectivityPromise=null;
  var onlineHandler=null;
  var offlineHandler=null;
  var lastNotificationFingerprint=null;
  var realtimeConferenceId=null;
  var realtimeStatus='disconnected';
  var realtimeError=null;
  var realtimeGeneration=0;
  var realtimeCleanupPending=false;
  var realtimeCleanupPromise=Promise.resolve();
  var activeOptions=null;
  var diagnostics={
    lastScheduledReason:null,
    lastEvaluationReasons:[],
    lastEvaluationStartedAt:null,
    lastEvaluationFinishedAt:null,
    lastResolverStatus:null,
    lastRunLinkedConferenceAt:null,
    lastRunnerInvocationAt:null,
    lastRunnerResultStatus:'runner_not_invoked',
    lastRunnerWaitingReason:null,
    lastStopReason:null
  };

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function publicState(){
    var snapshot=copy(state);
    snapshot.realtimeStatus=realtimeStatus;
    snapshot.realtimeConferenceId=realtimeConferenceId;
    snapshot.realtimeError=realtimeError?copy(realtimeError):null;
    snapshot.lastScheduledReason=diagnostics.lastScheduledReason;
    snapshot.scheduledReasonCount=state.scheduledReasons.length;
    snapshot.debouncePending=!!debounceTimer;
    snapshot.evaluationInProgress=!!evaluationPromise||state.evaluating===true;
    snapshot.followUpPending=evaluationFollowUpRequested;
    snapshot.lastEvaluationReasons=diagnostics.lastEvaluationReasons.slice();
    snapshot.lastEvaluationStartedAt=diagnostics.lastEvaluationStartedAt;
    snapshot.lastEvaluationFinishedAt=diagnostics.lastEvaluationFinishedAt;
    snapshot.lastResolverStatus=diagnostics.lastResolverStatus;
    snapshot.lastRunLinkedConferenceAt=
      diagnostics.lastRunLinkedConferenceAt;
    snapshot.lastRunnerInvocationAt=diagnostics.lastRunnerInvocationAt;
    snapshot.lastRunnerResultStatus=diagnostics.lastRunnerResultStatus;
    snapshot.lastRunnerWaitingReason=diagnostics.lastRunnerWaitingReason;
    snapshot.lastStopReason=diagnostics.lastStopReason;
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
      realtimeStatus:realtimeStatus,
      realtimeConferenceId:realtimeConferenceId,
      lastError:snapshot.lastError&&snapshot.lastError.code,
      lastSafeError:snapshot.lastSafeError&&snapshot.lastSafeError.code
    });
    if(fingerprint===lastNotificationFingerprint)return;
    lastNotificationFingerprint=fingerprint;
    listeners.slice().forEach(function(listener){
      try{listener(snapshot);}catch(error){}
    });
  }

  function realtimeState(){
    return {
      status:realtimeStatus,
      conferenceId:realtimeConferenceId,
      error:realtimeError?copy(realtimeError):null
    };
  }

  function restoreIsolationPending(options){
    var service=options&&options.fullBackupService||
      global.FullBackupService;
    if(!service||
      typeof service.isFullRestoreCloudReviewPending!=='function'){
      return false;
    }
    try{
      return service.isFullRestoreCloudReviewPending({
        storage:options&&options.storage
      })===true;
    }catch(error){return true;}
  }

  function manualRelinkPending(localConferenceId,options){
    var service=options&&options.fullBackupService||
      global.FullBackupService;
    if(!localConferenceId||!service||
      typeof service.isManualRelinkRequired!=='function'){
      return false;
    }
    try{
      return service.isManualRelinkRequired(localConferenceId,{
        storage:options&&options.storage
      })===true;
    }catch(error){return true;}
  }

  function disconnectRealtime(options){
    var integration=options&&options.integration||
      global.OfflineFirstIntegration;
    var operationGeneration=++realtimeGeneration;
    var previousConferenceId=realtimeConferenceId;
    if(!integration||
      typeof integration.disconnectRealtime!=='function'){
      realtimeStatus='disconnected';
      realtimeConferenceId=null;
      realtimeError=null;
      return Promise.resolve({ok:true,status:'unavailable'});
    }
    realtimeStatus='disconnecting';
    realtimeCleanupPending=true;
    var cleanup=Promise.resolve(integration.disconnectRealtime({
      realtime:options&&options.realtime,
      realtimeOptions:options&&options.realtimeOptions
    })).then(function(disconnected){
      if(operationGeneration!==realtimeGeneration)return disconnected;
      realtimeStatus=disconnected&&disconnected.ok===false
        ?'error'
        :'disconnected';
      realtimeConferenceId=disconnected&&disconnected.ok===false
        ?previousConferenceId
        :null;
      realtimeError=disconnected&&disconnected.ok===false
        ?disconnected.error||{code:'REALTIME_DISCONNECT_FAILED'}
        :null;
      notify();
      return disconnected;
    }).catch(function(error){
      if(operationGeneration!==realtimeGeneration){
        return {ok:false,status:'stale_disconnect'};
      }
      realtimeStatus='error';
      realtimeConferenceId=previousConferenceId;
      realtimeError={
        code:'REALTIME_DISCONNECT_FAILED',
        message:String(error&&error.message||'Realtime disconnect failed.')
      };
      notify();
      return {ok:false,status:'error',error:copy(realtimeError)};
    }).finally(function(){
      if(operationGeneration===realtimeGeneration){
        realtimeCleanupPending=false;
      }
    });
    realtimeCleanupPromise=cleanup;
    return cleanup;
  }

  function ensureRealtime(resolved,options){
    var data=resolved&&resolved.data||{};
    var remoteConferenceId=String(
      data.remoteConferenceId||
      data.link&&data.link.remoteConferenceId||
      ''
    );
    if(!remoteConferenceId){
      return realtimeConferenceId
        ?disconnectRealtime(options).then(realtimeState)
        :Promise.resolve(realtimeState());
    }
    var integration=options&&options.integration||
      global.OfflineFirstIntegration;
    if(!integration||typeof integration.connectRealtime!=='function'){
      realtimeStatus='unavailable';
      realtimeConferenceId=null;
      return Promise.resolve(realtimeState());
    }
    if(realtimeConferenceId===remoteConferenceId&&
      realtimeStatus==='connected'){
      return Promise.resolve(realtimeState());
    }
    if(realtimeConferenceId&&
      (realtimeConferenceId!==remoteConferenceId||
      realtimeStatus==='error')){
      return disconnectRealtime(options).then(function(disconnected){
        return disconnected&&disconnected.ok===false
          ?realtimeState()
          :ensureRealtime(resolved,options);
      });
    }
    if(realtimeStatus==='connecting')return Promise.resolve(realtimeState());
    var operationGeneration=++realtimeGeneration;
    realtimeStatus='connecting';
    realtimeConferenceId=remoteConferenceId;
    realtimeError=null;
    return realtimeCleanupPromise.then(function(){
      if(operationGeneration!==realtimeGeneration)return realtimeState();
      return integration.connectRealtime(remoteConferenceId,{
        realtime:options&&options.realtime,
        realtimeOptions:options&&options.realtimeOptions,
        remoteUpdateStore:options&&options.remoteUpdateStore,
        deviceIdentity:options&&options.deviceIdentity,
        eventHandler:options&&options.realtimeEventHandler
      });
    }).then(function(connected){
      if(operationGeneration!==realtimeGeneration||
        realtimeConferenceId!==remoteConferenceId){
        return realtimeState();
      }
      var accepted=connected&&connected.ok===true&&
        (connected.status==='connected'||
        connected.status==='already_connected');
      realtimeStatus=accepted?'connected':
        connected&&connected.status==='connecting'?'connecting':'error';
      realtimeError=accepted||realtimeStatus==='connecting'
        ?null
        :connected&&connected.error||
          {code:connected&&connected.code||'REALTIME_CONNECT_FAILED'};
      notify();
      return realtimeState();
    }).catch(function(error){
      if(operationGeneration===realtimeGeneration&&
        realtimeConferenceId===remoteConferenceId){
        realtimeStatus='error';
        realtimeError={
          code:'REALTIME_CONNECT_FAILED',
          message:String(error&&error.message||'Realtime connect failed.')
        };
        notify();
      }
      return realtimeState();
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
    if(evaluationPromise){
      evaluationFollowUpRequested=true;
      return evaluationPromise;
    }
    var generation=state.generation;
    var reasons=state.scheduledReasons.slice();
    state.evaluating=true;
    var flight=Promise.resolve().then(function(){
      if(generation!==state.generation||!state.started)return publicState();
      state.scheduledReasons=[];
      diagnostics.lastEvaluationReasons=reasons.slice();
      diagnostics.lastEvaluationStartedAt=new Date().toISOString();
      return evaluateConnectivity(options).then(function(connectivityState){
        if(generation!==state.generation||!state.started||
          connectivityState.connectivity!=='online'||
          reasons.indexOf('offline_event')>=0&&reasons.length===1){
          if(connectivityState.connectivity!=='online'){
            return disconnectRealtime(options).then(function(){
              return connectivityState;
            });
          }
          return connectivityState;
        }
        var linkingLocalConferenceId=currentLocalConferenceId(options);
        var resolver=options.stateResolver||
          global.ConferenceSyncStateResolver;
        var inspectLinkedContext=function(resolved){
          var integration=options.integration||
            global.OfflineFirstIntegration;
          var available=!!(integration&&
            typeof integration.getConferenceSyncState==='function');
          var integrationState=null;
          if(available){
            try{
              integrationState=integration.getConferenceSyncState(
                linkingLocalConferenceId
              );
            }catch(error){
              available=false;
            }
          }
          var context=integrationState&&integrationState.context;
          var link=resolved&&resolved.data&&resolved.data.link;
          return {
            available:available,
            actualContextPresent:!!context,
            contextCompatible:!!(context&&link&&
              String(context.localConferenceId||'')===
                String(linkingLocalConferenceId||'')&&
              String(context.conferenceId||'')===
                String(link.remoteConferenceId||'')&&
              context.baseRevision===link.knownRevision),
            link:link||null
          };
        };
        var resolveState=function(){
          if(!linkingLocalConferenceId||!resolver||
            typeof resolver.resolve!=='function'){
            diagnostics.lastResolverStatus='resolver_unavailable';
            return Promise.resolve(null);
          }
          return resolver.resolve({
            localConferenceId:linkingLocalConferenceId
          },options.stateResolverOptions).then(function(resolved){
            diagnostics.lastResolverStatus=resolved&&resolved.status||null;
            return resolved;
          });
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
        var runLinkedConference=function(connectivityState,resolvedState){
          diagnostics.lastRunLinkedConferenceAt=new Date().toISOString();
          if(staleResult())return Promise.resolve(publicState());
          if(restoreIsolationPending(options)||
            manualRelinkPending(linkingLocalConferenceId,options)||
            global.navigator&&global.navigator.onLine===false){
            state.conferenceState=restoreIsolationPending(options)
              ?'restore_isolated'
              :manualRelinkPending(linkingLocalConferenceId,options)
                ?'manual_relink_required'
                :'offline';
            state.linkedConferenceId=null;
            diagnostics.lastStopReason=state.conferenceState;
            return disconnectRealtime(options).then(publicState);
          }
          state.conferenceState='linked';
          state.linkedConferenceId=linkingLocalConferenceId;
          notify();
          var runner=options.queueRunner||global.AutomaticQueueRunner;
          var runQueue;
          if(!runner||typeof runner.run!=='function'){
            diagnostics.lastRunnerResultStatus='runner_not_invoked';
            diagnostics.lastRunnerWaitingReason=null;
            runQueue=Promise.resolve();
          }else{
            diagnostics.lastRunnerInvocationAt=new Date().toISOString();
            runQueue=runner.run(Object.assign(
              {},options.queueRunnerOptions||{}, {
                connectivity:connectivityState.connectivity,
                reasons:reasons,
                orchestrator:global.AutomaticSyncOrchestrator
              }
            ));
          }
          return Promise.resolve(runQueue).then(function(queueResult){
            if(runner&&typeof runner.run==='function'){
              diagnostics.lastRunnerResultStatus=
                queueResult&&queueResult.status||null;
              diagnostics.lastRunnerWaitingReason=
                queueResult&&queueResult.status==='waiting'&&
                queueResult.data&&queueResult.data.reason||null;
            }
            if(queueResult&&queueResult.ok===false||
              generation!==state.generation||!state.started||
              currentLocalConferenceId(options)!==linkingLocalConferenceId||
              global.navigator&&global.navigator.onLine===false||
              restoreIsolationPending(options)||
              manualRelinkPending(linkingLocalConferenceId,options)){
              if(currentLocalConferenceId(options)!==
                linkingLocalConferenceId&&state.started){
                schedule('conference_changed',options);
              }
              return disconnectRealtime(options);
            }
            return resolveState().then(function(latest){
              var expectedRemote=resolvedState&&resolvedState.data&&
                (resolvedState.data.remoteConferenceId||
                resolvedState.data.link&&
                  resolvedState.data.link.remoteConferenceId);
              var latestRemote=latest&&latest.data&&
                (latest.data.remoteConferenceId||
                latest.data.link&&latest.data.link.remoteConferenceId);
              if(!latest||!latest.ok||latest.status!=='linked'||
                !latestRemote||latestRemote!==expectedRemote){
                return disconnectRealtime(options);
              }
              if(latest.data&&latest.data.link&&
                latest.data.link.linkStatus==='cloud_linked'){
                var manager=options.realtimeManager||
                  global.ConferenceRealtimeManager;
                var appData=options.appData||global.appData;
                if(!manager||
                  typeof manager.prepareAndSubscribe!=='function'||
                  !appData){
                  return disconnectRealtime(options);
                }
                return disconnectRealtime(options).then(function(){
                  return manager.prepareAndSubscribe(
                    appData,
                    linkingLocalConferenceId,
                    Object.assign(
                      {},options.realtimeManagerOptions||{},{
                        realtime:options.realtime
                      }
                    )
                  );
                });
              }
              return ensureRealtime(latest,options);
            });
          }).then(function(){
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
        var stopForLinkedContext=function(status){
          state.conferenceState=status;
          state.linkedConferenceId=null;
          diagnostics.lastStopReason=status;
          return disconnectRealtime(options).then(publicState);
        };
        var restoreLinkedThenRun=function(connectivityState){
          var linker=options.automaticLinking||
            global.AutomaticConferenceLinking;
          if(!linker||typeof linker.evaluate!=='function'){
            return stopForLinkedContext('linked_context_unavailable');
          }
          return Promise.resolve().then(function(){
            return linker.evaluate(Object.assign(
              {},options.automaticLinkingOptions||{}, {
                connectivity:connectivityState.connectivity,
                reason:reasons.join(',')
              }
            ));
          }).catch(function(){
            return null;
          }).then(function(linkResult){
            if(staleResult())return publicState();
            if(!linkResult||!linkResult.ok||
              linkResult.status!=='already_linked'||
              !linkResult.data||linkResult.data.linked!==true||
              linkResult.data.contextRestored!==true){
              return stopForLinkedContext('linked_context_missing');
            }
            return resolveState().then(function(afterRestore){
              var restored=inspectLinkedContext(afterRestore);
              if(!afterRestore||!afterRestore.ok||
                afterRestore.status!=='linked'||
                !restored.contextCompatible){
                return stopForLinkedContext(
                  restored.available
                    ?'linked_context_missing'
                    :'linked_context_unavailable'
                );
              }
              return runLinkedConference(
                connectivityState,afterRestore
              );
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
                    return runLinkedConference(
                      connectivityState,
                      afterFinalization
                    );
                  }
                }
                return publicState();
              });
            });
          }
          if(resolved&&resolved.ok&&resolved.status==='linked'){
            var linkedContext=inspectLinkedContext(resolved);
            if(linkedContext.contextCompatible){
              return runLinkedConference(connectivityState,resolved);
            }
            if(restoreIsolationPending(options)||
              manualRelinkPending(linkingLocalConferenceId,options)||
              global.navigator&&global.navigator.onLine===false){
              return runLinkedConference(connectivityState,resolved);
            }
            if(!linkedContext.available){
              return stopForLinkedContext(
                'linked_context_unavailable'
              );
            }
            if(!linkedContext.link||
              linkedContext.link.linkStatus!=='linked'){
              return stopForLinkedContext('linked_context_missing');
            }
            return restoreLinkedThenRun(connectivityState);
          }
          if(resolved&&resolved.ok&&
            resolved.status!=='local_only'){
            state.conferenceState=resolved.status;
            state.linkedConferenceId=null;
            return disconnectRealtime(options).then(publicState);
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
              return disconnectRealtime(options).then(publicState);
            }
            return resolveState().then(function(afterLink){
              return runLinkedConference(connectivityState,afterLink);
            });
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
      if(generation===state.generation){
        diagnostics.lastEvaluationFinishedAt=new Date().toISOString();
      }
      if(evaluationPromise===flight){
        evaluationPromise=null;
        var followUpRequired=evaluationFollowUpRequested||
          state.scheduledReasons.length>0;
        evaluationFollowUpRequested=false;
        if(generation===state.generation&&state.started&&
          followUpRequired&&!debounceTimer){
          debounceTimer=global.setTimeout(function(){
            debounceTimer=null;
            evaluateScheduled(options);
          },Number.isInteger(options.debounceMs)
            ?Math.max(0,options.debounceMs)
            :DEBOUNCE_MS);
        }
      }
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
    diagnostics.lastScheduledReason=reason;
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
    if(restoreIsolationPending(options)){
      state.conferenceState='restore_isolated';
      state.connectivity='stopped';
      state.lastError={
        code:'FULL_RESTORE_CLOUD_REVIEW_PENDING',
        message:'Realtime and queue processing are isolated.'
      };
      notify();
      return {
        ok:false,
        status:'restore_isolated',
        code:'FULL_RESTORE_CLOUD_REVIEW_PENDING'
      };
    }
    if(realtimeCleanupPending){
      return {
        ok:false,
        status:'realtime_cleanup_pending',
        code:'REALTIME_CLEANUP_PENDING',
        promise:realtimeCleanupPromise
      };
    }
    if(!preferences(options).cloudSyncEnabled){
      state.conferenceState='cloud_disabled';
      state.connectivity='stopped';
      state.lastError=null;
      notify();
      return {ok:true,status:'cloud_disabled'};
    }
    state.started=true;
    diagnostics.lastStopReason=null;
    activeOptions=options;
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
    evaluationFollowUpRequested=false;
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
    diagnostics.lastStopReason='stopped';
    state.generation++;
    connectivityPromise=null;
    evaluationPromise=null;
    evaluationFollowUpRequested=false;
    state.evaluating=false;
    state.checkingConnectivity=false;
    state.connectivity='stopped';
    if(global.AutomaticQueueRunner&&
      typeof global.AutomaticQueueRunner.stop==='function'){
      global.AutomaticQueueRunner.stop();
    }
    var realtimeStop=disconnectRealtime(activeOptions);
    var manager=activeOptions&&activeOptions.realtimeManager||
      global.ConferenceRealtimeManager;
    var managerStop=manager&&typeof manager.stopAll==='function'
      ?manager.stopAll(activeOptions&&
        activeOptions.realtimeManagerOptions)
      :Promise.resolve();
    activeOptions=null;
    notify();
    return {
      ok:true,
      status:'stopped',
      promise:Promise.all([realtimeStop,managerStop])
    };
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
    getRealtimeState:realtimeState,
    subscribe:subscribe,
    clearScheduledWork:clearScheduledWork
  });
})(window);
