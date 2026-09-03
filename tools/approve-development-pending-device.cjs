'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const DEV_REF='gppwltrifgfxrkzvvxoe';
const DEV_NAME='conference-management-system-development';
const PROD_REF='mpezfbvcdfxpgflehuot';
const STAGING_REF='zentpxnyccbkzgrkkkms';
const EXPECTED_USER_ID='916c0d83-4c5a-4a9e-89bb-4faa671166f7';
const EXPECTED_EMAIL='dev-owner-test@example.com';

function fail(message){throw new Error(message);}

function safeError(error,password){
  let message=error instanceof Error?error.message:String(error);
  if(password)message=message.split(password).join('[REDACTED]');
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi,'[REDACTED_DATABASE_URL]');
}

async function runQuery(client,stage,label,sql,params){
  try{
    return await client.query(sql,params);
  }catch(error){
    error.runnerStage=stage;
    error.safeSqlLabel=label;
    throw error;
  }
}

function requirePg(repoRoot){
  const modules=String(process.env.CMS_MIGRATION_RUNNER_MODULES||'').trim();
  if(!modules)fail('CMS_MIGRATION_RUNNER_MODULES is unavailable');
  const resolved=path.resolve(modules);
  const tempRoot=path.resolve(process.env.TEMP||process.env.TMP||'');
  if(!tempRoot||!(resolved===tempRoot||resolved.startsWith(tempRoot+path.sep))){
    fail('Runner modules must be under the temporary directory');
  }
  const pgPath=path.join(resolved,'pg');
  if(!fs.existsSync(pgPath))fail('Temporary pg module is unavailable');
  return require(pgPath);
}

function preflight(repoRoot){
  const password=String(process.env.SUPABASE_DB_PASSWORD_DEV||'');
  const userId=String(process.env.SUPABASE_DEV_BOOTSTRAP_USER_ID||'').trim();
  const email=String(process.env.SUPABASE_DEV_BOOTSTRAP_EMAIL||'').trim().toLowerCase();
  if(!password)fail('SUPABASE_DB_PASSWORD_DEV is unavailable');
  if(userId!==EXPECTED_USER_ID||email!==EXPECTED_EMAIL){
    fail('Development bootstrap identity environment mismatch');
  }

  const temp=path.join(repoRoot,'supabase','.temp');
  const ref=fs.readFileSync(path.join(temp,'project-ref'),'utf8').trim();
  const linked=JSON.parse(
    fs.readFileSync(path.join(temp,'linked-project.json'),'utf8')
  );
  const poolText=fs.readFileSync(path.join(temp,'pooler-url'),'utf8').trim();
  const pool=new URL(poolText);
  const poolUser=decodeURIComponent(pool.username);
  const identityText=[ref,linked.ref,linked.name,poolText,pool.hostname,poolUser]
    .join('|');
  if(identityText.includes(PROD_REF)||identityText.includes(STAGING_REF)){
    fail('Production or Staging target detected');
  }
  if(ref!==DEV_REF||linked.ref!==DEV_REF||linked.name!==DEV_NAME){
    fail('Development project identity mismatch');
  }
  if(poolUser!==`postgres.${DEV_REF}`||pool.pathname!=='/postgres'||pool.password){
    fail('Development database connection identity mismatch');
  }
  if(!pool.hostname.includes(DEV_REF)&&!poolUser.includes(DEV_REF)){
    fail('Development project ref is absent from connection identity');
  }
  console.log('Development identity gate: PASS');
  return {
    password,userId,email,
    connection:{
      host:pool.hostname,
      port:Number(pool.port||5432),
      database:'postgres',
      user:poolUser,
      password,
      ssl:{rejectUnauthorized:false},
      application_name:'cms-development-pending-device-approval'
    }
  };
}

