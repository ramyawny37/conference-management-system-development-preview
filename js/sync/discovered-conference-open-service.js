(function(global){
  'use strict';
  var generation=0;
  var flights=Object.create(null);
  var diagnostics={lastStatus:null,lastRemoteConferenceId:null,canonicalHydrationCount:0};
  function copy(value){if(typeof global.structuredClone==='function')return global.structuredClone(value);return JSON.parse(JSON.stringify(value));}
  function result(ok,status,data,error){diagnostics.lastStatus=status;return {ok:ok,status:status,data:data||null,error:error||null};}
  function available(remoteId,options){
    var authority=options.discoveryAuthority||global.CanonicalConferenceDiscovery;
    if(!authority||typeof authority.listAccessibleConferences!=='function')return Promise.resolve(result(false,'discovery_unavailable'));
    return Promise.resolve(authority.listAccessibleConferences()).then(function(listed){
      if(!listed||listed.ok!==true)return result(false,'authorization_failed',null,listed&&listed.error);
      var item=(listed.data&&listed.data.conferences||[]).find(function(row){return String(row&&row.id||'')===remoteId;});
      return item?result(true,'authorized',{conference:item,capabilities:item.capabilities||{}}):result(false,'access_denied');
    });
  }
  function ensureRuntimeConference(conferenceId,conference,options){
    var getData=options.getAppData||function(){return global.appData;};
    var applyData=options.applyAppData||function(value){global.appData=value;};
    var data=copy(getData()||{});
    data.conferences=Array.isArray(data.conferences)?data.conferences:[];
    var found=data.conferences.find(function(item){return item&&String(item.id||'')===conferenceId;});
    if(!found){
      found={id:conferenceId,name:String(conference.name||''),status:String(conference.status||'active'),startDate:conference.startDate||'',endDate:conference.endDate||'',peopleDb:{people:[]},houses:[],transports:[],activityLog:[]};
      data.conferences.push(found);
    }else{
      found.name=String(conference.name||found.name||'');
      found.status=String(conference.status||found.status||'active');
      found.startDate=conference.startDate||found.startDate||'';
      found.endDate=conference.endDate||found.endDate||'';
    }
    // Activation selects the conference only after canonical hydration and authorization.
    applyData(data);
    return data;
  }
  function hydrate(conferenceId){
    var platform=global.PlatformIntegration;
    var tasks=[];
    function add(target,name,args){tasks.push({target:target,name:name,args:args});}
    add(platform,'hydrateConferenceCore',[conferenceId,conferenceId]);
    add(platform,'hydrateConferenceParticipations',[conferenceId,conferenceId]);
    add(platform,'hydrateConferenceAccommodation',[conferenceId,conferenceId]);
    add(platform,'hydrateConferenceAirConditioning',[conferenceId,conferenceId]);
    add(global.CanonicalConferenceBranding,'hydrate',[conferenceId,conferenceId]);
    add(global.CanonicalConferenceAirConditioning,'hydrate',[conferenceId,conferenceId]);
    add(global.CanonicalConferenceFinance,'hydrate',[conferenceId,conferenceId]);
    add(global.CanonicalConferenceTransport,'hydrate',[conferenceId,conferenceId]);
    add(global.CanonicalConferenceRestaurant,'hydrate',[conferenceId,conferenceId]);
    var missing=tasks.find(function(task){return !task.target||typeof task.target[task.name]!=='function';});
    if(missing)return Promise.reject({code:'CANONICAL_HYDRATOR_UNAVAILABLE',owner:missing.name});
    return Promise.all(tasks.map(function(task){return Promise.resolve().then(function(){return task.target[task.name].apply(task.target,task.args);});})).then(function(values){diagnostics.canonicalHydrationCount=values.length;return values;});
  }
  function open(remoteConferenceId,options){
    options=options&&typeof options==='object'?options:{};
    var remoteId=String(remoteConferenceId||'');
    if(!remoteId)return Promise.resolve(result(false,'invalid_remote_id'));
    if(flights[remoteId])return flights[remoteId];
    var token=++generation;
    diagnostics.lastRemoteConferenceId=remoteId;
    var flight=available(remoteId,options).then(function(access){
      if(!access.ok||token!==generation)return token===generation?access:result(false,'stale');
      return hydrate(remoteId).then(function(){
        if(token!==generation)return result(false,'stale');
        var authorization=global.ConferenceActivationAuthorization;
        if(!authorization||typeof authorization.authorizeCloud!=='function'){
          return result(false,'activation_authorization_unavailable');
        }
        var activationDecision=authorization.authorizeCloud({
          conferenceId:remoteId,
          canonicalAccess:true,
          capabilities:access.data.capabilities
        });
        if(!activationDecision||activationDecision.ok!==true||activationDecision.active!==true){
          return result(false,'activation_authorization_denied');
        }
        if(token!==generation)return result(false,'stale');
        ensureRuntimeConference(remoteId,access.data.conference,options);
        var activate=options.activate||global.activatePersistedConferenceById;
        var activated=typeof activate==='function'&&activate(remoteId,{
          alreadyPersisted:true,
          activationDecision:activationDecision,
          enterApplication:options.enterApplication===true
        })===true;
        if(!activated)return result(false,'runtime_activation_failed');
        return result(true,'opened',{conferenceId:remoteId,canonicalAccess:true,capabilities:access.data.capabilities});
      });
    }).catch(function(error){if(token!==generation)return result(false,'stale');return result(false,'canonical_hydration_failed',null,{code:String(error&&error.code||error&&error.message||'CANONICAL_HYDRATION_FAILED')});}).finally(function(){if(flights[remoteId]===flight)delete flights[remoteId];});
    flights[remoteId]=flight;
    return flight;
  }
  function validateAuthorization(remoteConferenceId,options){return available(String(remoteConferenceId||''),options||{});}
  function invalidate(){generation++;flights=Object.create(null);return result(true,'invalidated');}
  if(typeof global.addEventListener==='function')global.addEventListener('platform-session-reset',invalidate);
  global.DiscoveredConferenceOpenService=Object.freeze({open:open,validateAuthorization:validateAuthorization,invalidate:invalidate,getDiagnostics:function(){return copy(diagnostics);},getState:function(){return {activeConferenceIds:Object.keys(flights)};}});
})(window);
