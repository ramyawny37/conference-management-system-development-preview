'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEV_REF = 'gppwltrifgfxrkzvvxoe';
const DEV_NAME = 'conference-management-system-development';
const PROD_REF = 'mpezfbvcdfxpgflehuot';
const STAGING_REF = 'zentpxnyccbkzgrkkkms';
const MIGRATION = '20260807_6_1_0_conference_role_management.sql';
const EXPECTED_SHA256 = 'f7673e73732ec42258cee1f221f14d8ea3c3f1bbb3ee0bfd1fd3189efaf81cb0';
const ROOT = path.resolve(__dirname, '..');

function fail(message) { throw new Error(message); }
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8').trim(); }
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function safeError(error, password) {
  let message = String(error && error.message || error);
  if (password) message = message.split(password).join('[REDACTED]');
  return `${message} (code=${error && error.code || 'n/a'}, position=${error && error.position || 'n/a'})`;
}
function migrationBody(sql) {
  const body = sql.replace(/^\uFEFF?\s*begin\s*;\s*/i, '').replace(/\s*commit\s*;\s*$/i, '').trim();
  if (!body || /\b(begin|commit|rollback)\s*;\s*$/i.test(body)) fail('Unexpected migration transaction envelope');
  return body;
}
function loadPg() {
  const modules = process.env.CMS_MIGRATION_RUNNER_MODULES;
  if (!modules) fail('CMS_MIGRATION_RUNNER_MODULES is required');
  const resolved = path.resolve(modules);
  const temp = path.resolve(process.env.TEMP || process.env.TMP || '');
  if (!temp || !(resolved === temp || resolved.startsWith(`${temp}${path.sep}`))) fail('pg modules must be loaded from TEMP');
  return require(path.join(resolved, 'pg'));
}
function localPreflight() {
  const password = process.env.SUPABASE_DB_PASSWORD_DEV;
  if (!password) fail('SUPABASE_DB_PASSWORD_DEV is unavailable in this process');
  const linkedRef = read('supabase/.temp/project-ref');
  const linked = JSON.parse(read('supabase/.temp/linked-project.json'));
  const pooler = new URL(read('supabase/.temp/pooler-url'));
  const linkedProjectRef = linked.ref;
  const databaseUser = decodeURIComponent(pooler.username);
  const diagnostic = () => console.error([
    'Development identity diagnostic:',
    `detected project ref=${linkedProjectRef || linkedRef || '[missing]'}`,
    `detected project name=${linked.name || '[missing]'}`,
    `detected database user=${databaseUser || '[missing]'}`,
    `detected host=${pooler.hostname || '[missing]'}`,
  ].join('\n'));
  const combined = `${linkedRef} ${linkedProjectRef || ''} ${linked.name || ''} ${pooler.hostname} ${databaseUser}`;
  if (combined.includes(PROD_REF) || combined.includes(STAGING_REF)) {
    diagnostic();
    fail('Production/Staging target rejected');
  }
  if (linkedRef !== DEV_REF || linkedProjectRef !== DEV_REF || linked.name !== DEV_NAME) {
    diagnostic();
    fail('Development project identity mismatch');
  }
  if (databaseUser !== `postgres.${DEV_REF}` || !pooler.hostname || pooler.pathname !== '/postgres') {
    diagnostic();
    fail('Development database connection identity mismatch');
  }
  if (pooler.password) fail('Stored password in pooler URL is forbidden');
  const file = path.join(ROOT, 'supabase', 'migrations', MIGRATION);
  const sql = fs.readFileSync(file, 'utf8');
  const actual = sha256(sql);
  if (actual !== EXPECTED_SHA256) fail(`Migration SHA-256 mismatch: ${actual}`);
  return { password, pooler, sql };
}
async function query(client, label, text, values = []) {
  try { return await client.query(text, values); }
  catch (error) { error.sqlLabel = label; throw error; }
}
async function expectError(client, label, text, values, pattern) {
  await query(client, `${label}_savepoint`, `savepoint ${label}`);
  try {
    await query(client, label, text, values);
    fail(`${label}: expected rejection was not raised`);
  } catch (error) {
    await client.query(`rollback to savepoint ${label}`);
    await client.query(`release savepoint ${label}`);
    if (error.message.startsWith(`${label}: expected`)) throw error;
    if (pattern && !pattern.test(error.message)) fail(`${label}: unexpected rejection: ${error.message}`);
  }
}
function assertResult(result, status, label) {
  const value = result.rows[0].result;
  if (!value || value.status !== status) fail(`${label}: expected status=${status}, received=${value && value.status}`);
  return value;
}

