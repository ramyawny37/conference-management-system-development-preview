'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEVELOPMENT_REF = 'gppwltrifgfxrkzvvxoe';
const DEVELOPMENT_NAME = 'conference-management-system-development';
const PRODUCTION_REF = 'mpezfbvcdfxpgflehuot';
const STAGING_REF = 'zentpxnyccbkzgrkkkms';
const STAGE_MANIFEST_SHA256 = '8f8a98f991833b542b1431c0302faa1312a2bc103837b4f4fdc037ea7e641a86';

const MIGRATIONS = [
  ['05', '20260729_4_0_0_conference_membership.sql', '4c808141ea6a32adf8ed2a6712f924cbe44511c8d1be2d307133cdca405279c6'],
  ['06', '20260730_5_0_0_system_access_foundation.sql', '9467e7febce360159934361d70de2756365fb6d42cd3c524fef3d4b9b3c6df4d'],
  ['07', '20260801_5_1_0_organization_foundation.sql', '6385852570ce2d69e1dfc19e840c9843696181e2be7366104038e7381b5a81fd'],
  ['08', '20260801_5_2_0_organization_security_activation.sql', '9deb77ea494d1e412f367661ff573f3e2d37d6bad4b91bf94442129561c1d4fa'],
  ['09', '20260801_5_3_0_organization_administration.sql', '064ed1781793f21c2c3d084979c4c4d818afad5a88d6b8117b6e633ae0a3758c'],
].map(([sequence, file, sha256]) => ({ sequence, file, sha256 }));

const STAGE_01_04_TABLES = [
  'profiles', 'conferences', 'conference_members', 'devices',
  'conference_snapshots', 'sync_operations', 'sync_conflicts',
  'conference_locks', 'conference_creation_operations',
];

const STAGE_05_09_TABLES = [
  'conference_membership_operations',
  'system_user_access',
  'system_user_roles',
  'system_access_audit_log',
  'organizations',
  'organization_members',
  'organization_membership_operations',
  'organization_membership_audit_log',
];

const STAGE_05_09_FUNCTIONS = [
  'add_conference_manager',
  'enforce_conference_lock_manager',
  'get_my_conference_access',
  'handle_new_user_profile',
  'list_conference_members',
  'lookup_conference_user_by_email',
  'remove_conference_manager',
  'approve_system_user',
  'block_system_user',
  'can_user_create_conferences',
  'grant_system_role',
  'is_account_approved',
  'is_system_admin',
  'is_system_owner',
  'revoke_system_role',
  'set_user_conference_creation_permission',
  'unblock_system_user',
  'is_current_user_organization_member',
  'list_my_organizations',
  'add_organization_member',
  'change_organization_role',
  'manage_organization_member',
  'prevent_final_organization_owner_removal',
  'prevent_organization_audit_mutation',
  'remove_organization_member',
  'store_organization_membership_result',
];

function fail(message) {
  throw new Error(message);
}

function readTrimmed(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeError(error, password) {
  let message = error instanceof Error ? error.message : String(error);
  if (password) message = message.split(password).join('[REDACTED]');
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_DATABASE_URL]');
}

function migrationBody(sql, file) {
  const noBegin = sql.replace(/^\uFEFF?\s*begin\s*;\s*/i, '');
  if (noBegin === sql) fail(`${file}: leading BEGIN; not found`);
  const body = noBegin.replace(/\s*commit\s*;\s*$/i, '');
  if (body === noBegin) fail(`${file}: trailing COMMIT; not found`);
  if (/^\s*(?:begin|commit|rollback)\s*;/im.test(body)) {
    fail(`${file}: additional transaction control found`);
  }
  return body;
}

