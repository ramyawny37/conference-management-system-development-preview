(function(global){
  'use strict';
  var KEY='conference_manager_remote_update_markers';
  var STATUSES=[
    'unreviewed','reviewed_equal','reviewed_changed',
    'needs_resolution','self_update','dismissed'
  ];
  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function storage(options){
    if(options&&options.storage)return options.storage;
    try{return global.localStorage||null;}catch(error){return null;}
  }
  function read(options){
    try{return JSON.parse(storage(options).getItem(KEY)||'{}');}
    catch(error){return {};}
  }
  function write(value,options){
    try{storage(options).setItem(KEY,JSON.stringify(value));return true;}
    catch(error){return false;}
  }
  function add(input,options){
    input=input||{};
    if(!input.remoteConferenceId||STATUSES.indexOf(input.status)<0){
      return {ok:false,status:'invalid'};
    }
    var all=read(options), id=String(input.remoteConferenceId);
    var list=all[id]||[];
    var marker={
      remoteConferenceId:id,
      revision:Number.isInteger(input.revision)?input.revision:null,
      sourceDeviceId:String(input.sourceDeviceId||'')||null,
      receivedAt:input.receivedAt||new Date().toISOString(),
      status:input.status
    };
    var same=list.findIndex(function(item){
      return item.revision===marker.revision&&
        item.sourceDeviceId===marker.sourceDeviceId;
    });
    if(same>=0)list.splice(same,1);
    all[id]=[marker].concat(list).slice(0,10);
    return write(all,options)
      ?{ok:true,status:'saved',data:copy(marker)}
      :{ok:false,status:'storage_error'};
  }
  function list(remoteConferenceId,options){
    return copy(read(options)[String(remoteConferenceId||'')]||[]);
  }
  function update(remoteConferenceId,receivedAt,status,options){
    if(STATUSES.indexOf(status)<0)return {ok:false,status:'invalid'};
    var all=read(options), id=String(remoteConferenceId||'');
    var marker=(all[id]||[]).find(function(item){
      return item.receivedAt===receivedAt;
    });
    if(!marker)return {ok:false,status:'not_found'};
    marker.status=status;
    return write(all,options)
      ?{ok:true,status:status,data:copy(marker)}
      :{ok:false,status:'storage_error'};
  }
  global.RemoteUpdateStore=Object.freeze({
    statuses:Object.freeze(STATUSES.slice()),add:add,list:list,update:update
  });
})(window);