async function preflight(client, verificationOnly) {
  const identity = (await query(client, 'database_identity', `select current_database() database_name,current_user database_user`)).rows[0];
  if (identity.database_name !== 'postgres' || identity.database_user !== 'postgres') fail('Database SQL identity mismatch');
  const requiredTables = ['conferences','conference_members','conference_membership_operations','conference_locks','devices','user_device_authorizations','sync_operations','sync_conflicts','conference_snapshots','conference_creation_operations','organizations','organization_members','system_user_access','system_user_roles'];
  const tables = await query(client, 'migration_01_19_tables', `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and relname=any($1::text[])`, [requiredTables]);
  const present = new Set(tables.rows.map(row => row.relname));
  const missing = requiredTables.filter(name => !present.has(name));
  if (missing.length) fail(`Migration 01-19 prerequisite tables missing: ${missing.join(', ')}`);
  const requiredFunctions = ['public.is_conference_owner(uuid)','public.require_current_approved_device(uuid)','public.add_conference_manager(uuid,uuid,uuid)','public.remove_conference_manager(uuid,uuid,uuid)','public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)','public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)','public.acquire_conference_section_lock(uuid,text,uuid,uuid,integer)'];
  const functions = await query(client, 'migration_01_19_functions', `select value,to_regprocedure(value) oid from unnest($1::text[]) value`, [requiredFunctions]);
  const absentFunctions = functions.rows.filter(row => !row.oid).map(row => row.value);
  if (absentFunctions.length) fail(`Migration 01-19 prerequisite functions missing: ${absentFunctions.join(', ')}`);
  const stage = await query(client, 'migration_6_1_absent', `select
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='conference_membership_operations' and column_name=any(array['requested_role','previous_role','stored_result'])) column_count,
    to_regprocedure('public.manage_conference_member(uuid,uuid,uuid,text,text)') is not null manage_exists,
    to_regprocedure('public.device_guarded_manage_conference_member(uuid,uuid,uuid,uuid,text,text)') is not null guarded_exists`);
  const state = stage.rows[0];
  const fullyApplied = state.column_count === 3 && state.manage_exists && state.guarded_exists;
  const fullyAbsent = state.column_count === 0 && !state.manage_exists && !state.guarded_exists;
  if (verificationOnly && !fullyApplied) fail('Verification-only requires Migration 6.1.0 to be fully applied');
  if (!verificationOnly && !fullyAbsent) fail('Migration 6.1.0 is already or partially applied');
  if (verificationOnly) {
    const artifacts = await query(client, 'verification_artifact_check', `select
      (select count(*)::int from auth.users where email like 'cms-role-verification-%@example.invalid') test_users,
      (select count(*)::int from public.conferences where name='Development role verification') test_conferences,
      (select count(*)::int from public.conference_membership_operations operations
        join auth.users users on users.id=operations.target_user_id
       where users.email like 'cms-role-verification-%@example.invalid') test_operations`);
    const counts = artifacts.rows[0];
    if (counts.test_users || counts.test_conferences || counts.test_operations) {
      fail(`Verification artifacts detected: users=${counts.test_users}, conferences=${counts.test_conferences}, operations=${counts.test_operations}`);
    }
  }
  const actor = await query(client, 'approved_development_actor', `select u.id user_id,a.device_id,m.organization_id
    from auth.users u join public.system_user_roles r on r.user_id=u.id and r.role='system_owner'
    join public.system_user_access s on s.user_id=u.id and s.account_status='approved'
    join public.user_device_authorizations a on a.user_id=u.id and a.authorization_status='approved' and a.revoked_at is null
    join public.organization_members m on m.user_id=u.id and m.role='organization_owner'
    order by u.created_at,u.id::text limit 1`);
  if (actor.rowCount !== 1) fail('Exactly one usable Development system-owner actor was not found');
  return actor.rows[0];
}

