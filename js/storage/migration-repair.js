(function(global){
  'use strict';

  var ENGINE_VERSION = '1.0.0';
  var SUPPORTED_MISSING_ID_CODES = Object.freeze({
    MISSING_HOUSE_ID: {
      entityType: 'house',
      reason: 'Assign a missing house ID without changing its structure or contents.'
    },
    MISSING_FLOOR_ID: {
      entityType: 'floor',
      reason: 'Assign a missing floor ID without changing its structure or contents.'
    },
    MISSING_ROOM_ID: {
      entityType: 'room',
      reason: 'Assign a missing room ID without changing its structure or contents.'
    },
    MISSING_PERSON_ID: {
      entityType: 'person',
      reason: 'Assign a missing person ID without linking or changing any related records.'
    },
    MISSING_GUEST_ID: {
      entityType: 'guest',
      reason: 'Assign a missing guest ID without changing the guest or room assignment.'
    },
    MISSING_CHILD_ID: {
      entityType: 'child',
      reason: 'Assign a missing child ID without changing the child or related records.'
    }
  });

  function cloneAppData(appData){
    if(typeof global.structuredClone === 'function'){
      return global.structuredClone(appData);
    }

    var seen = typeof WeakMap === 'function' ? new WeakMap() : null;

    function cloneValue(value){
      if(value === null || typeof value !== 'object')return value;
      if(seen && seen.has(value))return seen.get(value);
      if(value instanceof Date)return new Date(value.getTime());
      if(Array.isArray(value)){
        var arrayClone = [];
        if(seen)seen.set(value,arrayClone);
        value.forEach(function(item,index){
          arrayClone[index] = cloneValue(item);
        });
        return arrayClone;
      }

      var objectClone = {};
      if(seen)seen.set(value,objectClone);
      Object.keys(value).forEach(function(key){
        objectClone[key] = cloneValue(value[key]);
      });
      return objectClone;
    }

    return cloneValue(appData);
  }

  function buildAppFingerprint(appData){
    var seen = typeof WeakSet === 'function' ? new WeakSet() : null;

    function stableSerialize(value){
      if(value === null)return 'null';
      if(typeof value === 'number'){
        if(Number.isNaN(value))return '"[NaN]"';
        if(value === Infinity)return '"[Infinity]"';
        if(value === -Infinity)return '"[-Infinity]"';
        return String(value);
      }
      if(typeof value === 'boolean')return value ? 'true' : 'false';
      if(typeof value === 'string')return JSON.stringify(value);
      if(typeof value === 'undefined')return '"[undefined]"';
      if(typeof value === 'bigint')return JSON.stringify(String(value)+'n');
      if(typeof value === 'function' || typeof value === 'symbol'){
        return JSON.stringify('['+typeof value+']');
      }
      if(value instanceof Date)return JSON.stringify(value.toISOString());
      if(seen){
        if(seen.has(value))throw new Error('MIGRATION_REPAIR_CIRCULAR_DATA');
        seen.add(value);
      }

      var serialized;
      if(Array.isArray(value)){
        serialized = '['+value.map(stableSerialize).join(',')+']';
      }else{
        serialized = '{'+Object.keys(value).sort().map(function(key){
          return JSON.stringify(key)+':'+stableSerialize(value[key]);
        }).join(',')+'}';
      }
      if(seen)seen.delete(value);
      return serialized;
    }

    var source = stableSerialize(appData);
    var first = 2166136261;
    var second = 2166136261;
    for(var index=0;index<source.length;index++){
      first ^= source.charCodeAt(index);
      first = Math.imul(first,16777619);
      second ^= source.charCodeAt(source.length-index-1);
      second = Math.imul(second,16777619);
    }
    return 'mr-fnv1a-'+
      (first>>>0).toString(16).padStart(8,'0')+
      (second>>>0).toString(16).padStart(8,'0');
  }

  function createSecureUuid(reservedIds){
    var cryptoApi = global.crypto;
    var uuid;
    var attempts = 0;

    do{
      attempts++;
      if(attempts > 100)throw new Error('MIGRATION_REPAIR_UUID_COLLISION_LIMIT');
      if(cryptoApi&&typeof cryptoApi.randomUUID === 'function'){
        uuid = cryptoApi.randomUUID();
      }else if(cryptoApi&&typeof cryptoApi.getRandomValues === 'function'){
        var bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        bytes[6] = (bytes[6]&15)|64;
        bytes[8] = (bytes[8]&63)|128;
        uuid = Array.prototype.map.call(bytes,function(byte,index){
          var value = byte.toString(16).padStart(2,'0');
          return index===4||index===6||index===8||index===10?'-'+value:value;
        }).join('');
      }else{
        throw new Error('MIGRATION_REPAIR_SECURE_UUID_UNAVAILABLE');
      }
    }while(reservedIds.has(uuid));

    reservedIds.add(uuid);
    return uuid;
  }

  function collectReservedIds(appData){
    var reservedIds = new Set();

    function reserve(value){
      if(value!==undefined&&value!==null&&String(value).trim()!==''){
        reservedIds.add(String(value));
      }
    }

    appData.conferences.forEach(function(conference){
      if(!conference||typeof conference!=='object')return;
      reserve(conference.id);
      var people = conference.peopleDb&&Array.isArray(conference.peopleDb.people)
        ?conference.peopleDb.people
        :[];
      people.forEach(function(person){
        if(person&&typeof person==='object')reserve(person.id);
      });
      (Array.isArray(conference.houses)?conference.houses:[]).forEach(function(house){
        if(!house||typeof house!=='object')return;
        reserve(house.id);
        (Array.isArray(house.floors)?house.floors:[]).forEach(function(floor){
          if(!floor||typeof floor!=='object')return;
          reserve(floor.id);
          (Array.isArray(floor.rooms)?floor.rooms:[]).forEach(function(room){
            if(!room||typeof room!=='object')return;
            reserve(room.id);
            (Array.isArray(room.guests)?room.guests:[]).forEach(function(guest){
              if(guest&&typeof guest==='object')reserve(guest.id);
            });
            (Array.isArray(room.children)?room.children:[]).forEach(function(child){
              if(child&&typeof child==='object')reserve(child.id);
            });
          });
        });
      });
    });
    return reservedIds;
  }

  function isMissingId(value){
    return value===undefined||value===null||String(value).trim()==='';
  }

  function readIndex(value){
    return Number.isInteger(value)&&value>=0?value:null;
  }

  function findUniqueEntityIndex(items,id){
    if(id===undefined||id===null||String(id).trim()==='')return null;
    var matches = [];
    (Array.isArray(items)?items:[]).forEach(function(item,index){
      if(item&&String(item.id)===String(id))matches.push(index);
    });
    return matches.length===1?matches[0]:null;
  }

  function resolveConferenceIndex(appData,issue){
    var details = issue&&issue.details&&typeof issue.details==='object'
      ?issue.details
      :{};
    var detailIndex = readIndex(details.conferenceIndex);
    if(detailIndex!==null&&detailIndex<appData.conferences.length){
      var detailConference = appData.conferences[detailIndex];
      if(!issue.conferenceId||
        (detailConference&&String(detailConference.id)===String(issue.conferenceId))){
        return detailIndex;
      }
    }

    if(issue&&issue.conferenceId!==undefined&&issue.conferenceId!==null&&
      String(issue.conferenceId).trim()!==''){
      var matches = [];
      appData.conferences.forEach(function(conference,index){
        if(conference&&String(conference.id)===String(issue.conferenceId)){
          matches.push(index);
        }
      });
      return matches.length===1?matches[0]:null;
    }
    return appData.conferences.length===1?0:null;
  }

  function resolveMissingIdEntity(appData,issue,entityType){
    var details = issue&&issue.details&&typeof issue.details==='object'
      ?issue.details
      :{};
    var conferenceIndex = resolveConferenceIndex(appData,issue);
    if(entityType==='person'){
      var personIndex = readIndex(details.personIndex);
      if(conferenceIndex===null||personIndex===null)return null;
      var personConference = appData.conferences[conferenceIndex];
      var people = personConference&&personConference.peopleDb&&
        Array.isArray(personConference.peopleDb.people)
        ?personConference.peopleDb.people
        :[];
      var person = people[personIndex];
      if(!person||typeof person!=='object'||!isMissingId(person.id))return null;
      return {
        entity: person,
        entityPath: {
          conferenceIndex: conferenceIndex,
          houseIndex: null,
          floorIndex: null,
          roomIndex: null,
          personIndex: personIndex,
          guestIndex: null,
          childIndex: null
        }
      };
    }

    var conference = conferenceIndex===null?null:appData.conferences[conferenceIndex];
    var conferenceHouses = conference&&Array.isArray(conference.houses)
      ?conference.houses
      :[];
    var houseIndex = readIndex(details.houseIndex);
    var isRoomMember = entityType==='guest'||entityType==='child';
    if(houseIndex===null&&isRoomMember){
      houseIndex = findUniqueEntityIndex(conferenceHouses,issue.houseId);
    }
    var selectedHouse = houseIndex===null?null:conferenceHouses[houseIndex];
    var floorIndex = entityType==='house'?null:readIndex(details.floorIndex);
    if(floorIndex===null&&isRoomMember){
      floorIndex = findUniqueEntityIndex(
        selectedHouse&&Array.isArray(selectedHouse.floors)?selectedHouse.floors:[],
        issue.floorId
      );
    }
    var selectedFloors = selectedHouse&&Array.isArray(selectedHouse.floors)
      ?selectedHouse.floors
      :[];
    var selectedFloor = floorIndex===null?null:selectedFloors[floorIndex];
    var needsRoom = entityType==='room'||isRoomMember;
    var roomIndex = needsRoom?readIndex(details.roomIndex):null;
    if(roomIndex===null&&isRoomMember){
      roomIndex = findUniqueEntityIndex(
        selectedFloor&&Array.isArray(selectedFloor.rooms)?selectedFloor.rooms:[],
        issue.roomId
      );
    }
    var guestIndex = entityType==='guest'?readIndex(details.guestIndex):null;
    var childIndex = entityType==='child'?readIndex(details.childIndex):null;
    if(conferenceIndex===null||houseIndex===null||
      (entityType!=='house'&&floorIndex===null)||
      (needsRoom&&roomIndex===null)||
      (entityType==='guest'&&guestIndex===null)||
      (entityType==='child'&&childIndex===null)){
      return null;
    }

    var houses = conference&&Array.isArray(conference.houses)?conference.houses:[];
    var house = houses[houseIndex];
    if(!house||typeof house!=='object')return null;

    var entity = house;
    if(entityType!=='house'){
      var floors = Array.isArray(house.floors)?house.floors:[];
      var floor = floors[floorIndex];
      if(!floor||typeof floor!=='object')return null;
      entity = floor;
      if(needsRoom){
        var rooms = Array.isArray(floor.rooms)?floor.rooms:[];
        var room = rooms[roomIndex];
        if(!room||typeof room!=='object')return null;
        entity = room;
        if(entityType==='guest'){
          var guests = Array.isArray(room.guests)?room.guests:[];
          var guest = guests[guestIndex];
          if(!guest||typeof guest!=='object')return null;
          entity = guest;
        }else if(entityType==='child'){
          var children = Array.isArray(room.children)?room.children:[];
          var child = children[childIndex];
          if(!child||typeof child!=='object')return null;
          entity = child;
        }
      }
    }
    if(!isMissingId(entity.id))return null;

    return {
      entity: entity,
      entityPath: {
        conferenceIndex: conferenceIndex,
        houseIndex: houseIndex,
        floorIndex: floorIndex,
        roomIndex: roomIndex,
        personIndex: null,
        guestIndex: guestIndex,
        childIndex: childIndex
      }
    };
  }

  function resolveEntityByPath(appData,entityType,entityPath){
    if(entityType!=='house'&&entityType!=='floor'&&entityType!=='room'&&
      entityType!=='person'&&entityType!=='guest'&&entityType!=='child')return null;
    if(!entityPath||typeof entityPath!=='object'||Array.isArray(entityPath))return null;

    var conferenceIndex = readIndex(entityPath.conferenceIndex);
    if(conferenceIndex===null)return null;
    var conferences = appData&&Array.isArray(appData.conferences)
      ?appData.conferences
      :[];
    var conference = conferences[conferenceIndex];
    if(entityType==='person'){
      var personIndex = readIndex(entityPath.personIndex);
      var people = conference&&conference.peopleDb&&
        Array.isArray(conference.peopleDb.people)
        ?conference.peopleDb.people
        :[];
      var person = personIndex===null?null:people[personIndex];
      return person&&typeof person==='object'?person:null;
    }

    var houseIndex = readIndex(entityPath.houseIndex);
    var floorIndex = entityType==='house'?null:readIndex(entityPath.floorIndex);
    var isRoomMember = entityType==='guest'||entityType==='child';
    var needsRoom = entityType==='room'||isRoomMember;
    var roomIndex = needsRoom?readIndex(entityPath.roomIndex):null;
    var guestIndex = entityType==='guest'?readIndex(entityPath.guestIndex):null;
    var childIndex = entityType==='child'?readIndex(entityPath.childIndex):null;
    if(houseIndex===null||
      (entityType!=='house'&&floorIndex===null)||
      (needsRoom&&roomIndex===null)||
      (entityType==='guest'&&guestIndex===null)||
      (entityType==='child'&&childIndex===null)){
      return null;
    }

    var houses = conference&&Array.isArray(conference.houses)?conference.houses:[];
    var house = houses[houseIndex];
    if(!house||typeof house!=='object')return null;
    if(entityType==='house')return house;

    var floors = Array.isArray(house.floors)?house.floors:[];
    var floor = floors[floorIndex];
    if(!floor||typeof floor!=='object')return null;
    if(entityType==='floor')return floor;

    var rooms = Array.isArray(floor.rooms)?floor.rooms:[];
    var room = rooms[roomIndex];
    if(!room||typeof room!=='object')return null;
    if(entityType==='room')return room;

    var guests = Array.isArray(room.guests)?room.guests:[];
    if(entityType==='guest'){
      var guest = guests[guestIndex];
      return guest&&typeof guest==='object'?guest:null;
    }
    var children = Array.isArray(room.children)?room.children:[];
    var child = children[childIndex];
    return child&&typeof child==='object'?child:null;
  }

  function isUuidV4(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function createActionOutcome(action,status,reason){
    return {
      actionId: action&&action.actionId?action.actionId:null,
      code: action&&action.code?action.code:'',
      status: status,
      reason: reason||'',
      oldValue: action?action.oldValue:undefined,
      newValue: action?action.newValue:undefined,
      entityPath: action&&action.entityPath?cloneAppData(action.entityPath):null
    };
  }

  function getAuditIssueList(auditReport){
    var issues = [];

    function append(list,issueType){
      (Array.isArray(list)?list:[]).forEach(function(issue){
        if(!issue||typeof issue!=='object')return;
        issues.push({
          type: issueType,
          issue: issue
        });
      });
    }

    append(auditReport&&auditReport.errors,'error');
    append(auditReport&&auditReport.warnings,'warning');
    (auditReport&&Array.isArray(auditReport.conferences)
      ?auditReport.conferences
      :[]).forEach(function(conferenceReport){
      append(conferenceReport&&conferenceReport.errors,'error');
      append(conferenceReport&&conferenceReport.warnings,'warning');
    });
    return issues;
  }

  function countAuditIssuesByCode(issueEntries){
    var counts = {};
    issueEntries.forEach(function(entry){
      var code = entry&&entry.issue&&entry.issue.code;
      if(code)counts[code] = (counts[code]||0)+1;
    });
    return counts;
  }

  function normalizeFingerprintValue(value,idNormalizations){
    if(value===null||typeof value!=='object'){
      if(value!==undefined&&value!==null&&idNormalizations.has(String(value))){
        return idNormalizations.get(String(value));
      }
      return value;
    }
    if(Array.isArray(value)){
      return value.map(function(item){
        return normalizeFingerprintValue(item,idNormalizations);
      });
    }
    var normalized = {};
    Object.keys(value).sort().forEach(function(key){
      normalized[key] = normalizeFingerprintValue(value[key],idNormalizations);
    });
    return normalized;
  }

  function buildAuditIssueFingerprint(entry,idNormalizations){
    var issue = entry&&entry.issue&&typeof entry.issue==='object'?entry.issue:{};
    return buildAppFingerprint({
      type: entry&&entry.type?entry.type:'',
      code: issue.code||'',
      conferenceId: normalizeFingerprintValue(issue.conferenceId,idNormalizations),
      houseId: normalizeFingerprintValue(issue.houseId,idNormalizations),
      floorId: normalizeFingerprintValue(issue.floorId,idNormalizations),
      roomId: normalizeFingerprintValue(issue.roomId,idNormalizations),
      entityId: normalizeFingerprintValue(issue.entityId,idNormalizations),
      personId: normalizeFingerprintValue(issue.personId,idNormalizations),
      details: normalizeFingerprintValue(issue.details||{},idNormalizations)
    });
  }

  function getAuditStats(auditReport){
    var stats = auditReport&&auditReport.stats&&typeof auditReport.stats==='object'
      ?auditReport.stats
      :{};
    var summary = auditReport&&auditReport.summary&&typeof auditReport.summary==='object'
      ?auditReport.summary
      :{};

    function count(value){
      var number = Number(value);
      return Number.isFinite(number)&&number>=0?number:0;
    }

    return {
      conferences: count(summary.conferences),
      houses: count(stats.houses),
      floors: count(stats.floors),
      rooms: count(stats.rooms),
      people: count(stats.people),
      guests: count(stats.guests),
      children: count(stats.children)
    };
  }

  function compareEntityCounts(countsBefore,countsAfter){
    var changes = [];
    Object.keys(countsBefore).forEach(function(entityType){
      var before = countsBefore[entityType];
      var after = countsAfter[entityType];
      if(before!==after){
        changes.push({
          entityType: entityType,
          before: before,
          after: after,
          delta: after-before
        });
      }
    });
    return changes;
  }

  function buildEntityPathKey(entityType,entityPath){
    if(!entityPath||typeof entityPath!=='object')return '';
    return entityType+':'+[
      entityPath.conferenceIndex,
      entityPath.houseIndex,
      entityPath.floorIndex,
      entityPath.roomIndex,
      entityPath.personIndex,
      entityPath.guestIndex,
      entityPath.childIndex
    ].join('/');
  }

  function collectAllIdCounts(appData){
    var counts = {};

    function count(value){
      if(value===undefined||value===null||String(value).trim()==='')return;
      var key = String(value);
      counts[key] = (counts[key]||0)+1;
    }

    appData.conferences.forEach(function(conference){
      if(!conference||typeof conference!=='object')return;
      count(conference.id);
      var people = conference.peopleDb&&Array.isArray(conference.peopleDb.people)
        ?conference.peopleDb.people
        :[];
      people.forEach(function(person){
        if(person&&typeof person==='object')count(person.id);
      });
      (Array.isArray(conference.houses)?conference.houses:[]).forEach(function(house){
        if(!house||typeof house!=='object')return;
        count(house.id);
        (Array.isArray(house.floors)?house.floors:[]).forEach(function(floor){
          if(!floor||typeof floor!=='object')return;
          count(floor.id);
          (Array.isArray(floor.rooms)?floor.rooms:[]).forEach(function(room){
            if(!room||typeof room!=='object')return;
            count(room.id);
            (Array.isArray(room.guests)?room.guests:[]).forEach(function(guest){
              if(guest&&typeof guest==='object')count(guest.id);
            });
            (Array.isArray(room.children)?room.children:[]).forEach(function(child){
              if(child&&typeof child==='object')count(child.id);
            });
          });
        });
      });
    });
    return counts;
  }

  function validateAppliedAction(repairedAppData,action,newValueCounts,
    allIdCounts,remainingPathKeys){
    var entity = resolveEntityByPath(repairedAppData,action.entityType,action.entityPath);
    var actualValue = entity?entity.id:undefined;
    var reason = '';
    if(!entity){
      reason = 'ENTITY_PATH_NOT_FOUND';
    }else if(actualValue!==action.newValue){
      reason = 'ID_VALUE_MISMATCH';
    }else if(!isUuidV4(actualValue)){
      reason = 'INVALID_UUID_V4';
    }else if((newValueCounts[String(action.newValue)]||0)>1){
      reason = 'DUPLICATE_ACTION_NEW_VALUE';
    }else if((allIdCounts[String(action.newValue)]||0)>1){
      reason = 'NEW_VALUE_USED_BY_MULTIPLE_ENTITIES';
    }else if(remainingPathKeys.has(buildEntityPathKey(action.entityType,action.entityPath))){
      reason = 'MISSING_ID_ISSUE_REMAINS';
    }
    return {
      actionId: action.actionId||null,
      code: action.code||'',
      entityType: action.entityType||'',
      entityPath: action.entityPath?cloneAppData(action.entityPath):null,
      expectedValue: action.newValue,
      actualValue: actualValue,
      passed: reason==='',
      reason: reason
    };
  }

  function createEmptyRepairPlan(planId,operationId){
    return {
      planId: planId||null,
      operationId: operationId||null,
      createdAt: new Date().toISOString(),
      sourceAuditGeneratedAt: null,
      sourceFingerprint: null,
      engineVersion: ENGINE_VERSION,
      options: {},
      safeActions: [],
      conditionalActions: [],
      manualIssues: [],
      dependencies: [],
      idRemaps: [],
      summary: {
        total: 0,
        safe: 0,
        conditional: 0,
        manual: 0
      }
    };
  }

  function createRepairAction(values){
    values = values||{};
    return {
      actionId: values.actionId||null,
      operationId: values.operationId||null,
      code: values.code||'',
      actionType: values.actionType||'',
      conferenceId: values.conferenceId===undefined?null:values.conferenceId,
      houseId: values.houseId===undefined?null:values.houseId,
      floorId: values.floorId===undefined?null:values.floorId,
      roomId: values.roomId===undefined?null:values.roomId,
      entityType: values.entityType||'',
      entityId: values.entityId===undefined?null:values.entityId,
      entityPath: values.entityPath||{},
      field: values.field||'',
      oldValue: values.oldValue,
      newValue: values.newValue,
      reason: values.reason||'',
      dependencies: Array.isArray(values.dependencies)?values.dependencies:[],
      preconditions: Array.isArray(values.preconditions)?values.preconditions:[],
      reversible: values.reversible===true,
      riskLevel: values.riskLevel||'none',
      status: values.status||'not_implemented'
    };
  }

  function createRepairResult(){
    return {
      success: false,
      operationId: null,
      backupId: null,
      repairedData: null,
      validation: null,
      summary: null,
      appliedActions: [],
      skippedActions: [],
      failedActions: [],
      errors: [],
      warnings: []
    };
  }

  function analyzeRepairPlan(appData,auditReport,options){
    if(!appData||typeof appData!=='object'||Array.isArray(appData)||
      !Array.isArray(appData.conferences)){
      throw new TypeError('MIGRATION_REPAIR_INVALID_APP_DATA');
    }
    if(!auditReport||typeof auditReport!=='object'||Array.isArray(auditReport)||
      !Array.isArray(auditReport.errors)||!Array.isArray(auditReport.warnings)){
      throw new TypeError('MIGRATION_REPAIR_INVALID_AUDIT_REPORT');
    }

    var reservedIds = collectReservedIds(appData);
    var plan = createEmptyRepairPlan(
      createSecureUuid(reservedIds),
      createSecureUuid(reservedIds)
    );
    plan.sourceAuditGeneratedAt = auditReport.generatedAt||null;
    plan.sourceFingerprint = buildAppFingerprint(appData);
    plan.options = options&&typeof options === 'object'&&!Array.isArray(options)
      ?cloneAppData(options)
      :{};

    var actionKeys = new Set();
    getAuditIssueList(auditReport).forEach(function(issueEntry){
      var issue = issueEntry.issue;
      if(!issue||typeof issue!=='object')return;
      var definition = SUPPORTED_MISSING_ID_CODES[issue.code];
      if(!definition)return;

      var resolved = resolveMissingIdEntity(appData,issue,definition.entityType);
      if(!resolved){
        plan.manualIssues.push({
          issue: cloneAppData(issue),
          reason: 'The missing-ID entity could not be resolved to one structural path.'
        });
        return;
      }

      var path = resolved.entityPath;
      var actionKey = buildEntityPathKey(definition.entityType,path)+':id';
      if(actionKeys.has(actionKey))return;
      actionKeys.add(actionKey);

      var actualId = resolved.entity.id;
      var oldValue = actualId===null?null:undefined;
      plan.safeActions.push(createRepairAction({
        actionId: createSecureUuid(reservedIds),
        operationId: plan.operationId,
        code: issue.code,
        actionType: 'ASSIGN_ID',
        conferenceId: issue.conferenceId===undefined?null:issue.conferenceId,
        houseId: issue.houseId===undefined?null:issue.houseId,
        floorId: issue.floorId===undefined?null:issue.floorId,
        roomId: issue.roomId===undefined?null:issue.roomId,
        entityType: definition.entityType,
        entityId: null,
        entityPath: cloneAppData(path),
        field: 'id',
        oldValue: oldValue,
        newValue: createSecureUuid(reservedIds),
        reason: definition.reason,
        dependencies: [],
        preconditions: [{
          type: 'FIELD_MISSING',
          field: 'id',
          expectedValue: oldValue
        }],
        reversible: true,
        riskLevel: 'low',
        status: 'planned'
      }));
    });

    plan.summary.safe = plan.safeActions.length;
    plan.summary.conditional = plan.conditionalActions.length;
    plan.summary.manual = plan.manualIssues.length;
    plan.summary.total = plan.summary.safe+
      plan.summary.conditional+
      plan.summary.manual;
    return plan;
  }

  function applyRepairPlan(appData,repairPlan,options){
    var result = createRepairResult();
    if(!appData||typeof appData!=='object'||Array.isArray(appData)||
      !Array.isArray(appData.conferences)){
      result.errors.push({
        code: 'INVALID_APP_DATA',
        message: 'Migration repair requires valid appData.'
      });
      result.summary = buildRepairSummary(result);
      return result;
    }
    if(!repairPlan||typeof repairPlan!=='object'||Array.isArray(repairPlan)||
      !Array.isArray(repairPlan.safeActions)||
      typeof repairPlan.sourceFingerprint!=='string'||
      !repairPlan.sourceFingerprint){
      result.errors.push({
        code: 'INVALID_REPAIR_PLAN',
        message: 'Migration repair requires a valid repair plan.'
      });
      result.summary = buildRepairSummary(result);
      return result;
    }

    result.operationId = repairPlan.operationId||null;
    var currentFingerprint = buildAppFingerprint(appData);
    if(currentFingerprint!==repairPlan.sourceFingerprint){
      result.errors.push({
        code: 'SOURCE_FINGERPRINT_MISMATCH',
        message: 'The source data no longer matches the repair plan.'
      });
      result.summary = buildRepairSummary(result);
      return result;
    }

    options = options&&typeof options==='object'&&!Array.isArray(options)?options:{};
    var includeSafe = options.includeSafe!==false;
    var atomic = options.atomic!==false;
    var allowedActionIds = Array.isArray(options.allowedActionIds)
      ?new Set(options.allowedActionIds.map(function(value){return String(value);}))
      :null;
    var workingData = cloneAppData(appData);
    var reservedIds = collectReservedIds(workingData);
    var supportedCodes = SUPPORTED_MISSING_ID_CODES;
    var actions = includeSafe?repairPlan.safeActions:[];
    var atomicFailure = false;

    for(var index=0;index<actions.length;index++){
      var action = actions[index];
      if(!action||typeof action!=='object'){
        result.failedActions.push(createActionOutcome(action,'failed','INVALID_ACTION'));
        atomicFailure = true;
        if(atomic)break;
        continue;
      }
      if(allowedActionIds&&!allowedActionIds.has(String(action.actionId))){
        result.skippedActions.push(createActionOutcome(action,'skipped','ACTION_NOT_ALLOWED'));
        continue;
      }
      if(action.actionType!=='ASSIGN_ID'||action.field!=='id'||
        !supportedCodes[action.code]||action.riskLevel!=='low'||
        action.status!=='planned'||
        supportedCodes[action.code].entityType!==action.entityType){
        result.skippedActions.push(createActionOutcome(action,'skipped','UNSUPPORTED_ACTION'));
        result.warnings.push({
          code: 'UNSUPPORTED_ACTION',
          actionId: action.actionId||null
        });
        continue;
      }

      var entity = resolveEntityByPath(workingData,action.entityType,action.entityPath);
      var failureReason = '';
      if(!entity){
        failureReason = 'ENTITY_PATH_NOT_FOUND';
      }else if(!isMissingId(entity.id)){
        failureReason = 'ID_IS_NOT_MISSING';
      }else if(!isUuidV4(action.newValue)){
        failureReason = 'INVALID_NEW_UUID';
      }else if(reservedIds.has(String(action.newValue))){
        failureReason = 'NEW_ID_ALREADY_IN_USE';
      }else if(action.operationId&&repairPlan.operationId&&
        String(action.operationId)!==String(repairPlan.operationId)){
        failureReason = 'OPERATION_ID_MISMATCH';
      }

      if(failureReason){
        result.failedActions.push(createActionOutcome(action,'failed',failureReason));
        result.errors.push({
          code: 'ACTION_PRECONDITION_FAILED',
          actionId: action.actionId||null,
          reason: failureReason
        });
        atomicFailure = true;
        if(atomic)break;
        continue;
      }

      var previousValue = entity.id;
      entity.id = action.newValue;
      reservedIds.add(String(action.newValue));
      var appliedOutcome = createActionOutcome(action,'applied','');
      appliedOutcome.oldValue = previousValue===null?null:undefined;
      result.appliedActions.push(appliedOutcome);
    }

    if(atomic&&atomicFailure){
      result.success = false;
      result.repairedData = null;
    }else{
      result.success = result.failedActions.length===0;
      result.repairedData = workingData;
    }
    result.summary = buildRepairSummary(result);
    return result;
  }

  function validateRepairResult(originalAudit,repairedAppData,repairPlan){
    var validation = {
      valid: false,
      originalAuditGeneratedAt: originalAudit&&originalAudit.generatedAt
        ?originalAudit.generatedAt
        :null,
      repairedAuditGeneratedAt: null,
      originalAudit: originalAudit||null,
      repairedAudit: null,
      countsBefore: null,
      countsAfter: null,
      resolvedCodes: [],
      remainingTargetIssues: [],
      newIssues: [],
      entityCountChanges: [],
      actionChecks: [],
      errors: [],
      warnings: []
    };

    if(!originalAudit||typeof originalAudit!=='object'||Array.isArray(originalAudit)||
      !Array.isArray(originalAudit.errors)||!Array.isArray(originalAudit.warnings)){
      validation.errors.push({
        code: 'INVALID_ORIGINAL_AUDIT',
        message: 'A valid original audit report is required.'
      });
      return validation;
    }
    if(!repairedAppData||typeof repairedAppData!=='object'||
      Array.isArray(repairedAppData)||!Array.isArray(repairedAppData.conferences)){
      validation.errors.push({
        code: 'INVALID_REPAIRED_APP_DATA',
        message: 'Valid repaired appData is required.'
      });
      return validation;
    }
    if(!repairPlan||typeof repairPlan!=='object'||Array.isArray(repairPlan)||
      !Array.isArray(repairPlan.safeActions)){
      validation.errors.push({
        code: 'INVALID_REPAIR_PLAN',
        message: 'A valid repair plan is required.'
      });
      return validation;
    }
    if(!global.MigrationAudit||
      typeof global.MigrationAudit.auditAppData!=='function'){
      validation.errors.push({
        code: 'MIGRATION_AUDIT_UNAVAILABLE',
        message: 'MigrationAudit.auditAppData is unavailable.'
      });
      return validation;
    }

    var repairedAudit;
    try{
      repairedAudit = global.MigrationAudit.auditAppData(repairedAppData);
    }catch(error){
      validation.errors.push({
        code: 'REPAIRED_AUDIT_FAILED',
        message: error&&error.message?error.message:'Migration audit failed.'
      });
      return validation;
    }
    if(!repairedAudit||typeof repairedAudit!=='object'){
      validation.errors.push({
        code: 'INVALID_REPAIRED_AUDIT',
        message: 'MigrationAudit returned an invalid report.'
      });
      return validation;
    }

    validation.repairedAudit = repairedAudit;
    validation.repairedAuditGeneratedAt = repairedAudit.generatedAt||null;
    validation.countsBefore = getAuditStats(originalAudit);
    validation.countsAfter = getAuditStats(repairedAudit);
    validation.entityCountChanges = compareEntityCounts(
      validation.countsBefore,
      validation.countsAfter
    );
    validation.entityCountChanges.forEach(function(change){
      validation.errors.push({
        code: 'ENTITY_COUNT_CHANGED',
        entityType: change.entityType,
        before: change.before,
        after: change.after,
        delta: change.delta
      });
    });

    var targetCodes = SUPPORTED_MISSING_ID_CODES;
    var originalIssues = getAuditIssueList(originalAudit);
    var repairedIssues = getAuditIssueList(repairedAudit);
    var originalCounts = countAuditIssuesByCode(originalIssues);
    var repairedCounts = countAuditIssuesByCode(repairedIssues);
    Object.keys(targetCodes).forEach(function(code){
      var before = originalCounts[code]||0;
      var after = repairedCounts[code]||0;
      if(before>after){
        validation.resolvedCodes.push({
          code: code,
          before: before,
          after: after,
          resolved: before-after
        });
      }
    });

    repairedIssues.forEach(function(entry){
      if(targetCodes[entry.issue.code]){
        validation.remainingTargetIssues.push(cloneAppData(entry.issue));
      }
    });

    var targetActions = repairPlan.safeActions.filter(function(action){
      return action&&action.actionType==='ASSIGN_ID'&&action.field==='id'&&
        targetCodes[action.code]&&
        targetCodes[action.code].entityType===action.entityType;
    });
    var idNormalizations = new Map();
    var newValueCounts = {};
    targetActions.forEach(function(action){
      if(action.newValue!==undefined&&action.newValue!==null){
        idNormalizations.set(String(action.newValue),null);
        newValueCounts[String(action.newValue)] =
          (newValueCounts[String(action.newValue)]||0)+1;
      }
    });

    var remainingPathKeys = new Set();
    repairedIssues.forEach(function(entry){
      var definition = targetCodes[entry.issue.code];
      if(!definition)return;
      var resolved = resolveMissingIdEntity(
        repairedAppData,
        entry.issue,
        definition.entityType
      );
      if(resolved){
        remainingPathKeys.add(buildEntityPathKey(
          definition.entityType,
          resolved.entityPath
        ));
      }
    });
    var allIdCounts = collectAllIdCounts(repairedAppData);
    targetActions.forEach(function(action){
      validation.actionChecks.push(validateAppliedAction(
        repairedAppData,
        action,
        newValueCounts,
        allIdCounts,
        remainingPathKeys
      ));
    });
    var targetActionPathKeys = new Set(targetActions.map(function(action){
      return buildEntityPathKey(action.entityType,action.entityPath);
    }));
    var relatedRemainingTargetIssueCount = 0;
    remainingPathKeys.forEach(function(pathKey){
      if(targetActionPathKeys.has(pathKey))relatedRemainingTargetIssueCount++;
    });
    validation.actionChecks.forEach(function(check){
      if(!check.passed){
        validation.errors.push({
          code: 'ACTION_CHECK_FAILED',
          actionId: check.actionId,
          reason: check.reason
        });
      }
    });

    var originalFingerprintCounts = {};
    originalIssues.forEach(function(entry){
      var fingerprint = buildAuditIssueFingerprint(entry,idNormalizations);
      originalFingerprintCounts[fingerprint] =
        (originalFingerprintCounts[fingerprint]||0)+1;
    });
    repairedIssues.forEach(function(entry){
      var fingerprint = buildAuditIssueFingerprint(entry,idNormalizations);
      if(originalFingerprintCounts[fingerprint]>0){
        originalFingerprintCounts[fingerprint]--;
        return;
      }
      validation.newIssues.push({
        type: entry.type,
        issue: cloneAppData(entry.issue),
        fingerprint: fingerprint
      });
    });

    validation.newIssues.forEach(function(entry){
      if(entry.type==='error'){
        validation.errors.push({
          code: 'NEW_DANGEROUS_ISSUE',
          issueCode: entry.issue.code||''
        });
      }
    });
    if(relatedRemainingTargetIssueCount){
      validation.errors.push({
        code: 'TARGET_ISSUES_REMAIN',
        count: relatedRemainingTargetIssueCount
      });
    }

    validation.valid = validation.errors.length===0&&
      validation.entityCountChanges.length===0&&
      validation.actionChecks.every(function(check){return check.passed;})&&
      !validation.newIssues.some(function(entry){return entry.type==='error';});
    return validation;
  }

  function buildRepairSummary(repairResult){
    var applied = repairResult&&Array.isArray(repairResult.appliedActions)
      ?repairResult.appliedActions.length
      :0;
    var skipped = repairResult&&Array.isArray(repairResult.skippedActions)
      ?repairResult.skippedActions.length
      :0;
    var failed = repairResult&&Array.isArray(repairResult.failedActions)
      ?repairResult.failedActions.length
      :0;
    return {
      success: !!(repairResult&&repairResult.success),
      total: applied+skipped+failed,
      applied: applied,
      skipped: skipped,
      failed: failed,
      errors: repairResult&&Array.isArray(repairResult.errors)
        ?repairResult.errors.length
        :0,
      warnings: repairResult&&Array.isArray(repairResult.warnings)
        ?repairResult.warnings.length
        :0
    };
  }

  function runRepairPipeline(appData,auditReport,options){
    var pipelineResult = {
      success: false,
      plan: null,
      applyResult: null,
      validation: null,
      summary: null,
      errors: [],
      warnings: []
    };

    try{
      pipelineResult.plan = analyzeRepairPlan(appData,auditReport,options);
    }catch(error){
      pipelineResult.errors.push({
        code: 'REPAIR_ANALYSIS_FAILED',
        message: error&&error.message?error.message:'Repair analysis failed.'
      });
      pipelineResult.summary = {
        status: 'analysis_failed',
        safeActions: 0,
        applied: 0,
        skipped: 0,
        failed: 0,
        valid: false
      };
      return pipelineResult;
    }

    if(!pipelineResult.plan.safeActions.length){
      pipelineResult.success = true;
      pipelineResult.warnings.push({
        code: 'NO_SAFE_ACTIONS',
        message: 'The repair plan contains no safe actions to apply.'
      });
      pipelineResult.summary = {
        status: 'no_actions',
        safeActions: 0,
        applied: 0,
        skipped: 0,
        failed: 0,
        valid: null
      };
      return pipelineResult;
    }

    pipelineResult.applyResult = applyRepairPlan(
      appData,
      pipelineResult.plan,
      options
    );
    if(Array.isArray(pipelineResult.applyResult.errors)){
      pipelineResult.errors = pipelineResult.errors.concat(
        pipelineResult.applyResult.errors.map(cloneAppData)
      );
    }
    if(Array.isArray(pipelineResult.applyResult.warnings)){
      pipelineResult.warnings = pipelineResult.warnings.concat(
        pipelineResult.applyResult.warnings.map(cloneAppData)
      );
    }
    if(!pipelineResult.applyResult.success){
      pipelineResult.summary = {
        status: 'apply_failed',
        safeActions: pipelineResult.plan.safeActions.length,
        applied: pipelineResult.applyResult.appliedActions.length,
        skipped: pipelineResult.applyResult.skippedActions.length,
        failed: pipelineResult.applyResult.failedActions.length,
        valid: false
      };
      return pipelineResult;
    }

    pipelineResult.validation = validateRepairResult(
      auditReport,
      pipelineResult.applyResult.repairedData,
      pipelineResult.plan
    );
    if(Array.isArray(pipelineResult.validation.errors)){
      pipelineResult.errors = pipelineResult.errors.concat(
        pipelineResult.validation.errors.map(cloneAppData)
      );
    }
    if(Array.isArray(pipelineResult.validation.warnings)){
      pipelineResult.warnings = pipelineResult.warnings.concat(
        pipelineResult.validation.warnings.map(cloneAppData)
      );
    }
    pipelineResult.success = pipelineResult.validation.valid===true;
    pipelineResult.summary = {
      status: pipelineResult.success?'completed':'validation_failed',
      safeActions: pipelineResult.plan.safeActions.length,
      applied: pipelineResult.applyResult.appliedActions.length,
      skipped: pipelineResult.applyResult.skippedActions.length,
      failed: pipelineResult.applyResult.failedActions.length,
      valid: pipelineResult.validation.valid===true
    };
    return pipelineResult;
  }

  global.MigrationRepair = Object.freeze({
    analyzeRepairPlan: analyzeRepairPlan,
    applyRepairPlan: applyRepairPlan,
    validateRepairResult: validateRepairResult,
    buildRepairSummary: buildRepairSummary,
    runRepairPipeline: runRepairPipeline
  });
})(window);
