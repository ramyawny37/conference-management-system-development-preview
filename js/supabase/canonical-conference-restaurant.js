(function(global){
  'use strict';
  var states=Object.create(null),flights=Object.create(null);
  function copy(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function operationId(){return global.crypto&&global.crypto.randomUUID?global.crypto.randomUUID():String(Date.now())+'-0000-4000-8000-'+Math.random().toString(16).slice(2,14).padEnd(12,'0');}
  // Canonical conference ID is the sole identity; no local/cloud link lookup.
  function isLinked(conferenceId){return !!states[String(conferenceId||'')];}
  function remoteId(conferenceId){
    var id=String(conferenceId||'');
    if(!id||!states[id])throw new Error('CANONICAL_CONFERENCE_NOT_HYDRATED');
    return id;
  }
  function invoke(operation,args){var session=global.PlatformDeviceSession;if(!session||typeof session.invokeModuleProtected!=='function')return Promise.reject(new Error('PLATFORM_DEVICE_SESSION_REQUIRED'));return session.invokeModuleProtected('conference',operation,args||{});}
  function projection(localId,response){var settings=response&&response.settings||{},prices=settings.prices||{};return {localConferenceId:String(localId),remoteConferenceId:String(response&&response.conferenceId||''),canManage:response&&response.canManage===true,plan:{enabled:settings.enabled!==false,firstMeal:String(settings.firstMeal||'dinner'),lastMeal:String(settings.lastMeal||'lunch'),prices:{breakfast:Number(prices.breakfast||0),lunch:Number(prices.lunch||0),dinner:Number(prices.dinner||0)},revision:Number(settings.revision||0),mealPriceOverrides:copy(response&&response.priceOverrides||[]),mealCountOverrides:copy(response&&response.countOverrides||[]),personOverrides:(response&&response.participationOverrides||[]).map(function(item){return {id:String(item.id),participationId:String(item.participationId),day:Number(item.day),meal:String(item.meal),included:item.included===true,note:item.note||'',revision:Number(item.revision)};})},participations:copy(response&&response.participations||[])};}
  function hydrate(localId,authorizedRemoteId){localId=String(localId||'');var conferenceId=String(authorizedRemoteId||localId);if(!conferenceId)return Promise.reject(new Error('CANONICAL_CONFERENCE_ID_REQUIRED'));if(flights[localId])return flights[localId];flights[localId]=invoke('get_conference_restaurant',{p_conference_id:conferenceId}).then(function(response){states[localId]=projection(localId,response);delete flights[localId];return copy(states[localId]);},function(error){delete flights[localId];throw error;});return flights[localId];}
  function mutate(localId,operation,payload,revision){localId=String(localId||'');if(!states[localId])return Promise.reject(new Error('CANONICAL_RESTAURANT_NOT_HYDRATED'));return invoke('mutate_conference_restaurant',{p_operation_id:operationId(),p_operation:String(operation),p_conference_id:remoteId(localId),p_expected_revision:revision==null?null:Number(revision),p_payload:copy(payload||{})}).then(function(result){return hydrate(localId).then(function(){return result;});});}
  function clear(){states=Object.create(null);flights=Object.create(null);}
  if(global.addEventListener)global.addEventListener('platform-session-reset',clear);
  global.CanonicalConferenceRestaurant=Object.freeze({isLinked:isLinked,hydrate:hydrate,getState:function(localId){return copy(states[String(localId||'')]||null);},getPlan:function(localId){var value=states[String(localId||'')];return copy(value&&value.plan||null);},getParticipations:function(localId){var value=states[String(localId||'')];return copy(value&&value.participations||[]);},mutate:mutate,clear:clear});
})(window);
