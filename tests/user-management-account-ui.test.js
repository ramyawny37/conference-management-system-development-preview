'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var source=fs.readFileSync(path.resolve(__dirname,'../js/sync/user-management-ui.js'),'utf8');
var id='11111111-1111-4111-8111-111111111111',status='pending',allowed=false;
var mutations=[],overviewCalls=0,accountReads=0;
function account(){return {status:'loaded',data:{accountStatus:status,
  canCreateConferences:allowed,systemRoles:[],capabilities:{
    canApprove:status==='pending',canBlock:status==='approved',
    canUnblock:status==='blocked',canSetConferenceCreation:status==='approved'}}};}
var read={
  listUsers:function(){return Promise.resolve({ok:true,data:{users:[{userId:id,
    displayName:'Runtime User',email:'runtime@dev.test',accountStatus:status,
    conferenceCount:0,deviceCount:0}]}});},
  getOverview:function(){overviewCalls++;return Promise.resolve({ok:true,data:{overview:{
    selectedUser:{userId:id,displayName:'Runtime User',email:'runtime@dev.test'},
    account:account(),organization:{status:'loaded',data:{memberships:[]}},
    conferences:{status:'loaded',data:{items:[]}},devices:{status:'empty',data:{items:[]}},
    capabilities:{canManageAccount:true}}}});},
  getAccount:function(){accountReads++;return Promise.resolve({ok:true,data:{account:account()}});}
};
function mutate(action){return function(input){mutations.push({action:action,input:input});
  if(action==='approve'||action==='unblock')status='approved';
  if(action==='block')status='blocked';if(action==='permission')allowed=input.requestedValue;
  return Promise.resolve({ok:true,status:'applied'});};}
var sandbox={window:{UserManagementReadService:read,AccountAdministrationService:{
  approveAccount:mutate('approve'),blockAccount:mutate('block'),
  unblockAccount:mutate('unblock'),setConferenceCreationPermission:mutate('permission')},
  document:{getElementById:function(){return null;}}},Promise:Promise};
vm.runInNewContext(source,sandbox);var ui=sandbox.window.UserManagementUI;
(async function(){
  await ui.initialize();var html=ui.renderSection();
  assert.match(html,/UserManagementUI\.manageAccount\('approve'\)/);
  await ui.manageAccount('approve');assert.strictEqual(status,'approved');
  assert.strictEqual(accountReads,1);assert.strictEqual(overviewCalls,1);
  html=ui.renderSection();assert.match(html,/UserManagementUI\.manageAccount\('block'\)/);
  assert.match(html,/setConferenceCreationPermission/);
  await ui.setConferenceCreationPermission(true);assert.strictEqual(allowed,true);
  await ui.manageAccount('block');assert.strictEqual(status,'blocked');
  html=ui.renderSection();assert.match(html,/UserManagementUI\.manageAccount\('unblock'\)/);
  await ui.manageAccount('unblock');assert.strictEqual(status,'approved');
  assert.deepStrictEqual(mutations.map(function(item){return item.action;}),
    ['approve','permission','block','unblock']);
  console.log('user management account UI tests: passed');
})().catch(function(e){console.error(e);process.exitCode=1;});
