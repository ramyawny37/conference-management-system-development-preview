'use strict';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const postgresAppBin='/Applications/Postgres.app/Contents/Versions/latest/bin';
const pgBin=process.env.PG_BIN||(fs.existsSync(postgresAppBin)?postgresAppBin:'');
const tool=name=>pgBin?path.join(pgBin,name):name;
const database=`owner_pending_session_read_${process.pid}_${Date.now()}`;

test('owner pending-device session read is executable, filtered and fail-closed',()=>{
  assert.doesNotThrow(()=>execFileSync(tool('psql'),['--version'],{stdio:'pipe'}),'local PostgreSQL client is required');
  execFileSync(tool('createdb'),['-T','template0',database]);
  try{
    const output=execFileSync(tool('psql'),['-X','-At','-v','ON_ERROR_STOP=1','-d',database,'-f','tests/sql/platform-owner-pending-device-session-read-rehearsal.sql'],{encoding:'utf8'});
    const report=JSON.parse(output.trim().split('\n').filter(line=>line.startsWith('{')).at(-1));
    assert.deepEqual(report,{status:'pass',positive:2,negative:4,listed:1,legacyServiceRoleExecute:false,directAuthenticatedExecute:false});
  }finally{execFileSync(tool('dropdb'),['--if-exists',database]);}
});
