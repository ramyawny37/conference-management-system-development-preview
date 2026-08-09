function ht_renderTemplate(template) {
  var container = ge('ht_floors_container');
  container.innerHTML = '';
  if (!template || !template.floors || !template.floors.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#95a5a6;">ابدأ بإضافة دور...</div>';
    return;
  }
  template.floors.forEach(function(floor) {
    var floorHtml = '<div class="ht-floor-box" id="ht_floor_'+floor.id+'" data-floor-id="'+esc(floor.id)+'">'
      + '<div class="ht-floor-head"><input class="ht-floor-name" value="'+esc(floor.name)+'" placeholder="اسم الدور"><button class="btn btn-red btn-sm" onclick="ht_deleteFloor(\''+floor.id+'\')">✕</button></div>'
      + '<div class="ht-rooms-container">';
    if (floor.rooms && floor.rooms.length) {
      floor.rooms.forEach(function(room) {
        floorHtml += ht_roomHtml(floor.id, room);
      });
    }
    floorHtml += '</div><button class="btn btn-teal btn-sm" onclick="ht_addRoom(\''+floor.id+'\')">+ غرفة</button></div>';
    container.innerHTML += floorHtml;
  });
}

function ht_addFloor() {
  var floorId = uid();
  var container = ge('ht_floors_container');
  if(container.innerHTML.includes('ابدأ بإضافة دور')) container.innerHTML = '';
  var floorHtml = '<div class="ht-floor-box" id="ht_floor_'+floorId+'">'
      + '<div class="ht-floor-head"><input class="ht-floor-name" value="دور جديد" placeholder="اسم الدور"><button class="btn btn-red btn-sm" onclick="ht_deleteFloor(\''+floorId+'\')">✕</button></div>'
      + '<div class="ht-rooms-container"></div><button class="btn btn-teal btn-sm" onclick="ht_addRoom(\''+floorId+'\')">+ غرفة</button></div>';
  container.insertAdjacentHTML('beforeend', floorHtml);
}

function ht_deleteFloor(floorId) {
  if (editHouseTemplateId && getHouseTemplateById(editHouseTemplateId)) {
    ht_deleteFloorFromTemplate(editHouseTemplateId, floorId);
    return;
  }
  if(confirm('حذف الدور بكل غرفه؟')) ge('ht_floor_'+floorId).remove();
}

function ht_addRoomToTemplate(houseId, floorId) {
  openTemplateRoomModal(houseId, floorId, null);
}

function ht_deleteRoomFromTemplate(houseId, floorId, roomId) {
  var house = getHouseTemplateById(houseId);
  if (!house || !house.floors) return;
  var floor = null;
  for (var i = 0; i < house.floors.length; i++) {
    if (house.floors[i].id === floorId) {
      floor = house.floors[i];
      break;
    }
  }
  if (!floor || !floor.rooms || !floor.rooms.length) return;
  var targetRoom = null;
  floor.rooms.forEach(function(room) {
    if (!targetRoom && room.id === roomId) targetRoom = room;
  });
  if (!targetRoom) return;
  var occupantCount = (targetRoom.guests || []).length + (targetRoom.children || []).length;
  var message = occupantCount
    ? 'حذف الغرفة "' + (targetRoom.number || 'بدون رقم') + '"؟ تحتوي على ' + occupantCount + ' نزيل، وسيتم حذفها من خريطة البيت.'
    : 'حذف الغرفة "' + (targetRoom.number || 'بدون رقم') + '" من خريطة البيت؟';
  if (!confirm(message)) return;
  var previousAppData = deepClone(appData);
  var previousSelectedHouseTemplateId = selectedHouseTemplateId;
  var rooms = [];
  (floor.rooms || []).forEach(function(room) {
    if (room.id !== roomId) rooms.push(room);
  });
  floor.rooms = rooms;
  selectedHouseTemplateId = house.id;
  if (!saveTemplateOnly()) {
    appData = previousAppData;
    selectedHouseTemplateId = previousSelectedHouseTemplateId;
    var restoredHouse = getHouseTemplateById(houseId);
    if (editHouseTemplateId === houseId && ge('houseTemplateModal').style.display !== 'none') {
      ht_renderTemplate(restoredHouse);
    }
    renderSettings();
    return false;
  }
  if (editHouseTemplateId === house.id && ge('houseTemplateModal').style.display !== 'none') {
    ht_renderTemplate(house);
  }
  renderSettings();
}

