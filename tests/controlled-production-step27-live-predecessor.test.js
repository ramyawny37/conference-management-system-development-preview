'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const manifest=require('../tools/production-release/controlled-production-manifest.json');
const migration=fs.readFileSync('supabase/migrations/20260902010000_warehouse_postgrest_exposed_schema_reconciliation.sql','utf8');
const entry=manifest.entries.find(item=>item.version==='20260902010000');

test('Step 27 accepts a missing managed override without weakening conflict rejection',()=>{
  assert.match(migration,/select count\(\*\), min\(substring/);
  assert.match(migration,/configured_schema_settings = 1[\s\S]*configured_schemas not in/);
  assert.doesNotMatch(migration,/configured_schemas is distinct from/);
  assert.match(entry.preconditionSql,/setting like 'pgrst\.db_schemas=%'/);
  assert.match(entry.preconditionSql,/setting<>'pgrst\.db_schemas=public, graphql_public, platform'/);
  assert.match(entry.preconditionSql,/exists\(select 1 from pg_roles where rolname='authenticator'\)/);
  assert.match(migration,/if not exists \(select 1 from pg_roles where rolname = 'authenticator'\)/);
});

test('Step 27 changes only its named role setting and reloads PostgREST',()=>{
  assert.match(migration,/alter role authenticator\s+set pgrst\.db_schemas = 'public, graphql_public, platform, warehouse'/i);
  assert.doesNotMatch(migration,/reset all|alter role authenticator reset|rolconfig\s*=/i);
  assert.match(migration,/notify pgrst, 'reload config'/i);
  assert.match(migration,/notify pgrst, 'reload schema'/i);
});

test('Step 27 verifier requires exactly the intended override and no conflict',()=>{
  assert.match(entry.verificationSql,/count\(\*\)=1/);
  assert.match(entry.verificationSql,/setting='pgrst\.db_schemas=public, graphql_public, platform, warehouse'/);
  assert.match(entry.verificationSql,/setting<>'pgrst\.db_schemas=public, graphql_public, platform, warehouse'/);
});
