(function(global){
  'use strict';

  var MAX_OPERATIONS=20;
  var BACKOFF_DELAYS=Object.freeze([5000,15000,30000,60000,300000]);
  var runningPromise=null;
  var followUpRequested=false;
  var retryTimers=Object.create(null);
  var authBlockedOperations=Object.create(null);
  var stopped=false;
  var state={
    queueStatus:'idle',
    activeConferenceId:null,
    lastRunAt:null,
    lastSuccessfulSyncAt:null,
    lastSafeError:null,
    pendingCount:0,
    conflictCount:0,
    nextRetryAt:null
  };

  function clone(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function safeError(code){
    return {code:String(code||'AUTOMATIC_QUEUE_ERROR'),
      message:'Automatic synchronization could not continue.'};
  }
  function result(ok,status,data,error){
    return {ok:ok,status:status,data:data||null,error:error||null};
  }
  function getState(){return clone(state);}
  function setStatus(status,error){
    state.queueStatus=status;
    state.lastSafeError=error?safeError(error.code||error):null;
  }
  function calculateBackoffDelay(attempt,jitterValue){
    attempt=Number.isInteger(attempt)&&attempt>0?attempt:1;
    var base=BACKOFF_DELAYS[Math.min(attempt-1,BACKOFF_DELAYS.length-1)];
    var jitter=typeof jitterValue==='number'
      ?Math.max(-1,Math.min(1,jitterValue))
      :(Math.random()*2)-1;
    return Math.round(base*(1+(jitter*0.2)));
  }
  function preferences(options){
    var api=options.preferences||global.AutomaticSyncPreferences;
    return api&&typeof api.get==='function'?api.get(options.preferenceOptions):{};
  }
  function dependencyState(options){
    var client=options.clientLayer||global.SupabaseClientLayer;
    var auth=options.auth||global.SupabaseAuth;
    return {
      client:client&&typeof client.getState==='function'?client.getState():{},
      auth:auth&&typeof auth.getState==='function'?auth.getState():{}
    };
  }
  function resolveDevice(options){
    var identity=options.deviceIdentity||global.SupabaseDeviceIdentity;
    try{
      var value=identity&&typeof identity.getOrCreate==='function'
        ?identity.getOrCreate():null;
      return value&&value.id?String(value.id):null;
    }catch(error){return null;}
  }
  function waitingReason(options){
    var prefs=preferences(options);
    var manual=Array.isArray(options.reasons)&&
      options.reasons.indexOf('manual_retry')>=0;
    if(!prefs.cloudSyncEnabled)return 'CLOUD_SYNC_DISABLED';
    if(!prefs.automaticSyncEnabled&&!manual)return 'AUTOMATIC_SYNC_DISABLED';
    if(options.connectivity!=='online')return 'CONNECTION_NOT_ONLINE';
    var dependencies=dependencyState(options);
    if(!dependencies.client.configured||!dependencies.client.available){
      return 'RUNTIME_CONFIG_UNAVAILABLE';
    }
    if(!dependencies.auth.authenticated)return 'AUTH_REQUIRED';
    if(!resolveDevice(options))return 'DEVICE_ID_UNAVAILABLE';
    return null;
  }
  function resolveLink(operation,options){
    var store=options.linkStore||global.ConferenceLinkStore;
    return store&&typeof store.findByRemoteId==='function'
      ?store.findByRemoteId(operation.conferenceId,options.linkOptions)
      :null;
  }
  function isSafeLink(link){
    return !!(link&&
      (link.linkStatus==='linked'||link.linkStatus==='unsynced')&&
      link.pendingLocalApplication!==true&&
      !link.conflictId&&
      link.conflictStatus!=='active');
  }
  function pendingApplicationBlocks(link,options){
    var store=options.pendingApplicationStore||
      global.PendingRemoteApplicationStore;
    if(!store||typeof store.get!=='function')return Promise.resolve(false);
    return Promise.resolve(store.get(
      link.localConferenceId,
      options.pendingApplicationOptions
    )).then(function(read){
      return !!(read&&read.ok&&read.data&&read.data.status==='pending');
    }).catch(function(){return true;});
  }
  function selectFair(operations,limit){
    var selected=[];
    var deferred=[];
    var seen=Object.create(null);
    operations.forEach(function(operation){
      var key=String(operation.conferenceId||'');
      if(!seen[key]&&selected.length<limit){
        seen[key]=true;
        selected.push(operation);
      }else deferred.push(operation);
    });
    deferred.some(function(operation){
      if(selected.length>=limit)return true;
      selected.push(operation);
      return false;
    });
    return selected;
  }
  function clearRetry(conferenceId){
    var entry=retryTimers[conferenceId];
    if(entry)global.clearTimeout(entry.timer);
    delete retryTimers[conferenceId];
  }
  function refreshNextRetry(){
    var values=Object.keys(retryTimers).map(function(key){
      return retryTimers[key].at;
    }).sort();
    state.nextRetryAt=values.length?values[0]:null;
  }
  function scheduleRetry(conferenceId,attempt,operationId,options){
    if(retryTimers[conferenceId])return;
    var delay=calculateBackoffDelay(attempt,options.jitterValue);
    var at=new Date(Date.now()+delay).toISOString();
    retryTimers[conferenceId]={
      at:at,
      timer:global.setTimeout(function(){
        delete retryTimers[conferenceId];
        refreshNextRetry();
        if(stopped)return;
        var queue=options.queue||global.OfflineSyncQueue;
        var orchestrator=options.orchestrator||global.AutomaticSyncOrchestrator;
        var retry=queue&&typeof queue.retryFailedOperation==='function'
          ?queue.retryFailedOperation(operationId,options.queueOptions)
          :Promise.resolve();
        Promise.resolve(retry).catch(function(){return null;}).then(function(){
          if(orchestrator&&typeof orchestrator.schedule==='function'){
            orchestrator.schedule('backoff_elapsed');
          }
        });
      },delay)
    };
    setStatus('backoff');
    refreshNextRetry();
  }
  function classify(processResult){
    if(processResult&&
      (processResult.status==='applied'||processResult.status==='duplicate')){
      return 'success';
    }
    if(processResult&&processResult.status==='conflict')return 'conflict';
    var code=String(processResult&&processResult.error&&
      processResult.error.code||'').toUpperCase();
    if(/AUTH|401|403/.test(code))return 'auth';
    if(/VALID|SCHEMA|PERMISSION|POLICY|FORBIDDEN/.test(code))return 'permanent';
    return 'temporary';
  }
  function classifyErrorCode(code){
    code=String(code||'').toUpperCase();
    if(/AUTH|401|403/.test(code))return 'auth';
    if(/VALID|SCHEMA|PERMISSION|POLICY|FORBIDDEN/.test(code)){
      return 'permanent';
    }
    return 'temporary';
  }
  function saveConflictLink(link,processResult,options){
    var store=options.linkStore||global.ConferenceLinkStore;
    if(!store||typeof store.save!=='function')return;
    store.save(Object.assign({},link,{
      linkStatus:'needs_resolution',
      actualRevision:processResult.data&&processResult.data.actualRevision,
      conflictId:processResult.data&&processResult.data.conflictId,
      conflictStatus:'active',
      lastConflictAt:new Date().toISOString()
    }),options.linkOptions);
  }
  function publishSuccessfulRevision(item,processResult,options){
    var integration=options.integration||global.OfflineFirstIntegration;
    if(!integration||
      typeof integration.applySuccessfulSyncRevision!=='function'){
      return Promise.resolve({ok:true,status:'publisher_unavailable'});
    }
    return integration.applySuccessfulSyncRevision(
      processResult,
      {
        operation:item.operation,
        queue:options.queue||global.OfflineSyncQueue,
        queueOptions:options.queueOptions,
        linkStore:options.linkStore||global.ConferenceLinkStore,
        linkOptions:options.linkOptions
      }
    );
  }
  function processSelected(selected,options){
    var processor=options.processor||global.SyncQueueProcessor;
    var outcomes=[];
    var blockedConferences=Object.create(null);
    var sequence=Promise.resolve();
    selected.forEach(function(item){
      sequence=sequence.then(function(){
        if(stopped||blockedConferences[item.operation.conferenceId])return;
        var dependencies=dependencyState(options);
        if(!dependencies.auth.authenticated){
          setStatus('waiting_for_auth');
          return;
        }
        state.activeConferenceId=item.operation.conferenceId;
        return processor.processOperation(item.operation.operationId,
          options.processorOptions).then(function(processResult){
          var category=classify(processResult);
          outcomes.push(processResult);
          if(category==='success'){
            return publishSuccessfulRevision(
              item,
              processResult,
              options
            ).then(function(published){
              if(!published||!published.ok||
                published.status==='revision_unavailable'){
                blockedConferences[item.operation.conferenceId]=true;
                setStatus('error','REVISION_PUBLISH_FAILED');
                return;
              }
              clearRetry(item.operation.conferenceId);
              state.lastSuccessfulSyncAt=new Date().toISOString();
            });
          }else if(category==='conflict'){
            clearRetry(item.operation.conferenceId);
            state.conflictCount++;
            saveConflictLink(item.link,processResult,options);
          }else if(category==='auth'){
            authBlockedOperations[item.operation.operationId]=true;
            setStatus('waiting_for_auth','AUTH_REQUIRED');
            stopped=true;
          }else if(category==='temporary'){
            var operation=processResult&&processResult.data&&
              processResult.data.operation;
            scheduleRetry(item.operation.conferenceId,
              operation&&operation.attempts||1,
              item.operation.operationId,options);
          }else{
            setStatus('error',processResult&&processResult.error||
              'PERMANENT_SYNC_ERROR');
          }
        });
      });
    });
    return sequence.then(function(){return outcomes;});
  }
  function readEligible(options){
    var queue=options.queue||global.OfflineSyncQueue;
    var bypassBackoff=Array.isArray(options.reasons)&&(
      options.reasons.indexOf('manual_retry')>=0||
      options.reasons.indexOf('online_event')>=0
    );
    return queue.getReadyOperations(options.queueOptions).then(function(read){
      var operations=read&&read.ok&&read.data&&read.data.operations||[];
      state.pendingCount=operations.length;
      var checks=[];
      operations.forEach(function(operation){
        var link=resolveLink(operation,options);
        if(bypassBackoff)clearRetry(operation.conferenceId);
        if(!isSafeLink(link)||retryTimers[operation.conferenceId])return;
        checks.push(pendingApplicationBlocks(link,options).then(function(blocked){
          return blocked?null:{operation:operation,link:link};
        }));
      });
      return Promise.all(checks).then(function(items){
        return selectFair(items.filter(Boolean),
          options.limit||MAX_OPERATIONS);
      });
    });
  }
  function performRun(options){
    var reason=waitingReason(options);
    if(reason){
      setStatus(reason==='AUTH_REQUIRED'
        ?'waiting_for_auth':'waiting_for_connection',reason);
      return Promise.resolve(result(true,'waiting',{reason:reason},null));
    }
    var queue=options.queue||global.OfflineSyncQueue;
    var processor=options.processor||global.SyncQueueProcessor;
    if(!queue||typeof queue.getReadyOperations!=='function'||
      !processor||typeof processor.processOperation!=='function'){
      setStatus('error','QUEUE_PROCESSOR_UNAVAILABLE');
      return Promise.resolve(result(false,'error',null,
        safeError('QUEUE_PROCESSOR_UNAVAILABLE')));
    }
    setStatus('processing');
    state.lastRunAt=new Date().toISOString();
    var authRetries=Object.keys(authBlockedOperations);
    var recovery=Promise.resolve();
    if(typeof queue.getAllOperations==='function'){
      recovery=recovery.then(function(){
        return queue.getAllOperations();
      }).then(function(read){
        var now=new Date().toISOString();
        var bypass=Array.isArray(options.reasons)&&(
          options.reasons.indexOf('manual_retry')>=0||
          options.reasons.indexOf('online_event')>=0
        );
        var operations=read&&read.ok&&read.data&&read.data.operations||[];
        operations.forEach(function(operation){
          if(operation.status!=='failed')return;
          var category=classifyErrorCode(
            operation.lastError&&operation.lastError.code
          );
          if(category==='auth'||category==='temporary'&&
            (bypass||!operation.nextAttemptAt||operation.nextAttemptAt<=now)){
            authBlockedOperations[operation.operationId]=true;
          }
        });
      }).catch(function(){return null;});
    }
    recovery=recovery.then(function(){
      authRetries=Object.keys(authBlockedOperations);
      var retrySequence=Promise.resolve();
      authRetries.forEach(function(operationId){
        retrySequence=retrySequence.then(function(){
          if(typeof queue.retryFailedOperation!=='function')return;
          return queue.retryFailedOperation(
            operationId,
            options.queueOptions
          ).then(function(retryResult){
            if(retryResult&&retryResult.ok){
              delete authBlockedOperations[operationId];
            }
          });
        }).catch(function(){return null;});
      });
      return retrySequence;
    });
    return recovery.then(function(){return readEligible(options);})
      .then(function(selected){
      if(!selected.length){
        setStatus(state.conflictCount?'blocked_by_conflict':'idle');
        return result(true,'empty',{processed:0},null);
      }
      return processSelected(selected,options).then(function(outcomes){
        state.activeConferenceId=null;
        if(state.queueStatus==='processing')setStatus('idle');
        return result(true,'completed',{
          processed:outcomes.length,
          results:outcomes
        },null);
      });
    }).catch(function(){
      state.activeConferenceId=null;
      setStatus('error','AUTOMATIC_QUEUE_RUN_FAILED');
      return result(false,'error',null,safeError('AUTOMATIC_QUEUE_RUN_FAILED'));
    });
  }
  function run(options){
    options=options&&typeof options==='object'?options:{};
    stopped=false;
    if(runningPromise){
      followUpRequested=true;
      return runningPromise;
    }
    var flight=performRun(options).finally(function(){
      if(runningPromise===flight)runningPromise=null;
      if(followUpRequested&&!stopped){
        followUpRequested=false;
        var orchestrator=options.orchestrator||global.AutomaticSyncOrchestrator;
        if(orchestrator&&typeof orchestrator.schedule==='function'){
          orchestrator.schedule('manual_retry');
        }
      }
    });
    runningPromise=flight;
    return flight;
  }
  function stop(){
    stopped=true;
    followUpRequested=false;
    Object.keys(retryTimers).forEach(clearRetry);
    refreshNextRetry();
    state.activeConferenceId=null;
    setStatus('stopped');
    return {ok:true,status:'stopped'};
  }
  function resetForTests(){
    stop();
    authBlockedOperations=Object.create(null);
    runningPromise=null;
    stopped=false;
    state={
      queueStatus:'idle',activeConferenceId:null,lastRunAt:null,
      lastSuccessfulSyncAt:null,lastSafeError:null,pendingCount:0,
      conflictCount:0,nextRetryAt:null
    };
  }

  global.AutomaticQueueRunner=Object.freeze({
    maxOperations:MAX_OPERATIONS,
    calculateBackoffDelay:calculateBackoffDelay,
    run:run,
    stop:stop,
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
