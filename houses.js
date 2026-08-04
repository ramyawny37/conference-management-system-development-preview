function getHouseById(houseId) {
  var current = getCurrentConference();
  if (!current || !current.houses) return null;
  var houses = current.houses || [];
  for (var i = 0; i < houses.length; i++) {
    if (houses[i].id === houseId) {
      return houses[i];
    }
  }
  return null;
}

function getRoomByContext(houseId, floorId, roomId) {
  var house = getHouseById(houseId);
  if (!house) return null;
  var floor = null;
  var floors = house.floors || [];
  for (var i = 0; i < floors.length; i++) {
    if (floors[i].id === floorId) {
      floor = floors[i];
      break;
    }
  }
  if (!floor) return null;
  var rooms = floor.rooms || [];
  for (var i = 0; i < rooms.length; i++) {
    if (rooms[i].id === roomId) {
      return { room: rooms[i], floor: floor, house: house };
    }
  }
  return null;
}

function getRoomStats(room) {
  if (!room) return { activeGuests: 0, activeChildren: 0, totalOccupants: 0, leftGuests: 0 };
  var activeGuests = 0, activeChildren = 0, leftGuests = 0;
  (room.guests || []).forEach(function(g) {
    if (!gl(g)) {
      activeGuests++;
    } else {
      leftGuests++;
    }
  });
  (room.children || []).forEach(function(c) {
    if (!c.leftDay) activeChildren++;
  });
  return { activeGuests: activeGuests, activeChildren: activeChildren, totalOccupants: activeGuests + activeChildren, leftGuests: leftGuests };
}

function getRoomExtraBedsCount(room){
  var count=room?Number(room.extraBeds):0;
  return isFinite(count)&&count>0?Math.floor(count):0;
}

function getRoomActiveBedGuests(room){
  return (room&&room.guests||[]).filter(function(guest){
    return typeof gl==='function'?!gl(guest):!(guest&&guest.leftDay);
  });
}

function buildTemporaryRoomBeds(room){
  if(!room)return [];
  var baseBeds=typeof getRoomBaseCapacity==='function'
    ?getRoomBaseCapacity(room)
    :(Array.isArray(room.beds)?room.beds.length:Math.max(0,parseInt(room.beds,10)||0));
  var extraBeds=getRoomExtraBedsCount(room);
  var totalBeds=baseBeds+extraBeds;
  var guests=getRoomActiveBedGuests(room);
  var beds=[];
  for(var index=0;index<totalBeds;index++){
    var guest=guests[index]||null;
    beds.push({
      id:String(room.id||'room')+'-'+(index<baseBeds?'base':'extra')+'-'+(index+1),
      status:guest?'occupied':'available',
      guestId:guest?(guest.id||guest.guestId||guest.personId||'guest-'+(index+1)):'',
      bedType:index<baseBeds?'base':'extra',
      temporary:true
    });
  }
  return beds;
}

function getRoomBeds(room) {
  if (!room) return [];
  if(Array.isArray(room.beds)){
    var legacyBeds=room.beds.slice();
    var extraBeds=getRoomExtraBedsCount(room);
    var guests=getRoomActiveBedGuests(room);
    for(var index=0;index<extraBeds;index++){
      var guest=guests[room.beds.length+index]||null;
      legacyBeds.push({
        id:String(room.id||'room')+'-extra-'+(index+1),
        status:guest?'occupied':'available',
        guestId:guest?(guest.id||guest.guestId||guest.personId||'guest-extra-'+(index+1)):'',
        bedType:'extra',
        temporary:true
      });
    }
    return legacyBeds;
  }
  return buildTemporaryRoomBeds(room);
}

function getAvailableBeds(room) {
  if (!room) return [];
  var roomBeds=getRoomBeds(room);
  var available = [];
  for (var i = 0; i < roomBeds.length; i++) {
    if (!roomBeds[i].guestId || roomBeds[i].status === 'available') {
      available.push(roomBeds[i]);
    }
  }
  return available;
}

function getOccupiedBeds(room) {
  if (!room) return [];
  var roomBeds=getRoomBeds(room);
  var occupied = [];
  for (var i = 0; i < roomBeds.length; i++) {
    if (roomBeds[i].guestId && roomBeds[i].status === 'occupied') {
      occupied.push(roomBeds[i]);
    }
  }
  return occupied;
}

function countRoomOccupancy(room){
  var adults = 0;
  (room.guests || []).forEach(function(g){ if(!gl(g)) adults++; });
  return adults;
}

