(function(global){
  'use strict';
  var KEY='conference_manager_sync_links';
  var STATUSES=[
    'linked','upload_pending','needs_resolution','unsynced','disconnected',
    'server_selected_pending_local_apply'
  ];
  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function target(options){
    if(options&&options.storage)return options.storage;
    try{return global.localStorage||null;}catch(error){return null;}
  }
  function all(options){
    var storage=target(options);
    try{
      var value=storage&&JSON.parse(storage.getItem(KEY)||'{}');
      return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    }catch(error){return {};}
  }
  function write(value,options){
    var storage=target(options);
    try{storage.setItem(KEY,JSON.stringify(value));return true;}
    catch(error){return false;}
  }
  function isUuid(value){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value||''));
  }
  function get(localId,options){
    var value=all(options)[String(localId||'')];
    return value?copy(value):null;
  }
  function list(options){
    var links=all(options);
    return Object.keys(links).sort().map(function(localId){
      return copy(links[localId]);
    });
  }
  function findByRemoteId(remoteId,options){
    remoteId=String(remoteId||'');
    var links=all(options);
    var localIds=Object.keys(links);
    for(var index=0;index<localIds.length;index++){
      var link=links[localIds[index]];
      if(link&&String(link.remoteConferenceId||'')===remoteId){
        return copy(link);
      }
    }
    return null;
  }
  function save(input,options){
    input=input&&typeof input==='object'?input:{};
    var localId=String(input.localConferenceId||'');
    var remoteId=String(input.remoteConferenceId||'');
    if(!localId||!isUuid(remoteId)||STATUSES.indexOf(input.linkStatus)<0||
      !Number.isInteger(input.knownRevision)||input.knownRevision<0){
      return {ok:false,status:'invalid'};
    }
    var links=all(options);
    var previousLinks=copy(links);
    var previous=links[localId]||{};
    var now=new Date().toISOString();
    links[localId]={
      localConferenceId:localId,
      remoteConferenceId:remoteId,
      remoteName:String(input.remoteName||previous.remoteName||''),
      knownRevision:input.knownRevision,
      actualRevision:Number.isInteger(input.actualRevision)?input.actualRevision:null,
      linkStatus:input.linkStatus,
      initialOperationId:String(
        input.initialOperationId||previous.initialOperationId||''
      )||null,
      conflictId:String(input.conflictId||previous.conflictId||'')||null,
      conflictStatus:String(input.conflictStatus||previous.conflictStatus||'')||null,
      resolutionStrategy:String(
        input.resolutionStrategy||previous.resolutionStrategy||''
      )||null,
      resolutionOperationId:String(
        input.resolutionOperationId||previous.resolutionOperationId||''
      )||null,
      resolvedRevision:Number.isInteger(input.resolvedRevision)
        ?input.resolvedRevision
        :previous.resolvedRevision||null,
      pendingLocalApplication:input.pendingLocalApplication===true,
      lastConflictAt:input.lastConflictAt||previous.lastConflictAt||null,
      lastResolvedAt:input.lastResolvedAt||previous.lastResolvedAt||null,
      createdAt:previous.createdAt||now,
      updatedAt:now
    };
    if(!write(links,options))return {ok:false,status:'storage_error'};
    if(global.FullBackupService&&
      typeof global.FullBackupService.clearManualRelinkRequirement==='function'){
      var cleared=global.FullBackupService.clearManualRelinkRequirement(
        localId,
        {storage:target(options)}
      );
      if(!cleared||!cleared.ok){
        var rolledBack=write(previousLinks,options);
        var service=global.FullBackupService;
        var manualRelinkRequired=service&&
          typeof service.isManualRelinkRequired==='function'&&
          service.isManualRelinkRequired(localId,{
            storage:target(options)
          });
        if(!manualRelinkRequired&&service&&
          typeof service.getManualRelinkConferenceIds==='function'&&
          typeof service.setManualRelinkConferenceIds==='function'){
          var ids=service.getManualRelinkConferenceIds({
            storage:target(options)
          });
          service.setManualRelinkConferenceIds(
            ids.concat([localId]),
            {storage:target(options)}
          );
          manualRelinkRequired=service.isManualRelinkRequired(
            localId,
            {storage:target(options)}
          );
        }
        var actualLink=get(localId,options);
        return {
          ok:false,
          status:rolledBack?'storage_error':'rollback_failed',
          linkState:actualLink,
          manualRelinkRequired:manualRelinkRequired===true,
          isolationPreserved:manualRelinkRequired===true,
          rollbackError:rolledBack?null:'SYNC_LINK_ROLLBACK_FAILED',
          rollback:{
            attempted:true,
            success:rolledBack
          }
        };
      }
    }
    return {ok:true,status:'saved',data:copy(links[localId])};
  }
  function remove(localId,options){
    var links=all(options);
    delete links[String(localId||'')];
    return write(links,options)
      ?{ok:true,status:'removed'}
      :{ok:false,status:'storage_error'};
  }
  global.ConferenceLinkStore=Object.freeze({
    statuses:Object.freeze(STATUSES.slice()),
    get:get,list:list,findByRemoteId:findByRemoteId,save:save,remove:remove
  });
})(window);