async function verifyDefinitions(client) {
  const result = await query(client, 'migration_definition_verification', `select
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='conference_membership_operations' and column_name=any(array['requested_role','previous_role','stored_result'])) columns_added,
    (select count(*)::int from pg_constraint constraints join pg_class tables on tables.oid=constraints.conrelid join pg_namespace schemas on schemas.oid=tables.relnamespace
      where schemas.nspname='public' and tables.relname='conference_membership_operations'
        and constraints.conname=any(array['conference_membership_operations_operation_type_check','conference_membership_operations_requested_role_check','conference_membership_operations_previous_role_check','conference_membership_operations_resulting_role_check','conference_membership_operations_result_status_check','conference_membership_operations_stored_result_check','conference_membership_operations_general_intent_check'])) constraints_present,
    to_regprocedure('public.manage_conference_member(uuid,uuid,uuid,text,text)') is not null manage_exists,
    to_regprocedure('public.device_guarded_manage_conference_member(uuid,uuid,uuid,uuid,text,text)') is not null guarded_exists,
    to_regprocedure('public.add_conference_manager(uuid,uuid,uuid)') is not null legacy_add_exists,
    to_regprocedure('public.remove_conference_manager(uuid,uuid,uuid)') is not null legacy_remove_exists,
    to_regprocedure('public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)') is not null guarded_legacy_add_exists,
    to_regprocedure('public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)') is not null guarded_legacy_remove_exists,
    has_function_privilege('authenticated','public.manage_conference_member(uuid,uuid,uuid,text,text)','execute') authenticated_execute,
    not has_function_privilege('anon','public.manage_conference_member(uuid,uuid,uuid,text,text)','execute') anon_denied`);
  const row = result.rows[0];
  if (row.columns_added !== 3 || row.constraints_present !== 7 || !row.manage_exists || !row.guarded_exists
    || !row.legacy_add_exists || !row.legacy_remove_exists || !row.guarded_legacy_add_exists
    || !row.guarded_legacy_remove_exists || !row.authenticated_execute || !row.anon_denied) {
    fail('Post-migration definition verification failed');
  }
}

