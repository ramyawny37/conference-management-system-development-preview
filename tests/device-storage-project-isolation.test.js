'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const read=file=>fs.readFileSync(file,'utf8');
const namespaceSource=read('js/supabase/device-storage-namespace.js');
const identitySource=read('js/supabase/device-identity.js');
const enrollmentSource=read('js/supabase/device-enrollment.js');
const sessionSource=read('js/supabase/device-session.js');
const DEV='gppwltrifgfxrkzvvxoe',PROD='mpezfbvcdfxpgflehuot';
const USER='11111111-1111-4111-8111-111111111111';
const DEVICE='22222222-2222-4222-8222-222222222222';
const BINDING='33333333-3333-4333-8333-333333333333';

function namespace(projectRef,environment){
  const sandbox={URL,SUPABASE_RUNTIME_CONFIG:{url:'https://'+projectRef+'.supabase.co'},BrowserStorageNamespace:{environment,projectRef:environment==='development'?projectRef:null,key:name=>(environment==='development'?'dev:':'')+name}};
  sandbox.window=sandbox;vm.runInNewContext(namespaceSource,sandbox);return sandbox.PlatformDeviceStorageNamespace;
}

function storage(){const values={};return {values,getItem:key=>values[key]||null,setItem:(key,value)=>{values[key]=String(value);}};}

function indexedDb(initial){
  const databases=new Map(Object.entries(initial||{}).map(([name,rows])=>[name,rows.slice()]));
  const opens=[];
  return {databases,opens,open(name){opens.push(name);const request={};queueMicrotask(()=>{const created=!databases.has(name);if(created)databases.set(name,[]);request.result={objectStoreNames:{contains:()=>!created},createObjectStore(){},transaction(){const tx={objectStore(){return {getAll(){const result={result:databases.get(name).slice()};queueMicrotask(()=>result.onsuccess());return result;},put(record,key){const rows=databases.get(name),index=rows.findIndex(row=>row.__key===key);const stored=Object.assign({__key:key},record);if(index<0)rows.push(stored);else rows[index]=stored;queueMicrotask(()=>tx.oncomplete&&tx.oncomplete());}};},close(){}};return tx;},close(){}};if(created&&request.onupgradeneeded)request.onupgradeneeded();request.onsuccess();});return request;}};
}

test('project ref scopes IndexedDB and device identity, including the same user UUID',()=>{
  const dev=namespace(DEV,'development'),prod=namespace(PROD,'production');
  assert.equal(dev.databaseName(),'platform-device-ownership-v1:'+DEV);
  assert.equal(prod.databaseName(),'platform-device-ownership-v1:'+PROD);
  assert.notEqual(dev.databaseName(),prod.databaseName());
  assert.equal(dev.identityKey(USER),'device-identity:'+DEV+':'+USER);
  assert.equal(prod.identityKey(USER),'device-identity:'+PROD+':'+USER);
  const local=storage();
  function identity(ns,id){const sandbox={PlatformDeviceStorageNamespace:ns,SupabaseAuth:{getSession:()=>({user:{id:USER}})},localStorage:local,crypto:{randomUUID:()=>id},navigator:{platform:'test'},JSON,Object,String,Date,Uint8Array,Array,Error};sandbox.window=sandbox;vm.runInNewContext(identitySource,sandbox);return sandbox.SupabaseDeviceIdentity.getOrCreate();}
  assert.equal(identity(dev,DEVICE).id,DEVICE);
  const prodDevice='44444444-4444-4444-8444-444444444444';
  assert.equal(identity(prod,prodDevice).id,prodDevice);
  assert.notEqual(JSON.parse(local.values[dev.identityKey(USER)]).id,JSON.parse(local.values[prod.identityKey(USER)]).id);
});

function enrollmentRuntime(ns,db,status){
  const calls=[];const sandbox={PlatformDeviceStorageNamespace:ns,indexedDB:db,SupabaseAuth:{initialize:()=>Promise.resolve({authenticated:true,user:{id:USER}}),getSession:()=>({user:{id:USER}})},SupabaseDeviceIdentity:{reconcileProvedIdentity:value=>({success:true,identity:value})},SupabaseClientLayer:{getClient:()=>({functions:{invoke(name,request){calls.push(request.body);if(request.body.action==='status')return Promise.resolve({data:{ok:true,data:status}});return Promise.reject(new Error('NEW_ENROLLMENT_REACHED'));}}})},crypto:{getRandomValues:value=>value,subtle:{exportKey:()=>Promise.reject(new Error('non-exportable')),generateKey:()=>Promise.reject(new Error('NEW_ENROLLMENT_REACHED'))}},navigator:{},Promise,Error,Date,Object,Array,String,Number,JSON,Uint8Array,TextEncoder,btoa:value=>Buffer.from(value,'binary').toString('base64'),queueMicrotask};sandbox.window=sandbox;vm.runInNewContext(enrollmentSource,sandbox);return {api:sandbox.PlatformDeviceEnrollment,calls};
}

