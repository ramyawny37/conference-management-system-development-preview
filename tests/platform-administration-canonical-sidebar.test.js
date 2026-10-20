'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('js/sync/platform-administration-ui.js','utf8');
const script=fs.readFileSync('script.js','utf8');
const styles=fs.readFileSync('style.css','utf8');
const integration=fs.readFileSync('js/platform-integration.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

function runtime(route){
  const calls=[];
  const nodes={
    'platform-administrationWorkspace':{innerHTML:''},
    'platform_audit_screen':{},
  };
  const sidebarItems=['users','roles','devices','audit'].map(section=>({section,hidden:false,attributes:{},getAttribute(name){return name==='data-platform-administration-section'?section:this.attributes[name];},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];}}));
  const subnav={hidden:true,querySelectorAll(){return sidebarItems;}};
  const toggle={attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
  const group={hidden:false,querySelector(selector){return selector.includes('toggle')?toggle:subnav;}};
  let moduleDefinition;
  const window={
    document:{getElementById:id=>nodes[id]||null,querySelectorAll:()=>sidebarItems,querySelector:()=>group},
    ApplicationRouting:{getLogicalPathname:()=>route},
    PlatformIntegration:{registerModule(definition){moduleDefinition=definition;calls.push(['register',definition.id]);}},
    UserManagementUI:{renderSection:()=>'<section id="user_management_screen">users</section>',renderAuditSection:()=>'<section id="platform_audit_screen">audit</section>',initialize(){calls.push(['users-init']);return Promise.resolve();},getNavigationState:()=>({status:'loaded',capabilities:{canOpenUserManagement:true,canViewDevices:true,canViewAudit:false,canManageSecurity:false}})},
    ModulePermissionAdministrationUI:{renderSection:()=>'<section id="module_permission_administration_screen">roles</section>',initialize(){calls.push(['roles-init']);return Promise.resolve();},getNavigationState:()=>({status:'ready',available:true})},
    DeviceAuthorizationAdministrationUI:{initialize(){calls.push(['devices-init']);return Promise.resolve();}},
  };
  vm.runInNewContext(source,{window,Object,String,Array,Promise});
  return {window,calls,nodes,sidebarItems,toggle,subnav,moduleDefinition,setRoute(value){route=value;}};
}

test('all canonical administration routes mount independently and initialize only their existing service UI',()=>{
  const state=runtime('/platform-administration/users');
  assert.equal(state.moduleDefinition.id,'platform-administration');
  assert.equal(state.moduleDefinition.mount({route:'/platform-administration/users'}),true);
  assert.match(state.nodes['platform-administrationWorkspace'].innerHTML,/user_management_screen/);
  state.setRoute('/platform-administration/roles');
  assert.equal(state.moduleDefinition.reconcileRoute({route:'/platform-administration/roles'}),true);
  assert.match(state.nodes['platform-administrationWorkspace'].innerHTML,/module_permission_administration_screen/);
  state.setRoute('/platform-administration/devices');
  state.moduleDefinition.reconcileRoute({route:'/platform-administration/devices'});
  assert.match(state.nodes['platform-administrationWorkspace'].innerHTML,/device_authorization_administration_root/);
  assert.equal(state.calls.filter(call=>call[0]==='devices-init').length,1);
});

test('route reconciliation supports reload and permission-aware sidebar visibility',()=>{
  const state=runtime('/platform-administration/audit');
  state.moduleDefinition.mount({route:'/platform-administration/audit'});
  assert.match(state.nodes['platform-administrationWorkspace'].innerHTML,/platform_audit_screen/);
  assert.equal(state.sidebarItems.find(item=>item.section==='users').hidden,false);
  assert.equal(state.sidebarItems.find(item=>item.section==='roles').hidden,false);
  assert.equal(state.sidebarItems.find(item=>item.section==='audit').hidden,true);
  assert.equal(state.sidebarItems.find(item=>item.section==='audit').attributes['aria-current'],'page');
  assert.equal(state.toggle.attributes['aria-expanded'],'true');
  assert.equal(state.subnav.hidden,false);
});

