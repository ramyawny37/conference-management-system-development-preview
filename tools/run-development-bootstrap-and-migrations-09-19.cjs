'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEV_REF = 'gppwltrifgfxrkzvvxoe';
const DEV_NAME = 'conference-management-system-development';
const PROD_REF = 'mpezfbvcdfxpgflehuot';
const STAGE_REF = 'zentpxnyccbkzgrkkkms';

const MIGRATIONS = [
  ['10', '20260801_5_3_1_organization_access_locking.sql', '0f0d4db059649a62bff0dafbc08cac7944642e107fa4efa2789728d9314ea728'],
  ['11', '20260801_5_3_2_organization_administration_rpc_reads.sql', '8411706bfa89c0dda232a7f481d9e3263e83497c96b84896b2cae82f22827978'],
  ['12', '20260801_5_3_3_organization_access_role_variable_fix.sql', '2dac3dfab8af6bb00a4d8e28fd8ace9509cfcb54f592c0f7f2210f76f8a301ee'],
  ['13', '20260801_5_3_4_organization_member_list_role_variable_fix.sql', 'cc59eebd5b768fbdfb4e0de86a7c31de6bf2cd6f628c11669b91ed8412eeac89'],
  ['14', '20260801_5_4_0_device_authorization_foundation.sql', '44c75d3e52622034fa1ed95721995b92ce6ce4aacb8c0847d784a3750ac1dab5'],
  ['15', '20260801_5_4_1_device_guarded_rpc_foundation.sql', 'a3908d6638cca5aabc16521076ac45a54781e193e0c6ed6c1792948ab932a8a5'],
  ['16', '20260802_5_4_2_device_authorization_administration.sql', '31541e564187c2fb8b0e69905b456b566b82925dfe224438aad7724d16a5d0e0'],
  ['17', '20260803_5_4_3_device_authorization_rerequest.sql', '28b35570048ab54d214fdd9ab34f12f5f6f0f65c45a49d263613332374c3b383'],
  ['18', '20260805_5_4_4_multi_device_authorization.sql', '0741a3bab330aa4e31e0e2938618cc0eda7a0cdcac318e9baaae9fcdcc564015'],
  ['19', '20260806_6_0_0_conference_section_locks.sql', '1e66fa2d086cf03dd569999ad3c3ee475c674bcafbdc09cc2998349bfc0a1679'],
].map(([sequence, file, checksum]) => ({ sequence, file, checksum }));

const REQUIRED_FINAL_TABLES = [
  'conferences', 'conference_snapshots', 'conference_members', 'conference_locks',
  'devices', 'sync_operations', 'sync_conflicts', 'profiles',
  'conference_creation_operations', 'conference_membership_operations',
  'system_user_access', 'system_user_roles', 'system_access_audit_log',
  'organizations', 'organization_members', 'organization_membership_operations',
  'organization_membership_audit_log', 'user_device_authorizations',
  'device_authorization_operations', 'device_authorization_audit_log',
  'device_authorization_enforcement', 'device_authorization_admin_operations',
];

function fail(message) {
  throw new Error(message);
}

function digest(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeError(error, password) {
  let message = error instanceof Error ? error.message : String(error);
  if (password) message = message.split(password).join('[REDACTED]');
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_DATABASE_URL]');
}

function migrationBody(sql, file) {
  const markers = [...sql.matchAll(/^\s*(begin|commit|rollback)\s*;\s*$/gim)]
    .map((match) => match[1].toLowerCase());
  if (!markers.length || markers[0] !== 'begin' || markers.at(-1) !== 'commit') {
    fail(`${file}: invalid transaction envelope`);
  }
  if (markers.includes('rollback') || markers.filter((item) => item === 'begin').length
    !== markers.filter((item) => item === 'commit').length) {
    fail(`${file}: unsupported transaction markers`);
  }
  return sql.replace(/^\s*(?:begin|commit)\s*;\s*$/gim, '');
}

