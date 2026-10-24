function createDefaultConferenceData(){
  var now = new Date().toISOString();
  return {
    id: uid(),
    name: 'المؤتمر',
    startDate: '',
    endDate: '',
    days: 1,
    nights: 0,
    schedule: [],
    restaurantV3: createDefaultRestaurantV3(),
    accommodationV3: createDefaultAccommodationV3(),
    airConditioningV3: createDefaultAirConditioningV3(),
    financialV3: createDefaultFinancialV3(),
    houses: [],
    accommodationDisplayedRoomIds: [],
    accommodationDisplayStateInitialized: true,
    activityLog: [],
    skipPeopleMigration: true,
    peopleDb: { version: '1.0.0', people: [] },
    status: 'active',
    completedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function getCurrentConference(){
  // Safety check for unit testing or strange states
  if (!appData || !appData.conferences || !appData.conferences.length) {
    return null;
  }
  if (!appData.currentConferenceId) {
    return null;
  }
  for (var i = 0; i < appData.conferences.length; i++) {
    if (appData.conferences[i].id === appData.currentConferenceId) {
      return appData.conferences[i];
    }
  }
  return null;
}

function getConferenceHouseRooms(conference) {
  conference = conference || getCurrentConference();
  if (!conference) return [];
  var linked=typeof getCanonicalConferenceCoreLink==='function'&&getCanonicalConferenceCoreLink(conference.id);
  var canonical=linked&&window.PlatformIntegration&&typeof window.PlatformIntegration.getConferenceAccommodationState==='function'
    ?window.PlatformIntegration.getConferenceAccommodationState(conference.id):null;
  var houses=linked?(canonical&&canonical.houses||[]):(conference.houses||[]);
  var allRooms = [];
  houses.forEach(function(h) {
    (h.floors || []).forEach(function(f) {
      (f.rooms || []).forEach(function(room) {
        var roomWithContext = {};
        for (var key in room) {
          if (Object.prototype.hasOwnProperty.call(room, key)) {
            roomWithContext[key] = room[key];
          }
        }
        roomWithContext.house = h;
        roomWithContext.floor = f;
        if(linked){
          roomWithContext.house={id:h.houseId,name:h.name,description:h.description,position:h.position,revision:h.revision};
          roomWithContext.floor={id:f.floorId,name:f.name,position:f.position,revision:f.revision};
          roomWithContext.id=room.roomId;
          roomWithContext.number=room.roomNumber;
          roomWithContext.beds=room.baseCapacity;
          roomWithContext.extraBeds=room.extraBedCapacity;
          roomWithContext.closed=room.isClosed;
        }
        allRooms.push(roomWithContext);
      });
    });
  });
  return allRooms;
}

function getConferenceParticipationItems(conference){
  conference=conference||getCurrentConference();
  if(!conference)return [];
  var linked=typeof getCanonicalConferenceCoreLink==='function'&&getCanonicalConferenceCoreLink(conference.id);
  if(!linked)return [];
  var state=window.PlatformIntegration&&typeof window.PlatformIntegration.getConferenceParticipationState==='function'
    ?window.PlatformIntegration.getConferenceParticipationState(conference.id):null;
  return state&&Array.isArray(state.items)?state.items.slice():[];
}

function getConferenceRoomPeople(room,conference){
  conference=conference||getCurrentConference();
  var linked=conference&&typeof getCanonicalConferenceCoreLink==='function'&&getCanonicalConferenceCoreLink(conference.id);
  if(linked)return (room&&room.occupancies||[]).map(function(occupancy){
    var person=occupancy.person||{};
    return {id:occupancy.occupancyId||'',occupancyId:occupancy.occupancyId||'',personId:person.personId||'',participationId:occupancy.participationId||'',name:person.fullName||'',phone:person.phone||'',church:person.church||'',gender:person.gender||'',dateOfBirth:person.dateOfBirth||null,arrivalDay:occupancy.arrivalDay,leaveDay:occupancy.leaveDay,leftDay:occupancy.leaveDay,bedType:occupancy.bedType,extraBedPersonType:occupancy.extraBedPersonType,participationStatus:occupancy.participationStatus,guardianParticipationId:occupancy.guardianParticipationId,guardianPersonId:occupancy.guardianPersonId,guardianFullName:occupancy.guardianFullName,guardianParticipationStatus:occupancy.guardianParticipationStatus,isChild:!!occupancy.guardianParticipationId||occupancy.extraBedPersonType==='child'};
  });
  var adults=(room&&room.guests||[]).map(function(person){var item=Object.assign({},person);item.isChild=false;return item;});
  var children=(room&&room.children||[]).map(function(person){var item=Object.assign({},person);item.isChild=true;item.guardianFullName=item.guardian||'';return item;});
  return adults.concat(children);
}

function getConferenceOperationalDay(conference){
  conference=conference||getCurrentConference();
  var start=conference&&new Date(conference.startDate||conference.start_date||'');
  var end=conference&&new Date(conference.endDate||conference.end_date||'');
  if(!start||isNaN(start.getTime()))return 1;
  start.setHours(0,0,0,0);
  var today=new Date();today.setHours(0,0,0,0);
  var day=Math.floor((today.getTime()-start.getTime())/86400000)+1;
  var days=end&&!isNaN(end.getTime())?Math.floor((end.getTime()-start.getTime())/86400000)+1:day;
  return Math.max(1,Math.min(Math.max(1,days),day));
}

function getConferenceRoomPeopleOnDay(room,day,conference){
  if(day===undefined||day===null||day==='')day=getConferenceOperationalDay(conference);
  return getConferenceRoomPeople(room,conference).filter(function(person){
    if(person.participationStatus&&person.participationStatus!=='active')return false;
    return typeof isPersonPresentOnDay==='function'?isPersonPresentOnDay(person,day):true;
  });
}

function getConferenceAccommodationPeople(conference){
  conference=conference||getCurrentConference();
  var people={};
  getConferenceHouseRooms(conference).forEach(function(room){
    getConferenceRoomPeople(room,conference).forEach(function(person){
      var key=String(person.participationId||person.personId||'');
      if(!key)return;
      var item=people[key]||(people[key]=Object.assign({},person));
      item.arrivalDay=Math.min(Number(item.arrivalDay)||Infinity,Number(person.arrivalDay)||Infinity);
      var oldLeave=Number(item.leftDay||item.leaveDay),newLeave=Number(person.leftDay||person.leaveDay);
      if(!isFinite(oldLeave)||!isFinite(newLeave))item.leftDay=item.leaveDay=null;
      else item.leftDay=item.leaveDay=Math.max(oldLeave,newLeave);
    });
  });
  return Object.keys(people).map(function(key){if(!isFinite(Number(people[key].arrivalDay)))people[key].arrivalDay=1;return people[key];});
}

function getConferenceOperationalResidents(conference,day){
  conference=conference||getCurrentConference();
  var result={adults:[],children:[],all:[],byParticipationId:{}};
  if(!conference)return result;
  getConferenceHouseRooms(conference).forEach(function(room){
    if(typeof isRoomActiveOnDay==='function'&&!isRoomActiveOnDay(room,day))return;
    getConferenceRoomPeopleOnDay(room,day,conference).forEach(function(person){
      var participationId=String(person&&person.participationId||'');
      var identity=participationId||String(person&&person.personId||'');
      if(!identity||result.byParticipationId[identity])return;
      var item=Object.assign({},person,{room:room.number||'',rid:room.id||''});
      result.byParticipationId[identity]=item;
      result.all.push(item);
      if(item.isChild)result.children.push(item);else result.adults.push(item);
    });
  });
  return result;
}

function getSelectedAccommodationRoomIds(conference){
  conference = conference || getCurrentConference();
  if(!conference || !Array.isArray(conference.accommodationDisplayedRoomIds)) return [];
  var validIds = {};
  getConferenceHouseRooms(conference).forEach(function(room){
    if(room && room.id) validIds[String(room.id)] = true;
  });
  var seen = {};
  return conference.accommodationDisplayedRoomIds.filter(function(roomId){
    var id = roomId === undefined || roomId === null ? '' : String(roomId);
    if(!id || !validIds[id] || seen[id]) return false;
    seen[id] = true;
    return true;
  }).map(function(roomId){ return String(roomId); });
}

function getSelectedAccommodationRooms(conference){
  conference = conference || getCurrentConference();
  var selectedIds = {};
  getSelectedAccommodationRoomIds(conference).forEach(function(roomId){
    selectedIds[roomId] = true;
  });
  return getConferenceHouseRooms(conference).filter(function(room){
    return !!(room && selectedIds[String(room.id || '')]);
  });
}

function getOpenSelectedAccommodationRooms(day, conference){
  return getSelectedAccommodationRooms(conference).filter(function(room){
    return typeof isRoomActiveOnDay === 'function'
      ? isRoomActiveOnDay(room, day)
      : !room.closed;
  });
}

function getAllRooms() {
  var conference=getCurrentConference();
  if(conference&&typeof getCanonicalConferenceCoreLink==='function'&&getCanonicalConferenceCoreLink(conference.id))return getConferenceHouseRooms(conference);
  return getSelectedAccommodationRooms();
}

function getRoomBaseCapacity(room){
  if(room&&Array.isArray(room.beds)) return room.beds.length;
  var capacity = room ? Number(room.beds) : 0;
  return isFinite(capacity) && capacity > 0 && Math.floor(capacity) === capacity
    ? capacity
    : 0;
}

function getRoomTypeKey(room){
  var capacity = getRoomBaseCapacity(room);
  if(capacity === 1) return 'single';
  if(capacity === 2) return 'double';
  if(capacity === 3) return 'triple';
  if(capacity === 4) return 'quadruple';
  if(capacity === 5) return 'quintuple';
  if(capacity === 6) return 'sextuple';
  if(capacity >= 7) return 'sevenPlus';
  return 'unknown';
}

function getRoomTypeLabel(room){
  var labels = {
    single:'سنجل',
    double:'دبل',
    triple:'ثلاثي',
    quadruple:'رباعي',
    quintuple:'خماسي',
    sextuple:'سداسي',
    sevenPlus:'سباعي فأكثر',
    unknown:'غير محدد'
  };
  return labels[getRoomTypeKey(room)];
}

function countRoomsByType(rooms){
  var counts = {
    total:0,
    single:0,
    double:0,
    triple:0,
    quadruple:0,
    quintuple:0,
    sextuple:0,
    sevenPlus:0,
    unknown:0
  };
  (rooms || []).forEach(function(room){
    counts.total++;
    counts[getRoomTypeKey(room)]++;
  });
  return counts;
}

function buildRoomTypeSummary(rooms){
  var counts = countRoomsByType(rooms);
  return {
    counts:counts,
    items:[
      {key:'single',label:'سنجل',count:counts.single},
      {key:'double',label:'دبل',count:counts.double},
      {key:'triple',label:'ثلاثي',count:counts.triple},
      {key:'quadruple',label:'رباعي',count:counts.quadruple},
      {key:'quintuple',label:'خماسي',count:counts.quintuple},
      {key:'sextuple',label:'سداسي',count:counts.sextuple},
      {key:'sevenPlus',label:'سباعي فأكثر',count:counts.sevenPlus},
      {key:'unknown',label:'غير محدد',count:counts.unknown}
    ]
  };
}

function parseConferenceDate(value){
  if(typeof value!=='string')return null;
  var trimmed=value.trim();
  var match=trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match){
    match=trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(match)match=[match[0],match[3],match[2],match[1]];
  }
  if(!match)return null;
  var year=parseInt(match[1],10);
  var month=parseInt(match[2],10);
  var day=parseInt(match[3],10);
  var utcDate=new Date(Date.UTC(year,month-1,day));
  if(
    utcDate.getUTCFullYear()!==year||
    utcDate.getUTCMonth()!==month-1||
    utcDate.getUTCDate()!==day
  )return null;
  return {
    year:year,
    month:month,
    day:day,
    iso:String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'),
    utcTime:utcDate.getTime()
  };
}

function calculateConferencePeriod(startDate,endDate){
  var start=parseConferenceDate(startDate);
  var end=parseConferenceDate(endDate);
  if(!start||!end){
    return {valid:false,days:0,nights:0,error:'invalid_date'};
  }
  var nights=Math.round((end.utcTime-start.utcTime)/86400000);
  if(nights<0){
    return {valid:false,days:0,nights:0,error:'end_before_start'};
  }
  return {valid:true,days:nights+1,nights:nights};
}

function buildConferenceSchedule(startDate,endDate){
  var period=calculateConferencePeriod(startDate,endDate);
  var start=parseConferenceDate(startDate);
  if(!period.valid||!start)return [];
  var schedule=[];
  for(var index=0;index<period.days;index++){
    var date=new Date(start.utcTime+(index*86400000));
    schedule.push({
      dayNumber:index+1,
      date:String(date.getUTCFullYear()).padStart(4,'0')+'-'+
        String(date.getUTCMonth()+1).padStart(2,'0')+'-'+
        String(date.getUTCDate()).padStart(2,'0')
    });
  }
  return schedule;
}

var RESTAURANT_V3_MEAL_KEYS=['breakfast','lunch','dinner'];

function createDefaultRestaurantV3(){
  return {
    enabled:true,
    firstMeal:'dinner',
    lastMeal:'lunch',
    prices:{breakfast:0,lunch:0,dinner:0},
    mealPriceOverrides:[],
    mealCountOverrides:[],
    personOverrides:[]
  };
}

function normalizeRestaurantV3(restaurantV3){
  var defaults=createDefaultRestaurantV3();
  restaurantV3=restaurantV3&&typeof restaurantV3==='object'?restaurantV3:{};
  restaurantV3.enabled=restaurantV3.enabled!==false;
  restaurantV3.firstMeal=RESTAURANT_V3_MEAL_KEYS.indexOf(restaurantV3.firstMeal)!==-1
    ?restaurantV3.firstMeal
    :defaults.firstMeal;
  restaurantV3.lastMeal=RESTAURANT_V3_MEAL_KEYS.indexOf(restaurantV3.lastMeal)!==-1
    ?restaurantV3.lastMeal
    :defaults.lastMeal;
  restaurantV3.prices=restaurantV3.prices&&typeof restaurantV3.prices==='object'
    ?restaurantV3.prices
    :{};
  RESTAURANT_V3_MEAL_KEYS.forEach(function(mealKey){
    var price=Number(restaurantV3.prices[mealKey]);
    restaurantV3.prices[mealKey]=isFinite(price)?price:0;
  });
  var priceOverrideIndexes={};
  var normalizedPriceOverrides=[];
  (Array.isArray(restaurantV3.mealPriceOverrides)?restaurantV3.mealPriceOverrides:[]).forEach(function(item){
    if(!item||typeof item!=='object')return;
    var day=Math.floor(Number(item.day));
    var price=Number(item.price);
    if(day<1||RESTAURANT_V3_MEAL_KEYS.indexOf(item.meal)===-1||!isFinite(price)||price<0)return;
    var key=day+'|'+item.meal;
    var normalized={day:day,meal:item.meal,price:price};
    if(priceOverrideIndexes[key]===undefined){
      priceOverrideIndexes[key]=normalizedPriceOverrides.length;
      normalizedPriceOverrides.push(normalized);
    }else{
      normalizedPriceOverrides[priceOverrideIndexes[key]]=normalized;
    }
  });
  restaurantV3.mealPriceOverrides=normalizedPriceOverrides;
  var countOverrideIndexes={};
  var normalizedCountOverrides=[];
  (Array.isArray(restaurantV3.mealCountOverrides)?restaurantV3.mealCountOverrides:[]).forEach(function(item){
    if(!item||typeof item!=='object')return;
    var day=Math.floor(Number(item.day));
    var extra=Math.max(0,Math.floor(Number(item.extra)||0));
    var deduction=Math.max(0,Math.floor(Number(item.deduction)||0));
    if(day<1||RESTAURANT_V3_MEAL_KEYS.indexOf(item.meal)===-1||(extra===0&&deduction===0))return;
    var key=day+'|'+item.meal;
    var normalized={day:day,meal:item.meal,extra:extra,deduction:deduction};
    if(typeof item.note==='string'&&item.note.trim())normalized.note=item.note.trim();
    if(countOverrideIndexes[key]===undefined){
      countOverrideIndexes[key]=normalizedCountOverrides.length;
      normalizedCountOverrides.push(normalized);
    }else{
      normalizedCountOverrides[countOverrideIndexes[key]]=normalized;
    }
  });
  restaurantV3.mealCountOverrides=normalizedCountOverrides;
  var personOverrideIndexes={};
  var normalizedPersonOverrides=[];
  (Array.isArray(restaurantV3.personOverrides)?restaurantV3.personOverrides:[]).forEach(function(item){
    if(!item||typeof item!=='object')return;
    var personId=String(item.personId||'').trim();
    if(!personId)return;
    var normalized={personId:personId};
    var day=Math.floor(Number(item.day));
    var isMealException=day>0&&
      RESTAURANT_V3_MEAL_KEYS.indexOf(item.meal)!==-1&&
      typeof item.included==='boolean';
    if(isMealException){
      normalized.day=day;
      normalized.meal=item.meal;
      normalized.included=item.included;
      if(typeof item.note==='string'&&item.note.trim())normalized.note=item.note.trim();
    }
    var arrivalDay=Math.floor(Number(item.arrivalDay));
    var departureDay=Math.floor(Number(item.departureDay));
    if(arrivalDay>0)normalized.arrivalDay=arrivalDay;
    if(departureDay>0)normalized.departureDay=departureDay;
    if(RESTAURANT_V3_MEAL_KEYS.indexOf(item.arrivalMeal)!==-1)normalized.arrivalMeal=item.arrivalMeal;
    if(RESTAURANT_V3_MEAL_KEYS.indexOf(item.departureMeal)!==-1)normalized.departureMeal=item.departureMeal;
    if(!isMealException&&normalized.arrivalDay===undefined&&normalized.departureDay===undefined&&
      normalized.arrivalMeal===undefined&&normalized.departureMeal===undefined)return;
    var key=isMealException?personId+'|'+day+'|'+item.meal:'legacy|'+personId;
    if(personOverrideIndexes[key]===undefined){
      personOverrideIndexes[key]=normalizedPersonOverrides.length;
      normalizedPersonOverrides.push(normalized);
    }else{
      normalizedPersonOverrides[personOverrideIndexes[key]]=normalized;
    }
  });
  restaurantV3.personOverrides=normalizedPersonOverrides;
  return restaurantV3;
}

function getConferenceMealPlan(conference){
  conference=conference||getCurrentConference();
  if(!conference)return createDefaultRestaurantV3();
  if(typeof window!=='undefined'&&window.CanonicalConferenceRestaurant&&window.CanonicalConferenceRestaurant.isLinked(conference.id)){
    return window.CanonicalConferenceRestaurant.getPlan(conference.id)||createDefaultRestaurantV3();
  }
  conference.restaurantV3=normalizeRestaurantV3(conference.restaurantV3);
  return conference.restaurantV3;
}

function buildConferenceMealSchedule(conference){
  conference=conference||getCurrentConference();
  if(!conference)return [];
  var plan=getConferenceMealPlan(conference);
  var linked=typeof getCanonicalConferenceCoreLink==='function'&&getCanonicalConferenceCoreLink(conference.id);
  var coreState=linked&&window.PlatformIntegration&&typeof window.PlatformIntegration.getConferenceCoreState==='function'?window.PlatformIntegration.getConferenceCoreState(conference.id):null;
  var core=coreState&&coreState.core;
  var sourceSchedule=linked?(core&&Array.isArray(core.schedule)?core.schedule:[]):Array.isArray(conference.schedule)&&conference.schedule.length
    ?conference.schedule
    :(conference.conf&&Array.isArray(conference.conf.schedule)?conference.conf.schedule:[]);
  if(!sourceSchedule.length){
    sourceSchedule=buildConferenceSchedule(
      linked?(core&&core.startDate||''):(conference.startDate||(conference.conf&&conference.conf.startDate)||''),
      linked?(core&&core.endDate||''):(conference.endDate||(conference.conf&&conference.conf.endDate)||'')
    );
  }
  var lastIndex=sourceSchedule.length-1;
  return sourceSchedule.map(function(scheduleDay,index){
    var meals={breakfast:true,lunch:true,dinner:true};
    if(!plan.enabled){
      meals={breakfast:false,lunch:false,dinner:false};
    }
    if(index===0){
      var firstMealIndex=RESTAURANT_V3_MEAL_KEYS.indexOf(plan.firstMeal);
      RESTAURANT_V3_MEAL_KEYS.forEach(function(mealKey,mealIndex){
        meals[mealKey]=meals[mealKey]&&mealIndex>=firstMealIndex;
      });
    }
    if(index===lastIndex){
      var lastMealIndex=RESTAURANT_V3_MEAL_KEYS.indexOf(plan.lastMeal);
      RESTAURANT_V3_MEAL_KEYS.forEach(function(mealKey,mealIndex){
        meals[mealKey]=meals[mealKey]&&mealIndex<=lastMealIndex;
      });
    }
    return {
      day:Number(scheduleDay.dayNumber||scheduleDay.day||index+1),
      date:scheduleDay.date||'',
      meals:meals
    };
  });
}

function getPersonMealOverride(personId,conference){
  var plan=getConferenceMealPlan(conference);
  var targetId=personId===undefined||personId===null?'':String(personId);
  for(var index=plan.personOverrides.length-1;index>=0;index--){
    var item=plan.personOverrides[index];
    if(item&&String(item.personId||'')===targetId&&item.day===undefined)return item;
  }
  return null;
}

function getRestaurantV3PersonMealException(personId,day,mealKey,conference){
  var plan=getConferenceMealPlan(conference);
  var targetId=personId===undefined||personId===null?'':String(personId);
  day=Math.floor(Number(day));
  for(var index=plan.personOverrides.length-1;index>=0;index--){
    var item=plan.personOverrides[index];
    if(item&&String(item.participationId||item.personId||'')===targetId&&Number(item.day)===day&&item.meal===mealKey&&
      typeof item.included==='boolean')return item;
  }
  return null;
}

function findRestaurantV3AccommodationPerson(personId,conference){
  var targetId=personId===undefined||personId===null?'':String(personId);
  if(!targetId)return null;
  var found=null;
  getConferenceHouseRooms(conference).some(function(room){
    return getConferenceRoomPeople(room,conference).some(function(person){
      if(String(person&&person.personId||'')!==targetId)return false;
      found=person;
      return true;
    });
  });
  return found;
}

function isRestaurantV3PersonIncluded(person,day,mealKey,conference){
  conference=conference||getCurrentConference();
  day=Math.floor(Number(day));
  var personId=person&&(person.participationId||person.personId);
  var canonical=typeof window!=='undefined'&&window.CanonicalConferenceRestaurant&&window.CanonicalConferenceRestaurant.isLinked(conference&&conference.id);
  var accommodationPerson=canonical?null:findRestaurantV3AccommodationPerson(personId,conference);
  var sourcePerson=canonical?person:(accommodationPerson||person);
  var legacyOverride=canonical?null:(accommodationPerson?null:getPersonMealOverride(personId,conference));
  var mealIndex=RESTAURANT_V3_MEAL_KEYS.indexOf(mealKey);
  if(day<1||mealIndex===-1)return false;
  var included;
  if(legacyOverride){
    var hasArrivalOverride=legacyOverride.arrivalDay!==undefined;
    var hasDepartureOverride=legacyOverride.departureDay!==undefined;
    var hasArrivalMealOverride=RESTAURANT_V3_MEAL_KEYS.indexOf(legacyOverride.arrivalMeal)!==-1;
    var hasDepartureMealOverride=RESTAURANT_V3_MEAL_KEYS.indexOf(legacyOverride.departureMeal)!==-1;
    var arrivalOverrideDay=Number(hasArrivalOverride?legacyOverride.arrivalDay:(sourcePerson&&sourcePerson.arrivalDay));
    var departureOverrideDay=Number(hasDepartureOverride?legacyOverride.departureDay:(sourcePerson&&sourcePerson.leftDay));
    if(!isFinite(arrivalOverrideDay)||arrivalOverrideDay<1)arrivalOverrideDay=1;
    if(!isFinite(departureOverrideDay)||departureOverrideDay<1)departureOverrideDay=Infinity;
    included=day>=arrivalOverrideDay&&
      (hasDepartureOverride||hasDepartureMealOverride?day<=departureOverrideDay:day<departureOverrideDay);
    if(included&&hasArrivalMealOverride&&day===arrivalOverrideDay){
      included=mealIndex>=RESTAURANT_V3_MEAL_KEYS.indexOf(legacyOverride.arrivalMeal);
    }
    if(included&&hasDepartureMealOverride&&day===departureOverrideDay){
      included=mealIndex<=RESTAURANT_V3_MEAL_KEYS.indexOf(legacyOverride.departureMeal);
    }
  }else{
    var arrivalDay=Number(sourcePerson&&sourcePerson.arrivalDay);
    var leftDay=Number(sourcePerson&&sourcePerson.leftDay);
    if(!isFinite(arrivalDay)||arrivalDay<1)arrivalDay=1;
    included=day>=Math.floor(arrivalDay)&&(!isFinite(leftDay)||leftDay<1||day<Math.floor(leftDay)||(day===Math.floor(leftDay)&&mealIndex===0));
  }
  var mealException=getRestaurantV3PersonMealException(personId,day,mealKey,conference);
  return mealException?mealException.included:included;
}

function getMealBaseCount(day,mealKey,conference){
  conference=conference||getCurrentConference();
  day=Math.floor(Number(day));
  if(!conference||day<1||RESTAURANT_V3_MEAL_KEYS.indexOf(mealKey)===-1)return 0;
  var scheduleDay=buildConferenceMealSchedule(conference).filter(function(item){
    return item.day===day;
  })[0];
  if(!scheduleDay||!scheduleDay.meals[mealKey])return 0;
  var count=0;
  if(typeof window!=='undefined'&&window.CanonicalConferenceRestaurant&&window.CanonicalConferenceRestaurant.isLinked(conference.id)){
    getConferenceOperationalResidents(conference,day).all.forEach(function(person){if(isRestaurantV3PersonIncluded(person,day,mealKey,conference))count++;});
    return count;
  }
  var processedPeople={};
  getConferenceHouseRooms(conference).forEach(function(room){
    if(typeof isRoomActiveOnDay==='function'&&!isRoomActiveOnDay(room,day))return;
    getConferenceRoomPeopleOnDay(room,day,conference).forEach(function(person){
      var personKey=String(person&&(person.personId||person.id)||'');
      if(personKey&&processedPeople[personKey])return;
      if(personKey)processedPeople[personKey]=true;
      if(isRestaurantV3PersonIncluded(person,day,mealKey,conference))count++;
    });
  });
  return count;
}

function getMealPrice(day,mealKey,conference){
  var plan=getConferenceMealPlan(conference);
  day=Math.floor(Number(day));
  for(var index=plan.mealPriceOverrides.length-1;index>=0;index--){
    var item=plan.mealPriceOverrides[index];
    if(item&&Number(item.day)===day&&item.meal===mealKey){
      var overridePrice=Number(item.price);
      return isFinite(overridePrice)?overridePrice:0;
    }
  }
  var basePrice=Number(plan.prices[mealKey]);
  return isFinite(basePrice)?basePrice:0;
}

function getMealFinalCount(day,mealKey,conference){
  var plan=getConferenceMealPlan(conference);
  var baseCount=getMealBaseCount(day,mealKey,conference);
  var extra=0;
  var deduction=0;
  plan.mealCountOverrides.forEach(function(item){
    if(!item||Number(item.day)!==Number(day)||item.meal!==mealKey)return;
    var itemExtra=Number(item.extra);
    var itemDeduction=Number(item.deduction);
    if(isFinite(itemExtra))extra+=itemExtra;
    if(isFinite(itemDeduction))deduction+=itemDeduction;
  });
  return Math.max(0,baseCount+extra-deduction);
}

function calculateMealSummary(conference){
  conference=conference||getCurrentConference();
  var summary={days:[],mealTotals:{breakfast:0,lunch:0,dinner:0},grandTotal:0};
  buildConferenceMealSchedule(conference).forEach(function(scheduleDay){
    var daySummary={day:scheduleDay.day,date:scheduleDay.date,meals:{},total:0};
    RESTAURANT_V3_MEAL_KEYS.forEach(function(mealKey){
      var enabled=scheduleDay.meals[mealKey]===true;
      var baseCount=enabled?getMealBaseCount(scheduleDay.day,mealKey,conference):0;
      var finalCount=enabled?getMealFinalCount(scheduleDay.day,mealKey,conference):0;
      var price=enabled?getMealPrice(scheduleDay.day,mealKey,conference):0;
      var total=finalCount*price;
      daySummary.meals[mealKey]={enabled:enabled,baseCount:baseCount,finalCount:finalCount,price:price,total:total};
      daySummary.total+=total;
      summary.mealTotals[mealKey]+=total;
    });
    summary.grandTotal+=daySummary.total;
    summary.days.push(daySummary);
  });
  return summary;
}

var ACCOMMODATION_V3_PRICING_MODES=[
  'per_person_night',
  'per_room_night',
  'per_person_day',
  'per_room_day',
  'fixed_package',
  'per_day_package',
  'room_type'
];

function createDefaultAccommodationV3(){
  return {
    enabled:true,
    pricingMode:'per_person_night',
    prices:{
      personNight:0,
      roomNight:0,
      personDay:0,
      roomDay:0,
      packagePrice:0,
      packageDayPrice:0
    },
    roomTypePrices:{},
    roomOverrides:[],
    personOverrides:[]
  };
}

function normalizeAccommodationV3(accommodationV3){
  var defaults=createDefaultAccommodationV3();
  accommodationV3=accommodationV3&&typeof accommodationV3==='object'&&!Array.isArray(accommodationV3)
    ?accommodationV3
    :{};
  accommodationV3.enabled=accommodationV3.enabled!==false;
  accommodationV3.pricingMode=ACCOMMODATION_V3_PRICING_MODES.indexOf(accommodationV3.pricingMode)!==-1
    ?accommodationV3.pricingMode
    :defaults.pricingMode;
  accommodationV3.prices=accommodationV3.prices&&typeof accommodationV3.prices==='object'
    ?accommodationV3.prices
    :{};
  ['personNight','roomNight','personDay','roomDay','packagePrice','packageDayPrice'].forEach(function(key){
    var value=Number(accommodationV3.prices[key]);
    accommodationV3.prices[key]=isFinite(value)&&value>=0?value:0;
  });
  var normalizedRoomTypePrices={};
  var sourceRoomTypePrices=accommodationV3.roomTypePrices&&typeof accommodationV3.roomTypePrices==='object'
    ?accommodationV3.roomTypePrices
    :{};
  Object.keys(sourceRoomTypePrices).forEach(function(key){
    var value=Number(sourceRoomTypePrices[key]);
    if(isFinite(value)&&value>=0)normalizedRoomTypePrices[key]=value;
  });
  accommodationV3.roomTypePrices=normalizedRoomTypePrices;
  accommodationV3.roomOverrides=(Array.isArray(accommodationV3.roomOverrides)
    ?accommodationV3.roomOverrides
    :[]).filter(function(item){return item&&typeof item==='object'});
  accommodationV3.personOverrides=(Array.isArray(accommodationV3.personOverrides)
    ?accommodationV3.personOverrides
    :[]).filter(function(item){return item&&typeof item==='object'});
  return accommodationV3;
}

function getConferenceAccommodationPlan(conference){
  conference=conference||getCurrentConference();
  if(!conference)return createDefaultAccommodationV3();
  var localId=String(conference.id||'');
  if(localId){
    var integration=window.PlatformIntegration;
    var state=integration&&typeof integration.getConferenceAccommodationState==='function'?integration.getConferenceAccommodationState(localId):null;
    return state&&state.pricing?state.pricing:createDefaultAccommodationV3();
  }
  conference.accommodationV3=normalizeAccommodationV3(conference.accommodationV3);
  return conference.accommodationV3;
}

function buildAccommodationNightSchedule(conference){
  conference=conference||getCurrentConference();
  var schedule=conference&&Array.isArray(conference.schedule)?conference.schedule:[];
  var nights=[];
  for(var index=0;index<Math.max(0,schedule.length-1);index++){
    nights.push({
      night:index+1,
      day:Number(schedule[index].dayNumber||schedule[index].day||index+1),
      date:schedule[index].date||'',
      nextDate:schedule[index+1].date||''
    });
  }
  return nights;
}

function buildAccommodationDaySchedule(conference){
  conference=conference||getCurrentConference();
  var sourceSchedule=conference&&Array.isArray(conference.schedule)?conference.schedule:[];
  if(sourceSchedule.length){
    return sourceSchedule.map(function(scheduleDay,index){
      return {
        dayNumber:Number(scheduleDay.dayNumber||scheduleDay.day||index+1),
        date:scheduleDay.date||''
      };
    });
  }
  var conferenceDays=Math.floor(Number(conference&&conference.days));
  if(!isFinite(conferenceDays)||conferenceDays<1)return [];
  var days=[];
  for(var day=1;day<=conferenceDays;day++)days.push({dayNumber:day,date:''});
  return days;
}

function isPersonStayingNight(person,night){
  var nightDay=Math.floor(Number(night&&typeof night==='object'?night.day:night));
  if(!person||nightDay<1)return false;
  var arrivalDay=Math.floor(Number(person.arrivalDay));
  if(!isFinite(arrivalDay)||arrivalDay<1)arrivalDay=1;
  var leftDay=Math.floor(Number(person.leftDay));
  return arrivalDay<=nightDay&&(!isFinite(leftDay)||leftDay<1||leftDay>nightDay);
}

function isPersonPresentAccommodationDay(person,day){
  var dayNumber=Math.floor(Number(day&&typeof day==='object'?day.dayNumber:day));
  if(!person||dayNumber<1)return false;
  var arrivalDay=Math.floor(Number(person.arrivalDay));
  if(!isFinite(arrivalDay)||arrivalDay<1)arrivalDay=1;
  var leftDay=Math.floor(Number(person.leftDay));
  return arrivalDay<=dayNumber&&(!isFinite(leftDay)||leftDay<1||leftDay>dayNumber);
}

function getPersonNightCount(person,conference){
  var count=0;
  buildAccommodationNightSchedule(conference).forEach(function(night){
    if(isPersonStayingNight(person,night))count++;
  });
  return count;
}

function getPersonDayCount(person,conference){
  var count=0;
  buildAccommodationDaySchedule(conference).forEach(function(day){
    if(isPersonPresentAccommodationDay(person,day))count++;
  });
  return count;
}

function getRoomNightOccupancy(room,night){
  var nightDay=Math.floor(Number(night&&typeof night==='object'?night.day:night));
  if(!room||nightDay<1)return {persons:0,occupied:false};
  if(typeof isRoomActiveOnDay==='function'&&!isRoomActiveOnDay(room,nightDay)){
    return {persons:0,occupied:false};
  }
  var persons=0;
  var seen={};
  getConferenceRoomPeopleOnDay(room,nightDay,getCurrentConference()).forEach(function(person){
    var personKey=String(person&&(person.personId||person.id)||'');
    if(personKey&&seen[personKey])return;
    if(personKey)seen[personKey]=true;
    if(isPersonStayingNight(person,nightDay))persons++;
  });
  return {persons:persons,occupied:persons>0};
}

function getRoomDayOccupancy(room,day){
  var dayNumber=Math.floor(Number(day&&typeof day==='object'?day.dayNumber:day));
  if(!room||dayNumber<1)return {persons:0,occupied:false};
  if(typeof isRoomActiveOnDay==='function'&&!isRoomActiveOnDay(room,dayNumber)){
    return {persons:0,occupied:false};
  }
  var persons=0;
  var seen={};
  getConferenceRoomPeopleOnDay(room,dayNumber,getCurrentConference()).forEach(function(person){
    var personKey=String(person&&(person.personId||person.id)||'');
    if(personKey&&seen[personKey])return;
    if(personKey)seen[personKey]=true;
    if(isPersonPresentAccommodationDay(person,dayNumber))persons++;
  });
  return {persons:persons,occupied:persons>0};
}

function getOccupiedRooms(night,conference){
  conference=conference||getCurrentConference();
  return getConferenceHouseRooms(conference).filter(function(room){
    return getRoomNightOccupancy(room,night).occupied;
  });
}

function getAccommodationNightRoomRows(conference,night){
  conference=conference||getCurrentConference();
  var nightDay=Math.floor(Number(night&&typeof night==='object'?night.day:night));
  if(!conference||!isFinite(nightDay)||nightDay<1)return [];
  return getConferenceHouseRooms(conference).map(function(room){
    var active=typeof isRoomActiveOnDay!=='function'||isRoomActiveOnDay(room,nightDay);
    var members=active?getConferenceRoomPeopleOnDay(room,nightDay,conference):[];
    var seen={};
    members=members.filter(function(person){
      var key=String(person&&(person.participationId||person.personId||person.occupancyId||person.id)||'');
      if(!key||seen[key])return false;
      seen[key]=true;
      return isPersonStayingNight(person,nightDay);
    });
    var baseCapacity=Math.max(0,Number(room.baseCapacity!==undefined?room.baseCapacity:room.beds)||0);
    var extraBedCapacity=Math.max(0,Number(room.extraBedCapacity!==undefined?room.extraBedCapacity:room.extraBeds)||0);
    var baseOccupied=members.filter(function(person){return person.bedType!=='extra';}).length;
    var extraOccupied=members.length-baseOccupied;
    return {
      roomId:room.id||room.roomId||'',roomNumber:room.number||room.roomNumber||'',
      houseId:room.house&&room.house.id||'',houseName:room.house&&room.house.name||'',
      floorId:room.floor&&room.floor.id||'',floorName:room.floor&&room.floor.name||'',
      closed:!active,baseCapacity:baseCapacity,extraBedCapacity:extraBedCapacity,
      baseOccupied:baseOccupied,extraOccupied:extraOccupied,persons:members.length,
      availableBaseBeds:Math.max(0,baseCapacity-baseOccupied),
      availableExtraBeds:Math.max(0,extraBedCapacity-extraOccupied),members:members
    };
  });
}

function getAccommodationV3RoomTypeKey(room){
  var capacity=Array.isArray(room&&room.beds)
    ?room.beds.length
    :Math.floor(Number(room&&room.beds));
  if(!isFinite(capacity)||capacity<1)capacity=1;
  return capacity===1?'single':
    capacity===2?'double':
    capacity===3?'triple':
    capacity===4?'quadruple':
    capacity===5?'quintuple':
    capacity===6?'sextuple':'sevenPlus';
}

function calculateAccommodationSummary(conference){
  conference=conference||getCurrentConference();
  var plan=getConferenceAccommodationPlan(conference);
  var rooms=getConferenceHouseRooms(conference);
  var nights=buildAccommodationNightSchedule(conference);
  var days=buildAccommodationDaySchedule(conference);
  var uniquePersons={};
  var uniqueOccupiedRooms={};
  var totalPersonNights=0;
  var totalPersonDays=0;
  var roomNights=0;
  var roomDays=0;
  var roomTypeCost=0;
  rooms.forEach(function(room,roomIndex){
    getConferenceRoomPeople(room,conference).forEach(function(person,personIndex){
      if(getPersonDayCount(person,conference)<1)return;
      var personKey=String(person&&(person.personId||person.id)||'room-'+roomIndex+'-person-'+personIndex);
      uniquePersons[personKey]=true;
    });
  });
  var dailySummary=nights.map(function(night){
    var persons=0;
    var occupiedRoomCount=0;
    var dailyCost=0;
    var roomRows=getAccommodationNightRoomRows(conference,night);
    roomRows.forEach(function(roomRow,roomIndex){
      if(!roomRow.persons)return;
      occupiedRoomCount++;
      roomNights++;
      persons+=roomRow.persons;
      uniqueOccupiedRooms[String(roomRow.roomId||'room-'+roomIndex)]=true;
      if(plan.pricingMode==='room_type'){
        dailyCost+=Number(plan.roomTypePrices[getAccommodationV3RoomTypeKey(rooms[roomIndex])])||0;
      }
    });
    if(plan.pricingMode==='per_person_night')dailyCost=persons*plan.prices.personNight;
    else if(plan.pricingMode==='per_room_night')dailyCost=occupiedRoomCount*plan.prices.roomNight;
    totalPersonNights+=persons;
    roomTypeCost+=dailyCost;
    return {
      night:night.night,
      day:night.day,
      date:night.date,
      nextDate:night.nextDate,
      persons:persons,
      occupiedRooms:occupiedRoomCount,
      roomRows:roomRows,
      occupancyRate:rooms.length?occupiedRoomCount/rooms.length*100:0,
      cost:dailyCost
    };
  });
  var daySummary=days.map(function(day){
    var persons=0;
    var occupiedRoomCount=0;
    rooms.forEach(function(room){
      var occupancy=getRoomDayOccupancy(room,day);
      if(!occupancy.occupied)return;
      occupiedRoomCount++;
      persons+=occupancy.persons;
    });
    totalPersonDays+=persons;
    roomDays+=occupiedRoomCount;
    var cost=0;
    if(plan.pricingMode==='per_person_day')cost=persons*plan.prices.personDay;
    else if(plan.pricingMode==='per_room_day')cost=occupiedRoomCount*plan.prices.roomDay;
    else if(plan.pricingMode==='per_day_package')cost=plan.prices.packageDayPrice;
    return {
      dayNumber:day.dayNumber,
      date:day.date,
      persons:persons,
      occupiedRooms:occupiedRoomCount,
      cost:cost
    };
  });
  var totalCost=0;
  if(plan.enabled){
    if(plan.pricingMode==='per_person_night')totalCost=totalPersonNights*plan.prices.personNight;
    else if(plan.pricingMode==='per_room_night')totalCost=roomNights*plan.prices.roomNight;
    else if(plan.pricingMode==='per_person_day')totalCost=totalPersonDays*plan.prices.personDay;
    else if(plan.pricingMode==='per_room_day')totalCost=roomDays*plan.prices.roomDay;
    else if(plan.pricingMode==='fixed_package')totalCost=plan.prices.packagePrice;
    else if(plan.pricingMode==='per_day_package')totalCost=days.length*plan.prices.packageDayPrice;
    else if(plan.pricingMode==='room_type')totalCost=roomTypeCost;
  }
  return {
    totalPersons:Object.keys(uniquePersons).length,
    totalPersonNights:totalPersonNights,
    totalPersonDays:totalPersonDays,
    occupiedRooms:Object.keys(uniqueOccupiedRooms).length,
    roomNights:roomNights,
    roomDays:roomDays,
    occupancyRate:rooms.length&&nights.length?roomNights/(rooms.length*nights.length)*100:0,
    totalCost:totalCost,
    dailySummary:dailySummary,
    daySummary:daySummary
  };
}

var AIR_CONDITIONING_V3_PRICING_MODES=[
  'per_person_day',
  'per_room_day',
  'per_unit_day',
  'fixed_package',
  'per_day_package',
  'included'
];

function createDefaultAirConditioningV3(){
  return {
    enabled:true,
    pricingMode:'per_room_day',
    prices:{
      personDay:0,
      roomDay:0,
      unitDay:0,
      fixedPackage:0,
      packageDayPrice:0
    },
    includeEmptyRooms:false,
    includeClosedRooms:false,
    roomOverrides:[],
    dayOverrides:[]
  };
}

function normalizeAirConditioningV3(airConditioningV3,conference){
  var defaults=createDefaultAirConditioningV3();
  airConditioningV3=airConditioningV3&&typeof airConditioningV3==='object'&&!Array.isArray(airConditioningV3)
    ?airConditioningV3
    :{};
  airConditioningV3.enabled=airConditioningV3.enabled!==false;
  airConditioningV3.pricingMode=AIR_CONDITIONING_V3_PRICING_MODES.indexOf(airConditioningV3.pricingMode)!==-1
    ?airConditioningV3.pricingMode
    :defaults.pricingMode;
  airConditioningV3.prices=airConditioningV3.prices&&typeof airConditioningV3.prices==='object'
    ?airConditioningV3.prices
    :{};
  ['personDay','roomDay','unitDay','fixedPackage','packageDayPrice'].forEach(function(key){
    var value=Number(airConditioningV3.prices[key]);
    airConditioningV3.prices[key]=isFinite(value)&&value>=0?value:0;
  });
  airConditioningV3.includeEmptyRooms=airConditioningV3.includeEmptyRooms===true;
  airConditioningV3.includeClosedRooms=airConditioningV3.includeClosedRooms===true;
  var roomIndexes={};
  var normalizedRoomOverrides=[];
  (Array.isArray(airConditioningV3.roomOverrides)?airConditioningV3.roomOverrides:[]).forEach(function(item){
    if(!item||typeof item!=='object')return;
    var roomId=String(item.roomId||'').trim();
    if(!roomId)return;
    var normalized={roomId:roomId};
    if(typeof item.included==='boolean')normalized.included=item.included;
    var units=Math.floor(Number(item.units));
    if(isFinite(units)&&units>=0)normalized.units=units;
    var rate=Number(item.rate);
    normalized.rate=item.rate===null||item.rate===undefined||item.rate===''||!isFinite(rate)||rate<0?null:rate;
    if(typeof item.note==='string'&&item.note.trim())normalized.note=item.note.trim();
    if(roomIndexes[roomId]===undefined){
      roomIndexes[roomId]=normalizedRoomOverrides.length;
      normalizedRoomOverrides.push(normalized);
    }else{
      normalizedRoomOverrides[roomIndexes[roomId]]=normalized;
    }
  });
  airConditioningV3.roomOverrides=normalizedRoomOverrides;
  var validDays={};
  buildAirConditioningDaySchedule(conference).forEach(function(day){validDays[day.dayNumber]=true});
  var dayIndexes={};
  var normalizedDayOverrides=[];
  (Array.isArray(airConditioningV3.dayOverrides)?airConditioningV3.dayOverrides:[]).forEach(function(item){
    if(!item||typeof item!=='object')return;
    var day=Math.floor(Number(item.day));
    if(!validDays[day])return;
    var normalized={day:day};
    ['extraRooms','deductionRooms','extraUnits','deductionUnits','extraPersons','deductionPersons'].forEach(function(key){
      var value=Math.floor(Number(item[key]));
      normalized[key]=isFinite(value)&&value>=0?value:0;
    });
    var fixedCost=Number(item.fixedCost);
    normalized.fixedCost=item.fixedCost===null||item.fixedCost===undefined||item.fixedCost===''||
      !isFinite(fixedCost)||fixedCost<0?null:fixedCost;
    if(typeof item.note==='string'&&item.note.trim())normalized.note=item.note.trim();
    if(dayIndexes[day]===undefined){
      dayIndexes[day]=normalizedDayOverrides.length;
      normalizedDayOverrides.push(normalized);
    }else{
      normalizedDayOverrides[dayIndexes[day]]=normalized;
    }
  });
  airConditioningV3.dayOverrides=normalizedDayOverrides;
  return airConditioningV3;
}

function getConferenceAirConditioningPlan(conference){
  conference=conference||getCurrentConference();
  if(!conference)return createDefaultAirConditioningV3();
  conference.airConditioningV3=normalizeAirConditioningV3(conference.airConditioningV3,conference);
  return conference.airConditioningV3;
}

function buildAirConditioningDaySchedule(conference){
  return buildAccommodationDaySchedule(conference).map(function(day){
    return {dayNumber:day.dayNumber,date:day.date};
  });
}

function getAirConditioningRoomUnits(room){
  if(!room)return 0;
  return 1;
}

function getAirConditioningRoomOverride(roomId,conference){
  var plan=getConferenceAirConditioningPlan(conference);
  roomId=String(roomId||'');
  for(var index=plan.roomOverrides.length-1;index>=0;index--){
    if(String(plan.roomOverrides[index].roomId||'')===roomId)return plan.roomOverrides[index];
  }
  return null;
}

function getAirConditioningDayOverride(day,conference){
  var plan=getConferenceAirConditioningPlan(conference);
  day=Math.floor(Number(day));
  for(var index=plan.dayOverrides.length-1;index>=0;index--){
    if(Number(plan.dayOverrides[index].day)===day)return plan.dayOverrides[index];
  }
  return null;
}

function getAirConditioningRoomPersons(room,day){
  var count=0;
  var seen={};
  getConferenceRoomPeopleOnDay(room,day,getCurrentConference()).forEach(function(person){
    var personKey=String(person&&(person.personId||person.id)||'');
    if(personKey&&seen[personKey])return;
    if(personKey)seen[personKey]=true;
    var present=typeof isPersonPresentOnDay==='function'
      ?isPersonPresentOnDay(person,day)
      :isPersonPresentAccommodationDay(person,day);
    if(present)count++;
  });
  return count;
}

function isAirConditioningRoomIncluded(room,day,conference){
  if(!room)return false;
  var plan=getConferenceAirConditioningPlan(conference);
  var override=getAirConditioningRoomOverride(room.id,conference);
  var roomActive=typeof isRoomActiveOnDay==='function'?isRoomActiveOnDay(room,day):room.closed!==true;
  var included=(plan.includeClosedRooms||roomActive)&&
    (plan.includeEmptyRooms||getAirConditioningRoomPersons(room,day)>0);
  if(override&&typeof override.included==='boolean')included=override.included;
  return included;
}

function getAirConditioningDayPersons(day,conference){
  conference=conference||getCurrentConference();
  var persons=0;
  getConferenceHouseRooms(conference).forEach(function(room){
    if(!isAirConditioningRoomIncluded(room,day,conference))return;
    persons+=getAirConditioningRoomPersons(room,day);
  });
  return persons;
}

function getAirConditioningDayRooms(day,conference){
  conference=conference||getCurrentConference();
  var rooms=0;
  getConferenceHouseRooms(conference).forEach(function(room){
    if(isAirConditioningRoomIncluded(room,day,conference))rooms++;
  });
  return rooms;
}

function getAirConditioningDayUnits(day,conference){
  conference=conference||getCurrentConference();
  var units=0;
  getConferenceHouseRooms(conference).forEach(function(room){
    if(!isAirConditioningRoomIncluded(room,day,conference))return;
    var override=getAirConditioningRoomOverride(room.id,conference);
    units+=override&&override.units!==undefined?override.units:getAirConditioningRoomUnits(room);
  });
  return Math.max(0,units);
}

function calculateAirConditioningSummary(conference){
  conference=conference||getCurrentConference();
  var linked=conference&&typeof getCanonicalConferenceCoreLink==='function'&&getCanonicalConferenceCoreLink(conference.id);
  if(linked){
    var integration=typeof window!=='undefined'&&window.PlatformIntegration;
    return integration&&typeof integration.calculateConferenceAirConditioning==='function'
      ?integration.calculateConferenceAirConditioning(conference.id)
      :{available:false,code:'CANONICAL_CONFERENCE_AIR_CONDITIONING_UNAVAILABLE',enabled:false,pricingBasis:'',totalPersonDays:0,totalRoomDays:0,totalUnitDays:0,totalCost:0,daySummary:[],houses:[]};
  }
  var plan=getConferenceAirConditioningPlan(conference);
  var rooms=getConferenceHouseRooms(conference);
  var totalPersonDays=0;
  var totalRoomDays=0;
  var totalUnitDays=0;
  var totalCost=0;
  var daySummary=buildAirConditioningDaySchedule(conference).map(function(day){
    var persons=getAirConditioningDayPersons(day.dayNumber,conference);
    var roomCount=getAirConditioningDayRooms(day.dayNumber,conference);
    var units=getAirConditioningDayUnits(day.dayNumber,conference);
    var dayOverride=getAirConditioningDayOverride(day.dayNumber,conference);
    if(dayOverride){
      persons=Math.max(0,persons+dayOverride.extraPersons-dayOverride.deductionPersons);
      roomCount=Math.max(0,roomCount+dayOverride.extraRooms-dayOverride.deductionRooms);
      units=Math.max(0,units+dayOverride.extraUnits-dayOverride.deductionUnits);
    }
    var cost=0;
    if(plan.enabled&&plan.pricingMode!=='included'){
      if(plan.pricingMode==='per_person_day')cost=persons*plan.prices.personDay;
      else if(plan.pricingMode==='per_room_day')cost=roomCount*plan.prices.roomDay;
      else if(plan.pricingMode==='per_unit_day')cost=units*plan.prices.unitDay;
      else if(plan.pricingMode==='per_day_package')cost=plan.prices.packageDayPrice;
      if(
        plan.pricingMode==='per_person_day'||
        plan.pricingMode==='per_room_day'||
        plan.pricingMode==='per_unit_day'
      ){
        rooms.forEach(function(room){
          if(!isAirConditioningRoomIncluded(room,day.dayNumber,conference))return;
          var override=getAirConditioningRoomOverride(room.id,conference);
          if(!override||override.rate===null)return;
          var roomQuantity=plan.pricingMode==='per_person_day'
            ?getAirConditioningRoomPersons(room,day.dayNumber)
            :(plan.pricingMode==='per_room_day'
              ?1
              :(override.units!==undefined?override.units:getAirConditioningRoomUnits(room)));
          var baseRate=plan.pricingMode==='per_person_day'
            ?plan.prices.personDay
            :(plan.pricingMode==='per_room_day'?plan.prices.roomDay:plan.prices.unitDay);
          cost+=(override.rate-baseRate)*roomQuantity;
        });
      }
    }
    if(
      plan.enabled&&plan.pricingMode!=='included'&&plan.pricingMode!=='fixed_package'&&
      dayOverride&&dayOverride.fixedCost!==null
    )cost=dayOverride.fixedCost;
    cost=Math.max(0,cost);
    totalPersonDays+=persons;
    totalRoomDays+=roomCount;
    totalUnitDays+=units;
    totalCost+=cost;
    return {
      dayNumber:day.dayNumber,
      date:day.date,
      persons:persons,
      rooms:roomCount,
      units:units,
      cost:cost
    };
  });
  if(plan.enabled&&plan.pricingMode==='fixed_package')totalCost=plan.prices.fixedPackage;
  if(!plan.enabled||plan.pricingMode==='included')totalCost=0;
  return {
    enabled:plan.enabled,
    pricingMode:plan.pricingMode,
    totalPersonDays:totalPersonDays,
    totalRoomDays:totalRoomDays,
    totalUnitDays:totalUnitDays,
    totalCost:totalCost,
    daySummary:daySummary
  };
}

function createDefaultFinancialV3(){
  return {
    enabled:true,
    adjustments:[]
  };
}

function normalizeFinancialV3Adjustment(adjustment){
  if(!adjustment||typeof adjustment!=='object'||Array.isArray(adjustment))return null;
  var normalized={
    id:String(adjustment.id||uid()),
    type:adjustment.type==='deduction'?'deduction':'addition',
    category:'other',
    amount:0,
    note:''
  };
  if(adjustment.category==='accommodation'||adjustment.category==='restaurant'||adjustment.category==='air_conditioning'||adjustment.category==='other'){
    normalized.category=adjustment.category;
  }
  var amount=Number(adjustment.amount);
  if(!isFinite(amount)||amount<=0)return null;
  normalized.amount=amount;
  if(typeof adjustment.note==='string'&&adjustment.note.trim())normalized.note=adjustment.note.trim();
  return normalized;
}

function normalizeFinancialV3(financialV3){
  financialV3=financialV3&&typeof financialV3==='object'&&!Array.isArray(financialV3)
    ?financialV3
    :{};
  financialV3.enabled=financialV3.enabled!==false;
  var adjustmentIndexes={};
  var normalizedAdjustments=[];
  (Array.isArray(financialV3.adjustments)?financialV3.adjustments:[]).forEach(function(adjustment){
    var normalized=normalizeFinancialV3Adjustment(adjustment);
    if(!normalized)return;
    if(adjustmentIndexes[normalized.id]===undefined){
      adjustmentIndexes[normalized.id]=normalizedAdjustments.length;
      normalizedAdjustments.push(normalized);
    }else{
      normalizedAdjustments[adjustmentIndexes[normalized.id]]=normalized;
    }
  });
  financialV3.adjustments=normalizedAdjustments;
  delete financialV3.invoiceComparison;
  return financialV3;
}

function getFinancialV3SafeNumber(value){
  value=Number(value);
  return isFinite(value)&&value>=0?value:0;
}

function calculateFinancialV3Summary(conference){
  conference=conference||getCurrentConference();
  if(!conference){
    return {
      enabled:false,
      restaurantTotal:0,
      accommodationTotal:0,
      airConditioningTotal:0,
      subtotal:0,
      additionsTotal:0,
      deductionsTotal:0,
      grandTotal:0,
      adjustments:[],
      breakdown:{
        restaurant:{totalMeals:0,totalCost:0},
        accommodation:{pricingMode:'',totalPersonNights:0,totalPersonDays:0,roomNights:0,roomDays:0,totalCost:0},
        airConditioning:{pricingMode:'',totalPersonDays:0,totalRoomDays:0,totalUnitDays:0,totalCost:0}
      }
    };
  }
  var canonicalFinance=window.CanonicalConferenceFinance&&window.CanonicalConferenceFinance.getState(conference.id);
  var financialState=canonicalFinance?{enabled:canonicalFinance.settings.adjustmentsEnabled,adjustments:canonicalFinance.adjustments}:normalizeFinancialV3(conference.financialV3);
  var accommodationPlan=typeof getConferenceAccommodationPlan==='function'?getConferenceAccommodationPlan(conference):{pricingMode:''};
  var restaurantSummary=typeof calculateMealSummary==='function'?calculateMealSummary(conference):{days:[],grandTotal:0};
  var accommodationSummary=typeof calculateAccommodationSummary==='function'?calculateAccommodationSummary(conference):{pricingMode:'',totalPersonNights:0,totalPersonDays:0,roomNights:0,roomDays:0,totalCost:0};
  var airConditioningSummary=typeof calculateAirConditioningSummary==='function'?calculateAirConditioningSummary(conference):{pricingMode:'',totalPersonDays:0,totalRoomDays:0,totalUnitDays:0,totalCost:0};
  var restaurantTotal=getFinancialV3SafeNumber(restaurantSummary.grandTotal);
  var accommodationTotal=getFinancialV3SafeNumber(accommodationSummary.totalCost);
  var airConditioningTotal=getFinancialV3SafeNumber(airConditioningSummary.totalCost);
  var subtotal=restaurantTotal+accommodationTotal+airConditioningTotal;
  var adjustments=(financialState.adjustments||[]).map(function(adjustment){
    return {
      id:adjustment.id,
      type:adjustment.type,
      category:adjustment.category,
      amount:getFinancialV3SafeNumber(adjustment.amount),
      note:adjustment.note||''
    };
  });
  var additionsTotal=0;
  var deductionsTotal=0;
  adjustments.forEach(function(adjustment){
    if(adjustment.type==='deduction')deductionsTotal+=adjustment.amount;
    else additionsTotal+=adjustment.amount;
  });
  var grandTotal=subtotal+additionsTotal-deductionsTotal;
  if(financialState.enabled===false)grandTotal=0;
  grandTotal=Math.max(0,grandTotal);
  var totalMeals=0;
  (restaurantSummary.days||[]).forEach(function(daySummary){
    ['breakfast','lunch','dinner'].forEach(function(mealKey){
      var meal=daySummary.meals&&daySummary.meals[mealKey];
      totalMeals+=getFinancialV3SafeNumber(meal&&meal.finalCount);
    });
  });
  return {
    enabled:financialState.enabled!==false,
    restaurantTotal:restaurantTotal,
    accommodationTotal:accommodationTotal,
    airConditioningTotal:airConditioningTotal,
    subtotal:subtotal,
    additionsTotal:additionsTotal,
    deductionsTotal:deductionsTotal,
    grandTotal:grandTotal,
    adjustments:adjustments,
    breakdown:{
      restaurant:{
        totalMeals:totalMeals,
        totalCost:restaurantTotal
      },
      accommodation:{
        pricingMode:accommodationSummary.pricingMode||accommodationPlan.pricingMode||'',
        totalPersonNights:getFinancialV3SafeNumber(accommodationSummary.totalPersonNights),
        totalPersonDays:getFinancialV3SafeNumber(accommodationSummary.totalPersonDays),
        roomNights:getFinancialV3SafeNumber(accommodationSummary.roomNights),
        roomDays:getFinancialV3SafeNumber(accommodationSummary.roomDays),
        totalCost:accommodationTotal
      },
      airConditioning:{
        pricingBasis:airConditioningSummary.pricingBasis||airConditioningSummary.pricingMode||'',
        totalPersonDays:getFinancialV3SafeNumber(airConditioningSummary.totalPersonDays),
        totalRoomDays:getFinancialV3SafeNumber(airConditioningSummary.totalRoomDays),
        totalUnitDays:getFinancialV3SafeNumber(airConditioningSummary.totalUnitDays),
        totalCost:airConditioningTotal
      }
    }
  };
}

function syncConferencePeriod(conference){
  if(!conference||typeof conference!=='object')return {valid:false,days:0,nights:0,error:'invalid_conference'};
  conference.conf=conference.conf||{};
  var startDate=conference.startDate||conference.conf.startDate||'';
  var endDate=conference.endDate||conference.conf.endDate||'';
  conference.startDate=startDate;
  conference.endDate=endDate;
  conference.conf.startDate=startDate;
  conference.conf.endDate=endDate;
  var period=calculateConferencePeriod(startDate,endDate);
  if(period.valid){
    conference.days=period.days;
    conference.nights=period.nights;
    conference.schedule=buildConferenceSchedule(startDate,endDate);
  }else{
    var configuredDays=parseInt(conference.days||conference.conf.days,10);
    conference.days=isFinite(configuredDays)&&configuredDays>0?configuredDays:1;
    conference.nights=Math.max(0,conference.days-1);
    conference.schedule=[];
  }
  conference.conf.days=conference.days;
  conference.conf.nights=conference.nights;
  conference.conf.schedule=conference.schedule;
  return period;
}
function getRoomById(roomId) {
  var current = getCurrentConference();
  if (!current || !current.houses) return null;
  var result = null;
  current.houses.forEach(function(house) {
    if (result) return; // Stop if found
    (house.floors || []).forEach(function(floor) {
      if (result) return; // Stop if found
      var rooms = floor.rooms || [];
      for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].id === roomId) {
          result = { room: rooms[i], floor: floor, house: house };
          break;
        }
      }
    });
  });
  return result;
}

