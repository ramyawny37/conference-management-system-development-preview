'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var source=fs.readFileSync(path.resolve(__dirname,'../js/sync/user-management-ui.js'),'utf8');
var first='11111111-1111-4111-8111-111111111111';
var second='22222222-2222-4222-8222-222222222222';
var listCalls=[],overviewCalls=[];
var users=[
  {userId:first,displayName:'First Real User',email:'first@dev.test',accountStatus:'approved',conferenceCount:1,deviceCount:1},
  {userId:second,displayName:'Second Real User',email:'second@dev.test',accountStatus:'pending',conferenceCount:0,deviceCount:0}
];
function overview(userId,partial){
  var user=users.find(function(item){return item.userId===userId;});
  return {selectedUser:{userId:user.userId,displayName:user.displayName,email:user.email},
    account:{status:'loaded',data:{accountStatus:user.accountStatus,
      canCreateConferences:user.userId===first,systemRoles:user.userId===first?['system_owner']:[]}},
    organization:partial?{status:'error',data:null}:
      {status:'loaded',data:{memberships:user.userId===first?[{organizationName:'Development Organization',isMember:true,role:'organization_owner'}]:[]}},
    conferences:{status:'loaded',data:{items:user.userId===first?[{conferenceName:'Development Conference',isMember:true,role:'owner'}]:[]}},
    devices:{status:user.userId===first?'loaded':'empty',data:{items:user.userId===first?[{deviceName:'Development Device',platform:'Browser',authorizationStatus:'approved'}]:[]}},
    capabilities:{canManageAccount:true}};
}
var partialSecond=false;
var readService={listUsers:function(input){listCalls.push(input);return Promise.resolve({ok:true,status:'listed',data:{users:users.slice()}});},getOverview:function(input){overviewCalls.push(input);return Promise.resolve({ok:true,status:'loaded',data:{overview:overview(input.targetUserId,input.targetUserId===second&&partialSecond)}});},getAccount:function(input){return Promise.resolve({ok:true,status:'loaded',data:{account:overview(input.targetUserId,false).account}});}};
var sandbox={window:{UserManagementReadService:readService,document:{getElementById:function(){return null;}}},Promise:Promise};
vm.runInNewContext(source,sandbox);
var ui=sandbox.window.UserManagementUI;
(async function(){
  var initialLoading=ui.renderSection();
  assert.ok(initialLoading.includes('user-management-screen'));
  await ui.initialize();
  assert.strictEqual(listCalls.length,1);
  assert.strictEqual(overviewCalls[0].targetUserId,first);
  var masterAndDetail=ui.renderSection();
  assert.ok(masterAndDetail.includes('First Real User'));
  assert.ok(masterAndDetail.includes('Second Real User'));
  assert.ok(masterAndDetail.includes('Development Organization'));
  assert.ok(masterAndDetail.includes('Development Conference'));
  assert.ok(masterAndDetail.includes('Development Device'));
  partialSecond=true;
  await ui.selectUser(second);
  var secondDetail=ui.renderSection();
  assert.ok(secondDetail.includes('Second Real User'));
  assert.ok(secondDetail.includes('settings-empty-state'),
    'empty and partial-failure sections must render locally');
  assert.ok(secondDetail.includes('user-management-section'),
    'partial failure must not discard the complete details screen');
  await ui.search('Second');
  assert.strictEqual(listCalls[listCalls.length-1].query,'Second');
  await ui.filter('pending');
  assert.strictEqual(listCalls[listCalls.length-1].accountStatus,'pending');
  users=[];ui.resetForTests();await ui.initialize();
  var empty=ui.renderSection();
  assert.ok(empty.includes('settings-empty-state'));
  assert.doesNotMatch(source,/\.rpc\s*\(|\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
  console.log('user management UI read layer tests: passed');
})().catch(function(error){console.error(error);process.exitCode=1;});
