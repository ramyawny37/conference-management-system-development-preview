(function(global){
  'use strict';
  var state={status:'idle',houseCount:0,conferenceCount:0,
    organizations:[],selectedOrganizationIds:[],running:false};

  function el(id){return global.document&&global.document.getElementById(id);}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,
    function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;',
      '"':'&quot;',"'":'&#39;'}[character];});}
  function render(){
    var modal=el('legacyTemplateAdoptionModal');
    if(!modal)return;
    var sync=global.OrganizationTemplateSync;
    var eligible=(state.organizations||[]).filter(function(item){
      return sync&&typeof sync.canAdoptLegacyTemplates==='function'&&
        sync.canAdoptLegacyTemplates([String(item.organizationId)]);
    });
    var required=['adoption_required','adoption_started','adoption_partial']
      .indexOf(state.status)>=0&&eligible.length>0;
    if(!required){modal.style.display='none';return;}
    el('legacy_template_house_count').textContent=String(state.houseCount||0);
    el('legacy_template_conference_count').textContent=
      String(state.conferenceCount||0);
    var select=el('legacy_template_organizations');
    select.innerHTML=eligible.map(function(item){
      var id=String(item.organizationId),checked=
        (state.selectedOrganizationIds||[]).indexOf(id)>=0?' checked':'';
      return '<label style="display:block;padding:7px"><input type="checkbox" value="'+esc(id)+'"'+checked+' onchange="LegacyTemplateAdoptionUI.toggleOrganization(this.value,this.checked)"> '+esc(item.displayName||id)+(item.role?' — '+esc(item.role):'')+'</label>';
    }).join('');
    var action=el('legacy_template_adopt_action');
    action.disabled=!!state.running||!(state.selectedOrganizationIds||[]).length;
    action.textContent=state.running?'جارٍ نقل القوالب...':
      'نقل القوالب إلى المؤسسة المحددة';
    var message=el('legacy_template_adoption_message');
    message.textContent=state.status==='adoption_partial'
      ?'لم يكتمل رفع جميع القوالب. يمكن إعادة المحاولة بأمان.':'';
    modal.style.display='flex';
  }
  function update(next){state=Object.assign({},state,next||{});render();}
  function toggleOrganization(value,checked){value=String(value||'');var ids=(state.selectedOrganizationIds||[]).slice();if(checked&&ids.indexOf(value)<0)ids.push(value);if(!checked)ids=ids.filter(function(id){return id!==value;});state.selectedOrganizationIds=ids;render();}
  function close(){if(state.running)return;var modal=el('legacyTemplateAdoptionModal');if(modal)modal.style.display='none';}
  function adopt(){
    var sync=global.OrganizationTemplateSync;
    if(state.running||!(state.selectedOrganizationIds||[]).length||!sync||
      typeof sync.adoptLegacyTemplates!=='function')return Promise.resolve(false);
    if(typeof sync.canAdoptLegacyTemplates!=='function'||
      !sync.canAdoptLegacyTemplates(state.selectedOrganizationIds)){
      var denied='ليس لديك صلاحية لإتاحة القوالب لهذه المؤسسة.';
      var message=el('legacy_template_adoption_message');
      if(message)message.textContent=denied;
      if(typeof global.showToast==='function')global.showToast(denied,'#E74C3C');
      return Promise.resolve({ok:false,status:'not_authorized'});
    }
    state.running=true;render();
    return Promise.resolve(sync.adoptLegacyTemplates(state.selectedOrganizationIds))
      .then(function(response){
        state.running=false;
        if(response&&response.ok){
          if(typeof global.renderSettings==='function')global.renderSettings();
          close();
        }else{
          state.status='adoption_partial';
          render();
        }
      }).catch(function(){state.running=false;state.status='adoption_partial';render();});
  }
  global.LegacyTemplateAdoptionUI=Object.freeze({update:update,
    toggleOrganization:toggleOrganization,close:close,adopt:adopt});
  if(global.OrganizationTemplateSync&&
    typeof global.OrganizationTemplateSync.getAdoptionState==='function'){
    update(global.OrganizationTemplateSync.getAdoptionState());
  }
})(window);
