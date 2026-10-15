(function(global){
  'use strict';
  function output(ok,status,data,error){return {ok:ok,status:status,data:data||null,error:error||null};}
  function listAccessibleConferences(){
    var session=global.PlatformDeviceSession;
    if(!session||typeof session.invokeModuleProtected!=='function'){
      return Promise.resolve(output(false,'unavailable',null,{code:'DEVICE_SESSION_RUNTIME_REQUIRED'}));
    }
    return Promise.resolve(session.invokeModuleProtected(
      'conference','list_accessible_conferences',{}
    )).then(function(response){
      if(!response||!Array.isArray(response.conferences)){
        return output(false,'invalid_response',null,{code:'CANONICAL_CONFERENCE_DISCOVERY_INVALID_RESPONSE'});
      }
      var rows=response.conferences;
      var conferences=rows.filter(function(item){return item&&item.conferenceId;}).map(function(item){return {
        id:item.conferenceId,name:item.name,
        startDate:item.startDate||null,endDate:item.endDate||null,status:item.status,
        completedAt:item.completedAt||null,revision:item.revision,
        createdAt:item.createdAt,updatedAt:item.updatedAt,
        capabilities:{
          core:!!(item.capabilities&&item.capabilities.core===true),people:!!(item.capabilities&&item.capabilities.people===true),
          accommodation:!!(item.capabilities&&item.capabilities.accommodation===true),airConditioning:!!(item.capabilities&&item.capabilities.airConditioning===true),
          branding:!!(item.capabilities&&item.capabilities.branding===true),finance:!!(item.capabilities&&item.capabilities.finance===true),
          transport:!!(item.capabilities&&item.capabilities.transport===true),restaurant:!!(item.capabilities&&item.capabilities.restaurant===true),
          edit:!!(item.capabilities&&item.capabilities.edit===true),sync:!!(item.capabilities&&item.capabilities.sync===true),
          transportManage:!!(item.capabilities&&item.capabilities.transportManage===true)
        }
      };});
      return output(true,'listed',{conferences:conferences});
    }).catch(function(error){return output(false,'failed',null,{code:String(error&&error.code||'CANONICAL_CONFERENCE_DISCOVERY_FAILED')});});
  }
  global.CanonicalConferenceDiscovery=Object.freeze({listAccessibleConferences:listAccessibleConferences});
})(window);
