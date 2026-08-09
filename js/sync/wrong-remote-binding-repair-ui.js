(function(global){
  'use strict';

  var state=createState();
  var requestId=0;

  function createState(){
    return {
      busy:false,
      ownerConferences:[],
      selectedConferenceToken:'',
      organizationMembers:[],
      selectedMemberToken:'',
      managerAdded:false,
      message:'',
      messageKind:'info'
    };
  }

  function escapeHtml(value){
    return String(value==null?'':value)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function element(id){
    return global.document&&typeof global.document.getElementById==='function'
      ?global.document.getElementById(id):null;
  }

  function currentConference(){
    return typeof global.getCurrentConference==='function'
      ?global.getCurrentConference():null;
  }

  function currentLink(){
    var conference=currentConference();
    var links=global.ConferenceLinkStore;
    return conference&&links&&typeof links.get==='function'
      ?links.get(conference.id):null;
  }

  function service(){
    return global.WrongRemoteBindingRepairService||null;
  }

  function setMessage(text,kind){
    state.message=String(text||'');
    state.messageKind=kind||'info';
  }

  function rerender(){
    if(typeof global.renderSettings==='function')global.renderSettings();
  }

  function statusMessage(status){
    var messages={
      conference_list_unavailable:'تعذر تحميل المؤتمرات المتاحة.',
      target_conference_organization_unavailable:'تعذر تحديد مؤسسة المؤتمر المختار.',
      organization_admin_access_required:'يلزم امتلاك صلاحية إدارة أعضاء المؤسسة.',
      organization_members_unavailable:'تعذر تحميل أعضاء المؤسسة.',
      blocked_ambiguous_member:'تعذر المتابعة لأن أسماء بعض الأعضاء متطابقة.',
      blocked_indistinguishable_conferences:'تعذر المتابعة لأن مؤتمرين مختلفين لهما نفس الاسم والمراجعة وأعداد البيانات.',
      blocked_owner_selection:'اختر العضو المطلوب أولًا.',
      membership_verification_failed:'تعذر التحقق من إضافة العضو كمدير.',
      target_unavailable:'اختر المؤتمر الصحيح أولًا.',
      old_link_unavailable:'لا يوجد ارتباط حالي يمكن إصلاحه.',
      backup_failed:'تعذر إنشاء نسخة الرجوع؛ لم يتم تغيير أي بيانات.',
      rolled_back:'فشل الإصلاح وتمت استعادة الحالة السابقة.',
      repaired:'تم إصلاح الارتباط والتحقق من البيانات بنجاح.'
    };
    return messages[status]||'تعذر إكمال العملية بأمان.';
  }

  function run(task){
    if(state.busy)return Promise.resolve(null);
    state.busy=true;
    setMessage('', 'info');
    rerender();
    var active=++requestId;
    return Promise.resolve().then(task).catch(function(){
      return {ok:false,status:'unexpected_error'};
    }).then(function(result){
      if(active!==requestId)return result;
      state.busy=false;
      return result;
    });
  }

  function loadOwnerConferences(){
    var api=service();
    if(!api||typeof api.listOwnerConferences!=='function'){
      setMessage('خدمة إصلاح الارتباط غير متاحة.', 'error');
      rerender();
      return Promise.resolve(null);
    }
    return run(function(){return api.listOwnerConferences();}).then(function(result){
      if(!result)return result;
      state.ownerConferences=result.ok&&result.data
        ?result.data.conferences||[]:[];
      state.selectedConferenceToken='';
      state.organizationMembers=[];
      state.selectedMemberToken='';
      state.managerAdded=false;
      setMessage(result.ok?'اختر المؤتمر الصحيح.':statusMessage(result.status),
        result.ok?'info':'error');
      rerender();
      return result;
    });
  }

  function selectOwnerConference(token){
    token=String(token||'');
    var exists=state.ownerConferences.some(function(item){
      return item&&item.token===token;
    });
    if(!exists)return Promise.resolve(null);
    state.selectedConferenceToken=token;
    state.organizationMembers=[];
    state.selectedMemberToken='';
    state.managerAdded=false;
    var api=service();
    return run(function(){return api.listOrganizationMembers(token);})
      .then(function(result){
        if(!result)return result;
        state.organizationMembers=result.ok&&result.data
          ?result.data.members||[]:[];
        setMessage(result.ok?'اختر حساب العضو المطلوب.':statusMessage(result.status),
          result.ok?'info':'error');
        rerender();
        return result;
      });
  }

  function selectMember(token){
    token=String(token||'');
    state.selectedMemberToken=state.organizationMembers.some(function(item){
      return item&&item.token===token;
    })?token:'';
    state.managerAdded=false;
    setMessage('', 'info');
    rerender();
  }

  function addSelectedManager(){
    if(!state.selectedMemberToken){
      setMessage(statusMessage('blocked_owner_selection'), 'error');
      rerender();
      return Promise.resolve(null);
    }
    var api=service();
    return run(function(){
      return api.addSelectedManager(state.selectedMemberToken);
    }).then(function(result){
      if(!result)return result;
      state.managerAdded=!!result.ok;
      setMessage(result.ok?'تمت إضافة العضو كمدير. يمكن الآن تنفيذ الإصلاح.':
        statusMessage(result.status),result.ok?'success':'error');
      rerender();
      return result;
    });
  }

  function repair(){
    var conference=currentConference();
    if(!conference||!state.selectedConferenceToken||!state.managerAdded)return null;
    var confirmation=element('wrong_binding_repair_confirmation');
    if(String(confirmation&&confirmation.value||'').trim()!=='إصلاح'){
      setMessage('اكتب كلمة إصلاح لتأكيد استبدال بيانات المؤتمر المحلي.', 'error');
      rerender();
      return null;
    }
    if(global.confirm&&!global.confirm(
      'سيتم استبدال بيانات المؤتمر المحلي بنسخة المؤتمر الصحيح. هل تريد المتابعة؟'
    ))return null;
    var api=service();
    return run(function(){
      return api.repairMemberLink(conference.id,state.selectedConferenceToken);
    }).then(function(result){
      if(!result)return result;
      setMessage(statusMessage(result.status),result.ok?'success':'error');
      if(result.ok){
        state.ownerConferences=[];
        state.organizationMembers=[];
        state.selectedConferenceToken='';
        state.selectedMemberToken='';
        state.managerAdded=false;
      }
      rerender();
      return result;
    });
  }

  function renderOptions(items,selected,label){
    var html='<option value="">'+escapeHtml(label)+'</option>';
    items.forEach(function(item){
      html+='<option value="'+escapeHtml(item.token)+'"'+
        (item.token===selected?' selected':'')+'>'+escapeHtml(item.label||
          item.name||item.displayName||'')+'</option>';
    });
    return html;
  }

  function render(){
    if(!global.DiagnosticsPrivacyPolicy||
      !global.DiagnosticsPrivacyPolicy.canExportRescue())return '';
    var conference=currentConference();
    var link=currentLink();
    if(!conference||!link)return '';
    var html='<div class="sync-settings-panel wrong-binding-repair-panel">';
    html+='<h3>إصلاح ارتباط مؤتمر خاطئ</h3>';
    html+='<div class="sync-settings-message">استخدم هذه الأداة فقط عند ارتباط هذا المؤتمر بنسخة بعيدة خاطئة.</div>';
    html+='<div class="sync-settings-actions"><button type="button" class="btn btn-gray btn-sm" '+
      (state.busy?'disabled ':'')+
      'onclick="WrongRemoteBindingRepairUI.loadOwnerConferences()">تحميل المؤتمرات المملوكة</button></div>';
    if(state.ownerConferences.length){
      html+='<label class="lbl" for="wrong_binding_target_conference">المؤتمر الصحيح</label>';
      html+='<select id="wrong_binding_target_conference" '+(state.busy?'disabled ':'')+
        'onchange="WrongRemoteBindingRepairUI.selectOwnerConference(this.value)">'+
        renderOptions(state.ownerConferences,state.selectedConferenceToken,'اختر المؤتمر')+'</select>';
    }
    if(state.organizationMembers.length){
      html+='<label class="lbl" for="wrong_binding_target_member">حساب العضو</label>';
      html+='<select id="wrong_binding_target_member" '+(state.busy?'disabled ':'')+
        'onchange="WrongRemoteBindingRepairUI.selectMember(this.value)">'+
        renderOptions(state.organizationMembers,state.selectedMemberToken,'اختر العضو')+'</select>';
      html+='<div class="sync-settings-actions"><button type="button" class="btn btn-blue btn-sm" '+
        (state.busy||!state.selectedMemberToken?'disabled ':'')+
        'onclick="WrongRemoteBindingRepairUI.addSelectedManager()">إضافة العضو كمدير</button></div>';
    }
    if(state.managerAdded){
      html+='<label class="lbl" for="wrong_binding_repair_confirmation">اكتب إصلاح للتأكيد</label>';
      html+='<input id="wrong_binding_repair_confirmation" type="text" autocomplete="off">';
      html+='<div class="sync-settings-actions"><button type="button" class="btn btn-red btn-sm" '+
        (state.busy?'disabled ':'')+
        'onclick="WrongRemoteBindingRepairUI.repair()">تنفيذ إصلاح الارتباط</button></div>';
    }
    if(state.message){
      html+='<div class="sync-settings-message'+
        (state.messageKind==='error'?' sync-settings-error':
          state.messageKind==='success'?' sync-settings-success':'')+'">'+
        escapeHtml(state.message)+'</div>';
    }
    return html+'</div>';
  }

  var api=Object.freeze({
    render:render,
    loadOwnerConferences:loadOwnerConferences,
    selectOwnerConference:selectOwnerConference,
    selectMember:selectMember,
    addSelectedManager:addSelectedManager,
    repair:repair,
    getState:function(){return JSON.parse(JSON.stringify(state));},
    reset:function(){requestId++;state=createState();}
  });
  global.WrongRemoteBindingRepairUI=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
