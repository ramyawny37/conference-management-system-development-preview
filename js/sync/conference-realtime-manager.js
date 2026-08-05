(function(global){
  'use strict';

  var MAX_RECENT_EVENTS=100;
  var EVENT_TTL_MS=10*60*1000;
  var MAX_RECONNECT_ATTEMPTS=5;
  var BASE_RECONNECT_MS=1000;
  var entries=Object.create(null);
  var listeners=[];
  var runtimeTrace=[];

  function trace(stage,data){
    runtimeTrace.push({
      stage:String(stage||''),
      at:new Date().toISOString(),
      data:data&&typeof data==='object'?copy(data):null
    });
    runtimeTrace=runtimeTrace.slice(-40);
  }

  function outcome(ok,status,data,error){
    return {ok:ok,status:status,data:data||null,error:error||null};
  }
  function object(value){
    return !!value&&typeof value==='object'&&!Array.isArray(value);
  }
  function copy(value){
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
  function now(options){
    return options&&typeof options.now==='function'
      ?options.now():new Date();
  }
  function dependencies(options){
    options=object(options)?options:{};
    var client=null;
    try{
      client=options.client||
        (global.SupabaseClientLayer&&
        typeof global.SupabaseClientLayer.getClient==='function'
          ?global.SupabaseClientLayer.getClient():null);
    }catch(error){client=null;}
    return {
      links:options.links||global.ConferenceLinkStore,
      membership:options.membership||global.ConferenceMembersService,
      access:options.systemAccess||global.SystemAccessService,
      auth:options.auth||global.SupabaseAuth,
      client:client,
      queue:options.queue||global.OfflineSyncQueue,
      backup:options.backup||global.FullBackupService,
      publishing:options.publishing||global.ConferencePublishingEngine,
      recovery:options.recovery||global.ConferencePublishRecovery,
      remoteUpdates:options.remoteUpdateStore||global.RemoteUpdateStore,
      navigator:options.navigator||global.navigator
    };
  }
  function sessionUserId(auth){
    var session=auth&&typeof auth.getSession==='function'
      ?auth.getSession():null;
    return String(session&&session.user&&session.user.id||'');
  }
  function lifecycle(appData,id){
    return appData&&appData.conferenceLifecycle&&
      appData.conferenceLifecycle.records&&
      appData.conferenceLifecycle.records[id]||null;
  }
  function localConference(appData,id){
    return !!(appData&&Array.isArray(appData.conferences)&&
      appData.conferences.some(function(item){
        return item&&item.id===id;
      }));
  }
  function activeFor(id,service){
    var state=service&&typeof service.getState==='function'
      ?service.getState():null;
    return !!(state&&Array.isArray(state.activeConferenceIds)&&
      state.activeConferenceIds.indexOf(id)>=0);
  }
  function isolated(d,id,options){
    try{
      if(!d.backup)return false;
      var marker=typeof d.backup.getFullRestoreCloudReviewMarker==='function'
        ?d.backup.getFullRestoreCloudReviewMarker({
          storage:options&&options.storage
        }):null;
      return !!(marker&&marker.pending)||
        typeof d.backup.isManualRelinkRequired==='function'&&
        d.backup.isManualRelinkRequired(id,{
          storage:options&&options.storage
        })===true;
    }catch(error){return true;}
  }
  function conflict(link){
    return !!(link&&(link.linkStatus==='needs_resolution'||
      link.conflictId||
      ['active','pending','reviewed','changed'].indexOf(
        link.conflictStatus
      )>=0));
  }
  function legacyAllowed(link,options){
    var adapter=options&&options.classifyLegacyLink;
    if(typeof adapter!=='function')return false;
    try{return adapter(copy(link))===true;}catch(error){return false;}
  }
  function validLink(link,record,options){
    if(!link||!uuid(link.remoteConferenceId)||
      !Number.isInteger(link.knownRevision)||link.knownRevision<1||
      conflict(link)){
      return false;
    }
    if(link.linkStatus==='cloud_linked'){
      return !!(record&&record.localLifecycle==='active'&&
        record.cloudLifecycle==='cloud_linked');
    }
    return legacyAllowed(link,options);
  }
  function entry(id){
    if(!entries[id]){
      entries[id]={
        localConferenceId:id,
        cloudConferenceId:null,
        userId:null,
        identity:null,
        generation:0,
        status:'inactive',
        reason:null,
        channel:null,
        connectPromise:null,
        reconnectTimer:null,
        reconnectAttempts:0,
        recentEvents:Object.create(null),
        lastConnectedAt:null,
        lastEventAt:null,
        lastRevision:null,
        lastError:null,
        remoteChangeDetected:false,
        potentialConflict:false
      };
    }
    return entries[id];
  }
  function publicEntry(value){
    return {
      localConferenceId:value.localConferenceId,
      cloudConferenceId:value.cloudConferenceId,
      userId:value.userId,
      identity:value.identity,
      generation:value.generation,
      status:value.status,
      reason:value.reason,
      connected:value.status==='subscribed',
      reconnectAttempts:value.reconnectAttempts,
      lastConnectedAt:value.lastConnectedAt,
      lastEventAt:value.lastEventAt,
      lastRevision:value.lastRevision,
      lastError:value.lastError?copy(value.lastError):null,
      remoteChangeDetected:value.remoteChangeDetected,
      potentialConflict:value.potentialConflict
    };
  }
  function notify(value,event){
    var snapshot=publicEntry(value);
    listeners.slice().forEach(function(listener){
      try{listener(snapshot,event?copy(event):null);}catch(error){}
    });
  }
  function transition(value,next,reason){
    var allowed={
      inactive:['waiting_for_prerequisites','connecting','closed'],
      waiting_for_prerequisites:['connecting','suspended','closed'],
      connecting:['subscribed','reconnecting','error','suspended','closed'],
      subscribed:['suspended','reconnecting','error','closed'],
      suspended:['waiting_for_prerequisites','connecting','closed'],
      reconnecting:['subscribed','reconnecting','error','suspended','closed'],
      error:['waiting_for_prerequisites','connecting','closed'],
      closed:['waiting_for_prerequisites','connecting','closed']
    };
    if(!allowed[value.status]||allowed[value.status].indexOf(next)<0){
      value.status='error';
      value.reason='illegal_transition';
      value.lastError={code:'REALTIME_ILLEGAL_TRANSITION'};
      notify(value);
      return false;
    }
    value.status=next;
    value.reason=reason||null;
    notify(value);
    return true;
  }
  function inspectQueue(d,link,options){
    if(!d.queue||typeof d.queue.getConferenceReadiness!=='function'){
      return Promise.resolve(outcome(false,'queue_readiness_unavailable'));
    }
    return Promise.resolve(d.queue.getConferenceReadiness(
      link.remoteConferenceId,
      options&&options.queueOptions
    )).then(function(readiness){
      if(!readiness||!readiness.ok||
        readiness.status!=='stable'){
        return outcome(false,'queue_not_stable',readiness);
      }
      return outcome(true,'queue_stable',readiness.data);
    }).catch(function(){
      return outcome(false,'queue_readiness_failed');
    });
  }
  function verifyPrerequisites(appData,id,options){
    var d=dependencies(options);
    var record=lifecycle(appData,id);
    if(!localConference(appData,id)){
      return Promise.resolve(outcome(false,'local_conference_missing'));
    }
    if(record&&record.localLifecycle==='archived'){
      return Promise.resolve(outcome(false,'conference_archived'));
    }
    if(d.links&&typeof d.links.inspect==='function'){
      var inspected=d.links.inspect(options&&options.linkOptions);
      if(!inspected||!inspected.ok){
        return Promise.resolve(outcome(false,'link_store_invalid'));
      }
    }
    var link=d.links&&typeof d.links.get==='function'
      ?d.links.get(id,options&&options.linkOptions):null;
    if(!validLink(link,record,options)){
      return Promise.resolve(outcome(false,'conference_link_invalid'));
    }
    if(isolated(d,id,options)){
      return Promise.resolve(outcome(false,'cloud_isolation_active'));
    }
    if(activeFor(id,d.publishing)){
      return Promise.resolve(outcome(false,'publishing_active'));
    }
    if(activeFor(id,d.recovery)){
      return Promise.resolve(outcome(false,'recovery_active'));
    }
    if(d.navigator&&d.navigator.onLine===false){
      return Promise.resolve(outcome(false,'offline'));
    }
    if(!d.client||typeof d.client.channel!=='function'){
      return Promise.resolve(outcome(false,'supabase_unavailable'));
    }
    var userId=sessionUserId(d.auth);
    if(!uuid(userId)){
      return Promise.resolve(outcome(false,'authentication_required'));
    }
    if(!d.access||typeof d.access.refresh!=='function'||
      !d.membership||
      typeof d.membership.getCurrentAccess!=='function'){
      return Promise.resolve(outcome(false,'authorization_unavailable'));
    }
    return Promise.resolve(d.access.refresh()).then(function(access){
      if(!access||access.source!=='server'||access.fresh!==true||
        access.authenticated!==true||access.userId!==userId){
        return {halt:outcome(false,'fresh_system_access_required')};
      }
      if(access.accountStatus==='blocked'){
        return {halt:outcome(false,'account_blocked')};
      }
      if(access.accountStatus!=='approved'){
        return {halt:outcome(false,'account_not_approved')};
      }
      return d.membership.getCurrentAccess({
        remoteConferenceId:link.remoteConferenceId
      },options&&options.membershipOptions);
    }).then(function(access){
      if(access&&access.halt)return access.halt;
      if(!access||!access.ok||access.status!=='available'||
        !access.data||access.data.userId!==userId||
        ['owner','manager','viewer','accommodation_viewer',
          'transport_viewer'].indexOf(access.data.role)<0){
        return outcome(false,'membership_read_denied');
      }
      return inspectQueue(d,link,options).then(function(queue){
        if(!queue.ok)return queue;
        return outcome(true,'ready',{
          localConferenceId:id,
          cloudConferenceId:link.remoteConferenceId,
          knownRevision:link.knownRevision,
          userId:userId,
          role:access.data.role,
          link:copy(link),
          queue:queue.data
        });
      });
    }).catch(function(){
      return outcome(false,'prerequisite_check_failed');
    });
  }
  function removeChannel(value,client){
    var channel=value.channel;
    value.channel=null;
    if(!channel)return Promise.resolve(true);
    return Promise.resolve(
      client&&typeof client.removeChannel==='function'
        ?client.removeChannel(channel)
        :channel.unsubscribe()
    ).then(function(){return true;}).catch(function(){return false;});
  }
  function clearReconnect(value){
    if(value.reconnectTimer){
      global.clearTimeout(value.reconnectTimer);
      value.reconnectTimer=null;
    }
  }
  function close(id,options){
    var value=entry(String(id||''));
    var d=dependencies(options);
    value.generation++;
    clearReconnect(value);
    value.connectPromise=null;
    transition(value,'closed','closed');
    return removeChannel(value,d.client).then(function(removed){
      if(!removed){
        value.status='error';
        value.lastError={code:'REALTIME_CHANNEL_CLOSE_FAILED'};
        notify(value);
        return outcome(false,'close_failed',publicEntry(value));
      }
      value.cloudConferenceId=null;
      value.userId=null;
      value.identity=null;
      return outcome(true,'closed',publicEntry(value));
    });
  }
  function suspend(id,reason,options){
    var value=entry(String(id||''));
    var d=dependencies(options);
    value.generation++;
    clearReconnect(value);
    value.connectPromise=null;
    transition(value,'suspended',reason||'prerequisite_lost');
    return removeChannel(value,d.client).then(function(removed){
      return outcome(removed,removed?'suspended':'suspend_failed',
        publicEntry(value));
    });
  }
  function eventFingerprint(payload,cloudId){
    var record=payload&&object(payload.new)?payload.new:{};
    return [
      cloudId,
      String(payload&&payload.eventType||''),
      String(record.revision||''),
      String(record.id||''),
      String(record.transaction_id||record.commit_timestamp||
        payload&&payload.commit_timestamp||'')
    ].join('|');
  }
  function pruneEvents(value,time){
    Object.keys(value.recentEvents).forEach(function(key){
      if(time-value.recentEvents[key]>EVENT_TTL_MS){
        delete value.recentEvents[key];
      }
    });
    var keys=Object.keys(value.recentEvents);
    if(keys.length>MAX_RECENT_EVENTS){
      keys.sort(function(a,b){
        return value.recentEvents[b]-value.recentEvents[a];
      }).slice(MAX_RECENT_EVENTS).forEach(function(key){
        delete value.recentEvents[key];
      });
    }
  }
  function normalizedEvent(payload,value,generation,knownRevision,options){
    if(generation!==value.generation||value.status!=='subscribed'){
      return null;
    }
    var type=String(payload&&payload.eventType||'').toUpperCase();
    var record=payload&&object(payload.new)?payload.new:null;
    if(['INSERT','UPDATE'].indexOf(type)<0||!record||
      record.conference_id!==value.cloudConferenceId){
      return null;
    }
    var revision=record.revision;
    var receivedAt=now(options).toISOString();
    var event={
      eventId:eventFingerprint(payload,value.cloudConferenceId),
      cloudConferenceId:value.cloudConferenceId,
      eventType:type.toLowerCase(),
      observedRevision:Number.isInteger(revision)&&revision>=0
        ?revision:null,
      sourceUserId:uuid(String(record.updated_by_user_id||''))
        ?String(record.updated_by_user_id):null,
      sourceDeviceId:uuid(String(record.updated_by_device_id||''))
        ?String(record.updated_by_device_id):null,
      occurredAt:record.updated_at||null,
      receivedAt:receivedAt,
      sourceCategory:'conference_snapshots',
      channelGeneration:generation,
      classification:'inspection_required'
    };
    if(event.observedRevision!==null){
      if(event.observedRevision<=knownRevision){
        event.classification=event.observedRevision===knownRevision
          ?'duplicate_revision':'stale_revision';
      }else{
        event.classification='remote_change_detected';
      }
    }
    if(event.classification==='duplicate_revision'&&options&&
      typeof options.isConfirmedSelfEvent==='function'){
      try{
        if(options.isConfirmedSelfEvent(copy(event))===true){
          event.classification='self_update';
        }
      }catch(error){}
    }
    return event;
  }
  function acceptEvent(payload,value,generation,knownRevision,options){
    trace('EVENT_RECEIVED',{
      eventType:payload&&payload.eventType||null,
      channelGeneration:generation
    });
    var event=normalizedEvent(
      payload,value,generation,knownRevision,options
    );
    if(!event)return;
    trace('REVISION_RECEIVED',{
      revision:event.observedRevision,
      classification:event.classification
    });
    var time=now(options).getTime();
    pruneEvents(value,time);
    if(value.recentEvents[event.eventId])return;
    value.recentEvents[event.eventId]=time;
    value.lastEventAt=event.receivedAt;
    value.lastRevision=event.observedRevision;
    var d=dependencies(options);
    var readiness=event.classification==='remote_change_detected'
      ?inspectQueue(d,{remoteConferenceId:event.cloudConferenceId},options)
      :Promise.resolve(outcome(true,'queue_stable'));
    Promise.resolve(readiness).then(function(queue){
      if(generation!==value.generation)return;
      if(event.classification==='remote_change_detected'){
        value.remoteChangeDetected=true;
        if(!queue.ok){
          event.classification='potential_conflict';
          value.potentialConflict=true;
          var runner=options&&options.queueRunner||
            global.AutomaticQueueRunner;
          if(runner&&typeof runner.suspendConference==='function'){
            runner.suspendConference(
              event.cloudConferenceId,'potential_conflict'
            );
          }
        }
      }
      if(event.observedRevision!==null&&event.sourceDeviceId&&
        d.remoteUpdates&&typeof d.remoteUpdates.add==='function'){
        d.remoteUpdates.add({
          remoteConferenceId:event.cloudConferenceId,
          revision:event.observedRevision,
          sourceDeviceId:event.sourceDeviceId,
          receivedAt:event.receivedAt,
          status:event.classification==='duplicate_revision'
            ?'dismissed':event.classification==='self_update'
              ?'self_update':event.classification==='potential_conflict'
              ?'needs_resolution':'unreviewed'
        },options&&options.remoteUpdateOptions);
      }
      notify(value,event);
      if(event.classification==='potential_conflict'){
        suspend(value.localConferenceId,
          'potential_conflict',options);
      }
    }).catch(function(){
      value.lastError={code:'REALTIME_EVENT_INSPECTION_FAILED'};
      notify(value,event);
      suspend(value.localConferenceId,
        'event_inspection_failed',options);
    });
  }
  function scheduleReconnect(value,appData,options){
    if(value.reconnectAttempts>=MAX_RECONNECT_ATTEMPTS){
      value.status='error';
      value.reason='retry_limit';
      value.lastError={code:'REALTIME_RETRY_LIMIT_REACHED'};
      notify(value);
      return;
    }
    if(value.reconnectTimer)return;
    value.reconnectAttempts++;
    transition(value,'reconnecting','temporary_connection_error');
    var delay=Math.min(
      BASE_RECONNECT_MS*Math.pow(2,value.reconnectAttempts-1),
      30000
    );
    value.reconnectTimer=global.setTimeout(function(){
      value.reconnectTimer=null;
      prepareAndSubscribe(appData,value.localConferenceId,
        Object.assign({},options||{},{reconnect:true}));
    },delay);
  }
  function subscribeReady(appData,ready,options){
    var id=ready.localConferenceId;
    var value=entry(id);
    var identity=[
      ready.userId,id,ready.cloudConferenceId,'snapshot_notifications'
    ].join('|');
    if(value.identity===identity&&
      ['connecting','subscribed'].indexOf(value.status)>=0){
      return value.connectPromise||Promise.resolve(outcome(
        true,value.status,publicEntry(value)
      ));
    }
    var d=dependencies(options);
    var replace=value.channel
      ?close(id,options):Promise.resolve();
    var flight=Promise.resolve(replace).then(function(){
      value=entry(id);
      value.generation++;
      var generation=value.generation;
      value.cloudConferenceId=ready.cloudConferenceId;
      value.userId=ready.userId;
      value.identity=identity;
      value.lastError=null;
      if(!transition(value,options&&options.reconnect
        ?'reconnecting':'connecting')){
        return outcome(false,'illegal_transition',publicEntry(value));
      }
      return new Promise(function(resolve){
        var settled=false;
        function finish(response){
          if(settled)return;
          settled=true;
          value.connectPromise=null;
          resolve(response);
        }
        try{
          var channel=d.client.channel(
            'conference-snapshot-'+ready.cloudConferenceId+'-'+
            ready.userId
          );
          value.channel=channel;
          channel.on('postgres_changes',{
            event:'*',
            schema:'public',
            table:'conference_snapshots',
            filter:'conference_id=eq.'+ready.cloudConferenceId
          },function(payload){
            acceptEvent(
              payload,value,generation,ready.knownRevision,options
            );
          }).subscribe(function(status){
            if(generation!==value.generation)return;
            if(status==='SUBSCRIBED'){
              trace('CHANNEL_SUBSCRIBED',{
                localConferenceIdPresent:!!id,
                cloudConferenceIdPresent:!!ready.cloudConferenceId
              });
              transition(value,'subscribed','subscribed');
              value.reconnectAttempts=0;
              value.lastConnectedAt=now(options).toISOString();
              finish(outcome(true,'subscribed',publicEntry(value)));
              return;
            }
            if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].indexOf(status)>=0){
              trace(status,{channelGeneration:generation});
              value.lastError={code:'REALTIME_'+status};
              removeChannel(value,d.client).finally(function(){
                if(generation!==value.generation)return;
                finish(outcome(false,'connection_error',
                  publicEntry(value),copy(value.lastError)));
                scheduleReconnect(value,appData,options);
              });
            }
          });
        }catch(error){
          trace('SUBSCRIBE_EXCEPTION',{
            name:String(error&&error.name||'Error')
          });
          value.lastError={code:'REALTIME_SUBSCRIPTION_FAILED'};
          value.status='error';
          notify(value);
          finish(outcome(false,'connection_error',
            publicEntry(value),copy(value.lastError)));
        }
      });
    });
    value.connectPromise=flight;
    flight.finally(function(){
      if(value.connectPromise===flight)value.connectPromise=null;
    });
    return flight;
  }
  function prepareAndSubscribe(appData,id,options){
    id=String(id||'');
    trace('START_SUBSCRIBE',{localConferenceIdPresent:!!id});
    var value=entry(id);
    if(value.connectPromise)return value.connectPromise;
    if(value.status==='inactive'||value.status==='closed'||
      value.status==='error'||value.status==='suspended'){
      transition(value,'waiting_for_prerequisites','checking');
    }
    var flight=verifyPrerequisites(appData,id,options).then(function(ready){
      if(!ready.ok){
        return suspend(id,ready.status,options).then(function(){
          return outcome(false,'waiting_for_prerequisites',
            publicEntry(value),{code:ready.status});
        });
      }
      return subscribeReady(appData,ready.data,options);
    }).finally(function(){
      if(value.connectPromise===flight)value.connectPromise=null;
    });
    value.connectPromise=flight;
    return flight;
  }
  function reconcile(appData,options){
    if(!appData||!Array.isArray(appData.conferences)){
      return Promise.resolve(outcome(false,'app_data_invalid'));
    }
    var ids=appData.conferences.map(function(item){
      return item&&String(item.id||'');
    }).filter(Boolean);
    var tasks=ids.map(function(id){
      return prepareAndSubscribe(appData,id,options);
    });
    Object.keys(entries).forEach(function(id){
      if(ids.indexOf(id)<0)tasks.push(close(id,options));
    });
    return Promise.all(tasks).then(function(results){
      return outcome(true,'reconciled',{results:results});
    });
  }
  function getState(id){
    if(id)return publicEntry(entry(String(id)));
    var result={};
    Object.keys(entries).forEach(function(key){
      result[key]=publicEntry(entries[key]);
    });
    return result;
  }
  function subscribe(listener){
    if(typeof listener!=='function')return function(){};
    listeners.push(listener);
    return function(){
      var index=listeners.indexOf(listener);
      if(index>=0)listeners.splice(index,1);
    };
  }
  function stopAll(options){
    return Promise.all(Object.keys(entries).map(function(id){
      return close(id,options);
    })).then(function(results){
      return outcome(true,'closed',{results:results});
    });
  }
  function resetForTests(options){
    return stopAll(options).then(function(){
      entries=Object.create(null);
      listeners=[];
      runtimeTrace=[];
      return outcome(true,'reset');
    });
  }

  global.ConferenceRealtimeManager=Object.freeze({
    states:Object.freeze([
      'inactive','waiting_for_prerequisites','connecting','subscribed',
      'suspended','reconnecting','error','closed'
    ]),
    maxRecentEvents:MAX_RECENT_EVENTS,
    eventTtlMs:EVENT_TTL_MS,
    maxReconnectAttempts:MAX_RECONNECT_ATTEMPTS,
    verifyPrerequisites:verifyPrerequisites,
    prepareAndSubscribe:prepareAndSubscribe,
    reconcile:reconcile,
    suspend:suspend,
    close:close,
    stopAll:stopAll,
    getState:getState,
    getDiagnostics:function(){return copy(runtimeTrace);},
    traceDiagnostic:function(stage,data){trace(stage,data);},
    subscribe:subscribe,
    resetForTests:resetForTests
  });
})(window);
