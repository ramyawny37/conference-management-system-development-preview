(function(global){
  'use strict';

  var STORE_NAME = 'sync_operations_queue';
  var STATUSES = Object.freeze([
    'pending',
    'processing',
    'applied',
    'conflict',
    'failed'
  ]);
  var TRANSITIONS = Object.freeze({
    pending: Object.freeze(['processing']),
    processing: Object.freeze(['pending','applied','conflict','failed']),
    applied: Object.freeze([]),
    conflict: Object.freeze([]),
    failed: Object.freeze(['pending'])
  });
  var BACKOFF_DELAYS = Object.freeze([
    5000,
    15000,
    30000,
    60000,
    120000,
    300000
  ]);

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
      code:code||'SYNC_QUEUE_ERROR',
      message:message||'The sync queue operation failed.'
    };
  }

  function requestToPromise(request){
    return new Promise(function(resolve,reject){
      request.onsuccess = function(){ resolve(request.result); };
      request.onerror = function(){ reject(request.error); };
    });
  }

  function getRepository(){
    if(!global.AppIndexedDB||
      typeof global.AppIndexedDB.runTransaction!=='function'){
      return null;
    }
    return global.AppIndexedDB;
  }

  function cloneValue(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function createUuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return global.crypto.randomUUID();
    }
    if(global.crypto&&typeof global.crypto.getRandomValues==='function'){
      var bytes = new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6]&15)|64;
      bytes[8] = (bytes[8]&63)|128;
      return Array.prototype.map.call(bytes,function(byte,index){
        var value = byte.toString(16).padStart(2,'0');
        return index===4||index===6||index===8||index===10
          ?'-'+value
          :value;
      }).join('');
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }

  function normalizeDate(value){
    var date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime())?null:date;
  }

  function resolveNow(options){
    var supplied = options&&typeof options.now==='function'
      ?options.now()
      :options&&options.now;
    var date = supplied===undefined ? new Date() : normalizeDate(supplied);
    if(!date)throw new Error('INVALID_DATE');
    return date;
  }

  function sortOperations(operations){
    return operations.slice().sort(function(first,second){
      var createdComparison = String(first.createdAt||'')
        .localeCompare(String(second.createdAt||''));
      return createdComparison||
        String(first.operationId||'').localeCompare(
          String(second.operationId||'')
        );
    });
  }

  function normalizeStorageError(error){
    var name = error&&typeof error.name==='string'?error.name:'';
    if(name==='ConstraintError'){
      return safeError(
        'DUPLICATE_OPERATION_ID',
        'An operation with this operationId already exists.'
      );
    }
    return safeError('SYNC_QUEUE_STORAGE_ERROR','The sync queue is unavailable.');
  }

  function sanitizedAttemptError(error){
    var code = error&&typeof error.code==='string'
      ?error.code.toUpperCase().replace(/[^A-Z0-9_]/g,'').slice(0,64)
      :'SYNC_ATTEMPT_FAILED';
    return {
      code:code||'SYNC_ATTEMPT_FAILED',
      message:'The snapshot sync attempt failed.'
    };
  }

  function calculateBackoffDelay(attempts){
    if(!Number.isInteger(attempts)||attempts<1)return BACKOFF_DELAYS[0];
    return BACKOFF_DELAYS[
      Math.min(attempts-1,BACKOFF_DELAYS.length-1)
    ];
  }

  function validateEnqueueInput(input){
    if(!input||typeof input!=='object'){
      return safeError('INVALID_INPUT','Queue input must be an object.');
    }
    if(!isUuid(String(input.conferenceId||''))){
      return safeError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      );
    }
    if(!isUuid(String(input.deviceId||''))){
      return safeError('INVALID_DEVICE_ID','deviceId must be a valid UUID.');
    }
    if(!Number.isInteger(input.baseRevision)||input.baseRevision<0){
      return safeError(
        'INVALID_BASE_REVISION',
        'baseRevision must be a non-negative integer.'
      );
    }
    if(!input.snapshot||typeof input.snapshot!=='object'||
      Array.isArray(input.snapshot)){
      return safeError('INVALID_SNAPSHOT','snapshot must be an object.');
    }
    if(!String(input.schemaVersion||'').trim()){
      return safeError(
        'SCHEMA_VERSION_REQUIRED',
        'schemaVersion is required.'
      );
    }
    if(!String(input.appVersion||'').trim()){
      return safeError('APP_VERSION_REQUIRED','appVersion is required.');
    }
    if(input.operationId&&!isUuid(String(input.operationId))){
      return safeError(
        'INVALID_OPERATION_ID',
        'operationId must be a valid UUID.'
      );
    }
    return null;
  }

  function enqueueSnapshotOperation(input,options){
    var validation = validateEnqueueInput(input);
    if(validation){
      return Promise.resolve(result(false,'error',null,validation));
    }
    var repository = getRepository();
    if(!repository){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_QUEUE_UNAVAILABLE',
        'The sync queue is unavailable.'
      )));
    }
    var operationId;
    var snapshot;
    var now;
    try{
      operationId = input.operationId
        ?String(input.operationId)
        :createUuid();
      snapshot = cloneValue(input.snapshot);
      now = resolveNow(options).toISOString();
    }catch(error){
      return Promise.resolve(result(false,'error',null,safeError(
        error&&error.message==='SECURE_UUID_UNAVAILABLE'
          ?'SECURE_UUID_UNAVAILABLE'
          :'QUEUE_DATA_PREPARATION_FAILED',
        'The queue operation could not be prepared.'
      )));
    }
    var operation = {
      operationId:operationId,
      conferenceId:String(input.conferenceId),
      deviceId:String(input.deviceId),
      baseRevision:input.baseRevision,
      snapshot:snapshot,
      schemaVersion:String(input.schemaVersion).trim(),
      appVersion:String(input.appVersion).trim(),
      status:'pending',
      attempts:0,
      createdAt:now,
      updatedAt:now,
      lastAttemptAt:null,
      nextAttemptAt:null,
      lastError:null,
      result:null,
      conflict:null
    };

    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      return requestToPromise(stores[STORE_NAME].add(operation));
    }).then(function(){
      return result(true,'enqueued',cloneValue(operation),null);
    }).catch(function(error){
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  function getOperation(operationId){
    if(!isUuid(String(operationId||''))){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_OPERATION_ID',
        'operationId must be a valid UUID.'
      )));
    }
    var repository = getRepository();
    if(!repository){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_QUEUE_UNAVAILABLE',
        'The sync queue is unavailable.'
      )));
    }
    return repository.getRecord(STORE_NAME,String(operationId))
      .then(function(operation){
        return result(
          true,
          operation?'found':'not_found',
          operation?cloneValue(operation):null,
          null
        );
      })
      .catch(function(error){
        return result(false,'error',null,normalizeStorageError(error));
      });
  }

  function readAllOperations(){
    var repository = getRepository();
    if(!repository){
      return Promise.reject(new Error('SYNC_QUEUE_UNAVAILABLE'));
    }
    return repository.getAllRecords(STORE_NAME).then(sortOperations);
  }

  function getAllOperations(){
    return readAllOperations().then(function(operations){
      return result(true,'listed',{operations:cloneValue(operations)},null);
    }).catch(function(error){
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  function getOperationsByConference(conferenceId){
    if(!isUuid(String(conferenceId||''))){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      )));
    }
    return readAllOperations().then(function(operations){
      var filtered = operations.filter(function(operation){
        return operation.conferenceId===String(conferenceId);
      });
      return result(true,'listed',{operations:cloneValue(filtered)},null);
    }).catch(function(error){
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  function getReadyOperations(options){
    var now;
    try{
      now = resolveNow(options).toISOString();
    }catch(error){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_DATE',
        'A valid current time is required.'
      )));
    }
    return readAllOperations().then(function(operations){
      var ready = operations.filter(function(operation){
        return operation.status==='pending'&&
          (!operation.nextAttemptAt||operation.nextAttemptAt<=now);
      });
      return result(true,'listed',{operations:cloneValue(ready)},null);
    }).catch(function(error){
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  function countOperationsByStatus(){
    return readAllOperations().then(function(operations){
      var counts = {
        pending:0,
        processing:0,
        applied:0,
        conflict:0,
        failed:0
      };
      operations.forEach(function(operation){
        if(Object.prototype.hasOwnProperty.call(counts,operation.status)){
          counts[operation.status]++;
        }
      });
      return result(true,'counted',{total:operations.length,counts:counts},null);
    }).catch(function(error){
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  function isTransitionAllowed(fromStatus,toStatus){
    return STATUSES.indexOf(fromStatus)!==-1&&
      STATUSES.indexOf(toStatus)!==-1&&
      TRANSITIONS[fromStatus].indexOf(toStatus)!==-1;
  }

  function updateOperation(operationId,toStatus,updater,options){
    if(!isUuid(String(operationId||''))){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_OPERATION_ID',
        'operationId must be a valid UUID.'
      )));
    }
    var repository = getRepository();
    if(!repository){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_QUEUE_UNAVAILABLE',
        'The sync queue is unavailable.'
      )));
    }
    var now;
    try{
      now = resolveNow(options).toISOString();
    }catch(error){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_DATE',
        'A valid current time is required.'
      )));
    }
    var updatedOperation;
    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store = stores[STORE_NAME];
      return requestToPromise(store.get(String(operationId)))
        .then(function(operation){
          if(!operation)throw new Error('OPERATION_NOT_FOUND');
          if(!isTransitionAllowed(operation.status,toStatus)){
            throw new Error('INVALID_STATUS_TRANSITION');
          }
          updater(operation,now);
          operation.status = toStatus;
          operation.updatedAt = now;
          updatedOperation = operation;
          return requestToPromise(store.put(operation));
        });
    }).then(function(){
      return result(
        true,
        toStatus,
        cloneValue(updatedOperation),
        null
      );
    }).catch(function(error){
      var code = error&&error.message;
      if(code==='OPERATION_NOT_FOUND'){
        return result(false,'error',null,safeError(
          code,
          'The queue operation was not found.'
        ));
      }
      if(code==='INVALID_STATUS_TRANSITION'){
        return result(false,'error',null,safeError(
          code,
          'The requested status transition is not allowed.'
        ));
      }
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  function startProcessing(operationId,options){
    return updateOperation(
      operationId,
      'processing',
      function(operation,now){
        operation.attempts = (
          Number.isInteger(operation.attempts)?operation.attempts:0
        )+1;
        operation.lastAttemptAt = now;
        operation.nextAttemptAt = null;
        operation.lastError = null;
      },
      options
    );
  }

  function markApplied(operationId,applyResult,options){
    applyResult = applyResult&&typeof applyResult==='object'?applyResult:{};
    var revision = applyResult.revision;
    if(!Number.isInteger(revision)||revision<1){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_REVISION',
        'A positive applied revision is required.'
      )));
    }
    return updateOperation(
      operationId,
      'applied',
      function(operation){
        operation.result = {revision:revision};
        operation.conflict = null;
        operation.nextAttemptAt = null;
        operation.lastError = null;
      },
      options
    );
  }

  function markConflict(operationId,conflictResult,options){
    conflictResult = conflictResult&&typeof conflictResult==='object'
      ?conflictResult
      :{};
    var expectedRevision = conflictResult.expectedRevision;
    var actualRevision = conflictResult.actualRevision;
    if(!Number.isInteger(expectedRevision)||expectedRevision<0||
      !Number.isInteger(actualRevision)||actualRevision<0){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFLICT_REVISIONS',
        'Valid conflict revisions are required.'
      )));
    }
    if(conflictResult.conflictId&&
      !isUuid(String(conflictResult.conflictId))){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFLICT_ID',
        'conflictId must be a valid UUID.'
      )));
    }
    return updateOperation(
      operationId,
      'conflict',
      function(operation){
        operation.conflict = {
          conflictId:conflictResult.conflictId
            ?String(conflictResult.conflictId)
            :null,
          expectedRevision:expectedRevision,
          actualRevision:actualRevision
        };
        operation.result = null;
        operation.nextAttemptAt = null;
        operation.lastError = null;
      },
      options
    );
  }

  function markFailed(operationId,error,options){
    return updateOperation(
      operationId,
      'failed',
      function(operation,now){
        operation.lastError = sanitizedAttemptError(error);
        operation.nextAttemptAt = new Date(
          new Date(now).getTime()+
          calculateBackoffDelay(operation.attempts)
        ).toISOString();
        operation.result = null;
      },
      options
    );
  }

  function retryFailedOperation(operationId,options){
    return updateOperation(
      operationId,
      'pending',
      function(operation){
        operation.nextAttemptAt = null;
        operation.lastError = null;
      },
      options
    );
  }

  function recoverStaleProcessing(options){
    options = options&&typeof options==='object'?options:{};
    var staleAfterMs = Number.isInteger(options.staleAfterMs)&&
      options.staleAfterMs>0
      ?options.staleAfterMs
      :300000;
    var repository = getRepository();
    if(!repository){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_QUEUE_UNAVAILABLE',
        'The sync queue is unavailable.'
      )));
    }
    var now;
    try{
      now = resolveNow(options);
    }catch(error){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_DATE',
        'A valid current time is required.'
      )));
    }
    var cutoff = now.getTime()-staleAfterMs;
    var recovered = [];
    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store = stores[STORE_NAME];
      return requestToPromise(store.getAll()).then(function(operations){
        var updates = operations.filter(function(operation){
          var lastAttempt = normalizeDate(operation.lastAttemptAt);
          return operation.status==='processing'&&lastAttempt&&
            lastAttempt.getTime()<=cutoff;
        }).map(function(operation){
          operation.status = 'pending';
          operation.updatedAt = now.toISOString();
          operation.nextAttemptAt = null;
          operation.lastError = {
            code:'STALE_PROCESSING_RECOVERED',
            message:'A stale processing operation was restored.'
          };
          recovered.push(operation.operationId);
          return requestToPromise(store.put(operation));
        });
        return Promise.all(updates);
      });
    }).then(function(){
      return result(true,'recovered',{
        recoveredOperationIds:recovered,
        count:recovered.length
      },null);
    }).catch(function(error){
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  function deleteAppliedOperation(operationId){
    if(!isUuid(String(operationId||''))){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_OPERATION_ID',
        'operationId must be a valid UUID.'
      )));
    }
    var repository = getRepository();
    if(!repository){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_QUEUE_UNAVAILABLE',
        'The sync queue is unavailable.'
      )));
    }
    var deleted = false;
    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store = stores[STORE_NAME];
      return requestToPromise(store.get(String(operationId)))
        .then(function(operation){
          if(!operation)throw new Error('OPERATION_NOT_FOUND');
          if(operation.status!=='applied'){
            throw new Error('DELETE_REQUIRES_APPLIED_STATUS');
          }
          return requestToPromise(store.delete(String(operationId)));
        }).then(function(){ deleted = true; });
    }).then(function(){
      return result(true,'deleted',{deleted:deleted},null);
    }).catch(function(error){
      var code = error&&error.message;
      if(code==='OPERATION_NOT_FOUND'||
        code==='DELETE_REQUIRES_APPLIED_STATUS'){
        return result(false,'error',null,safeError(
          code,
          code==='OPERATION_NOT_FOUND'
            ?'The queue operation was not found.'
            :'Only applied operations can be deleted.'
        ));
      }
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  function deleteAppliedBefore(before){
    var cutoff = normalizeDate(before);
    if(!cutoff){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_DATE',
        'A valid cleanup date is required.'
      )));
    }
    var repository = getRepository();
    if(!repository){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_QUEUE_UNAVAILABLE',
        'The sync queue is unavailable.'
      )));
    }
    var deletedIds = [];
    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store = stores[STORE_NAME];
      return requestToPromise(store.getAll()).then(function(operations){
        return Promise.all(operations.filter(function(operation){
          var updatedAt = normalizeDate(operation.updatedAt);
          return operation.status==='applied'&&updatedAt&&
            updatedAt.getTime()<cutoff.getTime();
        }).map(function(operation){
          deletedIds.push(operation.operationId);
          return requestToPromise(store.delete(operation.operationId));
        }));
      });
    }).then(function(){
      return result(true,'deleted',{
        deletedOperationIds:deletedIds,
        count:deletedIds.length
      },null);
    }).catch(function(error){
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  global.OfflineSyncQueue = Object.freeze({
    statuses:STATUSES,
    enqueueSnapshotOperation:enqueueSnapshotOperation,
    getOperation:getOperation,
    getAllOperations:getAllOperations,
    getOperationsByConference:getOperationsByConference,
    getReadyOperations:getReadyOperations,
    countOperationsByStatus:countOperationsByStatus,
    startProcessing:startProcessing,
    markApplied:markApplied,
    markConflict:markConflict,
    markFailed:markFailed,
    retryFailedOperation:retryFailedOperation,
    recoverStaleProcessing:recoverStaleProcessing,
    deleteAppliedOperation:deleteAppliedOperation,
    deleteAppliedBefore:deleteAppliedBefore,
    calculateBackoffDelay:calculateBackoffDelay
  });
})(window);
