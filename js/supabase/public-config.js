(function(global){
  'use strict';

  const DEVELOPMENT_PATH='/conference-management-system-development-preview/';
  const DEVELOPMENT_CONFIG=Object.freeze({
    url:'https://gppwltrifgfxrkzvvxoe.supabase.co',
    publishableKey:
      'sb_publishable_Ibnpk0i0faZMUCoFOr8MTQ_G-iujGEp'
  });
  const PRODUCTION_CONFIG=Object.freeze({
    url:'https://mpezfbvcdfxpgflehuot.supabase.co',
    publishableKey:
      'sb_publishable_lWUuYqgGiez3RB_Kh5hhyA_PylfyAlC'
  });
  const IS_DEVELOPMENT=global.location.pathname.includes(DEVELOPMENT_PATH);

  global.SUPABASE_RUNTIME_CONFIG=IS_DEVELOPMENT
    ? DEVELOPMENT_CONFIG
    : PRODUCTION_CONFIG;
})(window);