function normalizeAppData_core(targetAppData){
  var target=targetAppData||appData;
  target.version = target.version || '2.0.0';
  target.conferences = target.conferences || [];
  target.templates = target.templates || [];
  target.archives = target.archives || [];
  target.backups = target.backups || [];
  target.houseTemplates = target.houseTemplates || [];
  target.peopleDb = target.peopleDb || { version: '1.0.0', people: [] };
  target.peopleDb.version = target.peopleDb.version || '1.0.0';
  target.peopleDb.people = (target.peopleDb.people || []).map(function(p){ return normalizePersonRecord(p); });
  target.trash = target.trash || {};
  target.trash.templates = target.trash.templates || [];
  target.trash.archives = target.trash.archives || [];
  target.trash.backups = target.trash.backups || [];
  target.trash.houseTemplates = target.trash.houseTemplates || [];
  target.trash.rooms = target.trash.rooms || [];
  target.conferences.forEach(function(confObj){
    normalizeConference(confObj,target);
    var linkedRuntime=target===appData&&!!getCanonicalConferenceCoreLink(confObj&&confObj.id);
    if(target===appData&&!linkedRuntime)linkRoomPeopleToDatabase(confObj);
    if(!linkedRuntime&&typeof normalizeConferencePeopleReferences==='function'){
      normalizeConferencePeopleReferences(confObj);
    }
  });
  var currentConfExists = false;
  if (target.currentConferenceId) {
    for (var i = 0; i < target.conferences.length; i++) {
      if (target.conferences[i].id === target.currentConferenceId) {
        currentConfExists = true;
        break;
      }
    }
  }
  if (!currentConfExists) {
    target.currentConferenceId = null;
  }
  return target;
}

