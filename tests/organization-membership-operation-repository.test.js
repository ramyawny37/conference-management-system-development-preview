'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var utilsSource=fs.readFileSync(path.resolve(__dirname,'../js/sync/organization-administration-utils.js'),'utf8');
var repositorySource=fs.readFileSync(path.resolve(__dirname,'../js/sync/organization-membership-operation-repository.js'),'utf8');
var ids={user:'11111111-1111-4111-8111-111111111111',other:'22222222-2222-4222-8222-222222222222',organization:'33333333-3333-4333-8333-333333333333',target:'44444444-4444-4444-8444-444444444444',operation:'55555555-5555-4555-8555-555555555555'};
function request(action){var value={result:null,error:null};setTimeout(function(){try{value.result=action();value.onsuccess&&value.onsuccess();}catch(error){value.error=error;value.onerror&&value.onerror();}},0);return value;}
function load(){
  var rows=[];
  function find(key){return rows.filter(function(row){return row.authenticatedUserId===key[0]&&row.operationId===key[1];})[0]||null;}
  function store(){return {
    get:function(key){return request(function(){return find(key);});},
    put:function(value){return request(function(){var old=find([value.authenticatedUserId,value.operationId]);if(old)rows.splice(rows.indexOf(old),1);rows.push(JSON.parse(JSON.stringify(value)));return value;});},
    delete:function(key){return request(function(){var old=find(key);if(old)rows.splice(rows.indexOf(old),1);});},
    index:function(name){return {getAll:function(key){return request(function(){
      if(name==='by_authenticated_user')return rows.filter(function(row){return row.authenticatedUserId===key;});
      return rows.filter(function(row){return [row.authenticatedUserId,row.organizationId,row.targetUserId,row.action,row.requestedRole||''].join('|')===(key||[]).join('|');});
    });}};}
  };}
  var sandbox={window:null,Promise:Promise,JSON:JSON,Object:Object,String:String,Number:Number,Array:Array,Date:Date,structuredClone:global.structuredClone,AppIndexedDB:{getRecord:function(name,key){return Promise.resolve(find(key));},deleteRecord:function(name,key){var old=find(key);if(old)rows.splice(rows.indexOf(old),1);return Promise.resolve();},runTransaction:function(name,mode,executor){return Promise.resolve(executor({organization_membership_pending_operations:store()}));}},console:console};
  sandbox.window=sandbox;vm.runInNewContext(utilsSource,sandbox);vm.runInNewContext(repositorySource,sandbox);return {repository:sandbox.OrganizationMembershipOperationRepository,rows:rows};
}
function input(user){return {authenticatedUserId:user||ids.user,organizationId:ids.organization,targetUserId:ids.target,action:'add_organization_member',requestedRole:null};}
async function run(){
  var env=load(),now='2026-08-01T00:00:00.000Z';
  var prepared=await env.repository.prepare(input(),ids.operation,{now:now});assert.strictEqual(prepared.ok,true);assert.strictEqual(prepared.data.state,'pending');assert.strictEqual(prepared.data.attemptCount,0);assert.deepStrictEqual(env.rows[0].requestedRole,'');
  assert.strictEqual((await env.repository.markAttempt(ids.user,ids.operation,{now:now})).data.attemptCount,1);assert.strictEqual((await env.repository.markUnknown(ids.user,ids.operation,{now:now})).data.state,'unknown');
  await env.repository.prepare(input(ids.other),'66666666-6666-4666-8666-666666666666',{now:now});var mine=await env.repository.listForReconciliation(ids.user,{now:now});assert.strictEqual(mine.data.operations.length,1);assert.strictEqual(mine.data.operations[0].authenticatedUserId,ids.user);
  env.rows.push({authenticatedUserId:ids.user,operationId:'bad',organizationId:ids.organization,action:'add_organization_member',targetUserId:ids.target,requestedRole:'',state:'pending',createdAt:now,lastAttemptAt:null,attemptCount:0});env.rows.push({authenticatedUserId:ids.user,operationId:'77777777-7777-4777-8777-777777777777',organizationId:ids.organization,action:'add_organization_member',targetUserId:ids.target,requestedRole:'',state:'pending',createdAt:'2026-07-20T00:00:00.000Z',lastAttemptAt:null,attemptCount:0});env.rows.push({authenticatedUserId:ids.user,operationId:'88888888-8888-4888-8888-888888888888',organizationId:ids.organization,action:'add_organization_member',targetUserId:ids.target,requestedRole:'',state:'pending',createdAt:'2026-08-02T00:10:00.000Z',lastAttemptAt:null,attemptCount:0});
  var reconciled=await env.repository.listForReconciliation(ids.user,{now:now});assert.strictEqual(reconciled.data.operations.length,1);assert.strictEqual(env.rows.some(function(row){return row.operationId==='bad'||row.operationId.indexOf('7777')===0||row.operationId.indexOf('8888')===0;}),false);
  console.log('organization membership operation repository tests: passed');
}
run().catch(function(error){console.error(error);process.exitCode=1;});
