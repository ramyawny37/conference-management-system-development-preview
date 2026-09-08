'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const executor=require('../tools/production-release/controlled-production-executor.cjs');
const manifest=require('../tools/production-release/controlled-production-manifest.json');
const fs=require('node:fs');
const baseline=()=>[{version:manifest.baseline.version,name:manifest.baseline.name,statements:['existing'],created_by:null,idempotency_key:null,rollback:null}];
const prefix=count=>baseline().concat(manifest.entries.slice(0,count).map(executor.expectedHistory));
const artifact=()=>structuredClone(executor.acceptedMcpStep29Artifact().row);
function adapter(rows,{pre,post}){const calls={record:0,atomic:0,exact:0};let applied=false,checks=0;return {calls,history:()=>rows,check:()=>{checks++;return applied?true:(checks===1?pre:post);},record:entry=>{calls.record++;rows.push(executor.expectedHistory(entry));},executeAtomic:entry=>{calls.atomic++;applied=true;rows.push(executor.expectedHistory(entry));},executeExact:()=>{calls.exact++;applied=true;}};}

test('exact MCP Step 29 artifact permits history-only recovery without body replay',()=>{
  const rows=prefix(28).concat(artifact()),target=manifest.entries[28],db=adapter(rows,{pre:false,post:true});
  assert.equal(target.version,'20260902122033');
  assert.equal(executor.assertHistoryTail(rows).length,28);
  const result=executor.executeOne({projectRef:manifest.productionProjectRef,authorization:target.version,adapter:db});
  assert.equal(result.interruptedState,'EFFECTIVELY_APPLIED_HISTORY_MISSING');
  assert.equal(db.calls.record,1);
  assert.equal(db.calls.atomic+db.calls.exact,0);
  assert.equal(executor.assertHistoryTail(rows).length,29);
  assert.deepEqual(rows.find(row=>row.version===target.version),executor.expectedHistory(target));
});

test('Step 30 becomes the exact next NOT_APPLIED entry after recovery',()=>{
  const rows=prefix(29).concat(artifact()),target=manifest.entries[29],db=adapter(rows,{pre:true,post:false});
  assert.equal(target.version,'20260902130805');
  const result=executor.executeOne({projectRef:manifest.productionProjectRef,authorization:target.version,adapter:db});
  assert.equal(result.interruptedState,'NOT_APPLIED');
  assert.equal(db.calls.atomic+db.calls.exact,1);
  assert.equal(executor.assertHistoryTail(rows).length,30);
});

test('artifact is exact, one-time, sequence-bound, and cannot hide other drift',()=>{
  const expected=artifact();
  assert.equal(expected.statement_length,17399);
  assert.equal(expected.statement_sha256,'2dd7b67dbe6b48c0a60adeea0d96fae493cfb031e545d255c70708d940ab6b00');
  assert.notEqual(expected.statement_sha256,manifest.entries[28].sha256);
  for(const [key,value] of [['name','wrong'],['created_by','wrong'],['idempotency_key','wrong'],['rollback','wrong'],['statement_count',2],['statement_length',17400],['statement_sha256','3dd7b67dbe6b48c0a60adeea0d96fae493cfb031e545d255c70708d940ab6b00']]){const row=artifact();row[key]=value;assert.throws(()=>executor.assertHistoryTail(prefix(28).concat(row)),/UNEXPECTED_PRODUCTION_HISTORY_DRIFT/);}
  const canonical=fs.readFileSync(manifest.entries[28].filename,'utf8');
  assert.throws(()=>executor.assertHistoryTail(prefix(28).concat({...artifact(),statements:[canonical]})),/UNEXPECTED_PRODUCTION_HISTORY_DRIFT/);
  const sameLength='x'.repeat(17399);
  assert.throws(()=>executor.assertHistoryTail(prefix(28).concat({...artifact(),statements:[sameLength]})),/UNEXPECTED_PRODUCTION_HISTORY_DRIFT/);
  assert.throws(()=>executor.assertHistoryTail(prefix(28).concat({...artifact(),statements:[`${sameLength.slice(0,-1)}y`]})),/UNEXPECTED_PRODUCTION_HISTORY_DRIFT/);
  assert.throws(()=>executor.assertHistoryTail(prefix(27).concat(artifact())),/MCP_STEP29_ARTIFACT_SEQUENCE_MISMATCH/);
  assert.throws(()=>executor.assertHistoryTail(prefix(28).concat(artifact(),artifact())),/DUPLICATE_ACCEPTED_HISTORY_ARTIFACT/);
  assert.throws(()=>executor.assertHistoryTail(prefix(28).concat({...artifact(),version:'20260908104229'})),/UNEXPECTED_PRODUCTION_HISTORY_DRIFT/);
  assert.throws(()=>executor.assertHistoryTail(prefix(28).concat({...artifact(),version:'20260908104229',name:'unrelated'})),/UNEXPECTED_PRODUCTION_HISTORY_DRIFT/);
});

test('strict final history accepts all controlled rows plus the preserved exact artifact',()=>{
  assert.equal(executor.assertHistoryTail(prefix(57).concat(artifact())).length,57);
});

test('recovered history continues deterministically through Steps 30 to 57',()=>{
  const rows=prefix(29).concat(artifact());
  for(let index=29;index<manifest.entries.length;index++){
    const entry=manifest.entries[index],applied=entry.action==='APPLY',db=adapter(rows,{pre:true,post:applied?false:true});
    const result=executor.executeOne({projectRef:manifest.productionProjectRef,authorization:entry.version,adapter:db});
    assert.equal(result.version,entry.version);
    assert.equal(applied?db.calls.atomic+db.calls.exact+db.calls.record>0:db.calls.record===1,true);
  }
  assert.equal(executor.assertHistoryTail(rows).length,57);
});