function ht_roomHtml(floorId, room) {
  room = room || {};
  var roomId = room.id || uid();
  var beds = typeof room.beds === 'number' ? room.beds : parseInt(room.beds, 10);
  if (!beds || beds < 1) beds = 1;
  return '<div class="ht-room-box" id="ht_room_'+floorId+'_'+roomId+'" data-room-id="'+esc(roomId)+'">'
    + '<input class="ht-room-number" value="'+esc(room.number || '')+'" placeholder="رقم الغرفة">'
    + '<input class="ht-room-beds" type="number" min="1" value="'+beds+'" placeholder="الأسرة">'
    + '<input class="ht-room-notes" value="'+esc(room.notes || '')+'" placeholder="ملاحظات">'
    + '<button class="btn btn-red btn-sm" onclick="ht_deleteRoom(\'ht_room_'+floorId+'_'+roomId+'\')">✕</button>'
    + '</div>';
}

function ht_addRoom(floorId) {
  if (editHouseTemplateId && getHouseTemplateById(editHouseTemplateId)) {
    ht_addRoomToTemplate(editHouseTemplateId, floorId);
    return;
  }
  var roomId = uid();
  var roomHtml = ht_roomHtml(floorId, {id: roomId, number: '', beds: 1, notes: ''});
  ge('ht_floor_'+floorId).querySelector('.ht-rooms-container').insertAdjacentHTML('beforeend', roomHtml);
}

function ht_deleteRoom(fullRoomId) {
  var roomEl = ge(fullRoomId);
  if (!roomEl) return;
  var floorEl = roomEl.closest('.ht-floor-box');
  var roomId = roomEl.getAttribute('data-room-id');
  var floorId = floorEl ? floorEl.getAttribute('data-floor-id') : null;
  if (editHouseTemplateId && floorId && roomId && getHouseTemplateById(editHouseTemplateId)) {
    ht_deleteRoomFromTemplate(editHouseTemplateId, floorId, roomId);
    return;
  }
  roomEl.remove();
}

function ht_editFloorName(houseId, floorId) {
  openTemplateFloorModal(houseId, floorId);
}

function ht_deleteFloorFromTemplate(houseId, floorId) {
  var house = getHouseTemplateById(houseId);
  if (!house || !house.floors) return;
  var targetFloor = null;
  house.floors.forEach(function(floor) {
    if (!targetFloor && floor.id === floorId) targetFloor = floor;
  });
  if (!targetFloor) return;
  var roomCount = (targetFloor.rooms || []).length;
  var message = roomCount
    ? 'حذف الدور "' + (targetFloor.name || 'دور غير مسمى') + '"؟ يحتوي على ' + roomCount + ' غرفة، وسيتم حذف هذه الغرف من خريطة البيت.'
    : 'حذف الدور "' + (targetFloor.name || 'دور غير مسمى') + '" من خريطة البيت؟';
  if (!confirm(message)) return;
  var previousAppData = deepClone(appData);
  var previousSelectedHouseTemplateId = selectedHouseTemplateId;
  var floors = [];
  house.floors.forEach(function(floor) {
    if (floor.id !== floorId) floors.push(floor);
  });
  house.floors = floors;
  selectedHouseTemplateId = house.id;
  if (!saveTemplateOnly()) {
    appData = previousAppData;
    selectedHouseTemplateId = previousSelectedHouseTemplateId;
    var restoredHouse = getHouseTemplateById(houseId);
    if (editHouseTemplateId === houseId && ge('houseTemplateModal').style.display !== 'none') {
      ht_renderTemplate(restoredHouse);
    }
    renderSettings();
    return false;
  }
  if (editHouseTemplateId === house.id && ge('houseTemplateModal').style.display !== 'none') {
    ht_renderTemplate(house);
  }
  renderSettings();
}
