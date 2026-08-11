(function(global){
  'use strict';

  var STABLE_ORPHAN_REASONS=Object.freeze([
    'membership_read_denied','conference_unavailable','conference_not_found'
  ]);
  var CONFIRMED_MISSING_CLOUD=Object.freeze({
    'd257b1c5-cc20-4e1c-a188-5572d334e485':Object.freeze({
      mode:'unpublished',remoteConferenceId:null,
      verifiedAt:'2026-08-11'
    }),
    '0e854d69-8420-44ba-86e5-5b6a1616e708':Object.freeze({
      mode:'linked',
      remoteConferenceId:'fdbcde22-528a-44f3-9ee0-e5e912695585',
      verifiedAt:'2026-08-11'
    })
  });
  var SCOPED_STORAGE_KEYS=Object.freeze([
    'conf_v5',
    'conference_manager_sync_links',
    'conference_manager_linking_attempts_v1',
    'conference_manager_link_status_diagnostics_v1',
    'conference_manager_link_status_diagnostic_session_v1',
    'conference_manager_remote_update_markers',
    'conference_manager_wrong_remote_binding_repair_v1'
  ]);
  var CLEANUP_STORES=Object.freeze([
    'conferences','rooms','sync_metadata','pending_operations',
    'sync_operations_queue','conflicts','local_backups',
    'pending_remote_applications','conflict_resolution_drafts',
    'conflict_resolution_backups'
  ]);

  function copy(value){
    if(value===undefined)return undefined;
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function outcome(ok,status,data,error){
    return {ok:ok===true,status:String(status||''),data:data||null,error:error||null};
  }
  function namespace(){
    return global.BrowserStorageNamespace||{
      environment:'production',key:function(value){return value;}
    };
  }
  function key(value){
    var api=namespace();
    return api&&typeof api.key==='function'?api.key(value):value;
  }
  function storage(options){
    if(options&&options.storage)return options.storage;
    try{return global.localStorage||null;}catch(error){return null;}
  }
  function dependencies(options){
    options=options||{};
    return {
      db:options.db||global.AppIndexedDB,
      links:options.links||global.ConferenceLinkStore,
      realtime:options.realtime||global.ConferenceRealtimeManager,
      orchestrator:options.orchestrator||global.AutomaticSyncOrchestrator,
      auth:options.auth||global.SupabaseAuth,
      device:options.device||global.SupabaseDeviceIdentity,
      storage:storage(options),
      appData:options.appData||global.appData
    };
  }
  function conference(data,id){
    var values=data&&Array.isArray(data.conferences)?data.conferences:[];
    return values.find(function(item){return String(item&&item.id||'')===id;})||null;
  }
  function lifecycle(data,id){
    return data&&data.conferenceLifecycle&&
      data.conferenceLifecycle.records&&
      data.conferenceLifecycle.records[id]||null;
  }
  function confirmedMissingCloud(id,link,d){
    var proof=CONFIRMED_MISSING_CLOUD[id];
    if(!proof)return null;
    if(proof.mode==='unpublished'){
      var record=lifecycle(d.appData,id);
      if(link||!record||record.localLifecycle!=='active'||
        record.cloudLifecycle!=='unpublished')return null;
      return proof;
    }
    if(!link||String(link.localConferenceId||'')!==id||
      String(link.remoteConferenceId||'')!==proof.remoteConferenceId||
      link.linkStatus!=='linked')return null;
    return proof;
  }
  function inspect(localConferenceId,options){
    var id=String(localConferenceId||'');
    var d=dependencies(options);
    if(namespace().environment==='development'){
      return outcome(false,'development_environment_blocked');
    }
    if(!id||!conference(d.appData,id))return outcome(false,'local_conference_missing');
    var link=d.links&&typeof d.links.get==='function'
      ?d.links.get(id,options&&options.linkOptions):null;
    var proof=confirmedMissingCloud(id,link,d);
    if(proof){
      return outcome(true,proof.mode==='unpublished'
        ?'confirmed_local_unpublished':'confirmed_linked_orphan',{
        localConferenceId:id,
        remoteConferenceId:proof.remoteConferenceId,
        reason:'cloud_conference_missing_verified',
        proofVerifiedAt:proof.verifiedAt,
        proofMode:proof.mode
      });
    }
    if(!link||String(link.localConferenceId||'')!==id||
      !String(link.remoteConferenceId||'')){
      return outcome(false,'conference_link_missing');
    }
    var state=d.realtime&&typeof d.realtime.getState==='function'
      ?d.realtime.getState(id):null;
    var reason=String(state&&state.reason||'');
    if(!state||state.status!=='suspended'||
      STABLE_ORPHAN_REASONS.indexOf(reason)<0){
      return outcome(false,'orphan_status_not_confirmed',{
        realtimeStatus:state&&state.status||null,
        reason:reason||null
      });
    }
    if(state.cloudConferenceId){
      return outcome(false,'active_cloud_context_present');
    }
    return outcome(true,'orphan_confirmed',{
      localConferenceId:id,
      remoteConferenceId:String(link.remoteConferenceId),
      reason:reason
    });
  }
  function matchingRecordCount(records,ids){
    return (Array.isArray(records)?records:[]).filter(function(record){
      return identifiersMatch(record,ids);
    }).length;
  }
  function inspectDetails(localConferenceId,options){
    var inspected=inspect(localConferenceId,options);
    if(!inspected.ok)return Promise.resolve(inspected);
    var d=dependencies(options);
    if(!d.db||typeof d.db.getAllRecords!=='function'){
      return Promise.resolve(outcome(false,'queue_count_unavailable'));
    }
    var ids=[inspected.data.localConferenceId,
      inspected.data.remoteConferenceId].filter(Boolean);
    return d.db.getAllRecords('sync_operations_queue').then(function(records){
      var data=Object.assign({},inspected.data,{
        pendingQueueCount:matchingRecordCount(records,ids)
      });
      return outcome(true,inspected.status,data);
    }).catch(function(){
      return outcome(false,'queue_count_unavailable');
    });
  }
  function identifiersMatch(record,ids){
    if(!record||typeof record!=='object')return false;
    return [
      record.conferenceId,record.localConferenceId,
      record.remoteConferenceId,record.cloudConferenceId
    ].some(function(value){return ids.indexOf(String(value||''))>=0;});
  }
  function cleanAppData(value,localId){
    var next=copy(value&&typeof value==='object'?value:{});
    next.conferences=(Array.isArray(next.conferences)?next.conferences:[])
      .filter(function(item){return String(item&&item.id||'')!==localId;});
    if(String(next.currentConferenceId||'')===localId)next.currentConferenceId=null;
    if(next.conferenceLifecycle&&next.conferenceLifecycle.records){
      delete next.conferenceLifecycle.records[localId];
    }
    return next;
  }
  function requestPromise(request){
    return new Promise(function(resolve,reject){
      request.onsuccess=function(){resolve(request.result);};
      request.onerror=function(){reject(request.error||new Error('INDEXEDDB_REQUEST_FAILED'));};
    });
  }
  function deleteMatching(store,ids){
    return new Promise(function(resolve,reject){
      var count=0;
      var request=store.openCursor();
      request.onerror=function(){reject(request.error||new Error('INDEXEDDB_CURSOR_FAILED'));};
      request.onsuccess=function(){
        var cursor=request.result;
        if(!cursor){resolve(count);return;}
        if(identifiersMatch(cursor.value,ids)){
          var deletion=cursor.delete();
          deletion.onerror=function(){reject(deletion.error||new Error('INDEXEDDB_DELETE_FAILED'));};
          deletion.onsuccess=function(){count++;cursor.continue();};
          return;
        }
        cursor.continue();
      };
    });
  }
  function cleanConferenceStore(store,ids,localId){
    return new Promise(function(resolve,reject){
      var count=0;
      var request=store.openCursor();
      request.onerror=function(){reject(request.error||new Error('INDEXEDDB_CURSOR_FAILED'));};
      request.onsuccess=function(){
        var cursor=request.result;
        if(!cursor){resolve(count);return;}
        var record=cursor.value;
        if(String(record&&record.conferenceId||'')==='**app_snapshot**'){
          record=copy(record);
          record.data=cleanAppData(record.data,localId);
          var update=cursor.update(record);
          update.onerror=function(){reject(update.error||new Error('APP_SNAPSHOT_UPDATE_FAILED'));};
          update.onsuccess=function(){cursor.continue();};
          return;
        }
        if(identifiersMatch(record,ids)||ids.indexOf(String(cursor.key||''))>=0){
          var deletion=cursor.delete();
          deletion.onerror=function(){reject(deletion.error||new Error('INDEXEDDB_DELETE_FAILED'));};
          deletion.onsuccess=function(){count++;cursor.continue();};
          return;
        }
        cursor.continue();
      };
    });
  }
  function cleanupIndexedDb(d,localId,remoteId,options){
    if(options&&options.indexedDbCleanup){
      return Promise.resolve(options.indexedDbCleanup(localId,remoteId));
    }
    if(!d.db||typeof d.db.runTransaction!=='function'){
      return Promise.reject(new Error('INDEXEDDB_UNAVAILABLE'));
    }
    var names=CLEANUP_STORES.slice();
    var ids=[localId,remoteId];
    return d.db.runTransaction(names,'readwrite',function(stores){
      var tasks=[];
      names.forEach(function(name){
        tasks.push(name==='conferences'
          ?cleanConferenceStore(stores[name],ids,localId)
          :deleteMatching(stores[name],ids));
      });
      return Promise.all(tasks).then(function(counts){
        var result={};
        names.forEach(function(name,index){result[name]=counts[index];});
        return result;
      });
    });
  }
  function scoped(value,ids){
    return value&&typeof value==='object'&&identifiersMatch(value,ids);
  }
  function filterScoped(value,ids){
    if(Array.isArray(value)){
      return value.filter(function(item){return !scoped(item,ids);})
        .map(function(item){return filterScoped(item,ids);});
    }
    if(!value||typeof value!=='object')return value;
    var next={};
    Object.keys(value).forEach(function(name){
      if(ids.indexOf(String(name))>=0||scoped(value[name],ids))return;
      next[name]=filterScoped(value[name],ids);
    });
    return next;
  }
  function readJson(target,name){
    var raw=target.getItem(name);
    if(raw===null||raw==='')return {exists:false,value:null};
    return {exists:true,value:JSON.parse(raw)};
  }
  function writeJson(target,name,value){
    target.setItem(name,JSON.stringify(value));
  }
  function cleanLocalStorage(d,localId,remoteId){
    var target=d.storage;
    if(!target)throw new Error('LOCAL_STORAGE_UNAVAILABLE');
    var ids=[localId,remoteId];
    var changed=[];
    SCOPED_STORAGE_KEYS.forEach(function(baseName){
      var name=key(baseName);
      var parsed;
      try{parsed=readJson(target,name);}catch(error){
        throw new Error('LOCAL_STORAGE_PARSE_FAILED:'+baseName);
      }
      if(!parsed.exists)return;
      var next;
      if(baseName==='conf_v5'){
        var wrapped=parsed.value&&parsed.value.appData;
        next=wrapped
          ?Object.assign({},parsed.value,{appData:cleanAppData(wrapped,localId)})
          :cleanAppData(parsed.value,localId);
      }else{
        next=filterScoped(parsed.value,ids);
      }
      writeJson(target,name,next);
      changed.push(name);
    });
    return changed;
  }
  function protectedStorageSnapshot(target){
    var protectedValues={};
    if(!target)return protectedValues;
    var allowed=SCOPED_STORAGE_KEYS.map(key);
    for(var index=0;index<target.length;index++){
      var name=target.key(index);
      if(name&&allowed.indexOf(name)<0)protectedValues[name]=target.getItem(name);
    }
    return protectedValues;
  }
  function stableString(value){
    try{return JSON.stringify(value);}catch(error){return ''+value;}
  }
  function protectedRuntime(d){
    var auth=d.auth&&typeof d.auth.getState==='function'?copy(d.auth.getState()):null;
    var device=d.device&&typeof d.device.getCurrent==='function'?copy(d.device.getCurrent()):null;
    return {auth:auth,device:device,storage:protectedStorageSnapshot(d.storage)};
  }
  function verifyProtected(before,d){
    var after=protectedRuntime(d);
    return stableString(before.auth)===stableString(after.auth)&&
      stableString(before.device)===stableString(after.device)&&
      stableString(before.storage)===stableString(after.storage);
  }
  function stopRuntime(d){
    if(!d.orchestrator||typeof d.orchestrator.stop!=='function')return Promise.resolve();
    var stopped=d.orchestrator.stop();
    return Promise.resolve(stopped&&stopped.promise||null);
  }
  function cleanup(localConferenceId,options){
    options=options||{};
    var requestedId=String(localConferenceId||'');
    var initial=dependencies(options);
    var existingLink=initial.links&&typeof initial.links.get==='function'
      ?initial.links.get(requestedId,options.linkOptions):null;
    if(namespace().environment!=='development'&&requestedId&&
      !conference(initial.appData,requestedId)&&!existingLink){
      return Promise.resolve(outcome(true,'already_clean',{
        localConferenceId:requestedId
      }));
    }
    var eligible=inspect(localConferenceId,options);
    if(!eligible.ok)return Promise.resolve(eligible);
    var d=dependencies(options);
    var localId=eligible.data.localConferenceId;
    var remoteId=eligible.data.remoteConferenceId;
    var before=protectedRuntime(d);
    return stopRuntime(d).then(function(){
      return cleanupIndexedDb(d,localId,remoteId,options);
    }).then(function(storeCounts){
      var changedKeys=cleanLocalStorage(d,localId,remoteId);
      var next=cleanAppData(d.appData,localId);
      if(options.appData)options.appData=next;
      else global.appData=next;
      if(d.links&&typeof d.links.get==='function'&&d.links.get(localId)){
        throw new Error('CONFERENCE_LINK_STILL_PRESENT');
      }
      if(!verifyProtected(before,d))throw new Error('PROTECTED_STATE_CHANGED');
      return outcome(true,'local_orphan_removed',{
        localConferenceId:localId,
        remoteConferenceId:remoteId,
        storeCounts:storeCounts,
        changedStorageKeys:changedKeys,
        currentConferenceId:next.currentConferenceId||null
      });
    }).catch(function(error){
      return outcome(false,'local_cleanup_failed',null,{
        code:String(error&&error.message||'LOCAL_CLEANUP_FAILED')
      });
    });
  }

  global.OrphanedConferenceCleanup=Object.freeze({
    inspect:inspect,inspectDetails:inspectDetails,cleanup:cleanup,
    stableReasons:STABLE_ORPHAN_REASONS.slice(),
    confirmedMissingCloudIds:Object.keys(CONFIRMED_MISSING_CLOUD),
    stores:CLEANUP_STORES.slice(),
    scopedStorageKeys:SCOPED_STORAGE_KEYS.slice()
  });
})(window);
