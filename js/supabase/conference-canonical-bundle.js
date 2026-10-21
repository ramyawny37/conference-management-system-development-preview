(function(global){
  'use strict';
  var TYPE='conference-canonical-bundle';
  var VERSION=1;
  var MAX_BYTES=10*1024*1024;

  function invoke(operation,args){
    if(!global.PlatformDeviceSession||typeof global.PlatformDeviceSession.invokeModuleProtected!=='function'){
      return Promise.reject(new Error('DEVICE_SESSION_RUNTIME_REQUIRED'));
    }
    return global.PlatformDeviceSession.invokeModuleProtected('conference',operation,args);
  }
  function uuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function')return global.crypto.randomUUID();
    throw new Error('SECURE_OPERATION_ID_REQUIRED');
  }
  function parse(text){
    if(typeof text!=='string'||new Blob([text]).size>MAX_BYTES)throw new Error('CONFERENCE_BUNDLE_TOO_LARGE');
    var value=JSON.parse(text);
    if(!value||value.type!==TYPE||value.schemaVersion!==VERSION)throw new Error('CONFERENCE_BUNDLE_SCHEMA_UNSUPPORTED');
    return value;
  }
  function exportBundle(conferenceId){
    return invoke('export_conference_canonical_bundle',{p_conference_id:String(conferenceId||'')});
  }
  function download(conferenceId){
    return exportBundle(conferenceId).then(function(bundle){
      var name=String(bundle&&bundle.data&&bundle.data.conference&&bundle.data.conference.name||'conference').replace(/[^A-Za-z0-9\u0600-\u06ff_-]+/g,'_');
      var anchor=document.createElement('a');
      anchor.href=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json;charset=utf-8'}));
      anchor.download=name+'_canonical_bundle.json';
      anchor.click();
      setTimeout(function(){URL.revokeObjectURL(anchor.href);},0);
      return bundle;
    });
  }
  function validate(bundle,options){
    options=options||{};
    return invoke('validate_conference_canonical_bundle',{
      p_bundle:bundle,p_mode:options.mode||'new',
      p_target_conference_id:options.targetConferenceId||'',
      p_expected_revision:options.expectedRevision==null?'':options.expectedRevision
    });
  }
  function restore(bundle,options){
    options=options||{};
    return invoke('restore_conference_canonical_bundle',{
      p_operation_id:options.operationId||uuid(),p_bundle:bundle,p_mode:options.mode||'new',
      p_target_conference_id:options.targetConferenceId||'',
      p_expected_revision:options.expectedRevision==null?'':options.expectedRevision,
      p_confirmed:options.confirmed===true
    });
  }
  global.ConferenceCanonicalBundle=Object.freeze({TYPE:TYPE,VERSION:VERSION,MAX_BYTES:MAX_BYTES,parse:parse,exportBundle:exportBundle,download:download,validate:validate,restore:restore});
})(window);