function localPreflight(repoRoot) {
  const temp = path.join(repoRoot, 'supabase', '.temp');
  const ref = fs.readFileSync(path.join(temp, 'project-ref'), 'utf8').trim();
  const linked = JSON.parse(fs.readFileSync(path.join(temp, 'linked-project.json'), 'utf8'));
  const poolText = fs.readFileSync(path.join(temp, 'pooler-url'), 'utf8').trim();
  const pool = new URL(poolText);
  const user = decodeURIComponent(pool.username);
  const target = [ref, linked.ref, linked.name, poolText].join('|');
  if (target.includes(PROD_REF) || target.includes(STAGE_REF)) fail('Non-Development target detected');
  if (ref !== DEV_REF || linked.ref !== DEV_REF || linked.name !== DEV_NAME) fail('Development identity mismatch');
  if (user !== `postgres.${DEV_REF}` || pool.pathname !== '/postgres' || pool.password) fail('Development pooler mismatch');

  const password = process.env.SUPABASE_DB_PASSWORD_DEV;
  const bootstrapId = (process.env.SUPABASE_DEV_BOOTSTRAP_USER_ID || '').trim();
  const bootstrapEmail = (process.env.SUPABASE_DEV_BOOTSTRAP_EMAIL || '').trim();
  const bootstrapOperationId = (process.env.SUPABASE_DEV_BOOTSTRAP_OPERATION_ID || '').trim();
  if (!password) fail('SUPABASE_DB_PASSWORD_DEV is unavailable');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bootstrapId)) {
    fail('Development bootstrap user ID is invalid');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrapEmail) || bootstrapEmail.length > 254) {
    fail('Development bootstrap email is invalid');
  }
  if (bootstrapId.toLowerCase() === '630c56a1-f6b0-4e49-a4ab-ef426d8966d1'
    || bootstrapEmail.toLowerCase() === 'ramyawny37@yahoo.com') {
    fail('Production bootstrap identity is forbidden');
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(bootstrapOperationId)) {
    fail('Development bootstrap operation ID is invalid');
  }

  const migrationDir = path.join(repoRoot, 'supabase', 'migrations');
  const inputs = MIGRATIONS.map((migration) => {
    const sql = fs.readFileSync(path.join(migrationDir, migration.file), 'utf8');
    if (digest(sql) !== migration.checksum) fail(`${migration.file}: SHA-256 mismatch`);
    return { ...migration, sql: migrationBody(sql, migration.file) };
  });
  console.log('Identity and SHA-256 gate: PASS');
  console.log(`Project ref: ${DEV_REF}`);
  console.log(`Target host: ${pool.hostname}:${pool.port || '5432'}`);
  return {
    password,
    bootstrapId,
    bootstrapEmail,
    bootstrapOperationId,
    inputs,
    connection: {
      host: pool.hostname,
      port: Number(pool.port || 5432),
      database: 'postgres',
      user,
      password,
      ssl: { rejectUnauthorized: false },
      application_name: 'cms-development-bootstrap-migrations-09-19',
    },
  };
}

async function verifyPendingUser(client, userId, email) {
  const result = await client.query(`
    select
      exists(select 1 from auth.users where id=$1::uuid and lower(email)=lower($2)) as auth_user,
      exists(select 1 from public.profiles where id=$1::uuid) as profile,
      exists(select 1 from public.system_user_access where user_id=$1::uuid) as access_row,
      (select account_status from public.system_user_access where user_id=$1::uuid) as account_status,
      (select can_create_conferences from public.system_user_access where user_id=$1::uuid) as can_create_conferences
  `, [userId, email]);
  const row = result.rows[0];
  console.log(`User verification (read-only): ${JSON.stringify(row)}`);
  if (!row.auth_user || !row.profile || !row.access_row
    || row.account_status !== 'pending' || row.can_create_conferences !== false) {
    fail('Development test user prerequisite failed');
  }
}

