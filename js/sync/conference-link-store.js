(function(global){
  'use strict';
  var namespace=global.BrowserStorageNamespace||{
    key:function(name){return name;}
  };
  var KEY=namespace.key('conference_manager_sync_links');
  var STATUSES=[
    'linked','upload_pending','needs_resolution','unsynced','disconnected',
    'server_selected_pending_local_apply','linking','cloud_linked',
    'link_failed'
  ];
  var MAX_DIAGNOSTIC_EVENTS=100;
  var diagnosticEvents=[];
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
  function inspect(options){
    var storage=target(options);
    try{
      var raw=storage&&storage.getItem(KEY);
      if(raw===null||raw===''){
        return {ok:true,status:'empty',data:{}};
      }
      var value=JSON.parse(raw);
      if(!value||typeof value!=='object'||Array.isArray(value)){
        return {ok:false,status:'malformed',data:null};
      }
      var valid=Object.keys(value).every(function(key){
        var link=value[key];
        return link&&typeof link==='object'&&!Array.isArray(link)&&
          link.localConferenceId===key&&
          isUuid(link.remoteConferenceId)&&
          STATUSES.indexOf(link.linkStatus)>=0&&
          Number.isInteger(link.knownRevision)&&link.knownRevision>=0;
      });
      if(!valid){
        return {ok:false,status:'malformed',data:null};
      }
      return {ok:true,status:'read',data:copy(value)};
    }catch(error){
      return {ok:false,status:'read_failed',data:null};
    }
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
  function shortId(value){
    value=String(value||'');
    return value?value.slice(0,8)+'…':null;
  }
  function shortStack(){
    try{
      return String(new Error().stack||'').split('\n').slice(2,7)
        .map(function(line){return line.trim();});
    }catch(error){return [];}
  }
  function recordWriteDiagnostic(previous,input,options){
    if(input.linkStatus!=='needs_resolution')return;
    var details=options&&options.diagnosticWriter||{};
    var hasPending=Object.prototype.hasOwnProperty.call(
      input,'pendingLocalApplication'
    );
    var event={
      eventName:previous&&previous.linkStatus==='linked'
        ?'LINK_STATUS_REGRESSION_DETECTED':'LINK_STATUS_WRITE_ATTEMPT',
      writerName:String(details.writerName||'ConferenceLinkStore.save'),
      conferenceId:shortId(input.localConferenceId),
      previousLinkStatus:previous&&previous.linkStatus||null,
      nextLinkStatus:input.linkStatus,
      conflictId:shortId(input.conflictId||previous&&previous.conflictId),
      conflictStatus:input.conflictStatus||previous&&previous.conflictStatus||null,
      pendingLocalApplication:hasPending
        ?input.pendingLocalApplication===true
        :previous&&previous.pendingLocalApplication===true,
      knownRevision:Number.isInteger(input.knownRevision)
        ?input.knownRevision:Number.isInteger(previous&&previous.knownRevision)
          ?previous.knownRevision:null,
      incomingRevision:Number.isInteger(details.incomingRevision)
        ?details.incomingRevision:null,
      reason:String(details.reason||'unspecified'),
      trigger:String(details.trigger||details.reason||'unspecified'),
      stackTrace:shortStack(),
      timestamp:new Date().toISOString()
    };
    var persistent=global.LinkStatusDiagnosticStore;
    if(persistent&&typeof persistent.append==='function'){
      try{persistent.append(event);}catch(error){}
    }
    diagnosticEvents.push(event);
    if(diagnosticEvents.length>MAX_DIAGNOSTIC_EVENTS){
      diagnosticEvents.splice(0,diagnosticEvents.length-MAX_DIAGNOSTIC_EVENTS);
    }
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
    var duplicateRemote=Object.keys(links).some(function(key){
      return key!==localId&&links[key]&&
        String(links[key].remoteConferenceId||'')===remoteId;
    });
    if(duplicateRemote){
      return {ok:false,status:'remote_already_linked'};
    }
    var previousLinks=copy(links);
    var previous=links[localId]||{};
    recordWriteDiagnostic(previous,input,options);
    var now=new Date().toISOString();
    function nullableField(name){
      return Object.prototype.hasOwnProperty.call(input,name)
        ?String(input[name]||'')||null
        :String(previous[name]||'')||null;
    }
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
      conflictId:nullableField('conflictId'),
      conflictStatus:nullableField('conflictStatus'),
      resolutionStrategy:nullableField('resolutionStrategy'),
      resolutionOperationId:nullableField('resolutionOperationId'),
      resolvedRevision:Number.isInteger(input.resolvedRevision)
        ?input.resolvedRevision
        :previous.resolvedRevision||null,
      pendingLocalApplication:input.pendingLocalApplication===true,
      linkedAt:input.linkedAt||previous.linkedAt||null,
      linkedByUserId:String(
        input.linkedByUserId||previous.linkedByUserId||''
      )||null,
      syncState:input.syncState&&
        typeof input.syncState==='object'&&!Array.isArray(input.syncState)
        ?copy(input.syncState)
        :previous.syncState||null,
      lastVerifiedAt:input.lastVerifiedAt||
        previous.lastVerifiedAt||null,
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
    inspect:inspect,get:get,list:list,findByRemoteId:findByRemoteId,
    save:save,remove:remove,
    getWriteDiagnostics:function(){return copy(diagnosticEvents);},
    clearWriteDiagnosticsForTests:function(){diagnosticEvents=[];}
  });
})(window);
