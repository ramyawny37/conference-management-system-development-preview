(function(global){
  'use strict';
  var started=false,startPromise=null,resume=null,gateActive=false,saved=[];
  var hiddenIds=['splash-screen','applicationTopbar','startupScreen','globalConferenceHeader','device_authorization_administration_root','tab0','tab1','tab2','tab3','tab4','tab5','tab6'];
  function authenticated(){var auth=global.SupabaseAuth,state=auth&&auth.getState&&auth.getState();return !!(state&&state.authenticated);}
  function element(id){return global.document&&global.document.getElementById(id);}
  function showGate(){if(gateActive)return;gateActive=true;saved=hiddenIds.map(function(id){var target=element(id);return {target:target,display:target&&target.style?target.style.display:''};});saved.forEach(function(item){if(item.target&&item.target.style)item.target.style.display='none';});var body=element('applicationBody');if(body&&body.style)body.style.display='block';}
  function hideGate(){if(!gateActive)return;gateActive=false;saved.forEach(function(item){if(item.target&&item.target.style)item.target.style.display=item.display;});saved=[];}
  function handleAuthorizationState(status){status=String(status||'unavailable');if(!authenticated()||status==='approved'){hideGate();if(resume){var release=resume;resume=null;release({status:status,approved:status==='approved'});}}else showGate();return {status:status,gateActive:gateActive};}
  function waitUntilApproved(){if(startPromise)return startPromise;started=true;var ui=global.CurrentDeviceAuthorizationUI;startPromise=Promise.resolve(ui&&typeof ui.initialize==='function'?ui.initialize():null).then(function(){var current=ui&&typeof ui.getState==='function'?ui.getState():{};if(!authenticated()||current.status==='approved'){hideGate();return {status:current.status||'signed_out',approved:current.status==='approved'};}showGate();return new Promise(function(resolve){resume=resolve;});});return startPromise;}
  function getState(){return {started:started,gateActive:gateActive,waiting:!!resume};}
  global.DeviceReauthorizationFlow=Object.freeze({waitUntilApproved:waitUntilApproved,handleAuthorizationState:handleAuthorizationState,getState:getState});
})(window);
