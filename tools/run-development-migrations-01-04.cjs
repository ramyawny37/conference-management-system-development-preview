'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEVELOPMENT_REF = 'gppwltrifgfxrkzvvxoe';
const DEVELOPMENT_NAME = 'conference-management-system-development';
const PRODUCTION_REF = 'mpezfbvcdfxpgflehuot';
const STAGING_REF = 'zentpxnyccbkzgrkkkms';

const MIGRATIONS = [
  {
    file: '20260728_3_3_0_online_schema.sql',
    sha256: '78eea365d0db247fef9d9056a0cda5756bfe9c00fb1843e04206b6c60ca4344a',
  },
  {
    file: '20260728_3_3_0_conflict_resolution.sql',
    sha256: 'cf8059114b5f9314f7dca611cb60d8d7114964be94772b112c1318b760ac17d6',
  },
  {
    file: '20260728_3_3_0_conference_locks.sql',
    sha256: 'fe7931ed1a6be90b3f1a668f4015fab52823b44d977e60a17cca606dbbe474a8',
  },
  {
    file: '20260728_3_3_0_idempotent_conference_creation.sql',
    sha256: 'f4d2ac85e8e3b23d84c5307eb43363dfcbd8089ae3ea220cad035e1b50440201',
  },
];

const REQUIRED_TABLES = [
  'conferences',
  'devices',
  'conference_snapshots',
  'sync_operations',
  'sync_conflicts',
  'conference_locks',
  'conference_creation_operations',
];

function fail(message) {
  throw new Error(message);
}

function readTrimmed(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeError(error, password) {
  let message = error instanceof Error ? error.message : String(error);
  if (password) message = message.split(password).join('[REDACTED]');
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_DATABASE_URL]');
}

function unwrapMigrationTransaction(sql, file) {
  const withoutBegin = sql.replace(/^\uFEFF?\s*begin\s*;\s*/i, '');
  if (withoutBegin === sql) fail(`${file}: expected leading BEGIN; was not found`);

  const withoutCommit = withoutBegin.replace(/\s*commit\s*;\s*$/i, '');
  if (withoutCommit === withoutBegin) fail(`${file}: expected trailing COMMIT; was not found`);

  if (/^\s*(?:begin|commit|rollback)\s*;/im.test(withoutCommit)) {
    fail(`${file}: contains additional transaction control statements`);
  }

  return withoutCommit;
}

function localPreflight(repoRoot) {
  const tempDir = path.join(repoRoot, 'supabase', '.temp');
  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
  const projectRef = readTrimmed(path.join(tempDir, 'project-ref'));
  const linkedProject = JSON.parse(readTrimmed(path.join(tempDir, 'linked-project.json')));
  const poolerUrlText = readTrimmed(path.join(tempDir, 'pooler-url'));
  const poolerUrl = new URL(poolerUrlText);
  const databaseUser = decodeURIComponent(poolerUrl.username);
  const targetMetadata = [projectRef, linkedProject.ref, linkedProject.name, poolerUrlText].join('|');

  if (targetMetadata.includes(PRODUCTION_REF)) fail('Production ref detected; refusing execution');
  if (targetMetadata.includes(STAGING_REF)) fail('Staging ref detected; refusing execution');
  if (projectRef !== DEVELOPMENT_REF || linkedProject.ref !== DEVELOPMENT_REF) {
    fail('Local linked project ref is not the approved Development ref');
  }
  if (linkedProject.name !== DEVELOPMENT_NAME) fail('Linked project name is not the approved Development project');
  if (databaseUser !== `postgres.${DEVELOPMENT_REF}`) fail('Pooler database user does not identify Development');
  if (!poolerUrl.hostname || poolerUrl.pathname !== '/postgres') fail('Unexpected Development pooler target');
  if (poolerUrl.password) fail('pooler-url must not contain a stored password');

  const password = process.env.SUPABASE_DB_PASSWORD_DEV;
  if (!password) fail('SUPABASE_DB_PASSWORD_DEV is unavailable in this process');

  const migrationInputs = MIGRATIONS.map((migration) => {
    const filePath = path.join(migrationsDir, migration.file);
    const sql = fs.readFileSync(filePath, 'utf8');
    const actualHash = sha256(sql);
    if (actualHash !== migration.sha256) fail(`${migration.file}: SHA-256 mismatch`);
    return { ...migration, sql: unwrapMigrationTransaction(sql, migration.file) };
  });

  console.log('Local preflight: PASS');
  console.log(`Project: ${DEVELOPMENT_NAME}`);
  console.log(`Project ref: ${DEVELOPMENT_REF}`);
  console.log(`Target host: ${poolerUrl.hostname}:${poolerUrl.port || '5432'}`);
  console.log(`Target database user: ${databaseUser}`);
  console.log('Production ref check: PASS');
  console.log('Staging ref check: PASS');
  console.log('Migration SHA-256 check: PASS (01-04)');

  return {
    password,
    migrationInputs,
    connection: {
      host: poolerUrl.hostname,
      port: Number(poolerUrl.port || 5432),
      database: 'postgres',
      user: databaseUser,
      password,
      ssl: { rejectUnauthorized: false },
      application_name: 'cms-development-migrations-01-04',
    },
  };
}

