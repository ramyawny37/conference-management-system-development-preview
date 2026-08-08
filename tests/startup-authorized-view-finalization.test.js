'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.resolve(__dirname,'../js/sync/startup-access-gate.js'),'utf8');
function runtime(fail){
  const ids=['startupAccessGate','applicationTopbar','applicationBody','startupScreen','globalConferenceHeader','device_authorization_administration_root','tab0','tab1','tab2','tab3','tab4','tab5','tab6'],nodes={};
  ids.forEach(id=>nodes[id]={style:{display:id==='startupAccessGate'?'flex':''},innerHTML:''});
  let release,reject,pipelineCalls=0;
  const pipeline=new Promise((resolve,rejectPromise)=>{release=resolve;reject=rejectPromise;});
  const window={document:{getElementById:id=>nodes[id],addEventListener:()=>{}},setTimeout:fn=>fn(),clearTimeout:()=>{},SupabaseAuth:{initialize:()=>Promise.resolve(),getState:()=>({authenticated:true})},SupabaseClientLayer:{getClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{}}})}})},FirstSystemBootstrapService:{getStatus:()=>Promise.resolve({ok:true,status:'completed'})},SystemAccessService:{initialize:()=>Promise.resolve(),refresh:()=>Promise.resolve(),getState:()=>({accountStatus:'approved',fresh:true})},CurrentDeviceAuthorizationUI:{initialize:()=>Promise.resolve(),refresh:()=>Promise.resolve(),getState:()=>({status:'approved'})}};
  vm.runInNewContext(source,{window,Promise,Date,Error});
  const run=window.StartupAccessGate.run({completeApplicationStartup:()=>{pipelineCalls++;return pipeline;}});
  return {window,nodes,run,release:()=>{nodes.applicationBody.style.display='block';release(true);},reject:()=>reject(new Error(fail||'PIPELINE_FAILED')),calls:()=>pipelineCalls};
}
(async()=>{
  const approved=runtime();await new Promise(resolve=>setImmediate(resolve));
  let state=approved.window.StartupAccessGate.getState();assert.strictEqual(state.authorizationPassed,true);assert.strictEqual(state.allowed,true);assert.strictEqual(state.pipelineState,'running');assert.strictEqual(state.applicationVisible,false);assert.strictEqual(approved.nodes.applicationBody.style.display,'none');assert.strictEqual(approved.nodes.startupAccessGate.style.display,'flex');
  const overlap=approved.window.StartupAccessGate.evaluate();assert.strictEqual(approved.calls(),1);approved.release();const result=await approved.run;await overlap;assert.strictEqual(result.status,'allowed');state=approved.window.StartupAccessGate.getState();assert.strictEqual(state.pipelineState,'completed');assert.strictEqual(state.applicationVisible,true);assert.strictEqual(approved.nodes.startupAccessGate.style.display,'none');assert.strictEqual(approved.nodes.applicationBody.style.display,'block');
  const failed=runtime();await new Promise(resolve=>setImmediate(resolve));failed.reject();const failure=await failed.run;assert.strictEqual(failure.status,'denied');state=failed.window.StartupAccessGate.getState();assert.strictEqual(state.allowed,false);assert.strictEqual(state.applicationVisible,false);assert.strictEqual(state.pipelineState,'failed');assert.strictEqual(failed.nodes.applicationBody.style.display,'none');assert.strictEqual(failed.nodes.startupAccessGate.style.display,'flex');
  console.log('startup authorized view finalization tests: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
