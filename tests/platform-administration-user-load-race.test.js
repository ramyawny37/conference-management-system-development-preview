'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/sync/user-management-ui.js','utf8');
test('older user search response cannot replace newer filter results',async()=>{
  const pending=[];
  const service={
    listUsers:()=>new Promise(resolve=>pending.push(resolve)),
    getOverview:()=>Promise.resolve({ok:false,status:'denied'})
  };
  const window={UserManagementReadService:service,document:{getElementById:()=>null}};
  window.window=window;
  vm.runInNewContext(source,{window});
  const ui=window.UserManagementUI;
  const first=ui.refreshUsers();
  const second=ui.filter('approved');
  assert.equal(pending.length,2);
  pending[1]({ok:true,data:{users:[],audit:[],security:{},capabilities:{canOpenUserManagement:true}}});
  await second;
  pending[0]({ok:true,data:{users:[{userId:'stale',displayName:'Stale',email:'stale@example.test'}],audit:[],security:{},capabilities:{canOpenUserManagement:true}}});
  await first;
  assert.equal(ui.getNavigationState().status,'loaded');
  assert.equal(ui.renderSection().includes('Stale'),false);
});

test('rejected user listing leaves loading state and permits a retry',async()=>{
  let attempts=0;
  const service={
    listUsers:()=>{attempts++;return attempts===1?Promise.reject(new Error('network unavailable')):Promise.resolve({ok:true,data:{users:[],audit:[],security:{},capabilities:{canOpenUserManagement:true}}});},
    getOverview:()=>Promise.resolve({ok:false,status:'denied'})
  };
  const window={UserManagementReadService:service,document:{getElementById:()=>null}};
  window.window=window;
  vm.runInNewContext(source,{window});
  const ui=window.UserManagementUI;
  const failure=await ui.refreshUsers();
  assert.equal(failure.ok,false);
  assert.equal(ui.getNavigationState().status,'error');
  const retry=await ui.refreshUsers();
  assert.equal(retry.ok,true);
  assert.equal(ui.getNavigationState().status,'loaded');
});