function normalizeAppDataCandidate(candidate){
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)){
    throw new Error('INVALID_APP_DATA_CANDIDATE');
  }
  var normalized=deepClone(candidate);
  normalizeAppData_core(normalized);
  return normalized;
}

function normalizeConference(confObj,sourceAppData){
  if(!confObj) return;
  var source=sourceAppData||appData;
  var linkedRuntime=source===appData&&!!getCanonicalConferenceCoreLink(confObj.id);
  confObj.conf = confObj.conf || {name:confObj.name||'المؤتمر',startDate:confObj.startDate||'',endDate:confObj.endDate||'',days:confObj.days||1};
  syncConferencePeriod(confObj);
  if(!linkedRuntime)confObj.houses = confObj.houses || [];
  confObj.activityLog = Array.isArray(confObj.activityLog) ? confObj.activityLog : [];
  confObj.transports = confObj.transports || [];
  confObj.restaurant = confObj.restaurant || createDefaultRestaurant();
  confObj.restaurantV3 = normalizeRestaurantV3(confObj.restaurantV3);
  confObj.accommodationV3 = normalizeAccommodationV3(confObj.accommodationV3);
  confObj.airConditioningV3 = normalizeAirConditioningV3(confObj.airConditioningV3,confObj);
  confObj.financialV3 = normalizeFinancialV3(confObj.financialV3);
  confObj.status = confObj.status || 'active';
  confObj.completedAt = confObj.completedAt || null;
  if(typeof normalizeConferenceAccounts==='function') normalizeConferenceAccounts(confObj);
  if(!linkedRuntime){
    confObj.peopleDb = confObj.peopleDb || { version: '1.0.0', people: [] };
    confObj.peopleDb.version = confObj.peopleDb.version || '1.0.0';
    confObj.peopleDb.people = confObj.peopleDb.people || [];
  }
  (!linkedRuntime?confObj.houses:[]).forEach(function(h){
    normalizeHouseStructure(h);
  });
  if(!linkedRuntime&&typeof ensureAccommodationDisplayState==='function'){
    ensureAccommodationDisplayState(confObj);
  }
  confObj.transports.forEach(function(t){
    if(!t.id) t.id=uid();
    t.capacity = t.capacity|| (t.seats ? t.seats.length : 0);
    if(!Array.isArray(t.seats)){
      t.seats=[];
      for(var i=1;i<=t.capacity;i++) t.seats.push({seat:i,name:'',room:'',type:'adult',note:''});
    } else {
      t.seats.forEach(function(s){ s.type = s.type || 'adult'; s.room = s.room || ''; s.note = s.note || ''; s.name = s.name || ''; });
    }
  });
}

