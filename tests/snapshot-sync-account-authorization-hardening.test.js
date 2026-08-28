'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var root=path.resolve(__dirname,'..');
function read(relative){return fs.readFileSync(path.join(root,relative),'utf8');}
var migration=read('supabase/migrations/20260826_6_19_0_snapshot_sync_account_authorization_hardening.sql');
var preflight=read('supabase/snapshot-sync-account-hardening-readonly-preflight.sql');
var verification=read('supabase/snapshot-sync-account-hardening-readonly-verification.sql');

assert.match(migration,/^begin;/im);
assert.match(migration,/commit;\s*$/i);
assert.match(migration,/EXPECTED_MIGRATION_6_18_0_IS_NOT_CURRENT/);
assert.match(migration,/if latest\.version is distinct from '20260826113408'[\s\S]*or latest\.name is distinct from 'conference_lifecycle_hardening_6_18_0'[\s\S]*then[\s\S]*raise exception 'EXPECTED_MIGRATION_6_18_0_IS_NOT_CURRENT'/);
assert.match(migration,/order by version desc limit 1/i);
function acceptsMigration618Identity(version,name){
  return version==='20260826113408'
    && name==='conference_lifecycle_hardening_6_18_0';
}
assert.strictEqual(acceptsMigration618Identity(
  '20260826113408','conference_lifecycle_hardening_6_18_0'),true);
assert.strictEqual(acceptsMigration618Identity(
  '20260826191920','conference_lifecycle_hardening_6_18_0'),false);
assert.strictEqual(acceptsMigration618Identity(
  '20260826113408','conference_lifecycle_hardening_6_18_0_similar'),false);
assert.match(migration,/create temporary table migration_6_19_0_data_baseline/i);
assert.match(migration,/MIGRATION_CHANGED_DATA_OR_HISTORY/);
assert.match(migration,/revoke insert,update,delete,truncate,references,trigger[\s\S]*conference_snapshots[\s\S]*sync_operations[\s\S]*sync_conflicts[\s\S]*from public,anon,authenticated/i);
[
  'conference_snapshots_insert_manager',
  'conference_snapshots_update_manager',
  'sync_operations_insert_manager'
].forEach(function(policy){
  assert.match(migration,new RegExp('drop policy if exists '+policy,'i'));
});
[
  'approve_system_user(uuid,boolean)',
  'block_system_user(uuid)',
  'unblock_system_user(uuid)',
  'set_user_conference_creation_permission(uuid,boolean)'
].forEach(function(signature){assert.ok(migration.includes(signature),signature);});
assert.match(migration,/device_guarded_apply_conference_snapshot/);
assert.match(migration,/device_guarded_resolve_sync_conflict/);
assert.match(migration,/device_guarded_manage_system_user/);
assert.match(migration,/require_current_approved_device/);
assert.match(migration,/conference_snapshot_guard_intents/);
assert.match(migration,/system_access_admin_operations/);
assert.match(migration,/UNGUARDED_SNAPSHOT_SYNC_MUTATOR_REMAINS/);
assert.doesNotMatch(migration,/\balter role\b|\bcreate role\b|\bdrop role\b/i);

[preflight,verification].forEach(function(sql){
  assert.match(sql,/begin transaction read only/i);
  assert.doesNotMatch(sql,/^\s*(?:insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im);
  assert.match(sql,/role_membership_fingerprint/);
});
assert.match(preflight,/gppwltrifgfxrkzvvxoe/);
assert.match(preflight,/INVALID_EXISTING_SNAPSHOT_SYNC_STATE/);
assert.match(preflight,/latest\.name is distinct from 'conference_lifecycle_hardening_6_18_0'/);
assert.match(preflight,/latest\.content_md5 is distinct from[\s\S]*'699f1bf58271c8c75d6026ebc0436b28'/);
assert.doesNotMatch(preflight,/latest\.version is distinct from/i);
assert.doesNotMatch(preflight,/20260826113408/);
assert.match(verification,/BROWSER_SNAPSHOT_SYNC_WRITE_PRIVILEGE_REMAINS/);
assert.match(verification,/BROWSER_SNAPSHOT_SYNC_WRITE_POLICY_REMAINS/);
assert.match(verification,/LEGACY_ACCOUNT_ADMIN_EXECUTE_REMAINS/);

function jsFiles(directory){
  return fs.readdirSync(directory,{withFileTypes:true}).reduce(function(files,item){
    var full=path.join(directory,item.name);
    if(item.isDirectory()){
      if(item.name==='staged')return files;
      return files.concat(jsFiles(full));
    }
    if(item.isFile()&&/\.js$/.test(item.name)&&item.name!=='experimental-conference-reset.js')files.push(full);
    return files;
  },[]);
}
var activeSource=jsFiles(path.join(root,'js')).map(function(file){return read(path.relative(root,file));}).join('\n');
['conference_snapshots','sync_operations','sync_conflicts'].forEach(function(table){
  var direct=new RegExp('\\.from\\([\'\"]'+table+'[\'\"]\\)[\\s\\S]{0,400}\\.(?:insert|update|delete|upsert)\\s*\\(','i');
  assert.doesNotMatch(activeSource,direct,'direct active DML: '+table);
});
[
  'approve_system_user','block_system_user','unblock_system_user',
  'set_user_conference_creation_permission'
].forEach(function(name){
  assert.doesNotMatch(activeSource,new RegExp('\\.rpc\\([\'\"]'+name+'[\'\"]'),'legacy RPC: '+name);
});
assert.match(activeSource,/\.rpc\(['"]device_guarded_apply_conference_snapshot['"]/);
assert.match(activeSource,/\.rpc\(['"]device_guarded_resolve_sync_conflict['"]/);
assert.match(activeSource,/\.rpc\(['"]device_guarded_manage_system_user['"]/);

console.log('snapshot/sync and account authorization hardening tests: passed');
