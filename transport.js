function isCanonicalTransportConference(conference){
  return !!(conference&&window.CanonicalConferenceTransport&&window.CanonicalConferenceTransport.isLinked(conference.id));
}

function getConferenceTransportVehicles(conference){
  if(!isCanonicalTransportConference(conference))return [];
  var eligible=getConferenceOperationalResidents(conference).byParticipationId;
  return window.CanonicalConferenceTransport.getVehicles(conference.id).map(function(vehicle){
    var visible=Object.assign({},vehicle);
    visible.seats=(vehicle.seats||[]).map(function(seat){
      var projected=Object.assign({},seat,{riders:(seat.riders||[]).filter(function(stored){var rider=stored&&stored.r?stored.r:stored;return !!eligible[String(rider&&rider.participationId||'')];})});
      if(!projected.participationId||eligible[String(projected.participationId)])return projected;
      return {seat:projected.seat,name:'',room:'',type:'adult',note:'',riders:[]};
    });
    return visible;
  });
}

function assignedNames(){
  var current=getCurrentConference(),assigned={};
  getConferenceTransportVehicles(current).forEach(function(vehicle){
    (vehicle.seats||[]).forEach(function(seat){
      if(seat.participationId)assigned[seat.participationId]=true;
      (seat.riders||[]).forEach(function(stored){
        var rider=stored&&stored.r?stored.r:stored;
        if(rider&&rider.participationId)assigned[rider.participationId]=true;
      });
    });
  });
  return assigned;
}

function activeGuests(day){
  var current=getCurrentConference();
  if(!isCanonicalTransportConference(current))return {adults:[],children:[]};
  var operational=getConferenceOperationalResidents(current,day),adults=[],children=[];
  operational.all.forEach(function(person){
    var item={name:person.name||'',room:person.room||'',rid:person.rid||'',personId:person.personId||'',participationId:person.participationId||'',guardian:person.guardianFullName||'',guardianPersonId:person.guardianPersonId||'',guardianParticipationId:person.guardianParticipationId||null,guardianParticipationStatus:person.guardianParticipationStatus||null};
    if(person.isChild)children.push(item);else adults.push(item);
  });
  return {adults:adults,children:children};
}

function unassigned(currentParticipationId){
  var current=getCurrentConference();
  if(!isCanonicalTransportConference(current))return [];
  var assigned=assignedNames(),active=activeGuests(),all=active.adults.concat(active.children);
  return all.filter(function(item){return !assigned[item.participationId]||item.participationId===currentParticipationId;});
}

function allGuestsForPick(){
  var current=getCurrentConference();
  if(!isCanonicalTransportConference(current))return [];
  return getConferenceOperationalResidents(current).all.map(function(resident){
    return {name:resident.name||'',room:resident.room||'',guardian:resident.guardianFullName||null,personId:resident.personId||'',participationId:resident.participationId||'',guardianParticipationId:resident.guardianParticipationId||null,guardianParticipationStatus:resident.guardianParticipationStatus||null};
  }).sort(function(a,b){return a.name.localeCompare(b.name,'ar');});
}
