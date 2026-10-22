function isCanonicalTransportConference(conference){
  return !!(conference&&window.CanonicalConferenceTransport&&window.CanonicalConferenceTransport.isLinked(conference.id));
}

function getConferenceTransportVehicles(conference){
  if(!conference)return [];
  if(!isCanonicalTransportConference(conference))return conference.transports||[];
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
  var current = getCurrentConference();
  if (!current) return {};
  var n={};
  getConferenceTransportVehicles(current).forEach(function(t){
    (t.seats || []).forEach(function(s){
      if(s.name&&s.type!=='child_shared'&&s.type!=='infant')n[s.name]=true;
    });
  });
  return n;
}

function activeGuests(day){ // day=undefined means current/total
  var current = getCurrentConference();
  if (!current) return { adults: [], children: [] };
  if(isCanonicalTransportConference(current)){
    var operational=getConferenceOperationalResidents(current,day),adults=[],children=[];
    operational.all.forEach(function(person){
      var item={name:person.name||'',room:person.room||'',rid:person.rid||'',personId:person.personId||'',participationId:person.participationId||'',guardian:person.guardianFullName||'',guardianPersonId:person.guardianPersonId||'',guardianParticipationId:person.guardianParticipationId||null,guardianParticipationStatus:person.guardianParticipationStatus||null};
      if(person.isChild)children.push(item);else adults.push(item);
    });
    return {adults:adults,children:children};
  }
  var adults=[],children=[];
  getAllRooms().forEach(function(r) {
    if (!isRoomActiveOnDay(r, day)) return;
    getConferenceRoomPeopleOnDay(r,day,current).forEach(function(person){
      var item={name:person.name||gn(person),room:r.number,rid:r.id,personId:person.personId||'',participationId:person.participationId||'',guardian:person.guardianFullName||person.guardian||'',guardianPersonId:person.guardianPersonId||'',guardianParticipationId:person.guardianParticipationId||null,guardianParticipationStatus:person.guardianParticipationStatus||null};
      if(person.isChild)children.push(item);else adults.push(item);
    });
  });
  return {adults:adults,children:children};
}

function unassigned(curName){
  var current=getCurrentConference();
  if(isCanonicalTransportConference(current)){
    var assigned={};
    getConferenceTransportVehicles(current).forEach(function(vehicle){(vehicle.seats||[]).forEach(function(seat){if(seat.participationId)assigned[seat.participationId]=true;(seat.riders||[]).forEach(function(stored){var rider=stored&&stored.r?stored.r:stored;if(rider&&rider.participationId)assigned[rider.participationId]=true;});});});
    var active=activeGuests(),all=active.adults.concat(active.children);
    return all.filter(function(item){return !assigned[item.participationId]||item.name===curName;});
  }
  var assigned=assignedNames();
  var ag = activeGuests();
  var allActive = ag.adults.concat(ag.children);
  var unassignedGuests = [];
  for (var i = 0; i < allActive.length; i++) {
    if (!assigned[allActive[i].name] || allActive[i].name === curName) {
      unassignedGuests.push(allActive[i]);
    }
  }
  return unassignedGuests;
}

function allGuestsForPick(){
  var l=[];
  var current=getCurrentConference();
  if(isCanonicalTransportConference(current)){
    return getConferenceOperationalResidents(current).all.map(function(person){return {name:person.name||'',room:person.room||'',guardian:person.guardianFullName||null,personId:person.personId||'',participationId:person.participationId||'',guardianParticipationId:person.guardianParticipationId||null,guardianParticipationStatus:person.guardianParticipationStatus||null};}).sort(function(a,b){return a.name.localeCompare(b.name,'ar');});
  }
  getAllRooms().forEach(function(r){if(r.closed)return;getConferenceRoomPeopleOnDay(r,undefined,current).forEach(function(person){l.push({name:person.name||gn(person),room:r.number,guardian:person.isChild?(person.guardianFullName||person.guardian||''):null,personId:person.personId||'',guardianPersonId:person.guardianPersonId||'',guardianParticipationStatus:person.guardianParticipationStatus||null})})});
  return l.sort(function(a,b){return a.name.localeCompare(b.name,'ar')});
}
