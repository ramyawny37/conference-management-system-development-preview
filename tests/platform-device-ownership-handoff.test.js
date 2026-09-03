"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const test = require("node:test");
const { createApiHandler, createGatewayHandler, issueHandoffAssertion } = require("../server/platform-gateway.cjs");

const DEVICE = "f9306733-612d-433f-a38e-5d72855c2fe3";
const USER = "916c0d83-4c5a-4a9e-89bb-4faa671166f7";
const AUTHORIZATION = "11111111-1111-4111-8111-111111111111";
const CHALLENGE = "22222222-2222-4222-8222-222222222222";
const THUMBPRINT = "a".repeat(64);

function listen(handler) { const server = http.createServer(handler); return new Promise((resolve) => server.listen(0,"127.0.0.1",()=>resolve(server))); }
function close(server) { return new Promise((resolve,reject)=>server.close((error)=>error?reject(error):resolve())); }
function origin(server) { return `http://127.0.0.1:${server.address().port}`; }
function response(status,body) { return { status, body: JSON.stringify(body) }; }
function mockResponse(resolve) { return { headers:{},getHeader(name){return this.headers[name];},setHeader(name,value){this.headers[name]=value;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers||{});return this;},end(body){resolve(response(this.status,JSON.parse(body)));} }; }

test("migration is a closed server-only binding contract", () => {
  const sql=fs.readFileSync("supabase/migrations/20260902020000_platform_device_ownership_handoff_1a.sql","utf8");
  for(const value of ["PLATFORM_DEVICE_OWNERSHIP_HANDOFF",DEVICE,"force row level security","revoke all on platform.device_key_bindings","current_device_authorization_id","status='approved'","lifecycle_status='active'","assertion_jti","consumed_at","one_active_device_idx","DEVICE_HANDOFF_BACKEND_REQUIRED","service_role"])
    assert.match(sql,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i"));
  assert.doesNotMatch(sql,/grant\s+(insert|update|delete)\s+on\s+platform\.device_key_bindings\s+to\s+authenticated/i);
  assert.doesNotMatch(sql,/insert\s+into\s+platform\.devices/i);
  assert.doesNotMatch(sql,/update\s+platform\.user_device_authorizations\s+set\s+status/i);
});

test("browser key contract is P-256, non-exportable, IndexedDB-held, and never serializes private material", () => {
  const page=fs.readFileSync("platform-device-ownership-handoff.html","utf8");
  const source=fs.readFileSync("js/platform-device-ownership-handoff.js","utf8");
  assert.match(page,/\.\/js\/storage\/environment-namespace\.js/);
  assert.ok(page.indexOf('js/supabase/auth.js')<page.indexOf('js/supabase/device-identity.js'));
  assert.ok(page.indexOf('js/supabase/device-identity.js')<page.indexOf('js/platform-device-ownership-handoff.js'));
  assert.doesNotMatch(page,/browser-storage-namespace\.js/);
  assert.match(source,/generateKey\(\{name:'ECDSA',namedCurve:'P-256'\},false/);
  assert.match(source,/indexedDB\.open/);assert.match(source,/privateKey\.extractable!==false/);
  assert.match(source,/exportKey\('jwk',key\)/);assert.doesNotMatch(source,/localStorage|sessionStorage|exportKey\([^,]+,\s*keys\.privateKey/);
});

test("successful backend handoff reconciles stale account identity from its proved result", () => {
  const source=fs.readFileSync("js/platform-device-ownership-handoff.js","utf8");
  assert.match(source,/canonicalDeviceId=String\(result\.data&&result\.data\.deviceId/);
  assert.match(source,/canonicalDeviceId!==challenge\.deviceId/);
  assert.match(source,/deviceId:canonicalDeviceId,bindingId:result\.data\.bindingId,state:'active'/);
  const persistence=source.indexOf('activateRecovery(next):persistAt(ACTIVE_RECORD,next)');
  const reconciliation=source.indexOf('reconcileProvedIdentity({id:canonicalDeviceId})');
  assert.ok(persistence>=0&&reconciliation>persistence);
  assert.doesNotMatch(source,/reconcileProvedIdentity\(\{id:DEVICE_ID\}\)/);
});

test("an already-completed recovery passively reconciles without rotating again", () => {
  const source=fs.readFileSync("js/platform-device-ownership-handoff.js","utf8");
  assert.match(source,/function reconcileActiveBinding\(\)/);
  assert.match(source,/action:'status'/);
  assert.match(source,/proved\.status!=='active'/);
  assert.match(source,/String\(proved\.deviceId\|\|''\)!==record\.deviceId/);
  assert.match(source,/String\(proved\.bindingId\|\|''\)!==record\.bindingId/);
  assert.match(source,/reconcileProvedIdentity\(\{id:String\(proved\.deviceId\)\}\)/);
  assert.match(source,/if\(reconciled\)\{show\('The active Development binding and browser device identity are reconciled\.'/);
});

test("real WebCrypto non-exportable P-256 key proves possession and rejects private-key export",async()=>{
  const keys=await crypto.webcrypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
  assert.equal(keys.privateKey.extractable,false);assert.equal(keys.publicKey.extractable,true);
  await assert.rejects(crypto.webcrypto.subtle.exportKey("jwk",keys.privateKey));
  const publicJwk=await crypto.webcrypto.subtle.exportKey("jwk",keys.publicKey);
  assert.equal(publicJwk.d,undefined);assert.equal(publicJwk.crv,"P-256");
  const payload=Buffer.from("canonical handoff challenge");
  const signature=await crypto.webcrypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},keys.privateKey,payload);
  assert.equal(await crypto.webcrypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},keys.publicKey,signature,payload),true);
  assert.equal(await crypto.webcrypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},keys.publicKey,signature,Buffer.from("altered")),false);
});

