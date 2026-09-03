'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
const deviceUi=fs.readFileSync(path.join(root,'js/sync/device-authorization-administration-ui.js'),'utf8');
const deviceService=fs.readFileSync(path.join(root,'js/supabase/device-authorization-administration-service.js'),'utf8');
const startup=script.slice(script.indexOf('function openStartupScreen'),script.indexOf('function renderHouseTemplateDetails'));

assert.doesNotMatch(index,/DOMContentLoaded[\s\S]{0,500}DeviceAuthorizationAdministrationUI\.initialize\(\)/);
assert.doesNotMatch(startup,/ensureOrganizationManagementAccess\(\)/);
assert.match(script,/function renderSettings\(\)[\s\S]{0,300}ensureUserManagementAccess\(\);[\s\S]*ensureOrganizationManagementAccess\(\);/);
assert.match(deviceUi,/global\.DeviceAuthorizationAdministrationUI=Object\.freeze\(\{initialize:initialize/);
assert.match(deviceService,/function administrationState\(options\)[\s\S]*get-administration-state/);
assert.match(deviceUi,/function refreshPlatformPendingRequests\(\)[\s\S]*listPlatformPendingDevices/);
assert.match(script,/device_authorization_administration_root[\s\S]*refreshDeviceAuthorizationAdministration/);
console.log('Platform optional administration startup contracts: passed');
