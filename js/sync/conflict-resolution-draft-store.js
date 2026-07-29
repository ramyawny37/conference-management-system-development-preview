(function(global){
  'use strict';
  var STORE='conflict_resolution_drafts';
  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function repository(options){
    return options&&options.indexedDb||global.AppIndexedDB;
  }
  function normalizeFinalization(record){
    record.finalization=record.finalization&&
      typeof record.finalization==='object'
      ?record.finalization
      :{};
    [
      'pendingApplicationStored',
      'revisionPublished',
      'linkMetadataUpdated',
      'queueUpdated',
      'draftCompleted'
    ].forEach(function(flag){
      if(record.finalization[flag]!==true){
        record.finalization[flag]=false;
      }
    });
    return record;
  }
  function save(localConferenceId,plan,options){
    if(!localConferenceId||!plan||!plan.resolutionOperationId){
      return Promise.resolve({ok:false,status:'invalid'});
    }
    return get(localConferenceId,options).then(function(existing){
      if(existing.ok&&existing.data.resolutionOperationId===
        String(plan.resolutionOperationId)&&
        ['executed','finalizing','completed'].indexOf(
          existing.data.executionStatus
        )>=0){
        return {ok:true,status:'preserved',data:existing.data};
      }
      var now=new Date().toISOString();
      var record={
        localConferenceId:String(localConferenceId),
        conflictId:String(plan.conflictId||''),
        resolutionOperationId:String(plan.resolutionOperationId),
        plan:copy(plan),
        status:'pending',
        executionStatus:'pending',
        executionResult:null,
        resolvedRevision:null,
        finalization:{
          pendingApplicationStored:false,
          revisionPublished:false,
          linkMetadataUpdated:false,
          queueUpdated:false,
          draftCompleted:false
        },
        createdAt:now,
        updatedAt:now,
        completedAt:null
      };
      return repository(options).putRecord(STORE,record).then(function(){
        return {ok:true,status:'saved',data:copy(record)};
      });
    }).catch(function(){return {ok:false,status:'storage_failed'};});
  }
  function get(localConferenceId,options){
    return repository(options).getRecord(STORE,String(localConferenceId||''))
      .then(function(record){
        return record?{ok:true,status:record.status,
          data:copy(normalizeFinalization(record))}:
          {ok:false,status:'not_found'};
      }).catch(function(){return {ok:false,status:'read_failed'};});
  }
  function markCompleted(localConferenceId,options){
    return get(localConferenceId,options).then(function(result){
      if(!result.ok)return result;
      result.data.status='completed';
      result.data.executionStatus='completed';
      result.data.finalization.draftCompleted=true;
      result.data.updatedAt=new Date().toISOString();
      result.data.completedAt=result.data.updatedAt;
      return repository(options).putRecord(STORE,result.data).then(function(){
        return {ok:true,status:'completed'};
      });
    }).catch(function(){return {ok:false,status:'storage_failed'};});
  }
  function saveExecutionResult(localConferenceId,executionResult,options){
    return get(localConferenceId,options).then(function(result){
      if(!result.ok)return result;
      var record=result.data;
      if(record.executionStatus==='completed'){
        return {ok:true,status:'completed',data:record};
      }
      record.executionResult=copy(executionResult);
      record.resolvedRevision=executionResult&&executionResult.data&&
        Number.isInteger(executionResult.data.resolvedRevision)
        ?executionResult.data.resolvedRevision:null;
      record.executionStatus='executed';
      record.status='executed';
      record.updatedAt=new Date().toISOString();
      return repository(options).putRecord(STORE,record).then(function(){
        return {ok:true,status:'executed',data:copy(record)};
      });
    }).catch(function(){return {ok:false,status:'storage_failed'};});
  }
  function updateFinalization(localConferenceId,patch,options){
    return get(localConferenceId,options).then(function(result){
      if(!result.ok)return result;
      var record=result.data;
      if(['executed','finalizing'].indexOf(record.executionStatus)<0){
        return {ok:false,status:'invalid_execution_state'};
      }
      Object.keys(patch||{}).forEach(function(key){
        if(Object.prototype.hasOwnProperty.call(record.finalization,key)){
          record.finalization[key]=patch[key]===true;
        }
      });
      record.executionStatus='finalizing';
      record.status='finalizing';
      record.updatedAt=new Date().toISOString();
      return repository(options).putRecord(STORE,record).then(function(){
        return {ok:true,status:'finalizing',data:copy(record)};
      });
    }).catch(function(){return {ok:false,status:'storage_failed'};});
  }
  function markStale(localConferenceId,executionResult,options){
    return get(localConferenceId,options).then(function(result){
      if(!result.ok)return result;
      result.data.status='stale';
      result.data.executionStatus='stale';
      result.data.executionResult=copy(executionResult);
      result.data.updatedAt=new Date().toISOString();
      return repository(options).putRecord(STORE,result.data).then(function(){
        return {ok:true,status:'stale',data:copy(result.data)};
      });
    }).catch(function(){return {ok:false,status:'storage_failed'};});
  }
  global.ConflictResolutionDraftStore=Object.freeze({
    save:save,get:get,markCompleted:markCompleted,
    saveExecutionResult:saveExecutionResult,
    updateFinalization:updateFinalization,
    markStale:markStale
  });
})(window);