test('only backend-proved Development legacy key is reconciled, without deleting legacy state',async()=>{
  const dev=namespace(DEV,'development'),legacy={privateKey:{kind:'dev-key'},publicKeyThumbprint:'dev-thumb',deviceId:DEVICE,bindingId:BINDING,state:'active',createdAt:'2026-01-01'};
  const db=indexedDb({'platform-device-ownership-v1':[legacy]});
  const runtime=enrollmentRuntime(dev,db,{status:'approved',deviceId:DEVICE,bindingId:BINDING,publicKeyThumbprint:'dev-thumb'});
  const result=await runtime.api.ensure();
  assert.equal(result.status,'approved');
  assert.equal(db.databases.get(dev.databaseName())[0].privateKey.kind,'dev-key');
  assert.equal(db.databases.get('platform-device-ownership-v1')[0].privateKey.kind,'dev-key');
  assert.equal(JSON.stringify(runtime.calls),JSON.stringify([{action:'status',bindingId:BINDING}]));
});

test('Production never opens or auto-adopts the unscoped legacy database',async()=>{
  const prod=namespace(PROD,'production'),db=indexedDb({'platform-device-ownership-v1':[{privateKey:{kind:'dev-key'},publicKeyThumbprint:'dev-thumb',deviceId:DEVICE,bindingId:BINDING,state:'active'}]});
  const runtime=enrollmentRuntime(prod,db,{status:'approved',deviceId:DEVICE,bindingId:BINDING,publicKeyThumbprint:'dev-thumb'});
  await assert.rejects(runtime.api.ensure(),/NEW_ENROLLMENT_REACHED/);
  assert.deepEqual(db.opens,[prod.databaseName()]);
  assert.equal(runtime.calls.length,0);
});

function sessionRuntime(ns,db){
  const signs=[],calls=[];const sandbox={PlatformDeviceStorageNamespace:ns,indexedDB:db,SupabaseDeviceIdentity:{getOrCreate:()=>({id:DEVICE})},SupabaseAuth:{initialize:()=>Promise.resolve({authenticated:true,user:{id:USER}})},SupabaseClientLayer:{getClient:()=>({functions:{invoke(name,request){calls.push(request.body);if(request.body.action==='begin')return Promise.resolve({data:{ok:true,data:{challengeId:'challenge',userId:USER,bindingId:BINDING,deviceId:DEVICE,publicKeyThumbprint:ns.projectRef()+'-thumb',purpose:'PLATFORM_DEVICE_SESSION_ESTABLISH',origin:'https://ramyawny37.github.io',signingPayload:'payload'}}});if(request.body.action==='establish')return Promise.resolve({data:{ok:true,data:{sessionId:'session',token:'token',userId:USER,deviceId:DEVICE,authorizationId:'auth',bindingId:BINDING,issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}}});if(request.body.action==='verify')return Promise.resolve({data:{ok:true,data:{verified:true}}});}}})},crypto:{subtle:{exportKey:()=>Promise.reject(new Error('non-exportable')),sign(options,key){signs.push(key.kind);return Promise.resolve(new Uint8Array(64));}}},document:{dispatchEvent(){}},setTimeout:()=>1,clearTimeout(){},Promise,Error,Date,Object,Array,String,Number,JSON,Uint8Array,TextEncoder,CustomEvent:function(){},btoa:value=>Buffer.from(value,'binary').toString('base64'),queueMicrotask};sandbox.window=sandbox;vm.runInNewContext(sessionSource,sandbox);return {api:sandbox.PlatformDeviceSession,signs,calls};
}

test('Development and Production sessions see and sign only their own project key',async()=>{
  const dev=namespace(DEV,'development'),prod=namespace(PROD,'production');
  const db=indexedDb({[dev.databaseName()]:[{state:'active',deviceId:DEVICE,bindingId:BINDING,publicKeyThumbprint:DEV+'-thumb',privateKey:{kind:'dev-key'}}],[prod.databaseName()]:[{state:'active',deviceId:DEVICE,bindingId:BINDING,publicKeyThumbprint:PROD+'-thumb',privateKey:{kind:'prod-key'}}]});
  const devSession=sessionRuntime(dev,db),prodSession=sessionRuntime(prod,db);
  await devSession.api.establish();await prodSession.api.establish();
  assert.deepEqual(devSession.signs,['dev-key']);assert.deepEqual(prodSession.signs,['prod-key']);
  const devOnly=indexedDb({[dev.databaseName()]:db.databases.get(dev.databaseName())});
  await assert.rejects(sessionRuntime(prod,devOnly).api.establish(),/BOUND_PRIVATE_KEY_REQUIRED/);
  const prodOnly=indexedDb({[prod.databaseName()]:db.databases.get(prod.databaseName())});
  await assert.rejects(sessionRuntime(dev,prodOnly).api.establish(),/BOUND_PRIVATE_KEY_REQUIRED/);
});

test('runtime sources preserve non-exportability and contain no fallback, bypass, deletion, clearing, or logout',()=>{
  const sources=[namespaceSource,identitySource,enrollmentSource,sessionSource].join('\n');
  assert.match(enrollmentSource,/generateKey\([^\n]+,false,\['sign','verify'\]\)/);
  assert.match(enrollmentSource,/verifyNonExportable/);assert.match(sessionSource,/verifyNonExportable/);
  assert.doesNotMatch(sources,/device-secret|deleteDatabase|localStorage\.clear|sessionStorage\.clear|signOut\(|automatic approval/i);
});
