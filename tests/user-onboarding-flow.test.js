'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const source=fs.readFileSync(path.resolve(__dirname,
  '../js/sync/user-management-ui.js'),'utf8');
const ids={user:'11111111-1111-4111-8111-111111111111',
  organization:'22222222-2222-4222-8222-222222222222',
  conference:'33333333-3333-4333-8333-333333333333',
  device:'44444444-4444-4444-8444-444444444444'};
let account='pending',organizationRole=null,conferenceRole=null,
  deviceStatus='pending';
const calls=[];
function overview(){return {selectedUser:{userId:ids.user,
  displayName:'New Test User',email:'new-user@development.test'},
  account:{status:'loaded',data:{accountStatus:account,
    canCreateConferences:false,systemRoles:[],capabilities:{canApprove:true}}},
  organization:{status:'loaded',data:{memberships:[{organizationId:ids.organization,
    organizationName:'Development Organization',isMember:!!organizationRole,
    role:organizationRole,capabilities:{canAdd:!organizationRole}}]}},
  conferences:{status:'loaded',data:{items:[{conferenceId:ids.conference,
    conferenceName:'Development Conference',isMember:!!conferenceRole,
    role:conferenceRole,capabilities:{canAdd:!conferenceRole}}]}},
  devices:{status:'empty',managementStatus:'membership_required',data:{items:[]}},
  capabilities:{canViewAccount:true,canViewOrganization:true,
    canViewConferences:true,canViewDevices:true}};}
const read={listUsers(){return Promise.resolve({ok:true,data:{users:[{
  userId:ids.user,displayName:'New Test User',email:'new-user@development.test',
  accountStatus:account,conferenceCount:0,deviceCount:1}]}});},
  getOverview(){return Promise.resolve({ok:true,data:{overview:overview()}});},
  getAccount(){return Promise.resolve({ok:true,data:{account:overview().account}});}};
const sandbox={window:{UserManagementReadService:read,
  AccountAdministrationService:{approveAccount(){calls.push('account_approve');
    account='approved';return Promise.resolve({ok:true,status:'approved'});}},
  OrganizationAdministrationService:{addMember(){calls.push('organization_add');
    organizationRole='member';return Promise.resolve({ok:true,status:'applied',
      data:{refresh:{access:{canManageMembers:true,canManageOwners:true},
        members:[{userId:ids.user,role:'member',isCurrentUser:false}]}}});}},
  ConferenceMembersService:{addMember(cid,uid,role){calls.push('conference_add');
    conferenceRole=role;return Promise.resolve({ok:true,status:'added'});},
    listMembers(){return Promise.resolve({ok:true,data:{members:[{
      userId:ids.user,role:conferenceRole}]}});}},
  DeviceAuthorizationAdministrationService:{listMemberDevices(){calls.push('devices_read');
    return Promise.resolve({ok:true,data:{targetRole:'member',devices:[{
      deviceId:ids.device,deviceName:'New Device',authorizationStatus:deviceStatus}]}});},
    approveMemberDevice(){calls.push('device_approve');deviceStatus='approved';
      return Promise.resolve({ok:true,data:{memberDevices:{targetRole:'member',devices:[{
        deviceId:ids.device,deviceName:'New Device',authorizationStatus:deviceStatus}]}}});}},
  SupabaseDeviceIdentity:{getOrCreate(){return {id:'55555555-5555-4555-8555-555555555555'};}},
  document:{getElementById(){return null;}}},Promise};
vm.runInNewContext(source,sandbox);
(async function(){const ui=sandbox.window.UserManagementUI;await ui.initialize();
  await ui.manageAccount('approve');
  assert.deepStrictEqual(calls,['account_approve']);
  await ui.manageOrganization(ids.organization,'add');
  await Promise.resolve();await Promise.resolve();
  assert.deepStrictEqual(calls.slice(0,3),
    ['account_approve','organization_add','devices_read']);
  await ui.manageConference(ids.conference,'add','viewer');
  assert.strictEqual(conferenceRole,'viewer');
  await ui.manageDevice('approve',ids.device);
  assert.strictEqual(deviceStatus,'approved');
  assert.deepStrictEqual(calls,
    ['account_approve','organization_add','devices_read','conference_add',
      'device_approve']);
  console.log('user onboarding separated flow tests: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
