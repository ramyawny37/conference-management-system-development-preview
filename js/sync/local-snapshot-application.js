(function(global){
  'use strict';

  var flights=Object.create(null);

  function copy(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function result(ok,status,data){
    return {
      ok:ok,
      status:status,
      data:data||null,
      error:ok?null:{code:status,message:'Remote snapshot application failed.'}
    };
  }

  function dependencies(options){
    options=options||{};
    return {
      repository:options.repository||global.StorageRepository,
      backups:options.backups||global.ConflictBackupStore,
      pending:options.pendingStore||global.PendingRemoteApplicationStore,
      links:options.links||global.ConferenceLinkStore
    };
  }

  function applicationData(options){
    return options&&options.appData||global.appData;
  }

  function validateRecord(record,link,localConferenceId){
    return !!(
      record&&link&&
      record.status==='pending'&&
      record.resolutionStrategy==='keep_server'&&
      record.localConferenceId===String(localConferenceId)&&
      record.remoteConferenceId===link.remoteConferenceId&&
      record.conflictId===link.conflictId&&
      record.resolutionOperationId===link.resolutionOperationId&&
      record.resolvedRevision===link.resolvedRevision&&
      record.snapshotDigest&&
      record.resolvedSnapshot&&
      typeof record.resolvedSnapshot==='object'&&
      !Array.isArray(record.resolvedSnapshot)&&
      String(record.resolvedSnapshot.id||'')===
        String(localConferenceId)
    );
  }

  function linkPending(link){
    return !!(link&&
      link.linkStatus==='server_selected_pending_local_apply'&&
      link.pendingLocalApplication===true);
  }

  function linkFinalized(link){
    return !!(link&&link.linkStatus==='linked'&&
      link.pendingLocalApplication===false);
  }

  function saveFlag(d,localConferenceId,record,flag){
    var patch={};
    patch[flag]=true;
    return d.pending.updateApplicationState(localConferenceId,{
      resolutionOperationId:record.resolutionOperationId,
      patch:patch
    }).then(function(updated){
      if(!updated||!updated.ok){
        throw new Error('APPLICATION_FLAG_SAVE_FAILED');
      }
      return updated.data;
    });
  }

  function run(localConferenceId,options){
    var d=dependencies(options);
    if(!d.pending||typeof d.pending.get!=='function'||
      typeof d.pending.verify!=='function'||
      typeof d.pending.updateApplicationState!=='function'||
      !d.links||typeof d.links.get!=='function'){
      return Promise.resolve(result(false,'dependencies_unavailable'));
    }
    return d.pending.get(
      localConferenceId,
      options.pendingOptions
    ).then(function(read){
      if(!read||!read.ok||!read.data){
        return result(false,'pending_not_found');
      }
      var record=read.data;
      if(record.status==='applied'&&
        record.applicationState&&
        record.applicationState.pendingCompleted){
        return result(true,'already_applied',{record:copy(record)});
      }
      var link=d.links.get(localConferenceId,options.linkOptions);
      if(!validateRecord(record,link,localConferenceId)||
        (!linkPending(link)&&
        !(record.applicationState&&
          record.applicationState.localSnapshotSaved&&
          linkFinalized(link)))){
        return result(false,'pending_mismatch');
      }
      var state=record.applicationState||{};
      var sequence=Promise.resolve();

      sequence=sequence.then(function(){
        return d.pending.verify(record);
      }).then(function(valid){
        if(!valid)throw new Error('SNAPSHOT_DIGEST_MISMATCH');
        if(!state.validationCompleted){
          return saveFlag(
            d,localConferenceId,record,'validationCompleted'
          );
        }
        return record;
      }).then(function(updated){
        if(!state.validationCompleted){
          record=updated;
          state=record.applicationState;
        }
      }).then(function(){
        if(state.backupStored)return null;
        var source=applicationData(options);
        if(!source||!Array.isArray(source.conferences)){
          throw new Error('APP_DATA_UNAVAILABLE');
        }
        var current=source.conferences.find(function(item){
          return item&&String(item.id)===String(localConferenceId);
        });
        if(!current)throw new Error('CONFERENCE_NOT_FOUND');
        return d.backups.create({
          localConferenceId:localConferenceId,
          snapshot:copy(current),
          conflictId:record.conflictId,
          resolutionOperationId:record.resolutionOperationId,
          resolvedRevision:record.resolvedRevision
        },options.backupOptions).then(function(backup){
          if(!backup||!backup.ok)throw new Error('BACKUP_FAILED');
          return saveFlag(d,localConferenceId,record,'backupStored');
        }).then(function(updated){
          record=updated;
          state=record.applicationState;
        });
      }).then(function(){
        if(state.localSnapshotSaved)return null;
        var source=applicationData(options);
        if(!source||!Array.isArray(source.conferences)){
          throw new Error('APP_DATA_UNAVAILABLE');
        }
        var index=source.conferences.findIndex(function(item){
          return item&&String(item.id)===String(localConferenceId);
        });
        if(index<0)throw new Error('CONFERENCE_NOT_FOUND');
        return d.pending.buildDigest(source.conferences[index])
          .then(function(currentDigest){
            if(currentDigest===record.snapshotDigest)return null;
            var next=copy(source);
            next.conferences[index]=copy(record.resolvedSnapshot);
            return d.repository.saveAppSnapshot(next,{
              source:'remote_resolution',
              skipSyncQueue:true
            }).then(function(){
              if(typeof options.applyMemory==='function'){
                options.applyMemory(copy(next));
              }else{
                global.appData=copy(next);
                options.appData=global.appData;
              }
              if(typeof options.render==='function')options.render();
            });
          }).then(function(){
            return saveFlag(
              d,localConferenceId,record,'localSnapshotSaved'
            );
          }).then(function(updated){
            record=updated;
            state=record.applicationState;
          });
      }).then(function(){
        if(state.linkFinalized)return null;
        var currentLink=d.links.get(localConferenceId,options.linkOptions);
        if(!validateRecord(record,currentLink,localConferenceId)){
          throw new Error('LINK_MISMATCH');
        }
        if(linkFinalized(currentLink)){
          return saveFlag(d,localConferenceId,record,'linkFinalized')
            .then(function(updated){
              record=updated;
              state=record.applicationState;
            });
        }
        if(!linkPending(currentLink))throw new Error('LINK_MISMATCH');
        var saved=d.links.save(Object.assign({},currentLink,{
          linkStatus:'linked',
          pendingLocalApplication:false
        }),options.linkOptions);
        if(!saved||!saved.ok)throw new Error('LINK_UPDATE_FAILED');
        return saveFlag(d,localConferenceId,record,'linkFinalized')
          .then(function(updated){
            record=updated;
            state=record.applicationState;
          });
      }).then(function(){
        if(state.pendingCompleted)return null;
        return d.pending.mark(
          localConferenceId,
          'applied',
          options.pendingOptions
        ).then(function(marked){
          if(!marked||!marked.ok){
            throw new Error('PENDING_COMPLETE_FAILED');
          }
          record=marked.data;
          state=record.applicationState;
        });
      }).then(function(){
        var applied=result(true,'applied',{
          localConferenceId:localConferenceId,
          resolvedRevision:record.resolvedRevision
        });
        var orchestrator=options.orchestrator||
          global.AutomaticSyncOrchestrator;
        if(orchestrator&&typeof orchestrator.schedule==='function'){
          orchestrator.schedule('conference_changed');
        }
        return applied;
      }).catch(function(error){
        return result(false,'application_incomplete',{
          reason:String(error&&error.message||'APPLICATION_FAILED')
        });
      });
      return sequence;
    }).catch(function(){
      return result(false,'application_incomplete');
    });
  }

  function apply(input,options){
    input=input||{};
    options=options||{};
    var localConferenceId=String(
      input.localConferenceId||
      input.record&&input.record.localConferenceId||
      ''
    );
    if(!localConferenceId){
      return Promise.resolve(result(false,'invalid_local_conference'));
    }
    if(flights[localConferenceId])return flights[localConferenceId];
    var flight=run(localConferenceId,options).finally(function(){
      if(flights[localConferenceId]===flight){
        delete flights[localConferenceId];
      }
    });
    flights[localConferenceId]=flight;
    return flight;
  }

  global.LocalSnapshotApplication=Object.freeze({apply:apply});
})(window);
