(function(global){
  'use strict';
  var states=Object.create(null),flights=Object.create(null),sessionEpoch=0;
  function copy(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function operationId(){return global.crypto&&global.crypto.randomUUID?global.crypto.randomUUID():String(Date.now())+'-0000-4000-8000-'+Math.random().toString(16).slice(2,14).padEnd(12,'0');}
  // Canonical conference ID is the sole identity; no local/cloud link lookup.
  function isLinked(conferenceId){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(conferenceId||''));}
  function remoteId(conferenceId){
    var id=String(conferenceId||'');
    if(!id||!states[id])throw new Error('CANONICAL_CONFERENCE_NOT_HYDRATED');
    return String(states[id].remoteConferenceId||id);
  }
  function invoke(operation,args){var session=global.PlatformDeviceSession;if(!session||typeof session.invokeModuleProtected!=='function')return Promise.reject(new Error('PLATFORM_DEVICE_SESSION_REQUIRED'));return session.invokeModuleProtected('conference',operation,args||{});}
  function projection(localId,response){
    var assignments=Array.isArray(response&&response.assignments)?response.assignments:[],byVehicle=Object.create(null);
    var vehicles=(Array.isArray(response&&response.vehicles)?response.vehicles:[]).map(function(vehicle){
      var seats=[];for(var number=1;number<=Number(vehicle.capacity);number++)seats.push({seat:number,name:'',room:'',type:'adult',note:'',riders:[]});
      var item={id:String(vehicle.vehicleId),name:String(vehicle.name||''),icon:String(vehicle.icon||'🚌'),capacity:Number(vehicle.capacity),position:Number(vehicle.position||0),revision:Number(vehicle.revision),seats:seats};byVehicle[item.id]=item;return item;
    });
    assignments.filter(function(item){return item&&item.mode==='independent'&&item.participationStatus==='active'&&item.roomNumber!==null&&item.roomNumber!==undefined;}).forEach(function(item){
      var vehicle=byVehicle[String(item.vehicleId)],seat=vehicle&&vehicle.seats[Number(item.seatNumber)-1];if(!seat)return;
      seat.name=String(item.person&&item.person.fullName||'');seat.room=String(item.roomNumber||'');seat.type=item.riderKind==='adult'?'adult':'child_seat';seat.personId=String(item.person&&item.person.personId||'');seat.participationId=String(item.participationId);seat.assignmentId=String(item.assignmentId);seat.revision=Number(item.revision);seat.guardianParticipationId=item.guardianParticipationId||null;
    });
    assignments.filter(function(item){return item&&item.mode==='shared'&&item.participationStatus==='active'&&item.roomNumber!==null&&item.roomNumber!==undefined;}).forEach(function(item){
      var vehicle=byVehicle[String(item.vehicleId)],guardian=assignments.find(function(candidate){return candidate.mode==='independent'&&candidate.vehicleId===item.vehicleId&&candidate.participationId===item.guardianParticipationId&&candidate.participationStatus==='active'&&candidate.roomNumber!==null&&candidate.roomNumber!==undefined;}),seat=vehicle&&guardian&&vehicle.seats[Number(guardian.seatNumber)-1];if(!seat)return;
      seat.riders.push({r:{name:String(item.person&&item.person.fullName||''),room:String(item.roomNumber||''),type:item.riderKind==='infant'?'infant':'child_shared',personId:String(item.person&&item.person.personId||''),participationId:String(item.participationId),assignmentId:String(item.assignmentId),revision:Number(item.revision),guardianParticipationId:item.guardianParticipationId||null,guardianSeat:Number(guardian.seatNumber)}});
    });
    return {localConferenceId:String(localId),remoteConferenceId:String(response&&response.conferenceId||''),canManage:response&&response.canManage===true,vehicles:vehicles,assignments:assignments};
  }
  function hydrate(localId,authorizedRemoteId){
    localId=String(localId||'');
    var conferenceId=String(authorizedRemoteId||localId);
    if(!conferenceId)return Promise.reject(new Error('CANONICAL_CONFERENCE_ID_REQUIRED'));
    if(flights[localId])return flights[localId];
    var epoch=sessionEpoch;
    var flight=invoke('get_conference_transport',{p_conference_id:conferenceId}).then(function(response){
      if(epoch!==sessionEpoch)throw new Error('CANONICAL_CONFERENCE_SESSION_STALE');
      if(!response||String(response.conferenceId||'')!==conferenceId)throw new Error('CANONICAL_CONFERENCE_RESPONSE_ID_MISMATCH');
      var next=projection(localId,response);
      if(epoch!==sessionEpoch)throw new Error('CANONICAL_CONFERENCE_SESSION_STALE');
      states[localId]=next;
      return copy(next);
    });
    flights[localId]=flight.then(function(value){
      if(flights[localId]===tracked)delete flights[localId];
      return value;
    },function(error){
      if(flights[localId]===tracked)delete flights[localId];
      throw error;
    });
    var tracked=flights[localId];
    return tracked;
  }
  function state(localId){return copy(states[String(localId||'')]||null);}
  function refreshAfter(localId,promise){var conferenceId=remoteId(localId);return promise.then(function(result){return hydrate(localId,conferenceId).then(function(){return result;});});}
  function mutateVehicle(localId,draft){draft=draft||{};return refreshAfter(localId,invoke('mutate_conference_transport_vehicle',{p_operation_id:operationId(),p_operation:String(draft.operation||''),p_conference_id:remoteId(localId),p_vehicle_id:draft.vehicleId?String(draft.vehicleId):null,p_expected_revision:draft.expectedRevision==null?null:Number(draft.expectedRevision),p_name:draft.name==null?null:String(draft.name),p_icon:draft.icon==null?null:String(draft.icon),p_capacity:draft.capacity==null?null:Number(draft.capacity),p_position:draft.position==null?null:Number(draft.position),p_remove_overflow:draft.removeOverflow===true}));}
  function setAssignment(localId,draft){draft=draft||{};return refreshAfter(localId,invoke('set_conference_transport_assignment',{p_operation_id:operationId(),p_conference_id:remoteId(localId),p_participation_id:String(draft.participationId||''),p_vehicle_id:String(draft.vehicleId||''),p_mode:String(draft.mode||'independent'),p_rider_kind:String(draft.riderKind||'adult'),p_seat_number:draft.seatNumber==null?null:Number(draft.seatNumber),p_expected_revision:draft.expectedRevision==null?null:Number(draft.expectedRevision)}));}
  function removeAssignment(localId,assignmentId,revision){return refreshAfter(localId,invoke('remove_conference_transport_assignment',{p_operation_id:operationId(),p_assignment_id:String(assignmentId||''),p_expected_revision:Number(revision)}));}
  function clear(){sessionEpoch++;states=Object.create(null);flights=Object.create(null);}
  global.CanonicalConferenceTransport=Object.freeze({isLinked:isLinked,hydrate:hydrate,getState:state,getVehicles:function(localId){var value=states[String(localId||'')];return copy(value&&value.vehicles||[]);},mutateVehicle:mutateVehicle,setAssignment:setAssignment,removeAssignment:removeAssignment,clear:clear});
})(window);
