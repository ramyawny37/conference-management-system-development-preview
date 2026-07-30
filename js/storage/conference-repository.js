(function(global){
  'use strict';

  var SCHEMA_VERSION=1;
  var LOCAL_LIFECYCLES=Object.freeze(['active','archived']);
  var CLOUD_LIFECYCLES=Object.freeze([
    'unpublished',
    'local_only',
    'waiting_for_authorization',
    'ready_to_publish',
    'publishing',
    'cloud_linked',
    'publish_failed',
    'sync_suspended'
  ]);

  function outcome(ok,status,data,issues){
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

  function plainObject(value){
    return !!value&&typeof value==='object'&&!Array.isArray(value);
  }

  function clone(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function validId(value){
    return typeof value==='string'&&value.trim()===value&&value.length>0;
  }

  function validInteger(value){
    return Number.isInteger(value)&&value>=0;
  }

  function validateLifecycleRecord(record,expectedId){
    var issues=[];
    if(!plainObject(record)){
      return outcome(false,'invalid_record',null,[
        issue('LIFECYCLE_RECORD_INVALID','record')
      ]);
    }
    if(!validId(record.localConferenceId)){
      issues.push(issue(
        'LOCAL_CONFERENCE_ID_INVALID','record.localConferenceId'
      ));
    }else if(expectedId&&record.localConferenceId!==expectedId){
      issues.push(issue(
        'LOCAL_CONFERENCE_ID_MISMATCH','record.localConferenceId'
      ));
    }
    if(LOCAL_LIFECYCLES.indexOf(record.localLifecycle)<0){
      issues.push(issue(
        'LOCAL_LIFECYCLE_INVALID','record.localLifecycle'
      ));
    }
    if(CLOUD_LIFECYCLES.indexOf(record.cloudLifecycle)<0){
      issues.push(issue(
        'CLOUD_LIFECYCLE_INVALID','record.cloudLifecycle'
      ));
    }
    if(!validInteger(record.localContentVersion)){
      issues.push(issue(
        'LOCAL_CONTENT_VERSION_INVALID','record.localContentVersion'
      ));
    }
    if(record.publishMetadata!==null){
      var publishManager=global.ConferencePublishManager;
      var publishValidation=publishManager&&
        typeof publishManager.validateMetadata==='function'
        ?publishManager.validateMetadata(
          record.publishMetadata,record.cloudLifecycle
        ):null;
      if(!publishValidation||!publishValidation.ok){
        if(publishValidation&&Array.isArray(publishValidation.issues)){
          publishValidation.issues.forEach(function(item){
            issues.push(issue(
              item.code,
              'record.publishMetadata.'+
                String(item.path||'').replace(/^publishMetadata\.?/,'')
            ));
          });
        }else{
          issues.push(issue(
            'PUBLISH_METADATA_NOT_SUPPORTED_IN_PHASE_2_1',
            'record.publishMetadata'
          ));
        }
      }
    }
    var allowed=[
      'localConferenceId',
      'localLifecycle',
      'cloudLifecycle',
      'localContentVersion',
      'publishMetadata'
    ];
    Object.keys(record).forEach(function(key){
      if(allowed.indexOf(key)<0){
        issues.push(issue(
          'LIFECYCLE_FIELD_UNKNOWN','record.'+key
        ));
      }
    });
    return outcome(!issues.length,
      issues.length?'invalid_record':'valid_record',
      issues.length?null:clone(record),issues);
  }

  function createLifecycleRecord(input){
    input=plainObject(input)?input:{};
    var record={
      localConferenceId:String(input.localConferenceId||''),
      localLifecycle:input.localLifecycle||'active',
      cloudLifecycle:input.cloudLifecycle||'unpublished',
      localContentVersion:
        input.localContentVersion===undefined
          ?0:input.localContentVersion,
      publishMetadata:null
    };
    return validateLifecycleRecord(record,record.localConferenceId);
  }

  function validateRepositoryState(repositoryState,conferenceIds){
    var issues=[];
    if(!plainObject(repositoryState)){
      return outcome(false,'invalid_repository',null,[
        issue('CONFERENCE_REPOSITORY_INVALID','conferenceLifecycle')
      ]);
    }
    if(repositoryState.schemaVersion!==SCHEMA_VERSION){
      issues.push(issue(
        'CONFERENCE_REPOSITORY_VERSION_UNSUPPORTED',
        'conferenceLifecycle.schemaVersion'
      ));
    }
    if(!plainObject(repositoryState.records)){
      issues.push(issue(
        'CONFERENCE_LIFECYCLE_RECORDS_INVALID',
        'conferenceLifecycle.records'
      ));
      return outcome(false,'invalid_repository',null,issues);
    }
    var expected=Object.create(null);
    (conferenceIds||[]).forEach(function(id){expected[id]=true;});
    Object.keys(repositoryState.records).forEach(function(id){
      if(!validId(id)){
        issues.push(issue(
          'CONFERENCE_LIFECYCLE_KEY_INVALID',
          'conferenceLifecycle.records'
        ));
        return;
      }
      var checked=validateLifecycleRecord(
        repositoryState.records[id],id
      );
      checked.issues.forEach(function(item){
        issues.push(issue(item.code,
          'conferenceLifecycle.records.'+id+'.'+
          item.path.replace(/^record\.?/,'')
        ));
      });
      if(conferenceIds&&!expected[id]){
        issues.push(issue(
          'ORPHAN_LIFECYCLE_RECORD',
          'conferenceLifecycle.records.'+id
        ));
      }
    });
    (conferenceIds||[]).forEach(function(id){
      if(!Object.prototype.hasOwnProperty.call(
        repositoryState.records,id
      )){
        issues.push(issue(
          'LIFECYCLE_CLASSIFICATION_REQUIRED',
          'conferenceLifecycle.records.'+id
        ));
      }
    });
    return outcome(!issues.length,
      issues.length?'invalid_repository':'valid_repository',
      issues.length?null:clone(repositoryState),issues);
  }

  function conferenceIds(appData){
    var issues=[];
    if(!plainObject(appData)||!Array.isArray(appData.conferences)){
      return outcome(false,'invalid_app_data',null,[
        issue('APP_DATA_CONFERENCES_INVALID','conferences')
      ]);
    }
    var ids=[];
    var seen=Object.create(null);
    appData.conferences.forEach(function(conference,index){
      var id=conference&&conference.id;
      if(!validId(id)){
        issues.push(issue(
          'CONFERENCE_ID_INVALID','conferences.'+index+'.id'
        ));
        return;
      }
      if(seen[id]){
        issues.push(issue(
          'CONFERENCE_ID_DUPLICATE','conferences.'+index+'.id'
        ));
        return;
      }
      seen[id]=true;
      ids.push(id);
    });
    return outcome(!issues.length,
      issues.length?'invalid_app_data':'conference_ids_ready',
      issues.length?null:ids,issues);
  }

  function prepareAppData(appData,options){
    options=plainObject(options)?options:{};
    var idsResult=conferenceIds(appData);
    if(!idsResult.ok)return idsResult;
    var candidate;
    try{candidate=clone(appData);}
    catch(error){
      return outcome(false,'clone_failed',null,[
        issue('APP_DATA_CLONE_FAILED','appData')
      ]);
    }
    var existing=candidate.conferenceLifecycle;
    if(existing!==undefined){
      var existingValidation=validateRepositoryState(
        existing,idsResult.data
      );
      if(existingValidation.ok){
        return outcome(true,'already_prepared',candidate,[]);
      }
      return existingValidation;
    }
    if(idsResult.data.length&&
      typeof options.classifyConference!=='function'){
      return outcome(false,'classification_required',null,
        idsResult.data.map(function(id){
          return issue(
            'LIFECYCLE_CLASSIFICATION_REQUIRED',
            'conferenceLifecycle.records.'+id
          );
        })
      );
    }
    var records={};
    for(var index=0;index<idsResult.data.length;index++){
      var id=idsResult.data[index];
      var conference=candidate.conferences[index];
      var classification;
      try{
        classification=options.classifyConference(
          clone(conference),id
        );
      }catch(error){
        return outcome(false,'classification_failed',null,[
          issue(
            'LIFECYCLE_CLASSIFICATION_FAILED',
            'conferenceLifecycle.records.'+id
          )
        ]);
      }
      var created=createLifecycleRecord(Object.assign(
        {},classification||{},{localConferenceId:id}
      ));
      if(!created.ok){
        return outcome(false,'classification_invalid',null,
          created.issues.map(function(item){
            return issue(item.code,
              'conferenceLifecycle.records.'+id+'.'+
              item.path.replace(/^record\.?/,'')
            );
          })
        );
      }
      records[id]=created.data;
    }
    candidate.conferenceLifecycle={
      schemaVersion:SCHEMA_VERSION,
      records:records
    };
    return outcome(true,'prepared',candidate,[]);
  }

  function getLifecycle(appData,localConferenceId){
    if(!validId(localConferenceId)){
      return outcome(false,'invalid_input',null,[
        issue('LOCAL_CONFERENCE_ID_INVALID','localConferenceId')
      ]);
    }
    var idsResult=conferenceIds(appData);
    if(!idsResult.ok)return idsResult;
    if(idsResult.data.indexOf(localConferenceId)<0){
      return outcome(false,'conference_not_found',null,[]);
    }
    var state=appData.conferenceLifecycle;
    var checked=validateRepositoryState(state,idsResult.data);
    if(!checked.ok)return checked;
    return outcome(true,'found',
      clone(state.records[localConferenceId]),[]);
  }

  function recordLocalChange(appData,localConferenceId){
    var found=getLifecycle(appData,localConferenceId);
    if(!found.ok)return found;
    var candidate;
    try{candidate=clone(appData);}
    catch(error){
      return outcome(false,'clone_failed',null,[
        issue('APP_DATA_CLONE_FAILED','appData')
      ]);
    }
    candidate.conferenceLifecycle.records[localConferenceId]
      .localContentVersion++;
    return outcome(true,'local_change_recorded',candidate,[]);
  }

  function addLocalConference(appData,conference){
    if(!plainObject(appData)||!Array.isArray(appData.conferences)||
      !plainObject(conference)||!validId(conference.id)){
      return outcome(false,'invalid_input',null,[
        issue('LOCAL_CONFERENCE_INVALID','conference')
      ]);
    }
    if(appData.conferences.some(function(item){
      return item&&item.id===conference.id;
    })){
      return outcome(false,'conference_id_duplicate',null,[
        issue('CONFERENCE_ID_DUPLICATE','conference.id')
      ]);
    }
    var candidate;
    try{candidate=clone(appData);}
    catch(error){
      return outcome(false,'clone_failed',null,[
        issue('APP_DATA_CLONE_FAILED','appData')
      ]);
    }
    if(!candidate.conferenceLifecycle){
      var prepared=prepareAppData(candidate,{
        classifyConference:function(){
          return {
            localLifecycle:'active',
            cloudLifecycle:'local_only',
            localContentVersion:0
          };
        }
      });
      if(!prepared.ok){
        return outcome(false,'legacy_compatibility_failed',null,
          prepared.issues);
      }
      candidate=prepared.data;
    }
    var currentValidation=validateRepositoryState(
      candidate.conferenceLifecycle,
      candidate.conferences.map(function(item){return item.id;})
    );
    if(!currentValidation.ok)return currentValidation;
    var created=createLifecycleRecord({
      localConferenceId:conference.id,
      localLifecycle:'active',
      cloudLifecycle:'unpublished',
      localContentVersion:0
    });
    if(!created.ok)return created;
    candidate.conferences.push(clone(conference));
    candidate.conferenceLifecycle.records[conference.id]=created.data;
    return outcome(true,
      appData.conferenceLifecycle
        ?'local_conference_added'
        :'local_conference_added_with_legacy_compatibility',
      candidate,[]);
  }

  function getContract(){
    return {
      schemaVersion:SCHEMA_VERSION,
      localLifecycles:LOCAL_LIFECYCLES.slice(),
      cloudLifecycles:CLOUD_LIFECYCLES.slice(),
      repositoryProperty:'conferenceLifecycle',
      publishMetadataPhase:'2.2'
    };
  }

  global.ConferenceRepository=Object.freeze({
    getContract:getContract,
    createLifecycleRecord:createLifecycleRecord,
    validateLifecycleRecord:validateLifecycleRecord,
    validateRepositoryState:validateRepositoryState,
    prepareAppData:prepareAppData,
    getLifecycle:getLifecycle,
    recordLocalChange:recordLocalChange,
    addLocalConference:addLocalConference
  });
})(window);
