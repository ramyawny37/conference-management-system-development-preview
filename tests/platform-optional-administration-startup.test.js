'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
const deviceUi=fs.readFileSync(path.join(root,'js/sync/device-authorization-administration-ui.js'),'utf8');
const deviceService=fs.readFileSync(path.join(root,'js/supabase/device-authorization-administration-service.js'),'utf8');
const administrationUi=fs.readFileSync(path.join(root,'js/sync/platform-administration-ui.js'),'utf8');
const startup=script.slice(script.indexOf('function openStartupScreen'),script.indexOf('function renderHouseTemplateDetails'));
const authorizedStartup=script.slice(script.indexOf('function completeAuthorizedApplicationStartup'),script.indexOf('(function startIntegratedPlatform'));

assert.doesNotMatch(index,/DOMContentLoaded[\s\S]{0,500}DeviceAuthorizationAdministrationUI\.initialize\(\)/);
assert.doesNotMatch(startup,/ensureOrganizationManagementAccess\(\)/);
assert.doesNotMatch(script,/function renderSettings\(\)[\s\S]{0,600}ensureUserManagementAccess\(\);/);
assert.match(administrationUi,/global\.UserManagementUI\.initialize\(\)/);
assert.match(administrationUi,/global\.ModulePermissionAdministrationUI\.initialize\(\)/);
assert.match(script,/function initializePlatformAdministrationContext\(\)[\s\S]*ensureUserManagementAccess\(\)[\s\S]*ensureModulePermissionAdministrationAccess\(\)/);
assert.match(authorizedStartup,/completeApplicationStartup\(\)[\s\S]*initializePlatformAdministrationContext\(\)[\s\S]*StartupConferenceDiscovery/);
assert.match(script,/function ensureUserManagementAccess\(\)[\s\S]*UserManagementReadService\.getActorCapabilities\(\)/);
assert.doesNotMatch(script,/ensureOrganizationManagementAccess|OrganizationManagementService/);
assert.match(script,/function ensureModulePermissionAdministrationAccess\(\)[\s\S]*ModulePermissionAdministrationService\.probeAvailability\('warehouse'\)[\s\S]*ModulePermissionAdministrationService\.probeAvailability\('reservations'\)/);
assert.match(deviceUi,/global\.DeviceAuthorizationAdministrationUI=Object\.freeze\(\{initialize:initialize/);
assert.match(deviceService,/function administrationState\(options\)[\s\S]*get-administration-state/);
assert.match(deviceUi,/function refreshPlatformPendingRequests\(\)[\s\S]*listSystemOwnerPendingDevices/);
assert.match(administrationUi,/device_authorization_administration_root[\s\S]*DeviceAuthorizationAdministrationUI\.initialize/);

async function administrationContext(responses){
  const tab={style:{display:'none'}};
  const sandbox={Promise,window:{
    UserManagementReadService:{getActorCapabilities:()=>Promise.resolve(responses.user)},
    ModulePermissionAdministrationService:{probeAvailability:()=>Promise.resolve(responses.module)}
  },document:{querySelectorAll:()=>[]},ge:id=>id==='tab6'?tab:null};
  sandbox.window.window=sandbox.window;
  const contextSource=script.slice(script.indexOf('var userManagementAccessState='),script.indexOf('function canEditCurrentConferenceData'));
  vm.runInNewContext(contextSource,sandbox);
  await sandbox.initializePlatformAdministrationContext();
  return vm.runInNewContext('({user:userManagementAccessState,module:modulePermissionAdministrationAccessState})',sandbox);
}

(async()=>{
  const owner=await administrationContext({
    user:{ok:true,data:{capabilities:{canOpenUserManagement:true,canManageAccount:true,canViewDevices:true}}},
    module:{ok:true,data:{ownerConfirmed:true}}
  });
  assert.equal(owner.user.capabilities.canOpenUserManagement,true);
  assert.equal(owner.module.available,true);

  const denied=await administrationContext({user:{ok:false},module:{ok:false}});
  assert.equal(denied.user.capabilities,null);
  assert.equal(denied.module.available,false);
  console.log('Platform optional administration startup contracts: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
