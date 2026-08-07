(function(global){
  'use strict';

  var activeOperationIds = Object.create(null);
  var batchRunning = false;

  function result(ok,status,data,error){
    return {
      ok:ok,
      status:status,
      data:data===undefined?null:data,
      error:error||null
    };
  }

  function safeError(code,message){
    return {
      code:code||'SYNC_PROCESSOR_ERROR',
      message:message||'The sync operation could not be processed.'
    };
  }

  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function cloneValue(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeProcessorError(error,fallbackCode){
    var code = error&&typeof error.code==='string'
      ?error.code.toUpperCase().replace(/[^A-Z0-9_]/g,'').slice(0,64)
      :fallbackCode||'SYNC_PROCESSOR_ERROR';
    return safeError(code||fallbackCode,'The sync operation failed.');
  }

  function resolveDependencies(options){
    options=options&&typeof options==='object'?options:{};
    return {
      queue:options.queue||global.OfflineSyncQueue||null,
      snapshotSync:options.snapshotSync||global.SupabaseSnapshotSync||null
    };
  }

  function hasQueueApi(queue){
    return !!(queue&&
      typeof queue.getOperation==='function'&&
      typeof queue.getReadyOperations==='function'&&
      typeof queue.startProcessing==='function'&&
      typeof queue.markApplied==='function'&&
      typeof queue.markConflict==='function'&&
      typeof queue.markFailed==='function');
  }

  function publicOperationData(operation){
    if(!operation||typeof operation!=='object')return null;
    return {
      operationId:operation.operationId||null,
      conferenceId:operation.conferenceId||null,
      status:operation.status||null,
      attempts:Number.isInteger(operation.attempts)?operation.attempts:0,
      lastAttemptAt:operation.lastAttemptAt||null,
      nextAttemptAt:operation.nextAttemptAt||null,
      result:operation.result?cloneValue(operation.result):null,
      conflict:operation.conflict?cloneValue(operation.conflict):null,
      lastError:operation.lastError?cloneValue(operation.lastError):null,
      deviceId:operation.deviceId||null
    };
  }

  function failedResult(operationId,operation,error){
    return result(true,'failed',{
      operationId:operationId,
      operation:publicOperationData(operation)
    },error);
  }

  function markAttemptFailed(queue,operationId,error,options){
    var safe = normalizeProcessorError(error,'SYNC_UPLOAD_FAILED');
    return Promise.resolve()
      .then(function(){
        return queue.markFailed(operationId,safe,options&&options.queueOptions);
      })
      .then(function(markResult){
        if(!markResult||!markResult.ok){
          return result(false,'error',null,safeError(
            'QUEUE_MARK_FAILED_ERROR',
            'The failed queue operation could not be recorded.'
          ));
        }
        return failedResult(operationId,markResult.data,safe);
      })
      .catch(function(){
        return result(false,'error',null,safeError(
          'QUEUE_MARK_FAILED_ERROR',
          'The failed queue operation could not be recorded.'
        ));
      });
  }

  function processStartedOperation(
    operationId,
    operation,
    queue,
    snapshotSync,
    options
  ){
    if(!snapshotSync||typeof snapshotSync.uploadSnapshot!=='function'){
      return markAttemptFailed(queue,operationId,{
        code:'SNAPSHOT_SYNC_UNAVAILABLE'
      },options);
    }

    var uploadInput;
    try{
      uploadInput = {
        conferenceId:operation.conferenceId,
        baseRevision:operation.baseRevision,
        snapshot:cloneValue(operation.snapshot),
        schemaVersion:operation.schemaVersion,
        appVersion:operation.appVersion,
        operationId:operation.operationId
      };
    }catch(error){
      return markAttemptFailed(queue,operationId,{
        code:'SNAPSHOT_CLONE_FAILED'
      },options);
    }

    return Promise.resolve()
      .then(function(){
        return snapshotSync.uploadSnapshot(uploadInput);
      })
      .then(function(uploadResult){
        if(uploadResult&&uploadResult.ok&&
          (uploadResult.status==='applied'||
          uploadResult.status==='duplicate')){
          var appliedData=uploadResult.data||{};
          if(options&&options.deferAppliedFinalization===true){
            if(typeof queue.checkpointServerApplied!=='function'){
              return result(false,'error',null,safeError(
                'QUEUE_CHECKPOINT_UNAVAILABLE',
                'The server result could not be checkpointed.'
              ));
            }
            return queue.checkpointServerApplied(operationId,{
              revision:appliedData.revision,
              previousRevision:appliedData.previousRevision,
              conferenceId:appliedData.conferenceId||operation.conferenceId,
              serverAppliedAt:new Date().toISOString()
            },options&&options.queueOptions).then(function(checkpointed){
              if(!checkpointed||!checkpointed.ok){
                return result(false,'error',null,safeError(
                  'QUEUE_CHECKPOINT_FAILED',
                  'The server result could not be checkpointed.'
                ));
              }
              return result(true,'server_applied',{
                operationId:operationId,
                revision:appliedData.revision,
                previousRevision:appliedData.previousRevision,
                conferenceId:appliedData.conferenceId||
                  operation.conferenceId,
                operation:publicOperationData(checkpointed.data),
                serverStatus:uploadResult.status
              },null);
            });
          }
          return queue.markApplied(operationId,{
            revision:appliedData.revision,
            previousRevision:appliedData.previousRevision,
            conferenceId:appliedData.conferenceId
          },options&&options.queueOptions).then(function(markResult){
            if(!markResult||!markResult.ok){
              return result(false,'error',null,safeError(
                'QUEUE_MARK_APPLIED_ERROR',
                'The applied queue operation could not be recorded.'
              ));
            }
            return result(true,uploadResult.status,{
              operationId:operationId,
              revision:appliedData.revision,
              operation:publicOperationData(markResult.data)
            },null);
          });
        }

        if(uploadResult&&uploadResult.ok&&uploadResult.status==='conflict'){
          var conflictData=uploadResult.data||{};
          return queue.markConflict(operationId,{
            conflictId:conflictData.conflictId||null,
            expectedRevision:conflictData.expectedRevision,
            actualRevision:conflictData.actualRevision
          },options&&options.queueOptions).then(function(markResult){
            if(!markResult||!markResult.ok){
              return result(false,'error',null,safeError(
                'QUEUE_MARK_CONFLICT_ERROR',
                'The conflicting queue operation could not be recorded.'
              ));
            }
            return result(true,'conflict',{
              operationId:operationId,
              conflictId:conflictData.conflictId||null,
              expectedRevision:conflictData.expectedRevision,
              actualRevision:conflictData.actualRevision,
              operation:publicOperationData(markResult.data)
            },null);
          });
        }

        return markAttemptFailed(
          queue,
          operationId,
          uploadResult&&uploadResult.error
            ?uploadResult.error
            :{code:'UNEXPECTED_UPLOAD_RESULT'},
          options
        );
      })
      .catch(function(error){
        return markAttemptFailed(queue,operationId,error,options);
      });
  }

  function processOperation(operationId,options){
    operationId=String(operationId||'');
    if(!isUuid(operationId)){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_OPERATION_ID',
        'operationId must be a valid UUID.'
      )));
    }
    if(activeOperationIds[operationId]){
      return Promise.resolve(result(true,'busy',{
        operationId:operationId
      },null));
    }

    var dependencies=resolveDependencies(options);
    if(!hasQueueApi(dependencies.queue)){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_QUEUE_UNAVAILABLE',
        'The sync queue is unavailable.'
      )));
    }

    activeOperationIds[operationId]=true;
    return Promise.resolve()
      .then(function(){
        return dependencies.queue.getOperation(operationId);
      })
      .then(function(readResult){
        if(!readResult||!readResult.ok){
          return result(false,'error',null,safeError(
            'QUEUE_READ_FAILED',
            'The queue operation could not be read.'
          ));
        }
        if(readResult.status==='not_found'||!readResult.data){
          return result(false,'error',null,safeError(
            'OPERATION_NOT_FOUND',
            'The queue operation was not found.'
          ));
        }
        if(readResult.data.status!=='pending'){
          return result(true,'skipped',{
            operationId:operationId,
            reason:'STATUS_NOT_PENDING',
            currentStatus:readResult.data.status
          },null);
        }
        return dependencies.queue.startProcessing(
          operationId,
          options&&options.queueOptions
        ).then(function(startResult){
          if(!startResult||!startResult.ok||!startResult.data){
            return result(false,'error',null,safeError(
              'QUEUE_START_PROCESSING_FAILED',
              'The queue operation could not enter processing.'
            ));
          }
          return processStartedOperation(
            operationId,
            startResult.data,
            dependencies.queue,
            dependencies.snapshotSync,
            options
          );
        });
      })
      .catch(function(){
        return result(false,'error',null,safeError(
          'SYNC_PROCESSOR_ERROR',
          'The sync operation could not be processed.'
        ));
      })
      .then(function(processResult){
        delete activeOperationIds[operationId];
        return processResult;
      },function(){
        delete activeOperationIds[operationId];
        return result(false,'error',null,safeError(
          'SYNC_PROCESSOR_ERROR',
          'The sync operation could not be processed.'
        ));
      });
  }

  function normalizeLimit(options){
    if(!options||options.limit===undefined)return 25;
    if(!Number.isInteger(options.limit)||options.limit<1||
      options.limit>100){
      return null;
    }
    return options.limit;
  }

  function summarizeBatchResult(summary,operationResult){
    summary.processed++;
    summary.results.push(operationResult);
    if(operationResult&&
      (operationResult.status==='applied'||
      operationResult.status==='duplicate')){
      summary.applied++;
    }else if(operationResult&&operationResult.status==='conflict'){
      summary.conflicts++;
    }else if(operationResult&&operationResult.status==='skipped'||
      operationResult&&operationResult.status==='busy'){
      summary.skipped++;
    }else{
      summary.failed++;
    }
  }

  function processReadyOperations(options){
    options=options&&typeof options==='object'?options:{};
    if(batchRunning){
      return Promise.resolve(result(true,'busy',{
        reason:'BATCH_ALREADY_RUNNING'
      },null));
    }
    var limit=normalizeLimit(options);
    if(limit===null){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_LIMIT',
        'limit must be an integer between 1 and 100.'
      )));
    }
    var dependencies=resolveDependencies(options);
    if(!hasQueueApi(dependencies.queue)){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_QUEUE_UNAVAILABLE',
        'The sync queue is unavailable.'
      )));
    }

    batchRunning=true;
    var summary={
      requested:0,
      processed:0,
      applied:0,
      conflicts:0,
      failed:0,
      skipped:0,
      results:[]
    };
    return Promise.resolve()
      .then(function(){
        return dependencies.queue.getReadyOperations(options.queueOptions);
      })
      .then(function(readyResult){
        if(!readyResult||!readyResult.ok){
          return result(false,'error',null,safeError(
            'QUEUE_READY_READ_FAILED',
            'Ready queue operations could not be read.'
          ));
        }
        var operations=readyResult.data&&
          Array.isArray(readyResult.data.operations)
          ?readyResult.data.operations.slice(0,limit)
          :[];
        summary.requested=operations.length;
        var sequence=Promise.resolve();
        operations.forEach(function(operation){
          sequence=sequence.then(function(){
            return processOperation(operation.operationId,{
              queue:dependencies.queue,
              snapshotSync:dependencies.snapshotSync,
              queueOptions:options.queueOptions
            });
          }).then(function(operationResult){
            summarizeBatchResult(summary,operationResult);
          });
        });
        return sequence.then(function(){
          return result(true,'completed',summary,null);
        });
      })
      .catch(function(){
        return result(false,'error',null,safeError(
          'SYNC_BATCH_ERROR',
          'Ready queue operations could not be processed.'
        ));
      })
      .then(function(batchResult){
        batchRunning=false;
        return batchResult;
      },function(){
        batchRunning=false;
        return result(false,'error',null,safeError(
          'SYNC_BATCH_ERROR',
          'Ready queue operations could not be processed.'
        ));
      });
  }

  function getProcessorState(){
    return {
      batchRunning:batchRunning,
      activeOperationIds:Object.keys(activeOperationIds).sort()
    };
  }

  function resetProcessorStateForTests(){
    activeOperationIds=Object.create(null);
    batchRunning=false;
  }

  global.SyncQueueProcessor=Object.freeze({
    processOperation:processOperation,
    processReadyOperations:processReadyOperations,
    getProcessorState:getProcessorState,
    resetProcessorStateForTests:resetProcessorStateForTests
  });
})(window);
