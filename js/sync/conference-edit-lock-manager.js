(function(global){
  'use strict';
  var TTL_SECONDS=120,HEARTBEAT_MS=40000,timer=null,generation=0;
  var acquirePromise=null,baseline=null,resetAuthorization=null;
  var state={localConferenceId:null,remoteConferenceId:null,status:'inactive',lock:null,error:null};
  function copy(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function currentFrom(data,id){return data&&Array.isArray(data.conferences)?data.conferences.find(function(c){return c&&String(c.id)===String(id);})||null:null;}
  function capture(data,id){baseline=copy(currentFrom(data||global.appData,id||state.localConferenceId));}
  function same(a,b){try{return JSON.stringify(a)===JSON.stringify(b);}catch(error){return false;}}
  function notify(){
    if(global.document&&global.document.body){
      var readOnly=['read_only','lost','acquiring','releasing'].indexOf(state.status)>=0;
      global.document.body.classList.toggle('conference-read-only',readOnly);
      var banner=global.document.getElementById('conferenceEditLockBanner');
      if(!banner){banner=global.document.createElement('div');banner.id='conferenceEditLockBanner';banner.className='conference-edit-lock-banner';banner.textContent='يتم تعديل المؤتمر حاليًا من جهاز آخر';global.document.body.appendChild(banner);}
      banner.style.display=['read_only','lost'].indexOf(state.status)>=0?'block':'none';
    }
  }
  function clearTimer(){if(timer!==null)global.clearInterval(timer);timer=null;}
  function valid(){return state.status==='owned'&&state.lock&&state.lock.owned===true&&Date.parse(state.lock.expiresAt||'')>Date.now();}
  function applyResult(result,token){
    if(token!==generation)return Object.assign({},result,{status:'stale_ignored'});
    var data=result&&result.data||null;state.lock=copy(data);state.error=result&&result.error||null;
    state.status=result&&result.ok&&data&&data.owned&&Date.parse(data.expiresAt||'')>Date.now()?'owned':'read_only';
    if(valid()&&timer===null)timer=global.setInterval(renew,HEARTBEAT_MS);notify();return result;
  }
  function renew(){
    if(!state.remoteConferenceId||!valid())return Promise.resolve({ok:false,status:'not_owned'});
    var token=generation,remote=state.remoteConferenceId;
    return global.ConferenceLocks.renewLock(remote,{ttlSeconds:TTL_SECONDS}).then(function(result){
      if(token!==generation)return Object.assign({},result,{status:'stale_ignored'});
      if(!result||!result.ok||!result.data||!result.data.owned){state.status='lost';state.error=result&&result.error||null;clearTimer();notify();return result;}
      return applyResult(result,token);
    }).catch(function(error){if(token===generation){state.status='lost';state.error=error;clearTimer();notify();}return {ok:false,status:'error',error:error};});
  }
  function begin(localConferenceId){
    localConferenceId=String(localConferenceId||'');
    if(valid()&&state.localConferenceId===localConferenceId){
      return Promise.resolve({ok:true,status:'already_owned',data:copy(state.lock)});
    }
    if(acquirePromise&&state.localConferenceId===localConferenceId)return acquirePromise;
    clearTimer();var token=++generation;
    var link=global.ConferenceLinkStore&&global.ConferenceLinkStore.get(localConferenceId);
    state={localConferenceId:localConferenceId,remoteConferenceId:link&&link.remoteConferenceId||null,status:'inactive',lock:null,error:null};capture(global.appData,localConferenceId);
    if(!link||['linked','cloud_linked'].indexOf(link.linkStatus)<0){notify();return Promise.resolve({ok:true,status:'local_only'});}
    if(!global.navigator||global.navigator.onLine===false){state.status='read_only';state.error={code:'OFFLINE_LOCK_REQUIRED'};notify();return Promise.resolve({ok:false,status:'offline'});}
    state.status='acquiring';notify();
    acquirePromise=Promise.resolve(global.ConferenceLocks.acquireLock(link.remoteConferenceId,{ttlSeconds:TTL_SECONDS}))
      .then(function(result){return applyResult(result,token);})
      .catch(function(error){if(token===generation){state.status='read_only';state.error=error;notify();}return {ok:false,status:'error',error:error};})
      .then(function(result){if(token===generation)acquirePromise=null;return result;});
    return acquirePromise;
  }
  function release(){
    clearTimer();var oldAcquire=acquirePromise,remote=state.remoteConferenceId;generation++;
    state.status='releasing';notify();acquirePromise=null;
    return Promise.resolve(oldAcquire).catch(function(){return null;}).then(function(){
      var owned=remote&&global.ConferenceLocks&&global.ConferenceLocks.getOwnedLock(remote);
      if(!owned)return {ok:true,status:'not_owned'};
      return global.ConferenceLocks.releaseLock(remote).catch(function(error){return {ok:false,status:'error',error:error};});
    }).then(function(result){state={localConferenceId:null,remoteConferenceId:null,status:'inactive',lock:null,error:result&&result.ok===false?result.error:null};baseline=null;notify();return result;});
  }
  function authorizeReset(localId){resetAuthorization={localId:String(localId||''),token:{}};return resetAuthorization.token;}
  function consumeReset(options){var ok=resetAuthorization&&options&&options.lockAuthorization===resetAuthorization.token;resetAuthorization=null;return !!ok;}
  function restore(data,id){if(!baseline||!data||!Array.isArray(data.conferences))return;data.conferences=data.conferences.map(function(c){return c&&String(c.id)===String(id)?copy(baseline):c;});}
  function guard(data,options){
    options=options||{};var current=global.getCurrentConference&&global.getCurrentConference();var id=current&&current.id;
    if(consumeReset(options))return {ok:true,status:'reset_authorized'};
    var link=current&&global.ConferenceLinkStore&&global.ConferenceLinkStore.get(id);
    if(!link||['linked','cloud_linked'].indexOf(link.linkStatus)<0)return {ok:true,status:'local_only'};
    if(options.skipConferenceTracking===true&&same(current,baseline))return {ok:true,status:'non_conference_write'};
    if(valid()&&state.localConferenceId===String(id))return {ok:true,status:'owned'};
    restore(data,id);
    if(state.status==='inactive'&&global.navigator&&global.navigator.onLine!==false)begin(id);
    if(state.status==='owned')state.status='lost';notify();
    if(typeof global.showToast==='function')global.showToast('يتم تعديل المؤتمر حاليًا من جهاز آخر','#E67E22');
    return {ok:false,status:global.navigator&&global.navigator.onLine===false?'offline_lock_required':'edit_lock_required'};
  }
  function committed(data){capture(data,state.localConferenceId);}
  function getState(){var r=copy(state);r.canWrite=valid();r.ttlSeconds=TTL_SECONDS;r.heartbeatMs=HEARTBEAT_MS;return r;}
  global.addEventListener&&global.addEventListener('beforeunload',clearTimer);
  global.ConferenceEditLockManager=Object.freeze({ttlSeconds:TTL_SECONDS,heartbeatMs:HEARTBEAT_MS,begin:begin,renew:renew,release:release,transfer:release,guard:guard,committed:committed,authorizeReset:authorizeReset,getState:getState});
})(window);
