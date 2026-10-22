'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync('js/platform-integration.js','utf8');
function environment(){
 const calls=[],token='11111111-1111-4111-8111-111111111111';
 const sandbox={window:null,console,Promise,JSON,Object,String,Array,Date,RegExp,Error,Uint8Array,Math,setTimeout,clearTimeout,navigator:{onLine:true},document:{addEventListener(){}},addEventListener(){},dispatchEvent(){},CustomEvent:function(){},crypto:{randomUUID(){return token}},PlatformDeviceSession:{invokeModuleProtected(module,operation,args){calls.push({module,operation,args:JSON.parse(JSON.stringify(args))});if(operation==='acquire_resource_lease')return Promise.resolve({status:'acquired',owned:true,leaseToken:args.p_lease_token,expiresAt:'2099-01-01T00:00:00Z'});if(operation==='renew_resource_lease')return Promise.resolve({status:'renewed',owned:true,expiresAt:'2099-01-01T00:01:00Z'});if(operation==='release_resource_lease')return Promise.resolve({status:'released',owned:false});return Promise.resolve({status:'available',locked:false,owned:false});}}};
 sandbox.window=sandbox;vm.runInNewContext(source,sandbox);return {api:sandbox.PlatformIntegration,calls,token};
}
test('resource lease uses protected device-session path',async()=>{
 const env=environment(),id='40000000-0000-4000-8000-000000000001';
 const acquired=await env.api.acquireResourceLease('conference','accommodation_room',id,{conferenceId:'50000000-0000-4000-8000-000000000099'});
 assert.equal(acquired.owned,true);
 assert.deepEqual(env.calls[0],{module:'conference',operation:'acquire_resource_lease',args:{p_conference_id:'50000000-0000-4000-8000-000000000099',p_resource_type:'accommodation_room',p_resource_id:id,p_scope:'edit',p_lease_token:env.token,p_ttl_seconds:120}});
 assert.equal(env.api.getOwnedResourceLease('conference','accommodation_room',id).leaseToken,env.token);
 await env.api.renewResourceLease('conference','accommodation_room',id,{conferenceId:'50000000-0000-4000-8000-000000000099'});
 assert.equal(env.calls[1].operation,'renew_resource_lease');
 await env.api.releaseResourceLease('conference','accommodation_room',id,{conferenceId:'50000000-0000-4000-8000-000000000099'});
 assert.equal(env.calls[2].operation,'release_resource_lease');
 assert.equal(env.api.getOwnedResourceLease('conference','accommodation_room',id),null);
});
test('missing conference scope is rejected before dispatch',async()=>{const env=environment();await assert.rejects(env.api.getResourceLease('conference','accommodation_room','40000000-0000-4000-8000-000000000001'),error=>error.code==='PLATFORM_RESOURCE_LEASE_CONFERENCE_REQUIRED');assert.equal(env.calls.length,0);});
test('invalid resource identity is rejected before dispatch',async()=>{
 const env=environment();
 await assert.rejects(env.api.acquireResourceLease('conference','bad type','room',{conferenceId:'50000000-0000-4000-8000-000000000099'}),error=>error.code==='PLATFORM_RESOURCE_LEASE_ARGUMENT_INVALID');
 assert.equal(env.calls.length,0);
});

test('stale accommodation response cannot overwrite a newer accepted response',()=>{
 const sandbox={window:null,console,Promise,JSON,Object,String,Array,Date,RegExp,Error,Uint8Array,Math,setTimeout,clearTimeout,navigator:{onLine:true},document:{addEventListener(){}},addEventListener(){},dispatchEvent(){},CustomEvent:function(){},crypto:{randomUUID(){return '11111111-1111-4111-8111-111111111111'}},PlatformDeviceSession:{invokeModuleProtected(){return Promise.resolve({})}}};
 sandbox.window=sandbox;
 const instrumented=source.replace('function hydrateConferenceAccommodation(localId,remoteId)', 'global.__testAccommodationAccept=acceptConferenceAccommodation;global.__testAccommodationSequence=accommodationRefreshSequence;function hydrateConferenceAccommodation(localId,remoteId)');
 assert.notEqual(instrumented,source);
 vm.runInNewContext(instrumented,sandbox);
 const local='local-a',remote='50000000-0000-4000-8000-000000000001';
 sandbox.__testAccommodationSequence[local]=2;
 const response=revision=>({conferenceId:remote,houses:[],pricing:{revision}});
 sandbox.__testAccommodationAccept(local,remote,response(2),2);
 const stale=sandbox.__testAccommodationAccept(local,remote,response(1),1);
 assert.equal(stale.pricing.revision,2);
 assert.equal(sandbox.PlatformIntegration.getConferenceAccommodationState(local).pricing.revision,2);
});

