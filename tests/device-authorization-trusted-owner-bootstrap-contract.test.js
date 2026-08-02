'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var root=path.resolve(__dirname,'..');
var bootstrap=fs.readFileSync(path.join(root,'supabase/device-authorization-trusted-owner-bootstrap.sql'),'utf8');
var verification=fs.readFileSync(path.join(root,'supabase/device-authorization-trusted-owner-bootstrap-readonly-verification.sql'),'utf8');
var runbook=fs.readFileSync(path.join(root,'docs/device-authorization-trusted-owner-bootstrap.md'),'utf8');

['TRUSTED_OWNER_USER_UUID_HERE','EXPECTED_TRUSTED_OWNER_EMAIL_HERE',
 'ORGANIZATION_UUID_HERE','TRUSTED_DEVICE_UUID_HERE'].forEach(function(value){
  assert.ok(bootstrap.includes(value));assert.ok(verification.includes(value));
});
assert.doesNotMatch(bootstrap,/['"][0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}['"]/i);
assert.doesNotMatch(verification,/['"][0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}['"]/i);
assert.doesNotMatch(bootstrap,/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
assert.doesNotMatch(verification,/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
[
 /P0_3D_REVIEWED_LITERALS_REQUIRED/,/P0_3D_TRUSTED_OWNER_IDENTITY_INVALID/,
 /P0_3D_SYSTEM_ACCESS_APPROVED_REQUIRED/,/P0_3D_ORGANIZATION_OWNER_REQUIRED/,
 /P0_3D_TRUSTED_DEVICE_OWNERSHIP_INVALID/,/P0_3D_AUTHORIZATION_ROW_REQUIRED/,
 /P0_3D_REVOCATION_EVIDENCE_PRESENT/,/P0_3D_CONFLICTING_APPROVAL_OR_AUDIT/,
 /P0_3D_IDEMPOTENT_EVIDENCE_INVALID/,/P0_3D_ENFORCEMENT_MUST_REMAIN_DISABLED/,
 /P0_3D_P0_3B_BROWSER_GRANT_INVALID/,/P0_3D_P0_3C_EXACT_SIGNATURE_MISSING/,
 /pg_advisory_xact_lock[\s\S]*device-authorization-user:/,
 /for update/,/authorization_status in \('registered','pending'\)/,
 /set authorization_status='approved', approved_at=now\(\), approved_by=trusted_user_id/,
 /device_authorization_bootstrapped/,/Exact replay intentionally performs no write/
].forEach(function(pattern){assert.match(bootstrap,pattern);});
assert.doesNotMatch(bootstrap,/set[\s\S]{0,100}revoked_(?:at|by)\s*=\s*null/i);
assert.doesNotMatch(bootstrap,/create\s+(?:or\s+replace\s+)?function|^\s*(?:grant|revoke)\b/im);
assert.doesNotMatch(bootstrap,/\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:conferences|organizations|sync_|conference_|.*queue|.*lock|.*conflict)/i);
assert.match(verification,/This verifies database state, not runtime inactivity/i);
assert.match(verification,/missing_exact_signature_count/);
assert.match(verification,/unexpected_guarded_function_count/);
assert.doesNotMatch(verification,/^\s*(?:insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im);
assert.match(runbook,/permanently delete both[\s\S]*populated local SQL copies/i);
assert.match(runbook,/git status[\s\S]*git diff[\s\S]*index\.html[\s\S]*service-worker[\s\S]*staged-global/i);

function base(){return {placeholder:false,user:true,email:true,access:'approved',owner:true,
 device:true,owned:true,row:true,status:'registered',revokedAt:null,revokedBy:null,
 approvedAt:null,approvedBy:null,approvedDevices:0,matchingAudit:0,relatedAudit:0,
 enforcementRows:1,enforcementEnabled:0,audits:[]};}
function apply(s){
  if(s.placeholder)throw Error('literal');
  if(!s.user||!s.email)throw Error('identity');
  if(s.access!=='approved')throw Error('access');
  if(!s.owner)throw Error('owner');
  if(!s.device||!s.owned)throw Error('device');
  if(!s.row)throw Error('row');
  if(s.enforcementRows!==1||s.enforcementEnabled!==0)throw Error('enforcement');
  if(s.revokedAt!==null||s.revokedBy!==null||s.status==='revoked')throw Error('revoked');
  if(s.status==='registered'||s.status==='pending'){
    if(s.approvedDevices||s.matchingAudit||s.relatedAudit)throw Error('conflict');
    s.status='approved';s.approvedAt='once';s.approvedBy='owner';s.approvedDevices=1;
    s.matchingAudit=1;s.relatedAudit=1;s.audits.push('bootstrap');return s;
  }
  if(s.status==='approved'&&s.approvedAt&&s.approvedBy==='owner'&&
     s.approvedDevices===1&&s.matchingAudit===1&&s.relatedAudit===1)return s;
  throw Error('state');
}
function fails(change){var s=Object.assign(base(),change);assert.throws(function(){apply(s);});}
fails({placeholder:true});fails({user:false});fails({email:false});fails({owner:false});
['pending','blocked',null].forEach(function(status){fails({access:status});});
fails({device:false});fails({owned:false});fails({row:false});fails({revokedAt:'past'});
fails({revokedBy:'actor'});fails({approvedDevices:1});fails({relatedAudit:1});
var registered=apply(base());assert.strictEqual(registered.status,'approved');
assert.deepStrictEqual(registered.audits,['bootstrap']);assert.strictEqual(registered.enforcementEnabled,0);
var pending=base();pending.status='pending';apply(pending);assert.strictEqual(pending.status,'approved');
var before=JSON.stringify(registered);apply(registered);assert.strictEqual(JSON.stringify(registered),before);
fails({status:'approved',approvedAt:'once',approvedBy:'owner',approvedDevices:1,matchingAudit:0,relatedAudit:1});

console.log('trusted-owner device bootstrap contract tests: passed');