function createDefaultRestaurant(){
  return {
    meals: {
      breakfast: {price:0, childPrice:0, enabled:true},
      lunch:     {price:0, childPrice:0, enabled:true},
      dinner:    {price:0, childPrice:0, enabled:true}
    }
  };
}

function createDefaultFloor(name){
  return {
    id: uid(),
    name: name || 'الدور الرئيسي',
    rooms: []
  };
}

function createDefaultHouse(name, description){
  return {
    id: uid(),
    name: name || 'البيت الافتراضي',
    description: description || '',
    floors: [createDefaultFloor('الدور الرئيسي')]
  };
}

function normalizeHouseStructure(house){
  if(!house) return null;
  house.id = house.id || uid();
  house.name = house.name || 'بيت ' + house.id.slice(0,4);
  house.description = house.description || '';
  house.floors = house.floors || [];
  if(!house.floors.length){
    house.floors.push(createDefaultFloor('الدور الرئيسي'));
  }
  house.floors.forEach(function(floor){
    if(!floor.id) floor.id = uid();
    floor.name = floor.name || 'دور ' + floor.id.slice(0,4);
    floor.rooms = floor.rooms || [];
    floor.rooms.forEach(function(room){
      if(!room.id) room.id = uid();
      room.number = room.number || room.name || 'غرفة ' + room.id.slice(0,4);
      if(!Array.isArray(room.beds)){
        if(typeof room.beds !== 'number'){
          if(room.beds !== undefined && room.beds !== null && room.beds !== '' && isFinite(parseInt(room.beds, 10))){
            room.beds = parseInt(room.beds, 10);
          }else{
            room.beds = parseInt(room.capacity, 10) || 1;
          }
        }
      }
      room.extraBeds = typeof room.extraBeds === 'number' ? room.extraBeds : (parseInt(room.extraBeds, 10) || 0);
      room.notes = room.notes || '';
      room.guests = room.guests || [];
      room.children = room.children || [];
      room.guests.forEach(function(guest){ guest.arrived = guest.arrived === true; });
      room.children.forEach(function(child){ child.arrived = child.arrived === true; });
      var roomOccupantIds = room.guests.concat(room.children).map(function(person){
        return String(person.personId || person.id || '');
      }).filter(Boolean);
      room.keyHolderPersonId = room.keyHolderPersonId && roomOccupantIds.indexOf(String(room.keyHolderPersonId)) !== -1
        ? String(room.keyHolderPersonId)
        : '';
      room.closed = !!room.closed;
      room.closedDay = room.closedDay === undefined ? null : room.closedDay;
    });
  });
  return house;
}