function normalizeAccommodationArrivalDay(value,days){
  days=parseInt(days,10);
  if(!isFinite(days)||days<1)days=1;
  var arrivalDay=parseInt(value,10);
  if(!isFinite(arrivalDay)||arrivalDay<1)arrivalDay=1;
  if(arrivalDay>days)arrivalDay=days;
  return arrivalDay;
}

function isAccommodationStayRangeValid(arrivalDay,leftDay,days){
  arrivalDay=normalizeAccommodationArrivalDay(arrivalDay,days);
  if(leftDay===null||leftDay===undefined||leftDay==='')return true;
  leftDay=parseInt(leftDay,10);
  return isFinite(leftDay)&&leftDay>arrivalDay;
}

function syncRoomGuestBedTypes(room){
  if(!room) return room;
  var baseCapacity = typeof getRoomBaseCapacity==='function'
    ?(getRoomBaseCapacity(room)||1)
    :(Array.isArray(room.beds)?room.beds.length:(parseInt(room.beds,10)||1));
  var days=typeof getDays==='function'?getDays():1;
  (room.guests || []).forEach(function(guest,index){
    if(!guest || typeof guest !== 'object') return;
    guest.arrivalDay=normalizeAccommodationArrivalDay(guest.arrivalDay,days);
    if(index >= baseCapacity){
      guest.bedType = 'extra';
      if(guest.extraBedPersonType!=='adult'&&guest.extraBedPersonType!=='child') delete guest.extraBedPersonType;
    }else{
      if(Object.prototype.hasOwnProperty.call(guest,'bedType')) delete guest.bedType;
      if(Object.prototype.hasOwnProperty.call(guest,'extraBedPersonType')) delete guest.extraBedPersonType;
    }
  });
  (room.children||[]).forEach(function(child){
    if(child&&typeof child==='object'){
      child.arrivalDay=normalizeAccommodationArrivalDay(child.arrivalDay,days);
    }
  });
  return room;
}

function prepareTransfer(sourceRoom, targetRoom, guestsToMoveCount, options) {
  options = options || {};

  if (!targetRoom) {
    return { canTransfer: false, needsExtraBeds: 0, reason: 'INVALID_TARGET', message: 'الغرفة الهدف غير صالحة.' };
  }
  if (!sourceRoom || sourceRoom.id === targetRoom.id) {
    return { canTransfer: false, needsExtraBeds: 0, reason: 'SAME_ROOM', message: 'لا يمكن النقل إلى نفس الغرفة.' };
  }
  if (targetRoom.closed) {
    return { canTransfer: false, needsExtraBeds: 0, reason: 'ROOM_CLOSED', message: 'الغرفة الهدف مغلقة.' };
  }
  if (options.sameHouseOnly && options.sourceHouseId && options.targetHouseId && options.sourceHouseId !== options.targetHouseId) {
    return { canTransfer: false, needsExtraBeds: 0, reason: 'DIFFERENT_HOUSE', message: 'لا يمكن نقل غرفة كاملة إلى بيت آخر.' };
  }

  var currentOccupancy = countRoomOccupancy(targetRoom);
  var baseCapacity = typeof targetRoom.beds === 'number' ? targetRoom.beds : (targetRoom.beds ? targetRoom.beds.length : 1);
  var extraBeds = parseInt(targetRoom.extraBeds || 0, 10);
  var totalCapacity = baseCapacity + extraBeds;
  var finalOccupancy = currentOccupancy + guestsToMoveCount;

  var neededExtraBeds = 0;
  var isSufficient = finalOccupancy <= totalCapacity;
  if (!isSufficient) {
    neededExtraBeds = finalOccupancy - (baseCapacity + extraBeds);
  }

  return {
    canTransfer: true,
    needsExtraBeds: neededExtraBeds,
    isCapacitySufficient: isSufficient,
    reason: null
  };
}

function getAllBeds() {
  var allBeds = [];
  getAllRooms().forEach(function(room) {
    getRoomBeds(room).forEach(function(bed) {
      // ES5 compatible object creation with context
      var bedWithContext = {}; // Create a new object
      for (var key in bed) {
        if (Object.prototype.hasOwnProperty.call(bed, key)) {
          bedWithContext[key] = bed[key];
        }
      }
      bedWithContext.room = room; // Add context
      allBeds.push(bedWithContext);
    });
  });
  return allBeds;
}

function getBedById(bedId) {
  var allBeds = getAllBeds();
  for (var i = 0; i < allBeds.length; i++) {
    if (allBeds[i].id === bedId) {
      return allBeds[i];
    }
  }
  return null;
}

function getHouseTemplateById(id) {
  var templates = appData.houseTemplates || [];
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === id) {
      return templates[i];
    }
  }
  return null;
}

