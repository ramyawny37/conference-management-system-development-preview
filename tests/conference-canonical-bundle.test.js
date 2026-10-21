'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sql=read('supabase/migrations/20261021203000_conference_canonical_bundle_export_restore.sql');
const edge=read('supabase/functions/platform-device-operation/index.ts');
const contract=read('js/supabase/platform-device-operation-contract.js');
const client=read('js/supabase/conference-canonical-bundle.js');
const script=read('script.js');

test('bundle is server-exported, versioned, hashed and size bounded',()=>{
  assert.match(sql,/conference-canonical-bundle/);
  assert.match(sql,/'schemaVersion',1/);
  assert.match(sql,/payloadSha256/);
  assert.match(sql,/octet_length\(p_bundle::text\)>10\*1024\*1024/);
  assert.match(client,/invoke\('export_conference_canonical_bundle'/);
  assert.doesNotMatch(script,/JSON\.stringify\(appData,null,2\)/);
});

test('restore is protected, atomic, idempotent and revision guarded',()=>{
  assert.match(sql,/primary key\(actor_user_id,operation_id\)/);
  assert.match(sql,/CONFERENCE_BUNDLE_IDEMPOTENCY_CONFLICT/);
  assert.match(sql,/CONFERENCE_BUNDLE_REVISION_CONFLICT/);
  assert.match(sql,/p_confirmed is distinct from true/);
  assert.match(sql,/platform\.audit_events/);
  assert.match(sql,/conference\.data\.restore/);
  assert.doesNotMatch(sql,/\bcommit\b/i);
});

test('authority, shared module state and historical ledgers are excluded',()=>{
  assert.match(sql,/excludedAuthorities/);
  assert.doesNotMatch(sql,/insert into (platform\.people|reservations\.)/i);
  assert.doesNotMatch(sql,/delete from reservations\./i);
  assert.doesNotMatch(sql,/insert into public\.conference_(creation|participation)_operations/i);
  assert.doesNotMatch(sql,/insert into public\.conference_locks/i);
  assert.match(sql,/PERSON_REFERENCE_NOT_FOUND/);
  assert.match(sql,/HOUSE_REFERENCE_NOT_FOUND/);
  assert.match(sql,/ROOM_REFERENCE_NOT_FOUND/);
});

test('one canonical dispatcher and UI own all bundle operations',()=>{
  for(const operation of ['export_conference_canonical_bundle','validate_conference_canonical_bundle','restore_conference_canonical_bundle']){
    assert.match(edge,new RegExp(`conference\\.add\\('${operation}'\\)`));
    assert.match(contract,new RegExp(`'${operation}'`));
    assert.match(sql,new RegExp(operation));
  }
  assert.match(script,/ConferenceCanonicalBundle\.download/);
  assert.match(script,/service\.validate\(bundle,options\)/);
  assert.match(script,/service\.restore\(bundle,options\)/);
  assert.doesNotMatch(script,/function importSingleConferenceData/);
});
