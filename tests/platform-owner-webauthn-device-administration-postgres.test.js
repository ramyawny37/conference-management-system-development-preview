'use strict';
const assert=require('node:assert/strict');
const {execFileSync,spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const postgresAppBin='/Applications/Postgres.app/Contents/Versions/latest/bin';
const pgBin=process.env.PG_BIN||(fs.existsSync(postgresAppBin)?postgresAppBin:'');
const tool=name=>pgBin?path.join(pgBin,name):name;
const database=`platform_owner_device_admin_${process.pid}_${Date.now()}`;

function sql(databaseName,statement){
  return execFileSync(tool('psql'),['-X','-At','-v','ON_ERROR_STOP=1','-d',databaseName,'-c',statement],{encoding:'utf8'}).trim();
}
function sqlAsync(databaseName,statement){
  return new Promise(resolve=>{
    const child=spawn(tool('psql'),['-X','-At','-v','ON_ERROR_STOP=1','-d',databaseName,'-c',statement]);
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>{stdout+=chunk;});
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('close',code=>resolve({code,stdout,stderr}));
  });
}

test('owner WebAuthn device administration is executable, bound, replay-safe, audited, and serialized',async()=>{
  assert.doesNotThrow(()=>execFileSync(tool('psql'),['--version'],{stdio:'pipe'}),
    'local PostgreSQL client is required');
  execFileSync(tool('createdb'),['-T','template0',database]);
  try{
    const result=execFileSync(tool('psql'),['-X','-At','-v','ON_ERROR_STOP=1','-d',database,
      '-f','tests/sql/platform-owner-webauthn-device-administration-rehearsal.sql'],{encoding:'utf8'});
    const report=JSON.parse(result.trim().split('\n').filter(line=>line.startsWith('{')).at(-1));
    assert.deepEqual(report,{status:'pass',positive:15,negative:22,audits:6,operations:5,pendingAfter:0});

    sql(database,`insert into auth.users values('10000000-0000-4000-8000-000000000008','concurrent@example.test');
      insert into platform.profiles values('10000000-0000-4000-8000-000000000008','Concurrent target','approved');
      insert into platform.devices values('20000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000008','Concurrent device','Linux','active',null,null);
      insert into platform.user_device_authorizations(id,user_id,device_id,status,approved_at)
      values('30000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000010','approved',now());
      insert into platform.device_key_bindings(id,user_id,device_id,device_authorization_id,public_key_jwk,
        public_key_thumbprint,algorithm,lifecycle_status,migration_source)
      values('31000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000008',
        '20000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000010',
        '{"kty":"EC","crv":"P-256","x":"test","y":"test"}',repeat('1',64),
        'ECDSA_P256_SHA256','active','native_device_enrollment');
      insert into platform.user_roles values('10000000-0000-4000-8000-000000000008',
        '11000000-0000-4000-8000-000000000002','conference','70000000-0000-4000-8000-000000000002',null,null);`);
    const begin=(session,operation,hash)=>sql(database,`select public.begin_system_owner_device_possession_challenge(
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001','${session}','SYSTEM_OWNER_DEVICE_REVOKE',
      '10000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000010','${operation}',
      'development_preview','https://ramyawny37.github.io','ramyawny37.github.io',decode(repeat('${hash}',32),'hex'))->>'challengeId'`);
    const challengeA=begin('50000000-0000-4000-8000-000000000010','52000000-0000-4000-8000-000000000010','41');
    const challengeB=begin('50000000-0000-4000-8000-000000000011','52000000-0000-4000-8000-000000000011','42');
    const complete=(challenge,session,operation,hash)=>`select public.complete_system_owner_pending_device_operation(
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001','${session}','development_preview','${challenge}',
      decode(repeat('${hash}',32),'hex'),'${operation}','10000000-0000-4000-8000-000000000008',
      '20000000-0000-4000-8000-000000000010','revoke',0,'https://ramyawny37.github.io',
      'ramyawny37.github.io','{"userVerified":true,"backupEligible":true,"backupState":true}')`;
    const outcomes=await Promise.all([
      sqlAsync(database,complete(challengeA,'50000000-0000-4000-8000-000000000010','52000000-0000-4000-8000-000000000010','41')),
      sqlAsync(database,complete(challengeB,'50000000-0000-4000-8000-000000000011','52000000-0000-4000-8000-000000000011','42'))
    ]);
    assert.equal(outcomes.filter(item=>item.code===0).length,1,'exactly one concurrent revocation must commit');
    assert.equal(outcomes.filter(item=>/APPROVED_UNREVOKED_DEVICE_REQUIRED/.test(item.stderr)).length,1,
      'the serialized loser must re-read the revoked target and fail');
    assert.deepEqual(JSON.parse(sql(database,`select json_build_object(
      'authorization',(select status from platform.user_device_authorizations where id='30000000-0000-4000-8000-000000000010'),
      'binding',(select lifecycle_status from platform.device_key_bindings where id='31000000-0000-4000-8000-000000000010'),
      'operations',(select count(*) from public.system_owner_device_authorization_operations where target_device_id='20000000-0000-4000-8000-000000000010'),
      'audits',(select count(*) from public.privileged_device_authorization_audit_log where target_device_id='20000000-0000-4000-8000-000000000010'),
      'roles',(select count(*) from platform.user_roles where user_id='10000000-0000-4000-8000-000000000008'))`)),
      {authorization:'revoked',binding:'revoked',operations:1,audits:1,roles:1});
  }finally{
    execFileSync(tool('dropdb'),['--if-exists',database]);
  }
});
