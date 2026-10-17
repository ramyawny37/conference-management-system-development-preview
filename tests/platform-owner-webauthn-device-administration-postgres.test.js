'use strict';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const postgresAppBin='/Applications/Postgres.app/Contents/Versions/latest/bin';
const pgBin=process.env.PG_BIN||(fs.existsSync(postgresAppBin)?postgresAppBin:'');
const tool=name=>pgBin?path.join(pgBin,name):name;
const database=`platform_owner_device_admin_${process.pid}_${Date.now()}`;

test('owner WebAuthn device administration is executable, bound, replay-safe, and audited',()=>{
  assert.doesNotThrow(()=>execFileSync(tool('psql'),['--version'],{stdio:'pipe'}),
    'local PostgreSQL client is required');
  execFileSync(tool('createdb'),['-T','template0',database]);
  try{
    const result=execFileSync(tool('psql'),['-X','-At','-v','ON_ERROR_STOP=1','-d',database,
      '-f','tests/sql/platform-owner-webauthn-device-administration-rehearsal.sql'],{encoding:'utf8'});
    const report=JSON.parse(result.trim().split('\n').filter(line=>line.startsWith('{')).at(-1));
    assert.deepEqual(report,{status:'pass',positive:8,negative:12,audits:3,operations:2,pendingAfter:0});
  }finally{
    execFileSync(tool('dropdb'),['--if-exists',database]);
  }
});
