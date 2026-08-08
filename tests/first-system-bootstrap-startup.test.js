'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.resolve(__dirname,'../js/sync/startup-access-gate.js'),'utf8');
function environment(status){
  const ids=['startupAccessGate','applicationBody','applicationTopbar','startupScreen','globalConferenceHeader','device_authorization_administration_root','current_device_authorization_root','tab0','tab1','tab2','tab3','tab4','tab5','tab6'],nodes={};
  ids.forEach(id=>nodes[id]={style:{},innerHTML:'',value:''});
  let systemReads=0,home=0;
  const window={document:{getElementById:id=>nodes[id]||null},SupabaseAuth:{initialize:()=>Promise.resolve(),getState:()=>({authenticated:true,user:{email:'fresh@example.test',user_metadata:{display_name:'Fresh Owner'}}})},SupabaseClientLayer:{getClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{}}})}})},FirstSystemBootstrapService:{getStatus:()=>Promise.resolve({ok:true,status}),complete:()=>Promise.resolve({ok:true,status:'completed'})},SystemAccessService:{initialize:()=>{systemReads++;return Promise.resolve();},refresh:()=>Promise.resolve(),getState:()=>({accountStatus:'pending',fresh:true})},CurrentDeviceAuthorizationUI:{},SyncSettingsUI:{}};
  vm.runInNewContext(source,{window,Promise,setTimeout:fn=>fn()});
  return window.StartupAccessGate.run({completeApplicationStartup:()=>{home++;}}).then(result=>({result,nodes,systemReads,home}));
}
(async()=>{const required=await environment('setup_required');assert.strictEqual(required.result.status,'first_setup');assert(required.nodes.startupAccessGate.innerHTML.includes('إعداد النظام لأول مرة'));assert.strictEqual(required.systemReads,0);assert.strictEqual(required.home,0);const closed=await environment('not_provisioned');assert.strictEqual(closed.result.status,'denied');assert.strictEqual(closed.systemReads,0);assert.strictEqual(closed.home,0);const completed=await environment('completed');assert.strictEqual(completed.result.status,'pending');assert.strictEqual(completed.systemReads,1);console.log('first system bootstrap startup tests: passed');})().catch(error=>{console.error(error);process.exitCode=1;});
