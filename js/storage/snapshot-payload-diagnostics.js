(function(global){
  'use strict';

  function safeError(code,message){
    return {code:code,message:message};
  }

  function utf8Size(value){
    if(typeof global.TextEncoder==='function'){
      return new global.TextEncoder().encode(value).byteLength;
    }
    return unescape(encodeURIComponent(value)).length;
  }

  function inspect(snapshot){
    var serialized;
    var normalized;
    try{
      serialized=JSON.stringify(snapshot);
      if(typeof serialized!=='string')throw new Error('NOT_SERIALIZABLE');
      normalized=JSON.parse(serialized);
    }catch(error){
      return {
        ok:false,
        sizeBytes:null,
        snapshot:null,
        error:safeError(
          'SNAPSHOT_SERIALIZATION_FAILED',
          'The snapshot payload could not be serialized.'
        )
      };
    }
    return {
      ok:true,
      sizeBytes:utf8Size(serialized),
      snapshot:normalized,
      error:null
    };
  }

  function isQuotaExceededError(error){
    var current=error;
    var depth=0;
    while(current&&depth<4){
      if(current.name==='QuotaExceededError'||current.code===22||
        current.code===1014){
        return true;
      }
      current=current.cause;
      depth++;
    }
    return false;
  }

  global.SnapshotPayloadDiagnostics=Object.freeze({
    inspect:inspect,
    isQuotaExceededError:isQuotaExceededError
  });
})(window);
