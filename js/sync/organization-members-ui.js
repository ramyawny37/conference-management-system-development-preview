(function(global){
  'use strict';

  var context=null;
  var state=createState();
  var flights=Object.create(null);

  function createState(){return {organizations:[],organizationsStatus:'idle',access:null,members:[],candidate:null,message:'',
    accessStatus:'idle',membersStatus:'idle',lookupStatus:'idle',
    pending:Object.create(null),manualRetry:false};}
  function escapeHtml(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function element(id){return global.document&&global.document.getElementById?global.document.getElementById(id):null;}
  function key(input){return [input.organizationId,input.targetUserId,input.action,input.requestedRole||''].join('|');}
  function api(){return global.OrganizationAdministrationService||null;}
  function canManage(){return !!(state.access&&state.access.canManageMembers);}
  function roleLabel(role){return role==='organization_owner'?'مالك المؤسسة':role==='organization_admin'?'مدير المؤسسة':'عضو';}
  function paint(){var host=element('organization_members_content');if(host)host.innerHTML=body();}
  function body(){
    if(!context||!context.organizationId){
      if(state.organizationsStatus==='loading'||state.organizationsStatus==='idle')return '<div class="settings-empty-state">جارٍ تحميل المؤسسات…</div>';
      if(!state.organizations.length)return '<div class="settings-empty-state">لا توجد مؤسسة متاحة لهذا الحساب.</div>';
      return organizationSelector();
    }
    if(state.accessStatus==='loading'||state.accessStatus==='idle')return '<div class="settings-empty-state">جارٍ التحقق من الصلاحية…</div>';
    if(!state.access)return '<div class="settings-empty-state">تعذر التحقق من صلاحية المؤسسة.</div>';
    var html=organizationSelector()+'<div class="sync-settings-message">صلاحيتك: <strong>'+escapeHtml(roleLabel(state.access.role))+'</strong></div>';
    if(canManage()){
      html+='<div class="sync-settings-actions"><button type="button" class="btn btn-gray btn-sm" onclick="OrganizationMembersUI.refresh()">تحديث القائمة</button></div>';
      html+=membersHtml()+managementHtml();
    }else html+='<div class="settings-empty-state">حسابك للقراءة فقط.</div>';
    if(state.message)html+='<div class="sync-settings-message">'+escapeHtml(state.message)+'</div>';
    return html;
  }
  function organizationSelector(){
    var html='<div class="sync-settings-panel"><h3>إدارة المؤسسة</h3><label class="lbl" for="organization_select">المؤسسة</label><select id="organization_select" onchange="OrganizationMembersUI.selectOrganization(this.value)"><option value="">اختر مؤسسة</option>';
    state.organizations.forEach(function(organization){html+='<option value="'+escapeHtml(organization.organizationId)+'"'+(context&&context.organizationId===organization.organizationId?' selected':'')+'>'+escapeHtml(organization.displayName)+'</option>';});
    return html+='</select></div>';
  }
  function membersHtml(){
    if(state.membersStatus==='loading')return '<div class="settings-empty-state">جارٍ تحميل الأعضاء…</div>';
    var html='<div class="settings-list">';state.members.forEach(function(member){
      var remove={organizationId:context.organizationId,targetUserId:member.userId,action:'remove_organization_member',requestedRole:null};
      var removeBusy=state.pending[key(remove)];
      var promote={organizationId:context.organizationId,targetUserId:member.userId,action:'change_organization_role',requestedRole:'organization_admin'};
      var demote={organizationId:context.organizationId,targetUserId:member.userId,action:'change_organization_role',requestedRole:'member'};
      html+='<div class="settings-list-item"><div><strong>'+escapeHtml(member.displayName||'مستخدم بدون اسم')+'</strong><div class="sync-settings-message">'+escapeHtml(roleLabel(member.role))+(member.isCurrentUser?' — الحساب الحالي':'')+'</div></div>';
      if(state.access.canManageMembers&&!member.isCurrentUser&&(member.role==='member'||(state.access.canManageAdmins&&member.role==='organization_admin')))html+='<button type="button" class="btn btn-red btn-sm" '+(removeBusy?'disabled ':'')+'onclick="OrganizationMembersUI.removeMember(\''+escapeHtml(member.userId)+'\')">'+(removeBusy?'جارٍ التنفيذ…':'إزالة العضو')+'</button>';
      if(state.access.canManageAdmins&&!member.isCurrentUser&&member.role==='member')html+='<button type="button" class="btn btn-blue btn-sm" '+(state.pending[key(promote)]?'disabled ':'')+'onclick="OrganizationMembersUI.changeRole(\''+escapeHtml(member.userId)+'\',\'organization_admin\')">'+(state.pending[key(promote)]?'جارٍ التنفيذ…':'مدير المؤسسة')+'</button>';
      if(state.access.canManageAdmins&&!member.isCurrentUser&&member.role==='organization_admin')html+='<button type="button" class="btn btn-gray btn-sm" '+(state.pending[key(demote)]?'disabled ':'')+'onclick="OrganizationMembersUI.changeRole(\''+escapeHtml(member.userId)+'\',\'member\')">'+(state.pending[key(demote)]?'جارٍ التنفيذ…':'عضو')+'</button>';
      html+='</div>';
    });return html+'</div>';
  }
  function managementHtml(){
    var html='<div class="sync-settings-panel"><h3>إدارة أعضاء المؤسسة</h3><label class="lbl" for="organization_member_lookup_email">البريد الإلكتروني</label><input id="organization_member_lookup_email" type="email" dir="ltr" autocomplete="off"><div class="sync-settings-actions"><button type="button" class="btn btn-blue btn-sm" '+(state.lookupStatus==='loading'?'disabled ':'')+'onclick="OrganizationMembersUI.lookup()">بحث</button>';
    if(state.candidate){var add={organizationId:context.organizationId,targetUserId:state.candidate.targetUserId,action:'add_organization_member',requestedRole:null};var busy=state.pending[key(add)];html+='<button type="button" class="btn btn-green btn-sm" '+(state.candidate.membershipStatus==='member'||busy?'disabled ':'')+'onclick="OrganizationMembersUI.addMember()">'+(busy?'جارٍ التنفيذ…':state.candidate.membershipStatus==='member'?'عضو بالفعل':'إضافة عضو')+'</button>';}
    html+='</div></div>';return html;
  }
  function renderSection(options){var next={organizationId:String(options&&options.organizationId||'')};if(!context||next.organizationId!==context.organizationId){context=next;state=createState();}return '<section class="settings-section sync-settings-section"><div class="settings-section-title">إدارة أعضاء المؤسسة</div><div id="organization_members_content">'+body()+'</div></section>';}
  function initialize(){
    var service=api();if(!service||typeof service.listMyOrganizations!=='function')return Promise.resolve({ok:false,status:'unavailable'});
    state.organizationsStatus='loading';paint();return service.listMyOrganizations().then(function(result){
      state.organizationsStatus=result&&result.ok?'loaded':'error';state.organizations=result&&result.ok?result.data.organizations:[];
      if(state.organizations.length){
        context={organizationId:state.organizations[0].organizationId};
        return service.reconcilePendingOperations().then(function(){return refreshUi();});
      }
      paint();return result;
    });
  }
  function selectOrganization(organizationId){context={organizationId:String(organizationId||'')};state.access=null;state.members=[];state.candidate=null;return refreshUi();}
  function refreshUi(){
    if(!context||!context.organizationId)return Promise.resolve({ok:false,status:'invalid_input'});
    var service=api();if(!service)return Promise.resolve({ok:false,status:'unavailable'});
    state.accessStatus='loading';paint();return service.refresh({organizationId:context.organizationId}).then(function(result){
      if(!result.ok){state.accessStatus='error';state.message='تعذر تحديث بيانات المؤسسة.';paint();return result;}
      state.accessStatus='available';state.access=result.data.access;state.members=result.data.members||[];state.membersStatus='loaded';paint();return result;
    });
  }
  function lookup(){
    if(!canManage())return Promise.resolve({ok:false,status:'access_denied'});
    var input=element('organization_member_lookup_email'),email=String(input&&input.value||'').trim();
    state.lookupStatus='loading';state.candidate=null;paint();return api().lookupCandidate({organizationId:context.organizationId,email:email}).then(function(result){
      state.lookupStatus=result&&result.ok?'candidate':'unavailable';state.candidate=result&&result.ok?result.data:null;state.message=result&&result.ok?'تم العثور على مرشح.':'لا يتوفر مرشح بهذا البريد.';paint();return result;
    });
  }
  function run(input){
    var intentKey=key(input);if(flights[intentKey])return flights[intentKey];state.pending[intentKey]=true;paint();
    var method=input.action==='add_organization_member'?'addMember':input.action==='remove_organization_member'?'removeMember':'changeRole';
    var flight=api()[method](input).then(function(result){
      delete state.pending[intentKey];
      if(result.status==='unknown'){state.message='تعذر تأكيد النتيجة. أعد المحاولة لإعادة الطلب نفسه بأمان.';}
      else if(result.status==='operation_mismatch'){state.candidate=null;state.manualRetry=true;state.message='تطابق العملية غير صالح. حدّد المرشح وأنشئ طلبًا جديدًا.';}
      else if(result&&result.data&&result.data.refresh){state.access=result.data.refresh.access;state.members=result.data.refresh.members||[];state.membersStatus='loaded';state.message=result.ok?'تم تأكيد العملية من الخادم.':'تم تحديث البيانات من الخادم.';}
      paint();return result;
    }).finally(function(){delete flights[intentKey];});flights[intentKey]=flight;return flight;
  }
  function addMember(){if(!state.candidate)return Promise.resolve({ok:false,status:'invalid_input'});return run({organizationId:context.organizationId,targetUserId:state.candidate.targetUserId,action:'add_organization_member',requestedRole:null});}
  function removeMember(targetUserId){return run({organizationId:context.organizationId,targetUserId:String(targetUserId||''),action:'remove_organization_member',requestedRole:null});}
  function changeRole(targetUserId,requestedRole){return run({organizationId:context.organizationId,targetUserId:String(targetUserId||''),action:'change_organization_role',requestedRole:String(requestedRole||'')});}
  function reconcile(){return api().reconcilePendingOperations().then(function(result){return refreshUi().then(function(){return result;});});}
  global.OrganizationMembersUI=Object.freeze({renderSection:renderSection,initialize:initialize,selectOrganization:selectOrganization,refresh:refreshUi,lookup:lookup,addMember:addMember,removeMember:removeMember,changeRole:changeRole,reconcile:reconcile});
})(window);
