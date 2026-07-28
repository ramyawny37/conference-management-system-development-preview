(function(global){
  'use strict';
  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function apply(input,options){
    input=input||{};options=options||{};
    var repository=options.repository||global.StorageRepository;
    var backups=options.backups||global.ConflictBackupStore;
    var pendingStore=options.pendingStore||global.PendingRemoteApplicationStore;
    var source=options.appData||global.appData;
    var record=input.record;
    var link=input.link;
    if(!source||!Array.isArray(source.conferences)||
      !record||!link||record.status!=='pending'||
      record.resolutionStrategy!=='keep_server'||
      String(record.resolvedSnapshot&&record.resolvedSnapshot.id||'')!==
        String(record.localConferenceId)||
      record.localConferenceId!==link.localConferenceId||
      record.remoteConferenceId!==link.remoteConferenceId||
      record.conflictId!==link.conflictId||
      record.resolutionOperationId!==link.resolutionOperationId||
      record.resolvedRevision!==link.resolvedRevision||
      link.pendingLocalApplication!==true){
      return Promise.resolve({ok:false,status:'invalid'});
    }
    var index=source.conferences.findIndex(function(item){
      return String(item.id)===String(record.localConferenceId);
    });
    if(index<0)return Promise.resolve({ok:false,status:'conference_not_found'});
    var next=copy(source), previous=copy(source.conferences[index]);
    return pendingStore.verify(record).then(function(valid){
      if(!valid)return {ok:false,status:'digest_mismatch'};
      return pendingStore.buildDigest(previous).then(function(currentDigest){
        if(currentDigest===record.snapshotDigest){
          return {ok:true,status:'already_applied',data:{backup:null}};
        }
        next.conferences[index]=copy(record.resolvedSnapshot);
        return backups.create({
          localConferenceId:record.localConferenceId,
          snapshot:previous,
          conflictId:record.conflictId,
          resolvedRevision:record.resolvedRevision
        },options).then(function(backup){
          if(!backup.ok)return {ok:false,status:'backup_failed'};
          return repository.saveAppSnapshot(next,{
            source:'remote_resolution',
            skipSyncQueue:true
          }).then(function(){
            if(typeof options.applyMemory==='function'){
              options.applyMemory(copy(next));
            }else global.appData=copy(next);
            if(typeof options.render==='function')options.render();
            return {ok:true,status:'applied',data:{backup:backup.data}};
          }).catch(function(){return {ok:false,status:'save_failed'};});
        });
      });
    }).catch(function(){return {ok:false,status:'validation_failed'};});
  }
  global.LocalSnapshotApplication=Object.freeze({apply:apply});
})(window);
