(function(global){
  'use strict';
  var state={conferenceId:'',status:'idle',conferenceName:'',organizations:[],selectedOrganizationId:'',message:'',errorCode:'',busy:false};
  function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function short(value){return String(value||'').slice(0,8);}
  function repaint(){if(global.renderSettings)global.renderSettings();}
  function resetForConference(id){if(state.conferenceId===id)return;state={conferenceId:id,status:'idle',conferenceName:'',organizations:[],selectedOrganizationId:'',message:'',errorCode:'',busy:false};}
  function renderSection(input){
    input=input||{};var conferenceId=String(input.remoteConferenceId||'');
    if(!conferenceId)return '';
    resetForConference(conferenceId);
    var html='<section class="settings-section sync-settings-section"><div class="settings-section-title">ربط المؤتمر القديم بمؤسسة</div>';
    if(state.status==='idle')return html+'<p>تحقق أولًا من أهلية المؤسسات قبل تنفيذ الربط الصريح.</p><button type="button" class="btn btn-gray btn-sm" onclick="LegacyConferenceOrganizationAssignmentUI.refreshEligibility()">فحص أهلية الربط</button></section>';
    if(state.status==='loading')return html+'<p>جارٍ التحقق من حالة المؤتمر والمؤسسات...</p></section>';
    if(state.status==='already_assigned')return '';
    if(state.status==='error')return html+'<div class="sync-settings-message sync-settings-error">'+esc(state.message)+(state.errorCode?' <span dir="ltr">['+esc(state.errorCode)+']</span>':'')+'</div><button type="button" class="btn btn-gray btn-sm" onclick="LegacyConferenceOrganizationAssignmentUI.refreshEligibility()">إعادة الفحص</button></section>';
    if(state.status==='assigned')return html+'<div class="sync-settings-message">تم ربط المؤتمر بالمؤسسة صراحةً.</div></section>';
    var options='<option value="">اختر المؤسسة صراحةً</option>'+state.organizations.map(function(item){return '<option value="'+esc(item.organizationId)+'"'+(item.organizationId===state.selectedOrganizationId?' selected':'')+'>'+esc(item.displayName)+' ('+esc(short(item.organizationId))+'…)</option>';}).join('');
    html+='<div class="sync-settings-message sync-settings-error">تحذير: هذا الربط أحادي الاتجاه ولا يغيّر أدوار الأعضاء أو بيانات المؤتمر. راجع اسم المؤسسة قبل المتابعة.</div>';
    html+='<label class="lbl" for="legacy_conference_organization_select">المؤسسة</label><select id="legacy_conference_organization_select" onchange="LegacyConferenceOrganizationAssignmentUI.selectOrganization(this.value)">'+options+'</select>';
    html+='<button type="button" class="btn btn-orange btn-sm" '+(state.busy||!state.selectedOrganizationId?'disabled ':'')+'onclick="LegacyConferenceOrganizationAssignmentUI.assignSelected()">ربط المؤتمر بالمؤسسة المختارة</button>';
    if(state.message)html+='<div class="sync-settings-message'+(state.errorCode?' sync-settings-error':'')+'">'+esc(state.message)+(state.errorCode?' <span dir="ltr">['+esc(state.errorCode)+']</span>':'')+'</div>';
    return html+'</section>';
  }
  function currentRemoteId(){var conference=global.getCurrentConference&&global.getCurrentConference(),link=conference&&global.ConferenceLinkStore&&global.ConferenceLinkStore.get(conference.id);return link&&String(link.remoteConferenceId||'');}
  function refreshEligibility(){
    var conferenceId=currentRemoteId(),service=global.LegacyConferenceOrganizationAssignmentService;
    if(!conferenceId||!service||state.busy)return Promise.resolve({ok:false,status:'unavailable'});
    resetForConference(conferenceId);state.status='loading';state.message='';state.errorCode='';repaint();
    return service.preflight({conferenceId:conferenceId}).then(function(result){
      if(result.ok&&result.status==='already_assigned'){state.status='already_assigned';state.organizations=[];}
      else if(result.ok&&result.status==='legacy'){state.status='ready';state.conferenceName=String(result.data.conferenceName||'');state.organizations=result.data.eligibleOrganizations||[];state.selectedOrganizationId='';if(!state.organizations.length)state.message='لا توجد مؤسسة مؤهلة للربط.';}
      else{state.status='error';state.message='تعذر التحقق من أهلية الربط.';state.errorCode=String(result.error&&result.error.code||result.status||'PREFLIGHT_FAILED');}
      repaint();return result;
    });
  }
  function selectOrganization(id){id=String(id||'');state.selectedOrganizationId=state.organizations.some(function(item){return item.organizationId===id;})?id:'';state.message='';state.errorCode='';repaint();return !!state.selectedOrganizationId;}
  function assignSelected(){
    var organization=state.organizations.find(function(item){return item.organizationId===state.selectedOrganizationId;}),service=global.LegacyConferenceOrganizationAssignmentService;
    if(!organization||!service||state.busy)return Promise.resolve({ok:false,status:'organization_not_selected'});
    var warning='سيتم ربط المؤتمر «'+state.conferenceName+'» بالمؤسسة «'+organization.displayName+'» ربطًا صريحًا لمرة واحدة. لن تتغير أدوار الأعضاء أو بيانات المؤتمر. هل تريد المتابعة؟';
    if(!global.confirm||!global.confirm(warning))return Promise.resolve({ok:false,status:'cancelled'});
    state.busy=true;state.message='جارٍ تنفيذ الربط الصريح...';state.errorCode='';repaint();
    return service.assign({conferenceId:state.conferenceId,organizationId:organization.organizationId}).then(function(result){
      state.busy=false;if(result.ok){state.status='assigned';state.message='تم ربط المؤتمر بالمؤسسة صراحةً.';state.errorCode='';}
      else{state.status='ready';state.message=String(result.error&&result.error.message||'تعذر ربط المؤتمر بالمؤسسة.');state.errorCode=String(result.error&&result.error.code||result.status||'ASSIGNMENT_FAILED');}
      repaint();return result;
    });
  }
  function getState(){return JSON.parse(JSON.stringify(state));}
  function resetForTests(){state={conferenceId:'',status:'idle',conferenceName:'',organizations:[],selectedOrganizationId:'',message:'',errorCode:'',busy:false};}
  global.LegacyConferenceOrganizationAssignmentUI=Object.freeze({renderSection:renderSection,refreshEligibility:refreshEligibility,selectOrganization:selectOrganization,assignSelected:assignSelected,getState:getState,resetForTests:resetForTests});
})(window);
