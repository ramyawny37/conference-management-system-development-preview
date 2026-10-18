(function(global){
  'use strict';
  var rootId='platform-administrationWorkspace';
  var sections={users:true,roles:true,devices:true,audit:true,security:true};
  var currentSection='users';
  var mounted=false;
  var initialized=false;

  function routeSection(route){
    var match=/^\/platform-administration\/(users|roles|devices|audit|security)(?:\/|$)/.exec(String(route||''));
    return match?match[1]:'users';
  }
  function root(){return global.document&&global.document.getElementById(rootId);}
  function navigationState(){
    var users=global.UserManagementUI&&typeof global.UserManagementUI.getNavigationState==='function'?global.UserManagementUI.getNavigationState():{};
    var permissions=global.ModulePermissionAdministrationUI&&typeof global.ModulePermissionAdministrationUI.getNavigationState==='function'?global.ModulePermissionAdministrationUI.getNavigationState():{};
    var capabilities=users.capabilities||{};
    return {
      users:capabilities.canOpenUserManagement===true,
      roles:permissions.available===true,
      devices:capabilities.canViewDevices===true||capabilities.canManageDevices===true,
      audit:capabilities.canViewAudit===true,
      security:capabilities.canManageSecurity===true,
      pending:users.status==='idle'||users.status==='loading'||permissions.status==='idle'||permissions.status==='loading'
    };
  }
  function syncSidebar(){
    if(!global.document||!global.document.querySelectorAll)return;
    var access=navigationState();
    Array.prototype.forEach.call(global.document.querySelectorAll('[data-platform-administration-section]'),function(item){
      var section=item.getAttribute('data-platform-administration-section');
      item.hidden=!access.pending&&access[section]!==true;
      if(section===currentSection)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
    });
    var group=global.document.querySelector('[data-platform-nav-group="platform-administration"]');
    if(group){
      group.hidden=!Object.keys(sections).some(function(section){return access[section]===true;});
      var toggle=group.querySelector('[data-platform-nav-toggle="platform-administration"]');
      var subnav=group.querySelector('.canonical-platform-subnav');
      if(toggle)toggle.setAttribute('aria-expanded','true');
      if(subnav)subnav.hidden=false;
    }
  }
  function unavailable(){return '<div class="settings-empty-state">تعذر تحميل قسم إدارة المنصة.</div>';}
  function sectionContent(){
    if(currentSection==='roles')return global.ModulePermissionAdministrationUI&&typeof global.ModulePermissionAdministrationUI.renderSection==='function'?global.ModulePermissionAdministrationUI.renderSection():unavailable();
    if(currentSection==='audit')return global.UserManagementUI&&typeof global.UserManagementUI.renderAuditSection==='function'?global.UserManagementUI.renderAuditSection():unavailable();
    if(currentSection==='security')return global.UserManagementUI&&typeof global.UserManagementUI.renderSecuritySection==='function'?global.UserManagementUI.renderSecuritySection():unavailable();
    if(currentSection==='devices')return '<div id="device_authorization_administration_root"></div>'+(global.UserManagementUI&&typeof global.UserManagementUI.renderSection==='function'?global.UserManagementUI.renderSection():unavailable());
    return global.UserManagementUI&&typeof global.UserManagementUI.renderSection==='function'?global.UserManagementUI.renderSection():unavailable();
  }
  function renderRoute(route){
    var node=root();
    var nextSection=routeSection(route||global.ApplicationRouting&&global.ApplicationRouting.getLogicalPathname&&global.ApplicationRouting.getLogicalPathname());
    var sectionChanged=nextSection!==currentSection;
    if(!node)return false;
    if(mounted&&!sectionChanged&&nextSection==='devices'){
      var usersNode=global.document.getElementById('user_management_screen');
      if(usersNode&&global.UserManagementUI&&typeof global.UserManagementUI.renderSection==='function')usersNode.outerHTML=global.UserManagementUI.renderSection();
      syncSidebar();
      return true;
    }
    currentSection=nextSection;
    node.innerHTML='<div class="platform-administration-screen" dir="rtl"><header class="platform-administration-heading"><span>إدارة المنصة</span><h2>'+({users:'المستخدمون والحسابات',roles:'الأدوار والصلاحيات',devices:'اعتماد الأجهزة',audit:'سجل التدقيق',security:'إعدادات الأمان'}[currentSection])+'</h2></header>'+sectionContent()+'</div>';
    syncSidebar();
    if(currentSection==='roles'&&initialized&&global.ModulePermissionAdministrationUI&&typeof global.ModulePermissionAdministrationUI.activate==='function')global.ModulePermissionAdministrationUI.activate();
    if(!initialized){
      initialized=true;
      if(global.UserManagementUI)global.UserManagementUI.initialize();
      if(global.ModulePermissionAdministrationUI)global.ModulePermissionAdministrationUI.initialize();
    }
    if(currentSection==='devices'&&global.DeviceAuthorizationAdministrationUI)global.DeviceAuthorizationAdministrationUI.initialize();
    return true;
  }
  function mount(context){mounted=true;return renderRoute(context&&context.route);}
  function unmount(){mounted=false;initialized=false;currentSection='users';var node=root();if(node)node.innerHTML='';}
  function isMounted(){return mounted;}
  function refresh(){if(!mounted)return false;return renderRoute();}
  function initialize(){
    if(!global.PlatformIntegration||typeof global.PlatformIntegration.registerModule!=='function')return false;
    global.PlatformIntegration.registerModule({id:'platform-administration',mount:mount,reconcileRoute:function(context){return renderRoute(context&&context.route);},unmount:unmount});
    return true;
  }
  global.PlatformAdministrationUI=Object.freeze({initialize:initialize,renderRoute:renderRoute,refresh:refresh,syncSidebar:syncSidebar,isMounted:isMounted,routeSection:routeSection,navigationState:navigationState});
  initialize();
})(window);
