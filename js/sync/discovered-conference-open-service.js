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
  function linkFor(remoteId,conference,options){
    var links=options.links||global.ConferenceLinkStore;
    var existing=links&&typeof links.findByRemoteId==='function'?links.findByRemoteId(remoteId):null;
    var localId=String(existing&&existing.localConferenceId||remoteId);
    if(!existing){
      if(!links||typeof links.save!=='function')throw {code:'CONFERENCE_LINK_STORE_UNAVAILABLE'};
      var saved=links.save({localConferenceId:localId,remoteConferenceId:remoteId,remoteName:String(conference.name||''),linkStatus:'linked'});
      if(!saved||saved.ok!==true)throw {code:'CONFERENCE_LINK_SAVE_FAILED',status:saved&&saved.status};
    }
    return localId;
  }
  function ensureRuntimeConference(localId,conference,options){
    var getData=options.getAppData||function(){return global.appData;};
    var applyData=options.applyAppData||function(value){global.appData=value;};
    var data=copy(getData()||{});
    data.conferences=Array.isArray(data.conferences)?data.conferences:[];
    var found=data.conferences.find(function(item){return item&&String(item.id||'')===localId;});
    if(!found){
      found={id:localId,name:String(conference.name||''),status:String(conference.status||'active'),startDate:conference.startDate||'',endDate:conference.endDate||'',peopleDb:{people:[]},houses:[],transports:[],activityLog:[]};
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
  function hydrate(localId,remoteId){
    var platform=global.PlatformIntegration;
    var tasks=[];
    function add(target,name,args){if(target&&typeof target[name]==='function')tasks.push(Promise.resolve(target[name].apply(target,args)));}
    add(platform,'hydrateConferenceCore',[localId,remoteId]);
    add(platform,'hydrateConferenceParticipations',[localId,remoteId]);
    add(platform,'hydrateConferenceAccommodation',[localId,remoteId]);
    add(platform,'hydrateConferenceAirConditioning',[localId,remoteId]);
    add(global.CanonicalConferenceBranding,'hydrate',[localId,remoteId]);
    add(global.CanonicalConferenceAirConditioning,'hydrate',[localId,remoteId]);
    add(global.CanonicalConferenceFinance,'hydrate',[localId,remoteId]);
    add(global.CanonicalConferenceTransport,'hydrate',[localId,remoteId]);
    add(global.CanonicalConferenceRestaurant,'hydrate',[localId,remoteId]);
    return Promise.all(tasks).then(function(values){diagnostics.canonicalHydrationCount=values.length;return values;});
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
      var links=options.links||global.ConferenceLinkStore;
      var existing=links&&typeof links.findByRemoteId==='function'?links.findByRemoteId(remoteId):null;
      var localId=String(existing&&existing.localConferenceId||remoteId);
      return hydrate(localId,remoteId).then(function(){
        if(token!==generation)return result(false,'stale');
        linkFor(remoteId,access.data.conference,options);
        ensureRuntimeConference(localId,access.data.conference,options);
        if(token!==generation)return result(false,'stale');
        var authorization=global.ConferenceActivationAuthorization;
        if(!authorization||typeof authorization.authorizeCloud!=='function'){
          return result(false,'activation_authorization_unavailable');
        }
        var activationDecision=authorization.authorizeCloud({
          conferenceId:localId,
          canonicalAccess:true,
          capabilities:access.data.capabilities
        });
        var activate=options.activate||global.activatePersistedConferenceById;
        var activated=typeof activate==='function'&&activate(localId,{
          alreadyPersisted:true,
          activationDecision:activationDecision,
          enterApplication:options.enterApplication===true
        })===true;
        if(!activated)return result(false,'runtime_activation_failed');
        return result(true,'opened',{localConferenceId:localId,remoteConferenceId:remoteId,canonicalAccess:true,capabilities:access.data.capabilities});
      });
    }).catch(function(error){return result(false,error&&error.code==='CONFERENCE_LINK_SAVE_FAILED'?'conference_link_save_failed':error&&error.code==='CONFERENCE_LINK_STORE_UNAVAILABLE'?'conference_link_store_unavailable':'canonical_hydration_failed',null,{code:String(error&&error.code||error&&error.message||'CANONICAL_HYDRATION_FAILED')});}).finally(function(){if(flights[remoteId]===flight)delete flights[remoteId];});
    flights[remoteId]=flight;
    return flight;
  }
  function validateAuthorization(remoteConferenceId,options){return available(String(remoteConferenceId||''),options||{});}
  function invalidate(){generation++;flights=Object.create(null);return result(true,'invalidated');}
  global.DiscoveredConferenceOpenService=Object.freeze({open:open,validateAuthorization:validateAuthorization,invalidate:invalidate,getDiagnostics:function(){return copy(diagnostics);},getState:function(){return {activeConferenceIds:Object.keys(flights)};}});
})(window);