async function readState(client,userId,email){
  const result=await runQuery(client,'preflight','development_device_state',`
    with target_user as (
      select id,email from auth.users where id=$1::uuid and lower(email)=lower($2)
    ), pending as (
      select uda.user_id,uda.device_id
      from public.user_device_authorizations as uda
      join public.devices as d on d.id=uda.device_id
       and d.user_id=uda.user_id
      where uda.user_id=$1::uuid
        and uda.authorization_status='pending'
        and uda.revoked_at is null
        and uda.revoked_by is null
    ), approved as (
      select uda.device_id
      from public.user_device_authorizations as uda
      join public.devices as d on d.id=uda.device_id
       and d.user_id=uda.user_id
      where uda.user_id=$1::uuid
        and uda.authorization_status='approved'
        and uda.revoked_at is null
      order by uda.last_registered_at desc,uda.device_id
    ), default_owner as (
      select org.id as organization_id
      from public.organizations as org
      join public.organization_members as om
        on om.organization_id=org.id
       and om.user_id=$1::uuid
       and om.role='organization_owner'
      where org.is_default
    )
    select current_database() as current_database,current_user as current_user,
      (select count(*)::int from target_user) target_user_count,
      exists(select 1 from public.system_user_access
        where user_id=$1::uuid and account_status='approved'
          and can_create_conferences) approved_system_access,
      exists(select 1 from public.system_user_roles
        where user_id=$1::uuid and role='system_owner') system_owner,
      (select count(*)::int from default_owner) default_owner_count,
      (select organization_id::text from default_owner limit 1)
        organization_id,
      (select count(*)::int from pending) pending_device_count,
      (select device_id::text from pending order by device_id limit 1)
        pending_device_id,
      (select count(*)::int from public.user_device_authorizations
        where authorization_status='pending' and revoked_at is null)
        global_pending_device_count,
      (select count(*)::int from approved) approved_device_count,
      (select device_id::text from approved limit 1) approved_actor_device_id,
      (select count(*)::int from auth.users) auth_user_count,
      (select count(*)::int from public.devices) device_count,
      (select count(*)::int from public.user_device_authorizations)
        authorization_count,
      (select count(*)::int from public.device_authorization_operations)
        request_operation_count,
      (select count(*)::int from public.device_authorization_audit_log)
        audit_count,
      (select count(*)::int from public.device_authorization_admin_operations)
        admin_operation_count,
      to_regprocedure(
        'public.approve_member_device(uuid,uuid,uuid,uuid,uuid)'
      ) is not null approval_rpc_present
  `,[userId,email]);
  return result.rows[0];
}

function assertReady(state){
  if(state.current_database!=='postgres'||state.current_user!=='postgres'){
    fail('Database SQL identity gate failed');
  }
  if(state.target_user_count!==1||!state.approved_system_access||
     !state.system_owner||state.default_owner_count!==1){
    fail('Development bootstrap owner prerequisite failed');
  }
  if(state.pending_device_count!==1||state.global_pending_device_count!==1||
     !state.pending_device_id){
    fail('Exactly one pending Development device is required');
  }
  if(state.approved_device_count!==1||!state.approved_actor_device_id){
    fail('Exactly one approved Development actor device is required');
  }
  if(!state.approval_rpc_present)fail('Device approval RPC is missing');
}

