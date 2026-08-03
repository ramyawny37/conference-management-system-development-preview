(function(global){
  'use strict';

  function result(status,data){
    return {ok:true,status:status,data:data||null,error:null};
  }

  function dependencies(options){
    options=options||{};
    return {
      links:options.links||global.ConferenceLinkStore,
      drafts:options.drafts||global.ConflictResolutionDraftStore,
      pending:options.pending||global.PendingRemoteApplicationStore
    };
  }

  function activeConflict(link){
    return !!(link&&(
      link.linkStatus==='needs_resolution'||
      link.conflictStatus==='active'||
      link.conflictStatus==='pending'||
      link.conflictStatus==='reviewed'||
      link.conflictStatus==='changed'
    ));
  }

  function resolve(input,options){
    input=input||{};
    var localConferenceId=String(input.localConferenceId||'');
    var d=dependencies(options);
    var applicationData=options&&options.appData||global.appData;
    if(global.isConferenceImportRecoveryPending&&
      global.isConferenceImportRecoveryPending(
        applicationData,localConferenceId
      )){
      return Promise.resolve(result('pending_local_application',{
        localConferenceId:localConferenceId
      }));
    }
    if(!localConferenceId||!d.links||
      typeof d.links.get!=='function'){
      return Promise.resolve(result('local_only',{
        localConferenceId:localConferenceId||null
      }));
    }
    var link=d.links.get(localConferenceId,options&&options.linkOptions);
    if(!link){
      return Promise.resolve(result('local_only',{
        localConferenceId:localConferenceId
      }));
    }
    var draftRead=d.drafts&&typeof d.drafts.get==='function'
      ?d.drafts.get(localConferenceId,options&&options.draftOptions)
      :Promise.resolve({ok:false,status:'unavailable'});
    var pendingRead=d.pending&&typeof d.pending.get==='function'
      ?d.pending.get(localConferenceId,options&&options.pendingOptions)
      :Promise.resolve({ok:false,status:'unavailable'});
    return Promise.all([
      Promise.resolve(draftRead).catch(function(){
        return {ok:false,status:'read_failed'};
      }),
      Promise.resolve(pendingRead).catch(function(){
        return {ok:false,status:'read_failed'};
      })
    ]).then(function(reads){
      if(reads[0]&&reads[0].status==='read_failed'||
        reads[1]&&reads[1].status==='read_failed'){
        return result('error',{
          localConferenceId:localConferenceId,
          remoteConferenceId:link.remoteConferenceId||null,
          link:link,
          draft:null,
          pending:null
        });
      }
      var draft=reads[0]&&reads[0].ok?reads[0].data:null;
      var pending=reads[1]&&reads[1].ok?reads[1].data:null;
      var data={
        localConferenceId:localConferenceId,
        remoteConferenceId:link.remoteConferenceId||null,
        link:link,
        draft:draft,
        pending:pending
      };
      var resumableDraft=draft&&draft.executionResult&&
        draft.executionResult.ok===true&&
        ['resolved','server_selected','duplicate'].indexOf(
          draft.executionResult.status
        )>=0&&
        ['executed','finalizing'].indexOf(
        draft.executionStatus
        )>=0;
      if(resumableDraft){
        return result('finalizing_conflict',data);
      }
      if(activeConflict(link))return result('needs_resolution',data);
      if(link.pendingLocalApplication===true||
        link.linkStatus==='server_selected_pending_local_apply'||
        pending&&pending.status==='pending'){
        return result('pending_local_application',data);
      }
      if(link.linkStatus==='linked'||
        link.linkStatus==='cloud_linked'){
        return result('linked',data);
      }
      return result('local_only',data);
    });
  }

  global.ConferenceSyncStateResolver=Object.freeze({
    resolve:resolve
  });
})(window);