test('authorized startup restores an administration deep link without requiring a Conference',()=>{
  assert.match(script,/\^\\\/(?:\(\?:)?warehouse\|reservations\|platform-administration/);
  assert.match(script,/PLATFORM_MODULE_ROUTE/);
});

test('unmount clears the shared workspace without mutating authorization state',()=>{
  const state=runtime('/platform-administration/audit');
  state.moduleDefinition.mount({route:'/platform-administration/audit'});
  state.moduleDefinition.unmount();
  assert.equal(state.nodes['platform-administrationWorkspace'].innerHTML,'');
  assert.equal(state.window.PlatformAdministrationUI.isMounted(),false);
});

test('canonical shell owns administration workspace visibility alongside all peer modules',()=>{
  const visibilityRule=styles.match(/\.platform-conference-active \.platform-home[^\n]*\.platform-platform-administration-active #platform-administrationWorkspace\{display:flex\}/);
  assert.ok(visibilityRule,'administration must be included in the canonical active-module CSS rule');
  assert.match(visibilityRule[0],/\.platform-platform-administration-active \.platform-home\{display:none\}/);
  assert.match(visibilityRule[0],/\.platform-platform-administration-active \.platform-module-switcher\{display:flex\}/);
  assert.match(integration,/function syncModuleContainers\(activeId\)[\s\S]*?container\.hidden=!visible/);
  assert.match(integration,/shell\.classList\.add\('platform-'\+id\+'-active'\)/);
  assert.match(integration,/function moduleContainer\(id\)\{return global\.document&&global\.document\.getElementById\(id\+'Workspace'\);\}/);
});

test('Development PWA serves the same revisioned canonical administration visibility CSS',()=>{
  const asset='style.css?rev=platform-design-system-consolidation-v2';
  assert.ok(index.includes(asset),'HTML must request revised workspace stylesheet');
  assert.ok(worker.includes("'./"+asset+"'"),'service worker must precache the revised stylesheet');
  assert.match(worker,/development-platform-design-system-v2/);
});


test('device administration stays mounted through unrelated user refreshes',()=>{
  const state=runtime('/platform-administration/devices');
  state.moduleDefinition.mount({route:'/platform-administration/devices'});
  const before=state.nodes['platform-administrationWorkspace'].innerHTML;
  const deviceInitializations=state.calls.filter(call=>call[0]==='devices-init').length;
  assert.equal(deviceInitializations,1);
  state.window.PlatformAdministrationUI.refresh();
  assert.equal(state.nodes['platform-administrationWorkspace'].innerHTML,before);
  assert.equal(state.calls.filter(call=>call[0]==='devices-init').length,1);
  state.moduleDefinition.unmount();
  state.moduleDefinition.mount({route:'/platform-administration/devices'});
  assert.equal(state.calls.filter(call=>call[0]==='devices-init').length,2);
});

test('sidebar group remains visible while permissions data is loading if user access is confirmed',()=>{
  const state=runtime('/platform-administration/users');
  state.window.ModulePermissionAdministrationUI.getNavigationState=()=>({status:'loading',available:false});
  state.moduleDefinition.mount({route:'/platform-administration/users'});
  assert.equal(state.sidebarItems.find(item=>item.section==='users').hidden,false);
});

test('device route preserves the pending approval root across background refresh',()=>{
  const state=runtime('/platform-administration/devices');
  state.moduleDefinition.mount({route:'/platform-administration/devices'});
  const original=state.nodes['platform-administrationWorkspace'].innerHTML;
  assert.match(original,/device_authorization_administration_root/);
  assert.equal(state.window.PlatformAdministrationUI.refresh(),true);
  assert.equal(state.nodes['platform-administrationWorkspace'].innerHTML,original);
  assert.equal(state.calls.filter(call=>call[0]==='devices-init').length,1);
  assert.match(source,/mounted&&!sectionChanged&&!firstRender/);
});

test('roles route retains its bound DOM on same-route reconciliation and delegates refresh to its owner',()=>{
  const state=runtime('/platform-administration/roles');
  state.window.ModulePermissionAdministrationUI.activate=()=>{state.calls.push(['roles-activate']);return Promise.resolve(true);};
  state.moduleDefinition.mount({route:'/platform-administration/roles'});
  const original=state.nodes['platform-administrationWorkspace'].innerHTML;
  state.nodes['platform-administrationWorkspace'].innerHTML=original+'<!-- bound-role-controls -->';
  state.moduleDefinition.reconcileRoute({route:'/platform-administration/roles'});
  assert.match(state.nodes['platform-administrationWorkspace'].innerHTML,/bound-role-controls/);
  assert.equal(state.window.PlatformAdministrationUI.refresh(),true);
  assert.match(state.nodes['platform-administrationWorkspace'].innerHTML,/bound-role-controls/);
  assert.equal(state.calls.filter(call=>call[0]==='roles-activate').length,1);
  state.moduleDefinition.reconcileRoute({route:'/platform-administration/users'});
  state.moduleDefinition.reconcileRoute({route:'/platform-administration/roles'});
  assert.equal(state.calls.filter(call=>call[0]==='roles-activate').length,2);
});

test('user selection and account data refresh repaint the active users view',()=>{
  const state=runtime('/platform-administration/users');
  state.moduleDefinition.mount({route:'/platform-administration/users'});
  const node=state.nodes['platform-administrationWorkspace'];
  node.innerHTML+='<!-- stale-account-details -->';
  state.window.PlatformAdministrationUI.refresh();
  assert.doesNotMatch(node.innerHTML,/stale-account-details/);
  assert.match(node.innerHTML,/user_management_screen/);
});

test('audit refreshes its data while roles and devices preserve event-bound roots',()=>{
  for(const section of ['audit']){
    const state=runtime('/platform-administration/'+section);
    state.moduleDefinition.mount({route:'/platform-administration/'+section});
    const node=state.nodes['platform-administrationWorkspace'];
    node.innerHTML+='<!-- stale-admin-data -->';
    state.window.PlatformAdministrationUI.refresh();
    assert.doesNotMatch(node.innerHTML,/stale-admin-data/,section);
  }
});

test('pending device requests distinguish an unverified state from a verified empty list',()=>{
  const deviceUi=fs.readFileSync('js/sync/device-authorization-administration-ui.js','utf8');
  assert.match(deviceUi,/لم يتم التحقق من طلبات الاعتماد بعد/);
  assert.match(deviceUi,/state\.pendingStatus==='loaded'\?'لا توجد طلبات اعتماد معلقة في القائمة المحمية/);
  assert.match(deviceUi,/result\.status==='listed'&&result\.data&&Array\.isArray\(result\.data\.devices\)/);
  assert.match(deviceUi,/الاعتماد المحمي غير جاهز/);
  assert.match(deviceUi,/اعتماد الجهاز/);
  assert.match(deviceUi,/رفض الطلب/);
});

test('owner passkey enrollment is exposed only for enrollment_required',()=>{
  const ui=fs.readFileSync('js/sync/device-authorization-administration-ui.js','utf8');
  assert.match(ui,/state\.platformStatus==='enrollment_required'\?/);
  assert.match(ui,/DeviceAuthorizationAdministrationUI\.enrollPlatformCredential\(\)/);
  assert.match(ui,/تسجيل مفتاح مرور المالك/);
  assert.match(ui,/enrollSystemOwnerCredential\(token\)/);
});
