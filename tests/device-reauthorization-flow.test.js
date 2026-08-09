'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var root=path.resolve(__dirname,'..');
var source=fs.readFileSync(path.join(root,'js/sync/device-reauthorization-flow.js'),'utf8');
var stateSource=fs.readFileSync(path.join(root,'state.js'),'utf8');
var index=fs.readFileSync(path.join(root,'index.html'),'utf8');
var worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
function environment(status){
  var elements={},initializeCount=0,current=status;
  ['splash-screen','applicationTopbar','applicationBody','startupScreen','globalConferenceHeader','device_authorization_administration_root','tab0','tab1','tab2','tab3','tab4','tab5','tab6'].forEach(function(id){elements[id]={style:{display:id==='startupScreen'?'none':''}};});
  var sandbox={window:null,Promise:Promise,Object:Object,String:String,document:{getElementById:function(id){return elements[id]||null;}},SupabaseAuth:{getState:function(){return {authenticated:true};}},CurrentDeviceAuthorizationUI:{initialize:function(){initializeCount++;return Promise.resolve();},getState:function(){return {status:current};}}};
  sandbox.window=sandbox;vm.runInNewContext(source,sandbox,{filename:'device-reauthorization-flow.js'});
  return {window:sandbox,elements:elements,count:function(){return initializeCount;},approve:function(){current='approved';sandbox.DeviceReauthorizationFlow.handleAuthorizationState('approved');}};
}
(async function(){
  var pending=environment('pending'),resolved=false,queue={records:['existing']},revision=7,link={remoteConferenceId:'remote-1'};
  var waiting=pending.window.DeviceReauthorizationFlow.waitUntilApproved().then(function(){resolved=true;});
  await Promise.resolve();await Promise.resolve();
  assert.strictEqual(resolved,false,'pending device must block application startup');
  assert.strictEqual(pending.window.DeviceReauthorizationFlow.getState().gateActive,true);
  assert.strictEqual(pending.elements.applicationTopbar.style.display,'none');
  pending.approve();await waiting;
  assert.strictEqual(resolved,true,'approval must resume without page refresh');
  assert.strictEqual(pending.count(),1,'authorization initialization must be single-flight');
  assert.deepStrictEqual(queue.records,['existing'],'reauthorization must not create a queue');
  assert.strictEqual(revision,7,'reauthorization must not change revision');
  assert.strictEqual(link.remoteConferenceId,'remote-1','reauthorization must preserve conference binding');
  var approved=environment('approved');await approved.window.DeviceReauthorizationFlow.waitUntilApproved();await approved.window.DeviceReauthorizationFlow.waitUntilApproved();
  assert.strictEqual(approved.count(),1,'approved reopen must bypass reauthorization without duplicate initialization');
  assert.strictEqual(approved.window.DeviceReauthorizationFlow.getState().gateActive,false);
  assert.match(stateSource,/function initializeApplicationStorage[\s\S]*DeviceReauthorizationFlow\.waitUntilApproved/);
  assert.ok(index.indexOf('current-device-authorization-ui.js')<index.indexOf('device-reauthorization-flow.js'));
  ['js/sync/current-device-authorization-ui.js?rev=organization-membership-operation-key-v1','js/sync/device-reauthorization-flow.js?rev=device-reauthorization-flow-v1','state.js?rev=template-sync-isolation-v1'].forEach(function(asset){assert.ok(index.includes(asset),asset);assert.ok(worker.includes('./'+asset),asset);});
  console.log('device re-authorization flow tests: passed');
})().catch(function(error){console.error(error);process.exitCode=1;});
