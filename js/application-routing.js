(function(global){
  'use strict';

  var document=global.document;
  var script=document&&document.currentScript;
  var source=script&&script.src;
  var location=global.location;
  var baseUrl=null;

  try{
    baseUrl=new URL('../',source);
    if(location&&baseUrl.origin!==location.origin)baseUrl=null;
  }catch(error){
    baseUrl=null;
  }

  function requireBase(){
    if(!baseUrl)throw new Error('APPLICATION_BASE_UNAVAILABLE');
    return baseUrl;
  }

  function basePathname(){
    return requireBase().pathname;
  }

  function normalizeLogicalRoute(route){
    route=String(route||'');
    if(!/^\/[a-z][a-z0-9-]*(?:[/?#]|$)/i.test(route)&&route!=='/'){
      throw new Error('APPLICATION_ROUTE_INVALID');
    }
    return route;
  }

  function resolveLogicalRoute(route){
    route=normalizeLogicalRoute(route);
    var resolved=new URL(route==='/'?'./':'./'+route.slice(1),requireBase());
    return resolved.pathname+resolved.search+resolved.hash;
  }

  function logicalPathname(pathname){
    pathname=String(pathname||'');
    var base=basePathname();
    var baseWithoutSlash=base.length>1?base.replace(/\/$/,''):base;
    if(pathname===base||pathname===baseWithoutSlash)return '/';
    if(pathname.indexOf(base)===0)return '/'+pathname.slice(base.length).replace(/^\/+|\/+$/g,'');
    return null;
  }

  global.ApplicationRouting=Object.freeze({
    getBasePathname:basePathname,
    resolveLogicalRoute:resolveLogicalRoute,
    getLogicalPathname:function(){
      return logicalPathname(location&&location.pathname);
    },
    logicalPathname:logicalPathname
  });
})(window);
