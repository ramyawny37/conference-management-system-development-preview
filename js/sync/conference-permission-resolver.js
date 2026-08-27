(function(global){
  'use strict';
  var diagnostics=[];

  function contract(){return global.ConferencePermissionContract||null;}
  function authorizationRole(context){
    var decision=context&&context.authorizationDecision;
    if(!decision||decision.ok!==true||typeof decision.role!=='string')return null;
    var value=decision.role;
    var source=contract();
    return source&&source.roles.indexOf(value)>=0?value:null;
  }
  function enabled(){var source=contract();return !!(source&&source.enforcementEnabled===true);}
  function can(section,action,context){
    var source=contract(),role=authorizationRole(context);
    if(!source||!role||typeof source.hasSectionPermission!=='function')return false;
    return source.hasSectionPermission(role,section,action)===true;
  }
  function canConference(action,context){
    var source=contract(),role=authorizationRole(context);
    if(!source||!role||typeof source.hasConferencePermission!=='function')return false;
    return source.hasConferencePermission(role,action)===true;
  }
  function record(input){
    diagnostics.push(Object.freeze({
      handler:input.handler||null,scope:input.scope||null,
      section:input.section||null,action:input.action||null,
      role:input.role||null,allowed:input.allowed===true,
      enforcementEnabled:input.enforcementEnabled===true,
      shouldProceed:typeof input.shouldProceed==='boolean'?input.shouldProceed:null,
      status:input.status||'evaluated'
    }));
    if(diagnostics.length>100)diagnostics=diagnostics.slice(-100);
  }
  function requirePermission(section,action,context){
    var allowed=can(section,action,context);
    record({scope:'section',section:section,action:action,
      role:authorizationRole(context),allowed:allowed,
      enforcementEnabled:enabled(),status:'required'});
    return allowed;
  }
  function requireConference(action,context){
    var allowed=canConference(action,context);
    record({scope:'conference',action:action,role:authorizationRole(context),
      allowed:allowed,enforcementEnabled:enabled(),status:'required'});
    return allowed;
  }
  function findHandler(handler){
    var source=contract();
    if(!source||typeof handler!=='string'||!handler)return null;
    var entries=Array.prototype.slice.call(source.mutationCatalog||[])
      .concat(Array.prototype.slice.call(source.conferenceMutationCatalog||[]));
    for(var index=0;index<entries.length;index++){
      if(entries[index]&&entries[index].handler===handler)return entries[index];
    }
    return null;
  }
  function result(handler,scope,section,action,context,allowed,status){
    var enforcement=enabled();
    var output=Object.freeze({
      handler:handler,scope:scope,section:section||null,action:action||null,
      role:authorizationRole(context),allowed:allowed===true,
      enforcementEnabled:enforcement,
      shouldProceed:enforcement!==true||allowed===true,status:status
    });
    record(output);return output;
  }
  function resolveHandler(handler,mode,context){
    var entry=findHandler(handler);
    if(!entry)return result(handler,null,null,null,context,false,'unknown_handler');
    if(entry.status!=='classified'){
      return result(handler,entry.section?'section':'conference',entry.section,
        null,context,false,entry.status||'unresolved');
    }
    if(entry.section){
      var actions=Array.prototype.slice.call(entry.action||[]),action=null;
      if(actions.length===1)action=actions[0];
      else if(typeof mode==='string'&&actions.indexOf(mode)>=0)action=mode;
      if(!action)return result(handler,'section',entry.section,null,context,false,'mode_required');
      return result(handler,'section',entry.section,action,context,
        can(entry.section,action,context),'resolved');
    }
    if(typeof entry.action!=='string'){
      return result(handler,'conference',null,null,context,false,'action_unavailable');
    }
    return result(handler,'conference',null,entry.action,context,
      canConference(entry.action,context),'resolved');
  }
  function currentAuthorizationContext(){
    var authorization=global.ConferenceActivationAuthorization;
    try{
      var decision=authorization&&typeof authorization.getCurrentState==='function'
        ?authorization.getCurrentState():null;
      return {authorizationDecision:decision};
    }catch(error){
      return {authorizationDecision:null,authorizationLookupFailed:true};
    }
  }
  function shadowGate(handler,mode){
    return resolveHandler(handler,mode,currentAuthorizationContext()).shouldProceed;
  }
  function getDiagnostics(){return diagnostics.slice();}
  function resetDiagnostics(){diagnostics=[];}

  global.ConferencePermissionResolver=Object.freeze({
    enforcementEnabled:enabled(),can:can,require:requirePermission,
    canConference:canConference,requireConference:requireConference,
    resolveHandler:resolveHandler,getDiagnostics:getDiagnostics,
    resetDiagnostics:resetDiagnostics
  });
  global.ConferencePermissionShadowGate=shadowGate;
})(window);
