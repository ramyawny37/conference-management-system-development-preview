(function(global){
  'use strict';

  var DEVELOPMENT_PROJECT_REF='gppwltrifgfxrkzvvxoe';
  var DEVELOPMENT_PATH='/conference-management-system-development-preview/';
  var pathname=String(global.location&&global.location.pathname||'/');
  var isDevelopment=pathname.indexOf(DEVELOPMENT_PATH)===0;
  var prefix=isDevelopment
    ?'cms:development:'+DEVELOPMENT_PROJECT_REF+':'
    :'';

  function qualify(name){
    return prefix+String(name||'');
  }

  global.BrowserStorageNamespace=Object.freeze({
    environment:isDevelopment?'development':'production',
    projectRef:isDevelopment?DEVELOPMENT_PROJECT_REF:null,
    prefix:prefix,
    key:qualify,
    databaseName:qualify,
    cacheName:qualify
  });
})(window);
