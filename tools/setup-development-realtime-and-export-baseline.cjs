'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEV_REF = 'gppwltrifgfxrkzvvxoe';
const DEV_NAME = 'conference-management-system-development';
const PROD_REF = 'mpezfbvcdfxpgflehuot';
const STAGE_REF = 'zentpxnyccbkzgrkkkms';

function fail(message) {
  throw new Error(message);
}

function safeError(error, password) {
  let message = error instanceof Error ? error.message : String(error);
  if (password) message = message.split(password).join('[REDACTED]');
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_DATABASE_URL]');
}

function preflight(repoRoot) {
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
  if (!password) fail('SUPABASE_DB_PASSWORD_DEV is unavailable');
  console.log('Development identity gate: PASS');
  return {
    password,
    connection: {
      host: pool.hostname,
      port: Number(pool.port || 5432),
      database: 'postgres',
      user,
      password,
      ssl: { rejectUnauthorized: false },
      application_name: 'cms-development-realtime-environment-setup',
    },
  };
}

async function realtimeSetup(client) {
  const before = await client.query(`
    select current_database() as current_database, current_user as current_user,
      exists(select 1 from pg_publication where pubname='supabase_realtime') as publication_exists,
      to_regclass('public.conference_snapshots') is not null as table_exists,
      exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
        and schemaname='public' and tablename='conference_snapshots') as member
  `);
  const state = before.rows[0];
  console.log(`Realtime preflight (read-only): ${JSON.stringify(state)}`);
  if (state.current_database !== 'postgres' || state.current_user !== 'postgres') fail('Database identity SQL gate failed');
  if (!state.publication_exists || !state.table_exists) fail('Realtime publication or target table is missing');
  if (state.member) fail('conference_snapshots is already a realtime member; refusing ALTER');

  await client.query('BEGIN');
  try {
    await client.query('ALTER PUBLICATION supabase_realtime ADD TABLE public.conference_snapshots');
    const inside = await client.query(`
      select exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
        and schemaname='public' and tablename='conference_snapshots') as member
    `);
    if (!inside.rows[0].member) fail('Realtime membership verification failed inside transaction');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  const after = await client.query(`
    select exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='conference_snapshots') as conference_snapshots_realtime
  `);
  if (!after.rows[0].conference_snapshots_realtime) fail('Post-commit realtime verification failed');
  console.log('conference_snapshots_realtime=true');
}

async function exportBaseline(client, repoRoot) {
  const queries = {
    columns: `select table_name,column_name,ordinal_position,data_type,udt_schema,udt_name,
      is_nullable,column_default from information_schema.columns
      where table_schema='public' order by table_name,ordinal_position`,
    constraints: `select cls.relname table_name,con.conname constraint_name,con.contype::text constraint_type,
      pg_get_constraintdef(con.oid,false) definition,con.condeferrable,con.condeferred,con.convalidated
      from pg_constraint con join pg_class cls on cls.oid=con.conrelid
      join pg_namespace ns on ns.oid=cls.relnamespace where ns.nspname='public'
      order by cls.relname,con.conname`,
    indexes: `select tablename table_name,indexname index_name,indexdef definition
      from pg_indexes where schemaname='public' order by tablename,indexname`,
    functions: `select proc.proname function_name,pg_get_function_identity_arguments(proc.oid) identity_arguments,
      pg_get_function_result(proc.oid) result_type,proc.prosecdef security_definer,
      proc.provolatile::text volatility,proc.proconfig config,
      encode(extensions.digest(convert_to(pg_get_functiondef(proc.oid),'UTF8'),'sha256'),'hex') definition_sha256
      from pg_proc proc join pg_namespace ns on ns.oid=proc.pronamespace
      where ns.nspname='public' order by proc.proname,identity_arguments`,
    triggers: `select cls.relname table_name,trg.tgname trigger_name,trg.tgenabled::text enabled,
      pg_get_triggerdef(trg.oid,false) definition from pg_trigger trg
      join pg_class cls on cls.oid=trg.tgrelid join pg_namespace ns on ns.oid=cls.relnamespace
      where ns.nspname='public' and not trg.tgisinternal order by cls.relname,trg.tgname`,
    rls: `select relname table_name,relrowsecurity enabled,relforcerowsecurity forced
      from pg_class where relnamespace='public'::regnamespace and relkind in('r','p') order by relname`,
    policies: `select tablename table_name,policyname policy_name,permissive,roles,cmd,qual,with_check
      from pg_policies where schemaname='public' order by tablename,policyname`,
    table_grants: `select table_name,grantor,grantee,privilege_type,is_grantable
      from information_schema.table_privileges where table_schema='public'
      order by table_name,grantee,privilege_type,grantor`,
    function_grants: `select proc.proname function_name,
      pg_get_function_identity_arguments(proc.oid) identity_arguments,
      case acl.grantor when 0 then 'PUBLIC' else pg_get_userbyid(acl.grantor) end grantor,
      case acl.grantee when 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end grantee,
      acl.privilege_type,acl.is_grantable
      from pg_proc proc join pg_namespace ns on ns.oid=proc.pronamespace
      cross join lateral aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl
      where ns.nspname='public' and acl.privilege_type='EXECUTE'
      order by proc.proname,identity_arguments,grantee,grantor`,
    realtime: `select pubname,schemaname,tablename from pg_publication_tables
      where pubname='supabase_realtime' order by schemaname,tablename`,
  };
  const artifact = { artifact_format: 'development-final-schema-baseline-v1', project_ref: DEV_REF };
  for (const [name, sql] of Object.entries(queries)) artifact[name] = (await client.query(sql)).rows;
  const auditDir = path.join(repoRoot, '.audit');
  fs.mkdirSync(auditDir, { recursive: true });
  const output = path.join(auditDir, 'development-final-baseline.json');
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Development baseline artifact: ${output}`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const state = preflight(repoRoot);
  const modules = process.env.CMS_MIGRATION_RUNNER_MODULES;
  if (!modules || !path.isAbsolute(modules)) fail('CMS_MIGRATION_RUNNER_MODULES must be absolute');
  const { Client } = require(path.join(modules, 'pg'));
  const client = new Client(state.connection);
  try {
    await client.connect();
    await realtimeSetup(client);
    await exportBaseline(client, repoRoot);
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
