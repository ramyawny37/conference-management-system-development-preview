(function(global){
  'use strict';
  var states=Object.create(null),flights=Object.create(null);
  function copy(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function operationId(){return global.crypto&&global.crypto.randomUUID?global.crypto.randomUUID():String(Date.now())+'-0000-4000-8000-'+Math.random().toString(16).slice(2,14).padEnd(12,'0');}
  function link(localId){var store=global.ConferenceLinkStore,record=store&&store.get&&store.get(String(localId||''));return record&&['linked','cloud_linked'].indexOf(record.linkStatus)>=0?record:null;}
  function isLinked(localId){return !!link(localId);}
  function remoteId(localId){var record=link(localId);if(!record||!record.remoteConferenceId)throw new Error('CANONICAL_TRANSPORT_LINK_REQUIRED');return String(record.remoteConferenceId);}
  function invoke(operation,args){var session=global.PlatformDeviceSession;if(!session||typeof session.invokeModuleProtected!=='function')return Promise.reject(new Error('PLATFORM_DEVICE_SESSION_REQUIRED'));return session.invokeModuleProtected('conference',operation,args||{});}
  function projection(localId,response){
    var assignments=Array.isArray(response&&response.assignments)?response.assignments:[],byVehicle=Object.create(null);
    var vehicles=(Array.isArray(response&&response.vehicles)?response.vehicles:[]).map(function(vehicle){
      var seats=[];for(var number=1;number<=Number(vehicle.capacity);number++)seats.push({seat:number,name:'',room:'',type:'adult',note:'',riders:[]});
      var item={id:String(vehicle.vehicleId),name:String(vehicle.name||''),icon:String(vehicle.icon||'🚌'),capacity:Number(vehicle.capacity),position:Number(vehicle.position||0),revision:Number(vehicle.revision),seats:seats};byVehicle[item.id]=item;return item;
    });
    assignments.filter(function(item){return item&&item.mode==='independent';}).forEach(function(item){
      var vehicle=byVehicle[String(item.vehicleId)],seat=vehicle&&vehicle.seats[Number(item.seatNumber)-1];if(!seat)return;
      seat.name=String(item.person&&item.person.fullName||'');seat.room=String(item.roomNumber||'');seat.type=item.riderKind==='adult'?'adult':'child_seat';seat.personId=String(item.person&&item.person.personId||'');seat.participationId=String(item.participationId);seat.assignmentId=String(item.assignmentId);seat.revision=Number(item.revision);seat.guardianParticipationId=item.guardianParticipationId||null;
    });
    assignments.filter(function(item){return item&&item.mode==='shared';}).forEach(function(item){
      var vehicle=byVehicle[String(item.vehicleId)],guardian=assignments.find(function(candidate){return candidate.mode==='independent'&&candidate.vehicleId===item.vehicleId&&candidate.participationId===item.guardianParticipationId;}),seat=vehicle&&guardian&&vehicle.seats[Number(guardian.seatNumber)-1];if(!seat)return;
      seat.riders.push({r:{name:String(item.person&&item.person.fullName||''),room:String(item.roomNumber||''),type:item.riderKind==='infant'?'infant':'child_shared',personId:String(item.person&&item.person.personId||''),participationId:String(item.participationId),assignmentId:String(item.assignmentId),revision:Number(item.revision),guardianParticipationId:item.guardianParticipationId||null,guardianSeat:Number(guardian.seatNumber)}});
    });
    return {localConferenceId:String(localId),remoteConferenceId:String(response&&response.conferenceId||''),canManage:response&&response.canManage===true,vehicles:vehicles,assignments:assignments};
  }
  function hydrate(localId,authorizedRemoteId){localId=String(localId||'');var conferenceId=authorizedRemoteId?String(authorizedRemoteId):remoteId(localId);if(flights[localId])return flights[localId];flights[localId]=invoke('get_conference_transport',{p_conference_id:conferenceId}).then(function(response){states[localId]=projection(localId,response);delete flights[localId];return copy(states[localId]);},function(error){delete flights[localId];throw error;});return flights[localId];}
  function state(localId){return copy(states[String(localId||'')]||null);}
  function refreshAfter(localId,promise){return promise.then(function(result){return hydrate(localId).then(function(){return result;});});}
  function mutateVehicle(localId,draft){draft=draft||{};return refreshAfter(localId,invoke('mutate_conference_transport_vehicle',{p_operation_id:operationId(),p_operation:String(draft.operation||''),p_conference_id:remoteId(localId),p_vehicle_id:draft.vehicleId?String(draft.vehicleId):null,p_expected_revision:draft.expectedRevision==null?null:Number(draft.expectedRevision),p_name:draft.name==null?null:String(draft.name),p_icon:draft.icon==null?null:String(draft.icon),p_capacity:draft.capacity==null?null:Number(draft.capacity),p_position:draft.position==null?null:Number(draft.position),p_remove_overflow:draft.removeOverflow===true}));}
  function setAssignment(localId,draft){draft=draft||{};return refreshAfter(localId,invoke('set_conference_transport_assignment',{p_operation_id:operationId(),p_conference_id:remoteId(localId),p_participation_id:String(draft.participationId||''),p_vehicle_id:String(draft.vehicleId||''),p_mode:String(draft.mode||'independent'),p_rider_kind:String(draft.riderKind||'adult'),p_seat_number:draft.seatNumber==null?null:Number(draft.seatNumber),p_expected_revision:draft.expectedRevision==null?null:Number(draft.expectedRevision)}));}
  function removeAssignment(localId,assignmentId,revision){return refreshAfter(localId,invoke('remove_conference_transport_assignment',{p_operation_id:operationId(),p_assignment_id:String(assignmentId||''),p_expected_revision:Number(revision)}));}
  function participants(localId){var integration=global.PlatformIntegration,state=integration&&integration.getConferenceParticipationState&&integration.getConferenceParticipationState(localId);return state&&Array.isArray(state.items)?state.items.filter(function(item){return item.status==='active';}):[];}
  function createParticipant(localId,fullName){var integration=global.PlatformIntegration;if(!integration||typeof integration.createConferenceParticipationWithPerson!=='function')return Promise.reject(new Error('CANONICAL_PARTICIPATION_RUNTIME_REQUIRED'));return integration.createConferenceParticipationWithPerson(localId,{fullName:String(fullName||'').trim(),phone:null,email:null,notes:null});}
  function clear(){states=Object.create(null);flights=Object.create(null);}
  global.CanonicalConferenceTransport=Object.freeze({isLinked:isLinked,hydrate:hydrate,getState:state,getVehicles:function(localId){var value=states[String(localId||'')];return copy(value&&value.vehicles||[]);},getActiveParticipations:participants,mutateVehicle:mutateVehicle,setAssignment:setAssignment,removeAssignment:removeAssignment,createParticipant:createParticipant,clear:clear});
})(window);
