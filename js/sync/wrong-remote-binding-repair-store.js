(function(global){
  'use strict';

  var namespace=global.BrowserStorageNamespace||{
    key:function(name){return name;}
  };
  var STORAGE_KEY=namespace.key(
    'conference_manager_wrong_remote_binding_repair_v1'
  );

  function clone(value){
    return JSON.parse(JSON.stringify(value));
  }

  function storage(options){
    return options&&options.storage||global.localStorage;
  }

  function write(value,options){
    try{
      storage(options).setItem(STORAGE_KEY,JSON.stringify(value));
      return {ok:true,data:clone(value)};
    }catch(error){
      return {ok:false,status:'storage_failed'};
    }
  }

  function create(input,options){
    input=input||{};
    if(!input.appData||!input.links||!input.localConferenceId){
      return {ok:false,status:'invalid_backup'};
    }
    return write({
      version:1,
      status:'prepared',
      createdAt:new Date().toISOString(),
      appData:clone(input.appData),
      links:clone(input.links),
      context:clone(input.context||null),
      manualRelink:clone(input.manualRelink||[]),
      localConferenceId:String(input.localConferenceId),
      oldLink:clone(input.oldLink||null)
    },options);
  }

  function read(options){
    try{
      var raw=storage(options).getItem(STORAGE_KEY);
      var value=raw&&JSON.parse(raw);
      return value&&value.version===1
        ?{ok:true,data:clone(value)}
        :{ok:false,status:'not_found'};
    }catch(error){
      return {ok:false,status:'unreadable'};
    }
  }

  function mark(status,options){
    var found=read(options);
    if(!found.ok)return found;
    found.data.status=status;
    return write(found.data,options);
  }

  function clearActive(options){
    return mark('completed',options);
  }

  var api=Object.freeze({
    create:create,
    read:read,
    mark:mark,
    clearActive:clearActive
  });
  global.WrongRemoteBindingRepairStore=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
