'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const manifest=require('../tools/production-release/controlled-production-manifest.json');
const executor=require('../tools/production-release/controlled-production-executor.cjs');

const atomicEntries=manifest.entries.filter(entry=>
  entry.action==='APPLY'&&entry.transaction.safeOuterAtomicWrap
);

test('all atomic APPLY entries use one complete executor-owned transaction',()=>{
  assert.equal(atomicEntries.length,13);
  for(const entry of atomicEntries){
    const sql=executor.atomicExecutionSql(entry);
    const body=fs.readFileSync(entry.filename,'utf8');
    assert.ok(sql.startsWith(`BEGIN;\n${body}\n`),entry.version);
    assert.ok(sql.endsWith('\nCOMMIT;'),entry.version);
    assert.equal(sql.match(/\$controlled_semantic_guard\$/g)?.length,2,entry.version);
    assert.equal(sql.match(/\$controlled_verification_sql\$/g)?.length,2,entry.version);
    assert.ok(sql.includes(`$controlled_verification_sql$${entry.verificationSql}$controlled_verification_sql$`),entry.version);
    assert.ok(sql.includes(executor.historyInsertSql(entry)),entry.version);
    assert.doesNotMatch(sql,/DO \$ BEGIN|END \$;/,entry.version);
    assert.doesNotMatch(sql,/IF NOT \(to_reg/,entry.version);
  }
});

test('atomic guard evaluates the complete SELECT and requires exact true text',()=>{
  const guard=executor.atomicSemanticGuardSql('select (true)::text','fixture');
  assert.match(guard,/EXECUTE \$controlled_verification_sql\$select \(true\)::text\$controlled_verification_sql\$/);
  assert.match(guard,/controlled_postcondition IS DISTINCT FROM 'true'/);
  assert.match(guard,/RAISE EXCEPTION 'SEMANTIC_POSTCONDITION_FAILED'/);
});

test('atomic builder rejects non-atomic entries and delimiter injection',()=>{
  const nonAtomic=manifest.entries.find(entry=>entry.action==='APPLY'&&!entry.transaction.safeOuterAtomicWrap);
  assert.throws(()=>executor.atomicExecutionSql(nonAtomic),/ATOMIC_APPLY_ENTRY_REQUIRED/);
  assert.throws(
    ()=>executor.atomicSemanticGuardSql('select true; $controlled_semantic_guard$','fixture'),
    /ATOMIC_VERIFICATION_SQL_INVALID/
  );
  assert.throws(
    ()=>executor.atomicSemanticGuardSql('delete from example','fixture'),
    /ATOMIC_VERIFICATION_SQL_INVALID/
  );
});

test('Step 57 atomic SQL retains canonical body and corrected predicates unchanged',()=>{
  const entry=manifest.entries.find(item=>item.version==='20260907150000');
  const sql=executor.atomicExecutionSql(entry);
  assert.ok(sql.includes(fs.readFileSync(entry.filename,'utf8')));
  assert.ok(sql.includes(entry.verificationSql));
  assert.equal(entry.sha256,'25c93aba3eb25f8136f446490983b165150559e0c30c85e5753d38f0690515c5');
});