function getDays(){
  var conference=getCurrentConference();
  var linked=conference&&typeof getCanonicalConferenceCoreLink==='function'&&getCanonicalConferenceCoreLink(conference.id);
  if(linked){
    var state=window.PlatformIntegration&&typeof window.PlatformIntegration.getConferenceCoreState==='function'?window.PlatformIntegration.getConferenceCoreState(conference.id):null;
    return parseInt(state&&state.core&&state.core.days,10)||1;
  }
  var conf = (conference || {}).conf || {};
  return parseInt(conf.days)||1
}

function pushTrashItem(type, payload){
  appData.trash = appData.trash || {};
  appData.trash[type] = appData.trash[type] || [];
  appData.trash[type].push({ id: uid(), type: type, deletedAt: new Date().toISOString(), payload: deepClone(payload) });
}

function removeByIdFromArray(arr, id){
  var out = [];
  (arr || []).forEach(function(item){ if (item.id !== id) out.push(item); });
  return out;
}

function applyTemplate(id){
  var template = null;
  var templates = appData.templates || [];
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === id) {
      template = templates[i];
      break;
    }
  }
  if(!template) return;
  var newConf = deepClone(template.data);
  newConf.id = uid();
  newConf.name = template.name + ' (من قالب)';
  newConf.createdAt = new Date().toISOString();
  newConf.updatedAt = newConf.createdAt;
  delete newConf.peopleDb;
  appData.conferences.push(newConf);
  normalizeConference(newConf);
  appData.currentConferenceId = newConf.id;
  setCurrentConference(newConf);
  if(!save()) return false;
  renderSettings();
  renderTab(currentTab);
  showToast('✅ تم إنشاء مؤتمر من القالب');
  return true;
}

function archiveCurrentConference(){
  showToast('❌ الأرشفة المحلية القديمة متوقفة. استخدم حزمة المؤتمر المركزية.','#E74C3C');
  return false;
}

function createEmptyTrashStructure(sourceTrash){
  var emptyTrash={};
  if(sourceTrash&&typeof sourceTrash==='object'&&!Array.isArray(sourceTrash)){
    Object.keys(sourceTrash).forEach(function(key){
      var value=sourceTrash[key];
      if(Array.isArray(value))emptyTrash[key]=[];
      else if(value&&typeof value==='object')emptyTrash[key]={};
      else emptyTrash[key]=value;
    });
  }
  ['templates','archives','backups','houseTemplates','rooms'].forEach(function(key){
    emptyTrash[key]=[];
  });
  return emptyTrash;
}

function backupAppData(){
  showToast('❌ النسخ الداخلي القديم متوقف. استخدم حزمة المؤتمر أو النسخة الكاملة.','#E74C3C');
  return false;
}
