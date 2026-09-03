(function(global){
  'use strict';

  var document=global.document;
  var script=document&&document.currentScript;
  var source=script&&script.src;
  var location=global.location;
  var baseUrl=null;
  var conferenceTabNames=[
    'accommodation','transportation','accounts','reports','cards','search','settings'
  ];

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
    return requireBase().pathname+(route==='/'?'':'#'+route);
  }

  function logicalPathname(pathname){
    pathname=String(pathname||'');
    var base=basePathname();
    var baseWithoutSlash=base.length>1?base.replace(/\/$/,''):base;
    if(pathname===base||pathname===baseWithoutSlash)return '/';
    if(pathname.indexOf(base)===0)return '/'+pathname.slice(base.length).replace(/^\/+|\/+$/g,'');
    return null;
  }

  function getConferenceRoute(route){
    route=String(route===undefined
      ?(location&&location.hash||'').replace(/^#/,'')
      :route||'/');
    if(route.length>1)route=route.replace(/\/+$/,'');
    if(route==='/conference')return Object.freeze({kind:'home',tabId:null,tabName:null});
    var match=/^\/conference\/app\/([a-z-]+)$/.exec(route);
    if(!match)return route.indexOf('/conference')===0
      ?Object.freeze({kind:'invalid',tabId:null,tabName:null}):null;
    var tabId=conferenceTabNames.indexOf(match[1]);
    return tabId<0?Object.freeze({kind:'invalid',tabId:null,tabName:null})
      :Object.freeze({kind:'application',tabId:tabId,tabName:match[1]});
  }

  function resolveConferenceTabRoute(tabId){
    tabId=typeof tabId==='number'?tabId:parseInt(tabId,10);
    if(tabId<0||tabId>=conferenceTabNames.length||!isFinite(tabId))return null;
    return '/conference/app/'+conferenceTabNames[tabId];
  }

  global.ApplicationRouting=Object.freeze({
    getBasePathname:basePathname,
    resolveLogicalRoute:resolveLogicalRoute,
    getLogicalPathname:function(){
      var hash=String(location&&location.hash||'');
      return hash.indexOf('#/')===0?normalizeLogicalRoute(hash.slice(1)):'/';
    },
    logicalPathname:logicalPathname,
    getConferenceRoute:getConferenceRoute,
    resolveConferenceTabRoute:resolveConferenceTabRoute
  });
})(window);
