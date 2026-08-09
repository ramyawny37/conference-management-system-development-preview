(function(global){
  'use strict';
  function systemAccess(){var service=global.SystemAccessService;return service&&typeof service.getState==='function'?service.getState():{};}
  function conferenceAccess(){var ui=global.ConferenceMembersUI;return ui&&typeof ui.getAccessState==='function'?ui.getAccessState():{};}
  function isSystemOwner(){var access=systemAccess();return access.accountStatus==='approved'&&access.fresh===true&&access.isSystemOwner===true;}
  function conferenceRole(){var access=conferenceAccess();return access.accessStatus==='available'?String(access.role||''):'';}
  function canViewConferenceDiagnostics(){return isSystemOwner()||['owner','manager'].indexOf(conferenceRole())>=0;}
  function canExportRescue(){return isSystemOwner()||conferenceRole()==='owner';}
  global.DiagnosticsPrivacyPolicy=Object.freeze({
    isDevelopment:function(){return !!(global.BrowserStorageNamespace&&global.BrowserStorageNamespace.environment==='development');},
    isSystemOwner:isSystemOwner,conferenceRole:conferenceRole,
    canViewConferenceDiagnostics:canViewConferenceDiagnostics,
    canExportRescue:canExportRescue
  });
})(window);