function ensureSelectedHouseTemplate() {
  var templates = appData.houseTemplates || [];
  if (!templates.length) {
    selectedHouseTemplateId = null;
    return null;
  }
  var selected = getHouseTemplateById(selectedHouseTemplateId);
  if (!selected) {
    selectedHouseTemplateId = templates[0].id;
    selected = templates[0];
  }
  return selected;
}

function selectHouseTemplate(id) {
  selectedHouseTemplateId = id;
  ensureSelectedHouseTemplate();
  renderSettings();
}

function countTemplateRooms(house) {
  var total = 0;
  if (!house || !house.floors) return 0;
  house.floors.forEach(function(floor) {
    total += (floor.rooms || []).length;
  });
  return total;
}

function normalizeHouseTemplateStructure(house){
  if(!house) return null;
  house.id = house.id || uid();
  house.name = house.name || 'بيت ' + house.id.slice(0,4);
  house.description = house.description || '';
  house.floors = house.floors || [];
  house.floors.forEach(function(floor){
    if(!floor.id) floor.id = uid();
    floor.name = floor.name || 'دور ' + floor.id.slice(0,4);
    floor.rooms = floor.rooms || [];
    floor.rooms.forEach(function(room){
      if(!room.id) room.id = uid();
      room.number = room.number || room.name || 'غرفة ' + room.id.slice(0,4);
      room.beds = typeof room.beds === 'number' ? room.beds : (parseInt(room.beds, 10) || 1);
      room.extraBeds = typeof room.extraBeds === 'number' ? room.extraBeds : (parseInt(room.extraBeds, 10) || 0);
      room.notes = room.notes || '';
      room.guests = room.guests || [];
      room.children = room.children || [];
      room.guests.forEach(function(guest){
        if(guest&&typeof guest==='object')guest.arrivalDay=normalizeAccommodationArrivalDay(guest.arrivalDay,typeof getDays==='function'?getDays():1);
      });
      room.children.forEach(function(child){
        if(child&&typeof child==='object')child.arrivalDay=normalizeAccommodationArrivalDay(child.arrivalDay,typeof getDays==='function'?getDays():1);
      });
      room.closed = !!room.closed;
      room.closedDay = room.closedDay === undefined ? null : room.closedDay;
    });
  });
  return house;
}

function getConferenceHousePreflight(house) {
  var result = { floorCount: 0, roomCount: 0, guestCount: 0, childCount: 0, occupantCount: 0, roomIds: [] };
  if (!house) return result;
  result.floorCount = (house.floors || []).length;
  (house.floors || []).forEach(function(floor) {
    (floor.rooms || []).forEach(function(room) {
      result.roomCount++;
      result.guestCount += (room.guests || []).length;
      result.childCount += (room.children || []).length;
      if (room.id) result.roomIds.push(room.id);
    });
  });
  result.occupantCount = result.guestCount + result.childCount;
  return result;
}

function getConferenceHousesPreflight(houses) {
  var result = { houseCount: 0, floorCount: 0, roomCount: 0, guestCount: 0, childCount: 0, occupantCount: 0, roomIds: [] };
  (houses || []).forEach(function(house) {
    var houseResult = getConferenceHousePreflight(house);
    result.houseCount++;
    result.floorCount += houseResult.floorCount;
    result.roomCount += houseResult.roomCount;
    result.guestCount += houseResult.guestCount;
    result.childCount += houseResult.childCount;
    result.roomIds = result.roomIds.concat(houseResult.roomIds);
  });
  result.occupantCount = result.guestCount + result.childCount;
  return result;
}

function findRoomInHouses(houses, houseId, floorId, roomId){
  var found = null;
  (houses || []).forEach(function(house){
    if(found || (houseId && house.id !== houseId)) return;
    (house.floors || []).forEach(function(floor){
      if(found || (floorId && floor.id !== floorId)) return;
      (floor.rooms || []).forEach(function(room){
        if(found || room.id !== roomId) return;
        found = { house: house, floor: floor, room: room };
      });
    });
  });
  return found;
}

function findRoomByIdInHouses(houses, roomId){
  return findRoomInHouses(houses, null, null, roomId);
}

function isRoomActiveOnDay(room, day) {
  if (!room || room.closed !== true) return true;
  if (room.closedDay === undefined || room.closedDay === null || room.closedDay === '') return false;
  if (day === undefined || day === null || day === '') return false;
  return day < parseInt(room.closedDay, 10);
}