async function databasePreflight(client) {
  const result = await client.query(`
    select
      current_database() as current_database,
      current_user as current_user,
      (
        select count(*)::integer
        from pg_catalog.pg_tables
        where schemaname = 'public'
      ) as public_table_count,
      coalesce((
        select json_agg(tablename order by tablename)
        from pg_catalog.pg_tables
        where schemaname = 'public'
          and tablename = any($1::text[])
      ), '[]'::json) as blocking_tables
  `, [[
    'conferences',
    'conference_snapshots',
    'sync_operations',
    'sync_conflicts',
    'devices',
  ]]);

  const row = result.rows[0];
  const blockingTables = row.blocking_tables || [];
  console.log('Database preflight (read-only):');
  console.log(JSON.stringify(row, null, 2));

  if (row.current_database !== 'postgres') fail('Unexpected database name; refusing migrations');
  if (row.current_user !== 'postgres') fail('Unexpected database role; refusing migrations');
  if (Number(row.public_table_count) !== 0 || blockingTables.length !== 0) {
    fail('Development public schema is not empty; refusing migrations');
  }

  console.log('Database empty-state check: PASS');
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
      // Preserve the original migration error and stop fail-closed.
    }
    throw error;
  }

  console.log(`Migration committed: ${migration.file}`);
  const migrationNotices = notices.slice(noticeStart);
  if (migrationNotices.length) console.log(`Notices: ${JSON.stringify(migrationNotices)}`);
}

async function verification(client) {
  const tables = await client.query(`
    select tablename
    from pg_catalog.pg_tables
    where schemaname = 'public'
    order by tablename
  `);
  const requiredTables = await client.query(`
    select requested.table_name, (tables.tablename is not null) as exists
    from unnest($1::text[]) with ordinality as requested(table_name, position)
    left join pg_catalog.pg_tables as tables
      on tables.schemaname = 'public' and tables.tablename = requested.table_name
    order by requested.position
  `, [REQUIRED_TABLES]);
  const constraints = await client.query(`
    select rel.relname as table_name, con.conname as constraint_name,
      case con.contype when 'p' then 'PRIMARY KEY' when 'f' then 'FOREIGN KEY'
        when 'u' then 'UNIQUE' when 'c' then 'CHECK' else con.contype::text end as constraint_type
    from pg_catalog.pg_constraint as con
    join pg_catalog.pg_class as rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace as ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = any($1::text[])
    order by rel.relname, con.conname
  `, [REQUIRED_TABLES]);
  const indexes = await client.query(`
    select tablename as table_name, indexname as index_name
    from pg_catalog.pg_indexes
    where schemaname = 'public' and tablename = any($1::text[])
    order by tablename, indexname
  `, [REQUIRED_TABLES]);
  const rls = await client.query(`
    select relname as table_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
    from pg_catalog.pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
    order by relname
  `);
  const functions = await client.query(`
    select proc.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(proc.oid) as signature,
      proc.prosecdef as security_definer
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
    order by proc.proname, signature
  `);

  console.log('Verification (read-only):');
  console.log(JSON.stringify({
    tables: tables.rows,
    requiredTables: requiredTables.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    rls: rls.rows,
    functions: functions.rows,
  }, null, 2));

  if (requiredTables.rows.some((row) => !row.exists)) fail('Post-migration verification found missing required tables');
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const preflight = localPreflight(repoRoot);
  const moduleRoot = process.env.CMS_MIGRATION_RUNNER_MODULES;
  if (!moduleRoot || !path.isAbsolute(moduleRoot)) fail('CMS_MIGRATION_RUNNER_MODULES must be an absolute path');

  const pgModule = path.join(moduleRoot, 'pg');
  const { Client } = require(pgModule);
  const client = new Client(preflight.connection);
  const notices = [];
  client.on('notice', (notice) => notices.push({ severity: notice.severity, message: notice.message }));

  try {
    await client.connect();
    await databasePreflight(client);
    for (const migration of preflight.migrationInputs) {
      await runMigration(client, migration, notices);
    }
    await verification(client);
    console.log('Stage 01-04 complete. Migration 05 was not executed.');
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
