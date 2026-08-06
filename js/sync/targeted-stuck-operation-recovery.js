(function(global){
  'use strict';

  var TARGET=Object.freeze({
    localConferenceId:'e711a3ba-fea3-416a-ba1d-7caf4c3e931e',
    remoteConferenceId:'78b1b30a-6ef9-4f8c-89e7-fb71d4b6b9aa',
    operationId:'d41902b7-f8ae-402d-9423-854df9e40d23',
    deviceId:'71f9f2db-aeff-4e72-b692-a0f926916c62',
    baseRevision:17,
    serverRevision:18,
    roomNumber:'105'
  });
  var ACTIVE=Object.freeze([
    'pending','processing','failed','server_applied','requires_reconciliation',
    'conflict'
  ]);
  var running=null;
  var state={lastResult:null,lastBackupId:null,lastRunAt:null};

  function copy(value){
    if(value===undefined)return null;
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function result(ok,status,data,failedStage,reason){
    return {
      ok:ok===true,status:String(status||''),data:data||null,
      failedStage:failedStage||null,reason:reason||null
    };
  }
  function fail(stage,reason,data){
    return result(false,'blocked',data,stage,reason);
  }
  function canonical(value){
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    return '{'+Object.keys(value).sort().map(function(key){
      return JSON.stringify(key)+':'+canonical(value[key]);
    }).join(',')+'}';
  }
  function sha256(value){
    if(!global.crypto||!global.crypto.subtle||typeof global.TextEncoder!=='function'){
      return Promise.resolve(null);
    }
    return global.crypto.subtle.digest(
      'SHA-256',new global.TextEncoder().encode(canonical(value))
    ).then(function(buffer){
      return Array.prototype.map.call(new Uint8Array(buffer),function(byte){
        return byte.toString(16).padStart(2,'0');
      }).join('');
    }).catch(function(){return null;});
  }
  function uuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return global.crypto.randomUUID();
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }
  function currentConference(){
    var data=global.appData;
    if(!data||String(data.currentConferenceId||'')!==TARGET.localConferenceId){
      return null;
    }
    return Array.isArray(data.conferences)?data.conferences.find(function(item){
      return item&&String(item.id||'')===TARGET.localConferenceId;
    })||null:null;
  }
  function hasRoom(snapshot){
    return !!(snapshot&&Array.isArray(snapshot.houses)&&snapshot.houses.some(function(house){
      return Array.isArray(house&&house.floors)&&house.floors.some(function(floor){
        return Array.isArray(floor&&floor.rooms)&&floor.rooms.some(function(room){
          return String(room&&room.number||'')===TARGET.roomNumber;
        });
      });
    }));
  }
  function matchingConflict(record){
    if(!record||typeof record!=='object')return false;
    var ids=[record.localConferenceId,record.conferenceId,record.remoteConferenceId]
      .filter(Boolean).map(String);
    return ids.indexOf(TARGET.localConferenceId)>=0||
      ids.indexOf(TARGET.remoteConferenceId)>=0;
  }
  function dependencies(options){
    options=options||{};
    return {
      queue:options.queue||global.OfflineSyncQueue,
      links:options.links||global.ConferenceLinkStore,
      db:options.db||global.AppIndexedDB,
      integration:options.integration||global.OfflineFirstIntegration,
      orchestrator:options.orchestrator||global.AutomaticSyncOrchestrator,
      appData:options.appData||global.appData
    };
  }
  function validateDependencies(d){
    if(!d.queue||typeof d.queue.getOperation!=='function'||
      typeof d.queue.getOperationsByConference!=='function'||
      typeof d.queue.getConferenceReadiness!=='function'||
      typeof d.queue.markApplied!=='function')return fail('dependencies','queue_unavailable');
    if(!d.links||typeof d.links.get!=='function'||typeof d.links.save!=='function'){
      return fail('dependencies','link_store_unavailable');
    }
    if(!d.db||typeof d.db.getRecord!=='function'||
      typeof d.db.getAllRecords!=='function'||typeof d.db.putRecord!=='function'){
      return fail('dependencies','indexeddb_unavailable');
    }
    return null;
  }
  function readGuards(d){
    var conference=currentConference();
    if(d.appData!==global.appData){
      conference=d.appData&&String(d.appData.currentConferenceId||'')===
        TARGET.localConferenceId&&Array.isArray(d.appData.conferences)
        ?d.appData.conferences.find(function(item){
          return item&&String(item.id||'')===TARGET.localConferenceId;
        })||null:null;
    }
    if(!conference)return Promise.resolve(fail('current_conference','conference_mismatch'));
    var link=d.links.get(TARGET.localConferenceId);
    if(!link||String(link.remoteConferenceId||'')!==TARGET.remoteConferenceId){
      return Promise.resolve(fail('conference_link','link_mismatch'));
    }
    if(link.knownRevision===TARGET.serverRevision&&
      link.actualRevision===TARGET.serverRevision){
      return Promise.resolve(d.queue.getOperation(TARGET.operationId)).then(function(read){
        var applied=read&&read.data&&(read.data.operation||read.data);
        return applied&&applied.status==='applied'&&applied.result&&
          applied.result.revision===TARGET.serverRevision
          ?result(false,'already_recovered',{operation:copy(applied),link:copy(link)})
          :fail('conference_link','link_revision_changed');
      });
    }
    if(link.knownRevision!==TARGET.baseRevision||
      !(link.actualRevision===null||link.actualRevision===undefined||
        link.actualRevision===TARGET.baseRevision)){
      return Promise.resolve(fail('conference_link','link_revision_changed'));
    }
    if(link.pendingLocalApplication===true||link.conflictId||
      link.linkStatus==='needs_resolution'||
      link.syncState&&link.syncState.pendingRemoteApplication===true){
      return Promise.resolve(fail('conference_link','link_blocked'));
    }
    return Promise.all([
      d.queue.getOperation(TARGET.operationId),
      d.queue.getOperationsByConference(TARGET.remoteConferenceId),
      d.db.getRecord('pending_remote_applications',TARGET.localConferenceId),
      d.db.getRecord('conflict_resolution_drafts',TARGET.localConferenceId),
      d.db.getAllRecords('conflicts')
    ]).then(function(values){
      var operationRead=values[0];
      var operation=operationRead&&operationRead.data&&
        (operationRead.data.operation||operationRead.data);
      if(!operation||String(operation.operationId||'')!==TARGET.operationId){
        return fail('queue_operation','operation_missing');
      }
      if(operation.status==='applied')return result(false,'already_recovered',{operation:copy(operation)});
      if(operation.status!=='processing')return fail('queue_operation','status_changed');
      if(operation.baseRevision!==TARGET.baseRevision){
        return fail('queue_operation','base_revision_changed');
      }
      if(String(operation.conferenceId||'')!==TARGET.remoteConferenceId||
        String(operation.localConferenceId||'')!==TARGET.localConferenceId||
        String(operation.deviceId||'')!==TARGET.deviceId){
        return fail('queue_operation','operation_identity_mismatch');
      }
      if(!operation.snapshot)return fail('queue_operation','snapshot_missing');
      var listed=values[1];
      var operations=listed&&listed.data&&Array.isArray(listed.data.operations)
        ?listed.data.operations:[];
      if(!listed||!listed.ok)return fail('queue_read','queue_read_failed');
      var otherActive=operations.filter(function(item){
        return item&&item.operationId!==TARGET.operationId&&
          ACTIVE.indexOf(String(item.status||''))>=0;
      });
      if(otherActive.length)return fail('queue_read','other_active_operation',{
        operationIds:otherActive.map(function(item){return item.operationId;})
      });
      if(values[2])return fail('pending_remote_application','pending_remote_application_exists');
      if(values[3])return fail('conflict_draft','conflict_draft_exists');
      var conflicts=Array.isArray(values[4])?values[4]:[];
      if(conflicts.some(function(item){
        return matchingConflict(item)&&['resolved','discarded','completed']
          .indexOf(String(item.status||''))<0;
      }))return fail('conflicts','active_conflict_exists');
      if(!hasRoom(operation.snapshot)||!hasRoom(conference)){
        return fail('snapshot_validation','room_105_missing');
      }
      var syncContext=d.integration&&
        typeof d.integration.getConferenceSyncState==='function'
        ?d.integration.getConferenceSyncState(TARGET.localConferenceId):null;
      return Promise.all([sha256(operation.snapshot),sha256(conference)]).then(function(hashes){
        return result(true,'guards_passed',{
          conference:copy(conference),operation:copy(operation),link:copy(link),
          syncContext:copy(syncContext),operationsBefore:copy(operations),
          operationSnapshotHash:hashes[0],conferenceSnapshotHash:hashes[1]
        });
      });
    }).catch(function(error){
      return fail('guard_read','guard_read_failed',{message:String(error&&error.message||error)});
    });
  }
  function createBackup(d,guarded){
    var backup={
      backupId:uuid(),conferenceId:TARGET.localConferenceId,
      createdAt:new Date().toISOString(),
      reason:'targeted_stuck_operation_recovery_before_write',
      recoveryTarget:copy(TARGET),queueRecord:copy(guarded.operation),
      conferenceLink:copy(guarded.link),syncContext:copy(guarded.syncContext),
      conferenceSnapshot:copy(guarded.conference),
      hashes:{operationSnapshot:guarded.operationSnapshotHash,
        conferenceSnapshot:guarded.conferenceSnapshotHash}
    };
    return d.db.putRecord('local_backups',backup).then(function(){return backup;});
  }
  function recoverInternal(options){
    var d=dependencies(options);
    var unavailable=validateDependencies(d);
    if(unavailable)return Promise.resolve(unavailable);
    return readGuards(d).then(function(guarded){
      if(!guarded.ok)return guarded;
      return createBackup(d,guarded.data).then(function(backup){
        state.lastBackupId=backup.backupId;
        var nextLink=Object.assign({},guarded.data.link,{
          knownRevision:TARGET.serverRevision,actualRevision:TARGET.serverRevision
        });
        var saved=d.links.save(nextLink,{trigger:'targeted_stuck_operation_recovery'});
        if(!saved||!saved.ok)return fail('link_update','link_update_failed',{
          backupId:backup.backupId,status:saved&&saved.status||null
        });
        return d.queue.markApplied(TARGET.operationId,{
          revision:TARGET.serverRevision,previousRevision:TARGET.baseRevision,
          conferenceId:TARGET.remoteConferenceId,
          recoveryReason:'server_applied_same_operation'
        }).then(function(marked){
          if(!marked||!marked.ok){
            var rollback=d.links.save(guarded.data.link,{
              trigger:'targeted_stuck_operation_recovery_rollback'
            });
            return fail('mark_applied','mark_applied_failed',{
              backupId:backup.backupId,rollbackOk:!!(rollback&&rollback.ok)
            });
          }
          return Promise.all([
            d.queue.getOperation(TARGET.operationId),
            d.queue.getConferenceReadiness(TARGET.remoteConferenceId),
            d.queue.getOperationsByConference(TARGET.remoteConferenceId),
            sha256(guarded.data.conference),
            sha256(d.appData.conferences.find(function(item){
              return item&&String(item.id||'')===TARGET.localConferenceId;
            }))
          ]).then(function(checked){
            var finalOperation=checked[0]&&checked[0].data&&
              (checked[0].data.operation||checked[0].data);
            var readiness=checked[1];
            var afterOperations=checked[2]&&checked[2].data&&
              checked[2].data.operations||[];
            var unexpected=afterOperations.filter(function(item){
              return item&&ACTIVE.indexOf(String(item.status||''))>=0;
            });
            var valid=finalOperation&&finalOperation.status==='applied'&&
              finalOperation.result&&finalOperation.result.revision===18&&
              readiness&&readiness.ok&&readiness.status==='stable'&&
              unexpected.length===0&&checked[3]===checked[4]&&
              hasRoom(d.appData.conferences.find(function(item){
                return item&&String(item.id||'')===TARGET.localConferenceId;
              }))&&afterOperations.length===guarded.data.operationsBefore.length;
            if(!valid)return fail('post_verification','post_verification_failed',{
              backupId:backup.backupId,operation:copy(finalOperation),
              readiness:copy(readiness),unexpectedActive:copy(unexpected),
              queueCountBefore:guarded.data.operationsBefore.length,
              queueCountAfter:afterOperations.length,snapshotUnchanged:checked[3]===checked[4]
            });
            if(d.integration&&
              typeof d.integration.configureConferenceSync==='function'){
              d.integration.configureConferenceSync(TARGET.localConferenceId,{
                conferenceId:TARGET.remoteConferenceId,
                baseRevision:TARGET.serverRevision,
                schemaVersion:String(guarded.data.operation.schemaVersion||'1'),
                appVersion:String(guarded.data.operation.appVersion||
                  global.APP_RELEASE&&global.APP_RELEASE.version||'unknown')
              });
            }
            var scheduled=d.orchestrator&&typeof d.orchestrator.schedule==='function'
              ?d.orchestrator.schedule('conference_changed'):false;
            return result(true,'recovered',{
              backupId:backup.backupId,operation:copy(finalOperation),
              link:copy(d.links.get(TARGET.localConferenceId)),
              readiness:copy(readiness),room105Present:true,
              snapshotUnchanged:true,queueCount:afterOperations.length,
              uploadCalled:false,downloadCalled:false,retryCalled:false,
              orchestratorScheduled:scheduled===true,
              realtimeState:d.orchestrator&&
                typeof d.orchestrator.getRealtimeState==='function'
                ?copy(d.orchestrator.getRealtimeState()):null
            });
          });
        });
      },function(error){
        return fail('backup','backup_failed',{message:String(error&&error.message||error)});
      });
    });
  }
  function recover(options){
    if(running)return running;
    state.lastRunAt=new Date().toISOString();
    running=recoverInternal(options).then(function(outcome){
      state.lastResult=copy(outcome);
      return outcome;
    }).catch(function(error){
      var outcome=fail('unexpected','unexpected_error',{
        message:String(error&&error.message||error)
      });
      state.lastResult=copy(outcome);
      return outcome;
    }).finally(function(){running=null;});
    return running;
  }
  function getState(){
    return {target:copy(TARGET),running:!!running,lastRunAt:state.lastRunAt,
      lastBackupId:state.lastBackupId,lastResult:copy(state.lastResult)};
  }

  global.TargetedStuckOperationRecovery=Object.freeze({
    recover:recover,getState:getState,target:copy(TARGET)
  });
})(window);
