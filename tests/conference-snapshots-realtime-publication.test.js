'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationName =
  '20260805_5_4_5_conference_snapshots_realtime_publication.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);

assert.ok(fs.existsSync(migrationPath), 'realtime publication migration is required');

const sql = fs.readFileSync(migrationPath, 'utf8');
assert.match(sql, /publication\.pubname\s*=\s*'supabase_realtime'/i);
assert.match(sql, /relation_namespace\.nspname\s*=\s*'public'/i);
assert.match(sql, /relation\.relname\s*=\s*'conference_snapshots'/i);
assert.match(
  sql,
  /if\s+not\s+exists\s*\([\s\S]*?\)\s*then[\s\S]*?alter publication\s+supabase_realtime\s+add table\s+public\.conference_snapshots/i,
  'publication membership must be added only when absent'
);
assert.strictEqual(
  (sql.match(/alter publication\s+supabase_realtime/gi) || []).length,
  1,
  'migration must change only the intended publication membership'
);
assert.doesNotMatch(sql, /gppwltrifgfxrkzvvxoe|mpezfbvcdfxpgflehuot|zentpxnyccbkzgrkkkms/i);
assert.doesNotMatch(sql, /password|secret|credential|api[_-]?key|service[_-]?role/i);
assert.doesNotMatch(sql, /\b(?:insert|update|delete|truncate|drop)\b/i);
assert.doesNotMatch(sql, /\b(?:policy|row level security|grant|revoke)\b/i);

const migrations = fs.readdirSync(path.dirname(migrationPath))
  .filter(name => name.endsWith('.sql'))
  .sort();
const migrationIndex = migrations.indexOf(migrationName);
assert.ok(migrationIndex >= 0);
assert.ok(
  migrations.slice(migrationIndex + 1).every(name => !name.includes('_5_4_')),
  '5.4.5 must be the final 5.4 migration'
);
assert.ok(
  migrations.slice(migrationIndex + 1).some(name => name.includes('_6_0_0_')),
  '5.4.5 must precede the 6.x migrations'
);

console.log('conference snapshots realtime publication contract tests: passed');
