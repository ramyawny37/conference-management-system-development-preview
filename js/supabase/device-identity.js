(function(global){
  'use strict';

  var namespace=global.BrowserStorageNamespace||{key:function(name){return name;}};
  var LEGACY_STORAGE_KEY=namespace.key('conference_manager_device_identity');
  var memoryIdentities={};

  function createUuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function')return global.crypto.randomUUID();
    if(global.crypto&&typeof global.crypto.getRandomValues==='function'){
      var bytes=new Uint8Array(16);global.crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
      return Array.prototype.map.call(bytes,function(byte,index){var value=byte.toString(16).padStart(2,'0');return index===4||index===6||index===8||index===10?'-'+value:value;}).join('');
    }
    throw new Error('SECURE_DEVICE_UUID_UNAVAILABLE');
  }
  function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
  function isValidIdentity(identity){return !!(identity&&typeof identity==='object'&&isUuid(identity.id));}
  function userId(options){
    options=options&&typeof options==='object'?options:{};
    var explicit=String(options.authenticatedUserId||options.userId||'');
    if(isUuid(explicit))return explicit;
    var auth=options.auth||global.SupabaseAuth,session=auth&&auth.getSession&&auth.getSession(),state=auth&&auth.getState&&auth.getState(),value=session&&session.user&&session.user.id||state&&state.user&&state.user.id;
    return isUuid(value)?String(value):'';
  }
  function storageKey(value){return namespace.key('device-identity:'+String(value||''));}
  function createIdentity(options){options=options&&typeof options==='object'?options:{};return {id:createUuid(),deviceName:String(options.deviceName||'').trim(),platform:String(options.platform||(global.navigator&&global.navigator.platform)||'').trim(),createdAt:new Date().toISOString()};}
  function getStorage(options){if(options&&options.storage)return options.storage;try{return global.localStorage||null;}catch(error){return null;}}
  function read(key,options){var storage=getStorage(options);if(!storage)return null;try{var value=JSON.parse(storage.getItem(key)||'null');return isValidIdentity(value)?value:null;}catch(error){return null;}}
  function write(key,identity,options){var storage=getStorage(options);if(!storage)return true;try{storage.setItem(key,JSON.stringify(identity));return true;}catch(error){return false;}}
  function getCurrent(options){var currentUserId=userId(options);return currentUserId?memoryIdentities[currentUserId]||read(storageKey(currentUserId),options):null;}
  function getOrCreate(options){
    options=options&&typeof options==='object'?options:{};var currentUserId=userId(options);
    if(!currentUserId)return null;
    var platformIdentity=global.PlatformIntegration&&
      typeof global.PlatformIntegration.getDeviceIdentity==='function'
      ?global.PlatformIntegration.getDeviceIdentity():null;
    if(isValidIdentity(platformIdentity))return platformIdentity;
    if(memoryIdentities[currentUserId])return memoryIdentities[currentUserId];
    var existing=read(storageKey(currentUserId),options);
    if(existing){memoryIdentities[currentUserId]=existing;return existing;}
    if(read(LEGACY_STORAGE_KEY,options)&&options.legacyOwnershipResolved!==true)return null;
    var identity=createIdentity(options);memoryIdentities[currentUserId]=identity;write(storageKey(currentUserId),identity,options);return identity;
  }
  function getLegacyCandidate(options){return read(LEGACY_STORAGE_KEY,options);}
  function adoptLegacyForCurrentUser(identity,options){
    options=options&&typeof options==='object'?options:{};var currentUserId=userId(options);
    if(!currentUserId||!isValidIdentity(identity))return {success:false,reason:'DEVICE_IDENTITY_ADOPTION_INVALID'};
    var existing=read(storageKey(currentUserId),options);
    if(existing){memoryIdentities[currentUserId]=existing;return {success:true,identity:existing,status:'preserved'};}
    memoryIdentities[currentUserId]=identity;
    return write(storageKey(currentUserId),identity,options)?{success:true,identity:identity,status:'adopted'}:{success:false,reason:'DEVICE_IDENTITY_STORAGE_FAILED'};
  }
  function reconcileProvedIdentity(identity,options){
    options=options&&typeof options==='object'?options:{};var currentUserId=userId(options);
    if(!currentUserId||!isValidIdentity(identity))return {success:false,reason:'DEVICE_IDENTITY_RECONCILIATION_INVALID'};
    var existing=memoryIdentities[currentUserId]||read(storageKey(currentUserId),options),next={
      id:String(identity.id),
      deviceName:String(existing&&existing.deviceName||identity.deviceName||'').trim(),
      platform:String(existing&&existing.platform||identity.platform||(global.navigator&&global.navigator.platform)||'').trim(),
      createdAt:String(existing&&existing.createdAt||identity.createdAt||new Date().toISOString())
    };
    if(!write(storageKey(currentUserId),next,options))return {success:false,reason:'DEVICE_IDENTITY_STORAGE_FAILED'};
    memoryIdentities[currentUserId]=next;
    return {success:true,identity:next,status:existing&&existing.id===next.id?'unchanged':'reconciled'};
  }
  function setDeviceName(deviceName,options){
    options=options&&typeof options==='object'?options:{};var currentUserId=userId(options),identity=getOrCreate(options);
    if(!currentUserId||!identity)return {success:false,reason:'AUTH_REQUIRED'};
    memoryIdentities[currentUserId]={id:identity.id,deviceName:String(deviceName||'').trim().slice(0,80),platform:identity.platform,createdAt:identity.createdAt};
    return write(storageKey(currentUserId),memoryIdentities[currentUserId],options)?{success:true,identity:memoryIdentities[currentUserId]}:{success:false,reason:'DEVICE_IDENTITY_STORAGE_FAILED'};
  }

  global.SupabaseDeviceIdentity=Object.freeze({getOrCreate:getOrCreate,getCurrent:getCurrent,setDeviceName:setDeviceName,getLegacyCandidate:getLegacyCandidate,adoptLegacyForCurrentUser:adoptLegacyForCurrentUser,reconcileProvedIdentity:reconcileProvedIdentity,getStorageKeyForUser:storageKey});
})(window);