async function runtimeVerification(client, actor) {
  const ids = Array.from({length: 22}, () => crypto.randomUUID());
  const [conferenceId, ...rest] = ids;
  const targets = rest.slice(0, 7);
  const operations = rest.slice(7);
  await query(client, 'verification_begin', 'begin');
  try {
    for (let index = 0; index < targets.length; index += 1) {
      await query(client, `create_synthetic_user_${index}`, `insert into auth.users
        (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
        values($1,'authenticated','authenticated',$2,crypt(gen_random_uuid()::text,gen_salt('bf')),now(),'{}','{}',now(),now())`,
        [targets[index], `cms-role-verification-${targets[index]}@example.invalid`]);
    }
    await query(client, 'create_verification_conference', `insert into public.conferences(id,name,owner_id,organization_id) values($1,'Development role verification',$2,$3)`, [conferenceId, actor.user_id, actor.organization_id]);
    await query(client, 'set_authenticated_actor', `select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)`, [actor.user_id]);
    await query(client, 'assume_authenticated_role', 'set local role authenticated');
    const roles = ['manager','viewer','accommodation_viewer','transport_viewer'];
    for (let index = 0; index < roles.length; index += 1) {
      const added = await query(client, `add_${roles[index]}`, `select public.manage_conference_member($1,$2,$3,'add',$4) result`, [conferenceId, targets[index], operations[index], roles[index]]);
      assertResult(added, 'added', `add_${roles[index]}`);
    }
    const replay = assertResult(await query(client, 'idempotent_replay', `select public.manage_conference_member($1,$2,$3,'add','manager') result`, [conferenceId, targets[0], operations[0]]), 'added', 'idempotent_replay');
    if (replay.replayed !== true) fail('idempotent_replay: replay flag missing');
    await expectError(client, 'intent_mismatch', `select public.manage_conference_member($1,$2,$3,'remove',null)`, [conferenceId, targets[0], operations[0]], /another operation/i);
    await expectError(client, 'owner_protection', `select public.manage_conference_member($1,$2,$3,'change_role','viewer')`, [conferenceId, actor.user_id, operations[4]], /owner membership cannot be managed/i);
    assertResult(await query(client, 'guarded_manage', `select public.device_guarded_manage_conference_member($1,$2,$3,$4,'change_role','manager') result`, [actor.device_id, conferenceId, targets[1], operations[5]]), 'role_changed', 'guarded_manage');
    await expectError(client, 'guarded_device_requirement', `select public.device_guarded_manage_conference_member($1,$2,$3,$4,'change_role','viewer')`, [crypto.randomUUID(), conferenceId, targets[1], operations[6]], /DEVICE|device|approved/);
    assertResult(await query(client, 'change_role_for_cleanup', `select public.manage_conference_member($1,$2,$3,'change_role','manager') result`, [conferenceId, targets[2], operations[7]]), 'role_changed', 'change_role_for_cleanup');
    await query(client, 'return_to_postgres_for_lock_fixture', 'reset role');
    await query(client, 'create_lock_fixture', `insert into public.conference_locks(conference_id,section,user_id,device_id,lock_token,acquired_at,expires_at,last_renewed_at,created_at)
      values($1,'verification',$2,$3,$4,now(),now()+interval '2 minutes',now(),now())`, [conferenceId, targets[2], actor.device_id, crypto.randomUUID()]);
    await query(client, 'restore_authenticated_role', 'set local role authenticated');
    assertResult(await query(client, 'change_role_cleanup', `select public.manage_conference_member($1,$2,$3,'change_role','viewer') result`, [conferenceId, targets[2], operations[8]]), 'role_changed', 'change_role_cleanup');
    await query(client, 'admin_context_for_lock_verification', 'reset role');
    const lockCount = await query(client, 'verify_lock_cleanup', `select count(*)::int count from public.conference_locks where conference_id=$1 and user_id=$2`, [conferenceId, targets[2]]);
    if (lockCount.rows[0].count !== 0) fail('Manager lock cleanup failed');
    await query(client, 'restore_authenticated_after_lock_verification', 'set local role authenticated');
    assertResult(await query(client, 'remove_member', `select public.manage_conference_member($1,$2,$3,'remove',null) result`, [conferenceId, targets[3], operations[9]]), 'removed', 'remove_member');
    assertResult(await query(client, 'legacy_add_manager', `select public.add_conference_manager($1,$2,$3) result`, [conferenceId, targets[4], operations[10]]), 'added', 'legacy_add_manager');
    assertResult(await query(client, 'legacy_remove_manager', `select public.remove_conference_manager($1,$2,$3) result`, [conferenceId, targets[4], operations[11]]), 'removed', 'legacy_remove_manager');
    await query(client, 'verification_rollback', 'rollback');
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  }
}

async function main() {
  const local = localPreflight();
  const verificationOnly = process.env.CMS_ROLE_MANAGEMENT_VERIFICATION_ONLY === '1';
  const { Client } = loadPg();
  const client = new Client({host:local.pooler.hostname,port:Number(local.pooler.port || 5432),database:'postgres',user:`postgres.${DEV_REF}`,password:local.password,ssl:{rejectUnauthorized:false},application_name:'cms-development-role-management-6-1-runner'});
  try {
    await client.connect();
    const actor = await preflight(client, verificationOnly);
    console.log('Identity/preflight: PASS');
    if (!verificationOnly) {
      await query(client, 'migration_begin', 'begin');
      try {
        await query(client, 'apply_conference_role_management_6_1_0', migrationBody(local.sql));
        await query(client, 'migration_commit', 'commit');
      } catch (error) {
        try { await client.query('rollback'); } catch (_) {}
        throw error;
      }
      console.log('Migration 6.1.0 apply: PASS');
    } else {
      console.log('Migration 6.1.0 current state: APPLIED');
      console.log('Verification artifacts before retry: NONE');
    }
    await verifyDefinitions(client);
    await runtimeVerification(client, actor);
    await verifyDefinitions(client);
    console.log('Runtime verification (rolled back): PASS');
    console.log('Development database state: Migration 6.1.0 committed; verification fixtures absent');
  } catch (error) {
    console.error(`Development role management runner: FAIL stage=${error.sqlLabel || 'local_or_connection'} ${safeError(error, local && local.password)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
