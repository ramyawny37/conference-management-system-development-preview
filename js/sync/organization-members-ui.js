(function(global){
  'use strict';

  var context=null;
  var contextUserId='';
  var state=createState();
  var flights=Object.create(null);
  var initializationFlight=null;
  var STALE_PENDING_AGE_MS=5*60*1000;

  function createState(){return {organizations:[],organizationsStatus:'idle',access:null,members:[],candidate:null,lookupEmail:'',message:'',operations:[],lastRefreshAt:null,connectionState:'غير متصل',
    accessStatus:'idle',membersStatus:'idle',lookupStatus:'idle',
    pending:Object.create(null),manualRetry:false};}
  function escapeHtml(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function element(id){return global.document&&global.document.getElementById?global.document.getElementById(id):null;}
  function authenticatedUserId(){var auth=global.SupabaseAuth,state=auth&&typeof auth.getState==='function'?auth.getState():null,session=auth&&typeof auth.getSession==='function'?auth.getSession():null;return String(state&&state.user&&state.user.id||session&&session.user&&session.user.id||'');}
  function selectionStorageKey(){var namespace=global.BrowserStorageNamespace,userId=authenticatedUserId();return namespace&&typeof namespace.key==='function'&&userId?namespace.key('administered-organization-selection:'+userId):'';}
  function readStoredSelection(){var key=selectionStorageKey();if(!key||!global.localStorage)return '';try{return String(global.localStorage.getItem(key)||'');}catch(error){return '';}}
  function storeSelection(organizationId){var key=selectionStorageKey();if(!key||!global.localStorage)return;try{if(organizationId)global.localStorage.setItem(key,String(organizationId));else global.localStorage.removeItem(key);}catch(error){}}
  function availableOrganizationId(organizationId){organizationId=String(organizationId||'');return state.organizations.some(function(item){return item.organizationId===organizationId;})?organizationId:'';}
  function key(input){return [input.organizationId,input.targetUserId,input.action,input.requestedRole||''].join('|');}
  function api(){return global.OrganizationAdministrationService||null;}
  function canManage(){return !!(state.access&&state.access.canManageMembers);}
  function targetMutationPending(organizationId,targetUserId){var prefix=[organizationId,targetUserId,''].join('|');return Object.keys(state.pending).some(function(intentKey){return state.pending[intentKey]&&intentKey.indexOf(prefix)===0;});}
  function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
  function isCurrentOrganization(organizationId){return !!(context&&context.organizationId===organizationId);}
  function stalePendingOperation(operation){var timestamp=new Date(operation&&operation.lastAttemptAt||operation&&operation.createdAt||'').getTime();return operation&&operation.state==='pending'&&Number.isFinite(timestamp)&&Date.now()-timestamp>STALE_PENDING_AGE_MS;}
  function roleLabel(role){return role==='organization_owner'?'مالك المؤسسة':role==='organization_admin'?'مدير المؤسسة':'عضو';}
  function paint(restoreLookupFocus){var host=element('organization_members_content'),lookupInput=element('organization_member_lookup_email');restoreLookupFocus=restoreLookupFocus===true||!!(lookupInput&&global.document&&global.document.activeElement===lookupInput);if(host){host.innerHTML=body();if(restoreLookupFocus){lookupInput=element('organization_member_lookup_email');if(lookupInput&&typeof lookupInput.focus==='function')lookupInput.focus();}}}
  function body(){
    if(!context||!context.organizationId){
      if(state.organizationsStatus==='loading'||state.organizationsStatus==='idle')return '<div class="settings-empty-state organization-members-state organization-members-state-loading" role="status" aria-live="polite" aria-atomic="true">جارٍ تحميل المؤسسات…</div>';
      if(!state.organizations.length)return '<div class="settings-empty-state organization-members-state">لا توجد مؤسسة متاحة لهذا الحساب.</div>';
      return organizationSelector();
    }
    if(state.accessStatus==='loading'||state.accessStatus==='idle')return '<div class="settings-empty-state organization-members-state organization-members-state-loading" role="status" aria-live="polite" aria-atomic="true">جارٍ التحقق من الصلاحية…</div>';
    if(!state.access)return '<div class="settings-empty-state organization-members-state organization-members-state-error" role="status" aria-live="polite" aria-atomic="true">تعذر التحقق من صلاحية المؤسسة.</div>';
    var html=organizationSelector()+statusHtml()+'<div class="sync-settings-message organization-members-access-summary">صلاحيتك: <strong>'+escapeHtml(roleLabel(state.access.role))+'</strong></div>';
    if(canManage()){
      html+='<div class="sync-settings-actions"><button type="button" class="btn btn-gray btn-sm" onclick="OrganizationMembersUI.refresh()">تحديث القائمة</button></div>';
      html+=membersHtml()+managementHtml();
    }else html+='<div class="settings-empty-state organization-members-state organization-members-state-readonly">حسابك للقراءة فقط.</div>';
    html+=operationsHtml();if(state.message)html+='<div class="sync-settings-message organization-members-feedback" role="status" aria-live="polite" aria-atomic="true">'+escapeHtml(state.message)+'</div>';
    return html;
  }
  function organizationSelector(){
    var current=state.organizations.find(function(item){return context&&item.organizationId===context.organizationId;})||null;
    var html='<div class="sync-settings-panel organization-members-context-panel"><h3 class="organization-members-context-title">إدارة أعضاء المؤسسة</h3>'+(current?'<div class="sync-settings-message organization-members-current">المؤسسة المُدارة حاليًا: <strong>'+escapeHtml(current.displayName)+'</strong></div>':'')+'<label class="lbl" for="organization_select">المؤسسة</label><select id="organization_select" onchange="OrganizationMembersUI.selectOrganization(this.value)"><option value="">اختر مؤسسة</option>';
    state.organizations.forEach(function(organization){html+='<option value="'+escapeHtml(organization.organizationId)+'"'+(context&&context.organizationId===organization.organizationId?' selected':'')+'>'+escapeHtml(organization.displayName)+'</option>';});
    return html+='</select></div>';
  }
  function statusHtml(){var count=state.operations.filter(function(operation){return operation.organizationId===context.organizationId;}).length;
    return '<div class="sync-settings-panel organization-members-status-panel"><h3>حالة إدارة المؤسسة</h3><div class="sync-settings-message organization-members-status-copy">الدور: '+escapeHtml(roleLabel(state.access.role))+' · إدارة الأعضاء: '+(canManage()?'متاحة':'للقراءة فقط')+' · عمليات محلية معلقة: '+count+' · الاتصال: '+escapeHtml(state.connectionState)+(state.lastRefreshAt?' · آخر تحديث ناجح: '+escapeHtml(state.lastRefreshAt):'')+'</div></div>';}
  function actionLabel(action){return action==='add_organization_member'?'إضافة عضو':action==='remove_organization_member'?'إزالة عضو':'تغيير الدور';}
  function operationsHtml(){var operations=state.operations.filter(function(operation){return operation.organizationId===context.organizationId;});if(!operations.length)return '';
    var html='<div class="sync-settings-panel organization-members-operations"><h3>عمليات تحتاج متابعة</h3>';
    operations.forEach(function(operation){var stalePending=stalePendingOperation(operation);html+='<div class="sync-settings-message organization-members-operation" role="status" aria-live="polite" aria-atomic="true">'+escapeHtml(actionLabel(operation.action))+' — '+(operation.state==='unknown'?'النتيجة غير مؤكدة':stalePending?'هذه العملية لم تُحسم محليًا بعد. قد تكون اكتملت بالفعل. تحقّق من حالة الأعضاء قبل إعادة المحاولة.':'جارٍ التنفيذ');
      if(operation.state==='unknown')html+=' <button type="button" class="btn btn-blue btn-sm" onclick="OrganizationMembersUI.retryOperation(\''+escapeHtml(operation.operationId)+'\')">إعادة المحاولة</button><button type="button" class="btn btn-gray btn-sm" onclick="OrganizationMembersUI.stopTracking(\''+escapeHtml(operation.operationId)+'\')">إيقاف تتبع العملية على هذا الجهاز</button>';
      else if(stalePending)html+=' <button type="button" class="btn btn-blue btn-sm" onclick="OrganizationMembersUI.verifyPendingOperations()">تحديث والتحقق من الحالة</button>';
      html+='</div>';});return html+'</div>';
  }
  function membersHtml(){
    if(state.membersStatus==='loading')return '<div class="settings-empty-state organization-members-state organization-members-state-loading" role="status" aria-live="polite" aria-atomic="true">جارٍ تحميل الأعضاء…</div>';
    if(!state.members.length)return '<div class="settings-empty-state organization-members-state organization-members-empty">لا يوجد أعضاء في هذه المؤسسة.</div>';
    var html='<div class="settings-list">';state.members.forEach(function(member){
      var memberBusy=targetMutationPending(context.organizationId,member.userId);
      html+='<div class="settings-list-item organization-member-item"><div class="organization-member-identity"><strong>'+escapeHtml(member.displayName||'مستخدم بدون اسم')+'</strong><div class="sync-settings-message organization-member-role">'+escapeHtml(roleLabel(member.role))+(member.isCurrentUser?' — الحساب الحالي':'')+'</div></div>';
      if(state.access.canManageMembers&&!member.isCurrentUser&&(member.role==='member'||(state.access.canManageAdmins&&member.role==='organization_admin')))html+='<button type="button" class="btn btn-red btn-sm organization-member-action" '+(memberBusy?'disabled aria-busy="true" ':'')+'onclick="OrganizationMembersUI.removeMember(\''+escapeHtml(member.userId)+'\')">'+(memberBusy?'جارٍ التنفيذ…':'إزالة العضو')+'</button>';
      if(state.access.canManageAdmins&&!member.isCurrentUser&&member.role==='member')html+='<button type="button" class="btn btn-blue btn-sm organization-member-action" '+(memberBusy?'disabled aria-busy="true" ':'')+'onclick="OrganizationMembersUI.changeRole(\''+escapeHtml(member.userId)+'\',\'organization_admin\')">'+(memberBusy?'جارٍ التنفيذ…':'مدير المؤسسة')+'</button>';
      if(state.access.canManageAdmins&&!member.isCurrentUser&&member.role==='organization_admin')html+='<button type="button" class="btn btn-gray btn-sm organization-member-action" '+(memberBusy?'disabled aria-busy="true" ':'')+'onclick="OrganizationMembersUI.changeRole(\''+escapeHtml(member.userId)+'\',\'member\')">'+(memberBusy?'جارٍ التنفيذ…':'عضو')+'</button>';
      html+='</div>';
    });return html+'</div>';
  }
  function managementHtml(){
    var html='<div class="sync-settings-panel organization-members-add-panel"><h3>إدارة أعضاء المؤسسة</h3><label class="lbl" for="organization_member_lookup_email">البريد الإلكتروني</label><input id="organization_member_lookup_email" type="email" dir="ltr" autocomplete="off" value="'+escapeHtml(state.lookupEmail)+'"><div class="sync-settings-actions"><button type="button" class="btn btn-blue btn-sm" '+(state.lookupStatus==='loading'?'disabled aria-busy="true" ':'')+'onclick="OrganizationMembersUI.lookup()">بحث</button>';
    if(state.candidate){var add={organizationId:context.organizationId,targetUserId:state.candidate.targetUserId,action:'add_organization_member',requestedRole:null},busy=targetMutationPending(add.organizationId,add.targetUserId);html+='</div><div class="sync-settings-message organization-member-candidate"><strong>'+escapeHtml(state.candidate.displayName||'مستخدم بدون اسم')+'</strong><div dir="ltr">'+escapeHtml(state.lookupEmail)+'</div></div><div class="sync-settings-actions"><button type="button" class="btn btn-green btn-sm" '+(state.candidate.membershipStatus==='member'||busy?'disabled ':'')+(busy?'aria-busy="true" ':'')+'onclick="OrganizationMembersUI.addMember()">'+(busy?'جارٍ التنفيذ…':state.candidate.membershipStatus==='member'?'عضو بالفعل':'إضافة عضو')+'</button>';}
    html+='</div></div>';return html;
  }
  function renderSection(options){var next={organizationId:String(options&&options.organizationId||'')};if(!context||(next.organizationId&&next.organizationId!==context.organizationId)){context=next;state=createState();}return '<section class="settings-section sync-settings-section organization-members-section" aria-labelledby="organization_members_title"><h2 id="organization_members_title" class="settings-section-title">إدارة أعضاء المؤسسة</h2><div id="organization_members_content">'+body()+'</div></section>';}
  function initialize(options){
    if(initializationFlight)return initializationFlight;
    var requestedOrganizationId=String(options&&options.organizationId||'');
    var service=api();if(!service||typeof service.listMyOrganizations!=='function')return Promise.resolve({ok:false,status:'unavailable'});
    state.operations=[];state.access=null;state.members=[];state.organizationsStatus='loading';paint();initializationFlight=service.listMyOrganizations().then(function(result){
      state.organizationsStatus=result&&result.ok?'loaded':'error';state.organizations=result&&result.ok?result.data.organizations:[];
      if(state.organizations.length){
        var userId=authenticatedUserId(),requestedId=availableOrganizationId(requestedOrganizationId),currentId=contextUserId===userId?availableOrganizationId(context&&context.organizationId):'',storedSelection=readStoredSelection(),storedId=availableOrganizationId(storedSelection),organizationId=requestedId||currentId||storedId||state.organizations[0].organizationId,selectionChanged=!context||context.organizationId!==organizationId||contextUserId!==userId;
        context={organizationId:organizationId};
        contextUserId=userId;
        if(storedSelection&&!storedId)storeSelection('');
        if(selectionChanged){state.candidate=null;state.lookupEmail='';state.message='';state.lookupStatus='idle';}
        if(requestedId)storeSelection(requestedId);
        return loadOperations().then(function(){return refreshUi();});
      }
      contextUserId=authenticatedUserId();storeSelection('');paint();return result;
    }).finally(function(){initializationFlight=null;});return initializationFlight;
  }
  function initializeAndSelect(organizationId){organizationId=String(organizationId||'');return initialize({organizationId:organizationId}).then(function(result){
    if(!result||!result.ok)return result;
    var requestedId=availableOrganizationId(organizationId);
    return !requestedId||context&&context.organizationId===requestedId?result:selectOrganization(organizationId);
  });}
  function selectOrganization(organizationId){var previousOrganizationId=context&&context.organizationId||'';organizationId=availableOrganizationId(organizationId);var selectionChanged=previousOrganizationId!==organizationId;context={organizationId:organizationId};contextUserId=authenticatedUserId();storeSelection(organizationId);state.access=null;state.members=[];if(selectionChanged){state.candidate=null;state.lookupEmail='';state.message='';state.lookupStatus='idle';}return refreshUi();}
  function refreshUi(){
    if(!context||!context.organizationId)return Promise.resolve({ok:false,status:'invalid_input'});
    var organizationId=context.organizationId,service=api();if(!service)return Promise.resolve({ok:false,status:'unavailable'});
    state.accessStatus='loading';paint();return service.refresh({organizationId:organizationId}).then(function(result){
      if(!isCurrentOrganization(organizationId))return result;
      if(!result.ok){state.accessStatus='error';state.connectionState='تعذر الاتصال';state.message='تعذر تحديث بيانات المؤسسة.';paint();return result;}
      state.accessStatus='available';state.connectionState='متصل';state.lastRefreshAt=new Date().toLocaleString('ar');state.access=result.data.access;state.members=result.data.members||[];state.membersStatus='loaded';paint();return result;
    });
  }
  function loadOperations(){var service=api();if(!service||typeof service.listPendingOperations!=='function')return Promise.resolve({ok:false,status:'unavailable'});
    return service.listPendingOperations().then(function(result){state.operations=result&&result.ok?result.data.operations:[];return result;});}
  function verifyPendingOperations(){var organizationId=context&&context.organizationId||'';return refreshUi().then(function(result){return loadOperations().then(function(){if(isCurrentOrganization(organizationId))paint();return result;});});}
  function lookup(){
    if(!canManage())return Promise.resolve({ok:false,status:'access_denied'});
    var input=element('organization_member_lookup_email'),email=String(input&&input.value||'').trim(),organizationId=context&&context.organizationId||'';state.lookupEmail=email;
    if(!email||!validEmail(email)){state.lookupStatus='idle';state.candidate=null;state.message=!email?'أدخل البريد الإلكتروني.':'أدخل بريدًا إلكترونيًا صحيحًا.';paint(true);return Promise.resolve({ok:false,status:'invalid_input'});}
    state.lookupStatus='loading';state.candidate=null;state.message='';paint(true);return api().lookupCandidate({organizationId:organizationId,email:email}).then(function(result){
      if(!isCurrentOrganization(organizationId))return result;
      state.lookupStatus=result&&result.ok?'candidate':'unavailable';state.candidate=result&&result.ok?result.data:null;state.message=result&&result.ok?'تم العثور على مرشح.':'لا يتوفر مرشح بهذا البريد.';paint(true);return result;
    });
  }
  function run(input){
    var intentKey=key(input),organizationId=input.organizationId;if(flights[intentKey])return flights[intentKey];state.pending[intentKey]=true;if(isCurrentOrganization(organizationId))state.message='';paint();
    var method=input.action==='add_organization_member'?'addMember':input.action==='remove_organization_member'?'removeMember':'changeRole';
    var flight=api()[method](input).then(function(result){
      delete state.pending[intentKey];
      if(isCurrentOrganization(organizationId)){
        var refreshed=result&&result.data&&result.data.refresh;
        if(refreshed){state.access=refreshed.access;state.members=refreshed.members||[];state.membersStatus='loaded';}
        if(result.status==='unknown'){state.message='النتيجة غير مؤكدة وتتطلب متابعة صريحة.';}
        else if(result.status==='applied'){state.message='تم تنفيذ العملية وتحديث البيانات من الخادم.';}
        else if(result.status==='unchanged'){state.message='لم تتغير البيانات على الخادم.';}
        else if(result.status==='denied'){state.message='رُفضت العملية من الخادم.';}
        else if(result.status==='invalid_request'){state.message='تعذر تنفيذ الطلب لعدم صلاحيته.';}
        else if(result.status==='operation_mismatch'){if(input.action!=='add_organization_member')state.candidate=null;state.manualRetry=true;state.message='تطابق العملية غير صالح. حدّد المرشح وأنشئ طلبًا جديدًا.';}
        else if(result.status==='terminal_refresh_failed'){state.message='تعذر تحديث بيانات الخادم؛ تم الاحتفاظ بتتبع العملية.';}
        else if(refreshed){state.message=result.ok?'تم تأكيد العملية من الخادم.':'تم تحديث البيانات من الخادم.';}
        else{state.message='تعذر تنفيذ العملية.';}
        if(input.action==='add_organization_member'&&result&&result.ok&&(result.status==='applied'||result.status==='unchanged')){state.candidate=null;state.lookupEmail='';}
      }
      return loadOperations().then(function(){paint();return result;});
    }).finally(function(){delete flights[intentKey];});flights[intentKey]=flight;return flight;
  }
  function addMember(){if(!state.candidate)return Promise.resolve({ok:false,status:'invalid_input'});return run({organizationId:context.organizationId,targetUserId:state.candidate.targetUserId,action:'add_organization_member',requestedRole:null});}
  function removeMember(targetUserId){
    targetUserId=String(targetUserId||'');var organizationId=context&&context.organizationId||'',member=state.members.find(function(item){return item.userId===targetUserId;}),organization=state.organizations.find(function(item){return item.organizationId===organizationId;}),input={organizationId:organizationId,targetUserId:targetUserId,action:'remove_organization_member',requestedRole:null};
    if(!member||!organization||!canManage()||member.isCurrentUser||!(member.role==='member'||(member.role==='organization_admin'&&state.access.canManageAdmins)))return Promise.resolve({ok:false,status:'invalid_input'});
    if(targetMutationPending(organizationId,targetUserId))return flights[key(input)]||Promise.resolve({ok:false,status:'unavailable'});
    var warning='هل تريد إزالة «'+String(member.displayName||'مستخدم بدون اسم')+'» من مؤسسة «'+String(organization.displayName||'')+'»؟ ستتم إزالة عضويته من هذه المؤسسة.';
    if(!global.confirm||!global.confirm(warning))return Promise.resolve({ok:false,status:'cancelled'});
    return run(input);
  }
  function changeRole(targetUserId,requestedRole){return run({organizationId:context.organizationId,targetUserId:String(targetUserId||''),action:'change_organization_role',requestedRole:String(requestedRole||'')});}
  function retryOperation(operationId){var organizationId=context&&context.organizationId||'';return api().retryUnknownOperation(String(operationId||'')).then(function(result){return loadOperations().then(function(){if(isCurrentOrganization(organizationId)){var messages={unknown:'النتيجة غير مؤكدة وتتطلب متابعة صريحة.',applied:'تم تنفيذ العملية وتحديث البيانات من الخادم.',unchanged:'لم تتغير البيانات على الخادم.',denied:'رُفضت العملية من الخادم.',invalid_request:'تعذر تنفيذ الطلب لعدم صلاحيته.',operation_mismatch:'تطابق العملية غير صالح؛ يلزم طلب جديد.',terminal_refresh_failed:'تعذر تحديث بيانات الخادم؛ تم الاحتفاظ بتتبع العملية.'};if(result&&result.data&&result.data.refresh){state.access=result.data.refresh.access;state.members=result.data.refresh.members||[];state.lastRefreshAt=new Date().toLocaleString('ar');}state.message=messages[result&&result.status]||'تعذر إعادة المحاولة.';}paint();return result;});});}
  function stopTracking(operationId){var warning='قد تكون العملية اكتملت بالفعل على الخادم. هذا الإجراء يزيل التتبع المحلي على هذا الجهاز فقط ولا يلغي أو يتراجع عن بيانات الخادم.';
    if(!global.confirm||!global.confirm(warning))return Promise.resolve({ok:false,status:'abandonment_cancelled'});
    var organizationId=context&&context.organizationId||'';return api().abandonUnknownOperation(String(operationId||'')).then(function(result){return loadOperations().then(function(){if(isCurrentOrganization(organizationId)){if(result&&result.data&&result.data.refresh){state.access=result.data.refresh.access;state.members=result.data.refresh.members||[];state.lastRefreshAt=new Date().toLocaleString('ar');}state.message=result&&result.ok?'تم إيقاف تتبع العملية على هذا الجهاز.':result&&result.status==='refresh_failed'?'تعذر تحديث بيانات الخادم؛ تم الاحتفاظ بتتبع العملية.':'تعذر إيقاف تتبع العملية.';}paint();return result;});});}
  global.OrganizationMembersUI=Object.freeze({renderSection:renderSection,initialize:initialize,initializeAndSelect:initializeAndSelect,selectOrganization:selectOrganization,refresh:refreshUi,verifyPendingOperations:verifyPendingOperations,lookup:lookup,addMember:addMember,removeMember:removeMember,changeRole:changeRole,retryOperation:retryOperation,stopTracking:stopTracking});
})(window);
