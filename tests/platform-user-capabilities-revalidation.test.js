'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync('js/sync/user-management-read-service.js','utf8');
const actor='11111111-1111-4111-8111-111111111111';
test('actor permissions are revalidated after server-side revocation',async()=>{
  let allowed=true,calls=0;
  const sandbox={window:{SupabaseAuth:{getSession:()=>({user:{id:actor}})},PlatformDeviceSession:{invokeModuleProtected:async(module,name)=>{
    assert.equal(module,'platform');assert.equal(name,'get_user_management_actor_capabilities');calls++;
    return {status:'success',canOpenUserManagement:allowed,canManageAccount:allowed};
  }}},Promise};
  vm.runInNewContext(source,sandbox);
  const service=sandbox.window.UserManagementReadService;
  const first=await service.getActorCapabilities();
  assert.equal(first.data.capabilities.canManageAccount,true);
  allowed=false;
  const second=await service.getActorCapabilities();
  assert.equal(second.data.capabilities.canManageAccount,false);
  assert.equal(service.getCachedActorCapabilities().canManageAccount,false);
  assert.equal(calls,2);
});
