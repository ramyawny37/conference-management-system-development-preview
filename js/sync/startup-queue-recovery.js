(function(global){
  'use strict';

  var runningPromise=null;
  var retryTimers=Object.create(null);
  var generation=0;
  var state={status:'idle',lastRunAt:null,lastResult:null};

  function clone(value){
    if(value===undefined)return null;
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function result(ok,status,data,error){
    return {ok:ok,status:status,data:data||null,error:error||null};
  }
  function safeError(code){
    return {code:String(code||'STARTUP_RECOVERY_FAILED'),
      message:'The queue operation requires server reconciliation.'};
  }
  function dependencies(options){
    options=options&&typeof options==='object'?options:{};
    return {
      queue:options.queue||global.OfflineSyncQueue,
      snapshotSync:options.snapshotSync||global.SupabaseSnapshotSync,
      links:options.linkStore||global.ConferenceLinkStore,
      processor:options.processor||global.SyncQueueProcessor,
      integration:options.integration||global.OfflineFirstIntegration,
      orchestrator:options.orchestrator||global.AutomaticSyncOrchestrator
    };
  }
  function activeIds(processor){
    if(!processor||typeof processor.getProcessorState!=='function')return [];
    var current=processor.getProcessorState();
    return current&&Array.isArray(current.activeOperationIds)
      ?current.activeOperationIds.map(String):[];
  }
  function queueApiAvailable(queue){
    return !!(queue&&typeof queue.getAllOperations==='function'&&
      typeof queue.beginServerVerification==='function'&&
      typeof queue.checkpointServerApplied==='function'&&
      typeof queue.requireReconciliation==='function'&&
      typeof queue.resumeServerVerification==='function'&&
      typeof queue.restoreVerifiedMissingToPending==='function'&&
      typeof queue.markApplied==='function'&&
      typeof queue.markConflict==='function'&&
      typeof queue.markFailed==='function');
  }
  function contextFingerprint(options){
    if(typeof options.getContextFingerprint==='function'){
      return String(options.getContextFingerprint()||'');
    }
    var auth=options.auth||global.SupabaseAuth;
    var identity=options.deviceIdentity||global.SupabaseDeviceIdentity;
    var appData=options.appData||global.appData;
    var session=null;
    var device=null;
    try{
      session=auth&&typeof auth.getSession==='function'?auth.getSession():null;
      device=identity&&typeof identity.getOrCreate==='function'
        ?identity.getOrCreate():null;
    }catch(error){return 'context_unavailable';}
    return [session&&session.user&&session.user.id||'',
      device&&device.id||'',appData&&appData.currentConferenceId||''].join('|');
  }
  function clearVerificationTimer(operationId){
    var timer=retryTimers[String(operationId||'')];
    if(timer)global.clearTimeout(timer.handle);
    delete retryTimers[String(operationId||'')];
  }
  function scheduleVerification(operation,options){
    var id=String(operation&&operation.operationId||'');
    var at=operation&&operation.recovery&&operation.recovery.nextVerificationAt;
    if(!id||!at||retryTimers[id])return;
    var delay=Math.max(0,new Date(at).getTime()-Date.now());
    var timerGeneration=generation;
    retryTimers[id]={at:at,handle:global.setTimeout(function(){
      delete retryTimers[id];
      if(timerGeneration!==generation)return;
      run(options);
    },delay)};
  }
  function moveToVerifying(queue,operation,options){
    if(operation.status==='verifying_server')return Promise.resolve({ok:true});
    if(operation.status==='requires_reconciliation'){
      return queue.resumeServerVerification(operation.operationId,
        options.queueOptions);
    }
    return queue.beginServerVerification(operation.operationId,
      options.queueOptions);
  }
  function publishLink(d,operation,revision,options){
    var link=d.links&&typeof d.links.findByRemoteId==='function'
      ?d.links.findByRemoteId(operation.conferenceId,options.linkOptions):null;
    if(!link||typeof d.links.save!=='function'){
      return result(false,'link_unavailable',null,safeError(
        'RECOVERY_LINK_UNAVAILABLE'));
    }
    var saved=d.links.save(Object.assign({},link,{
      knownRevision:revision,
      actualRevision:revision
    }),Object.assign({},options.linkOptions||{}, {
      trigger:'startup_queue_recovery'
    }));
    return saved&&saved.ok
      ?result(true,'link_updated',{link:clone(saved.data||link)},null)
      :result(false,'link_update_failed',null,safeError(
        'RECOVERY_LINK_UPDATE_FAILED'));
  }
  function reevaluate(d,operation,revision){
    if(d.integration&&typeof d.integration.configureConferenceSync==='function'&&
      operation.localConferenceId){
      d.integration.configureConferenceSync(operation.localConferenceId,{
        conferenceId:operation.conferenceId,
        baseRevision:revision,
        schemaVersion:String(operation.schemaVersion||'1'),
        appVersion:String(operation.appVersion||'unknown')
      });
    }
    if(d.orchestrator&&typeof d.orchestrator.schedule==='function'){
      d.orchestrator.schedule('startup_queue_recovered');
    }
  }
  function finalizeCheckpoint(d,operation,options){
    var checkpoint=operation.result||{};
    var revision=checkpoint.revision;
    if(!Number.isInteger(revision)||revision<1){
      return d.queue.requireReconciliation(operation.operationId,{
        code:'INVALID_SERVER_CHECKPOINT'
      },options.queueOptions);
    }
    var linked=publishLink(d,operation,revision,options);
    if(!linked.ok){
      return Promise.resolve(result(true,'server_applied',{
        operationId:operation.operationId,checkpointPreserved:true
      },linked.error));
    }
    return d.queue.markApplied(operation.operationId,{
      revision:revision,
      previousRevision:checkpoint.previousRevision,
      conferenceId:operation.conferenceId,
      recoveryReason:'startup_server_reconciliation'
    },options.queueOptions).then(function(marked){
      if(!marked||!marked.ok)return result(false,'mark_applied_failed',null,
        safeError('RECOVERY_MARK_APPLIED_FAILED'));
      reevaluate(d,operation,revision);
      return result(true,'recovered',{
        operationId:operation.operationId,
        revision:revision,
        operation:clone(marked.data)
      },null);
    });
  }
  function reconcileOne(d,operation,options){
    if(operation.status==='server_applied'){
      return finalizeCheckpoint(d,operation,options);
    }
    return moveToVerifying(d.queue,operation,options).then(function(moved){
      if(!moved||!moved.ok)return result(false,'verification_state_failed',null,
        safeError('RECOVERY_STATE_UPDATE_FAILED'));
      return d.snapshotSync.inspectSnapshotOperation({
        operationId:operation.operationId,
        conferenceId:operation.conferenceId,
        deviceId:operation.deviceId,
        baseRevision:operation.baseRevision
      });
    }).then(function(inspection){
      if(options._generation!==generation||
        options._contextFingerprint!==contextFingerprint(options)){
        return d.queue.requireReconciliation(operation.operationId,{
          code:'RECOVERY_CONTEXT_CHANGED'
        },options.queueOptions);
      }
      if(!inspection||!inspection.ok){
        var error=inspection&&inspection.error||safeError(
          'SERVER_VERIFICATION_UNAVAILABLE');
        return d.queue.requireReconciliation(operation.operationId,error,
          options.queueOptions).then(function(updated){
            if(updated&&updated.ok)scheduleVerification(updated.data,options);
            return result(true,'requires_reconciliation',{
              operationId:operation.operationId
            },error);
          });
      }
      if(inspection.status==='not_found'){
        return d.queue.restoreVerifiedMissingToPending(
          operation.operationId,options.queueOptions).then(function(restored){
            return restored&&restored.ok
              ?result(true,'pending',{operationId:operation.operationId},null)
              :result(false,'pending_restore_failed',null,
                safeError('RECOVERY_PENDING_RESTORE_FAILED'));
          });
      }
      if(inspection.status==='applied'){
        var data=inspection.data||{};
        if(String(data.operationId||'')!==String(operation.operationId)||
          String(data.conferenceId||'')!==String(operation.conferenceId)||
          String(data.deviceId||'')!==String(operation.deviceId)||
          data.baseRevision!==operation.baseRevision||
          !Number.isInteger(data.resultingRevision)||
          data.resultingRevision<=operation.baseRevision){
          return d.queue.requireReconciliation(operation.operationId,{
            code:'SERVER_OPERATION_INTEGRITY_MISMATCH'
          },options.queueOptions);
        }
        return d.queue.checkpointServerApplied(operation.operationId,{
          revision:data.resultingRevision,
          previousRevision:Number.isInteger(data.baseRevision)
            ?data.baseRevision:operation.baseRevision,
          serverAppliedAt:data.processedAt||new Date().toISOString()
        },options.queueOptions).then(function(checkpointed){
          if(!checkpointed||!checkpointed.ok){
            return d.queue.requireReconciliation(operation.operationId,{
              code:'SERVER_CHECKPOINT_FAILED'
            },options.queueOptions).then(function(){
              return result(true,'requires_reconciliation',{
                operationId:operation.operationId
              },safeError('SERVER_CHECKPOINT_FAILED'));
            });
          }
          return finalizeCheckpoint(d,checkpointed.data,options);
        });
      }
      if(inspection.status==='conflict'){
        var conflict=inspection.data||{};
        if(!Number.isInteger(conflict.expectedRevision)||
          !Number.isInteger(conflict.actualRevision)){
          return d.queue.requireReconciliation(operation.operationId,{
            code:'SERVER_CONFLICT_INCOMPLETE'
          },options.queueOptions);
        }
        return d.queue.markConflict(operation.operationId,{
          conflictId:conflict.conflictId||null,
          expectedRevision:conflict.expectedRevision,
          actualRevision:conflict.actualRevision
        },options.queueOptions);
      }
      if(inspection.status==='rejected'||inspection.status==='failed'){
        return d.queue.markFailed(operation.operationId,{
          code:'SERVER_OPERATION_'+inspection.status.toUpperCase()
        },options.queueOptions);
      }
      return d.queue.requireReconciliation(operation.operationId,{
        code:'SERVER_OPERATION_'+String(inspection.status||'UNKNOWN').toUpperCase()
      },options.queueOptions).then(function(){
        return result(true,'requires_reconciliation',{
          operationId:operation.operationId,
          serverStatus:inspection.status
        },null);
      });
    });
  }
  function perform(options){
    options=options&&typeof options==='object'?options:{};
    var d=dependencies(options);
    options=Object.assign({},options,{
      _generation:generation,
      _contextFingerprint:contextFingerprint(options)
    });
    if(!queueApiAvailable(d.queue)||!d.snapshotSync||
      typeof d.snapshotSync.inspectSnapshotOperation!=='function'){
      return Promise.resolve(result(false,'unavailable',null,
        safeError('STARTUP_RECOVERY_UNAVAILABLE')));
    }
    var live=activeIds(d.processor);
    return d.queue.getAllOperations().then(function(read){
      if(!read||!read.ok)return result(false,'queue_read_failed',null,
        safeError('RECOVERY_QUEUE_READ_FAILED'));
      var candidates=(read.data&&read.data.operations||[]).filter(function(op){
        var nextVerification=op&&op.recovery&&
          op.recovery.nextVerificationAt;
        return op&&['processing','verifying_server','server_applied',
          'requires_reconciliation'].indexOf(op.status)>=0&&
          live.indexOf(String(op.operationId))<0&&
          (op.status!=='requires_reconciliation'||!nextVerification||
            nextVerification<=new Date().toISOString());
      });
      var outcomes=[];
      var sequence=Promise.resolve();
      candidates.forEach(function(operation){
        sequence=sequence.then(function(){
          clearVerificationTimer(operation.operationId);
          return reconcileOne(d,operation,options).then(function(outcome){
            outcomes.push(outcome);
          });
        });
      });
      return sequence.then(function(){
        return result(true,candidates.length?'completed':'empty',{
          candidateCount:candidates.length,outcomes:outcomes
        },null);
      });
    });
  }
  function run(options){
    if(runningPromise)return runningPromise;
    state.status='running';
    state.lastRunAt=new Date().toISOString();
    var flight=perform(options).catch(function(){
      return result(false,'error',null,safeError('STARTUP_RECOVERY_FAILED'));
    }).then(function(outcome){
      state.status=outcome.status;
      state.lastResult=clone(outcome);
      return outcome;
    }).finally(function(){if(runningPromise===flight)runningPromise=null;});
    runningPromise=flight;
    return flight;
  }
  function stop(){
    generation++;
    Object.keys(retryTimers).forEach(clearVerificationTimer);
    return {ok:true,status:'stopped'};
  }

  global.StartupQueueRecovery=Object.freeze({
    run:run,
    stop:stop,
    getState:function(){return clone(state);}
  });
})(window);