function ensureAccommodationDisplayState(conference){
  if(!conference) return {};
  var allRoomIds = [];
  (conference.houses || []).forEach(function(house){
    (house.floors || []).forEach(function(floor){
      (floor.rooms || []).forEach(function(room){
        if(room && room.id) allRoomIds.push(room.id);
      });
    });
  });
  if(!Array.isArray(conference.accommodationDisplayedRoomIds)){
    conference.accommodationDisplayedRoomIds = [];
  }
  if(conference.accommodationDisplayStateInitialized!==true&&
    conference.accommodationDisplayedRoomIds.length===0){
    conference.accommodationDisplayedRoomIds = allRoomIds.slice();
  }
  conference.accommodationDisplayStateInitialized = true;
  var valid = {};
  allRoomIds.forEach(function(id){ valid[id] = true; });
  var seen = {};
  conference.accommodationDisplayedRoomIds = conference.accommodationDisplayedRoomIds.filter(function(id){
    if(!id || seen[id]) return false;
    seen[id] = true;
    return !!valid[id];
  });
  var out = {};
  conference.accommodationDisplayedRoomIds.forEach(function(id){ out[id] = true; });
  return out;
}

function getAccommodationRoomsPreflight(rooms){
  var result = { roomCount: 0, occupiedRoomCount: 0, guestCount: 0, childCount: 0, occupantCount: 0, roomIds: [], occupiedRooms: [] };
  var seen = {};
  (rooms || []).forEach(function(room){
    if(!room || !room.id || seen[room.id]) return;
    seen[room.id] = true;
    var guestCount = (room.guests || []).length;
    var childCount = (room.children || []).length;
    result.roomCount++;
    result.roomIds.push(room.id);
    result.guestCount += guestCount;
    result.childCount += childCount;
    if(guestCount || childCount){
      result.occupiedRoomCount++;
      result.occupiedRooms.push(room);
    }
  });
  result.occupantCount = result.guestCount + result.childCount;
  return result;
}

function prepareAccommodationDisplayedRoomIds(conference, roomIds, checked){
  if(!conference) return { ok: false, ids: [] };
  var valid = {};
  (conference.houses || []).forEach(function(house){
    (house.floors || []).forEach(function(floor){
      (floor.rooms || []).forEach(function(room){ if(room && room.id) valid[room.id] = true; });
    });
  });
  var seen = {};
  var ids = [];
  (conference.accommodationDisplayedRoomIds || []).forEach(function(id){
    if(valid[id] && !seen[id]){ seen[id] = true; ids.push(id); }
  });
  for(var i=0;i<(roomIds || []).length;i++){
    if(!valid[roomIds[i]]) return { ok: false, ids: ids };
  }
  var requested = {};
  (roomIds || []).forEach(function(id){ requested[id] = true; });
  if(checked){
    (roomIds || []).forEach(function(id){ if(!seen[id]){ seen[id] = true; ids.push(id); } });
  }else{
    ids = ids.filter(function(id){ return !requested[id]; });
  }
  return { ok: true, ids: ids };
}

function commitAccommodationDisplayChange(conference, nextIds, roomsToClear){
  (roomsToClear || []).forEach(function(room){
    room.guests = [];
    room.children = [];
  });
  conference.accommodationDisplayedRoomIds = nextIds;
  conference.accommodationDisplayStateInitialized = true;
}

function saveHouseData(conference, houseId, houseData) {
  if (!conference) {
    return { ok: false, reason: 'NO_CONFERENCE' };
  }
  if (!houseData || !houseData.name) {
    return { ok: false, reason: 'INVALID_DATA' };
  }

  conference.houses = conference.houses || [];

  if (houseId) {
    // Update existing house
    var houseToUpdate = null;
    for (var i = 0; i < conference.houses.length; i++) {
      if (conference.houses[i].id === houseId) {
        houseToUpdate = conference.houses[i];
        break;
      }
    }

    if (!houseToUpdate) {
      return { ok: false, reason: 'NOT_FOUND' };
    }

    normalizeHouseStructure(houseToUpdate);
    houseToUpdate.name = houseData.name;
    houseToUpdate.description = houseData.description;
    return { ok: true, action: 'updated', house: houseToUpdate };

  } else {
    // Add new house
    var newHouse = createDefaultHouse(houseData.name, houseData.description);
    // The ID is already set by createDefaultHouse, no need for newHouse.id = uid();
    normalizeHouseStructure(newHouse);
    conference.houses.push(newHouse);
    return { ok: true, action: 'added', house: newHouse };
  }
}

function setRoomDisplayedInAccommodation(conference, roomId, checked){
  if(!conference || !roomId) return;
  var prepared = prepareAccommodationDisplayedRoomIds(conference, [roomId], checked);
  if(!prepared.ok) return;
  commitAccommodationDisplayChange(conference, prepared.ids, []);
}

function getActiveRoomIdsMap(){
  var current = getCurrentConference();
  return ensureAccommodationDisplayState(current);
}
