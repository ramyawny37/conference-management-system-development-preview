'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEVELOPMENT_REF = 'gppwltrifgfxrkzvvxoe';
const DEVELOPMENT_NAME = 'conference-management-system-development';
const PRODUCTION_REF = 'mpezfbvcdfxpgflehuot';
const STAGING_REF = 'zentpxnyccbkzgrkkkms';
const MIGRATION_FILE = '20260801_5_3_0_organization_administration.sql';
const MIGRATION_SHA256 = '064ed1781793f21c2c3d084979c4c4d818afad5a88d6b8117b6e633ae0a3758c';

const REQUIRED_STAGE_05_08_TABLES = [
  'conference_membership_operations',
  'system_user_access',
  'system_user_roles',
  'system_access_audit_log',
  'organizations',
  'organization_members',
];

const MIGRATION_09_TABLES = [
  'organization_membership_operations',
  'organization_membership_audit_log',
];

const MIGRATION_09_FUNCTIONS = [
  'prevent_organization_audit_mutation',
  'prevent_final_organization_owner_removal',
  'store_organization_membership_result',
  'manage_organization_member',
  'add_organization_member',
  'remove_organization_member',
  'change_organization_role',
];

const MIGRATION_09_TRIGGERS = [
  'organization_membership_audit_immutable',
  'organization_members_prevent_final_owner_removal',
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

function validateBootstrapIdentity(userId, email, operationId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    fail('SUPABASE_DEV_BOOTSTRAP_USER_ID is not a valid UUID');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    fail('SUPABASE_DEV_BOOTSTRAP_EMAIL is invalid');
  }
  if (userId.toLowerCase() === '630c56a1-f6b0-4e49-a4ab-ef426d8966d1') {
    fail('Production bootstrap UUID is forbidden');
  }
  if (email.toLowerCase() === 'ramyawny37@yahoo.com') {
    fail('Production bootstrap email is forbidden');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) {
    fail('SUPABASE_DEV_BOOTSTRAP_OPERATION_ID is not a valid UUID');
  }
  if (operationId.toLowerCase() === '00000000-0000-0000-0000-0000000002c0') {
    fail('Production bootstrap operation UUID is forbidden');
  }
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function unwrapTransaction(sql) {
  const noBegin = sql.replace(/^\uFEFF?\s*begin\s*;\s*/i, '');
  if (noBegin === sql) fail('Migration 09 leading BEGIN; not found');
  const body = noBegin.replace(/\s*commit\s*;\s*$/i, '');
  if (body === noBegin) fail('Migration 09 trailing COMMIT; not found');
  if (/^\s*(?:begin|commit|rollback)\s*;/im.test(body)) fail('Unexpected transaction control in Migration 09');
  return body;
}

function applyDevelopmentBootstrap(body, userId, email, operationId) {
  const startMarker = '-- Deployment-only, explicit bootstrap. No ownership inference is used.';
  const nextMarker = 'create or replace function public.store_organization_membership_result(';
  const start = body.indexOf(startMarker);
  const next = body.indexOf(nextMarker);
  if (start < 0 || next < 0 || next <= start) fail('Migration 09 bootstrap boundaries were not found');
  if (body.indexOf(startMarker, start + 1) >= 0) fail('Migration 09 contains multiple bootstrap markers');

  const replacement = `-- Development-only bootstrap substitution; source migration remains unchanged.
do $$
declare default_organization_id uuid;
  bootstrap_user_id constant uuid := ${sqlLiteral(userId)}::uuid;
  bootstrap_operation_id constant uuid := ${sqlLiteral(operationId)}::uuid;
  previous_role text;
begin
  select id into default_organization_id from public.organizations where is_default;
  if not found then raise exception 'DEV_DEFAULT_ORGANIZATION_REQUIRED'; end if;
  if (select count(*) from public.organizations where is_default) <> 1 then
    raise exception 'DEV_DEFAULT_ORGANIZATION_INVALID';
  end if;
  if not exists (
    select 1 from auth.users users
    join public.system_user_access access on access.user_id=users.id
    join public.system_user_roles roles on roles.user_id=users.id
    where users.id=bootstrap_user_id
      and lower(users.email)=lower(${sqlLiteral(email)})
      and access.account_status='approved'
      and roles.role='system_owner'
  ) then raise exception 'DEV_BOOTSTRAP_IDENTITY_INVALID'; end if;
  select role into previous_role from public.organization_members
    where organization_id=default_organization_id and user_id=bootstrap_user_id;
  insert into public.organization_members(organization_id,user_id,role)
  values(default_organization_id,bootstrap_user_id,'organization_owner')
  on conflict(organization_id,user_id) do update set role='organization_owner';
  insert into public.organization_membership_audit_log(
    organization_id,target_user_id,target_user_id_snapshot,action,
    operation_id,requested_role,previous_role,resulting_role,outcome,metadata
  ) values(
    default_organization_id,bootstrap_user_id,bootstrap_user_id,
    'bootstrap_organization_owner',bootstrap_operation_id,
    'organization_owner',previous_role,'organization_owner','applied',
    jsonb_build_object('source','development_bootstrap')
  ) on conflict(organization_id,target_user_id_snapshot,action)
    where action='bootstrap_organization_owner' do nothing;
end;
$$;

`;
  return `${body.slice(0, start)}${replacement}${body.slice(next)}`;
}

function localPreflight(repoRoot) {
  const temp = path.join(repoRoot, 'supabase', '.temp');
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
  if (!pooler.hostname || pooler.pathname !== '/postgres' || pooler.password) fail('Unexpected pooler target');

  const password = process.env.SUPABASE_DB_PASSWORD_DEV;
  const bootstrapUserId = (process.env.SUPABASE_DEV_BOOTSTRAP_USER_ID || '').trim();
  const bootstrapEmail = (process.env.SUPABASE_DEV_BOOTSTRAP_EMAIL || '').trim();
  const bootstrapOperationId = (process.env.SUPABASE_DEV_BOOTSTRAP_OPERATION_ID || '').trim();
  if (!password) fail('SUPABASE_DB_PASSWORD_DEV is unavailable');
  validateBootstrapIdentity(bootstrapUserId, bootstrapEmail, bootstrapOperationId);

  const migrationPath = path.join(repoRoot, 'supabase', 'migrations', MIGRATION_FILE);
  const originalSql = fs.readFileSync(migrationPath, 'utf8');
  if (sha256(originalSql) !== MIGRATION_SHA256) fail('Migration 09 SHA-256 mismatch');
  const originalBody = unwrapTransaction(originalSql);
  const recoveryBody = applyDevelopmentBootstrap(
    originalBody,
    bootstrapUserId,
    bootstrapEmail,
    bootstrapOperationId,
  );

  console.log('Local identity and Migration 09 checksum gate: PASS');
  console.log(`Project: ${DEVELOPMENT_NAME}`);
  console.log(`Project ref: ${DEVELOPMENT_REF}`);
  console.log(`Target host: ${pooler.hostname}:${pooler.port || '5432'}`);
  console.log(`Original Migration 09 SHA-256: ${MIGRATION_SHA256}`);
  console.log(`Development recovery body SHA-256: ${sha256(recoveryBody)}`);

  return {
    password,
    bootstrapUserId,
    bootstrapEmail,
    bootstrapOperationId,
    recoveryBody,
    connection: {
      host: pooler.hostname,
      port: Number(pooler.port || 5432),
      database: 'postgres',
      user,
      password,
      ssl: { rejectUnauthorized: false },
      application_name: 'cms-development-recovery-migration-09',
    },
  };
}

async function databasePreflight(client, bootstrapUserId, bootstrapEmail) {
  const result = await client.query(`
    select
      current_database() as current_database,
      current_user as current_user,
      (select count(*)::integer from public.organizations where is_default) as default_organization_count,
      coalesce((select json_agg(name order by name) from unnest($1::text[]) name
        where to_regclass('public.'||quote_ident(name)) is null),'[]'::json) as missing_stage_05_08_tables,
      coalesce((select json_agg(name order by name) from unnest($2::text[]) name
        where to_regclass('public.'||quote_ident(name)) is not null),'[]'::json) as existing_migration_09_tables,
      exists(select 1 from information_schema.columns where table_schema='public'
        and table_name='organization_members' and column_name='role') as role_column_present,
      exists(select 1 from auth.users users
        join public.system_user_access access on access.user_id=users.id
        join public.system_user_roles roles on roles.user_id=users.id
        where users.id=$3::uuid and lower(users.email)=lower($4)
          and access.account_status='approved' and roles.role='system_owner') as bootstrap_ready,
      (select count(*)::integer from pg_proc proc join pg_namespace ns on ns.oid=proc.pronamespace
        where ns.nspname='public' and proc.proname=any($5::text[])) as migration_09_function_count,
      (select count(*)::integer from pg_trigger where not tgisinternal
        and tgname=any($6::text[])) as migration_09_trigger_count
  `, [REQUIRED_STAGE_05_08_TABLES, MIGRATION_09_TABLES, bootstrapUserId,
    bootstrapEmail, MIGRATION_09_FUNCTIONS, MIGRATION_09_TRIGGERS]);
  const row = result.rows[0];
  console.log(`Database preflight (read-only): ${JSON.stringify(row)}`);
  if (row.current_database !== 'postgres' || row.current_user !== 'postgres') fail('Database identity gate failed');
  if (row.default_organization_count !== 1) fail('Default Organization count must equal one');
  if (row.missing_stage_05_08_tables.length) fail('Stage 05-08 prerequisite is incomplete');
  if (row.existing_migration_09_tables.length || row.role_column_present
    || row.migration_09_function_count !== 0 || row.migration_09_trigger_count !== 0) {
    fail('Migration 09 state is not clean');
  }
  if (!row.bootstrap_ready) fail('Development bootstrap prerequisite is not ready');
  console.log('Stage 05-08 gate: PASS');
  console.log('Migration 09 clean-state gate: PASS');
  console.log('Development bootstrap prerequisite: PASS');
}

async function runRecovery(client, sql) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
      console.error('Migration 09 transaction rolled back: CONFIRMED');
    } catch {
      console.error('Migration 09 rollback confirmation: FAILED');
    }
    throw error;
  }
  console.log('Migration 09 committed');
}

