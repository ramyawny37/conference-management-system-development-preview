'use strict';

// DEFERRED disposable-database runner. Never invoked by local contract tests.
// Required environment: PHASE4G_DATABASE_URL, PHASE4G_EXPECTED_DATABASE,
// PHASE4G_EXPECTED_ENVIRONMENT=disposable. No credentials are stored here.

var childProcess=require('child_process');

var databaseUrl=process.env.PHASE4G_DATABASE_URL;
var expectedDatabase=process.env.PHASE4G_EXPECTED_DATABASE;
var expectedEnvironment=process.env.PHASE4G_EXPECTED_ENVIRONMENT;

if(!databaseUrl||!expectedDatabase||expectedEnvironment!=='disposable'){
  throw new Error('PHASE4G_DISPOSABLE_ENVIRONMENT_REQUIRED');
}
if(/prod|production|development|staging/i.test(expectedDatabase)||
   !/test|disposable|local/i.test(expectedDatabase)){
  throw new Error('PHASE4G_DISPOSABLE_DATABASE_NAME_REQUIRED');
}

function literal(value){return "'"+String(value).replace(/'/g,"''")+"'";}

var guard="do $$begin if current_database()<>"+literal(expectedDatabase)+
  " or lower(current_database())~'(prod|production|development|staging)'"+
  " or lower(current_database())!~'(test|disposable|local)' then "+
  "raise exception 'PHASE4G_DISPOSABLE_ENVIRONMENT_REQUIRED'; end if; end$$;";

function run(sql){
  return new Promise(function(resolve){
    var proc=childProcess.spawn('psql',['-X','-v','ON_ERROR_STOP=1','-d',databaseUrl,'-c',guard+sql],{
      stdio:['ignore','pipe','pipe']
    });
    var output='';
    proc.stdout.on('data',function(chunk){output+=chunk;});
    proc.stderr.on('data',function(chunk){output+=chunk;});
    proc.on('close',function(code){resolve({code:code,output:output});});
  });
}

function actor(userId){
  return "select set_config('request.jwt.claim.sub',"+literal(userId)+",false);";
}

function lockAndDelay(moduleKey){
  return "begin;select pg_advisory_xact_lock(hashtextextended('module-managers:"+
    moduleKey+"',0));select pg_sleep(1);";
}

function lockOperationAndDelay(operationId){
  return "begin;select pg_advisory_xact_lock(hashtextextended('module-grant-operation:"+
    operationId+"',0));select pg_sleep(1);";
}

async function race(label,sqlA,sqlB,expectation){
  var first=run(sqlA);
  await new Promise(function(resolve){setTimeout(resolve,150);});
  var second=run(sqlB);
  var results=await Promise.all([first,second]);
  var passes=results.filter(function(result){return result.code===0;}).length;
  if(passes!==expectation){
    throw new Error(label+' expected '+expectation+' successful sessions; outputs: '+
      results.map(function(result){return result.output;}).join('\n'));
  }
  process.stdout.write(label+': PASS\n');
}

var owner='4c000000-0000-4000-8000-000000000001';
var managerA='4c000000-0000-4000-8000-000000000002';
var managerB='4c000000-0000-4000-8000-000000000003';
var target='4c000000-0000-4000-8000-000000000004';
var ownerDevice='4c100000-0000-4000-8000-000000000001';
var managerADevice='4c100000-0000-4000-8000-000000000002';

var setup="begin;"+
  "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values"+
  "("+literal(owner)+",'00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4gc-owner@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),"+
  "("+literal(managerA)+",'00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4gc-a@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),"+
  "("+literal(managerB)+",'00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4gc-b@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),"+
  "("+literal(target)+",'00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4gc-target@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now());"+
  "insert into public.system_user_access(user_id,account_status,approved_at) values"+
  "("+literal(owner)+",'approved',now()),("+literal(managerA)+",'approved',now()),"+
  "("+literal(managerB)+",'approved',now()),("+literal(target)+",'approved',now())"+
  " on conflict(user_id) do update set account_status='approved',approved_at=now();"+
  "insert into public.system_user_roles(user_id,role,granted_by) values("+literal(owner)+",'system_owner',"+literal(owner)+");"+
  "insert into public.devices(id,user_id,device_name,platform) values"+
  "("+literal(ownerDevice)+","+literal(owner)+",'phase4gc-owner','test'),"+
  "("+literal(managerADevice)+","+literal(managerA)+",'phase4gc-manager','test');"+
  "insert into public.user_device_authorizations(user_id,device_id,authorization_status,approved_at,approved_by) values"+
  "("+literal(owner)+","+literal(ownerDevice)+",'approved',now(),"+literal(owner)+"),"+
  "("+literal(managerA)+","+literal(managerADevice)+",'approved',now(),"+literal(owner)+");"+
  "insert into public.platform_modules(module_key,display_name,status) "+
  "select key,'Phase4G concurrency','active' from unnest(array['p4gr1','p4gr2','p4gr3','p4gr4','p4gr5','p4gr6']) key;"+
  "insert into public.module_permission_catalog(permission_key,module_key,display_name,description,status,allowed_scope_mode,allowed_resource_type,sensitive_mutation,catalog_version) "+
  "select key||'.record.read',key,'Read','Concurrency fixture','active','both','record',false,1 "+
  "from unnest(array['p4gr1','p4gr2','p4gr3','p4gr4','p4gr5','p4gr6']) key;"+
  "insert into public.module_permission_grants(user_id,module_key,permission_key,granted_by,granted_by_device_id) "+
  "select "+literal(managerA)+",key,'module.manage',"+literal(owner)+","+literal(ownerDevice)+
  " from unnest(array['p4gr1','p4gr2','p4gr5','p4gr6']) key;"+
  "insert into public.module_permission_grants(user_id,module_key,permission_key,granted_by,granted_by_device_id) "+
  "select "+literal(managerB)+",key,'module.manage',"+literal(owner)+","+literal(ownerDevice)+
  " from unnest(array['p4gr1','p4gr2','p4gr5']) key;commit;";

function grantId(moduleKey,userId){
  return "(select grant_id from public.module_permission_grants where module_key="+
    literal(moduleKey)+" and user_id="+literal(userId)+
    " and permission_key='module.manage' and revoked_at is null)";
}

async function main(){
  var initialized=await run(setup);
  if(initialized.code!==0)throw new Error('fixture setup failed: '+initialized.output);

  await race('manager revocation vs reserved administration',
    actor(owner)+lockAndDelay('p4gr1')+
      "select public.manage_foundation_module_grant("+literal(ownerDevice)+",'4c200000-0000-4000-8000-000000000001','revoke',"+
      literal(managerA)+",'p4gr1','module.manage',"+grantId('p4gr1',managerA)+",'race revoke');commit;",
    actor(managerA)+"select public.manage_foundation_module_grant("+literal(managerADevice)+",'4c200000-0000-4000-8000-000000000002','create',"+
      literal(target)+",'p4gr1','module.access',null,null);",1);

  await race('manager revocation vs module-specific administration',
    actor(owner)+lockAndDelay('p4gr2')+
      "select public.manage_foundation_module_grant("+literal(ownerDevice)+",'4c200000-0000-4000-8000-000000000003','revoke',"+
      literal(managerA)+",'p4gr2','module.manage',"+grantId('p4gr2',managerA)+",'race revoke');commit;",
    actor(managerA)+"select public.manage_catalog_module_grant("+literal(managerADevice)+",'4c200000-0000-4000-8000-000000000004','grant',"+
      literal(target)+",'p4gr2','p4gr2.record.read',null,null,null,null);",1);

  await race('duplicate equivalent grant race',
    actor(owner)+lockAndDelay('p4gr3')+
      "select public.manage_catalog_module_grant("+literal(ownerDevice)+",'4c200000-0000-4000-8000-000000000005','grant',"+literal(target)+",'p4gr3','p4gr3.record.read',null,null,null,null);commit;",
    actor(owner)+"select public.manage_catalog_module_grant("+literal(ownerDevice)+",'4c200000-0000-4000-8000-000000000006','grant',"+literal(target)+",'p4gr3','p4gr3.record.read',null,null,null,null);",2);

  await race('same operation race',
    actor(owner)+lockOperationAndDelay('4c200000-0000-4000-8000-000000000007')+
      "select public.manage_catalog_module_grant("+literal(ownerDevice)+",'4c200000-0000-4000-8000-000000000007','grant',"+literal(target)+",'p4gr4','p4gr4.record.read',null,null,null,null);commit;",
    actor(owner)+"select public.manage_catalog_module_grant("+literal(ownerDevice)+",'4c200000-0000-4000-8000-000000000007','grant',"+literal(target)+",'p4gr4','p4gr4.record.read',null,null,null,null);",2);

  await race('concurrent ordinary manager revocations',
    actor(owner)+lockAndDelay('p4gr5')+
      "select public.manage_foundation_module_grant("+literal(ownerDevice)+",'4c200000-0000-4000-8000-000000000008','revoke',"+literal(managerA)+",'p4gr5','module.manage',"+grantId('p4gr5',managerA)+",'race A');commit;",
    actor(owner)+"select public.manage_foundation_module_grant("+literal(ownerDevice)+",'4c200000-0000-4000-8000-000000000009','revoke',"+literal(managerB)+",'p4gr5','module.manage',"+grantId('p4gr5',managerB)+",'race B');",1);

  await race('recovery vs ordinary manager administration',
    actor(owner)+lockAndDelay('p4gr6')+
      "select public.recover_revoke_final_module_manager("+literal(ownerDevice)+",'4c200000-0000-4000-8000-000000000010','p4gr6',"+literal(managerA)+","+grantId('p4gr6',managerA)+",'race final manager recovery');commit;",
    actor(managerA)+"select public.manage_foundation_module_grant("+literal(managerADevice)+",'4c200000-0000-4000-8000-000000000011','create',"+literal(target)+",'p4gr6','module.access',null,null);",1);

  process.stdout.write('Phase 4G multi-session concurrency verification: PASS\n');
}

main().catch(function(error){
  process.stderr.write(error.message+'\n');
  process.exitCode=1;
});
