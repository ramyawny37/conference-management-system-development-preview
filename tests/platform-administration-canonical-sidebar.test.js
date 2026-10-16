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
    'platform_security_screen':{},
  };
  const sidebarItems=['users','roles','devices','audit','security'].map(section=>({section,hidden:false,attributes:{},getAttribute(name){return name==='data-platform-administration-section'?section:this.attributes[name];},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];}}));
  const subnav={hidden:true,querySelectorAll(){return sidebarItems;}};
  const toggle={attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
  const group={hidden:false,querySelector(selector){return selector.includes('toggle')?toggle:subnav;}};
  let moduleDefinition;
  const window={
    document:{getElementById:id=>nodes[id]||null,querySelectorAll:()=>sidebarItems,querySelector:()=>group},
    ApplicationRouting:{getLogicalPathname:()=>route},
    PlatformIntegration:{registerModule(definition){moduleDefinition=definition;calls.push(['register',definition.id]);}},
    UserManagementUI:{renderSection:()=>'<section id="user_management_screen">users</section>',renderAuditSection:()=>'<section id="platform_audit_screen">audit</section>',renderSecuritySection:()=>'<section id="platform_security_screen">security</section>',initialize(){calls.push(['users-init']);return Promise.resolve();},getNavigationState:()=>({status:'loaded',capabilities:{canOpenUserManagement:true,canViewDevices:true,canViewAudit:false,canManageSecurity:false}})},
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
  assert.equal(state.sidebarItems.find(item=>item.section==='security').hidden,true);
  assert.equal(state.sidebarItems.find(item=>item.section==='audit').attributes['aria-current'],'page');
  assert.equal(state.toggle.attributes['aria-expanded'],'true');
  assert.equal(state.subnav.hidden,false);
});

test('authorized startup restores an administration deep link without requiring a Conference',()=>{
  assert.match(script,/\^\\\/(?:\(\?:)?warehouse\|reservations\|platform-administration/);
  assert.match(script,/PLATFORM_MODULE_ROUTE/);
});

test('unmount clears the shared workspace without mutating authorization state',()=>{
  const state=runtime('/platform-administration/security');
  state.moduleDefinition.mount({route:'/platform-administration/security'});
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
  const asset='style.css?rev=platform-administration-workspace-visibility-v1';
  assert.ok(index.includes(asset),'HTML must request revised workspace stylesheet');
  assert.ok(worker.includes("'./"+asset+"'"),'service worker must precache the revised stylesheet');
  assert.match(worker,/development-administration-workspace-visibility-v1/);
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
