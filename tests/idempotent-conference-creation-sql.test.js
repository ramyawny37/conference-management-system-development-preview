'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');

var sql=fs.readFileSync(path.resolve(
  __dirname,
  '../supabase/migrations/20260728_3_3_0_idempotent_conference_creation.sql'
),'utf8');

[
  /\bbegin\s*;/i,
  /\bcommit\s*;/i,
  /create table public\.conference_creation_operations/i,
  /unique\s*\(\s*user_id\s*,\s*operation_id\s*\)/i,
  /unique\s*\(\s*conference_id\s*\)/i,
  /references public\.conferences\(id\) on delete restrict/i,
  /enable row level security/i,
  /using\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)/i,
  /revoke all on table public\.conference_creation_operations from authenticated/i,
  /grant select on table public\.conference_creation_operations to authenticated/i,
  /create or replace function public\.create_conference_idempotent/i,
  /security definer/i,
  /set search_path = pg_catalog, public/i,
  /current_user_id uuid := auth\.uid\(\)/i,
  /pg_advisory_xact_lock/gi,
  /insert into public\.conferences/i,
  /insert into public\.conference_creation_operations/i,
  /OPERATION_RESULT_MISMATCH/i,
  /CONFERENCE_ID_ALREADY_USED/i,
  /get stacked diagnostics violated_constraint = constraint_name/i,
  /violated_constraint in/i,
  /grant execute on function public\.create_conference_idempotent/i
].forEach(function(pattern){
  assert.match(sql,pattern);
});

assert.strictEqual(
  (sql.match(/pg_advisory_xact_lock/gi)||[]).length,
  2
);
assert.doesNotMatch(
  sql,
  /grant\s+(insert|update|delete)[^;]*conference_creation_operations/i
);

console.log('idempotent conference creation SQL review: passed');
