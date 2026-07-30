(function(global){
  'use strict';

  var state = {
    status:'disconnected',
    conferenceId:null,
    channel:null,
    eventHandler:null,
    lastError:null,
    connectionId:0,
    cleanupPromise:null
  };

  function result(ok,status,data,error){
    return {
      ok:ok,
      status:status,
      code:error&&error.code||null,
      data:data===undefined?null:data,
      error:error||null
    };
  }

  function safeError(code,message){
    return {
      code:code||'REALTIME_ERROR',
      message:message||'The realtime operation failed.'
    };
  }

  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function resolveDependencies(options){
    options=options&&typeof options==='object'?options:{};
    var client;
    var session;
    try{
      client=options.client||
        (global.SupabaseClientLayer&&
        typeof global.SupabaseClientLayer.getClient==='function'
          ?global.SupabaseClientLayer.getClient()
          :null);
      session=options.session||
        (global.SupabaseAuth&&
        typeof global.SupabaseAuth.getSession==='function'
          ?global.SupabaseAuth.getSession()
          :null);
    }catch(error){
      return {
        error:safeError(
          'REALTIME_UNAVAILABLE',
          'Realtime is not available.'
        )
      };
    }
    if(!client||typeof client.channel!=='function'){
      return {
        error:safeError(
          'SUPABASE_UNAVAILABLE',
          'Supabase is not configured.'
        )
      };
    }
    if(!session||!session.user||!isUuid(String(session.user.id||''))){
      return {
        error:safeError(
          'AUTH_REQUIRED',
          'An authenticated session is required.'
        )
      };
    }
    return {client:client,session:session};
  }

  function publicState(){
    return {
      status:state.status,
      connected:state.status==='connected',
      conferenceId:state.conferenceId,
      hasEventHandler:typeof state.eventHandler==='function',
      cleanupPending:!!state.cleanupPromise,
      lastError:state.lastError
        ?{code:state.lastError.code,message:state.lastError.message}
        :null
    };
  }

  function normalizeSnapshotEvent(payload,conferenceId){
    var eventType=payload&&String(payload.eventType||'').toUpperCase();
    if(eventType!=='INSERT'&&eventType!=='UPDATE')return null;
    var record=payload&&payload.new&&typeof payload.new==='object'&&
      !Array.isArray(payload.new)
      ?payload.new
      :null;
    if(!record)return null;
    var eventConferenceId=String(record.conference_id||'');
    if(!isUuid(eventConferenceId)||eventConferenceId!==conferenceId||
      !Number.isInteger(record.revision)||record.revision<0||
      !isUuid(String(record.updated_by_device_id||''))){
      return null;
    }
    return {
      type:'snapshot_changed',
      conferenceId:conferenceId,
      revision:record.revision,
      updatedAt:record.updated_at||null,
      deviceId:String(record.updated_by_device_id)
    };
  }

  function deliverSnapshotEvent(payload,conferenceId,connectionId){
    if(state.connectionId!==connectionId||
      state.status!=='connected'||
      state.conferenceId!==conferenceId){
      return;
    }
    var event=normalizeSnapshotEvent(payload,conferenceId);
    if(!event||typeof state.eventHandler!=='function')return;
    try{
      var handled=state.eventHandler(event);
      if(handled&&handled.ok===false){
        state.lastError=safeError(
          handled.error&&handled.error.code||
          'REALTIME_EVENT_STORAGE_FAILED',
          'The realtime event could not be stored.'
        );
      }
    }catch(error){
      state.lastError=safeError(
        'REALTIME_EVENT_HANDLER_FAILED',
        'The realtime event handler failed.'
      );
    }
  }

  function removeChannel(channel,client){
    return Promise.resolve().then(function(){
      if(client&&typeof client.removeChannel==='function'){
        return client.removeChannel(channel);
      }
      if(channel&&typeof channel.unsubscribe==='function'){
        return channel.unsubscribe();
      }
      return null;
    });
  }

  function connect(conferenceId,options){
    conferenceId=String(conferenceId||'');
    if(!isUuid(conferenceId)){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      )));
    }
    if(state.cleanupPromise){
      return state.cleanupPromise.then(function(cleaned){
        return cleaned
          ?connect(conferenceId,options)
          :result(false,'error',null,safeError(
            'REALTIME_CONNECT_FAILED',
            'The previous realtime channel cleanup failed.'
          ));
      });
    }
    if(state.channel){
      if(state.conferenceId===conferenceId&&state.status==='connected'){
        return Promise.resolve(result(true,'already_connected',{
          conferenceId:conferenceId,
          state:publicState()
        },null));
      }
      if(state.conferenceId===conferenceId&&state.status==='connecting'){
        return Promise.resolve(result(true,'connecting',{
          conferenceId:conferenceId,
          state:publicState()
        },null));
      }
      return disconnect(options).then(function(disconnected){
        if(!disconnected.ok){
          return result(false,'error',null,safeError(
            'REALTIME_CONNECT_FAILED',
            'The previous realtime channel could not be removed.'
          ));
        }
        return connect(conferenceId,options);
      });
    }

    var dependencies=resolveDependencies(options);
    if(dependencies.error){
      state.lastError=dependencies.error;
      return Promise.resolve(result(false,'error',null,dependencies.error));
    }

    state.status='connecting';
    state.conferenceId=conferenceId;
    state.lastError=null;
    state.connectionId++;
    var connectionId=state.connectionId;
    var client=dependencies.client;

    return new Promise(function(resolve){
      var settled=false;
      function finish(connectionResult){
        if(settled)return;
        settled=true;
        resolve(connectionResult);
      }
      try{
        var channel=dependencies.client.channel(
          'conference-snapshot-'+conferenceId
        );
        state.channel=channel;
        channel
          .on('postgres_changes',{
            event:'*',
            schema:'public',
            table:'conference_snapshots',
            filter:'conference_id=eq.'+conferenceId
          },function(payload){
            deliverSnapshotEvent(payload,conferenceId,connectionId);
          })
          .subscribe(function(subscriptionStatus){
            if(state.connectionId!==connectionId||settled)return;
            if(subscriptionStatus==='SUBSCRIBED'){
              state.status='connected';
              state.lastError=null;
              finish(result(true,'connected',{
                conferenceId:conferenceId
              },null));
              return;
            }
            if(subscriptionStatus==='CHANNEL_ERROR'||
              subscriptionStatus==='TIMED_OUT'||
              subscriptionStatus==='CLOSED'){
              var failedChannel=state.channel;
              state.connectionId++;
              state.status='error';
              state.lastError=safeError(
                subscriptionStatus==='CHANNEL_ERROR'
                  ?'REALTIME_CHANNEL_ERROR'
                  :'REALTIME_CONNECT_FAILED',
                'The realtime subscription failed.'
              );
              state.channel=null;
              state.conferenceId=null;
              state.eventHandler=null;
              var cleanup=removeChannel(failedChannel,client).then(function(){
                finish(result(false,'error',null,state.lastError));
                return true;
              }).catch(function(){
                state.lastError=safeError(
                  'REALTIME_CHANNEL_CLEANUP_FAILED',
                  'The failed realtime channel could not be removed.'
                );
                finish(result(false,'error',null,state.lastError));
                return false;
              }).finally(function(){
                if(state.cleanupPromise===cleanup){
                  state.cleanupPromise=null;
                }
              });
              state.cleanupPromise=cleanup;
            }
          });
      }catch(error){
        state.status='error';
        state.lastError=safeError(
          'REALTIME_SUBSCRIPTION_FAILED',
          'The realtime subscription failed.'
        );
        state.channel=null;
        state.conferenceId=null;
        finish(result(false,'error',null,state.lastError));
      }
    });
  }

  function disconnect(options){
    options=options&&typeof options==='object'?options:{};
    if(state.cleanupPromise){
      return state.cleanupPromise.then(function(cleaned){
        if(cleaned){
          state.status='disconnected';
          state.conferenceId=null;
          state.lastError=null;
          return result(true,'disconnected',null,null);
        }
        state.status='error';
        return result(false,'error',null,state.lastError||
          safeError(
            'REALTIME_DISCONNECT_FAILED',
            'The realtime channel could not be closed cleanly.'
          ));
      });
    }
    var channel=state.channel;
    var conferenceId=state.conferenceId;
    var client=null;
    try{
      client=options.client||
        (global.SupabaseClientLayer&&
        typeof global.SupabaseClientLayer.getClient==='function'
          ?global.SupabaseClientLayer.getClient()
          :null);
    }catch(error){}

    state.connectionId++;
    state.status='disconnected';
    state.conferenceId=null;
    state.channel=null;
    state.lastError=null;
    state.eventHandler=null;

    if(!channel){
      return Promise.resolve(result(true,'disconnected',{
        conferenceId:conferenceId
      },null));
    }

    return removeChannel(channel,client)
      .then(function(){
        return result(true,'disconnected',{
          conferenceId:conferenceId
        },null);
      })
      .catch(function(){
        var error=safeError(
          'REALTIME_DISCONNECT_FAILED',
          'The realtime channel could not be closed cleanly.'
        );
        state.status='error';
        state.lastError=error;
        return result(false,'error',null,error);
      });
  }

  function isConnected(){
    return state.status==='connected';
  }

  function getState(){
    return publicState();
  }

  function setEventHandler(handler){
    if(handler!==null&&handler!==undefined&&typeof handler!=='function'){
      return result(false,'error',null,safeError(
        'INVALID_EVENT_HANDLER',
        'The event handler must be a function or null.'
      ));
    }
    state.eventHandler=typeof handler==='function'?handler:null;
    return result(true,'handler_updated',{
      hasEventHandler:!!state.eventHandler
    },null);
  }

  function resetForTests(options){
    return disconnect(options).then(function(disconnectResult){
      state.eventHandler=null;
      state.lastError=null;
      return disconnectResult;
    });
  }

  global.RealtimeSync=Object.freeze({
    connect:connect,
    disconnect:disconnect,
    isConnected:isConnected,
    getState:getState,
    setEventHandler:setEventHandler,
    resetForTests:resetForTests
  });
})(window);