async function verification(client, bootstrapUserId, bootstrapOperationId) {
  const result = await client.query(`
    select json_build_object(
      'role_column_present', exists(select 1 from information_schema.columns
        where table_schema='public' and table_name='organization_members' and column_name='role'),
      'required_tables', (select json_agg(x order by position) from (
        select name,position,to_regclass('public.'||quote_ident(name)) is not null as exists
        from unnest($1::text[]) with ordinality item(name,position)) x),
      'rls', (select coalesce(json_agg(x order by table_name),'[]'::json) from (
        select cls.relname table_name,cls.relrowsecurity enabled,cls.relforcerowsecurity forced
        from pg_class cls join pg_namespace ns on ns.oid=cls.relnamespace
        where ns.nspname='public' and cls.relname=any($1::text[])) x),
      'functions', (select coalesce(json_agg(x order by name,identity_arguments),'[]'::json) from (
        select proc.proname name,pg_get_function_identity_arguments(proc.oid) identity_arguments,
          proc.prosecdef security_definer,proc.provolatile::text volatility
        from pg_proc proc join pg_namespace ns on ns.oid=proc.pronamespace
        where ns.nspname='public' and proc.proname=any($2::text[])) x),
      'triggers', (select coalesce(json_agg(x order by name),'[]'::json) from (
        select trg.tgname name,pg_get_triggerdef(trg.oid,false) definition
        from pg_trigger trg where not trg.tgisinternal and trg.tgname=any($3::text[])) x),
      'organization_owner_link', exists(select 1 from public.organization_members members
        join public.organizations organizations on organizations.id=members.organization_id
        where organizations.is_default and members.user_id=$4::uuid
          and members.role='organization_owner'),
      'bootstrap_audit', exists(select 1 from public.organization_membership_audit_log audit
        join public.organizations organizations on organizations.id=audit.organization_id
        where organizations.is_default and audit.target_user_id_snapshot=$4::uuid
          and audit.action='bootstrap_organization_owner'
          and audit.operation_id=$5::uuid
          and audit.metadata->>'source'='development_bootstrap')
    ) as report
  `, [MIGRATION_09_TABLES, MIGRATION_09_FUNCTIONS, MIGRATION_09_TRIGGERS,
    bootstrapUserId, bootstrapOperationId]);
  const report = result.rows[0].report;
  console.log(`Verification (read-only):\n${JSON.stringify(report, null, 2)}`);
  if (!report.role_column_present || report.required_tables.some((item) => !item.exists)
    || report.rls.some((item) => !item.enabled) || !report.organization_owner_link
    || !report.bootstrap_audit) fail('Migration 09 verification failed');
}

async function main() {
  const preflight = localPreflight(path.resolve(__dirname, '..'));
  const moduleRoot = process.env.CMS_MIGRATION_RUNNER_MODULES;
  if (!moduleRoot || !path.isAbsolute(moduleRoot)) fail('CMS_MIGRATION_RUNNER_MODULES must be absolute');
  const { Client } = require(path.join(moduleRoot, 'pg'));
  const client = new Client(preflight.connection);
  try {
    await client.connect();
    await databasePreflight(client, preflight.bootstrapUserId, preflight.bootstrapEmail);
    await runRecovery(client, preflight.recoveryBody);
    await verification(client, preflight.bootstrapUserId, preflight.bootstrapOperationId);
    console.log('Migration 09 recovery complete. Migration 10 was not executed.');
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
