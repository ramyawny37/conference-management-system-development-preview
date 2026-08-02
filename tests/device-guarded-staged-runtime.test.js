'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var root=path.resolve(__dirname,'..');
var files=['device-guarded-runtime-service.js','device-guarded-direct-read-service.js','device-guarded-realtime-polling.js'];
var sources=files.map(function(file){return fs.readFileSync(path.join(root,'js/staged',file),'utf8');});
var combined=sources.join('\n');
var calls=[];
var intervals=[];
var window={
  setInterval:function(callback,delay){intervals.push({callback:callback,delay:delay});return intervals.length;},
  clearInterval:function(){return undefined;}
};
var context={window:window};
vm.createContext(context);
sources.forEach(function(source){vm.runInContext(source,context);});
var client={rpc:function(name,args){calls.push({name:name,args:args});return Promise.resolve({data:{name:name},error:null});}};
var runtime=window.P03CStagedDeviceGuardedRuntime.create({client:client,deviceId:'device-1'});
var reads=window.P03CStagedDirectReadService.create(client,'device-1');

var invocations=[
  function(){return runtime.listOrganizations();},function(){return runtime.getOrganizationAccess('organization');},
  function(){return runtime.listOrganizationMembers('organization');},function(){return runtime.lookupOrganizationCandidate('organization','a@example.test');},
  function(){return runtime.getConferenceAccess('conference');},function(){return runtime.listConferenceMembers('conference');},
  function(){return runtime.lookupConferenceUser('conference','a@example.test');},function(){return runtime.getConferenceLock('conference');},
  function(){return reads.membership('conference');},function(){return reads.conferences();},function(){return reads.snapshotMetadata('conference');},
  function(){return reads.snapshot('conference');},function(){return runtime.getConferenceCreationOperation('operation');},
  function(){return runtime.getSyncConflict('conflict');},function(){return runtime.listSyncConflicts('conference','pending',25);},
  function(){return runtime.addOrganizationMember('organization','user','operation');},function(){return runtime.removeOrganizationMember('organization','user','operation');},
  function(){return runtime.changeOrganizationRole('organization','user','organization_admin','operation');},
  function(){return runtime.addConferenceManager('conference','user','operation');},function(){return runtime.removeConferenceManager('conference','user','operation');},
  function(){return runtime.createConference('operation','conference','name',{});},function(){return runtime.applySnapshot('conference','operation',1,{},'1','1');},
  function(){return runtime.acquireConferenceLock('conference','lock',30);},function(){return runtime.renewConferenceLock('conference','lock',30);},
  function(){return runtime.releaseConferenceLock('conference','lock');},function(){return runtime.resolveSyncConflict('conflict','conference','operation',1,'keep_local',{},'1','1');}
];

Promise.all(invocations.map(function(invoke){return invoke();})).then(function(){
  assert.strictEqual(calls.length,26);
  assert.strictEqual(new Set(calls.map(function(call){return call.name;})).size,26,'every approved guarded RPC must be covered exactly once');
  calls.forEach(function(call){assert.match(call.name,/^device_guarded_/);assert.strictEqual(call.args.p_actor_device_id,'device-1');});
  assert.doesNotMatch(combined,/\.from\s*\(/,'staged artifacts must not access protected tables');
  assert.doesNotMatch(combined,/postgres_changes|\.channel\s*\(|\.on\s*\(/,'staged artifacts must not subscribe to realtime changes');
  var protectedLegacy=calls.map(function(call){return call.name.replace(/^device_guarded_/,'');});
  protectedLegacy.forEach(function(name){assert.doesNotMatch(combined,new RegExp("rpc\\s*\\(\\s*['\"]"+name+"['\"]"),'protected legacy RPC used: '+name);});
  var index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  var worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
  files.forEach(function(file){assert.ok(!index.includes(file)&&!worker.includes(file),file+' must remain inactive');});
  assert.deepStrictEqual(Object.keys(window).filter(function(key){return /^P03C/.test(key);}).sort(),['P03CStagedDeviceGuardedRuntime','P03CStagedDirectReadService','P03CStagedRealtimePolling']);
  var polling=window.P03CStagedRealtimePolling.create(reads,1000);
  return polling.start('conference',function(){}).then(function(){assert.strictEqual(intervals[0].delay,5000);polling.stop();});
}).then(function(){
  console.log('device guarded staged runtime mock-client tests: passed (26 guarded RPCs; inactive polling; no legacy/table/realtime access)');
}).catch(function(error){console.error(error);process.exitCode=1;});
