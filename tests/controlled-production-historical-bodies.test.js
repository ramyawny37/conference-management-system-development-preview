'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const executor=require('../tools/production-release/controlled-production-executor.cjs');
const manifest=require('../tools/production-release/controlled-production-manifest.json');
const comments={
  '20260907155000':["-- Signature-only, fail-closed shims satisfy the reviewed Conference migration's grant statements.\n",'-- They deliberately implement none of the excluded Development ownership-handoff flow.\n'],
  '20260907160000':['-- Establish identity-only rows only after the contradiction guard has\n','-- inspected the Platform profiles that pre-dated this reconciliation. The\n','-- default remains pending and this grants no authority. Actor identities are\n','-- therefore available before legacy approved_by/blocked_by foreign keys are\n','-- projected without being mistaken for pre-existing Platform state.\n'],
  '20260907161000':['-- This checks actor identity, approved account state, and Platform authority only.\n','-- Device possession is deliberately not reimplemented here: the only caller is the\n','-- service-role-only dispatcher, which validates the cryptographic session first.\n','-- 03090000 revokes these superseded signatures by exact regprocedure. They are\n','-- fail-closed placeholders only and cannot restore the old header-based API.\n']
};
const entry=version=>manifest.entries.find(item=>item.version===version);
function historicalBody(version){let body=fs.readFileSync(entry(version).filename,'utf8');for(const comment of comments[version]){assert.ok(body.includes(comment));body=body.replace(comment,'');}return body;}
function historicalRow(version){const row=executor.expectedHistory(entry(version));row.statements=[historicalBody(version),row.statements[1]];return row;}
const baseline=()=>({version:manifest.baseline.version,name:manifest.baseline.name,statements:['existing'],created_by:null,idempotency_key:null,rollback:null});
const artifact=()=>({...executor.acceptedMcpStep29Artifact().row});
for(const [ordinal,version] of [[21,'20260907155000'],[22,'20260907160000'],[25,'20260907161000']]){
  test(`exact canonical Step ${ordinal} is accepted`,()=>assert.equal(executor.assertControlledRow(executor.expectedHistory(entry(version)),entry(version)),true));
  test(`exact preserved historical Step ${ordinal} is accepted`,()=>assert.equal(executor.assertControlledRow(historicalRow(version),entry(version)),true));
  test(`mutated preserved historical Step ${ordinal} is rejected`,()=>{const row=historicalRow(version);row.statements[0]=`${row.statements[0]}x`;assert.throws(()=>executor.assertControlledRow(row,entry(version)),/CONTROLLED_HISTORY_PROVENANCE_MISMATCH/);});
}
test('same-length different-hash Step 21 body is rejected',()=>{const row=historicalRow('20260907155000');row.statements[0]=`x${row.statements[0].slice(1)}`;assert.equal(Buffer.byteLength(row.statements[0]),executor.acceptedHistoricalControlledBodies()['20260907155000'].historicalByteLength);assert.throws(()=>executor.assertControlledRow(row,entry('20260907155000')),/CONTROLLED_HISTORY_PROVENANCE_MISMATCH/);});
for(const [label,mutate] of [
  ['marker',row=>{row.statements[1]+='x';}],['actor',row=>{row.created_by='wrong';}],['idempotency',row=>{row.idempotency_key='wrong';}],['name',row=>{row.name='wrong';}],['rollback',row=>{row.rollback=['wrong'];}]
])test(`preserved body with wrong ${label} is rejected`,()=>{const row=historicalRow('20260907155000');mutate(row);assert.throws(()=>executor.assertControlledRow(row,entry('20260907155000')),/CONTROLLED_HISTORY_PROVENANCE_MISMATCH/);});
test('unknown fourth historical version is rejected',()=>{const unknown=manifest.entries.find(item=>item.action==='APPLY'&&!comments[item.version]),row=executor.expectedHistory(unknown);row.statements[0]=`x${row.statements[0].slice(1)}`;assert.throws(()=>executor.assertControlledRow(row,unknown),/CONTROLLED_HISTORY_PROVENANCE_MISMATCH/);});
test('canonical future expectedHistory output remains canonical',()=>{for(const version of Object.keys(comments))assert.equal(executor.expectedHistory(entry(version)).statements[0],fs.readFileSync(entry(version).filename,'utf8'));});
test('Step 29 MCP artifact contract remains unchanged',()=>assert.equal(executor.assertAcceptedHistoryArtifact(artifact()).controlledVersion,'20260902122033'));
test('actual Production Steps 1-28 fixture validates and preserves Step 29/30 classifications',()=>{const rows=[baseline(),...manifest.entries.slice(0,28).map(item=>comments[item.version]?historicalRow(item.version):executor.expectedHistory(item)),artifact()];assert.equal(executor.assertHistoryTail(rows).length,28);assert.equal(executor.classifyInterrupted(false,true),'EFFECTIVELY_APPLIED_HISTORY_MISSING');assert.equal(executor.classifyInterrupted(true,false),'NOT_APPLIED');});
test('local Step 29 recovery and Steps 30-57 continuation reaches strict final history',()=>{const rows=[baseline(),...manifest.entries.slice(0,28).map(item=>comments[item.version]?historicalRow(item.version):executor.expectedHistory(item)),artifact()];rows.push(executor.expectedHistory(manifest.entries[28]));for(const item of manifest.entries.slice(29))rows.push(executor.expectedHistory(item));assert.equal(executor.assertHistoryTail(rows).length,57);});
test('strict final history still rejects unrelated drift',()=>{const rows=[baseline(),...manifest.entries.slice(0,28).map(item=>comments[item.version]?historicalRow(item.version):executor.expectedHistory(item)),artifact(),{version:'20990101000000',name:'drift'}];assert.throws(()=>executor.assertHistoryTail(rows),/UNEXPECTED_PRODUCTION_HISTORY_DRIFT/);});
