'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');
const service=fs.readFileSync('js/sync/module-permission-administration-service.js','utf8');
const ui=fs.readFileSync('js/sync/module-permission-administration-ui.js','utf8');
const script=fs.readFileSync('script.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');
const css=fs.readFileSync('style.css','utf8');
const userRead=fs.readFileSync('js/sync/user-management-read-service.js','utf8');
const userUi=fs.readFileSync('js/sync/user-management-ui.js','utf8');

test('1 separate Module Administration service exists',()=>assert.match(service,/ModulePermissionAdministrationService/));
test('2 separate Module Administration UI exists',()=>assert.match(ui,/ModulePermissionAdministrationUI/));
test('3 User Management is not used for module candidate authorization',()=>{assert.doesNotMatch(service,/UserManagement/);assert.doesNotMatch(ui,/UserManagement/);assert.doesNotMatch(userRead,/search_module_permission_candidates/);assert.doesNotMatch(userUi,/search_module_permission_candidates/);});
test('4 candidate search uses protected canonical operation',()=>assert.match(service,/invoke\('search_module_permission_candidates'/));
test('5 availability is a protected backend probe before candidate search',()=>assert.match(service,/probeAvailability\(\)[\s\S]*listCatalog/));
test('6 catalog is server-driven',()=>assert.match(service,/invoke\('list_module_permission_catalog_for_administration'/));
test('7 Warehouse business permissions are not hardcoded',()=>{assert.doesNotMatch(service,/warehouse\.(?:store|item|stock|receipt|issue|transfer|adjustment|approval|reversal|reports)\./);assert.match(ui,/state\.catalog\.map\(businessRow\)/);});
test('8 canonical grant list is reused',()=>assert.match(service,/invoke\('list_module_permission_grants'/));
test('9 foundation mutation uses canonical protected operation',()=>assert.match(service,/manage_foundation_module_grant/));
test('10 business mutation uses canonical protected operation',()=>assert.match(service,/manage_catalog_module_grant/));
test('11 administration store picker uses its dedicated operation',()=>assert.match(service,/list_permission_administration_stores/));
test('12 administration store picker avoids ordinary Warehouse reads',()=>assert.doesNotMatch(service,/warehouse\.store\.view|['"]list_stores['"]|['"]discover_stores['"]/));
test('13 exact store scope is canonical',()=>assert.match(ui,/mutateBusiness\('grant',button,'store',selectNode\.value,null\)/));
test('14 Store UUID is passed without rewriting',()=>assert.match(service,/args\.p_resource_id=input\.resourceId==null\?null:String\(input\.resourceId\)/));
test('15 module.access controls exist',()=>assert.match(ui,/foundationRow\('module\.access'/));
test('16 module.manage controls are owner-confirmation restricted',()=>assert.match(ui,/foundationRow\('module\.manage'[\s\S]*true\)/));
test('17 Module Manager cannot appoint another manager through UI',()=>assert.match(ui,/permission==='module\.manage'&&!state\.ownerConfirmed/));
test('18 module.access revocation explains retained business grants',()=>assert.match(ui,/دون حذف منح الأعمال المحفوظة/));
test('19 sensitiveMutation confirmation is honored',()=>assert.match(ui,/confirmSensitive[\s\S]*data-sensitive/));
test('20 operation IDs use secure browser UUID generation',()=>assert.match(service,/crypto\.randomUUID/));
test('21 grants refresh only after successful mutation',()=>assert.match(ui,/response\.ok\?refreshGrants\(\):false/));
test('22 no Organization dependency',()=>{assert.doesNotMatch(service,/organization/i);assert.doesNotMatch(ui,/organization/i);});
test('23 no Conference dependency',()=>{assert.doesNotMatch(service,/conference/i);assert.doesNotMatch(ui,/conference/i);});
test('24 no Platform-role dependency',()=>assert.doesNotMatch(service+ui,/platform\.(?:roles|user_roles|role_permissions|permissions)/i));
test('25 no Inventory dependency',()=>assert.doesNotMatch(service+ui,/inventory\./i));
test('26 candidate normalization stays privacy-minimal',()=>{assert.match(service,/userId:id,displayName:text\(row\.displayName\),email:String\(row\.email\|\|''\),accountStatus/);assert.doesNotMatch(service,/conferenceCount|deviceCount|systemRoles|canCreateConferences/);});
test('27 no device data is displayed',()=>assert.doesNotMatch(ui,/device(?:Id|Name|List|Authorization)|data-device/i));
test('28 no Conference capability is displayed',()=>assert.doesNotMatch(service+ui,/can_create_conferences|canCreateConferences/));
test('29 Settings tab is independent from users tab',()=>{assert.match(script,/activeSettingsTab==='module-permissions'/);assert.match(script,/activeSettingsTab === 'users'/);assert.doesNotMatch(script,/activeSettingsTab === 'users'\s*\|\|\s*activeSettingsTab==='module-permissions'/);});
test('30 asset order loads service before UI',()=>assert.ok(html.indexOf('module-permission-administration-service.js')<html.indexOf('module-permission-administration-ui.js')));
test('31 PWA asset graph includes both versioned assets',()=>{for(const name of ['module-permission-administration-service.js?rev=platform-round3g3-v1','module-permission-administration-ui.js?rev=platform-round3g3-v1'])assert.ok(worker.includes(name));});
test('32 responsive CSS covers tablet and mobile',()=>{assert.match(css,/module-permission-layout/);assert.match(css,/@media\(max-width:900px\)/);assert.match(css,/@media\(max-width:600px\)/);});
test('33 actor-device override is rejected and never sent',()=>{assert.match(service,/ACTOR_DEVICE_OVERRIDE_DENIED/);assert.doesNotMatch(ui,/p_actor_device_id|p_device_id/);});
test('34 unified Platform Device Session route is reused',()=>assert.match(service,/PlatformDeviceSession\.invokeProtected/));
test('35 Warehouse store administration reuses unified Warehouse transport',()=>assert.match(service,/WarehouseTransport\.invoke/));
test('36 no direct RPC or table bypass is introduced',()=>assert.doesNotMatch(service+ui,/\.rpc\s*\(|\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/));
test('37 selected-user summary stays minimal',()=>{for(const value of ['displayName','email','accountStatus'])assert.match(service,new RegExp(value));assert.doesNotMatch(ui,/membership|systemRoles|platformRoles|deviceList/i);});
test('38 active and revoked grant history are distinguished',()=>{assert.match(service,/active:row\.revokedAt==null/);assert.match(ui,/item\.active\?'نشطة':'ملغاة'/);});
test('39 mutation runtime sends exact UUID store text and refreshes server state',async()=>{
  var calls=[];
  var sandbox={window:{
    crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    PlatformDeviceSession:{invokeProtected:(name,args)=>{calls.push({name,args});return Promise.resolve({status:'created',grantId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});}},
    WarehouseTransport:{invoke:()=>Promise.resolve([])}
  }};
  vm.runInNewContext(service,sandbox);
  var result=await sandbox.window.ModulePermissionAdministrationService.catalogMutation({action:'grant',targetUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissionKey:'warehouse.example',resourceType:'store',resourceId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});
  assert.equal(result.ok,true);
  assert.equal(calls[0].args.p_action,'create');
  assert.equal(calls[0].args.p_resource_id,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.equal(calls[0].args.p_operation_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
test('40 no migration is introduced by Round 3G.3 assets',()=>assert.doesNotMatch(service+ui+script,/create\s+(?:or replace\s+)?function|create\s+table/i));

function serviceRuntime(capability){
  var calls=[];
  var sandbox={window:{crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},PlatformDeviceSession:{invokeProtected:(name,args)=>{calls.push({name,args});if(name==='get_user_management_actor_capabilities')return Promise.resolve(capability);if(name==='list_module_permission_catalog_for_administration')return Promise.resolve([]);return Promise.reject({code:'UNEXPECTED_OPERATION'});}},WarehouseTransport:{invoke:()=>Promise.resolve([])}}};
  vm.runInNewContext(service,sandbox);
  return {api:sandbox.window.ModulePermissionAdministrationService,calls:calls};
}
function uiRuntime(ownerConfirmed){
  var mutationCalls=[];
  var target='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  var api={probeAvailability:()=>Promise.resolve({ok:true,data:{catalog:[],ownerConfirmed:ownerConfirmed}}),listStores:()=>Promise.resolve({ok:true,data:{stores:[]}}),searchCandidates:()=>Promise.resolve({ok:true,data:{candidates:[{userId:target,displayName:'Test',email:'test@example.invalid',accountStatus:'approved'}]}}),listGrants:()=>Promise.resolve({ok:true,data:{grants:[]}}),foundationMutation:(input)=>{mutationCalls.push(input);return Promise.resolve({ok:false});}};
  var sandbox={window:{ModulePermissionAdministrationService:api,confirm:()=>true,document:null}};
  vm.runInNewContext(ui,sandbox);
  return {api:sandbox.window.ModulePermissionAdministrationUI,calls:mutationCalls,target:target};
}
test('41 protected actor capability confirms a System Owner at runtime',async()=>{var runtime=serviceRuntime({status:'success',canManageAccount:true});var result=await runtime.api.probeAvailability();assert.equal(result.data.ownerConfirmed,true);assert.equal(runtime.calls[0].name,'get_user_management_actor_capabilities');assert.equal(Object.keys(runtime.calls[0].args).length,0);});
test('42 protected actor capability leaves a Module Manager unconfirmed',async()=>{var runtime=serviceRuntime({status:'success',canManageAccount:false});var result=await runtime.api.probeAvailability();assert.equal(result.data.ownerConfirmed,false);});
test('43 missing, malformed, or failed capability remains fail-closed',async()=>{for(const capability of [{status:'success'},{status:'success',canManageAccount:'true'},null]){var runtime=serviceRuntime(capability);var result=await runtime.api.probeAvailability();assert.equal(result.data.ownerConfirmed,false);}});
test('44 confirmed System Owner sees module.manage controls and reaches its protected mutation',async()=>{var runtime=uiRuntime(true);await runtime.api.initialize();await runtime.api.search('Test');await runtime.api.select(runtime.target);assert.match(runtime.api.renderSection(),/data-foundation-grant data-permission="module\.manage"/);await runtime.api.mutateFoundation('grant','module.manage',null);assert.equal(runtime.calls.length,1);assert.equal(runtime.calls[0].permissionKey,'module.manage');});
test('45 Module Manager sees no module.manage mutation control and direct runtime mutation is rejected',async()=>{var runtime=uiRuntime(false);await runtime.api.initialize();await runtime.api.search('Test');await runtime.api.select(runtime.target);var rendered=runtime.api.renderSection();assert.doesNotMatch(rendered,/data-foundation-(?:grant|revoke)[^>]*data-permission="module\.manage"/);assert.match(rendered,/مالك النظام المؤكد فقط/);assert.equal(await runtime.api.mutateFoundation('grant','module.manage',null),false);assert.equal(runtime.calls.length,0);});
test('46 owner confirmation introduces no role or domain inference',()=>{assert.doesNotMatch(service,/organization|conference|platform\.(?:roles|user_roles|role_permissions|permissions)|inventory\.|module\.manage.*ownerConfirmed/i);assert.match(service,/get_user_management_actor_capabilities/);assert.match(service,/value\.canManageAccount===true/);});
function mutationRuntime(){
  var calls=[],sequence=0;
  var ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
  var sandbox={window:{crypto:{randomUUID:()=>ids[sequence++]},PlatformDeviceSession:{invokeProtected:(name,args)=>{calls.push({name:name,args:args});return Promise.resolve({status:'created',grantId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});}},WarehouseTransport:{invoke:()=>Promise.resolve([])}}};
  vm.runInNewContext(service,sandbox);
  return {api:sandbox.window.ModulePermissionAdministrationService,calls:calls};
}
test('47 foundation grant maps semantic grant to backend create',async()=>{var runtime=mutationRuntime();await runtime.api.foundationMutation({action:'grant',targetUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissionKey:'module.access'});assert.equal(runtime.calls[0].name,'manage_foundation_module_grant');assert.equal(runtime.calls[0].args.p_action,'create');});
test('48 foundation revoke preserves backend revoke',async()=>{var runtime=mutationRuntime();await runtime.api.foundationMutation({action:'revoke',targetUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissionKey:'module.manage',grantId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});assert.equal(runtime.calls[0].args.p_action,'revoke');});
test('49 catalog module-wide grant maps to backend create',async()=>{var runtime=mutationRuntime();await runtime.api.catalogMutation({action:'grant',targetUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissionKey:'warehouse.example'});assert.equal(runtime.calls[0].name,'manage_catalog_module_grant');assert.equal(runtime.calls[0].args.p_action,'create');assert.equal(runtime.calls[0].args.p_resource_type,null);assert.equal(runtime.calls[0].args.p_resource_id,null);});
test('50 catalog store grant maps to backend create',async()=>{var runtime=mutationRuntime();await runtime.api.catalogMutation({action:'grant',targetUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissionKey:'warehouse.example',resourceType:'store',resourceId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'});assert.equal(runtime.calls[0].args.p_action,'create');assert.equal(runtime.calls[0].args.p_resource_id,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');});
test('51 catalog revoke preserves backend revoke',async()=>{var runtime=mutationRuntime();await runtime.api.catalogMutation({action:'revoke',targetUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissionKey:'warehouse.example',grantId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});assert.equal(runtime.calls[0].args.p_action,'revoke');});
test('52 invalid UI action remains fail-closed',async()=>{var runtime=mutationRuntime();var result=await runtime.api.foundationMutation({action:'create',targetUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissionKey:'module.access'});assert.equal(result.ok,false);assert.equal(result.status,'invalid_input');assert.equal(runtime.calls.length,0);});
test('53 UI vocabulary remains grant and each mutation receives a fresh operation UUID',async()=>{var runtime=mutationRuntime();await runtime.api.foundationMutation({action:'grant',targetUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissionKey:'module.access'});await runtime.api.catalogMutation({action:'grant',targetUserId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',permissionKey:'warehouse.example'});assert.notEqual(runtime.calls[0].args.p_operation_id,runtime.calls[1].args.p_operation_id);assert.match(ui,/mutateFoundation\('grant'/);assert.match(ui,/mutateBusiness\('grant'/);});
