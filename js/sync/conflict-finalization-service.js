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
      error:ok?null:{code:status,message:'Conflict finalization failed.'}
    };
  }

  function dependencies(options){
    options=options||{};
    return {
      drafts:options.drafts||global.ConflictResolutionDraftStore,
      pending:options.pending||global.PendingRemoteApplicationStore,
      links:options.links||global.ConferenceLinkStore,
      queue:options.queue||global.OfflineSyncQueue,
      publisher:options.publisher||global.OfflineFirstIntegration,
      deviceIdentity:options.deviceIdentity||
        global.SupabaseDeviceIdentity
    };
  }

  function trustedExecution(draft){
    var plan=draft&&draft.plan;
    var execution=draft&&draft.executionResult;
    var data=execution&&execution.data;
    if(!plan||!execution||execution.ok!==true||
      ['resolved','server_selected','duplicate'].indexOf(
        execution.status
      )<0||
      !data||
      data.conflictId!==plan.conflictId||
      data.conferenceId!==plan.conferenceId||
      data.strategy!==plan.strategy||
      data.operationId!==plan.resolutionOperationId||
      !Number.isInteger(data.resolvedRevision)||
      data.resolvedRevision!==draft.resolvedRevision){
      return false;
    }
    return plan.strategy==='keep_server'
      ?data.resolvedRevision===plan.baseRevision
      :data.resolvedRevision===plan.baseRevision+1;
  }

  function persistFlag(d,localConferenceId,flag){
    var patch={};
    patch[flag]=true;
    return d.drafts.updateFinalization(
      localConferenceId,
      patch
    ).then(function(updated){
      if(!updated||!updated.ok)throw new Error(
        'FINALIZATION_FLAG_SAVE_FAILED'
      );
      return updated.data;
    });
  }

  function resolveDeviceId(d){
    try{
      var identity=d.deviceIdentity&&
        typeof d.deviceIdentity.getOrCreate==='function'
        ?d.deviceIdentity.getOrCreate()
        :d.deviceIdentity;
      return identity&&identity.id?String(identity.id):'';
    }catch(error){
      return '';
    }
  }

  function run(localConferenceId,options){
    var d=dependencies(options);
    return d.drafts.get(localConferenceId).then(function(read){
      if(!read||!read.ok)return result(false,'draft_not_found');
      var draft=read.data;
      if(draft.executionStatus==='completed'){
        return result(true,'already_completed',{draft:copy(draft)});
      }
      if(['executed','finalizing'].indexOf(draft.executionStatus)<0||
        !trustedExecution(draft)){
        return result(false,'untrusted_execution_result');
      }
      var plan=draft.plan;
      var revision=draft.resolvedRevision;
      var keepServer=plan.strategy==='keep_server';
      var flags=draft.finalization||{};
      var sequence=Promise.resolve();

      if(!flags.pendingApplicationStored){
        sequence=sequence.then(function(){
          if(!keepServer)return null;
          return d.pending.save({
            localConferenceId:String(localConferenceId),
            remoteConferenceId:plan.conferenceId,
            conflictId:plan.conflictId,
            resolutionStrategy:'keep_server',
            resolutionOperationId:plan.resolutionOperationId,
            resolvedRevision:revision,
            resolvedSnapshot:copy(plan.resolvedSnapshot)
          }).then(function(saved){
            if(!saved||!saved.ok){
              throw new Error('PENDING_APPLICATION_STORE_FAILED');
            }
          });
        }).then(function(){
          return persistFlag(
            d,localConferenceId,'pendingApplicationStored'
          );
        }).then(function(updated){flags=updated.finalization;});
      }

      sequence=sequence.then(function(){
        if(flags.revisionPublished)return null;
        if(!d.publisher||
          typeof d.publisher.publishConferenceRevision!=='function'){
          throw new Error('REVISION_PUBLISHER_UNAVAILABLE');
        }
        return d.publisher.publishConferenceRevision({
          remoteConferenceId:plan.conferenceId,
          deviceId:resolveDeviceId(d),
          revision:revision,
          allowActiveConflict:true
        },{
          linkStore:d.links,
          queue:d.queue
        }).then(function(published){
          if(!published||!published.ok||
            published.status!=='revision_published'){
            throw new Error('REVISION_PUBLISH_FAILED');
          }
          return persistFlag(d,localConferenceId,'revisionPublished');
        }).then(function(updated){flags=updated.finalization;});
      }).then(function(){
        if(flags.linkMetadataUpdated)return null;
        var link=d.links.get(localConferenceId);
        if(!link||link.remoteConferenceId!==plan.conferenceId){
          throw new Error('LINK_METADATA_MISSING');
        }
        var saved=d.links.save(Object.assign({},link,{
          resolvedRevision:revision,
          conflictStatus:'resolved',
          resolutionStrategy:plan.strategy,
          resolutionOperationId:plan.resolutionOperationId,
          pendingLocalApplication:keepServer,
          linkStatus:keepServer
            ?'server_selected_pending_local_apply'
            :'linked',
          lastResolvedAt:new Date().toISOString()
        }));
        if(!saved||!saved.ok){
          throw new Error('LINK_METADATA_UPDATE_FAILED');
        }
        return persistFlag(d,localConferenceId,'linkMetadataUpdated')
          .then(function(updated){flags=updated.finalization;});
      }).then(function(){
        if(flags.queueUpdated)return null;
        if(!plan.sourceOperationId){
          return persistFlag(d,localConferenceId,'queueUpdated')
            .then(function(updated){flags=updated.finalization;});
        }
        if(!d.queue||
          typeof d.queue.markConflictResolved!=='function'){
          throw new Error('QUEUE_UPDATE_UNAVAILABLE');
        }
        return d.queue.markConflictResolved(plan.sourceOperationId,{
          conflictId:plan.conflictId,
          resolutionOperationId:plan.resolutionOperationId,
          strategy:plan.strategy,
          revision:revision
        }).then(function(updated){
          if(!updated||!updated.ok){
            throw new Error('QUEUE_UPDATE_FAILED');
          }
          return persistFlag(d,localConferenceId,'queueUpdated');
        }).then(function(updated){flags=updated.finalization;});
      }).then(function(){
        return d.drafts.markCompleted(localConferenceId);
      }).then(function(completed){
        if(!completed||!completed.ok){
          throw new Error('DRAFT_COMPLETION_FAILED');
        }
        return result(true,'finalization_completed',{
          resolvedRevision:revision,
          pendingLocalApplication:keepServer
        });
      }).catch(function(error){
        return result(false,'finalization_incomplete',{
          reason:String(error&&error.message||'FINALIZATION_FAILED')
        });
      });
      return sequence;
    });
  }

  function finalize(localConferenceId,options){
    localConferenceId=String(localConferenceId||'');
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

  global.ConflictFinalizationService=Object.freeze({
    finalize:finalize
  });
})(window);
