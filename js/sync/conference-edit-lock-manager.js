(function(global){
  'use strict';
  var SECTION='accommodation',TTL_SECONDS=120,HEARTBEAT_MS=40000;
  var timer=null,generation=0,acquirePromise=null;
  var state={localConferenceId:null,remoteConferenceId:null,section:SECTION,status:'viewing',lock:null,error:null,lastAcquireResult:null,lastRenewResult:null,lastReleaseResult:null};
  function copy(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function currentId(){var current=global.getCurrentConference&&global.getCurrentConference();return current&&String(current.id||'')||'';}
  function linked(localId){var link=global.ConferenceLinkStore&&global.ConferenceLinkStore.get(localId);return link&&['linked','cloud_linked'].indexOf(link.linkStatus)>=0?link:null;}
  function valid(){return state.status==='editing'&&state.lock&&state.lock.owned===true&&Date.parse(state.lock.expiresAt||'')>Date.now();}
  function clearTimer(){if(timer!==null)global.clearInterval(timer);timer=null;}
  function rerender(){if(typeof global.renderAccommodation==='function')global.renderAccommodation();}
  function notify(message,color){if(message&&typeof global.showToast==='function')global.showToast(message,color||'#E67E22');rerender();}
  function stale(result){return Object.assign({},result||{},{status:'stale_ignored'});}
  function applyOwned(result,token){
    if(token!==generation||currentId()!==state.localConferenceId)return stale(result);
    var data=result&&result.data||null;
    state.lock=copy(data);state.error=result&&result.error||null;
    if(result&&result.ok&&data&&data.owned&&Date.parse(data.expiresAt||'')>Date.now()){
      state.status='editing';
      if(timer===null)timer=global.setInterval(renew,HEARTBEAT_MS);
    }else state.status='viewing';
    rerender();return result;
  }
  function beginAccommodationEdit(){
    var localId=currentId();
    if(!localId)return Promise.resolve({ok:false,status:'no_current_conference'});
    if(valid()&&state.localConferenceId===localId)return Promise.resolve({ok:true,status:'already_owned',data:copy(state.lock)});
    if(acquirePromise&&state.localConferenceId===localId)return acquirePromise;
    clearTimer();var token=++generation,link=linked(localId);
    state={localConferenceId:localId,remoteConferenceId:link&&link.remoteConferenceId||null,section:SECTION,status:'acquiring',lock:null,error:null,lastAcquireResult:null,lastRenewResult:null,lastReleaseResult:state.lastReleaseResult};
    if(!link){state.status='viewing';notify('يجب ربط المؤتمر بالسحابة قبل بدء تعديل التسكين.');return Promise.resolve({ok:false,status:'link_required'});}
    if(!global.navigator||global.navigator.onLine===false){state.status='viewing';state.error={code:'OFFLINE_LOCK_REQUIRED'};notify('لا يمكن بدء تعديل التسكين دون اتصال وقفل صالح.');return Promise.resolve({ok:false,status:'offline'});}
    rerender();
    acquirePromise=Promise.resolve(global.ConferenceLocks.acquireLock(link.remoteConferenceId,{section:SECTION,ttlSeconds:TTL_SECONDS})).then(function(result){
      if(token===generation)state.lastAcquireResult=copy(result);
      var applied=applyOwned(result,token);
      if(token===generation&&(!result||!result.ok||!result.data||!result.data.owned))notify('يتم تعديل التسكين حاليًا من جهاز آخر.');
      return applied;
    }).catch(function(error){if(token===generation){state.status='viewing';state.error=error;notify('تعذر الحصول على قفل تعديل التسكين.');}return {ok:false,status:'error',error:error};}).then(function(result){if(token===generation)acquirePromise=null;return result;});
    return acquirePromise;
  }
  function renew(){
    if(!valid())return Promise.resolve({ok:false,status:'not_owned'});
    var token=generation,remote=state.remoteConferenceId;
    return global.ConferenceLocks.renewLock(remote,{section:SECTION,ttlSeconds:TTL_SECONDS}).then(function(result){
      if(token!==generation)return stale(result);
      state.lastRenewResult=copy(result);
      if(!result||!result.ok||!result.data||!result.data.owned){state.status='lost';state.lock=copy(result&&result.data);state.error=result&&result.error||null;clearTimer();notify('فُقد قفل تعديل التسكين. تم إيقاف أي تعديل جديد.','#E74C3C');return result;}
      return applyOwned(result,token);
    }).catch(function(error){if(token===generation){state.status='lost';state.error=error;clearTimer();notify('فُقد الاتصال بقفل تعديل التسكين. تم إيقاف أي تعديل جديد.','#E74C3C');}return {ok:false,status:'error',error:error};});
  }
  function endAccommodationEdit(){
    clearTimer();var oldAcquire=acquirePromise,token=++generation,remote=state.remoteConferenceId;
    acquirePromise=null;
    state.status='viewing';rerender();
    return Promise.resolve(oldAcquire).catch(function(){return null;}).then(function(){
      var owned=remote&&global.ConferenceLocks&&global.ConferenceLocks.getOwnedLock(remote,SECTION);
      if(!owned)return {ok:true,status:'not_owned'};
      return global.ConferenceLocks.releaseLock(remote,{section:SECTION,lockToken:owned.lockToken});
    }).catch(function(error){return {ok:false,status:'error',error:error};}).then(function(result){
      if(token===generation){state.lastReleaseResult=copy(result);state.lock=null;state.error=result&&result.error||null;rerender();}
      return result;
    });
  }
  function canMutateAccommodation(){return valid()&&state.localConferenceId===currentId();}
  function requireAccommodationMutation(){
    if(canMutateAccommodation())return true;
    notify(state.status==='acquiring'?'جارٍ الحصول على قفل تعديل التسكين.':'ابدأ تعديل التسكين أولًا.');
    return false;
  }
  function getDiagnostics(){
    var output=copy(state);output.canWrite=canMutateAccommodation();output.ttlSeconds=TTL_SECONDS;output.heartbeatMs=HEARTBEAT_MS;output.heartbeatTimerCount=timer===null?0:1;return output;
  }
  function refreshDiagnostics(){
    var localId=currentId(),link=linked(localId);
    if(!link)return Promise.resolve({ok:false,status:'link_required'});
    return global.ConferenceLocks.getLockStatus(link.remoteConferenceId,{section:SECTION}).then(function(result){if(result&&result.data)state.lock=copy(result.data);rerender();return result;});
  }
  function authorizeReset(){return Object.freeze({sectionReset:true});}
  global.addEventListener&&global.addEventListener('beforeunload',clearTimer);
  global.ConferenceEditLockManager=Object.freeze({section:SECTION,ttlSeconds:TTL_SECONDS,heartbeatMs:HEARTBEAT_MS,beginAccommodationEdit:beginAccommodationEdit,endAccommodationEdit:endAccommodationEdit,release:endAccommodationEdit,renew:renew,canMutateAccommodation:canMutateAccommodation,requireAccommodationMutation:requireAccommodationMutation,getState:getDiagnostics,getDiagnostics:getDiagnostics,refreshDiagnostics:refreshDiagnostics,authorizeReset:authorizeReset});
})(window);
