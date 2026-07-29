'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var source=fs.readFileSync(
  path.join(root,'js/sync/conflict-resolution.js'),
  'utf8'
);
var ids={
  conflict:'11111111-1111-4111-8111-111111111111',
  conference:'22222222-2222-4222-8222-222222222222',
  source:'33333333-3333-4333-8333-333333333333',
  resolution:'44444444-4444-4444-8444-444444444444'
};
var sandbox={
  window:null,
  Promise:Promise,
  Date:Date,
  JSON:JSON,
  Object:Object,
  Array:Array,
  String:String,
  Number:Number,
  RegExp:RegExp,
  Uint8Array:Uint8Array,
  structuredClone:global.structuredClone
};
sandbox.window=sandbox;
vm.runInNewContext(source,sandbox,{filename:'conflict-resolution.js'});
var api=sandbox.ConflictResolution;

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function planInput(overrides){
  return Object.assign({
    conflictId:ids.conflict,
    conferenceId:ids.conference,
    operationId:ids.source,
    resolutionOperationId:ids.resolution,
    strategy:'keep_local',
    baseRevision:1,
    actualRevision:2,
    localSnapshot:{
      id:'local-1',
      name:'Local',
      people:[{id:'p1',name:'A'},{id:'p2',name:'B'}]
    },
    serverSnapshot:{
      id:'local-1',
      name:'Server',
      people:[{id:'p1',name:'Remote A'},{id:'p3',name:'C'}]
    },
    schemaVersion:'1',
    appVersion:'4.0.0'
  },overrides||{});
}

function testComparisonEngine(){
  var equal=api.compareSnapshots(
    {id:'c1',items:[{id:'a',value:1}]},
    {id:'c1',items:[{id:'a',value:1}]}
  );
  assert.strictEqual(equal.ok,true);
  assert.strictEqual(equal.data.equal,true);
  assert.deepStrictEqual(plain(equal.data.summary),{
    added:0,removed:0,changed:0,unchanged:3
  });

  var compared=api.compareSnapshots(
    {
      id:'c1',
      title:'Local',
      people:[{id:'a',name:'Local A'},{id:'b',name:'B'}]
    },
    {
      id:'c1',
      title:'Remote',
      people:[{id:'a',name:'Remote A'},{id:'c',name:'C'}]
    }
  );
  assert.strictEqual(compared.ok,true);
  assert.strictEqual(compared.data.equal,false);
  assert.deepStrictEqual(
    plain(compared.data.changes.map(function(change){
      return [change.path,change.type];
    })),
    [
      ['/people/@id=a/name','changed'],
      ['/people/@id=b','removed'],
      ['/people/@id=c','added'],
      ['/title','changed']
    ]
  );

  var indexed=api.compareSnapshots(
    {values:['a','b']},
    {values:['a','c','d']}
  );
  assert.deepStrictEqual(
    plain(indexed.data.changes.map(function(change){
      return [change.path,change.type];
    })),
    [['/values/1','changed'],['/values/2','added']]
  );

  var cyclic={id:'c1'};
  cyclic.self=cyclic;
  assert.strictEqual(
    api.compareSnapshots(cyclic,{id:'c1'}).error.code,
    'CYCLIC_REFERENCE'
  );
  assert.strictEqual(
    api.compareSnapshots({a:1},{a:2},{maxChanges:1}).ok,
    true
  );
  assert.strictEqual(
    api.compareSnapshots({a:1,b:1},{a:2,b:2},{maxChanges:1})
      .error.code,
    'MAX_CHANGES_EXCEEDED'
  );

  var classified=api.classifyConflict(compared.data);
  assert.strictEqual(classified.ok,true);
  assert.strictEqual(classified.data.level,'high');
  assert.strictEqual(classified.data.hasRemoval,true);
  assert.strictEqual(classified.data.hasSensitiveChange,true);
}

