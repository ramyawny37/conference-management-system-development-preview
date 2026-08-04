function getGuests() {
  var current = getCurrentConference();
  return current ? (current.guests || []) : [];
}

function getGuestById(id) {
  var guests = getGuests();
  for (var i = 0; i < guests.length; i++) {
    if (guests[i].id === id) {
      return guests[i];
    }
  }
  return null;
}

function normalizePersonRecord(person){
  person = person || {};
  var now = new Date().toISOString();
  return {
    id: person.id || uid(),
    fullName: String(person.fullName || person.name || '').trim(),
    church: String(person.church || '').trim(),
    phone: String(person.phone || '').trim(),
    gender: String(person.gender || '').trim(),
    age: person.age === undefined || person.age === null || person.age === '' ? '' : String(person.age).trim(),
    notes: String(person.notes || '').trim(),
    createdAt: person.createdAt || now,
    updatedAt: person.updatedAt || now
  };
}

function normalizePersonKey(value){
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getPeopleDb(){
  var current = getCurrentConference();
  if(!current) return { version: '1.0.0', people: [] };
  current.peopleDb = current.peopleDb || { version: '1.0.0', people: [] };
  current.peopleDb.version = current.peopleDb.version || '1.0.0';
  current.peopleDb.people = current.peopleDb.people || [];
  return current.peopleDb;
}

function getPeopleList(){
  return getPeopleDb().people;
}

function getPersonById(id){
  if(!id) return null;
  var people = getPeopleList();
  for(var i=0;i<people.length;i++){
    if(people[i].id === id) return people[i];
  }
  return null;
}

function findExistingPerson(fullName, phone){
  var nameKey = normalizePersonKey(fullName);
  if(!nameKey) return null;
  var phoneKey = normalizePersonKey(phone);
  var people = getPeopleList();
  for(var i=0;i<people.length;i++){
    var p = people[i];
    if(normalizePersonKey(p.fullName) !== nameKey) continue;
    var pPhone = normalizePersonKey(p.phone);
    if(phoneKey && pPhone && pPhone === phoneKey) return p;
    if(!phoneKey && !pPhone) return p;
  }
  for(var j=0;j<people.length;j++){
    var p2 = people[j];
    if(normalizePersonKey(p2.fullName) === nameKey) return p2;
  }
  return null;
}

function upsertPerson(personData, allowUpdate){
  var normalized = normalizePersonRecord(personData);
  if(!normalized.fullName) return null;
  var existing = findExistingPerson(normalized.fullName, normalized.phone);
  if(existing){
    if(allowUpdate){
      existing.church = normalized.church || existing.church || '';
      existing.phone = normalized.phone || existing.phone || '';
      existing.gender = normalized.gender || existing.gender || '';
      existing.age = normalized.age || existing.age || '';
      existing.notes = normalized.notes || existing.notes || '';
      existing.updatedAt = new Date().toISOString();
    }
    return existing;
  }
  getPeopleList().push(normalized);
  return normalized;
}

function resolvePersonName(personId, fallback){
  var person = getPersonById(personId);
  return person ? person.fullName : (fallback || '');
}

function normalizeConferencePeopleReferences(confObj){
  if(!confObj||typeof confObj!=='object')return confObj;
  var people=confObj.peopleDb&&Array.isArray(confObj.peopleDb.people)
    ?confObj.peopleDb.people:[];
  var peopleById={};
  people.forEach(function(person){
    if(person&&person.id)peopleById[String(person.id)]=person;
  });
  function resolvedName(record,fallback){
    record=record||{};
    var personId=record.personId||(!record.name?record.id:null);
    var person=personId?peopleById[String(personId)]:null;
    return person&&person.fullName?person.fullName:(fallback||record.name||'');
  }
  function normalizePerson(record){
    if(!record||typeof record!=='object')return;
    var name=resolvedName(record,record.name);
    if(name)record.name=name;
  }
  (confObj.houses||[]).forEach(function(house){
    (house.floors||[]).forEach(function(floor){
      (floor.rooms||[]).forEach(function(room){
        (room.guests||[]).forEach(normalizePerson);
        (room.children||[]).forEach(function(child){
          normalizePerson(child);
          if(child&&child.guardianPersonId){
            var guardian=peopleById[String(child.guardianPersonId)];
            if(guardian&&guardian.fullName)child.guardian=guardian.fullName;
          }
        });
      });
    });
  });
  (confObj.transports||[]).forEach(function(transport){
    (transport.seats||[]).forEach(function(seat){
      normalizePerson(seat);
      (seat.riders||[]).forEach(function(entry){
        normalizePerson(entry&&entry.r?entry.r:entry);
      });
    });
  });
  return confObj;
}

function linkRoomPeopleToDatabase(confObj){
  if(!confObj || !confObj.houses) return;
  (confObj.houses || []).forEach(function(house){
    (house.floors || []).forEach(function(floor){
      (floor.rooms || []).forEach(function(room){
        room.guests = room.guests || [];
        room.children = room.children || [];
        room.guests.forEach(function(g){
          if(typeof g === 'string') return;
          if(!g.personId && g.name){
            var gp = upsertPerson({ fullName: g.name }, false);
            if(gp) g.personId = gp.id;
          }
          if(g.personId) g.name = resolvePersonName(g.personId, g.name);
        });
        room.children.forEach(function(c){
          if(typeof c === 'string') return;
          if(!c.personId && c.name){
            var cp = upsertPerson({ fullName: c.name }, false);
            if(cp) c.personId = cp.id;
          }
          if(!c.guardianPersonId && c.guardian){
            var gp2 = upsertPerson({ fullName: c.guardian }, false);
            if(gp2) c.guardianPersonId = gp2.id;
          }
          if(c.personId) c.name = resolvePersonName(c.personId, c.name);
          if(c.guardianPersonId) c.guardian = resolvePersonName(c.guardianPersonId, c.guardian);
        });
      });
    });
  });
}

function personMetaText(person){
  if(!person) return '';
  var parts = [];
  if(person.church) parts.push(person.church);
  if(person.phone) parts.push(person.phone);
  if(person.gender) parts.push(person.gender);
  if(person.age) parts.push('العمر: ' + person.age);
  return parts.join(' • ');
}

function getAssignedPersonIdsInCurrentConference(excludeRoomId){
  var assigned = {};
  var current = getCurrentConference();
  if(!current || !current.houses) return assigned;
  (current.houses || []).forEach(function(house){
    (house.floors || []).forEach(function(floor){
      (floor.rooms || []).forEach(function(room){
        if(excludeRoomId && room.id === excludeRoomId) return;
        (room.guests || []).forEach(function(g){ if(g && g.personId) assigned[g.personId] = true; });
        (room.children || []).forEach(function(c){ if(c && c.personId) assigned[c.personId] = true; });
      });
    });
  });
  return assigned;
}

function isPersonAssignedElsewhere(personId, excludeRoomId){
  if(!personId) return false;
  return !!getAssignedPersonIdsInCurrentConference(excludeRoomId)[personId];
}

function refreshPeopleDatalist(options){
  options = options || {};
  var assigned = options.assignedMap || (options.excludeAssigned ? getAssignedPersonIdsInCurrentConference(options.excludeRoomId) : {});
  ['people_datalist', 'people_datalist_guardian'].forEach(function(listId){
    var listEl = ge(listId);
    if(!listEl) return;
    listEl.innerHTML = '';
    getPeopleList().forEach(function(person){
      if(listId === 'people_datalist' && assigned[person.id]) return;
      var opt = document.createElement('option');
      opt.value = person.fullName;
      opt.setAttribute('data-person-id', person.id);
      var meta = personMetaText(person);
      if(meta) opt.label = person.fullName + ' — ' + meta;
      listEl.appendChild(opt);
    });
  });
}

function openPeopleExcelImport(){
  var input = ge('peopleExcelInput');
  if(!input) return;
  input.click();
}

function normalizeImportHeaders(rawKey){
  return String(rawKey || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

function readImportField(row, aliases){
  var keys = Object.keys(row || {});
  var aliasMap = {};
  aliases.forEach(function(a){ aliasMap[normalizeImportHeaders(a)] = true; });
  for(var i=0;i<keys.length;i++){
    var key = keys[i];
    if(aliasMap[normalizeImportHeaders(key)]) return String(row[key] || '').trim();
  }
  return '';
}

function getAssignedPersonIdsInHouses(houses, excludeRoomId){
  var assigned = {};
  (houses || []).forEach(function(house){
    (house.floors || []).forEach(function(floor){
      (floor.rooms || []).forEach(function(room){
        if(excludeRoomId && room.id === excludeRoomId) return;
        (room.guests || []).forEach(function(g){ if(g && g.personId) assigned[g.personId] = true; });
        (room.children || []).forEach(function(c){ if(c && c.personId) assigned[c.personId] = true; });
      });
    });
  });
  return assigned;
}

function findPersonByName(name){
  var key = normalizePersonKey(name);
  if(!key) return null;
  var people = getPeopleList();
  for(var i=0;i<people.length;i++){
    if(normalizePersonKey(people[i].fullName) === key) return people[i];
  }
  return null;
}