async function approve(client,identity,before){
  const operationId=crypto.randomUUID();
  await runQuery(client,'approval_transaction','begin','BEGIN');
  try{
    await runQuery(client,'approval_transaction','set_authenticated_role',
      'SET LOCAL ROLE authenticated');
    await runQuery(
      client,'approval_transaction','set_auth_claims',
      "select set_config('request.jwt.claim.sub',$1,true),"+
      "set_config('request.jwt.claim.role','authenticated',true)",
      [identity.userId]
    );
    const approval=await runQuery(
      client,'approval_transaction','approve_member_device_rpc',`
      select public.approve_member_device(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid
      ) result
    `,[before.approved_actor_device_id,before.organization_id,
      identity.userId,before.pending_device_id,operationId]);
    const result=approval.rows[0]&&approval.rows[0].result;
    if(!result||result.status!=='applied'||
       result.authorizationStatus!=='approved'||
       result.deviceId!==before.pending_device_id){
      fail('Device approval RPC returned an unexpected result');
    }
    await runQuery(client,'approval_transaction','reset_role','RESET ROLE');
    const inside=await runQuery(
      client,'approval_transaction','approval_audit_inside_transaction',`
      select
        (select count(*)::int from public.device_authorization_audit_log
          where operation_id=$1::uuid
            and actor_user_id=$2::uuid and target_user_id=$2::uuid
            and device_id=$3::uuid
            and action='device_authorization_approved') audit_count,
        (select count(*)::int from public.device_authorization_admin_operations
          where operation_id=$1::uuid
            and actor_user_id_snapshot=$2::uuid
            and actor_device_id=$4::uuid
            and target_user_id_snapshot=$2::uuid
            and device_id=$3::uuid
            and action='approve_member_device' and outcome='applied')
          operation_count
    `,[operationId,identity.userId,before.pending_device_id,
      before.approved_actor_device_id]);
    if(inside.rows[0].audit_count!==1||inside.rows[0].operation_count!==1){
      fail('Mandatory device approval audit/operation verification failed');
    }
    await runQuery(client,'approval_transaction','commit','COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }
  return operationId;
}

async function verify(client,identity,before,operationId){
  const after=await readState(client,identity.userId,identity.email);
  const verification=await runQuery(
    client,'post_commit_verification','approved_device_state',`
    select authorization_status,
      (select count(*)::int from public.user_device_authorizations
        where user_id=$1::uuid and authorization_status='approved'
          and revoked_at is null) approved_device_count,
      (select count(*)::int from public.user_device_authorizations
        where user_id=$1::uuid and authorization_status='pending'
          and revoked_at is null) pending_device_count,
      (select count(*)::int from public.device_authorization_audit_log
        where operation_id=$3::uuid
          and action='device_authorization_approved'
          and actor_user_id=$1::uuid and target_user_id=$1::uuid)
        approval_audit_count
    from public.user_device_authorizations
    where user_id=$1::uuid and device_id=$2::uuid
  `,[identity.userId,before.pending_device_id,operationId]);
  if(verification.rowCount!==1)fail('Approved device verification row is missing');
  const row=verification.rows[0];
  if(row.authorization_status!=='approved'||row.pending_device_count!==0||
     row.approved_device_count!==before.approved_device_count+1||
     row.approval_audit_count!==1){
    fail('Post-commit device authorization verification failed');
  }
  if(after.auth_user_count!==before.auth_user_count||
     after.device_count!==before.device_count||
     after.authorization_count!==before.authorization_count||
     after.request_operation_count!==before.request_operation_count||
     after.audit_count!==before.audit_count+1||
     after.admin_operation_count!==before.admin_operation_count+1){
    fail('User/device/authorization row count changed unexpectedly');
  }
  console.log('Development pending device approval: PASS');
  console.log(`authorization_status=${row.authorization_status}`);
  console.log(`approved_device_count=${row.approved_device_count}`);
  console.log(`pending_device_count=${row.pending_device_count}`);
  console.log(`approved_actor_device_id=${before.approved_actor_device_id}`);
  console.log(`newly_approved_device_id=${before.pending_device_id}`);
}

async function main(){
  const repoRoot=path.resolve(__dirname,'..');
  const identity=preflight(repoRoot);
  const {Client}=requirePg(repoRoot);
  const client=new Client(identity.connection);
  try{
    await client.connect();
    const before=await readState(client,identity.userId,identity.email);
    assertReady(before);
    console.log('Pending device preflight: PASS');
    const operationId=await approve(client,identity,before);
    await verify(client,identity,before,operationId);
  }finally{
    await client.end().catch(()=>{});
  }
}

main().catch(error=>{
  const password=String(process.env.SUPABASE_DB_PASSWORD_DEV||'');
  console.error('Development pending device approval: FAIL');
  console.error(`stage=${String(error.runnerStage||'connection_or_runtime')}`);
  console.error(`sql_label=${String(error.safeSqlLabel||'none')}`);
  console.error(`postgres_code=${String(error.code||'none')}`);
  console.error(`position=${String(error.position||'none')}`);
  console.error(`message=${safeError(error,password)}`);
  process.exitCode=1;
});