function testResolutionPlanBuilder(){
  var local=api.buildResolutionPlan(planInput(),{
    now:'2026-07-29T10:00:00.000Z'
  });
  assert.strictEqual(local.ok,true);
  assert.strictEqual(local.data.baseRevision,2);
  assert.strictEqual(local.data.sourceRevision,1);
  assert.deepStrictEqual(
    plain(local.data.resolvedSnapshot),
    plain(planInput().localSnapshot)
  );

  var server=api.buildResolutionPlan(planInput({
    strategy:'keep_server'
  }),{now:'2026-07-29T10:00:00.000Z'});
  assert.strictEqual(server.ok,true);
  assert.strictEqual(server.data.baseRevision,2);
  assert.strictEqual(server.data.sourceRevision,2);
  assert.deepStrictEqual(
    plain(server.data.resolvedSnapshot),
    plain(planInput().serverSnapshot)
  );

  var comparison=api.compareSnapshots(
    planInput().localSnapshot,
    planInput().serverSnapshot
  );
  var decisions={};
  comparison.data.changes.forEach(function(change){
    decisions[change.path]=change.path==='/name'?'local':'server';
  });
  var manual=api.buildResolutionPlan(planInput({
    strategy:'manual',
    resolutionMap:decisions
  }),{now:'2026-07-29T10:00:00.000Z'});
  assert.strictEqual(manual.ok,true);
  assert.strictEqual(manual.data.resolvedSnapshot.name,'Local');
  assert.strictEqual(manual.data.resolvedSnapshot.people[0].name,'Remote A');
  assert.strictEqual(manual.data.resolvedSnapshot.people.length,2);
  assert.strictEqual(
    manual.data.selectedPaths.length,
    comparison.data.changes.length
  );

  assert.strictEqual(
    api.buildResolutionPlan(planInput({
      strategy:'manual',
      resolutionMap:{'/name':'local'}
    })).error.code,
    'INCOMPLETE_MANUAL_RESOLUTION'
  );
  assert.strictEqual(
    api.buildResolutionPlan(planInput({
      resolutionOperationId:ids.source
    })).error.code,
    'SOURCE_OPERATION_ID_REUSED'
  );
}

function testValidation(){
  var built=api.buildResolutionPlan(planInput(),{
    now:'2026-07-29T10:00:00.000Z'
  });
  assert.strictEqual(api.validateResolutionPlan(built.data).ok,true);

  var missingConference=plain(built.data);
  missingConference.conferenceId=null;
  assert.strictEqual(
    api.validateResolutionPlan(missingConference).error.code,
    'INVALID_RESOLUTION_PLAN'
  );

  var missingActual=plain(built.data);
  delete missingActual.actualRevision;
  assert.strictEqual(
    api.validateResolutionPlan(missingActual).error.code,
    'INVALID_RESOLUTION_PLAN'
  );

  var mismatchedRevision=plain(built.data);
  mismatchedRevision.actualRevision=3;
  assert.strictEqual(
    api.validateResolutionPlan(mismatchedRevision).error.code,
    'INVALID_RESOLUTION_PLAN'
  );

  var unsafe=plain(built.data);
  unsafe.resolvedSnapshot.session={access_token:'secret'};
  assert.strictEqual(
    api.validateResolutionPlan(unsafe).error.code,
    'UNSAFE_RESOLUTION_PLAN'
  );
}

function testIdempotentPlanIdentity(){
  var input=planInput();
  var options={now:'2026-07-29T10:00:00.000Z'};
  var first=api.buildResolutionPlan(input,options);
  var second=api.buildResolutionPlan(input,options);
  assert.strictEqual(first.ok,true);
  assert.strictEqual(second.ok,true);
  assert.deepStrictEqual(plain(first.data),plain(second.data));
  assert.strictEqual(first.data.resolutionOperationId,ids.resolution);

  var generated=api.buildResolutionPlan(
    planInput({resolutionOperationId:null}),
    {
      now:'2026-07-29T10:00:00.000Z',
      uuidFactory:function(){return ids.resolution;}
    }
  );
  assert.strictEqual(generated.ok,true);
  assert.strictEqual(generated.data.resolutionOperationId,ids.resolution);
}

testComparisonEngine();
testResolutionPlanBuilder();
testValidation();
testIdempotentPlanIdentity();

console.log('conflict resolution phase 1 tests: passed');
