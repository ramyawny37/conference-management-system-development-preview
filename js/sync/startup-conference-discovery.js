(function(global){
  'use strict';
  var records=[];
  var generation=0;
  var flight=null;
  function copy(value){if(typeof global.structuredClone==='function')return global.structuredClone(value);return JSON.parse(JSON.stringify(value));}
  function result(ok,status,data,error){return {ok:ok,status:status,data:data||null,error:error||null};}
  function refresh(options){
    options=options&&typeof options==='object'?options:{};
    if(flight)return flight;
    var authority=options.authority||global.CanonicalConferenceDiscovery;
    if(!authority||typeof authority.listAccessibleConferences!=='function')return Promise.resolve(result(false,'unavailable',null,{code:'CANONICAL_CONFERENCE_DISCOVERY_UNAVAILABLE'}));
    var token=++generation;
    flight=Promise.resolve(authority.listAccessibleConferences()).then(function(listed){
      if(token!==generation)return result(false,'stale');
      if(!listed||listed.ok!==true)return listed||result(false,'failed');
      if(!listed.data||!Array.isArray(listed.data.conferences))return result(false,'invalid_response',null,{code:'CANONICAL_CONFERENCE_DISCOVERY_INVALID_RESPONSE'});
      records=copy(listed.data.conferences);
      return result(true,'loaded',{conferences:copy(records)});
    }).finally(function(){if(token===generation)flight=null;});
    return flight;
  }
  function clear(){generation++;records=[];flight=null;return result(true,'cleared');}
  global.StartupConferenceDiscovery=Object.freeze({refresh:refresh,clear:clear,getRecords:function(){return copy(records);},getGeneration:function(){return generation;}});
})(window);
