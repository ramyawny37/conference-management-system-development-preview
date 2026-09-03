'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DEV_REF = 'gppwltrifgfxrkzvvxoe';
const DEV_NAME = 'conference-management-system-development';
const PROD_REF = 'mpezfbvcdfxpgflehuot';
const STAGING_REF = 'zentpxnyccbkzgrkkkms';
const DEV_URL = `https://${DEV_REF}.supabase.co`;
const DEV_PUBLIC_KEY = 'sb_publishable_Ibnpk0i0faZMUCoFOr8MTQ_G-iujGEp';

function fail(message) { throw new Error(message); }
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8').trim(); }
function loadPg() {
  const modules = path.resolve(process.env.CMS_MIGRATION_RUNNER_MODULES || '');
  const temp = path.resolve(process.env.TEMP || process.env.TMP || '');
  if (!modules || !temp || !modules.startsWith(temp + path.sep)) fail('pg modules must be loaded from TEMP');
  return require(path.join(modules, 'pg'));
}
function localPreflight() {
  const password = process.env.SUPABASE_DB_PASSWORD_DEV;
  if (!password) fail('Development database password is unavailable');
  const ref = read('supabase/.temp/project-ref');
  const linked = JSON.parse(read('supabase/.temp/linked-project.json'));
  const pooler = new URL(read('supabase/.temp/pooler-url'));
  const user = decodeURIComponent(pooler.username);
  const combined = [ref, linked.ref, linked.name, pooler.hostname, user].join(' ');
  if (combined.includes(PROD_REF) || combined.includes(STAGING_REF)) fail('Production/Staging target rejected');
  if (ref !== DEV_REF || linked.ref !== DEV_REF || linked.name !== DEV_NAME || user !== `postgres.${DEV_REF}` || pooler.pathname !== '/postgres') {
    fail('Development identity mismatch');
  }
  return { password, pooler };
}
async function q(client, label, sql, values = []) {
  try { return await client.query(sql, values); }
  catch (error) { error.sqlLabel = label; throw error; }
}
async function auth(pathname, body, accessToken) {
  const response = await fetch(`${DEV_URL}${pathname}`, {
    method: 'POST',
    headers: {
      apikey: DEV_PUBLIC_KEY,
      authorization: `Bearer ${accessToken || DEV_PUBLIC_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) fail(`Development Auth request failed (${response.status}): ${payload.msg || payload.message || payload.error_description || 'unknown error'}`);
  return payload;
}
async function rpc(name, body, token) {
  const response = await fetch(`${DEV_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: {apikey: DEV_PUBLIC_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) fail(`Development RPC ${name} failed (${response.status}): ${payload.message || payload.code || 'unknown error'}`);
  return payload;
}
async function asActor(client, actorId, label, sql, values) {
  await q(client, `${label}_begin`, 'begin');
  try {
    await q(client, `${label}_claims`, `select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)`, [actorId]);
    await q(client, `${label}_role`, 'set local role authenticated');
    const result = await q(client, label, sql, values);
    await q(client, `${label}_commit`, 'commit');
    return result.rows[0] && result.rows[0].result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}
async function counts(client, userId) {
  return (await q(client, 'layer_state', `select
    (select account_status from public.system_user_access where user_id=$1) account_status,
    (select can_create_conferences from public.system_user_access where user_id=$1) can_create,
    (select count(*)::int from public.organization_members where user_id=$1) organizations,
    (select count(*)::int from public.conference_members where user_id=$1) conferences,
    (select count(*)::int from public.devices where user_id=$1) devices,
    (select count(*)::int from public.user_device_authorizations where user_id=$1 and authorization_status='pending') pending_devices,
    (select count(*)::int from public.user_device_authorizations where user_id=$1 and authorization_status='approved' and revoked_at is null) approved_devices`, [userId])).rows[0];
}
function assertState(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) if (actual[key] !== value) fail(`${label}: ${key} expected ${value}, received ${actual[key]}`);
  console.log(`${label}: PASS`);
}

async function main() {
  const local = localPreflight();
  const { Client } = loadPg();
  const client = new Client({host: local.pooler.hostname, port: Number(local.pooler.port || 5432), database: 'postgres', user: `postgres.${DEV_REF}`, password: local.password, ssl: {rejectUnauthorized: false}, application_name: 'cms-development-onboarding-e2e'});
  const testId = crypto.randomUUID();
  let email = `dev-onboarding-${testId.replace(/-/g,'')}@outlook.com`;
  const password = `${crypto.randomBytes(24).toString('base64url')}!Aa7`;
  let deviceId = crypto.randomUUID();
  try {
    await client.connect();
    const identity = (await q(client, 'database_identity', `select current_database() database_name,current_user database_user`)).rows[0];
    if (identity.database_name !== 'postgres' || identity.database_user !== 'postgres') fail('Development SQL identity mismatch');
    console.log('Development identity gate: PASS');

    const systemActor = (await q(client, 'system_actor', `select u.id user_id,a.device_id
      from auth.users u
      join public.system_user_roles r on r.user_id=u.id and r.role='system_owner'
      join public.system_user_access s on s.user_id=u.id and s.account_status='approved'
      join public.user_device_authorizations a on a.user_id=u.id and a.authorization_status='approved' and a.revoked_at is null
      order by u.created_at,a.approved_at nulls last limit 1`)).rows[0];
    const organizationActor = (await q(client, 'organization_actor', `select m.user_id,a.device_id,m.organization_id
      from public.organization_members m
      join public.system_user_access s on s.user_id=m.user_id and s.account_status='approved'
      join public.user_device_authorizations a on a.user_id=m.user_id and a.authorization_status='approved' and a.revoked_at is null
      where m.role='organization_owner' order by m.created_at,a.approved_at nulls last limit 1`)).rows[0];
    let conferenceActor = organizationActor && (await q(client, 'conference_actor', `select c.owner_id user_id,a.device_id,c.id conference_id
      from public.conferences c
      join public.system_user_access s on s.user_id=c.owner_id and s.account_status='approved'
      join public.user_device_authorizations a on a.user_id=c.owner_id and a.authorization_status='approved' and a.revoked_at is null
      where c.organization_id=$1 and c.deleted_at is null order by c.created_at,a.approved_at nulls last limit 1`, [organizationActor.organization_id])).rows[0];
    if (!systemActor || !organizationActor) fail(`Development prerequisite missing: systemActor=${!!systemActor}, organizationActor=${!!organizationActor}`);
    if (!conferenceActor) {
      const conferenceId = crypto.randomUUID();
      await q(client, 'fixture_conference_begin', 'begin');
      try {
        await q(client, 'create_development_conference_fixture', `insert into public.conferences(id,name,owner_id,organization_id)
          values($1,'Development Onboarding Conference',$2,$3)`, [conferenceId,organizationActor.user_id,organizationActor.organization_id]);
        const ownerMembership = await q(client, 'verify_fixture_owner_membership', `select count(*)::int count from public.conference_members where conference_id=$1 and user_id=$2 and role='owner'`, [conferenceId,organizationActor.user_id]);
        if (ownerMembership.rows[0].count !== 1) fail('Development conference fixture owner membership missing');
        await q(client, 'fixture_conference_commit', 'commit');
      } catch (error) { await client.query('rollback').catch(()=>{}); throw error; }
      conferenceActor={user_id:organizationActor.user_id,device_id:organizationActor.device_id,conference_id:conferenceId};
      console.log('Development conference prerequisite fixture: CREATED');
    }

    const priorTestAccounts = await q(client, 'prior_test_accounts', `select id,email,email_confirmed_at is not null confirmed
      from auth.users where email like 'dev-onboarding-%@outlook.com' order by created_at`);
    if (priorTestAccounts.rowCount > 1) fail('More than one Development onboarding test account exists');
    let userId;
    let recoveredSignup = false;
    let resumedAfterApproval = false;
    let resumedAfterOrganization = false;
    let resumedAfterConference = false;
    let resumedAfterRegistration = false;
    if (priorTestAccounts.rowCount === 1) {
      userId=priorTestAccounts.rows[0].id;
      email=priorTestAccounts.rows[0].email;
      const recoveredState=await counts(client,userId);
      resumedAfterApproval=priorTestAccounts.rows[0].confirmed&&recoveredState.account_status==='approved';
      resumedAfterOrganization=resumedAfterApproval&&recoveredState.organizations===1;
      resumedAfterConference=resumedAfterOrganization&&recoveredState.conferences===1;
      resumedAfterRegistration=resumedAfterConference&&recoveredState.devices===1&&recoveredState.pending_devices===0&&recoveredState.approved_devices===0;
      assertState(recoveredState,{account_status:resumedAfterApproval?'approved':'pending',can_create:false,organizations:resumedAfterOrganization?1:0,conferences:resumedAfterConference?1:0,devices:resumedAfterRegistration?1:0,pending_devices:0,approved_devices:0},'Interrupted Sign Up recovery preflight');
      if (resumedAfterRegistration) deviceId=(await q(client,'recover_registered_device',`select id from public.devices where user_id=$1`,[userId])).rows[0].id;
      recoveredSignup=true;
    } else {
      const signup = await auth('/auth/v1/signup', {email, password, data: {display_name: 'Development Onboarding Test'}});
      userId = signup.user && signup.user.id;
      if (!userId || signup.access_token) fail(`Sign Up state mismatch: user=${!!userId}, session=${!!signup.access_token}, identities=${signup.user&&Array.isArray(signup.user.identities)?signup.user.identities.length:'n/a'}`);
    }
    console.log(`Test account email: ${email}`);
    console.log('New Device / Sign Up: PASS');

    if (!resumedAfterApproval) assertState(await counts(client, userId), {account_status:'pending', can_create:false, organizations:0, conferences:0, devices:0, pending_devices:0, approved_devices:0}, 'Post-signup layer separation');
    const confirmColumns = await q(client, 'confirmation_column', `select is_generated from information_schema.columns where table_schema='auth' and table_name='users' and column_name='email_confirmed_at'`);
    if (confirmColumns.rowCount !== 1 || confirmColumns.rows[0].is_generated !== 'NEVER') fail('Unsupported auth.users confirmation schema');
    await q(client, 'email_confirmation_begin', 'begin');
    try {
      const confirmed = await q(client, 'confirm_exact_test_email', `update auth.users set email_confirmed_at=coalesce(email_confirmed_at,now()),confirmation_token='',
        encrypted_password=case when $3 then crypt($4,gen_salt('bf')) else encrypted_password end,updated_at=now()
        where id=$1 and email=$2 and ($5 or email_confirmed_at is null) returning id`, [userId,email,recoveredSignup,password,resumedAfterApproval]);
      if (confirmed.rowCount !== 1) fail('Exact unconfirmed Development test account was not found');
      const state = await counts(client,userId);
      assertState(state,{account_status:resumedAfterApproval?'approved':'pending',can_create:false,organizations:resumedAfterOrganization?1:0,conferences:resumedAfterConference?1:0,devices:resumedAfterRegistration?1:0,pending_devices:0,approved_devices:0},'Email confirmation isolation');
      await q(client,'email_confirmation_commit','commit');
    } catch (error) { await client.query('rollback').catch(()=>{}); throw error; }
    console.log('Email Confirmed: PASS');

    const session = await auth('/auth/v1/token?grant_type=password', {email,password});
    if (!session.access_token || !session.user || session.user.id !== userId) fail('Sign In session mismatch');
    console.log('Sign In: PASS');
    if (!resumedAfterApproval) {
      const pendingAccess = await rpc('get_my_device_aware_system_access',{p_device_id:deviceId},session.access_token);
      if (pendingAccess.accountStatus !== 'pending' || pendingAccess.deviceAuthorizationStatus !== 'not_registered') fail('Pending Account Gate mismatch');
      console.log('Pending Account Gate: PASS');
      const approveResult = await asActor(client,systemActor.user_id,'approve_account',`select public.device_guarded_manage_system_user($1,$2,$3,'approve',false) result`,[systemActor.device_id,userId,crypto.randomUUID()]);
      if (!approveResult || !['approved','unchanged'].includes(approveResult.status)) fail('Account approval response mismatch');
      assertState(await counts(client,userId),{account_status:'approved',can_create:false,organizations:0,conferences:0,devices:0,pending_devices:0,approved_devices:0},'System Owner approves account');
    } else {
      console.log('Pending Account Gate: PASS (verified before resume)');
      console.log('System Owner approves account: PASS (verified before resume)');
    }

    if (!resumedAfterOrganization) {
      const orgResult = await asActor(client,organizationActor.user_id,'add_organization',`select public.device_guarded_add_organization_member($1,$2,$3,$4) result`,[organizationActor.device_id,organizationActor.organization_id,userId,crypto.randomUUID()]);
      if (!orgResult || !['applied','unchanged'].includes(orgResult.status)) fail(`Organization membership response mismatch: ${orgResult&&orgResult.status}`);
      assertState(await counts(client,userId),{account_status:'approved',can_create:false,organizations:1,conferences:0,devices:0,pending_devices:0,approved_devices:0},'Add to Organization');
    } else console.log('Add to Organization: PASS (verified after resume)');

    if (!resumedAfterConference) {
      const conferenceResult = await asActor(client,conferenceActor.user_id,'add_conference',`select public.device_guarded_manage_conference_member($1,$2,$3,$4,'add','viewer') result`,[conferenceActor.device_id,conferenceActor.conference_id,userId,crypto.randomUUID()]);
      if (!conferenceResult || !['added','unchanged'].includes(conferenceResult.status)) fail('Conference membership response mismatch');
      assertState(await counts(client,userId),{account_status:'approved',can_create:false,organizations:1,conferences:1,devices:0,pending_devices:0,approved_devices:0},'Add to Conference / Assign Role');
    } else console.log('Add to Conference / Assign Role: PASS (verified after resume)');

    if (!resumedAfterRegistration) {
      const registration = await rpc('register_or_refresh_current_device',{p_device_id:deviceId,p_device_label:'Development Onboarding Device',p_platform:'Development E2E'},session.access_token);
      if (!registration || registration.authorizationStatus !== 'registered') fail(`Device registration response mismatch: ${registration&&registration.authorizationStatus}`);
    }
    const request = await rpc('request_current_device_authorization',{p_device_id:deviceId,p_operation_id:crypto.randomUUID()},session.access_token);
    if (!request || !['pending','unchanged'].includes(request.status)) fail(`Device authorization request mismatch: ${request&&request.status}`);
    assertState(await counts(client,userId),{account_status:'approved',can_create:false,organizations:1,conferences:1,devices:1,pending_devices:1,approved_devices:0},'Device Authorization Request');

    const deviceResult = await asActor(client,organizationActor.user_id,'approve_device',`select public.approve_member_device($1,$2,$3,$4,$5) result`,[organizationActor.device_id,organizationActor.organization_id,userId,deviceId,crypto.randomUUID()]);
    if (!deviceResult || deviceResult.authorizationStatus !== 'approved') fail('Device approval response mismatch');
    assertState(await counts(client,userId),{account_status:'approved',can_create:false,organizations:1,conferences:1,devices:1,pending_devices:0,approved_devices:1},'Device Approval');

    const home = await rpc('get_my_device_aware_system_access',{p_device_id:deviceId},session.access_token);
    const conferenceAccess = await rpc('device_guarded_get_my_conference_membership',{p_actor_device_id:deviceId,p_conference_id:conferenceActor.conference_id},session.access_token);
    if (home.accountStatus !== 'approved' || home.deviceAuthorizationStatus !== 'approved' || conferenceAccess.role !== 'viewer' || conferenceAccess.success !== true) fail('Permission-aware Home verification mismatch');
    console.log('Permission-aware Home: PASS');
    console.log('Layer separation: PASS');
    console.log('E2E onboarding result: PASS');
    console.log('Test account disposition: LEFT IN DEVELOPMENT');
  } catch (error) {
    const safe = String(error.message || error).split(local.password).join('[REDACTED]').split(password).join('[REDACTED]');
    console.error(`Development onboarding E2E: FAIL stage=${error.sqlLabel || 'runtime'} message=${safe}`);
    process.exitCode = 1;
  } finally { await client.end().catch(()=>{}); }
}

main();
