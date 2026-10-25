const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const migration=read('supabase/migrations/20261015170000_platform_administration_role_unification.sql');
const reads=read('supabase/migrations/20261015173000_platform_administration_scoped_reads.sql');
const service=read('js/sync/module-permission-administration-service.js');
const ui=read('js/sync/module-permission-administration-ui.js');
const userService=read('js/sync/user-management-read-service.js');
const userUi=read('js/sync/user-management-ui.js');
const script=read('script.js');
const index=read('index.html');
const worker=read('service-worker.js');
const platformAdministration=read('js/sync/platform-administration-ui.js');

test('existing canonical role and permission stores are extended without a parallel authority',()=>{
  for(const table of ['platform.roles','platform.role_permissions','platform.user_roles','platform.permissions'])assert.match(migration,new RegExp(table.replace('.','\\.')));
  assert.doesNotMatch(migration,/create table (?:public\.)?(?:functional_roles|permission_roles|conference_roles|organizations)/i);
  assert.match(migration,/platform_private\.user_has_module_permission_for/);
  assert.match(migration,/create or replace function public\.require_effective_module_permission/);
});

test('initial Conference roles include minimum read dependencies and never equate member management with people management',()=>{
  for(const role of ['conference_manager','people_manager','accommodation_manager','restaurant_manager','transport_manager','conference_viewer'])assert.match(migration,new RegExp("'"+role+"'"));
  assert.match(migration,/when 'people_manager'[\s\S]*conference\.people\.view[\s\S]*conference\.people\.manage/);
  assert.match(migration,/when 'accommodation_manager'[\s\S]*conference\.people\.view[\s\S]*conference\.accommodation\.view[\s\S]*conference\.accommodation\.manage/);
  assert.doesNotMatch(migration,/conference\.members\.manage['"]?\s*(?:=|or)\s*['"]?conference\.people/);
});

test('Conference manager delegation is device-bound, scope-bound and cannot exceed actor authority',()=>{
  assert.match(migration,/public\.require_current_approved_device\(p_actor_device_id\)/);
  assert.match(migration,/conference\.members\.manage','conference',p_resource_id/);
  assert.match(migration,/ROLE_EXCEEDS_ACTOR_AUTHORITY/);
  assert.match(migration,/platform_private\.user_has_module_permission_for\(a,p\.code,'conference',p_resource_id\)/);
  assert.match(migration,/role\.granted/);
  assert.match(migration,/role\.revoked/);
  assert.match(migration,/insert into platform\.audit_events/);
});

test('role grant and revoke reuse the protected permission operation and preserve dispatcher parity',()=>{
  assert.match(service,/invoke\('manage_catalog_module_grant'/);
  assert.match(service,/roleMutation/);
  assert.match(service,/role_grant/);
  assert.match(service,/role_revoke/);
  assert.match(ui,/data-role-grant/);
  assert.match(ui,/data-role-revoke/);
  assert.doesNotMatch(service+ui,/\.from\s*\(|\.rpc\s*\(/);
});

test('accounts load automatically, search is optional, and paging remains selectable',()=>{
  assert.match(ui,/loadCandidates\(''\)/);
  assert.match(ui,/البحث فلتر اختياري/);
  assert.match(userUi,/pageSize:25/);
  assert.match(userUi,/UserManagementUI\.page/);
  assert.match(userService,/p_limit:limit/);
  assert.match(userUi,/selectUser/);
  assert.match(userUi,/ليس لديك صلاحية عرض حسابات/);
  assert.match(userUi,/لا توجد حسابات متاحة/);
  assert.match(userUi,/تعذر تحميل الحسابات/);
});

test('Platform administration uses the canonical Platform sidebar with one route per concern',()=>{
  for(const route of ['users','roles','devices','audit'])assert.match(index,new RegExp('data-platform-route="/platform-administration/'+route+'"'));
  for(const label of ['المستخدمون والحسابات','الأدوار والصلاحيات','اعتماد الأجهزة','سجل التدقيق'])assert.equal((index.match(new RegExp(label,'g'))||[]).length,1,label);
  assert.match(index,/canonical-platform-sidebar[\s\S]*data-platform-nav-group="platform-administration"/);
  assert.doesNotMatch(script,/settings-nav-group-label[^\n]*إدارة المنصة/);
  assert.doesNotMatch(script,/switchSettingsTab\('(users|module-permissions|platform-devices|platform-audit|platform-security)'\)/);
  assert.doesNotMatch(index,/platform-administration-shell|admin-shell/);
  assert.match(platformAdministration,/device_authorization_administration_root/);
  assert.match(userUi,/platform_audit_screen/);
});

test('independent administration routes mount without a selected Conference and reuse current services',()=>{
  assert.match(index,/id="platform-administrationWorkspace"/);
  assert.match(platformAdministration,/PlatformIntegration\.registerModule\(\{id:'platform-administration'/);
  assert.match(platformAdministration,/UserManagementUI\.renderSection/);
  assert.match(platformAdministration,/ModulePermissionAdministrationUI\.renderSection/);
  assert.match(platformAdministration,/DeviceAuthorizationAdministrationUI\.initialize/);
  assert.doesNotMatch(platformAdministration,/getCurrentConference|selectedConference|localStorage|indexedDB|\.rpc\s*\(|\.from\s*\(/);
});

test('sidebar visibility follows protected capability state and routes remain fail closed',()=>{
  assert.match(platformAdministration,/capabilities\.canOpenUserManagement===true/);
  assert.match(platformAdministration,/capabilities\.canViewDevices===true\|\|capabilities\.canManageDevices===true/);
  assert.match(platformAdministration,/capabilities\.canViewAudit===true/);
  assert.match(platformAdministration,/permissions\.available===true/);
  assert.match(platformAdministration,/item\.hidden=!access\.pending&&access\[section\]!==true/);
  assert.match(platformAdministration,/group\.hidden=!Object\.keys\(sections\)\.some/);
});

test('permission module switches preserve the selected account and unify effective authority',()=>{
  assert.match(ui,/var selected=state\.selected;[\s\S]*state=\{moduleKey:selectedModuleKey,selected:selected/);
  assert.match(ui,/الأدوار والصلاحيات الفعلية/);
  assert.match(ui,/من خلال دور/);
  assert.match(ui,/تفويض مباشر/);
  assert.match(ui,/<details class="module-permission-advanced"><summary>التفويضات المباشرة — إعدادات متقدمة/);
});

test('account, device and audit reads use granular Platform permissions',()=>{
  for(const permission of ['platform.users.view','platform.devices.view'])assert.match(reads,new RegExp(permission.replace('.','\\.')));
  assert.match(migration,/platform\.audit\.view/);
  assert.match(migration,/platform\.access\.manage/);
  assert.doesNotMatch(reads,/public\.is_system_owner\(actor_id\)/);
});

test('cache references are atomically consistent for every changed runtime asset',()=>{
  const revision='platform-administration-canonical-sidebar-navigation-v2';
  const styleRevision='canonical-accommodation-room-details-v4';
  const deviceListRevision='platform-admin-security-retirement-v1';
  for(const asset of ['style.css','canonical-platform-shell.css','js/platform-integration.js','js/sync/user-management-ui.js','js/sync/module-permission-administration-ui.js','js/sync/platform-administration-ui.js','script.js']){
    const assetRevision=asset==='style.css'?styleRevision:asset==='canonical-platform-shell.css'?'conference-header-content-offset-v1':asset==='script.js'?'canonical-guardian-child-v1':asset==='js/platform-integration.js'?'canonical-guardian-child-v1':asset==='js/sync/discovered-conference-open-service.js'?'conference-navigation-consolidation-v1':(asset==='js/sync/user-management-ui.js'||asset==='js/sync/platform-administration-ui.js')?deviceListRevision:revision;
    assert.ok(index.includes(asset+'?rev='+assetRevision),asset+' missing from index');
    assert.ok(worker.includes('./'+asset+'?rev='+assetRevision),asset+' missing from worker');
  }
  assert.match(worker,/\? 'development-canonical-guardian-child-v1'/);
});

test('retired tenancy, direct database clients and local permission fallbacks remain absent',()=>{
  assert.doesNotMatch(service+ui+userService+userUi,/organizations|organizationId|systemRoles/i);
  assert.doesNotMatch(service+userService,/localStorage|indexedDB|createClient|supabase\.co/i);
  assert.doesNotMatch(migration,/grant\s+(?:select|insert|update|delete).*to\s+(?:anon|authenticated)/i);
});
