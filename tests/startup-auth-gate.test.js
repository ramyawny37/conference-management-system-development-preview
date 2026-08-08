'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.resolve(__dirname,'../js/sync/startup-access-gate.js'),'utf8');
function scenario(authenticated,accountStatus,deviceStatus){
  const ids=['startupAccessGate','applicationTopbar','applicationBody','startupScreen','globalConferenceHeader','device_authorization_administration_root','current_device_authorization_root','tab0','tab1','tab2','tab3','tab4','tab5','tab6'],nodes={};ids.forEach(id=>nodes[id]={id,style:{display:id==='startupAccessGate'?'flex':''},innerHTML:''});
  let home=0,listener=null;const authState={authenticated:authenticated};
  const window={document:{getElementById:id=>nodes[id]},SupabaseAuth:{initialize:()=>Promise.resolve(),getState:()=>authState},SupabaseClientLayer:{getClient:()=>({auth:{onAuthStateChange:fn=>{listener=fn;return {data:{subscription:{}}};}}})},FirstSystemBootstrapService:{getStatus:()=>Promise.resolve({ok:true,status:'completed'})},SystemAccessService:{initialize:()=>Promise.resolve(),refresh:()=>Promise.resolve(),getState:()=>({accountStatus:accountStatus,fresh:true})},CurrentDeviceAuthorizationUI:{initialize:()=>Promise.resolve(),refresh:()=>Promise.resolve(),getState:()=>({status:deviceStatus})},SyncSettingsUI:{}};
  const sandbox={window,setTimeout:fn=>fn(),Promise};vm.runInNewContext(source,sandbox);
  return window.StartupAccessGate.run({completeApplicationStartup:()=>{home++;nodes.applicationBody.style.display='block';}}).then(result=>({result,nodes,home,gate:window.StartupAccessGate,listener,authState}));
}
(async()=>{
  for(const status of ['pending','blocked']){const x=await scenario(true,status,'approved');assert.strictEqual(x.result.status,status);assert.strictEqual(x.home,0);assert.strictEqual(x.nodes.tab0.style.display,'none');}
  for(const device of ['pending','revoked']){const x=await scenario(true,'approved',device);assert.strictEqual(x.result.status,'device');assert.strictEqual(x.home,0);assert.strictEqual(x.nodes.tab0.style.display,'none');}
  const noSession=await scenario(false,null,null);assert.strictEqual(noSession.result.status,'auth');assert(noSession.nodes.startupAccessGate.innerHTML.includes('إدارة المؤتمرات'));assert(!noSession.nodes.startupAccessGate.innerHTML.includes('sync_auth_email'));noSession.gate.showAuthView('login');assert(noSession.nodes.startupAccessGate.innerHTML.includes('sync_auth_email'));assert(!noSession.nodes.startupAccessGate.innerHTML.includes('sync_signup_email'));noSession.gate.showAuthView('signup');assert(noSession.nodes.startupAccessGate.innerHTML.includes('sync_signup_email'));assert(!noSession.nodes.startupAccessGate.innerHTML.includes('sync_auth_email'));assert.strictEqual(noSession.home,0);assert.strictEqual(noSession.nodes.applicationBody.style.display,'none');
  const approved=await scenario(true,'approved','approved');assert.strictEqual(approved.result.status,'allowed');assert.strictEqual(approved.home,1);
  for(const event of ['INITIAL_SESSION','TOKEN_REFRESHED','SIGNED_IN']){approved.listener(event,{user:{id:'same-user'}});await new Promise(resolve=>setImmediate(resolve));assert.strictEqual(approved.home,1,event+' must not duplicate startup');assert.strictEqual(approved.gate.isAllowed(),true,event+' must preserve authorization');assert.strictEqual(approved.nodes.startupAccessGate.style.display,'none',event+' must keep the gate hidden');assert.strictEqual(approved.nodes.applicationBody.style.display,'block',event+' must keep the application visible');}
  await Promise.all([approved.gate.evaluate(),approved.gate.evaluate()]);assert.strictEqual(approved.home,1);assert.strictEqual(approved.gate.isAllowed(),true);assert.strictEqual(approved.nodes.startupAccessGate.style.display,'none');assert.strictEqual(approved.nodes.applicationBody.style.display,'block');
  approved.authState.authenticated=false;approved.listener('SIGNED_OUT',null);await new Promise(resolve=>setImmediate(resolve));assert.strictEqual(approved.nodes.applicationBody.style.display,'none');assert(approved.nodes.startupAccessGate.innerHTML.includes('إدارة المؤتمرات'));
  const script=fs.readFileSync(path.resolve(__dirname,'../script.js'),'utf8');
  assert.match(script,/window\.applicationStorageReadyPromise=null;[\s\S]*StartupAccessGate\.run/);
  assert.match(script,/completeApplicationStartup:completeAuthorizedApplicationStartup/);
  ['switchTab','openSettingsFromHome','openNewConferenceModal','setCurrentConferenceById','loadFromFile','showSelectConferenceModal'].forEach(name=>assert.match(script,new RegExp('function '+name+'\\([^)]*\\)\\{\\s*if\\(window\\.StartupAccessGate')));
  console.log('startup auth gate tests: passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
