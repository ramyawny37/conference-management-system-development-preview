(function(global){
  'use strict';
  var KEY='conference_manager_link_status_diagnostics_v1';
  var SESSION_KEY='conference_manager_link_status_diagnostic_session_v1';
  var LIMIT=50;
  var memoryFallback=[];
  var lastReadError=null;
  var lastWriteError=null;

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function identifier(prefix){
    try{
      if(global.crypto&&typeof global.crypto.randomUUID==='function'){
        return prefix+'-'+global.crypto.randomUUID();
      }
    }catch(error){}
    return prefix+'-'+Date.now()+'-'+Math.random().toString(16).slice(2);
  }
  function localTarget(){
    try{return global.localStorage||null;}catch(error){return null;}
  }
  function sessionTarget(){
    try{return global.sessionStorage||null;}catch(error){return null;}
  }
  function resolveSessionId(){
    var storage=sessionTarget(),value=null;
    try{
      value=storage&&storage.getItem(SESSION_KEY);
      if(!value){
        value=identifier('session');
        if(storage)storage.setItem(SESSION_KEY,value);
      }
    }catch(error){value=identifier('session');}
    return value;
  }
  var sessionId=resolveSessionId();
  var pageLoadId=identifier('page');

  function errorCode(error,fallback){
    return String(error&&error.message||fallback);
  }
  function readPersistent(){
    var storage=localTarget();
    try{
      if(!storage)throw new Error('DIAGNOSTIC_STORAGE_UNAVAILABLE');
      var raw=storage.getItem(KEY);
      if(raw===null||raw===''){
        lastReadError=null;
        return {ok:true,records:[]};
      }
      var records=JSON.parse(raw);
      if(!Array.isArray(records))throw new Error('DIAGNOSTIC_STORAGE_MALFORMED');
      lastReadError=null;
      return {ok:true,records:records.slice(-LIMIT)};
    }catch(error){
      lastReadError=errorCode(error,'DIAGNOSTIC_STORAGE_READ_FAILED');
      return {ok:false,records:[]};
    }
  }
  function sanitize(input){
    input=input||{};
    return {
      eventName:String(input.eventName||''),
      writerName:String(input.writerName||''),
      conferenceId:input.conferenceId||null,
      previousLinkStatus:input.previousLinkStatus||null,
      nextLinkStatus:input.nextLinkStatus||null,
      conflictId:input.conflictId||null,
      conflictStatus:input.conflictStatus||null,
      pendingLocalApplication:input.pendingLocalApplication===true,
      knownRevision:Number.isInteger(input.knownRevision)
        ?input.knownRevision:null,
      incomingRevision:Number.isInteger(input.incomingRevision)
        ?input.incomingRevision:null,
      reason:String(input.reason||'unspecified'),
      trigger:String(input.trigger||'unspecified'),
      stack:Array.isArray(input.stackTrace)
        ?input.stackTrace.slice(0,5):[],
      timestamp:String(input.timestamp||new Date().toISOString()),
      sessionId:sessionId,
      pageLoadId:pageLoadId
    };
  }
  function remember(record){
    memoryFallback.push(record);
    if(memoryFallback.length>LIMIT){
      memoryFallback.splice(0,memoryFallback.length-LIMIT);
    }
  }
  function append(input){
    var record=sanitize(input);
    var read=readPersistent();
    if(!read.ok){
      remember(record);
      return {ok:false,status:'read_failed',data:copy(record)};
    }
    var records=read.records.concat([record]).slice(-LIMIT);
    try{
      var storage=localTarget();
      if(!storage)throw new Error('DIAGNOSTIC_STORAGE_UNAVAILABLE');
      storage.setItem(KEY,JSON.stringify(records));
      lastWriteError=null;
      return {ok:true,status:'stored',data:copy(record)};
    }catch(error){
      lastWriteError=errorCode(error,'DIAGNOSTIC_STORAGE_WRITE_FAILED');
      remember(record);
      return {ok:false,status:'write_failed',data:copy(record)};
    }
  }
  function list(){
    var read=readPersistent();
    var records=read.ok?read.records:[];
    return copy(records.concat(memoryFallback).slice(-LIMIT));
  }
  function clear(){
    try{
      var storage=localTarget();
      if(!storage)throw new Error('DIAGNOSTIC_STORAGE_UNAVAILABLE');
      storage.removeItem(KEY);
      memoryFallback=[];
      lastReadError=null;
      lastWriteError=null;
      return {ok:true,status:'cleared'};
    }catch(error){
      lastWriteError=errorCode(error,'DIAGNOSTIC_STORAGE_CLEAR_FAILED');
      return {ok:false,status:'clear_failed'};
    }
  }
  function getState(){
    var records=list();
    return {
      records:records,
      regressionCount:records.filter(function(record){
        return record.eventName==='LINK_STATUS_REGRESSION_DETECTED';
      }).length,
      latestRegression:records.slice().reverse().find(function(record){
        return record.eventName==='LINK_STATUS_REGRESSION_DETECTED';
      })||null,
      readError:lastReadError,
      writeError:lastWriteError,
      sessionId:sessionId,
      pageLoadId:pageLoadId
    };
  }

  global.LinkStatusDiagnosticStore=Object.freeze({
    storageKey:KEY,limit:LIMIT,append:append,list:list,clear:clear,
    getState:getState
  });
})(window);
