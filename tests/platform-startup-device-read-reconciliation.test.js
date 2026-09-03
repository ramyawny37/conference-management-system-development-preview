"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),test=require("node:test"),vm=require("node:vm");
const migration=fs.readFileSync("supabase/migrations/20260903170000_startup_device_authorization_read_reconciliation.sql","utf8");
const contractSource=fs.readFileSync("js/supabase/conference-device-operation-contract.js","utf8");
const sandbox={window:{}};vm.runInNewContext(contractSource,sandbox);const contract=sandbox.window.ConferenceDeviceOperationContract;

function resolve(canonical,legacy){
  if(canonical){
    if(!canonical.devicePresent)return "revoked";
    if(canonical.status==="approved"&&!canonical.revoked&&canonical.lifecycle==="active"&&!canonical.retired&&!canonical.compromised)return "approved";
    if(canonical.status==="pending"&&!canonical.revoked)return "pending";
    return "revoked";
  }
  return legacy||"not_registered";
}
function resolveFor(userId,deviceId,canonicalRows,legacyRows){
  const canonical=canonicalRows.find(row=>row.userId===userId&&row.deviceId===deviceId);
  const legacy=legacyRows.find(row=>row.userId===userId&&row.deviceId===deviceId);
  return resolve(canonical,legacy&&legacy.status);
}

test("canonical Platform relationship wins with usable-device approval semantics",()=>{
  assert.equal(resolve({devicePresent:true,status:"approved",revoked:false,lifecycle:"active",retired:false,compromised:false},"pending"),"approved");
  assert.equal(resolve({devicePresent:true,status:"pending",revoked:false,lifecycle:"active",retired:false,compromised:false},"approved"),"pending");
  assert.equal(resolve({devicePresent:true,status:"approved",revoked:true,lifecycle:"active",retired:false,compromised:false},"approved"),"revoked");
  assert.equal(resolve({devicePresent:true,status:"approved",revoked:false,lifecycle:"retired",retired:true,compromised:false},"approved"),"revoked");
  assert.equal(resolve({devicePresent:true,status:"approved",revoked:false,lifecycle:"compromised",retired:false,compromised:true},"approved"),"revoked");
  assert.equal(resolve({devicePresent:true,status:"revoked",revoked:true,lifecycle:"active",retired:false,compromised:false},"approved"),"revoked");
  assert.equal(resolve(null,"pending"),"pending");
});

test("resolver is exact-user/exact-device, unambiguous, and inaccessible to API roles",()=>{
  assert.match(migration,/where uda\.user_id=p_user_id and uda\.device_id=p_device_id/);
  assert.match(migration,/left join platform\.devices device on device\.id=uda\.device_id/);
  assert.match(migration,/where legacy\.user_id=p_user_id and legacy\.device_id=p_device_id/);
  assert.doesNotMatch(migration,/where (?:uda|legacy)\.device_id=p_device_id(?![\s\S]{0,80}user_id=p_user_id)/);
  assert.match(migration,/revoke all on function platform_private\.resolve_startup_device_authorization_status\(uuid,uuid\)[\s\S]*from public,anon,authenticated,service_role/);
  assert.doesNotMatch(migration,/grant execute/i);
  assert.doesNotMatch(migration,/insert\s+into|update\s+platform\.|delete\s+from|alter\s+table/i);
});

test("another user's device relationship is never returned as the caller's approval",()=>{
  const canonical=[{userId:"other",deviceId:"device",devicePresent:true,status:"approved",revoked:false,lifecycle:"active",retired:false,compromised:false}];
  assert.equal(resolveFor("caller","device",canonical,[]),"not_registered");
});

test("both direct reads share the resolver and preserve their JSON shapes",()=>{
  assert.equal((migration.match(/resolve_startup_device_authorization_status\(current_user_id,p_device_id\)/g)||[]).length,2);
  for(const key of ["systemAccessStatus","deviceAuthorizationStatus","enforcementEnabled"])assert.ok(migration.includes("'"+key+"'"),key);
  for(const key of ["userId","accountStatus","canCreateConferences","systemRoles","isSystemOwner","isSystemAdmin","checkedAt"])assert.ok(migration.includes("'"+key+"'"),key);
  assert.match(migration,/if found then return v_status; end if;[\s\S]*from public\.user_device_authorizations legacy/);
});

test("operation cardinalities and protected boundary remain unchanged",()=>{
  assert.deepEqual([contract.DIRECT_BROWSER_REQUIRED.length,contract.EDGE_ONLY_PROTECTED.length,contract.INTERNAL_ONLY.length,contract.POLICY_HELPER_BROWSER_READ.length],[13,57,16,9]);
  assert.equal(new Set(contract.EDGE_ONLY_PROTECTED.map(x=>x.operation)).size,57);
  assert.equal(new Set(contract.EDGE_ONLY_PROTECTED.map(x=>x.signature)).size,57);
  assert.doesNotMatch(migration,/execute_conference_device_operation|device_guarded_|grant execute/i);
});
