(function(global){
  'use strict';

  var namespace=global.BrowserStorageNamespace||{
    key:function(name){return name;}
  };
  var STORAGE_KEY=namespace.key(
    'conference_manager_linking_attempts_v1'
  );

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function storage(options){
    if(options&&options.storage)return options.storage;
    try{return global.localStorage||null;}catch(error){return null;}
  }

  function readAll(options){
    var target=storage(options);
    if(!target)return {};
    try{
      var value=JSON.parse(target.getItem(STORAGE_KEY)||'{}');
      return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    }catch(error){
      return {};
    }
  }

  function get(localConferenceId,options){
    var value=readAll(options)[String(localConferenceId||'')];
    return value?copy(value):null;
  }

  function save(input,options){
    input=input&&typeof input==='object'?input:{};
    var localConferenceId=String(input.localConferenceId||'');
    var operationId=String(input.operationId||'');
    var requestedConferenceId=String(input.requestedConferenceId||'');
    if(!localConferenceId||!operationId||!requestedConferenceId){
      return {ok:false,status:'invalid'};
    }
    var values=readAll(options);
    var previous=values[localConferenceId]||{};
    var now=new Date().toISOString();
    values[localConferenceId]={
      localConferenceId:localConferenceId,
      operationId:operationId,
      requestedConferenceId:requestedConferenceId,
      createdAt:previous.createdAt||String(input.createdAt||now),
      updatedAt:now
    };
    var target=storage(options);
    try{
      target.setItem(STORAGE_KEY,JSON.stringify(values));
      return {ok:true,status:'saved',data:copy(values[localConferenceId])};
    }catch(error){
      return {ok:false,status:'storage_error'};
    }
  }

  function remove(localConferenceId,options){
    var values=readAll(options);
    delete values[String(localConferenceId||'')];
    var target=storage(options);
    try{
      target.setItem(STORAGE_KEY,JSON.stringify(values));
      return {ok:true,status:'removed'};
    }catch(error){
      return {ok:false,status:'storage_error'};
    }
  }

  function reset(options){
    var target=storage(options);
    try{
      if(target)target.removeItem(STORAGE_KEY);
      return {ok:true,status:'reset'};
    }catch(error){
      return {ok:false,status:'storage_error'};
    }
  }

  global.ConferenceLinkingAttemptStore=Object.freeze({
    storageKey:STORAGE_KEY,
    get:get,
    save:save,
    remove:remove,
    reset:reset
  });
})(window);
