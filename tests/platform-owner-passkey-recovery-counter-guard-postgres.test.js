'use strict';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const postgresAppBin='/Applications/Postgres.app/Contents/Versions/latest/bin';
const pgBin=process.env.PG_BIN||(fs.existsSync(postgresAppBin)?postgresAppBin:'');
const tool=name=>pgBin?path.join(pgBin,name):name;
const database=`platform_owner_recovery_${process.pid}_${Date.now()}`;

test('PostgreSQL recovery counter guard permits only atomic verified recovery state',()=>{
  assert.doesNotThrow(()=>execFileSync(tool('psql'),['--version'],{stdio:'pipe'}),'local PostgreSQL client is required');
  execFileSync(tool('createdb'),['-T','template0',database]);
  try{
    const result=execFileSync(tool('psql'),['-X','-v','ON_ERROR_STOP=1','-d',database,
      '-f','tests/sql/platform-owner-passkey-recovery-counter-guard-rehearsal.sql'],{encoding:'utf8'});
    assert.match(result,/"status": "pass"/);
    assert.match(result,/"success": true/);
    assert.match(result,/"rejection": true/);
    assert.match(result,/"rollback": true/);
  }finally{
    execFileSync(tool('dropdb'),['--if-exists',database]);
  }
});
