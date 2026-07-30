(function(global){
  'use strict';

  var METADATA_VERSION=1;
  var INTENTS=Object.freeze([
    'none',
    'local_only',
    'publish_requested'
  ]);
  var PHASE_STATES=Object.freeze([
    'unpublished',
    'local_only',
    'waiting_for_authorization',
    'ready_to_publish',
    'publishing',
    'publish_failed'
  ]);
  var ACCESS_SOURCES=Object.freeze(['server','cache']);
  var ACCOUNT_STATUSES=Object.freeze([
    'pending','approved','blocked'
  ]);
  var RECOVERY_STATES=Object.freeze([
    'reconciliation_required','reconciling',
    'retryable_same_operation','manual_review_required',
    'reconciliation_failed'
  ]);

  function result(ok,status,data,issues){
    return {
      ok:ok,
      status:status,
      data:data||null,
      issues:Array.isArray(issues)?issues:[]
    };
  }

  function issue(code,path){
    return {code:String(code),path:String(path||'')};
  }

  function object(value){
    return !!value&&typeof value==='object'&&!Array.isArray(value);
  }

  function clone(value){
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

  function timestamp(value){
    if(typeof value!=='string'||!value)return false;
    var milliseconds=Date.parse(value);
    return Number.isFinite(milliseconds);
  }

  function nullableUuid(value){
    return value===null||uuid(value);
  }

  function nullableString(value){
    return value===null||
      typeof value==='string'&&value.trim()===value&&value.length>0;
  }

  function createMetadata(input){
    input=object(input)?input:{};
    var metadata={
      metadataVersion:METADATA_VERSION,
      publishIntent:input.publishIntent||'none',
      requestedAt:input.requestedAt===undefined?null:input.requestedAt,
      requestedByUserId:input.requestedByUserId===undefined
        ?null:input.requestedByUserId,
      requestedByDeviceId:input.requestedByDeviceId===undefined
        ?null:input.requestedByDeviceId,
      lastAccessCheck:input.lastAccessCheck===undefined
        ?null:clone(input.lastAccessCheck),
      reviewRequired:input.reviewRequired===true,
      reviewReason:input.reviewReason===undefined
        ?null:input.reviewReason,
      confirmationAt:input.confirmationAt===undefined
        ?null:input.confirmationAt,
      operationId:input.operationId===undefined?null:input.operationId,
      requestedCloudId:input.requestedCloudId===undefined
        ?null:input.requestedCloudId,
      attemptStartedAt:input.attemptStartedAt===undefined
        ?null:input.attemptStartedAt,
      lastAttemptAt:input.lastAttemptAt===undefined
        ?null:input.lastAttemptAt,
      lastPublishStage:input.lastPublishStage===undefined
        ?null:input.lastPublishStage,
      lastPublishError:input.lastPublishError===undefined
        ?null:clone(input.lastPublishError),
      snapshotContentVersion:input.snapshotContentVersion===undefined
        ?null:input.snapshotContentVersion,
      currentContentVersion:input.currentContentVersion===undefined
        ?null:input.currentContentVersion,
      reconciliationState:input.reconciliationState===undefined
        ?null:input.reconciliationState,
      retryCount:input.retryCount===undefined?0:input.retryCount,
      retryAfter:input.retryAfter===undefined?null:input.retryAfter,
      lastReconciliationAt:input.lastReconciliationAt===undefined
        ?null:input.lastReconciliationAt,
      contentChangedBeforeInitialSnapshot:
        input.contentChangedBeforeInitialSnapshot===true
    };
    return result(true,'metadata_created',metadata,[]);
  }

  function validateAccessCheck(check){
    var issues=[];
    if(!object(check)){
      return result(false,'access_check_invalid',null,[
        issue('ACCESS_CHECK_INVALID','lastAccessCheck')
      ]);
    }
    var allowed=[
      'userId','checkedAt','source','fresh','authenticated',
      'accountStatus','canCreateConferences','isSystemOwner'
    ];
    Object.keys(check).forEach(function(key){
      if(allowed.indexOf(key)<0){
        issues.push(issue(
          'ACCESS_CHECK_FIELD_UNKNOWN','lastAccessCheck.'+key
        ));
      }
    });
    if(ACCESS_SOURCES.indexOf(check.source)<0){
      issues.push(issue(
        'ACCESS_CHECK_SOURCE_INVALID','lastAccessCheck.source'
      ));
    }
    if(typeof check.fresh!=='boolean'){
      issues.push(issue(
        'ACCESS_CHECK_FRESH_INVALID','lastAccessCheck.fresh'
      ));
    }
    if(check.source==='cache'&&check.fresh!==false){
      issues.push(issue(
        'CACHED_ACCESS_CANNOT_BE_FRESH','lastAccessCheck.fresh'
      ));
    }
    if(check.source==='server'&&check.fresh!==true){
      issues.push(issue(
        'SERVER_ACCESS_MUST_BE_FRESH','lastAccessCheck.fresh'
      ));
    }
    if(typeof check.authenticated!=='boolean'){
      issues.push(issue(
        'ACCESS_AUTHENTICATED_INVALID',
        'lastAccessCheck.authenticated'
      ));
    }
    if(check.authenticated){
      if(!uuid(check.userId)){
        issues.push(issue(
          'ACCESS_USER_ID_INVALID','lastAccessCheck.userId'
        ));
      }
      if(ACCOUNT_STATUSES.indexOf(check.accountStatus)<0){
        issues.push(issue(
          'ACCESS_ACCOUNT_STATUS_INVALID',
          'lastAccessCheck.accountStatus'
        ));
      }
    }else{
      if(check.userId!==null){
        issues.push(issue(
          'UNAUTHENTICATED_ACCESS_HAS_USER',
          'lastAccessCheck.userId'
        ));
      }
      if(check.accountStatus!==null){
        issues.push(issue(
          'UNAUTHENTICATED_ACCESS_HAS_STATUS',
          'lastAccessCheck.accountStatus'
        ));
      }
    }
    if(typeof check.canCreateConferences!=='boolean'){
      issues.push(issue(
        'ACCESS_CREATE_PERMISSION_INVALID',
        'lastAccessCheck.canCreateConferences'
      ));
    }
    if(typeof check.isSystemOwner!=='boolean'){
      issues.push(issue(
        'ACCESS_OWNER_FLAG_INVALID',
        'lastAccessCheck.isSystemOwner'
      ));
    }
    if(!timestamp(check.checkedAt)){
      issues.push(issue(
        'ACCESS_CHECK_TIME_INVALID','lastAccessCheck.checkedAt'
      ));
    }
    return result(!issues.length,
      issues.length?'access_check_invalid':'access_check_valid',
      issues.length?null:clone(check),issues);
  }

  function expectedIntent(cloudLifecycle){
    if(cloudLifecycle==='unpublished')return 'none';
    if(cloudLifecycle==='local_only')return 'local_only';
    if(cloudLifecycle==='waiting_for_authorization'||
      cloudLifecycle==='ready_to_publish'||
      cloudLifecycle==='publishing'||
      cloudLifecycle==='publish_failed'){
      return 'publish_requested';
    }
    return null;
  }

  function validateMetadata(metadata,cloudLifecycle){
    var issues=[];
    if(!object(metadata)){
      return result(false,'metadata_invalid',null,[
        issue('PUBLISH_METADATA_INVALID','publishMetadata')
      ]);
    }
    var allowed=[
      'metadataVersion','publishIntent','requestedAt',
      'requestedByUserId','requestedByDeviceId','lastAccessCheck',
      'reviewRequired','reviewReason','confirmationAt','operationId',
      'requestedCloudId','attemptStartedAt','lastAttemptAt',
      'lastPublishStage','lastPublishError','snapshotContentVersion',
      'currentContentVersion','reconciliationState','retryCount',
      'retryAfter','lastReconciliationAt',
      'contentChangedBeforeInitialSnapshot'
    ];
    Object.keys(metadata).forEach(function(key){
      if(allowed.indexOf(key)<0){
        issues.push(issue(
          'PUBLISH_METADATA_FIELD_UNKNOWN','publishMetadata.'+key
        ));
      }
    });
    if(metadata.metadataVersion!==METADATA_VERSION){
      issues.push(issue(
        'PUBLISH_METADATA_VERSION_UNSUPPORTED',
        'publishMetadata.metadataVersion'
      ));
    }
    if(INTENTS.indexOf(metadata.publishIntent)<0){
      issues.push(issue(
        'PUBLISH_INTENT_INVALID','publishMetadata.publishIntent'
      ));
    }
    if(!nullableUuid(metadata.requestedByUserId)){
      issues.push(issue(
        'PUBLISH_REQUEST_USER_INVALID',
        'publishMetadata.requestedByUserId'
      ));
    }
    if(!nullableString(metadata.requestedByDeviceId)){
      issues.push(issue(
        'PUBLISH_REQUEST_DEVICE_INVALID',
        'publishMetadata.requestedByDeviceId'
      ));
    }
    if(metadata.requestedAt!==null&&!timestamp(metadata.requestedAt)){
      issues.push(issue(
        'PUBLISH_REQUEST_TIME_INVALID','publishMetadata.requestedAt'
      ));
    }
    if(typeof metadata.reviewRequired!=='boolean'){
      issues.push(issue(
        'PUBLISH_REVIEW_FLAG_INVALID',
        'publishMetadata.reviewRequired'
      ));
    }
    if(!nullableString(metadata.reviewReason)){
      issues.push(issue(
        'PUBLISH_REVIEW_REASON_INVALID',
        'publishMetadata.reviewReason'
      ));
    }
    if(metadata.reviewRequired&&metadata.reviewReason===null){
      issues.push(issue(
        'PUBLISH_REVIEW_REASON_REQUIRED',
        'publishMetadata.reviewReason'
      ));
    }
    if(!metadata.reviewRequired&&metadata.reviewReason!==null){
      issues.push(issue(
        'PUBLISH_REVIEW_REASON_UNEXPECTED',
        'publishMetadata.reviewReason'
      ));
    }
    if(metadata.lastAccessCheck!==null){
      var checked=validateAccessCheck(metadata.lastAccessCheck);
      checked.issues.forEach(function(item){issues.push(item);});
    }
    [
      'confirmationAt','attemptStartedAt','lastAttemptAt',
      'retryAfter','lastReconciliationAt'
    ]
      .forEach(function(key){
        if(metadata[key]!==null&&!timestamp(metadata[key])){
          issues.push(issue(
            'PUBLISH_TIMESTAMP_INVALID','publishMetadata.'+key
          ));
        }
      });
    ['operationId','requestedCloudId'].forEach(function(key){
      if(metadata[key]!==null&&!uuid(metadata[key])){
        issues.push(issue(
          'PUBLISH_IDENTIFIER_INVALID','publishMetadata.'+key
        ));
      }
    });
    ['snapshotContentVersion','currentContentVersion']
      .forEach(function(key){
        if(metadata[key]!==null&&
          (!Number.isInteger(metadata[key])||metadata[key]<0)){
          issues.push(issue(
            'PUBLISH_CONTENT_VERSION_INVALID',
            'publishMetadata.'+key
          ));
        }
      });
    if(metadata.lastPublishStage!==null&&
      !nullableString(metadata.lastPublishStage)){
      issues.push(issue(
        'PUBLISH_STAGE_INVALID','publishMetadata.lastPublishStage'
      ));
    }
    if(metadata.lastPublishError!==null&&
      (!object(metadata.lastPublishError)||
        typeof metadata.lastPublishError.code!=='string'||
        !metadata.lastPublishError.code.trim())){
      issues.push(issue(
        'PUBLISH_ERROR_INVALID','publishMetadata.lastPublishError'
      ));
    }
    if(metadata.reconciliationState!==null&&
      RECOVERY_STATES.indexOf(metadata.reconciliationState)<0){
      issues.push(issue(
        'PUBLISH_RECOVERY_STATE_INVALID',
        'publishMetadata.reconciliationState'
      ));
    }
    if(!Number.isInteger(metadata.retryCount)||metadata.retryCount<0){
      issues.push(issue(
        'PUBLISH_RETRY_COUNT_INVALID','publishMetadata.retryCount'
      ));
    }
    if(typeof metadata.contentChangedBeforeInitialSnapshot!=='boolean'){
      issues.push(issue(
        'PUBLISH_CONTENT_CHANGE_FLAG_INVALID',
        'publishMetadata.contentChangedBeforeInitialSnapshot'
      ));
    }
    var expected=expectedIntent(cloudLifecycle);
    if(expected===null||PHASE_STATES.indexOf(cloudLifecycle)<0){
      issues.push(issue(
        'PUBLISH_STATE_NOT_SUPPORTED_IN_PHASE_2_2','cloudLifecycle'
      ));
    }else if(metadata.publishIntent!==expected){
      issues.push(issue(
        'PUBLISH_INTENT_STATE_MISMATCH',
        'publishMetadata.publishIntent'
      ));
    }
    var requested=metadata.publishIntent==='publish_requested';
    if(requested&&metadata.requestedAt===null){
      issues.push(issue(
        'PUBLISH_REQUEST_TIME_REQUIRED','publishMetadata.requestedAt'
      ));
    }
    if(!requested&&(
      metadata.requestedAt!==null||
      metadata.requestedByUserId!==null||
      metadata.requestedByDeviceId!==null
    )){
      issues.push(issue(
        'PUBLISH_REQUEST_FIELDS_UNEXPECTED','publishMetadata'
      ));
    }
    if(cloudLifecycle==='ready_to_publish'){
      var access=metadata.lastAccessCheck;
      var accessValidation=access&&validateAccessCheck(access);
      if(!accessValidation||!accessValidation.ok||
        access.source!=='server'||access.fresh!==true||
        access.authenticated!==true||
        access.accountStatus!=='approved'||
        !(access.canCreateConferences||access.isSystemOwner)){
        issues.push(issue(
          'FRESH_SERVER_AUTHORIZATION_REQUIRED',
          'publishMetadata.lastAccessCheck'
        ));
      }
      if(metadata.requestedByUserId===null||
        !access||metadata.requestedByUserId!==access.userId){
        issues.push(issue(
          'PUBLISH_REQUEST_USER_MISMATCH',
          'publishMetadata.requestedByUserId'
        ));
      }
      if(metadata.reviewRequired){
        issues.push(issue(
          'PUBLISH_REVIEW_REQUIRED','publishMetadata.reviewRequired'
        ));
      }
    }
    if(cloudLifecycle==='publishing'||cloudLifecycle==='publish_failed'){
      [
        'confirmationAt','operationId','requestedCloudId',
        'attemptStartedAt','lastAttemptAt','lastPublishStage',
        'snapshotContentVersion','currentContentVersion'
      ].forEach(function(key){
        if(metadata[key]===null){
          issues.push(issue(
            'PUBLISH_ATTEMPT_FIELD_REQUIRED',
            'publishMetadata.'+key
          ));
        }
      });
      var attemptAccess=metadata.lastAccessCheck;
      if(!attemptAccess||attemptAccess.source!=='server'||
        attemptAccess.fresh!==true||
        attemptAccess.authenticated!==true||
        attemptAccess.accountStatus!=='approved'||
        !(attemptAccess.canCreateConferences||
          attemptAccess.isSystemOwner)||
        attemptAccess.userId!==metadata.requestedByUserId){
        issues.push(issue(
          'PUBLISH_ATTEMPT_AUTHORIZATION_INVALID',
          'publishMetadata.lastAccessCheck'
        ));
      }
      if(cloudLifecycle==='publish_failed'&&
        metadata.lastPublishError===null){
        issues.push(issue(
          'PUBLISH_FAILURE_ERROR_REQUIRED',
          'publishMetadata.lastPublishError'
        ));
      }
    }
    return result(!issues.length,
      issues.length?'metadata_invalid':'metadata_valid',
      issues.length?null:clone(metadata),issues);
  }

  function validateRecord(record){
    if(!object(record)){
      return result(false,'record_invalid',null,[
        issue('LIFECYCLE_RECORD_INVALID','record')
      ]);
    }
    var repository=global.ConferenceRepository;
    if(!repository||
      typeof repository.validateLifecycleRecord!=='function'){
      return result(false,'repository_unavailable',null,[
        issue('CONFERENCE_REPOSITORY_UNAVAILABLE','record')
      ]);
    }
    var base=clone(record);
    base.publishMetadata=null;
    var baseValidation=repository.validateLifecycleRecord(
      base,base.localConferenceId
    );
    if(!baseValidation.ok)return baseValidation;
    if(PHASE_STATES.indexOf(record.cloudLifecycle)<0){
      return result(false,'state_not_supported',null,[
        issue(
          'PUBLISH_STATE_NOT_SUPPORTED_IN_PHASE_2_2',
          'record.cloudLifecycle'
        )
      ]);
    }
    if(record.publishMetadata===null){
      return result(true,'legacy_record',clone(record),[]);
    }
    var metadataValidation=validateMetadata(
      record.publishMetadata,record.cloudLifecycle
    );
    if(!metadataValidation.ok)return metadataValidation;
    return result(true,'record_valid',clone(record),[]);
  }

  function accessCheck(input){
    var checked=validateAccessCheck(input);
    return checked.ok?checked.data:null;
  }

  function authorized(check){
    return check&&check.source==='server'&&check.fresh===true&&
      check.authenticated===true&&check.accountStatus==='approved'&&
      (check.canCreateConferences||check.isSystemOwner);
  }

  function normalizeMetadata(record){
    if(record.publishMetadata!==null)return clone(record.publishMetadata);
    var intent=expectedIntent(record.cloudLifecycle);
    return createMetadata({publishIntent:intent||'none'}).data;
  }

  function transitionLifecycleRecord(record,action,input){
    input=object(input)?input:{};
    var checked=validateRecord(record);
    if(!checked.ok)return checked;
    var next=clone(record);
    var metadata=normalizeMetadata(next);
    action=String(action||'');

    if(action==='keep_local'){
      if(next.cloudLifecycle!=='unpublished'){
        return result(false,'transition_not_allowed',null,[
          issue('PUBLISH_TRANSITION_NOT_ALLOWED','action')
        ]);
      }
      next.cloudLifecycle='local_only';
      next.publishMetadata=createMetadata({
        publishIntent:'local_only'
      }).data;
    }else if(action==='request_publish'){
      if(['unpublished','local_only'].indexOf(next.cloudLifecycle)<0||
        !timestamp(input.requestedAt)||
        !nullableUuid(input.requestedByUserId===undefined
          ?null:input.requestedByUserId)||
        !nullableString(input.requestedByDeviceId===undefined
          ?null:input.requestedByDeviceId)){
        return result(false,'transition_not_allowed',null,[
          issue('PUBLISH_REQUEST_INVALID','action')
        ]);
      }
      var observed=input.accessCheck===undefined
        ?null:accessCheck(input.accessCheck);
      if(input.accessCheck!==undefined&&!observed){
        return result(false,'access_check_invalid',null,[
          issue('ACCESS_CHECK_INVALID','input.accessCheck')
        ]);
      }
      next.cloudLifecycle='waiting_for_authorization';
      next.publishMetadata=createMetadata({
        publishIntent:'publish_requested',
        requestedAt:input.requestedAt,
        requestedByUserId:input.requestedByUserId===undefined
          ?null:input.requestedByUserId,
        requestedByDeviceId:input.requestedByDeviceId===undefined
          ?null:input.requestedByDeviceId,
        lastAccessCheck:observed
      }).data;
    }else if(action==='authorize'){
      if(next.cloudLifecycle!=='waiting_for_authorization'){
        return result(false,'transition_not_allowed',null,[
          issue('PUBLISH_TRANSITION_NOT_ALLOWED','action')
        ]);
      }
      var freshCheck=accessCheck(input.accessCheck);
      if(!freshCheck){
        return result(false,'access_check_invalid',null,[
          issue('ACCESS_CHECK_INVALID','input.accessCheck')
        ]);
      }
      metadata.lastAccessCheck=freshCheck;
      if(!authorized(freshCheck)){
        return result(false,
          freshCheck.source==='cache'
            ?'fresh_server_access_required'
            :freshCheck.accountStatus==='blocked'
              ?'account_blocked'
              :freshCheck.accountStatus==='pending'
                ?'account_pending'
                :'conference_creation_not_allowed',
          {record:next},[
            issue(
              'FRESH_SERVER_AUTHORIZATION_REQUIRED',
              'input.accessCheck'
            )
          ]);
      }
      if(metadata.requestedByUserId===null||
        metadata.requestedByUserId!==freshCheck.userId){
        metadata.reviewRequired=true;
        metadata.reviewReason='requesting_user_changed';
        next.publishMetadata=metadata;
        return result(false,'requesting_user_changed',{
          record:next
        },[
          issue(
            'PUBLISH_REQUEST_USER_MISMATCH',
            'input.accessCheck.userId'
          )
        ]);
      }
      metadata.reviewRequired=false;
      metadata.reviewReason=null;
      next.cloudLifecycle='ready_to_publish';
      next.publishMetadata=metadata;
    }else if(action==='invalidate_authorization'){
      if(next.cloudLifecycle!=='ready_to_publish'){
        return result(false,'transition_not_allowed',null,[
          issue('PUBLISH_TRANSITION_NOT_ALLOWED','action')
        ]);
      }
      var latest=input.accessCheck===undefined
        ?null:accessCheck(input.accessCheck);
      if(input.accessCheck!==undefined&&!latest){
        return result(false,'access_check_invalid',null,[
          issue('ACCESS_CHECK_INVALID','input.accessCheck')
        ]);
      }
      next.cloudLifecycle='waiting_for_authorization';
      metadata.lastAccessCheck=latest;
      metadata.reviewRequired=false;
      metadata.reviewReason=null;
      next.publishMetadata=metadata;
    }else if(action==='cancel_publish'){
      if(next.cloudLifecycle!=='waiting_for_authorization'||
        ['unpublished','local_only'].indexOf(input.returnTo)<0){
        return result(false,'transition_not_allowed',null,[
          issue('PUBLISH_TRANSITION_NOT_ALLOWED','action')
        ]);
      }
      next.cloudLifecycle=input.returnTo;
      next.publishMetadata=createMetadata({
        publishIntent:input.returnTo==='local_only'
          ?'local_only':'none'
      }).data;
    }else{
      return result(false,'action_unknown',null,[
        issue('PUBLISH_ACTION_UNKNOWN','action')
      ]);
    }

    var finalValidation=validateRecord(next);
    if(!finalValidation.ok){
      return result(false,'transition_result_invalid',null,
        finalValidation.issues);
    }
    return result(true,'transitioned',next,[]);
  }

  function transitionAppData(appData,localConferenceId,action,input){
    var repository=global.ConferenceRepository;
    if(!repository||
      typeof repository.validateRepositoryState!=='function'||
      !object(appData)||!Array.isArray(appData.conferences)){
      return result(false,'repository_unavailable',null,[
        issue('CONFERENCE_REPOSITORY_UNAVAILABLE','appData')
      ]);
    }
    var candidate;
    try{candidate=clone(appData);}
    catch(error){
      return result(false,'clone_failed',null,[
        issue('APP_DATA_CLONE_FAILED','appData')
      ]);
    }
    var ids=candidate.conferences.map(function(item){
      return item&&item.id;
    });
    var repositoryValidation=repository.validateRepositoryState(
      candidate.conferenceLifecycle,ids
    );
    if(!repositoryValidation.ok)return repositoryValidation;
    var record=candidate.conferenceLifecycle.records[localConferenceId];
    if(!record){
      return result(false,'conference_not_found',null,[]);
    }
    var transitioned=transitionLifecycleRecord(record,action,input);
    if(!transitioned.ok)return transitioned;
    candidate.conferenceLifecycle.records[localConferenceId]=
      transitioned.data;
    return result(true,'app_data_transitioned',candidate,[]);
  }

  function getContract(){
    return {
      metadataVersion:METADATA_VERSION,
      publishIntents:INTENTS.slice(),
      phaseStates:PHASE_STATES.slice(),
      accessSources:ACCESS_SOURCES.slice(),
      recoveryStates:RECOVERY_STATES.slice()
    };
  }

  function publishConference(appData,localConferenceId,confirmation,options){
    var engine=global.ConferencePublishingEngine;
    if(!engine||typeof engine.publishConference!=='function'){
      return Promise.resolve(result(
        false,'publishing_engine_unavailable',null,[
          issue('PUBLISHING_ENGINE_UNAVAILABLE','engine')
        ]
      ));
    }
    return engine.publishConference(
      appData,localConferenceId,confirmation,options
    );
  }

  function scanRecoveryCandidates(appData,options){
    var recovery=global.ConferencePublishRecovery;
    if(!recovery||typeof recovery.scanCandidates!=='function'){
      return result(false,'publish_recovery_unavailable');
    }
    return recovery.scanCandidates(appData,options);
  }

  function reconcileConference(appData,localConferenceId,options){
    var recovery=global.ConferencePublishRecovery;
    if(!recovery||typeof recovery.reconcileConference!=='function'){
      return Promise.resolve(result(
        false,'publish_recovery_unavailable'
      ));
    }
    return recovery.reconcileConference(
      appData,localConferenceId,options
    );
  }

  global.ConferencePublishManager=Object.freeze({
    getContract:getContract,
    createMetadata:createMetadata,
    validateAccessCheck:validateAccessCheck,
    validateMetadata:validateMetadata,
    transitionLifecycleRecord:transitionLifecycleRecord,
    transitionAppData:transitionAppData,
    publishConference:publishConference,
    scanRecoveryCandidates:scanRecoveryCandidates,
    reconcileConference:reconcileConference
  });
})(window);
