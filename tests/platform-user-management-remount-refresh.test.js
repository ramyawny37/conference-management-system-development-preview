'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync('js/sync/user-management-ui.js','utf8');
test('reopening administration refreshes server-backed users and capabilities',async()=>{
 let count=0,canManage=true;
 const service={
  listUsers:async()=>{count++;return {ok:true,data:{users:[],audit:[],security:null,capabilities:{canOpenUserManagement:true,canManageAccount:canManage}}};},
  getOverview:async()=>({ok:false})
 };
 const sandbox={window:{UserManagementReadService:service,PlatformAdministrationUI:{isMounted:()=>false},document:{getElementById:()=>null}},Promise,console};
 vm.runInNewContext(source,sandbox);
 const ui=sandbox.window.UserManagementUI;
 await ui.initialize();
 assert.equal(count,1);
 assert.equal(ui.getNavigationState().capabilities.canManageAccount,true);
 canManage=false;
 await ui.initialize();
 assert.equal(count,2);
 assert.equal(ui.getNavigationState().capabilities.canManageAccount,false);
});
