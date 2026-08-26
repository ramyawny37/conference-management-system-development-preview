(function(global){
  'use strict';

  var STORE_NAME = 'sync_operations_queue';
  var STATUSES = Object.freeze([
    'pending',
    'processing',
    'verifying_server',
    'server_applied',
    'requires_reconciliation',
    'applied',
    'conflict',
    'failed',
    'resolved',
    'discarded'
  ]);
  var TRANSITIONS = Object.freeze({
    pending: Object.freeze(['processing']),
    processing: Object.freeze(['verifying_server','server_applied']),
    verifying_server: Object.freeze([
      'pending','server_applied','requires_reconciliation','conflict','failed'
    ]),
    server_applied: Object.freeze(['applied']),
    requires_reconciliation: Object.freeze(['verifying_server']),
    applied: Object.freeze([]),
    conflict: Object.freeze(['resolved','discarded']),
    failed: Object.freeze(['pending']),
    resolved: Object.freeze([]),
    discarded: Object.freeze([])
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
    if(input.localConferenceId!==undefined&&
      !String(input.localConferenceId||'').trim()){
      return safeError(
        'INVALID_LOCAL_CONFERENCE_ID',
        'localConferenceId must be a non-empty string.'
      );
    }
    if(input.localContentVersion!==undefined&&
      (!Number.isInteger(input.localContentVersion)||
        input.localContentVersion<0)){
      return safeError(
        'INVALID_LOCAL_CONTENT_VERSION',
        'localContentVersion must be a non-negative integer.'
      );
    }
    if(input.createdByUserId!==undefined&&
      !isUuid(String(input.createdByUserId||''))){
      return safeError(
        'INVALID_CREATED_BY_USER_ID',
        'createdByUserId must be a valid UUID.'
      );
    }
    if(input.operationType!==undefined&&
      input.operationType!=='snapshot'){
      return safeError(
        'INVALID_OPERATION_TYPE',
        'operationType must be snapshot.'
      );
    }
    if(input.idempotencyKey!==undefined&&
      !String(input.idempotencyKey||'').trim()){
      return safeError(
        'INVALID_IDEMPOTENCY_KEY',
        'idempotencyKey must be a non-empty string.'
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
      queueSchemaVersion:1,
      localConferenceId:input.localConferenceId===undefined
        ?null:String(input.localConferenceId),
      conferenceId:String(input.conferenceId),
      cloudConferenceId:String(input.conferenceId),
      operationType:String(input.operationType||'snapshot'),
      localContentVersion:Number.isInteger(input.localContentVersion)
        ?input.localContentVersion:null,
      createdByUserId:input.createdByUserId
        ?String(input.createdByUserId):null,
      idempotencyKey:input.idempotencyKey
        ?String(input.idempotencyKey):null,
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

  function coalesceSnapshotOperation(input,options){
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
    var snapshot;
    var now;
    try{
      snapshot = cloneValue(input.snapshot);
      now = resolveNow(options).toISOString();
    }catch(error){
      return Promise.resolve(result(false,'error',null,safeError(
        'QUEUE_DATA_PREPARATION_FAILED',
        'The queue operation could not be prepared.'
      )));
    }
    var storedOperation;
    var coalescedOperationIds=[];
    var wasCoalesced=false;
    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store=stores[STORE_NAME];
      return requestToPromise(store.getAll()).then(function(operations){
        var candidates=operations.filter(function(operation){
          return operation.conferenceId===String(input.conferenceId)&&
            operation.deviceId===String(input.deviceId)&&
            (!input.localConferenceId||
              !operation.localConferenceId||
              operation.localConferenceId===
                String(input.localConferenceId))&&
            (operation.status==='pending'&&operation.attempts===0||
              (operation.status==='failed'&&operation.attempts===0));
        }).sort(function(first,second){
          return String(first.createdAt).localeCompare(
            String(second.createdAt)
          )||String(first.operationId).localeCompare(
            String(second.operationId)
          );
        });
        if(!candidates.length){
          var operationId=input.operationId
            ?String(input.operationId)
            :createUuid();
          storedOperation={
            operationId:operationId,
            queueSchemaVersion:1,
            localConferenceId:input.localConferenceId===undefined
              ?null:String(input.localConferenceId),
            conferenceId:String(input.conferenceId),
            cloudConferenceId:String(input.conferenceId),
            operationType:String(input.operationType||'snapshot'),
            localContentVersion:Number.isInteger(
              input.localContentVersion
            )?input.localContentVersion:null,
            createdByUserId:input.createdByUserId
              ?String(input.createdByUserId):null,
            idempotencyKey:input.idempotencyKey
              ?String(input.idempotencyKey):null,
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
          return requestToPromise(store.add(storedOperation));
        }
        wasCoalesced=true;
        storedOperation=candidates[0];
        storedOperation.baseRevision=input.baseRevision;
        storedOperation.snapshot=snapshot;
        storedOperation.queueSchemaVersion=1;
        storedOperation.localConferenceId=
          input.localConferenceId===undefined
            ?storedOperation.localConferenceId||null
            :String(input.localConferenceId);
        storedOperation.cloudConferenceId=String(input.conferenceId);
        storedOperation.operationType=String(
          input.operationType||'snapshot'
        );
        storedOperation.localContentVersion=
          Number.isInteger(input.localContentVersion)
            ?input.localContentVersion
            :storedOperation.localContentVersion||null;
        storedOperation.createdByUserId=input.createdByUserId
          ?String(input.createdByUserId)
          :storedOperation.createdByUserId||null;
        storedOperation.idempotencyKey=input.idempotencyKey
          ?String(input.idempotencyKey)
          :storedOperation.idempotencyKey||null;
        storedOperation.schemaVersion=String(input.schemaVersion).trim();
        storedOperation.appVersion=String(input.appVersion).trim();
        storedOperation.status='pending';
        storedOperation.updatedAt=now;
        storedOperation.nextAttemptAt=null;
        storedOperation.lastError=null;
        coalescedOperationIds=candidates.slice(1).map(function(operation){
          return operation.operationId;
        });
        return requestToPromise(store.put(storedOperation)).then(function(){
          return Promise.all(coalescedOperationIds.map(function(operationId){
            return requestToPromise(store.delete(operationId));
          }));
        });
      });
    }).then(function(){
      return result(true,wasCoalesced?'coalesced':'enqueued',{
        operation:cloneValue(storedOperation),
        removedOperationIds:coalescedOperationIds
      },null);
    }).catch(function(error){
      return result(false,'error',null,normalizeStorageError(error));
    });
  }

  function rebasePendingOperations(
    conferenceId,
    deviceId,
    baseRevision,
    options
  ){
    conferenceId=String(conferenceId||'');
    deviceId=String(deviceId||'');
    if(!isUuid(conferenceId)){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      )));
    }
    if(!isUuid(deviceId)){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_DEVICE_ID',
        'deviceId must be a valid UUID.'
      )));
    }
    if(!Number.isInteger(baseRevision)||baseRevision<0){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_BASE_REVISION',
        'baseRevision must be a non-negative integer.'
      )));
    }
    var repository=getRepository();
    if(!repository){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_QUEUE_UNAVAILABLE',
        'The sync queue is unavailable.'
      )));
    }
    var now;
    try{
      now=resolveNow(options).toISOString();
    }catch(error){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_DATE',
        'A valid current time is required.'
      )));
    }
    var rebasedOperationIds=[];
    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store=stores[STORE_NAME];
      return requestToPromise(store.getAll()).then(function(operations){
        return Promise.all(operations.filter(function(operation){
          return operation.conferenceId===conferenceId&&
            operation.deviceId===deviceId&&
            operation.status==='pending'&&
            operation.attempts===0;
        }).map(function(operation){
          operation.baseRevision=baseRevision;
          operation.updatedAt=now;
          rebasedOperationIds.push(operation.operationId);
          return requestToPromise(store.put(operation));
        }));
      });
    }).then(function(){
      return result(true,'rebased',{
        baseRevision:baseRevision,
        operationIds:rebasedOperationIds,
        count:rebasedOperationIds.length
      },null);
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

  function getConferenceReadiness(conferenceId,options){
    conferenceId=String(conferenceId||'');
    if(!isUuid(conferenceId)){
      return Promise.resolve(result(false,'invalid_conference_id'));
    }
    return getAllOperations(options).then(function(read){
      if(!read||!read.ok||read.status!=='listed'||
        !read.data||!Array.isArray(read.data.operations)){
        return result(false,'queue_read_failed');
      }
      var active=read.data.operations.filter(function(operation){
        return operation&&operation.conferenceId===conferenceId&&
          ['pending','processing','failed','server_applied',
            'requires_reconciliation']
            .indexOf(operation.status)>=0;
      });
      if(active.length){
        return result(false,'not_stable',{
          conferenceId:conferenceId,
          blockingOperations:cloneValue(active)
        });
      }
      return result(true,'stable',{
        conferenceId:conferenceId,
        blockingOperations:[]
      });
    });
  }

  function countOperationsByStatus(){
    return readAllOperations().then(function(operations){
      var counts = {
        pending:0,
        processing:0,
        verifying_server:0,
        server_applied:0,
        requires_reconciliation:0,
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

  function beginServerVerification(operationId,options){
    return updateOperation(operationId,'verifying_server',function(operation,now){
      operation.recovery=Object.assign({},operation.recovery||{}, {
        operationId:operation.operationId,
        verificationStartedAt:now
      });
      operation.nextAttemptAt=null;
    },options);
  }

  function checkpointServerApplied(operationId,applyResult,options){
    applyResult=applyResult&&typeof applyResult==='object'?applyResult:{};
    if(!Number.isInteger(applyResult.revision)||applyResult.revision<1){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_REVISION','A positive applied revision is required.'
      )));
    }
    return updateOperation(operationId,'server_applied',function(operation,now){
      operation.result={
        revision:applyResult.revision,
        previousRevision:Number.isInteger(applyResult.previousRevision)
          ?applyResult.previousRevision:operation.baseRevision,
        conferenceId:operation.conferenceId,
        operationId:operation.operationId,
        serverAppliedAt:applyResult.serverAppliedAt||now
      };
      operation.lastError=null;
      operation.nextAttemptAt=null;
    },options);
  }

  function requireReconciliation(operationId,error,options){
    return updateOperation(operationId,'requires_reconciliation',
      function(operation,now){
        var previousAttempts=Number.isInteger(
          operation.recovery&&operation.recovery.verificationAttempts
        )?operation.recovery.verificationAttempts:0;
        var delays=[15000,60000,300000];
        var verificationAttempts=previousAttempts+1;
        operation.lastError=sanitizedAttemptError(error||{
          code:'SERVER_VERIFICATION_UNAVAILABLE'
        });
        operation.recovery=Object.assign({},operation.recovery||{}, {
          operationId:operation.operationId,
          reconciliationRequiredAt:now,
          verificationAttempts:verificationAttempts,
          nextVerificationAt:new Date(new Date(now).getTime()+delays[
            Math.min(verificationAttempts-1,delays.length-1)
          ]).toISOString()
        });
        operation.nextAttemptAt=null;
      },options);
  }

  function resumeServerVerification(operationId,options){
    return updateOperation(operationId,'verifying_server',function(operation,now){
      operation.recovery=Object.assign({},operation.recovery||{}, {
        operationId:operation.operationId,
        verificationStartedAt:now,
        nextVerificationAt:null
      });
      operation.lastError=null;
    },options);
  }

  function restoreVerifiedMissingToPending(operationId,options){
    return updateOperation(operationId,'pending',function(operation){
      operation.nextAttemptAt=null;
      operation.lastError=null;
      operation.recovery=null;
    },options);
  }

  function markConflictResolved(operationId,input,options){
    input=input&&typeof input==='object'?input:{};
    var target=input.strategy==='keep_server'?'discarded':'resolved';
    if(!isUuid(String(operationId||''))){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_OPERATION_ID','operationId must be a valid UUID.'
      )));
    }
    var repository=getRepository();
    if(!repository)return Promise.resolve(result(false,'error',null,safeError(
      'SYNC_QUEUE_UNAVAILABLE','The sync queue is unavailable.'
    )));
    var now;
    try{now=resolveNow(options).toISOString();}
    catch(error){return Promise.resolve(result(false,'error',null,safeError(
      'INVALID_DATE','A valid current time is required.'
    )));}
    var updated;
    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store=stores[STORE_NAME];
      return requestToPromise(store.get(String(operationId))).then(function(operation){
        if(!operation)throw new Error('OPERATION_NOT_FOUND');
        if(operation.status===target){
          var previous=operation.conflictResolution||{};
          if(previous.conflictId!==String(input.conflictId||'')||
            previous.resolutionOperationId!==
              String(input.resolutionOperationId||'')||
            previous.strategy!==String(input.strategy||'')||
            previous.revision!==
              (Number.isInteger(input.revision)?input.revision:null)){
            throw new Error('RESOLUTION_RESULT_MISMATCH');
          }
          updated=operation;
          return null;
        }
        if(operation.status!=='conflict')throw new Error('INVALID_STATUS_TRANSITION');
        operation.status=target;
        operation.updatedAt=now;
        operation.conflictResolution={
          conflictId:String(input.conflictId||''),
          resolutionOperationId:String(input.resolutionOperationId||''),
          strategy:String(input.strategy||''),
          revision:Number.isInteger(input.revision)?input.revision:null,
          resolvedAt:now
        };
        updated=operation;
        return requestToPromise(store.put(operation));
      });
    }).then(function(){
      return result(true,updated.status,cloneValue(updated),null);
    }).catch(function(error){
      return result(false,'error',null,safeError(
        error&&error.message||'QUEUE_UPDATE_FAILED',
        'The conflict queue operation could not be finalized.'
      ));
    });
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
        operation.result = {
          revision:revision,
          previousRevision:Number.isInteger(applyResult.previousRevision)
            ?applyResult.previousRevision
            :operation.baseRevision,
          conferenceId:isUuid(String(applyResult.conferenceId||''))
            ?String(applyResult.conferenceId)
            :operation.conferenceId,
          operationId:operation.operationId
        };
        if(typeof applyResult.recoveryReason==='string'&&
          applyResult.recoveryReason.trim()){
          operation.result.recoveryReason=applyResult.recoveryReason.trim();
        }
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
          operation.status = 'verifying_server';
          operation.updatedAt = now.toISOString();
          operation.nextAttemptAt = null;
          operation.lastError = {
            code:'STALE_PROCESSING_REQUIRES_VERIFICATION',
            message:'A stale processing operation requires server verification.'
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

  function discardConferenceOperations(conferenceId,options){
    conferenceId=String(conferenceId||'');
    if(!isUuid(conferenceId))return Promise.resolve(result(false,'error',null,
      safeError('INVALID_CONFERENCE_ID','A valid conference ID is required.')));
    var repository=getRepository();
    if(!repository)return Promise.resolve(result(false,'error',null,
      safeError('SYNC_QUEUE_UNAVAILABLE','The sync queue is unavailable.')));
    var now=resolveNow(options).toISOString(),discarded=[];
    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store=stores[STORE_NAME];
      return requestToPromise(store.getAll()).then(function(operations){
        return Promise.all(operations.filter(function(operation){
          return operation.conferenceId===conferenceId&&
            ['pending','processing','verifying_server','server_applied',
              'requires_reconciliation','failed','conflict']
              .indexOf(operation.status)>=0;
        }).map(function(operation){
          operation.status='discarded';operation.updatedAt=now;
          operation.nextAttemptAt=null;
          operation.resetDisposition={reason:'experimental_conference_reset',discardedAt:now};
          discarded.push(operation.operationId);
          return requestToPromise(store.put(operation));
        }));
      });
    }).then(function(){return result(true,'discarded',{operationIds:discarded,count:discarded.length},null);})
      .catch(function(error){return result(false,'error',null,normalizeStorageError(error));});
  }

  function isolatePostRestoreOperations(input,options){
    input=input&&typeof input==='object'?input:{};
    var requested=Array.isArray(input.operationIds)
      ?input.operationIds.map(String):[];
    if(!requested.length||requested.some(function(id){return !isUuid(id);})){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_OPERATION_IDS','Valid operation IDs are required.'
      )));
    }
    var repository=getRepository();
    if(!repository)return Promise.resolve(result(false,'error',null,safeError(
      'SYNC_QUEUE_UNAVAILABLE','The sync queue is unavailable.'
    )));
    var now;
    try{now=resolveNow(options).toISOString();}
    catch(error){return Promise.resolve(result(false,'error',null,safeError(
      'INVALID_DATE','A valid current time is required.'
    )));}
    var isolated=[];
    return repository.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store=stores[STORE_NAME];
      return requestToPromise(store.getAll()).then(function(operations){
        var byId=Object.create(null);
        operations.forEach(function(operation){
          byId[String(operation.operationId||'')]=operation;
        });
        var targets=requested.map(function(id){
          var operation=byId[id];
          if(!operation)throw new Error('OPERATION_NOT_FOUND');
          if(operation.status==='discarded'&&operation.postRestoreIsolation){
            return null;
          }
          var neverAttempted=(operation.status==='pending'||
            operation.status==='failed')&&operation.attempts===0;
          if(!neverAttempted){
            throw new Error('OPERATION_NOT_PROVEN_UNEXECUTED');
          }
          return {operation:operation,proof:'never_attempted'};
        }).filter(Boolean);
        return Promise.all(targets.map(function(target){
          var operation=target.operation;
          var previousStatus=operation.status;
          operation.status='discarded';
          operation.updatedAt=now;
          operation.nextAttemptAt=null;
          operation.postRestoreIsolation={
            operationId:operation.operationId,
            reason:'restored_snapshot_old_cloud_link',
            proof:target.proof,
            previousStatus:previousStatus,
            isolatedAt:now
          };
          isolated.push({operationId:operation.operationId,
            proof:target.proof,previousStatus:previousStatus});
          return requestToPromise(store.put(operation));
        }));
      });
    }).then(function(){
      return result(true,'isolated',{operations:isolated,
        count:isolated.length},null);
    }).catch(function(error){
      return result(false,'error',null,safeError(
        error&&error.message||'POST_RESTORE_ISOLATION_FAILED',
        'The post-restore queue operation could not be isolated.'
      ));
    });
  }

  global.OfflineSyncQueue = Object.freeze({
    statuses:STATUSES,
    enqueueSnapshotOperation:enqueueSnapshotOperation,
    coalesceSnapshotOperation:coalesceSnapshotOperation,
    rebasePendingOperations:rebasePendingOperations,
    getOperation:getOperation,
    getAllOperations:getAllOperations,
    getOperationsByConference:getOperationsByConference,
    getReadyOperations:getReadyOperations,
    getConferenceReadiness:getConferenceReadiness,
    countOperationsByStatus:countOperationsByStatus,
    markConflictResolved:markConflictResolved,
    startProcessing:startProcessing,
    beginServerVerification:beginServerVerification,
    checkpointServerApplied:checkpointServerApplied,
    requireReconciliation:requireReconciliation,
    resumeServerVerification:resumeServerVerification,
    restoreVerifiedMissingToPending:restoreVerifiedMissingToPending,
    markApplied:markApplied,
    markConflict:markConflict,
    markFailed:markFailed,
    retryFailedOperation:retryFailedOperation,
    recoverStaleProcessing:recoverStaleProcessing,
    deleteAppliedOperation:deleteAppliedOperation,
    deleteAppliedBefore:deleteAppliedBefore,
    discardConferenceOperations:discardConferenceOperations,
    isolatePostRestoreOperations:isolatePostRestoreOperations,
    calculateBackoffDelay:calculateBackoffDelay
  });
})(window);
