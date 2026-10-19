'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../js/sync/user-management-ui.js'),'utf8');
const serviceSource=fs.readFileSync(path.resolve(__dirname,'../js/sync/user-management-read-service.js'),'utf8');
const dispatcher=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261010201800_flatten_platform_device_operation_dispatcher.sql'),'utf8');
const cutover=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261010202400_legacy_system_access_runtime_retirement.sql'),'utf8');
assert.match(serviceSource,/rpc\(ctx,'device_guarded_manage_system_user'/);
assert.match(dispatcher,/when 'device_guarded_manage_system_user' then/);
assert.match(cutover,/perform platform\.set_account_status\(p_target_user_id,target_status/);
assert.match(cutover,/if not public\.is_system_owner\(actor_id\)/);

const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222';
let targetStatus='approved',canBlock=true,mutations=0,confirmed=true;
const users=[{userId:owner,email:'owner@test.invalid',displayName:'Owner',accountStatus:'approved'},{userId:member,email:'member@test.invalid',displayName:'Member',accountStatus:'approved'}];
const service={
 listUsers:()=>Promise.resolve({ok:true,data:{users:users.map(u=>({...u,accountStatus:u.userId===member?targetStatus:'approved'})),capabilities:{canViewAccount:true,canManageAccount:true,canViewDevices:false}}}),
 getOverview:({targetUserId})=>Promise.resolve({ok:true,data:{overview:{selectedUser:users.find(u=>u.userId===targetUserId),account:{status:'loaded',data:{accountStatus:targetUserId===member?targetStatus:'approved',capabilities:{canBlock:targetUserId===member&&canBlock,canUnblock:targetUserId===member&&targetStatus==='blocked'}}},devices:{status:'hidden',data:{items:[]}},capabilities:{canViewAccount:true,canManageAccount:true,canViewDevices:false}}}}),
 manageAccount:({targetUserId,action})=>{mutations++;assert.equal(targetUserId,member);targetStatus=action==='block'?'blocked':'approved';return Promise.resolve({ok:true});}
};
const win={UserManagementReadService:service,SupabaseAuth:{getSession:()=>({user:{id:owner}})},confirm:()=>confirmed,document:{getElementById:()=>null}};
vm.runInNewContext(source,{window:win,Promise});
(async()=>{
 const ui=win.UserManagementUI;
 await ui.initialize();
 assert.doesNotMatch(ui.renderSection(),/onclick="UserManagementUI.manageAccount/,'owner must not be actionable');
 await ui.selectUser(member);
 assert.match(ui.renderSection(),/تعطيل الحساب/);assert.match(ui.renderSection(),/btn btn-red btn-sm user-management-account-action/);
 canBlock=false;await ui.selectUser(owner);await ui.selectUser(member);
 assert.doesNotMatch(ui.renderSection(),/onclick="UserManagementUI.manageAccount/,'target capability required');
 assert.equal((await ui.manageAccount('block')).status,'forbidden');assert.equal(mutations,0);
 canBlock=true;await ui.selectUser(owner);await ui.selectUser(member);
 confirmed=false;assert.equal((await ui.manageAccount('block')).status,'cancelled');assert.equal(mutations,0);
 confirmed=true;assert.equal((await ui.manageAccount('block')).ok,true);assert.equal(mutations,1);
 assert.match(ui.renderSection(),/إعادة تفعيل الحساب/);
 assert.equal((await ui.manageAccount('unblock')).ok,true);assert.equal(mutations,2);
 console.log('canonical account actions UI tests: passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
