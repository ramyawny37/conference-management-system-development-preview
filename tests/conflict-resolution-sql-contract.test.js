'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');

var sql=fs.readFileSync(path.resolve(
  __dirname,
  '..',
  'supabase/migrations/20260728_3_3_0_conflict_resolution.sql'
),'utf8');

function has(pattern,message){
  assert.ok(pattern.test(sql),message);
}

has(/current_user_id uuid := auth\.uid\(\)/i,'auth.uid is required');
has(/if current_user_id is null then[\s\S]*authentication required/i,
  'anonymous execution must be rejected');
has(/has_conference_role\([\s\S]*array\['owner', 'manager'\]/i,
  'owner or manager role is required');
has(/from public\.devices[\s\S]*d\.user_id = current_user_id/i,
  'device ownership must be validated');
has(/from public\.conferences[\s\S]*for update/i,
  'conference row must be locked');
has(/from public\.sync_conflicts[\s\S]*for update/i,
  'conflict row must be locked');
has(/from public\.conference_snapshots[\s\S]*for update/i,
  'snapshot revision must be locked');
has(/where so\.operation_id = p_resolution_operation_id/i,
  'resolution operation must be idempotent');
has(/existing_operation\.conference_id <> p_conference_id/i,
  'duplicate conference scope must be checked');
has(/existing_operation\.payload ->> 'conflictId' <> p_conflict_id::text/i,
  'duplicate conflict scope must be checked');
has(/existing_operation\.payload ->> 'strategy' <> p_strategy/i,
  'duplicate strategy must be checked');
has(/conflict_record\.status <> 'open'[\s\S]*current_revision <> p_expected_revision/i,
  'revision and open status must be checked under lock');
has(/if p_strategy = 'keep_server' then[\s\S]*final_revision := current_revision/i,
  'remote wins must preserve revision');
has(/else[\s\S]*next_revision := current_revision \+ 1/i,
  'local and manual wins must increment once');
has(/if conflict_record\.status <> 'open'[\s\S]*return jsonb_build_object\([\s\S]*'conflict_changed'[\s\S]*end if;[\s\S]*if p_strategy = 'keep_server'/i,
  'conflict_changed must return before snapshot mutation');
has(/create unique index sync_conflicts_resolution_operation_id_key/i,
  'resolution operation IDs must be unique');
has(/security definer[\s\S]*set search_path = pg_catalog, public/i,
  'RPC must use a fixed search path');

console.log('conflict resolution SQL contract tests: passed');
