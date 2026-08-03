'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260803_5_4_3_device_authorization_rerequest.sql'
),'utf8');
const service=fs.readFileSync(path.join(
  root,'js/supabase/current-device-authorization-service.js'
),'utf8');
const ui=fs.readFileSync(path.join(
  root,'js/sync/current-device-authorization-ui.js'
),'utf8');

assert.match(migration,/^begin\s*;/i);
assert.match(migration,/create or replace function public\.request_current_device_authorization\s*\(\s*p_device_id uuid,\s*p_operation_id uuid\s*\)/i);
assert.match(migration,/authorization_status in \('registered', 'revoked'\)/i);
assert.match(migration,/set authorization_status = 'pending',[\s\S]*requested_at = now\(\),[\s\S]*approved_at = null,[\s\S]*approved_by = null,[\s\S]*revoked_at = null,[\s\S]*revoked_by = null/i);
assert.match(migration,/authorization_row\.authorization_status = 'pending'[\s\S]*'unchanged'/i);
assert.match(migration,/else\s+request_result := jsonb_build_object\('status', 'denied'\)/i,
  'approved devices must remain denied for a new request');
assert.match(migration,/if access_status is distinct from 'approved'[\s\S]*SYSTEM_ACCESS_APPROVED_REQUIRED/i);
assert.ok(migration.indexOf('select * into existing_operation')<
  migration.indexOf('select * into authorization_row'),
  'idempotency replay must precede mutation and audit');
assert.match(migration,/return existing_operation\.result/i);
assert.match(migration,/device_authorization_requested/);
assert.match(migration,/requestSource'[\s\S]*'rerequest'/);
assert.doesNotMatch(migration,/alter table|create table|drop table|delete from/i,
  're-request migration must not change schema or delete data');
assert.match(migration,/ROLLBACK SQL/);
assert.match(migration,/The rollback intentionally restores behavior only/);
assert.match(migration,/grant execute on function public\.request_current_device_authorization\(uuid, uuid\)[\s\S]*to authenticated/i);
assert.doesNotMatch(migration,/grant execute[\s\S]*to (?:public|anon)\s*;/i);

assert.match(service,/\['registered','revoked'\]/,
  'diagnostic contract must expose re-request eligibility');
assert.match(service,/clientScope\(\)/,
  'request intent must be isolated by Supabase client scope');
assert.match(ui,/state\.status==='revoked'&&state\.accountStatus==='approved'/,
  'revoked device may request again only for an approved account');
assert.match(ui,/طلب اعتماد الجهاز مرة أخرى/);
assert.match(ui,/accountStatus==='blocked'/,
  'blocked account must remain fail-closed in the UI');

console.log('device authorization re-request migration contract tests: passed');