async function bootstrapSystemAccess(client, userId) {
  await client.query('BEGIN');
  try {
    await client.query(`
      update public.system_user_access
      set account_status='approved', can_create_conferences=true,
        approved_by=null, approved_at=now(), blocked_by=null, blocked_at=null
      where user_id=$1::uuid and account_status='pending' and can_create_conferences=false
    `, [userId]);
    await client.query(`
      insert into public.system_user_roles(user_id,role,granted_by)
      values($1::uuid,'system_owner',null)
    `, [userId]);
    await client.query(`
      insert into public.system_access_audit_log(
        actor_user_id,target_user_id,action,old_values,new_values
      ) values
      (null,$1::uuid,'development_bootstrap_access_approved',
        '{"account_status":"pending","can_create_conferences":false}'::jsonb,
        '{"account_status":"approved","can_create_conferences":true}'::jsonb),
      (null,$1::uuid,'development_bootstrap_system_owner_granted',
        '{"system_owner":false}'::jsonb,'{"system_owner":true}'::jsonb)
    `, [userId]);
    const check = await client.query(`
      select exists(select 1 from public.system_user_access
        where user_id=$1::uuid and account_status='approved' and can_create_conferences) as approved,
        exists(select 1 from public.system_user_roles
        where user_id=$1::uuid and role='system_owner') as owner_role
    `, [userId]);
    if (!check.rows[0].approved || !check.rows[0].owner_role) fail('System bootstrap verification failed');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  console.log('Development system bootstrap: COMMITTED');
}

function runMigration09Recovery(repoRoot) {
  const recovery = path.join(repoRoot, 'tools', 'recover-development-migration-09.cjs');
  const result = spawnSync(process.execPath, [recovery], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Migration 09 recovery failed with exit code ${result.status}`);
  console.log('Migration 09 recovery: PASS');
}

async function runMigration(client, migration) {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  console.log(`Migration ${migration.sequence}: COMMITTED (${migration.file})`);
}

async function groupVerification(client, throughSequence) {
  const result = await client.query(`
    select
      to_regclass('public.organization_membership_audit_log') is not null as organization_admin,
      to_regclass('public.user_device_authorizations') is not null as device_foundation,
      to_regclass('public.device_authorization_admin_operations') is not null as device_admin,
      exists(select 1 from information_schema.columns where table_schema='public'
        and table_name='conference_locks' and column_name='section') as section_locks
  `);
  console.log(`Verification through ${throughSequence} (read-only): ${JSON.stringify(result.rows[0])}`);
  if (!result.rows[0].organization_admin) fail('Organization administration verification failed');
  if (Number(throughSequence) >= 14 && !result.rows[0].device_foundation) fail('Device foundation verification failed');
  if (Number(throughSequence) >= 16 && !result.rows[0].device_admin) fail('Device administration verification failed');
  if (Number(throughSequence) >= 19 && !result.rows[0].section_locks) fail('Section locks verification failed');
}

async function finalVerification(client) {
  const result = await client.query(`
    select json_build_object(
      'required_tables', (select json_agg(x order by position) from (
        select name,position,to_regclass('public.'||quote_ident(name)) is not null as exists
        from unnest($1::text[]) with ordinality item(name,position)) x),
      'public_table_count', (select count(*)::integer from pg_tables where schemaname='public'),
      'public_function_count', (select count(*)::integer from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
      'public_policy_count', (select count(*)::integer from pg_policies where schemaname='public'),
      'rls_disabled_tables', (select coalesce(json_agg(relname order by relname),'[]'::json)
        from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity),
      'conference_snapshots_realtime', exists(
        select 1 from pg_publication_tables where pubname='supabase_realtime'
          and schemaname='public' and tablename='conference_snapshots')
    ) as report
  `, [REQUIRED_FINAL_TABLES]);
  const report = result.rows[0].report;
  console.log(`FINAL_DEVELOPMENT_REPORT=${JSON.stringify(report)}`);
  if (report.required_tables.some((item) => !item.exists)) fail('Final schema has missing required tables');
  console.log(report.conference_snapshots_realtime
    ? 'Realtime membership status: PRESENT'
    : 'Realtime membership status: MISSING — Environment Setup required; no ALTER was executed');
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const state = localPreflight(repoRoot);
  const moduleRoot = process.env.CMS_MIGRATION_RUNNER_MODULES;
  if (!moduleRoot || !path.isAbsolute(moduleRoot)) fail('CMS_MIGRATION_RUNNER_MODULES must be absolute');
  const { Client } = require(path.join(moduleRoot, 'pg'));
  let client = new Client(state.connection);
  try {
    await client.connect();
    await verifyPendingUser(client, state.bootstrapId, state.bootstrapEmail);
    await bootstrapSystemAccess(client, state.bootstrapId);
    await client.end();
    runMigration09Recovery(repoRoot);
    client = new Client(state.connection);
    await client.connect();
    for (const migration of state.inputs) {
      await runMigration(client, migration);
      if (['13', '18', '19'].includes(migration.sequence)) await groupVerification(client, migration.sequence);
    }
    await finalVerification(client);
    console.log('Development setup completed through Migration 19. Realtime was read-only checked.');
  } catch (error) {
    console.error(`FAILED: ${safeError(error, state.password)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
    state.password = '';
    state.connection.password = '';
  }
}

main().catch((error) => {
  console.error(`FAILED: ${safeError(error, process.env.SUPABASE_DB_PASSWORD_DEV || '')}`);
  process.exitCode = 1;
});
