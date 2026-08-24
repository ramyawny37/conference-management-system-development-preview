'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var utilsSource=fs.readFileSync(path.resolve(__dirname,'../js/sync/organization-administration-utils.js'),'utf8');
var repositorySource=fs.readFileSync(path.resolve(__dirname,'../js/sync/organization-membership-operation-repository.js'),'utf8');
var ids={user:'11111111-1111-4111-8111-111111111111',other:'22222222-2222-4222-8222-222222222222',organization:'33333333-3333-4333-8333-333333333333',target:'44444444-4444-4444-8444-444444444444',operation:'55555555-5555-4555-8555-555555555555'};
function request(action){var value={result:null,error:null};setTimeout(function(){try{value.result=action();value.onsuccess&&value.onsuccess();}catch(error){value.error=error;value.onerror&&value.onerror();}},0);return value;}
function load(initialRows,failStorage){
  var rows=JSON.parse(JSON.stringify(initialRows||[]));
  function validKey(key){
    if(key===null||key===undefined||(Array.isArray(key)&&key.some(function(item){return !validKey(item);})))return false;
    return typeof key==='string'||typeof key==='number'||key instanceof Date||Array.isArray(key);
  }
  function find(key){return rows.filter(function(row){return row.authenticatedUserId===key[0]&&row.operationId===key[1];})[0]||null;}
  function store(){return {
    get:function(key){return request(function(){return find(key);});},
    put:function(value){return request(function(){var old=find([value.authenticatedUserId,value.operationId]);if(old)rows.splice(rows.indexOf(old),1);rows.push(JSON.parse(JSON.stringify(value)));return value;});},
    delete:function(key){return request(function(){var old=find(key);if(old)rows.splice(rows.indexOf(old),1);});},
    index:function(name){return {getAll:function(key){if(!validKey(key)){var error=new Error('The parameter is not a valid key.');error.name='DataError';throw error;}return request(function(){
      if(name==='by_authenticated_user')return rows.filter(function(row){return row.authenticatedUserId===key;});
      return rows.filter(function(row){return [row.authenticatedUserId,row.organizationId,row.targetUserId,row.action,row.requestedRole||''].join('|')===(key||[]).join('|');});
    });}};}
  };}
  var sandbox={window:null,Promise:Promise,JSON:JSON,Object:Object,String:String,Number:Number,Array:Array,Date:Date,structuredClone:global.structuredClone,AppIndexedDB:{getRecord:function(name,key){return Promise.resolve(find(key));},deleteRecord:function(name,key){var old=find(key);if(old)rows.splice(rows.indexOf(old),1);return Promise.resolve();},runTransaction:function(name,mode,executor){if(failStorage)return Promise.reject(new Error('STORAGE_UNAVAILABLE'));return Promise.resolve(executor({organization_membership_pending_operations:store()}));}},console:console};
  sandbox.window=sandbox;vm.runInNewContext(utilsSource,sandbox);vm.runInNewContext(repositorySource,sandbox);return {repository:sandbox.OrganizationMembershipOperationRepository,rows:rows};
}
function input(user){return {authenticatedUserId:user||ids.user,organizationId:ids.organization,targetUserId:ids.target,action:'add_organization_member',requestedRole:null};}
async function run(){
  var env=load(),now='2026-08-01T00:00:00.000Z';
  assert.deepStrictEqual(Array.from(env.repository.intentKey(input())),[ids.user,ids.organization,ids.target,'add_organization_member','']);
  var prepared=await env.repository.prepare(input(),ids.operation,{now:now});assert.strictEqual(prepared.ok,true);assert.strictEqual(prepared.data.state,'pending');assert.strictEqual(prepared.data.attemptCount,0);assert.deepStrictEqual(env.rows[0].requestedRole,'');
  var replay=await env.repository.prepare(input(),'66666666-6666-4666-8666-666666666660',{now:now});assert.strictEqual(replay.ok,true);assert.strictEqual(replay.data.operationId,ids.operation);assert.strictEqual(env.rows.length,1);
  var removeEnv=load(),removeInput=Object.assign({},input(),{action:'remove_organization_member'}),removed=await removeEnv.repository.prepare(removeInput,'66666666-6666-4666-8666-666666666661',{now:now});assert.strictEqual(removed.ok,true);assert.strictEqual(removed.data.requestedRole,'');
  var changeEnv=load(),changeInput=Object.assign({},input(),{action:'change_organization_role',requestedRole:'organization_admin'}),changed=await changeEnv.repository.prepare(changeInput,'66666666-6666-4666-8666-666666666662',{now:now});assert.strictEqual(changed.ok,true);assert.strictEqual(changed.data.requestedRole,'organization_admin');
  var upgradedRow={authenticatedUserId:ids.user,operationId:'66666666-6666-4666-8666-666666666663',organizationId:ids.organization,action:'add_organization_member',targetUserId:ids.target,requestedRole:'',state:'pending',createdAt:now,lastAttemptAt:null,attemptCount:0},upgraded=load([upgradedRow]);var reused=await upgraded.repository.prepare(input(),'66666666-6666-4666-8666-666666666664',{now:now});assert.strictEqual(reused.data.operationId,upgradedRow.operationId);assert.strictEqual(upgraded.rows.length,1);
  assert.strictEqual((await load([],true).repository.prepare(input(),ids.operation,{now:now})).status,'storage_error');
  assert.strictEqual((await env.repository.markAttempt(ids.user,ids.operation,{now:now})).data.attemptCount,1);assert.strictEqual((await env.repository.markUnknown(ids.user,ids.operation,{now:now})).data.state,'unknown');
  assert.strictEqual((await env.repository.removeUnknown(ids.other,ids.operation,{now:now})).status,'not_found');
  assert.strictEqual((await env.repository.removeUnknown(ids.user,ids.operation,{now:now})).status,'tracking_stopped');assert.strictEqual(env.rows.some(function(row){return row.authenticatedUserId===ids.user&&row.operationId===ids.operation;}),false);
  var pendingAgain=await env.repository.prepare(input(),ids.operation,{now:now});assert.strictEqual((await env.repository.removeUnknown(ids.user,pendingAgain.data.operationId,{now:now})).status,'not_unknown');assert.strictEqual(env.rows.some(function(row){return row.authenticatedUserId===ids.user&&row.operationId===ids.operation;}),true);
  await env.repository.prepare(input(ids.other),'66666666-6666-4666-8666-666666666666',{now:now});var mine=await env.repository.listForReconciliation(ids.user,{now:now});assert.strictEqual(mine.data.operations.length,1);assert.strictEqual(mine.data.operations[0].authenticatedUserId,ids.user);
  env.rows.push({authenticatedUserId:ids.user,operationId:'bad',organizationId:ids.organization,action:'add_organization_member',targetUserId:ids.target,requestedRole:'',state:'pending',createdAt:now,lastAttemptAt:null,attemptCount:0});env.rows.push({authenticatedUserId:ids.user,operationId:'77777777-7777-4777-8777-777777777777',organizationId:ids.organization,action:'add_organization_member',targetUserId:ids.target,requestedRole:'',state:'pending',createdAt:'2026-07-20T00:00:00.000Z',lastAttemptAt:null,attemptCount:0});env.rows.push({authenticatedUserId:ids.user,operationId:'88888888-8888-4888-8888-888888888888',organizationId:ids.organization,action:'add_organization_member',targetUserId:ids.target,requestedRole:'',state:'pending',createdAt:'2026-08-02T00:10:00.000Z',lastAttemptAt:null,attemptCount:0});env.rows.push({authenticatedUserId:ids.user,operationId:'99999999-9999-4999-8999-999999999999',organizationId:ids.organization,action:'remove_organization_member',targetUserId:ids.target,requestedRole:'',state:'unknown',createdAt:'2026-07-20T00:00:00.000Z',lastAttemptAt:'2026-07-20T00:01:00.000Z',attemptCount:1});
  var reconciled=await env.repository.listForReconciliation(ids.user,{now:now});assert.strictEqual(reconciled.data.operations.length,4);assert.strictEqual(reconciled.data.diagnostics.length,1);assert.strictEqual(reconciled.data.diagnostics[0].reason,'malformed_record');assert.strictEqual(env.rows.some(function(row){return row.operationId==='bad';}),true);assert.strictEqual(reconciled.data.operations.some(function(row){return row.operationId.indexOf('7777')===0&&row.state==='pending';}),true);assert.strictEqual(reconciled.data.operations.some(function(row){return row.operationId.indexOf('8888')===0&&row.state==='pending';}),true);assert.strictEqual(reconciled.data.operations.some(function(row){return row.operationId.indexOf('9999')===0&&row.state==='unknown';}),true);
  var retainedOld=load([{authenticatedUserId:ids.user,operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',organizationId:ids.organization,action:'add_organization_member',targetUserId:ids.target,requestedRole:'',state:'pending',createdAt:'2026-07-20T00:00:00.000Z',lastAttemptAt:null,attemptCount:0}]);var retainedPrepared=await retainedOld.repository.prepare(input(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',{now:now});assert.strictEqual(retainedPrepared.ok,true);assert.strictEqual(retainedPrepared.data.operationId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.strictEqual(retainedOld.rows.length,1);
  var malformedId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',malformed=load([{authenticatedUserId:ids.user,operationId:malformedId,organizationId:ids.organization,action:'add_organization_member',targetUserId:ids.target,requestedRole:'',state:'pending',createdAt:now,lastAttemptAt:null,attemptCount:-1}]);assert.strictEqual((await malformed.repository.get(ids.user,malformedId)).status,'manual_retry_required');assert.strictEqual(malformed.rows.length,1);assert.strictEqual((await malformed.repository.prepare(input(),'dddddddd-dddd-4ddd-8ddd-dddddddddddd',{now:now})).status,'manual_retry_required');assert.strictEqual(malformed.rows.length,1);
  console.log('organization membership operation repository tests: passed');
}
run().catch(function(error){console.error(error);process.exitCode=1;});
