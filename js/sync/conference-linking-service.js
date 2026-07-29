(function(global){
  'use strict';

  var flights={};
  var lastResults={};

  function outcome(ok,status,data,error){
    return {
      ok:ok,
      status:status,
      data:data||null,
      error:error||null
    };
  }

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function uuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return global.crypto.randomUUID();
    }
    if(global.crypto&&typeof global.crypto.getRandomValues==='function'){
      var bytes=new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      bytes[6]=(bytes[6]&15)|64;
      bytes[8]=(bytes[8]&63)|128;
      return Array.prototype.map.call(bytes,function(byte,index){
        var text=byte.toString(16).padStart(2,'0');
        return index===4||index===6||index===8||index===10?'-'+text:text;
      }).join('');
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }

  function dependencies(options){
    options=options||{};
    return {
      links:options.links||global.ConferenceLinkStore,
      attempts:options.attempts||global.ConferenceLinkingAttemptStore,
      remote:options.remote||global.SupabaseSnapshotSync,
      integration:options.integration||global.OfflineFirstIntegration,
      config:options.config||global.SupabaseRuntimeConfig,
      auth:options.auth||global.SupabaseAuth,
      device:options.device||global.SupabaseDeviceIdentity
    };
  }

  function prerequisites(d){
    var configured=d.config&&d.config.getPublicState&&
      d.config.getPublicState().configured;
    var authenticated=d.auth&&d.auth.getState&&
      d.auth.getState().authenticated;
    var device=null;
    try{device=d.device&&d.device.getOrCreate&&d.device.getOrCreate();}
    catch(error){}
    return {
      ready:!!configured&&!!authenticated&&!!(device&&device.id),
      configured:!!configured,
      authenticated:!!authenticated,
      device:device
    };
  }

  function appVersion(options){
    return String(options&&options.appVersion||
      global.APP_RELEASE&&global.APP_RELEASE.version||'unknown');
  }

  function schemaVersion(options){
    return String(options&&options.schemaVersion||'1');
  }

  function restoreContext(d,localConferenceId,link,options){
    if(!d.integration||
      typeof d.integration.configureConferenceSync!=='function')return;
    d.integration.configureConferenceSync(localConferenceId,{
      conferenceId:link.remoteConferenceId,
      baseRevision:link.knownRevision,
      schemaVersion:schemaVersion(options),
      appVersion:appVersion(options)
    });
  }

  function resolveAttempt(d,input,existing,options){
    var stored=d.attempts.get(input.localConferenceId,
      options&&options.attemptOptions);
    var operationId=existing&&existing.linkStatus==='upload_pending'
      ?existing.initialOperationId
      :stored&&stored.operationId;
    var requestedConferenceId=existing&&existing.linkStatus==='upload_pending'
      ?existing.remoteConferenceId
      :stored&&stored.requestedConferenceId;
    if(operationId&&requestedConferenceId){
      return {
        ok:true,
        operationId:operationId,
        requestedConferenceId:requestedConferenceId
      };
    }
    try{
      operationId=uuid();
      requestedConferenceId=uuid();
    }catch(error){
      return {ok:false,status:'operation_id_unavailable'};
    }
    var saved=d.attempts.save({
      localConferenceId:input.localConferenceId,
      operationId:operationId,
      requestedConferenceId:requestedConferenceId
    },options&&options.attemptOptions);
    return saved&&saved.ok
      ?{ok:true,operationId:operationId,
        requestedConferenceId:requestedConferenceId}
      :{ok:false,status:'attempt_storage_failed'};
  }

  function run(input,options){
    var d=dependencies(options);
    var ready=prerequisites(d);
    if(!ready.ready){
      return Promise.resolve(outcome(false,'prerequisites_missing',ready));
    }
    var existing=d.links&&d.links.get(input.localConferenceId);
    if(existing&&existing.linkStatus==='linked'){
      restoreContext(d,input.localConferenceId,existing,options);
      return Promise.resolve(outcome(true,'already_linked',{
        linked:true,
        link:existing,
        remoteConferenceId:existing.remoteConferenceId,
        revision:existing.knownRevision
      }));
    }
    var snapshot;
    try{snapshot=copy(input.snapshot);}
    catch(error){
      return Promise.resolve(outcome(false,'snapshot_invalid'));
    }
    var attempt=resolveAttempt(d,input,existing,options);
    if(!attempt.ok){
      return Promise.resolve(outcome(false,attempt.status));
    }
    return d.remote.createConferenceIdempotent({
      operationId:attempt.operationId,
      requestedConferenceId:attempt.requestedConferenceId,
      name:input.name,
      metadata:{localConferenceId:String(input.localConferenceId)}
    }).then(function(created){
      if(!created||!created.ok||
        ['created','duplicate'].indexOf(created.status)<0){
        return outcome(false,
          created&&created.status==='operation_mismatch'
            ?'conflict'
            :'create_failed',
          {creationStatus:created&&created.status||'error'},
          created&&created.error||null
        );
      }
      var remoteConferenceId=created.data&&created.data.conferenceId;
      var pending=d.links.save({
        localConferenceId:input.localConferenceId,
        remoteConferenceId:remoteConferenceId,
        remoteName:input.name,
        knownRevision:0,
        linkStatus:'upload_pending',
        initialOperationId:attempt.operationId
      });
      if(!pending||!pending.ok){
        return outcome(false,'link_storage_failed');
      }
      d.attempts.remove(input.localConferenceId,
        options&&options.attemptOptions);
      return d.remote.uploadInitialSnapshot({
        conferenceId:remoteConferenceId,
        snapshot:snapshot,
        schemaVersion:schemaVersion(options),
        appVersion:appVersion(options),
        operationId:attempt.operationId
      }).then(function(upload){
        if(!upload||!upload.ok||
          ['applied','duplicate'].indexOf(upload.status)<0){
          return outcome(true,'upload_pending',{
            linked:false,
            link:pending.data,
            remoteConferenceId:remoteConferenceId,
            uploadStatus:upload&&upload.status||'error'
          },upload&&upload.error||null);
        }
        var revision=upload.data&&upload.data.revision;
        if(!Number.isInteger(revision)){
          return outcome(true,'upload_pending',{
            linked:false,
            link:pending.data,
            remoteConferenceId:remoteConferenceId,
            uploadStatus:'revision_missing'
          });
        }
        var linked=d.links.save({
          localConferenceId:input.localConferenceId,
          remoteConferenceId:remoteConferenceId,
          remoteName:input.name,
          knownRevision:revision,
          linkStatus:'linked',
          initialOperationId:upload.data.operationId||attempt.operationId
        });
        if(!linked||!linked.ok){
          return outcome(false,'link_storage_failed');
        }
        restoreContext(d,input.localConferenceId,linked.data,options);
        return outcome(true,'linked',{
          linked:true,
          link:linked.data,
          remoteConferenceId:remoteConferenceId,
          revision:revision,
          creationStatus:created.status,
          uploadStatus:upload.status
        });
      });
    }).catch(function(error){
      return outcome(false,'network_error',null,{
        code:String(error&&error.code||'NETWORK_ERROR'),
        message:'Conference linking request failed.'
      });
    });
  }

  function ensureConferenceLinked(input,options){
    input=input&&typeof input==='object'?input:{};
    var localConferenceId=String(input.localConferenceId||'');
    if(!localConferenceId||!String(input.name||'').trim()||!input.snapshot){
      return Promise.resolve(outcome(false,'invalid_input'));
    }
    if(flights[localConferenceId])return flights[localConferenceId];
    var flight=run({
      localConferenceId:localConferenceId,
      name:String(input.name).trim(),
      snapshot:input.snapshot,
      mode:String(input.mode||'manual'),
      reason:String(input.reason||'unspecified')
    },options).then(function(result){
      lastResults[localConferenceId]=result;
      return result;
    }).finally(function(){
      if(flights[localConferenceId]===flight)delete flights[localConferenceId];
    });
    flights[localConferenceId]=flight;
    return flight;
  }

  function getState(){
    return {
      activeConferenceIds:Object.keys(flights),
      lastResults:copy(lastResults)
    };
  }

  function resetForTests(){
    flights={};
    lastResults={};
    return {ok:true,status:'reset'};
  }

  global.ConferenceLinkingService=Object.freeze({
    ensureConferenceLinked:ensureConferenceLinked,
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
