(function(global){
  'use strict';
  var namespace=global.BrowserStorageNamespace||{
    key:function(name){return name;}
  };
  var KEY=namespace.key(
    'conference_manager_remote_update_markers'
  );
  var MAX_RECORDS_PER_CONFERENCE=10;
  var MAX_CONFERENCES=50;
  var STATUSES=[
    'unreviewed','reviewed_equal','reviewed_changed',
    'needs_resolution','self_update','dismissed'
  ];
  var lastError=null;
  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }
  function plain(value){
    return !!value&&
      Object.prototype.toString.call(value)==='[object Object]';
  }
  function validDate(value){
    return typeof value==='string'&&value.trim()!==''&&
      !Number.isNaN(Date.parse(value));
  }
  function validRecord(record,conferenceId){
    return plain(record)&&
      record.remoteConferenceId===conferenceId&&
      isUuid(record.remoteConferenceId)&&
      Number.isInteger(record.revision)&&record.revision>=0&&
      isUuid(record.sourceDeviceId)&&
      validDate(record.receivedAt)&&
      STATUSES.indexOf(record.status)>=0;
  }
  function storage(options){
    if(options&&options.storage)return options.storage;
    try{return global.localStorage||null;}catch(error){return null;}
  }
  function failure(status){
    lastError={code:String(status||'storage_error')};
    return {ok:false,status:lastError.code,data:null};
  }
  function read(options){
    var target=storage(options),raw;
    if(!target||typeof target.getItem!=='function'){
      return failure('storage_unavailable');
    }
    try{raw=target.getItem(KEY);}
    catch(error){return failure('storage_read_failed');}
    if(raw===null){
      lastError=null;
      return {ok:true,status:'empty',data:{}};
    }
    var value;
    try{value=JSON.parse(raw);}
    catch(error){return failure('storage_corrupt_json');}
    if(!plain(value))return failure('storage_corrupt_root');
    var keys=Object.keys(value);
    for(var index=0;index<keys.length;index++){
      var id=keys[index],records=value[id];
      if(!isUuid(id)||!Array.isArray(records)||
        records.length>MAX_RECORDS_PER_CONFERENCE||
        !records.every(function(record){return validRecord(record,id);})){
        return failure('storage_corrupt_record');
      }
    }
    lastError=null;
    return {ok:true,status:'read',data:value};
  }
  function write(value,options){
    var target=storage(options);
    if(!target||typeof target.setItem!=='function'){
      return failure('storage_unavailable');
    }
    try{
      target.setItem(KEY,JSON.stringify(value));
      var verified=read(options);
      if(!verified.ok||
        JSON.stringify(verified.data)!==JSON.stringify(value)){
        return failure('storage_verify_failed');
      }
      return {ok:true,status:'saved',data:value};
    }catch(error){return failure('storage_write_failed');}
  }
  function eventKey(record){
    return record.remoteConferenceId+'|'+record.revision+'|'+
      record.sourceDeviceId;
  }
  function trimConferenceRoots(root){
    var ids=Object.keys(root);
    if(ids.length<=MAX_CONFERENCES)return;
    ids.sort(function(first,second){
      var firstTime=Date.parse(root[first][0].receivedAt);
      var secondTime=Date.parse(root[second][0].receivedAt);
      return secondTime-firstTime;
    });
    ids.slice(MAX_CONFERENCES).forEach(function(id){delete root[id];});
  }
  function add(input,options){
    input=input||{};
    var record={
      remoteConferenceId:String(input.remoteConferenceId||''),
      revision:input.revision,
      sourceDeviceId:String(input.sourceDeviceId||''),
      receivedAt:input.receivedAt||new Date().toISOString(),
      status:input.status
    };
    if(!validRecord(record,record.remoteConferenceId)){
      return {ok:false,status:'invalid',data:null};
    }
    var readResult=read(options);
    if(!readResult.ok)return readResult;
    var all=readResult.data,id=record.remoteConferenceId;
    var list=all[id]||[];
    var key=eventKey(record);
    var existing=list.find(function(item){return eventKey(item)===key;});
    if(existing){
      return {
        ok:true,status:'duplicate',duplicate:true,data:copy(existing)
      };
    }
    all[id]=[record].concat(list).sort(function(first,second){
      return Date.parse(second.receivedAt)-Date.parse(first.receivedAt);
    }).slice(0,MAX_RECORDS_PER_CONFERENCE);
    trimConferenceRoots(all);
    var saved=write(all,options);
    return saved.ok
      ?{ok:true,status:'saved',duplicate:false,data:copy(record)}
      :saved;
  }
  function list(remoteConferenceId,options){
    var readResult=read(options);
    if(!readResult.ok){
      var empty=[];
      empty.readError=readResult.status;
      return empty;
    }
    return copy(readResult.data[String(remoteConferenceId||'')]||[]);
  }
  function update(remoteConferenceId,receivedAt,status,options){
    if(STATUSES.indexOf(status)<0||!isUuid(String(remoteConferenceId||''))||
      !validDate(receivedAt)){
      return {ok:false,status:'invalid'};
    }
    var readResult=read(options);
    if(!readResult.ok)return readResult;
    var all=readResult.data,id=String(remoteConferenceId);
    var marker=(all[id]||[]).find(function(item){
      return item.receivedAt===receivedAt;
    });
    if(!marker)return {ok:false,status:'not_found'};
    marker.status=status;
    var saved=write(all,options);
    return saved.ok
      ?{ok:true,status:status,data:copy(marker)}
      :saved;
  }
  function inspect(options){
    var result=read(options);
    return result.ok
      ?{ok:true,status:result.status,data:copy(result.data)}
      :result;
  }
  function getState(){
    return {
      storageKey:KEY,
      maxRecordsPerConference:MAX_RECORDS_PER_CONFERENCE,
      maxConferences:MAX_CONFERENCES,
      lastError:lastError?copy(lastError):null
    };
  }
  global.RemoteUpdateStore=Object.freeze({
    statuses:Object.freeze(STATUSES.slice()),
    storageKey:KEY,
    add:add,list:list,update:update,inspect:inspect,getState:getState
  });
})(window);
