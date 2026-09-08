'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const source=fs.readFileSync(path.resolve(__dirname,'../js/supabase/account-administration-service.js'),'utf8');
const actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222',device='33333333-3333-4333-8333-333333333333',operation='44444444-4444-4444-8444-444444444444',calls=[];
let stored=null,fail=false;
const store={prepare(intent,id){if(stored)return Promise.resolve({ok:true,status:'preserved',data:stored});stored=Object.assign({},intent,{operationId:id});return Promise.resolve({ok:true,status:'saved',data:stored});},remove(){stored=null;return Promise.resolve({ok:true});}};
const sandbox={window:{SupabaseClientLayer:{getClient:()=>({})},SupabaseAuth:{getSession:()=>({user:{id:actor}})},SupabaseDeviceIdentity:{getOrCreate:()=>({id:device})},PlatformDeviceSession:{invokeProtected:(name,args)=>{calls.push({name,args});if(fail)return Promise.reject({code:'NETWORK'});return Promise.resolve({status:args.p_action==='set_conference_creation_permission'?'updated':args.p_action==='approve'?'approved':args.p_action==='block'?'blocked':'approved'});}},SystemAccessAdministrationAttemptStore:store,crypto:{randomUUID:()=>operation}},Promise};
vm.runInNewContext(source,sandbox);
const service=sandbox.window.AccountAdministrationService;
(async()=>{
  for(const item of [['approveAccount',{targetUserId:target},'approve'],['blockAccount',{targetUserId:target},'block'],['unblockAccount',{targetUserId:target},'unblock'],['setConferenceCreationPermission',{targetUserId:target,requestedValue:true},'set_conference_creation_permission']]){
    const response=await service[item[0]](item[1]);assert.strictEqual(response.ok,true);assert.strictEqual(calls.at(-1).name,'device_guarded_manage_system_user');assert.strictEqual(calls.at(-1).args.p_action,item[2]);assert.strictEqual(calls.at(-1).args.p_actor_device_id,undefined);
  }
  fail=true;const unknown=await service.blockAccount({targetUserId:target});assert.strictEqual(unknown.status,'unknown');const firstOperation=unknown.data.operation.operationId;const retry=await service.blockAccount({targetUserId:target});assert.strictEqual(retry.status,'unknown');assert.strictEqual(retry.data.operation.operationId,firstOperation);
  assert.doesNotMatch(source,/\.rpc\s*\(|\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);console.log('account administration service tests: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