function localPreflight(repoRoot) {
  const temp = path.join(repoRoot, 'supabase', '.temp');
  const migrationDir = path.join(repoRoot, 'supabase', 'migrations');
  const ref = readTrimmed(path.join(temp, 'project-ref'));
  const linked = JSON.parse(readTrimmed(path.join(temp, 'linked-project.json')));
  const poolerText = readTrimmed(path.join(temp, 'pooler-url'));
  const pooler = new URL(poolerText);
  const user = decodeURIComponent(pooler.username);
  const target = [ref, linked.ref, linked.name, poolerText].join('|');

  if (target.includes(PRODUCTION_REF)) fail('Production ref detected');
  if (target.includes(STAGING_REF)) fail('Staging ref detected');
  if (ref !== DEVELOPMENT_REF || linked.ref !== DEVELOPMENT_REF) fail('Development ref mismatch');
  if (linked.name !== DEVELOPMENT_NAME) fail('Development project name mismatch');
  if (user !== `postgres.${DEVELOPMENT_REF}`) fail('Development database user mismatch');
  if (!pooler.hostname || pooler.pathname !== '/postgres') fail('Unexpected database target');
  if (pooler.password) fail('Stored password found in pooler-url');

  const password = process.env.SUPABASE_DB_PASSWORD_DEV;
  if (!password) fail('SUPABASE_DB_PASSWORD_DEV is unavailable');

  const inputs = MIGRATIONS.map((migration) => {
    const filePath = path.join(migrationDir, migration.file);
    const sql = fs.readFileSync(filePath, 'utf8');
    if (hash(sql) !== migration.sha256) fail(`${migration.file}: SHA-256 mismatch`);
    return { ...migration, sql: migrationBody(sql, migration.file) };
  });
  const canonicalManifest = `${MIGRATIONS.map(
    (item) => `${item.sequence}|${item.file}|${item.sha256}`,
  ).join('\n')}\n`;
  if (hash(canonicalManifest) !== STAGE_MANIFEST_SHA256) fail('Stage manifest SHA-256 mismatch');

  console.log('Local identity and manifest preflight: PASS');
  console.log(`Project: ${DEVELOPMENT_NAME}`);
  console.log(`Project ref: ${DEVELOPMENT_REF}`);
  console.log(`Target host: ${pooler.hostname}:${pooler.port || '5432'}`);
  console.log(`Target database user: ${user}`);
  console.log(`Stage manifest SHA-256: ${STAGE_MANIFEST_SHA256}`);

  return {
    password,
    inputs,
    connection: {
      host: pooler.hostname,
      port: Number(pooler.port || 5432),
      database: 'postgres',
      user,
      password,
      ssl: { rejectUnauthorized: false },
      application_name: 'cms-development-migrations-05-09',
    },
  };
}

async function databasePreflight(client) {
  const result = await client.query(`
    with requested_stage_1(name) as (select unnest($1::text[])),
    requested_stage_2(name) as (select unnest($2::text[]))
    select
      current_database() as current_database,
      current_user as current_user,
      coalesce((select json_agg(name order by name) from requested_stage_1
        where to_regclass('public.' || quote_ident(name)) is null), '[]'::json) as missing_stage_1_tables,
      coalesce((select json_agg(name order by name) from requested_stage_2
        where to_regclass('public.' || quote_ident(name)) is not null), '[]'::json) as existing_stage_2_tables
  `, [STAGE_01_04_TABLES, STAGE_05_09_TABLES]);
  const row = result.rows[0];
  console.log(`Database preflight (read-only): ${JSON.stringify(row)}`);
  if (row.current_database !== 'postgres' || row.current_user !== 'postgres') fail('Database identity SQL gate failed');
  if (row.missing_stage_1_tables.length) fail('Stage 01-04 prerequisite tables are missing');
  if (row.existing_stage_2_tables.length) fail('Stage 05-09 objects already exist; refusing execution');
  console.log('Stage 01-04 presence gate: PASS');
  console.log('Empty Stage-2 gate: PASS');
}

async function runMigration(client, migration, notices) {
  const noticeStart = notices.length;
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Keep the original error and stop fail-closed.
    }
    throw error;
  }
  console.log(`Migration committed: ${migration.sequence} ${migration.file}`);
  const currentNotices = notices.slice(noticeStart);
  if (currentNotices.length) console.log(`Notices: ${JSON.stringify(currentNotices)}`);
}

