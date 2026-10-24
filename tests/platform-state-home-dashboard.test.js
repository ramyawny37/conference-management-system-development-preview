'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
const integration=fs.readFileSync('js/platform-integration.js','utf8');
const dashboard=fs.readFileSync('js/platform-home-dashboard.js','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

test('Platform root owns a dashboard workspace independent from Conference home',()=>{
  assert.match(html,/id="platformHomeWorkspace"[\s\S]*?id="conferenceWorkspace"/);
  assert.match(html,/id="platformHomeModules"/);
  assert.match(html,/id="platformHomeActivity"/);
  assert.match(html,/id="platformHomeActions"/);
  assert.match(html,/id="platformHomeAlerts"/);
  assert.match(fs.readFileSync('script.js','utf8'),/showPlatformModules[\s\S]*ge\('platformHomeWorkspace'\)/);
});

test('dashboard reads module-owned protected services without a local data authority',()=>{
  assert.match(dashboard,/invoke\(module,'check_module_access',\{\}\)/);
  assert.match(dashboard,/StartupConferenceDiscovery/);
  assert.match(dashboard,/get_dashboard_summary/);
  assert.match(dashboard,/discover_stores/);
  assert.match(dashboard,/listSystemOwnerPendingDevices/);
  assert.doesNotMatch(dashboard,/localStorage|sessionStorage|indexedDB|\.from\(|\.rpc\(/);
});

test('permission-denied modules expose no counts or actions',async()=>{
  const nodes=new Map(['platformHomeWorkspace','platformHomeConnectivity','platformHomeModules','platformHomeActivity','platformHomeActions','platformHomeAlerts'].map(id=>[id,{innerHTML:'',textContent:'',classList:{add(){},remove(){}},addEventListener(){}}]));
  const listeners={};
  const window={navigator:{onLine:true},document:{getElementById:id=>nodes.get(id)||null,querySelector:()=>null},addEventListener(name,fn){listeners[name]=fn;},dispatchEvent(){},CustomEvent:function(){},PlatformOperationalSync:{registerTask(){},unregisterTask(){}},PlatformIntegration:{getModuleServices(){return {getSelectedConferenceId:()=>'',invokeProtected(module,operation){if(operation==='check_module_access')return Promise.reject({code:'MODULE_PERMISSION_REQUIRED'});throw new Error(module+':'+operation);}};}}};
  vm.runInNewContext(dashboard,{window,Promise,Object,JSON,String,Array,Number,Date,Math});
  await window.PlatformHomeDashboard.activate();
  assert.match(nodes.get('platformHomeModules').innerHTML,/غير متاح ضمن صلاحياتك/);
  assert.doesNotMatch(nodes.get('platformHomeModules').innerHTML,/data-platform-module="conference"/);
  assert.doesNotMatch(nodes.get('platformHomeModules').innerHTML,/data-platform-module="reservations"/);
  assert.doesNotMatch(nodes.get('platformHomeModules').innerHTML,/data-platform-module="warehouse"/);
  assert.doesNotMatch(nodes.get('platformHomeModules').innerHTML,/data-platform-module="platform-administration"/);
});

test('one operational coordinator owns polling, reconnection and visibility refresh',()=>{
  assert.match(integration,/global\.PlatformOperationalSync=Object\.freeze/);
  assert.match(integration,/registerOperationalSyncTask\('conference_changes',4000/);
  assert.match(dashboard,/registerTask\('platform_home',30000,load\)/);
  assert.match(integration,/addEventListener\('online'[\s\S]*requestOperationalSync/);
  assert.match(integration,/addEventListener\('offline'[\s\S]*emitOperationalSync\('offline'/);
  assert.match(integration,/visibilitychange[\s\S]*requestOperationalSync/);
  assert.doesNotMatch(integration,/pollConferenceChanges[\s\S]{0,300}\.catch\(function\(\)\{\}\)/);
});

test('session reset invalidates dashboard state and PWA caches its exact asset revision',()=>{
  assert.match(dashboard,/platform-session-reset[\s\S]*deactivate\(\)[\s\S]*lastState=null/);
  assert.match(worker,/development-room-modal-readonly-scroll-v3/);
  assert.match(worker,/\.\/js\/platform-home-dashboard\.js\?rev=unified-platform-state-home-v2/);
  assert.match(html,/js\/platform-home-dashboard\.js\?rev=unified-platform-state-home-v2/);
});
