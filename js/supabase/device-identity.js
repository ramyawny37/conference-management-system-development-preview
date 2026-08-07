(function(global){
  'use strict';

  var namespace=global.BrowserStorageNamespace||{
    key:function(name){return name;}
  };
  var STORAGE_KEY=namespace.key(
    'conference_manager_device_identity'
  );
  var memoryIdentity=null;

  function createUuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return global.crypto.randomUUID();
    }
    if(global.crypto&&typeof global.crypto.getRandomValues==='function'){
      var bytes=new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      bytes[6]=(bytes[6]&15)|64;
      bytes[8]=(bytes[8]&63)|128;
      return Array.prototype.map.call(bytes,function(byte,index){
        var value=byte.toString(16).padStart(2,'0');
        return index===4||index===6||index===8||index===10?'-'+value:value;
      }).join('');
    }
    throw new Error('SECURE_DEVICE_UUID_UNAVAILABLE');
  }

  function isValidIdentity(identity){
    return !!(identity&&typeof identity==='object'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(String(identity.id||'')));
  }

  function createIdentity(options){
    options=options&&typeof options==='object'?options:{};
    return {
      id:createUuid(),
      deviceName:String(options.deviceName||'').trim(),
      platform:String(
        options.platform||
        (global.navigator&&global.navigator.platform)||
        ''
      ).trim(),
      createdAt:new Date().toISOString()
    };
  }

  function getStorage(options){
    if(options&&options.storage)return options.storage;
    try{
      return global.localStorage||null;
    }catch(error){
      return null;
    }
  }

  function getOrCreate(options){
    if(memoryIdentity)return memoryIdentity;
    var storage=getStorage(options);
    if(storage){
      try{
        var stored=JSON.parse(storage.getItem(STORAGE_KEY)||'null');
        if(isValidIdentity(stored)){
          memoryIdentity=stored;
          return memoryIdentity;
        }
      }catch(error){}
    }

    memoryIdentity=createIdentity(options);
    if(storage){
      try{
        storage.setItem(STORAGE_KEY,JSON.stringify(memoryIdentity));
      }catch(error){}
    }
    return memoryIdentity;
  }

  function getCurrent(){
    return memoryIdentity;
  }

  function setDeviceName(deviceName,options){
    var identity=getOrCreate(options);
    memoryIdentity={
      id:identity.id,
      deviceName:String(deviceName||'').trim().slice(0,80),
      platform:identity.platform,
      createdAt:identity.createdAt
    };
    var storage=getStorage(options);
    if(storage){
      try{
        storage.setItem(STORAGE_KEY,JSON.stringify(memoryIdentity));
      }catch(error){
        return {success:false,reason:'DEVICE_IDENTITY_STORAGE_FAILED'};
      }
    }
    return {success:true,identity:memoryIdentity};
  }

  global.SupabaseDeviceIdentity=Object.freeze({
    getOrCreate:getOrCreate,
    getCurrent:getCurrent,
    setDeviceName:setDeviceName
  });
})(window);
