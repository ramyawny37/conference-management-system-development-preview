(function(global){
  'use strict';

  var CONTRACT_VERSION=1;
  var FINGERPRINT_ALGORITHM='sha256-canonical-json-v1';

  function canonicalize(value){
    if(value===null)return 'null';
    if(Array.isArray(value)){
      return '['+value.map(function(item){return canonicalize(item);}).join(',')+']';
    }
    if(typeof value==='object'){
      return '{'+Object.keys(value).sort().map(function(key){
        return JSON.stringify(key)+':'+canonicalize(value[key]);
      }).join(',')+'}';
    }
    return JSON.stringify(value);
  }

  function bytesToHex(buffer){
    return Array.prototype.map.call(new Uint8Array(buffer),function(byte){
      return byte.toString(16).padStart(2,'0');
    }).join('');
  }

  function fingerprint(payload){
    if(!global.crypto||!global.crypto.subtle||
      typeof global.crypto.subtle.digest!=='function'||
      typeof global.TextEncoder!=='function'){
      return Promise.reject(Object.assign(
        new Error('SHA-256 fingerprinting is unavailable.'),
        {code:'LOCAL_PERSISTENCE_FINGERPRINT_UNAVAILABLE'}
      ));
    }
    var encoded=new global.TextEncoder().encode(canonicalize(payload));
    return global.crypto.subtle.digest('SHA-256',encoded).then(bytesToHex);
  }

  function metadataKey(storageKey){
    var namespace=global.BrowserStorageNamespace;
    var base=String(storageKey||global.SK||'app_data')+
      ':local_persistence_metadata_v1';
    if(namespace&&typeof namespace.key==='function'){
      return namespace.key(base);
    }
    var environment=namespace&&namespace.environment
      ?String(namespace.environment):'default';
    return environment+':'+base;
  }

  function validPayload(value){
    return !!(value&&typeof value==='object'&&!Array.isArray(value)&&
      Array.isArray(value.conferences)&&
      Object.prototype.hasOwnProperty.call(value,'currentConferenceId'));
  }

  function normalizeLocalPayload(parsed){
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&parsed.appData){
      return parsed.appData;
    }
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
      !Array.isArray(parsed.conferences)&&
      typeof global.buildAppDataFromLegacy==='function'){
      parsed=global.buildAppDataFromLegacy(parsed);
    }
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
      Array.isArray(parsed.conferences)&&
      !Object.prototype.hasOwnProperty.call(parsed,'currentConferenceId')){
      parsed=Object.assign({},parsed,{currentConferenceId:null});
    }
    return parsed;
  }

  function verifyMetadata(payload,metadata){
    if(!metadata||typeof metadata!=='object'||
      metadata.contractVersion!==CONTRACT_VERSION||
      metadata.fingerprintAlgorithm!==FINGERPRINT_ALGORITHM||
      !Number.isSafeInteger(metadata.generation)||metadata.generation<1||
      !/^[a-f0-9]{64}$/.test(String(metadata.fingerprint||''))){
      return Promise.resolve({trusted:false,reason:'METADATA_INVALID'});
    }
    return fingerprint(payload).then(function(actual){
      return actual===metadata.fingerprint
        ?{trusted:true,metadata:metadata,fingerprint:actual}
        :{trusted:false,reason:'METADATA_FINGERPRINT_MISMATCH',fingerprint:actual};
    });
  }

  function classifyPayload(source,payload,metadata,validator){
    var valid=validator?validator(payload):validPayload(payload);
    if(!valid)return Promise.resolve({source:source,state:'CORRUPT',payload:null});
    return verifyMetadata(payload,metadata).then(function(verification){
      return {
        source:source,
        state:verification.trusted?'VALID_TRUSTED':'VALID_UNTRUSTED',
        payload:payload,
        metadata:verification.trusted?metadata:null,
        metadataReason:verification.reason||null,
        fingerprint:verification.fingerprint||null
      };
    });
  }

  function readIndexedDB(api){
    if(!api||typeof api.getAppSnapshot!=='function'){
      return Promise.resolve({source:'indexeddb',state:'UNREADABLE',error:'INDEXEDDB_UNAVAILABLE'});
    }
    return Promise.resolve().then(function(){return api.getAppSnapshot();})
      .then(function(record){
        if(!record)return {source:'indexeddb',state:'MISSING'};
        var validation=typeof api.validateAppSnapshot==='function'
          ?api.validateAppSnapshot(record):{valid:validPayload(record.data)};
        if(!validation.valid)return {source:'indexeddb',state:'CORRUPT',record:record};
        return classifyPayload('indexeddb',record.data,
          record.persistenceMetadata,validPayload).then(function(result){
            result.record=record;
            return result;
          });
      }).catch(function(error){
        return {source:'indexeddb',state:'UNREADABLE',error:error};
      });
  }

  function readLocal(storage,storageKey){
    if(!storage||typeof storage.getItem!=='function'){
      return Promise.resolve({source:'localStorage',state:'UNREADABLE',error:'LOCALSTORAGE_UNAVAILABLE'});
    }
    try{
      var raw=storage.getItem(storageKey);
      var rawMetadata=storage.getItem(metadataKey(storageKey));
      if(!raw)return Promise.resolve({source:'localStorage',state:'MISSING'});
      var payload=normalizeLocalPayload(JSON.parse(raw));
      var metadata=rawMetadata?JSON.parse(rawMetadata):null;
      return classifyPayload('localStorage',payload,metadata,validPayload);
    }catch(error){
      if(error&&error.name==='SyntaxError'){
        return Promise.resolve({source:'localStorage',state:'CORRUPT',error:error});
      }
      return Promise.resolve({source:'localStorage',state:'UNREADABLE',error:error});
    }
  }

  function ambiguous(first,second,reason){
    return {ok:false,status:'ambiguous',code:'LOCAL_PERSISTENCE_AMBIGUOUS',
      reason:reason,candidates:[first,second]};
  }

  function arbitrate(first,second){
    var valid=function(item){return item.state==='VALID_TRUSTED'||item.state==='VALID_UNTRUSTED';};
    if(first.state==='UNREADABLE'||second.state==='UNREADABLE'){
      return {ok:false,status:'unreadable',code:'LOCAL_PERSISTENCE_UNREADABLE',candidates:[first,second]};
    }
    if(!valid(first)&&!valid(second)){
      if(first.state==='MISSING'&&second.state==='MISSING')return {ok:true,status:'empty',selected:null,candidates:[first,second]};
      return {ok:false,status:'recovery_required',code:'LOCAL_PERSISTENCE_NO_VALID_CANDIDATE',candidates:[first,second]};
    }
    if(valid(first)&&!valid(second))return {ok:true,status:second.state==='CORRUPT'?'degraded':'selected',selected:first,candidates:[first,second]};
    if(valid(second)&&!valid(first))return {ok:true,status:first.state==='CORRUPT'?'degraded':'selected',selected:second,candidates:[first,second]};
    return Promise.all([
      first.fingerprint?Promise.resolve(first.fingerprint):fingerprint(first.payload),
      second.fingerprint?Promise.resolve(second.fingerprint):fingerprint(second.payload)
    ]).then(function(values){
      first.fingerprint=values[0];second.fingerprint=values[1];
      if(values[0]===values[1]){
        var selected=first.state==='VALID_TRUSTED'&&second.state!=='VALID_TRUSTED'
          ?first:second.state==='VALID_TRUSTED'&&first.state!=='VALID_TRUSTED'
            ?second:first;
        return {ok:true,status:'identical',selected:selected,candidates:[first,second]};
      }
      if(first.state==='VALID_TRUSTED'&&second.state==='VALID_TRUSTED'){
        var firstGeneration=first.metadata.generation;
        var secondGeneration=second.metadata.generation;
        if(firstGeneration!==secondGeneration){
          return {ok:true,status:'selected',selected:firstGeneration>secondGeneration?first:second,candidates:[first,second]};
        }
        return ambiguous(first,second,'EQUAL_GENERATION_DIVERGENCE');
      }
      return ambiguous(first,second,'UNTRUSTED_DIVERGENCE');
    });
  }

  function inspect(options){
    options=options||{};
    return Promise.all([
      readIndexedDB(options.indexedDB||global.AppIndexedDB),
      readLocal(options.localStorage||global.localStorage,options.storageKey||global.SK)
    ]).then(function(candidates){return arbitrate(candidates[0],candidates[1]);});
  }

  function createMetadata(payload,generation){
    return fingerprint(payload).then(function(value){
      return {
        contractVersion:CONTRACT_VERSION,
        generation:generation,
        fingerprintAlgorithm:FINGERPRINT_ALGORITHM,
        fingerprint:value,
        writeId:global.crypto&&typeof global.crypto.randomUUID==='function'
          ?global.crypto.randomUUID():value.slice(0,32),
        writtenAt:new Date().toISOString(),
        payloadSchemaVersion:payload&&payload.version?payload.version:''
      };
    });
  }

  global.LocalPersistenceArbitration=Object.freeze({
    inspect:inspect,
    arbitrate:arbitrate,
    fingerprint:fingerprint,
    verifyMetadata:verifyMetadata,
    createMetadata:createMetadata,
    metadataKey:metadataKey,
    constants:Object.freeze({contractVersion:CONTRACT_VERSION,
      fingerprintAlgorithm:FINGERPRINT_ALGORITHM})
  });
})(window);
