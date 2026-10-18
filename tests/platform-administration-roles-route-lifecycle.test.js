'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('js/sync/platform-administration-ui.js','utf8');
const permissionSource=fs.readFileSync('js/sync/module-permission-administration-ui.js','utf8');

test('returning to roles reactivates controls after workspace DOM replacement',()=>{
  const dom=new JSDOM('<div id="platform-administrationWorkspace"></div>');
  const calls=[];
  const w=dom.window;
  w.ApplicationRouting={getLogicalPathname:()=>'/platform-administration/users'};
  w.PlatformIntegration={registerModule:definition=>{w.adminModule=definition;}};
  w.UserManagementUI={getNavigationState:()=>({status:'loaded',capabilities:{canOpenUserManagement:true}}),renderSection:()=>'<div id="user_management_screen">Users</div>',renderAuditSection:()=>'',renderSecuritySection:()=>'',initialize:()=>calls.push('users-init')};
  w.ModulePermissionAdministrationUI={getNavigationState:()=>({status:'ready',available:true}),renderSection:()=>'<div id="module_permission_administration_screen"><button id="permission-action">Action</button></div>',initialize:()=>calls.push('permissions-init'),activate:()=>{calls.push('activate');const b=w.document.getElementById('permission-action');b.addEventListener('click',()=>calls.push('clicked'));}};
  vm.runInNewContext(source,{window:w});
  assert.equal(w.adminModule.mount({route:'/platform-administration/users'}),true);
  w.adminModule.reconcileRoute({route:'/platform-administration/roles'});
  w.document.getElementById('permission-action').click();
  w.adminModule.reconcileRoute({route:'/platform-administration/users'});
  w.adminModule.reconcileRoute({route:'/platform-administration/roles'});
  w.document.getElementById('permission-action').click();
  assert.deepEqual(calls.filter(x=>x==='clicked'),['clicked','clicked']);
  assert.equal(calls.filter(x=>x==='permissions-init').length,1);
  assert.equal(calls.filter(x=>x==='activate').length,2);
});

test('permission UI publishes explicit activation rather than relying on one-time initialize',()=>{
  assert.match(permissionSource,/function activate\(\)\{paint\(\);return state\.status==='idle'\?loadModule\(\):Promise\.resolve\(true\);\}/);
  assert.match(permissionSource,/initialize:initialize,activate:activate/);
});
