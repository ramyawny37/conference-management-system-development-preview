(function(global){
  'use strict';

  var FORMAT='conference-device-rescue-bundle';
  var FORMAT_VERSION=1;
  var STORES=Object.freeze([
    'sync_operations_queue',
    'conflicts',
    'conflict_resolution_drafts',
    'pending_remote_applications',
    'pending_operations',
    'conflict_resolution_backups',
    'sync_metadata'
  ]);
  var SECRET_KEY=/(?:password|secret|session|token|authorization|anon.?key|publishable.?key|service.?role.?key)/i;

  function copy(value){
    if(value===undefined)return null;
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function sanitize(value,seen){
    if(value===null||typeof value!=='object')return value;
    seen=seen||[];
    if(seen.indexOf(value)>=0)return '[Circular]';
    seen.push(value);
    var output;
    if(Array.isArray(value)){
      output=value.map(function(item){return sanitize(item,seen);});
    }else{
      output={};
      Object.keys(value).forEach(function(key){
        output[key]=SECRET_KEY.test(key)?'[REDACTED]':sanitize(value[key],seen);
      });
    }
    seen.pop();
    return output;
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
      return Promise.reject(new Error('SHA256_UNAVAILABLE'));
    }
    var bytes=new global.TextEncoder().encode(canonical(value));
    return global.crypto.subtle.digest('SHA-256',bytes).then(function(buffer){
      return Array.prototype.map.call(new Uint8Array(buffer),function(byte){
        return byte.toString(16).padStart(2,'0');
      }).join('');
    });
  }

  function currentConference(){
    if(typeof global.getCurrentConference==='function'){
      try{return global.getCurrentConference()||null;}catch(error){}
    }
    var data=global.appData;
    var id=data&&data.currentConferenceId;
    return data&&Array.isArray(data.conferences)
      ?data.conferences.find(function(item){return item&&String(item.id)===String(id);})||null
      :null;
  }

  function matchesConference(record,localId,remoteId,conflictId){
    if(!record||typeof record!=='object')return false;
    var ids=[
      record.conferenceId,record.localConferenceId,
      record.remoteConferenceId,record.conflictId
    ].filter(Boolean).map(String);
    return ids.indexOf(localId)>=0||
      (remoteId&&ids.indexOf(remoteId)>=0)||
      (conflictId&&ids.indexOf(conflictId)>=0);
  }

  function readStore(repository,name){
    if(!repository||typeof repository.getAllRecords!=='function'){
      return Promise.resolve({ok:false,records:[],error:'INDEXEDDB_READ_API_UNAVAILABLE'});
    }
    return Promise.resolve().then(function(){
      return repository.getAllRecords(name);
    }).then(function(records){
      return {ok:true,records:Array.isArray(records)?records:[],error:null};
    }).catch(function(error){
      return {
        ok:false,
        records:[],
        error:String(error&&error.message||error||'STORE_READ_FAILED')
      };
    });
  }

  function readStoredAppSnapshot(repository){
    if(!repository||typeof repository.getRecord!=='function'){
      return Promise.resolve({ok:false,record:null,error:'INDEXEDDB_READ_API_UNAVAILABLE'});
    }
    return Promise.resolve().then(function(){
      return repository.getRecord('conferences','**app_snapshot**');
    }).then(function(record){
      return {ok:true,record:record||null,error:null};
    }).catch(function(error){
      return {ok:false,record:null,error:String(error&&error.message||error||'SNAPSHOT_READ_FAILED')};
    });
  }

  function collectSnapshotPaths(value,path,found,seen){
    if(value===null||typeof value!=='object')return;
    seen=seen||[];
    if(seen.indexOf(value)>=0)return;
    seen.push(value);
    Object.keys(value).forEach(function(key){
      var nextPath=path+'.'+key;
      var item=value[key];
      if(/snapshot/i.test(key)&&item&&typeof item==='object'){
        found.push({path:nextPath,value:item});
      }
      collectSnapshotPaths(item,nextPath,found,seen);
    });
    seen.pop();
  }

  function buildHashes(bundle){
    var targets=[];
    if(bundle.localConferenceSnapshot){
      targets.push({path:'$.localConferenceSnapshot',value:bundle.localConferenceSnapshot});
    }
    collectSnapshotPaths(bundle,'$',targets,[]);
    var unique=Object.create(null);
    targets=targets.filter(function(target){
      if(unique[target.path])return false;
      unique[target.path]=true;
      return true;
    });
    return Promise.all(targets.map(function(target){
      return sha256(target.value).then(function(hash){
        return {path:target.path,algorithm:'SHA-256',hash:hash};
      }).catch(function(error){
        return {path:target.path,algorithm:'SHA-256',hash:null,
          error:String(error&&error.message||error)};
      });
    }));
  }

  function runtimeDiagnostics(){
    var api=global.MemberRuntimeDiagnostics;
    try{return api&&typeof api.read==='function'?api.read():null;}
    catch(error){return {readError:String(error&&error.message||error)};}
  }

  function allowed(options){
    var policy=options&&options.privacyPolicy||global.DiagnosticsPrivacyPolicy;
    return !!(policy&&typeof policy.canExportRescue==='function'&&policy.canExportRescue());
  }

  function shortIdentifier(value){
    var text=String(value||'');
    return text?text.slice(0,8)+'…'+text.slice(-4):null;
  }

  function createBundle(options){
    options=options||{};
    if(!allowed(options))return Promise.reject(new Error('RESCUE_EXPORT_FORBIDDEN'));
    var repository=options.indexedDb||global.AppIndexedDB;
    var conference=options.conference||currentConference();
    if(!conference||!conference.id){
      return Promise.reject(new Error('CURRENT_CONFERENCE_REQUIRED'));
    }
    var localId=String(conference.id);
    var linkApi=options.linkStore||global.ConferenceLinkStore;
    var link=linkApi&&typeof linkApi.get==='function'?linkApi.get(localId):null;
    var remoteId=String(link&&link.remoteConferenceId||'');
    var conflictId=String(link&&link.conflictId||'');
    var syncApi=options.syncIntegration||global.OfflineFirstIntegration;
    var syncContext=syncApi&&typeof syncApi.getConferenceSyncState==='function'
      ?syncApi.getConferenceSyncState(localId):null;
    var reads=STORES.map(function(name){return readStore(repository,name);});
    reads.push(readStoredAppSnapshot(repository));
    return Promise.all(reads).then(function(results){
      var stores={};
      var readErrors=[];
      STORES.forEach(function(name,index){
        var read=results[index];
        var records=read.records.filter(function(record){
          return matchesConference(record,localId,remoteId,conflictId);
        });
        stores[name]={ok:read.ok,records:sanitize(records)};
        if(!read.ok){
          stores[name].error=read.error;
          readErrors.push({source:name,error:read.error});
        }
      });
      var storedRead=results[STORES.length];
      var storedConference=null;
      var storedData=storedRead.record&&storedRead.record.data;
      if(storedData&&Array.isArray(storedData.conferences)){
        storedConference=storedData.conferences.find(function(item){
          return item&&String(item.id)===localId;
        })||null;
      }
      if(!storedRead.ok)readErrors.push({source:'indexedDbAppSnapshot',error:storedRead.error});
      var identityApi=options.deviceIdentity||global.SupabaseDeviceIdentity;
      var identity=identityApi&&typeof identityApi.getCurrent==='function'
        ?identityApi.getCurrent():null;
      var diagnostics=runtimeDiagnostics();
      var bundle={
        bundleType:FORMAT,
        formatVersion:FORMAT_VERSION,
        exportedAt:new Date().toISOString(),
        applicationVersion:global.APP_RELEASE&&global.APP_RELEASE.version||null,
        device:sanitize({
          id:shortIdentifier(identity&&identity.id),
          deviceName:identity&&identity.deviceName||null,
          platform:identity&&identity.platform||global.navigator&&global.navigator.platform||null
        }),
        conferenceReference:{localConferenceId:localId,remoteConferenceId:remoteId||null},
        localConferenceSnapshot:sanitize(copy(conference)),
        indexedDbConferenceSnapshot:sanitize(copy(storedConference)),
        conferenceLink:sanitize(copy(link)),
        syncContext:sanitize(copy(syncContext)),
        diagnostics:sanitize(diagnostics),
        persistentLinkStatusWriteTrace:sanitize(
          diagnostics&&diagnostics.persistentLinkStatusWriteTrace||[]
        ),
        stores:stores,
        readErrors:readErrors,
        snapshotHashes:[]
      };
      return buildHashes(bundle).then(function(hashes){
        bundle.snapshotHashes=hashes;
        return bundle;
      });
    });
  }

  function safeFilePart(value){
    return String(value||'device').toLowerCase()
      .replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24)||'device';
  }

  function fileName(bundle){
    var device=bundle&&bundle.device||{};
    var id=String(device.id||'');
    var label=safeFilePart(device.deviceName||device.platform||'device');
    var suffix=id?safeFilePart(id.slice(0,4)+id.slice(-4)):'unknown';
    var date=String(bundle&&bundle.exportedAt||new Date().toISOString())
      .replace(/[:.]/g,'-');
    return 'conference-rescue_'+label+'_'+suffix+'_'+date+'.json';
  }

  function download(bundle,options){
    options=options||{};
    var documentApi=options.document||global.document;
    var urlApi=options.URL||global.URL;
    if(!documentApi||!urlApi||typeof global.Blob!=='function'){
      throw new Error('DOWNLOAD_API_UNAVAILABLE');
    }
    var blob=new global.Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});
    var url=urlApi.createObjectURL(blob);
    var anchor=documentApi.createElement('a');
    anchor.href=url;
    anchor.download=fileName(bundle);
    anchor.rel='noopener';
    anchor.click();
    urlApi.revokeObjectURL(url);
    return anchor.download;
  }

  function exportCurrentConference(options){
    return createBundle(options).then(function(bundle){
      return {bundle:bundle,fileName:download(bundle,options)};
    });
  }

  global.DeviceRescueExport=Object.freeze({
    format:FORMAT,
    stores:STORES,
    createBundle:createBundle,
    download:download,
    exportCurrentConference:exportCurrentConference,
    fileName:fileName
  });
})(window);
