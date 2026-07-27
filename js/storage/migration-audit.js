(function(global){
  'use strict';

  function asArray(value){
    return Array.isArray(value)?value:[];
  }

  function hasId(value){
    return value!==undefined&&value!==null&&String(value).trim()!=='';
  }

  function addIssue(target,type,code,message,context,details){
    var issue = {
      code: code,
      message: message,
      conferenceId: context.conferenceId||null,
      houseId: context.houseId||null,
      floorId: context.floorId||null,
      roomId: context.roomId||null,
      entityId: context.entityId||null,
      personId: context.personId||null,
      details: details||{}
    };
    target[type].push(issue);
    return issue;
  }

  function registerId(seen,id,context,target,duplicateCode,message){
    if(!hasId(id))return;
    var key = String(id);
    if(seen[key]){
      addIssue(target,'errors',duplicateCode,message,context,{
        firstLocation: seen[key]
      });
    }else{
      seen[key] = {
        houseId: context.houseId||null,
        floorId: context.floorId||null,
        roomId: context.roomId||null,
        entityId: context.entityId||null
      };
    }
  }

  function auditAppData(appData){
    var report = {
      valid: true,
      generatedAt: new Date().toISOString(),
      summary: {
        conferences: 0,
        errors: 0,
        warnings: 0
      },
      stats: {
        houses: 0,
        floors: 0,
        rooms: 0,
        people: 0,
        guests: 0,
        children: 0
      },
      errors: [],
      warnings: [],
      conferences: []
    };

    if(!appData||typeof appData!=='object'||Array.isArray(appData)){
      addIssue(report,'errors','INVALID_APP_DATA','بيانات التطبيق غير موجودة أو غير صالحة.',{},{
        receivedType: appData===null?'null':typeof appData
      });
    }else if(!Array.isArray(appData.conferences)){
      addIssue(report,'errors','INVALID_CONFERENCES_COLLECTION','قائمة المؤتمرات غير موجودة أو ليست مصفوفة.',{},{
        receivedType: typeof appData.conferences
      });
    }else{
      report.summary.conferences = appData.conferences.length;

      appData.conferences.forEach(function(conference,conferenceIndex){
        conference = conference&&typeof conference==='object'?conference:{};
        var conferenceId = hasId(conference.id)?conference.id:null;
        var conferenceReport = {
          conferenceId: conferenceId,
          conferenceName: conference.name||(conference.conf&&conference.conf.name)||'',
          errors: [],
          warnings: [],
          stats: {
            houses: 0,
            floors: 0,
            rooms: 0,
            people: 0,
            guests: 0,
            children: 0
          }
        };
        var baseContext = {conferenceId:conferenceId};
        var people = asArray(conference.peopleDb&&conference.peopleDb.people);
        var personIds = {};
        var houseIds = {};
        var floorIds = {};
        var roomIds = {};
        var guestIds = {};
        var childIds = {};
        var guestAssignments = {};

        people.forEach(function(person,personIndex){
          person = person&&typeof person==='object'?person:{};
          conferenceReport.stats.people++;
          var personContext = {
            conferenceId: conferenceId,
            entityId: hasId(person.id)?person.id:null,
            personId: hasId(person.id)?person.id:null
          };
          if(!hasId(person.id)){
            addIssue(conferenceReport,'errors','MISSING_PERSON_ID','يوجد شخص في peopleDb بدون id.',personContext,{
              personIndex: personIndex,
              name: person.name||person.fullName||''
            });
          }else{
            registerId(personIds,person.id,personContext,conferenceReport,'DUPLICATE_PERSON_ID','يوجد person.id مكرر داخل المؤتمر.');
          }
        });

        asArray(conference.houses).forEach(function(house,houseIndex){
          house = house&&typeof house==='object'?house:{};
          conferenceReport.stats.houses++;
          var houseContext = {
            conferenceId: conferenceId,
            houseId: hasId(house.id)?house.id:null,
            entityId: hasId(house.id)?house.id:null
          };
          if(!hasId(house.id)){
            addIssue(conferenceReport,'errors','MISSING_HOUSE_ID','يوجد بيت بدون id.',houseContext,{
              houseIndex: houseIndex,
              name: house.name||''
            });
          }else{
            registerId(houseIds,house.id,houseContext,conferenceReport,'DUPLICATE_HOUSE_ID','يوجد house.id مكرر داخل المؤتمر.');
          }

          asArray(house.floors).forEach(function(floor,floorIndex){
            floor = floor&&typeof floor==='object'?floor:{};
            conferenceReport.stats.floors++;
            var floorContext = {
              conferenceId: conferenceId,
              houseId: houseContext.houseId,
              floorId: hasId(floor.id)?floor.id:null,
              entityId: hasId(floor.id)?floor.id:null
            };
            if(!hasId(floor.id)){
              addIssue(conferenceReport,'errors','MISSING_FLOOR_ID','يوجد دور بدون id.',floorContext,{
                houseIndex: houseIndex,
                floorIndex: floorIndex,
                name: floor.name||''
              });
            }else{
              registerId(floorIds,floor.id,floorContext,conferenceReport,'DUPLICATE_FLOOR_ID','يوجد floor.id مكرر داخل المؤتمر.');
            }

            asArray(floor.rooms).forEach(function(room,roomIndex){
              room = room&&typeof room==='object'?room:{};
              conferenceReport.stats.rooms++;
              var roomContext = {
                conferenceId: conferenceId,
                houseId: houseContext.houseId,
                floorId: floorContext.floorId,
                roomId: hasId(room.id)?room.id:null,
                entityId: hasId(room.id)?room.id:null
              };
              if(!hasId(room.id)){
                addIssue(conferenceReport,'errors','MISSING_ROOM_ID','توجد غرفة بدون id.',roomContext,{
                  houseIndex: houseIndex,
                  floorIndex: floorIndex,
                  roomIndex: roomIndex,
                  number: room.number||''
                });
              }else{
                registerId(roomIds,room.id,roomContext,conferenceReport,'DUPLICATE_ROOM_ID','يوجد room.id مكرر داخل المؤتمر.');
              }

              var guests = asArray(room.guests);
              var children = asArray(room.children);
              var roomLocation = houseIndex+'/'+floorIndex+'/'+roomIndex;
              var beds = Math.max(0,parseInt(room.beds,10)||0);
              var extraBeds = Math.max(0,parseInt(room.extraBeds,10)||0);
              var rawAutoExtraBeds = room.autoExtraBeds;
              var autoExtraBeds = parseInt(rawAutoExtraBeds,10);

              if(rawAutoExtraBeds!==undefined&&rawAutoExtraBeds!==null&&rawAutoExtraBeds!==''&&
                (isNaN(autoExtraBeds)||autoExtraBeds<0||autoExtraBeds>extraBeds)){
                addIssue(conferenceReport,'warnings','INCONSISTENT_AUTO_EXTRA_BEDS','قيمة autoExtraBeds غير متسقة مع extraBeds.',roomContext,{
                  autoExtraBeds: rawAutoExtraBeds,
                  extraBeds: room.extraBeds
                });
              }
              if(guests.length>beds+extraBeds){
                addIssue(conferenceReport,'errors','ROOM_CAPACITY_EXCEEDED','عدد النزلاء يتجاوز سعة الغرفة.',roomContext,{
                  guests: guests.length,
                  beds: beds,
                  extraBeds: extraBeds,
                  capacity: beds+extraBeds
                });
              }

              guests.forEach(function(guest,guestIndex){
                guest = guest&&typeof guest==='object'?guest:{};
                conferenceReport.stats.guests++;
                var guestContext = {
                  conferenceId: conferenceId,
                  houseId: houseContext.houseId,
                  floorId: floorContext.floorId,
                  roomId: roomContext.roomId,
                  entityId: hasId(guest.id)?guest.id:null,
                  personId: hasId(guest.personId)?guest.personId:null
                };
                if(!hasId(guest.id)){
                  addIssue(conferenceReport,'errors','MISSING_GUEST_ID','يوجد نزيل بدون guest.id.',guestContext,{
                    guestIndex: guestIndex,
                    name: guest.name||''
                  });
                }else{
                  registerId(guestIds,guest.id,guestContext,conferenceReport,'DUPLICATE_GUEST_ID','يوجد guest.id مكرر داخل المؤتمر.');
                }
                if(!hasId(guest.personId)){
                  addIssue(conferenceReport,'errors','GUEST_WITHOUT_PERSON_ID','يوجد نزيل بدون personId.',guestContext,{
                    guestIndex: guestIndex,
                    name: guest.name||''
                  });
                }else{
                  var guestPersonKey = String(guest.personId);
                  if(!personIds[guestPersonKey]){
                    addIssue(conferenceReport,'errors','GUEST_PERSON_NOT_FOUND','يشير النزيل إلى personId غير موجود في peopleDb.',guestContext,{
                      guestIndex: guestIndex
                    });
                  }
                  if(guestAssignments[guestPersonKey]&&guestAssignments[guestPersonKey].location!==roomLocation){
                    addIssue(conferenceReport,'errors','PERSON_ASSIGNED_TO_MULTIPLE_ROOMS','الشخص نفسه مسكن في أكثر من غرفة.',guestContext,{
                      firstRoomId: guestAssignments[guestPersonKey].roomId,
                      duplicateRoomId: roomContext.roomId,
                      firstLocation: guestAssignments[guestPersonKey].location,
                      duplicateLocation: roomLocation
                    });
                  }else if(!guestAssignments[guestPersonKey]){
                    guestAssignments[guestPersonKey] = {
                      roomId: roomContext.roomId,
                      location: roomLocation
                    };
                  }
                }
              });

              children.forEach(function(child,childIndex){
                child = child&&typeof child==='object'?child:{};
                conferenceReport.stats.children++;
                var childContext = {
                  conferenceId: conferenceId,
                  houseId: houseContext.houseId,
                  floorId: floorContext.floorId,
                  roomId: roomContext.roomId,
                  entityId: hasId(child.id)?child.id:null,
                  personId: hasId(child.personId)?child.personId:null
                };
                if(!hasId(child.id)){
                  addIssue(conferenceReport,'errors','MISSING_CHILD_ID','يوجد طفل بدون child.id.',childContext,{
                    childIndex: childIndex,
                    name: child.name||''
                  });
                }else{
                  registerId(childIds,child.id,childContext,conferenceReport,'DUPLICATE_CHILD_ID','يوجد child.id مكرر داخل المؤتمر.');
                }
                if(!hasId(child.personId)){
                  addIssue(conferenceReport,'errors','CHILD_WITHOUT_PERSON_ID','يوجد طفل بدون personId.',childContext,{
                    childIndex: childIndex,
                    name: child.name||''
                  });
                }else if(!personIds[String(child.personId)]){
                  addIssue(conferenceReport,'errors','CHILD_PERSON_NOT_FOUND','يشير الطفل إلى personId غير موجود في peopleDb.',childContext,{
                    childIndex: childIndex
                  });
                }
                if(!hasId(child.guardianPersonId)){
                  addIssue(conferenceReport,'errors','MISSING_GUARDIAN_PERSON_ID','يوجد طفل بدون guardianPersonId.',childContext,{
                    childIndex: childIndex,
                    guardian: child.guardian||''
                  });
                  if(hasId(child.guardian)){
                    addIssue(conferenceReport,'warnings','TEXT_ONLY_GUARDIAN_REFERENCE','يعتمد ارتباط الطفل بولي الأمر على الاسم النصي فقط.',childContext,{
                      childIndex: childIndex,
                      guardian: child.guardian
                    });
                  }
                }else if(!personIds[String(child.guardianPersonId)]){
                  addIssue(conferenceReport,'errors','GUARDIAN_PERSON_NOT_FOUND','يشير الطفل إلى guardianPersonId غير موجود في peopleDb.',childContext,{
                    childIndex: childIndex,
                    guardianPersonId: child.guardianPersonId
                  });
                }
              });
            });
          });
        });

        Object.keys(conferenceReport.stats).forEach(function(key){
          report.stats[key] += conferenceReport.stats[key];
        });
        report.conferences.push(conferenceReport);
      });
    }

    report.conferences.forEach(function(conferenceReport){
      report.summary.errors += conferenceReport.errors.length;
      report.summary.warnings += conferenceReport.warnings.length;
    });
    report.summary.errors += report.errors.length;
    report.summary.warnings += report.warnings.length;
    report.valid = report.summary.errors===0;
    return report;
  }

  global.MigrationAudit = Object.freeze({
    auditAppData: auditAppData
  });
})(window);