test("assertion is short-lived HS256 and bound to every migration dimension", () => {
  const old={...process.env};
  process.env.PLATFORM_HANDOFF_ASSERTION_SECRET="s".repeat(32);
  process.env.PLATFORM_HANDOFF_ASSERTION_ISSUER="development-migration-bridge";
  process.env.PLATFORM_HANDOFF_ASSERTION_AUDIENCE="development-edge-handoff";
  try{
    const jwt=issueHandoffAssertion({userId:USER,deviceId:DEVICE,authorizationId:AUTHORIZATION,publicKeyThumbprint:THUMBPRINT,challengeId:CHALLENGE});
    const [header,payload,signature]=jwt.split(".");const claims=JSON.parse(Buffer.from(payload,"base64url"));
    assert.deepEqual(JSON.parse(Buffer.from(header,"base64url")),{alg:"HS256",typ:"JWT"});
    assert.equal(claims.purpose,"PLATFORM_DEVICE_OWNERSHIP_HANDOFF");
    assert.equal(claims.user_id,USER);assert.equal(claims.device_id,DEVICE);assert.equal(claims.authorization_id,AUTHORIZATION);
    assert.equal(claims.public_key_thumbprint,THUMBPRINT);assert.equal(claims.challenge_id,CHALLENGE);assert.ok(claims.jti);
    assert.equal(claims.signing_payload_hash,crypto.createHash("sha256").update("").digest("hex"));
    assert.equal(claims.exp-claims.iat,90);assert.equal(signature,crypto.createHmac("sha256",process.env.PLATFORM_HANDOFF_ASSERTION_SECRET).update(`${header}.${payload}`).digest("base64url"));
  }finally{process.env=old;}
});

test("gateway uses only the authoritative current f930 device and returns one challenge-bound assertion", async()=>{
  const calls=[];const signingPayload="bound-payload";
  const supabase={schema:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{userId:USER,deviceId:DEVICE,authorizationId:AUTHORIZATION,challengeId:CHALLENGE,publicKeyThumbprint:THUMBPRINT,signingPayload},error:null};}})};
  const old={...process.env};process.env.PLATFORM_HANDOFF_ASSERTION_SECRET="s".repeat(32);process.env.PLATFORM_HANDOFF_ASSERTION_ISSUER="development-migration-bridge";process.env.PLATFORM_HANDOFF_ASSERTION_AUDIENCE="development-edge-handoff";
  const api=createApiHandler({platformAdministrationClient:async()=>({device:{id:DEVICE,secret:"not-exposed"},supabase,user:{id:USER}})});
  const server=await listen(createGatewayHandler({handleApi:api}));try{
    const result=await fetch(`${origin(server)}/api/platform/device-ownership-handoff/authorize?thumbprint=${THUMBPRINT}`,{redirect:"manual"});assert.equal(result.status,302);
    assert.match(result.headers.get("location"),/^https:\/\/ramyawny37\.github\.io\/conference-management-system-v1\/platform-device-ownership-handoff\.html#handoff=/);
    assert.deepEqual(calls.map(x=>x.name),["begin_current_device_ownership_handoff"]);
  }finally{process.env=old;await close(server);}
});

