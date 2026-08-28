'use strict';

const assert=require('assert');
const RecoveryPreviewService=require('../js/recovery/recovery-preview-service.js');

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function makeRev9(){
  return {
    id:'conf-a',
    status:'active',
    houses:[{
      id:'h1',
      floors:[{id:'f1',rooms:[
        {id:'r1',guests:[{id:'p1'}],children:[]},
        {id:'r2',guests:[{id:'p2'}],children:[{id:'p3'}]}
      ]}]
    }],
    accommodationDisplayedRoomIds:['r1','r2'],
    peopleDb:{version:'1.0.0',people:[]},
    transports:[],
    activityLog:[{id:'a9'}],
    restaurant:{meals:{breakfast:{price:10}}},
    accounts:[{id:'acc1',name:'main'}],
    financialV3:{summary:{total:100}}
  };
}

function makeRev4Healthy(){
  return {
    id:'conf-a',
    status:'active',
    houses:[{
      id:'h1',
      floors:[{id:'f1',rooms:[
        {id:'r1',guests:[{id:'p1'}],children:[]},
        {id:'r2',guests:[{id:'p2'}],children:[{id:'p3'}]}
      ]}]
    }],
    accommodationDisplayedRoomIds:['r1'],
    peopleDb:{version:'1.0.0',people:[
      {id:'p1',fullName:'P1'},
      {id:'p2',fullName:'P2'},
      {id:'p3',fullName:'P3'},
      {id:'p4',fullName:'P4'}
    ]},
    transports:[{
      id:'t1',
      seats:[
        {seat:1,personId:'p1',name:'P1'},
        {seat:2,personId:'',name:''}
      ]
    }],
    activityLog:[{id:'a1'},{id:'a2'}],
    restaurant:{meals:{breakfast:{price:10}}},
    accounts:[{id:'acc1',name:'main'}],
    financialV3:{summary:{total:100}}
  };
}

function normalizeNoDrop(snapshot){
  const next=clone(snapshot);
  next.peopleDb=next.peopleDb||{version:'1.0.0',people:[]};
  next.peopleDb.people=Array.isArray(next.peopleDb.people)
    ?next.peopleDb.people:[];
  next.transports=Array.isArray(next.transports)?next.transports:[];
  return next;
}

(function run(){
  const rev9=makeRev9();
  const rev4=makeRev4Healthy();
  let queueCalls=0;
  let rpcCalls=0;
  let publicationCalls=0;
  const hooks={
    queue(){queueCalls++;},
    rpc(){rpcCalls++;},
    publication(){publicationCalls++;}
  };
  void hooks;

  const built=RecoveryPreviewService.buildRecoveryCandidate({
    currentSnapshot:rev9,
    healthySnapshot:rev4,
    currentConferenceHash:'same-hash',
    healthyConferenceHash:'same-hash',
    normalizeFn:normalizeNoDrop
  });

  assert.strictEqual(built.ok,true);
  assert.strictEqual(built.status,'candidate_ready');
  assert.strictEqual(
    built.data.candidate.peopleDb.people.length,
    4,
    'rev9 missing people should be recovered from healthy snapshot'
  );
  assert.strictEqual(
    built.data.candidate.transports.length,
    1,
    'rev9 missing transports should be recovered from healthy snapshot'
  );

  // houses/rooms in rev9 must not be replaced while recovering people/transports
  assert.deepStrictEqual(
    built.data.candidate.houses,
    rev9.houses,
    'houses/rooms from current rev9 must remain unchanged'
  );

  assert.strictEqual(built.data.validation.unresolvedRoomRefs,0);
  assert.strictEqual(built.data.validation.unresolvedTransportRefs,0);
  assert.strictEqual(queueCalls,0,'preview must not call queue');
  assert.strictEqual(rpcCalls,0,'preview must not call rpc');
  assert.strictEqual(publicationCalls,0,'preview must not call publication');

  const badHealthy=makeRev4Healthy();
  badHealthy.peopleDb.people=[
    {id:'p2',fullName:'P2'}
  ];
  badHealthy.transports=[{id:'t1',seats:[{seat:1,personId:'missing',name:'Missing'}]}];
  const blocked=RecoveryPreviewService.buildRecoveryCandidate({
    currentSnapshot:rev9,
    healthySnapshot:badHealthy,
    currentConferenceHash:'same-hash',
    healthyConferenceHash:'same-hash',
    normalizeFn:normalizeNoDrop
  });
  assert.strictEqual(blocked.ok,false);
  assert.strictEqual(blocked.status,'candidate_invalid');
  assert.ok(
    blocked.data.validation.errors.indexOf('UNRESOLVED_ROOM_PERSON_REFERENCES')>=0||
    blocked.data.validation.errors.indexOf('UNRESOLVED_TRANSPORT_PERSON_REFERENCES')>=0
  );

  const crossBlocked=RecoveryPreviewService.buildRecoveryCandidate({
    currentSnapshot:rev9,
    healthySnapshot:rev4,
    currentConferenceHash:'hash-a',
    healthyConferenceHash:'hash-b',
    normalizeFn:normalizeNoDrop
  });
  assert.strictEqual(crossBlocked.ok,false);
  assert.strictEqual(crossBlocked.status,'cross_conference_not_allowed');

  const previewApply=RecoveryPreviewService.applyCandidatePreview(rev9,built.data.candidate);
  assert.strictEqual(previewApply.ok,true);
  assert.strictEqual(previewApply.status,'preview_applied');
  const rolled=RecoveryPreviewService.rollbackPreview(previewApply.data);
  assert.strictEqual(rolled.ok,true);
  assert.deepStrictEqual(rolled.data,rev9,'rollback should restore previous snapshot exactly');

  const backupPlan=RecoveryPreviewService.prepareBackupPlan({
    currentState:{currentConferenceId:'conf-a',snapshot:rev9},
    revision9Snapshot:rev9,
    candidateSnapshot:built.data.candidate
  });
  assert.strictEqual(Array.isArray(backupPlan.backups),true);
  assert.strictEqual(backupPlan.backups.length,3);
  assert.ok(String(backupPlan.marker||'').indexOf('recovery-preview-')===0);

  console.log('recovery candidate preview tests: passed');
})();