async function verification(client) {
  const result = await client.query(`
    select json_build_object(
      'required_tables', (select json_agg(x order by position) from (
        select requested.name, requested.position,
          to_regclass('public.' || quote_ident(requested.name)) is not null as exists
        from unnest($1::text[]) with ordinality requested(name, position)
      ) x),
      'rls', (select coalesce(json_agg(x order by table_name), '[]'::json) from (
        select cls.relname as table_name, cls.relrowsecurity as enabled, cls.relforcerowsecurity as forced
        from pg_class cls join pg_namespace ns on ns.oid=cls.relnamespace
        where ns.nspname='public' and cls.relname=any($1::text[])
      ) x),
      'constraints', (select coalesce(json_agg(x order by table_name, constraint_name), '[]'::json) from (
        select cls.relname as table_name, con.conname as constraint_name,
          pg_get_constraintdef(con.oid, false) as definition
        from pg_constraint con join pg_class cls on cls.oid=con.conrelid
        join pg_namespace ns on ns.oid=cls.relnamespace
        where ns.nspname='public' and cls.relname=any($1::text[])
      ) x),
      'indexes', (select coalesce(json_agg(x order by table_name, index_name), '[]'::json) from (
        select tablename as table_name, indexname as index_name, indexdef as definition
        from pg_indexes where schemaname='public' and tablename=any($1::text[])
      ) x),
      'functions', (select coalesce(json_agg(x order by function_name, identity_arguments), '[]'::json) from (
        select proc.proname as function_name, pg_get_function_identity_arguments(proc.oid) as identity_arguments,
          proc.prosecdef as security_definer, proc.provolatile::text as volatility
        from pg_proc proc join pg_namespace ns on ns.oid=proc.pronamespace
        where ns.nspname='public' and proc.proname=any($2::text[])
      ) x),
      'triggers', (select coalesce(json_agg(x order by table_name, trigger_name), '[]'::json) from (
        select cls.relname as table_name, trg.tgname as trigger_name, pg_get_triggerdef(trg.oid, false) as definition
        from pg_trigger trg join pg_class cls on cls.oid=trg.tgrelid
        join pg_namespace ns on ns.oid=cls.relnamespace
        where ns.nspname='public' and not trg.tgisinternal and cls.relname=any($1::text[])
      ) x),
      'policies', (select coalesce(json_agg(x order by table_name, policy_name), '[]'::json) from (
        select tablename as table_name, policyname as policy_name, cmd, roles, qual, with_check
        from pg_policies where schemaname='public' and tablename=any($1::text[])
      ) x)
    ) as verification
  `, [STAGE_05_09_TABLES, STAGE_05_09_FUNCTIONS]);
  const report = result.rows[0].verification;
  console.log(`Verification (read-only):\n${JSON.stringify(report, null, 2)}`);
  if (report.required_tables.some((item) => !item.exists)) fail('Stage 05-09 verification found missing tables');
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const preflight = localPreflight(repoRoot);
  const moduleRoot = process.env.CMS_MIGRATION_RUNNER_MODULES;
  if (!moduleRoot || !path.isAbsolute(moduleRoot)) fail('CMS_MIGRATION_RUNNER_MODULES must be an absolute path');
  const { Client } = require(path.join(moduleRoot, 'pg'));
  const client = new Client(preflight.connection);
  const notices = [];
  client.on('notice', (notice) => notices.push({ severity: notice.severity, message: notice.message }));

  try {
    await client.connect();
    await databasePreflight(client);
    for (const migration of preflight.inputs) await runMigration(client, migration, notices);
    await verification(client);
    console.log('Stage 05-09 complete. Migration 10 was not executed.');
  } catch (error) {
    console.error(`FAILED: ${safeError(error, preflight.password)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
    preflight.password = '';
    preflight.connection.password = '';
  }
}

main().catch((error) => {
  console.error(`FAILED: ${safeError(error, process.env.SUPABASE_DB_PASSWORD_DEV || '')}`);
  process.exitCode = 1;
});