test("known f930 UUID without the current secret context and every altered authority dimension are denied", async()=>{
  for(const variant of [
    {device:null,status:403},
    {device:{id:"9bce8898-0000-4000-8000-000000000000"},status:403},
  ]){
    const api=createApiHandler({platformAdministrationClient:async()=>variant.device?({device:variant.device,supabase:{},user:{id:USER}}):({error:"PLATFORM_APPROVED_DEVICE_REQUIRED",status:403}),readJson:async()=>({publicKeyThumbprint:THUMBPRINT})});
    await new Promise((resolve)=>api({method:"GET",url:`/api/platform/device-ownership-handoff/authorize?thumbprint=${THUMBPRINT}`,headers:{host:"test"}},{...mockResponse(resolve)},"/api/platform/device-ownership-handoff/authorize")).then((result)=>assert.equal(result.status,variant.status));
  }
  const edge=fs.readFileSync("supabase/functions/platform-device-ownership-handoff/index.ts","utf8");
  for(const denial of ["HANDOFF_ASSERTION_SIGNATURE_INVALID","HANDOFF_ASSERTION_CLAIMS_INVALID","HANDOFF_ASSERTION_USER_MISMATCH","HANDOFF_PUBLIC_KEY_THUMBPRINT_MISMATCH","HANDOFF_CHALLENGE_PAYLOAD_MISMATCH","NEW_KEY_POSSESSION_INVALID","HANDOFF_ORIGIN_DENIED"])
    assert.match(edge,new RegExp(denial));
  assert.doesNotMatch(edge,/deviceSecretVerified|register_current_device|conference|warehouse|reservation|custody/i);
});

test("diagnostics expose only a sanitized Edge code and a bounded handoff stage",()=>{
  const edge=fs.readFileSync("supabase/functions/platform-device-ownership-handoff/index.ts","utf8");
  const client=fs.readFileSync("js/platform-device-ownership-handoff.js","utf8");
  for(const stage of ["AUTH","ASSERTION_FORMAT","ASSERTION_SIGNATURE","ASSERTION_CLAIMS","USER_BINDING","PUBLIC_KEY","PAYLOAD_HASH","NEW_KEY_POSSESSION","DB_FINALIZATION"])
    assert.match(edge,new RegExp(`['\"]${stage}['\"]`));
  assert.match(edge,/console\.error\(JSON\.stringify\(\{ code, stage: handoffStage\(code\), timestamp,/);
  assert.doesNotMatch(edge,/console\.error\([^\n]*(assertion|authorization|publicJwk|signingPayload|request\.headers)/);
  assert.match(client,/context\.json\(\)/);
  assert.match(client,/safeEdgeCode/);
  assert.match(client,/if\(code\)throw \{code:code\}/);
});

test("replay, expiry, wrong user/device/authorization/key/purpose, and inactive authority are database-denied",()=>{
  const sql=fs.readFileSync("supabase/migrations/20260902020000_platform_device_ownership_handoff_1a.sql","utf8");
  for(const fragment of ["challenge.consumed_at is not null","challenge.expires_at<=statement_timestamp()","challenge.user_id<>p_user_id","challenge.device_id<>p_device_id","challenge.device_authorization_id<>p_authorization_id","challenge.public_key_thumbprint<>p_public_key_thumbprint","challenge.purpose<>'PLATFORM_DEVICE_OWNERSHIP_HANDOFF'","authorization.status='approved'","device.lifecycle_status='active'","profile.account_status='approved'"])
    assert.ok(sql.includes(fragment),fragment);
});