test('owned room lease renewal preserves token and uses protected dispatch',async()=>{
 const env=environment(),id='40000000-0000-4000-8000-000000000002';
 await env.api.acquireResourceLease('conference','accommodation_room',id,{conferenceId:'50000000-0000-4000-8000-000000000099'});
 const renewed=await env.api.renewResourceLease('conference','accommodation_room',id,{conferenceId:'50000000-0000-4000-8000-000000000099'});
 assert.equal(renewed.owned,true);
 assert.equal(env.calls[1].operation,'renew_resource_lease');
 assert.equal(env.calls[1].args.p_lease_token,env.token);
 assert.equal(env.api.getOwnedResourceLease('conference','accommodation_room',id).leaseToken,env.token);
});

test('room structure edits require hydrated canonical state',async()=>{
 const env=environment();
 await assert.rejects(env.api.mutateConferenceAccommodationStructure('missing','update_accommodation_room',{p_room_id:'40000000-0000-4000-8000-000000000003'}),error=>error.code==='CANONICAL_CONFERENCE_ACCOMMODATION_NOT_HYDRATED');
 assert.equal(env.calls.length,0);
});

test('canonical room edit dispatches only after obtaining its resource lease',async()=>{
 const env=environment(),local='room-edit',remote='50000000-0000-4000-8000-000000000004',room='40000000-0000-4000-8000-000000000004';
 const sandbox={window:null,console,Promise,JSON,Object,String,Array,Date,RegExp,Error,Uint8Array,Math,setTimeout,clearTimeout,navigator:{onLine:true},document:{addEventListener(){}},addEventListener(){},dispatchEvent(){},CustomEvent:function(){},crypto:{randomUUID(){return env.token}},PlatformDeviceSession:{invokeModuleProtected(module,operation,args){
  env.calls.push({module,operation,args:JSON.parse(JSON.stringify(args))});
  if(operation==='get_conference_accommodation')return Promise.resolve({conferenceId:remote,houses:[],pricing:{}});
  if(operation==='acquire_resource_lease')return Promise.resolve({owned:true,leaseToken:env.token,expiresAt:'2099-01-01T00:00:00Z'});
  if(operation==='get_resource_lease')return Promise.resolve({owned:false,locked:false});
  if(operation==='release_resource_lease')return Promise.resolve({owned:false});
  return Promise.resolve({ok:true});
 }}};
 sandbox.window=sandbox;
 const instrumented=source.replace('function hydrateConferenceAccommodation(localId,remoteId)','global.__acceptAccommodation=acceptConferenceAccommodation;function hydrateConferenceAccommodation(localId,remoteId)');
 vm.runInNewContext(instrumented,sandbox);
 sandbox.__acceptAccommodation(local,remote,{conferenceId:remote,houses:[],pricing:{}});
 await sandbox.PlatformIntegration.mutateConferenceAccommodationStructure(local,'update_accommodation_room',{p_room_id:room,p_expected_revision:1});
 const operations=env.calls.map(call=>call.operation);
 assert.ok(operations.indexOf('acquire_resource_lease')>=0);
 assert.ok(operations.indexOf('update_accommodation_room')>operations.indexOf('acquire_resource_lease'));
 const write=env.calls.find(call=>call.operation==='update_accommodation_room');
 assert.equal(write.args.p_room_lease_tokens[0].roomId,room);assert.equal(env.calls.find(call=>call.operation==='acquire_resource_lease').args.p_conference_id,remote);
 assert.equal(write.args.p_room_lease_tokens[0].token,env.token);
});
