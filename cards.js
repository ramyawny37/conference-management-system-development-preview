var CardEngine = (function () {
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asText(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function normalizeCardTheme(value) {
    return value === 'modern-banner' ? 'modern-banner' : 'classic';
  }

  function getPersonRecord(people, personId) {
    if (!personId) return null;
    for (var i = 0; i < people.length; i++) {
      if (people[i] && people[i].id === personId) return people[i];
    }
    return null;
  }

  function readBranding(conference) {
    var stored = conference && conference.branding ? conference.branding : {};
    return {
      banner: asText(stored.banner || stored.logo || ''),
      bannerPrepared: asText(stored.bannerPrepared),
      serviceLogo: asText(stored.serviceLogo || stored.watermark || stored.logo || ''),
      autoColors: stored.autoColors === true,
      bannerPosition: asText(stored.bannerPosition || 'center'),
      bannerFit: stored.bannerFit === 'contain' ? 'contain' : 'cover',
      cardTheme: normalizeCardTheme(stored.cardTheme),
      logo: asText(stored.logo || 'assets/logo.jpg'),
      watermark: asText(stored.watermark),
      primaryColor: asText(stored.primaryColor),
      secondaryColor: asText(stored.secondaryColor),
      textColor: asText(stored.textColor),
      fontFamily: asText(stored.fontFamily)
    };
  }

  function copyBranding(branding) {
    branding = branding || {};
    return {
      banner: asText(branding.banner),
      bannerPrepared: asText(branding.bannerPrepared),
      serviceLogo: asText(branding.serviceLogo),
      autoColors: branding.autoColors === true,
      bannerPosition: asText(branding.bannerPosition || 'center'),
      bannerFit: branding.bannerFit === 'contain' ? 'contain' : 'cover',
      cardTheme: normalizeCardTheme(branding.cardTheme),
      logo: asText(branding.logo),
      watermark: asText(branding.watermark),
      primaryColor: asText(branding.primaryColor),
      secondaryColor: asText(branding.secondaryColor),
      textColor: asText(branding.textColor),
      fontFamily: asText(branding.fontFamily)
    };
  }

  function getConferenceContext() {
    var conference = typeof getCurrentConference === 'function' ? getCurrentConference() : null;
    if (!conference) {
      return {
        conference: null,
        conferenceId: '',
        conferenceName: '',
        houses: [],
        rooms: [],
        people: [],
        transports: [],
        branding: readBranding(null)
      };
    }
    var peopleDb = conference.peopleDb || {};
    return {
      conference: conference,
      conferenceId: asText(conference.id),
      conferenceName: asText((conference.conf && conference.conf.name) || conference.name),
      houses: asArray(conference.houses).slice(),
      rooms: typeof getAllRooms === 'function' ? asArray(getAllRooms()) : [],
      people: asArray(peopleDb.people).slice(),
      transports: asArray(conference.transports).slice(),
      branding: readBranding(conference)
    };
  }

  function getBranding() {
    var conference = typeof getCurrentConference === 'function' ? getCurrentConference() : null;
    return readBranding(conference);
  }

  function createRoomKey(room, house, floor, roomIndex) {
    var roomId = asText(room && room.id);
    if (roomId) return roomId;
    var houseId = asText(house && house.id);
    var floorId = asText(floor && floor.id);
    var roomNumber = asText(room && room.number);
    if (houseId && floorId && roomNumber) {
      return 'house:' + houseId + '|floor:' + floorId + '|number:' + roomNumber;
    }
    return 'index:' + roomIndex;
  }

  function getRoomContext(room, roomIndex) {
    var house = room && room.house ? room.house : {};
    var floor = room && room.floor ? room.floor : {};
    return {
      houseId: asText(house.id),
      houseName: asText(house.name),
      floorId: asText(floor.id),
      floorName: asText(floor.name),
      roomId: asText(room && room.id),
      roomKey: createRoomKey(room, house, floor, roomIndex),
      roomNumber: asText(room && room.number)
    };
  }

  function getStoredRider(storedRider) {
    return storedRider && storedRider.r ? storedRider.r : (storedRider || {});
  }

  function riderMatchesPerson(rider, personId, name, roomNumber) {
    var riderPersonId = asText(rider && rider.personId);
    if (personId && riderPersonId) return personId === riderPersonId;
    return asText(rider && rider.name) === name && asText(rider && rider.room) === roomNumber;
  }

  function addTransportSummary(target, seen, transport, seat, rider) {
    var source = rider || seat || {};
    var transportId = asText(transport && transport.id);
    var transportName = asText(transport && transport.name);
    var seatNumber = asText(seat && seat.seat);
    var seatType = asText(source.type);
    var identity = (transportId || transportName) + '|' + seatNumber + '|' + seatType;
    if (seen[identity]) return;
    seen[identity] = true;
    target.push({
      transportId: transportId,
      transportName: transportName,
      seatNumber: seatNumber,
      seatType: seatType
    });
  }

  function getTransportSummary(context, personId, name, roomNumber) {
    var result = [];
    var seen = {};
    asArray(context.transports).forEach(function (transport) {
      asArray(transport && transport.seats).forEach(function (seat) {
        if (riderMatchesPerson(seat || {}, personId, name, roomNumber)) {
          addTransportSummary(result, seen, transport, seat, null);
        }
        asArray(seat && seat.riders).forEach(function (storedRider) {
          var rider = getStoredRider(storedRider);
          if (riderMatchesPerson(rider, personId, name, roomNumber)) {
            addTransportSummary(result, seen, transport, seat, rider);
          }
        });
      });
    });
    return result;
  }

  function getPersonDetails(entry, personType, people) {
    var source = entry || {};
    var personId = asText(source.personId);
    var record = getPersonRecord(people, personId);
    var fallbackName = typeof entry === 'string' ? entry : asText(source.name);
    var name = '';
    if (personType === 'adult' && typeof gn === 'function') name = asText(gn(entry));
    if (!name && record) name = asText(record.fullName || record.name);
    if (!name) name = fallbackName;
    var leftDay = source.leftDay === undefined ? null : source.leftDay;
    var hasLeft = typeof gl === 'function' ? !!gl(entry) : !!leftDay;
    return {
      personId: personId,
      name: name,
      phone: record ? asText(record.phone) : '',
      leftDay: leftDay,
      hasLeft: hasLeft
    };
  }

  function createPersonKey(roomId, personType, personId, index) {
    var identity = personId ? 'id:' + personId : 'index:' + index;
    return 'person|room:' + roomId + '|' + personType + '|' + identity;
  }

  function buildPersonCard(context, room, entry, personType, index, roomIndex) {
    var location = getRoomContext(room, roomIndex);
    var person = getPersonDetails(entry, personType, context.people);
    var card = {
      key: createPersonKey(location.roomKey, personType, person.personId, index),
      type: 'person',
      personType: personType,
      personId: person.personId,
      name: person.name,
      phone: person.phone,
      conferenceId: context.conferenceId,
      conferenceName: context.conferenceName,
      houseId: location.houseId,
      houseName: location.houseName,
      floorId: location.floorId,
      floorName: location.floorName,
      roomId: location.roomId,
      roomNumber: location.roomNumber,
      transportSummary: getTransportSummary(context, person.personId, person.name, location.roomNumber),
      leftDay: person.leftDay,
      hasLeft: person.hasLeft,
      branding: copyBranding(context.branding)
    };
    if (personType === 'adult' && entry && entry.bedType === 'extra') {
      card.bedType = 'extra';
      if (entry.extraBedPersonType === 'adult' || entry.extraBedPersonType === 'child') {
        card.extraBedPersonType = entry.extraBedPersonType;
      }
    }
    if (personType === 'child') {
      card.guardianName = asText(entry && entry.guardian);
      card.guardianPersonId = asText(entry && entry.guardianPersonId);
    }
    return card;
  }

  function getPersonCards() {
    var context = getConferenceContext();
    var cards = [];
    context.rooms.forEach(function (room, roomIndex) {
      asArray(room && room.guests).forEach(function (guest, index) {
        cards.push(buildPersonCard(context, room, guest, 'adult', index, roomIndex));
      });
      asArray(room && room.children).forEach(function (child, index) {
        cards.push(buildPersonCard(context, room, child, 'child', index, roomIndex));
      });
    });
    return cards;
  }

  function createRoomMember(context, room, entry, personType, roomIndex) {
    var person = getPersonDetails(entry, personType, context.people);
    var location = getRoomContext(room, roomIndex);
    var member = {
      personType: personType,
      personId: person.personId,
      name: person.name,
      phone: person.phone,
      leftDay: person.leftDay,
      hasLeft: person.hasLeft,
      transportSummary: getTransportSummary(context, person.personId, person.name, location.roomNumber)
    };
    if (personType === 'adult' && entry && entry.bedType === 'extra') {
      member.bedType = 'extra';
      if (entry.extraBedPersonType === 'adult' || entry.extraBedPersonType === 'child') {
        member.extraBedPersonType = entry.extraBedPersonType;
      }
    }
    return member;
  }

  function mergeTransportSummaries(members) {
    var result = [];
    var seen = {};
    members.forEach(function (member) {
      asArray(member.transportSummary).forEach(function (summary) {
        var identity = (summary.transportId || summary.transportName) + '|' + summary.seatNumber + '|' + summary.seatType;
        if (seen[identity]) return;
        seen[identity] = true;
        result.push({
          transportId: summary.transportId,
          transportName: summary.transportName,
          seatNumber: summary.seatNumber,
          seatType: summary.seatType
        });
      });
    });
    return result;
  }

  function getRoomCards() {
    var context = getConferenceContext();
    var cards = [];
    context.rooms.forEach(function (room, roomIndex) {
      var adults = [];
      var children = [];
      asArray(room && room.guests).forEach(function (guest) {
        adults.push(createRoomMember(context, room, guest, 'adult', roomIndex));
      });
      asArray(room && room.children).forEach(function (child) {
        children.push(createRoomMember(context, room, child, 'child', roomIndex));
      });
      if (!adults.length && !children.length) return;
      var location = getRoomContext(room, roomIndex);
      var members = adults.concat(children);
      cards.push({
        key: 'room|id:' + location.roomKey,
        type: 'room',
        conferenceId: context.conferenceId,
        conferenceName: context.conferenceName,
        houseId: location.houseId,
        houseName: location.houseName,
        floorId: location.floorId,
        floorName: location.floorName,
        floor: location.floorName,
        roomId: location.roomId,
        roomNumber: location.roomNumber,
        room: location.roomNumber,
        adults: adults,
        children: children,
        members: members,
        guests: members.map(function (member) { return member.name; }),
        transportSummary: mergeTransportSummaries(members),
        branding: copyBranding(context.branding)
      });
    });
    return cards;
  }

  function getCardByKey(key) {
    if (!key) return null;
    var cards = getPersonCards().concat(getRoomCards());
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].key === key) return cards[i];
    }
    return null;
  }

  return {
    getConferenceContext: getConferenceContext,
    getPersonCards: getPersonCards,
    getRoomCards: getRoomCards,
    getCardByKey: getCardByKey,
    getBranding: getBranding
  };
})();
