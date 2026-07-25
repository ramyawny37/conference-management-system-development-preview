function assignedNames(){
  var current = getCurrentConference();
  if (!current) return {};
  var n={};
  (current.transports || []).forEach(function(t){
    (t.seats || []).forEach(function(s){
      if(s.name&&s.type!=='child_shared'&&s.type!=='infant')n[s.name]=true;
    });
  });
  return n;
}

function activeGuests(day){ // day=undefined means current/total
  var current = getCurrentConference();
  if (!current) return { adults: [], children: [] };
  var adults=[],children=[];
  getAllRooms().forEach(function(r) {
    if (!isRoomActiveOnDay(r, day)) return;
    (r.guests || []).forEach(function(g) { if (!gl(g, day)) adults.push({ name: gn(g), room: r.number, rid: r.id, personId: g && g.personId ? g.personId : '' }); });
    (r.children || []).forEach(function(c) { if (!gl(c, day)) children.push({ name: c.name, room: r.number, rid: r.id, guardian: c.guardian, personId: c.personId || '', guardianPersonId: c.guardianPersonId || '' }); });
  });
  return {adults:adults,children:children};
}

function unassigned(curName){
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
  getAllRooms().forEach(function(r){if(r.closed)return;(r.guests||[]).forEach(function(g){if(!gl(g))l.push({name:gn(g),room:r.number,guardian:null,personId:g&&g.personId?g.personId:''})});(r.children||[]).forEach(function(c){if(!c.leftDay)l.push({name:c.name,room:r.number,guardian:c.guardian,personId:c.personId||'',guardianPersonId:c.guardianPersonId||''})})});
  return l.sort(function(a,b){return a.name.localeCompare(b.name,'ar')});
}
