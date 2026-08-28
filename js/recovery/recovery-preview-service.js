(function(global){
  'use strict';

  function clone(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function toArray(value){
    return Array.isArray(value)?value:[];
  }

  function snapshotHash(value){
    var text=JSON.stringify(value||{});
    var hash=0;
    for(var i=0;i<text.length;i++)hash=((hash<<5)-hash)+text.charCodeAt(i)|0;
    return String(hash>>>0);
  }

  function countFloors(snapshot){
    return toArray(snapshot&&snapshot.houses).reduce(function(total,house){
      return total+toArray(house&&house.floors).length;
    },0);
  }

  function countRooms(snapshot){
    return toArray(snapshot&&snapshot.houses).reduce(function(total,house){
      return total+toArray(house&&house.floors).reduce(function(inner,floor){
        return inner+toArray(floor&&floor.rooms).length;
      },0);
    },0);
  }

  function countRoomGuests(snapshot){
    return toArray(snapshot&&snapshot.houses).reduce(function(total,house){
      return total+toArray(house&&house.floors).reduce(function(inner,floor){
        return inner+toArray(floor&&floor.rooms).reduce(function(sum,room){
          return sum+toArray(room&&room.guests).length;
        },0);
      },0);
    },0);
  }

  function countRoomChildren(snapshot){
    return toArray(snapshot&&snapshot.houses).reduce(function(total,house){
      return total+toArray(house&&house.floors).reduce(function(inner,floor){
        return inner+toArray(floor&&floor.rooms).reduce(function(sum,room){
          return sum+toArray(room&&room.children).length;
        },0);
      },0);
    },0);
  }

  function countAssignedSeats(snapshot){
    return toArray(snapshot&&snapshot.transports).reduce(function(total,transport){
      return total+toArray(transport&&transport.seats).reduce(function(sum,seat){
        return sum+(String(seat&&seat.name||'').trim()?1:0);
      },0);
    },0);
  }

  function summarizeSnapshot(snapshot){
    return {
      people:toArray(snapshot&&snapshot.peopleDb&&snapshot.peopleDb.people).length,
      transports:toArray(snapshot&&snapshot.transports).length,
      houses:toArray(snapshot&&snapshot.houses).length,
      floors:countFloors(snapshot),
      rooms:countRooms(snapshot),
      roomGuests:countRoomGuests(snapshot),
      roomChildren:countRoomChildren(snapshot),
      displayedRoomIds:toArray(snapshot&&snapshot.accommodationDisplayedRoomIds).length,
      activityLog:toArray(snapshot&&snapshot.activityLog).length,
      transportAssignedSeats:countAssignedSeats(snapshot)
    };
  }

  function personKeys(snapshot){
    var keys=Object.create(null);
    toArray(snapshot&&snapshot.peopleDb&&snapshot.peopleDb.people).forEach(function(person){
      if(!person||typeof person!=='object')return;
      var id=String(person.id||'').trim();
      if(id)keys['id:'+id.toLowerCase()]=true;
      var fullName=String(person.fullName||person.name||'').trim();
      if(fullName)keys['name:'+fullName.toLowerCase()]=true;
    });
    return keys;
  }

  function personToken(entry){
    if(entry&&typeof entry==='object'){
      var id=String(entry.id||entry.personId||'').trim();
      if(id)return 'id:'+id.toLowerCase();
      var label=String(entry.fullName||entry.name||'').trim();
      if(label)return 'name:'+label.toLowerCase();
      return '';
    }
    var text=String(entry||'').trim();
    return text?'name:'+text.toLowerCase():'';
  }

  function unresolvedRoomReferences(snapshot){
    var keys=personKeys(snapshot);
    var unresolved=0;
    toArray(snapshot&&snapshot.houses).forEach(function(house){
      toArray(house&&house.floors).forEach(function(floor){
        toArray(floor&&floor.rooms).forEach(function(room){
          toArray(room&&room.guests).concat(toArray(room&&room.children)).forEach(function(ref){
            var token=personToken(ref);
            if(token&&!keys[token])unresolved++;
          });
        });
      });
    });
    return unresolved;
  }

  function unresolvedTransportReferences(snapshot){
    var keys=personKeys(snapshot);
    var unresolved=0;
    toArray(snapshot&&snapshot.transports).forEach(function(transport){
      toArray(transport&&transport.seats).forEach(function(seat){
        var token=personToken({id:seat&&seat.personId,name:seat&&seat.name});
        if(token&&!keys[token])unresolved++;
      });
    });
    return unresolved;
  }

  function duplicatePersonIds(snapshot){
    var seen=Object.create(null);
    var duplicates=[];
    toArray(snapshot&&snapshot.peopleDb&&snapshot.peopleDb.people).forEach(function(person){
      var id=String(person&&person.id||'').trim();
      if(!id)return;
      if(seen[id])duplicates.push(id);
      seen[id]=true;
    });
    return duplicates;
  }

  function compareSnapshots(left,right){
    var leftSummary=summarizeSnapshot(left);
    var rightSummary=summarizeSnapshot(right);
    return {
      left:leftSummary,
      right:rightSummary,
      equality:{
        housesExact:JSON.stringify(toArray(left&&left.houses))===JSON.stringify(toArray(right&&right.houses)),
        displayedRoomIds:JSON.stringify(toArray(left&&left.accommodationDisplayedRoomIds))===JSON.stringify(toArray(right&&right.accommodationDisplayedRoomIds)),
        activityLog:JSON.stringify(toArray(left&&left.activityLog))===JSON.stringify(toArray(right&&right.activityLog)),
        restaurant:JSON.stringify(left&&left.restaurant||{})===JSON.stringify(right&&right.restaurant||{}),
        accounts:JSON.stringify(left&&left.accounts||[])===JSON.stringify(right&&right.accounts||[]),
        financial:JSON.stringify(left&&left.financialV3||left&&left.financial||{})===JSON.stringify(right&&right.financialV3||right&&right.financial||{})
      },
      hashes:{
        leftHash:snapshotHash(left),
        rightHash:snapshotHash(right),
        leftHousesHash:snapshotHash(toArray(left&&left.houses)),
        rightHousesHash:snapshotHash(toArray(right&&right.houses)),
        leftPeopleHash:snapshotHash(toArray(left&&left.peopleDb&&left.peopleDb.people)),
        rightPeopleHash:snapshotHash(toArray(right&&right.peopleDb&&right.peopleDb.people)),
        leftTransportsHash:snapshotHash(toArray(left&&left.transports)),
        rightTransportsHash:snapshotHash(toArray(right&&right.transports))
      },
      referenceIntegrity:{
        leftUnresolvedRoomRefs:unresolvedRoomReferences(left),
        rightUnresolvedRoomRefs:unresolvedRoomReferences(right),
        leftUnresolvedTransportRefs:unresolvedTransportReferences(left),
        rightUnresolvedTransportRefs:unresolvedTransportReferences(right)
      }
    };
  }

  function validateCandidate(snapshot,currentSnapshot,normalizeFn){
    var errors=[];
    var duplicates=duplicatePersonIds(snapshot);
    if(duplicates.length){
      errors.push('DUPLICATE_PERSON_IDS');
    }
    var unresolvedRooms=unresolvedRoomReferences(snapshot);
    var unresolvedTransports=unresolvedTransportReferences(snapshot);
    if(unresolvedRooms>0)errors.push('UNRESOLVED_ROOM_PERSON_REFERENCES');
    if(unresolvedTransports>0)errors.push('UNRESOLVED_TRANSPORT_PERSON_REFERENCES');
    if(JSON.stringify(toArray(currentSnapshot&&currentSnapshot.houses))!==
      JSON.stringify(toArray(snapshot&&snapshot.houses))){
      errors.push('HOUSES_CHANGED');
    }
    var normalized=snapshot;
    if(typeof normalizeFn==='function'){
      normalized=normalizeFn(clone(snapshot));
    }
    var before=summarizeSnapshot(snapshot);
    var afterNormalize=summarizeSnapshot(normalized);
    if(afterNormalize.people<before.people||afterNormalize.transports<before.transports){
      errors.push('NORMALIZATION_DROPPED_DATA');
    }
    var roundTrip=JSON.parse(JSON.stringify(snapshot));
    var afterRoundTrip=summarizeSnapshot(roundTrip);
    if(afterRoundTrip.people!==before.people||afterRoundTrip.transports!==before.transports){
      errors.push('ROUNDTRIP_COUNT_MISMATCH');
    }
    return {
      valid:errors.length===0,
      errors:errors,
      unresolvedRoomRefs:unresolvedRooms,
      unresolvedTransportRefs:unresolvedTransports,
      duplicatePersonIds:duplicates.length,
      countsBefore:before,
      countsAfterNormalize:afterNormalize,
      countsAfterRoundTrip:afterRoundTrip
    };
  }

  function buildRecoveryCandidate(input){
    input=input&&typeof input==='object'?input:{};
    var current=clone(input.currentSnapshot||{});
    var healthy=clone(input.healthySnapshot||{});
    var crossConference=input.currentConferenceHash&&input.healthyConferenceHash&&
      String(input.currentConferenceHash)!==String(input.healthyConferenceHash);
    if(crossConference&&input.allowCrossConference!==true){
      return {
        ok:false,
        status:'cross_conference_not_allowed',
        data:{crossConference:true}
      };
    }
    var candidate=clone(current);
    candidate.peopleDb=clone(healthy.peopleDb||{version:'1.0.0',people:[]});
    candidate.peopleDb.version=String(candidate.peopleDb.version||'1.0.0');
    candidate.peopleDb.people=toArray(candidate.peopleDb.people);
    candidate.transports=clone(toArray(healthy.transports));
    var comparison=compareSnapshots(current,candidate);
    var validation=validateCandidate(candidate,current,input.normalizeFn);
    if(!validation.valid){
      return {
        ok:false,
        status:'candidate_invalid',
        data:{candidate:candidate,comparison:comparison,validation:validation}
      };
    }
    return {
      ok:true,
      status:'candidate_ready',
      data:{
        candidate:candidate,
        comparison:comparison,
        validation:validation,
        recovered:{
          people:validation.countsBefore.people,
          transports:validation.countsBefore.transports
        },
        preservedFromCurrent:{
          houses:validation.countsBefore.houses,
          floors:validation.countsBefore.floors,
          rooms:validation.countsBefore.rooms
        }
      }
    };
  }

  function prepareBackupPlan(input){
    input=input&&typeof input==='object'?input:{};
    var marker='recovery-preview-'+new Date().toISOString();
    return {
      marker:marker,
      backups:[
        {name:'full-local-current',hash:snapshotHash(input.currentState||{})},
        {name:'revision-9-snapshot',hash:snapshotHash(input.revision9Snapshot||{})},
        {name:'recovery-candidate',hash:snapshotHash(input.candidateSnapshot||{})}
      ],
      rollback:{
        marker:marker,
        previousHash:snapshotHash(input.currentState||{}),
        candidateHash:snapshotHash(input.candidateSnapshot||{})
      }
    };
  }

  function applyCandidatePreview(state,candidate){
    return {
      ok:true,
      status:'preview_applied',
      data:{
        before:clone(state),
        after:clone(candidate)
      }
    };
  }

  function rollbackPreview(rollbackData){
    rollbackData=rollbackData&&typeof rollbackData==='object'?rollbackData:{};
    return {
      ok:true,
      status:'rolled_back',
      data:clone(rollbackData.before||{})
    };
  }

  var api={
    summarizeSnapshot:summarizeSnapshot,
    compareSnapshots:compareSnapshots,
    validateCandidate:validateCandidate,
    buildRecoveryCandidate:buildRecoveryCandidate,
    prepareBackupPlan:prepareBackupPlan,
    applyCandidatePreview:applyCandidatePreview,
    rollbackPreview:rollbackPreview
  };

  global.RecoveryPreviewService=api;
  if(typeof module!=='undefined'&&module.exports){
    module.exports=api;
  }
})(typeof window!=='undefined'?window:globalThis);
