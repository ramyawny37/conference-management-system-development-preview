// ═══════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════
function normalizeAppData(){
  // Wrapper function
  normalizeAppData_core();
  // UI Updates
  updateLogoText();
  refreshPeopleDatalist();
}

function addActivityLog(action,title,options){
  var conference=getCurrentConference();
  if(!conference)return null;
  options=options||{};
  if(options.section==='accommodation'&&!requireAccommodationMutation())return null;
  conference.activityLog=Array.isArray(conference.activityLog)?conference.activityLog:[];
  var entry={
    id:uid(),
    action:action||'unknown',
    title:title||'عملية غير محددة',
    details:options.details||'',
    section:options.section||'general',
    entityType:options.entityType||'',
    entityId:options.entityId||'',
    createdAt:new Date().toISOString()
  };
  conference.activityLog.unshift(entry);
  if(conference.activityLog.length>1000)conference.activityLog.length=1000;
  if(!save())return null;
  if(ge('activityLogList'))renderActivityLog();
  return entry;
}

// ═══════════════════════════════════════════════════════
// NEW DATA ACCESS HELPERS (v2.1)
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// NEW DATA ACCESS HELPERS (v3.0)
// ═══════════════════════════════════════════════════════

function openHouseModal(id){
  editHouseId = id;
  if(id){
    var current = getCurrentConference();
    var h = null;
    var houses = current.houses || [];
    for (var i = 0; i < houses.length; i++) {
      if (houses[i].id === id) {
        h = houses[i];
        break;
      }
    }
    if (!h) {
      closeHouseModal();
      showToast('❌ لم يتم العثور على البيت', '#E74C3C');
      return;
    }
    ge('houseTitle').textContent = '✏️ تعديل البيت';
    ge('house_name').value = h.name;
    ge('house_desc').value = h.description || '';
    ge('delHouseBtn').style.display = 'block';
  } else {
    ge('houseTitle').textContent = '➕ بيت جديد';
    ge('house_name').value = '';
    ge('house_desc').value = '';
    ge('delHouseBtn').style.display = 'none';
  }
  ge('houseModal').style.display = 'flex';
}
function closeHouseModal(){ge('houseModal').style.display='none';}
function saveHouse() {
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveHouse',editHouseId?'update':'create'))return false;
  if(!requireAccommodationMutation())return false;
  var current = getCurrentConference();
  if(!current) return;

  var name = ge('house_name').value.trim();
  if(!name){
    alert('أدخل اسم البيت');
    return;
  }

  var desc = ge('house_desc').value.trim();

  var result = saveHouseData(current, editHouseId, {
    name: name,
    description: desc
  });

  if(!result.ok){
    return;
  }

  if(!save())return false;
  closeHouseModal();
  if(result.action === 'updated'){
    showToast('✅ تم تعديل البيت');
  } else if(result.action === 'added'){
    showToast('✅ أُضيف البيت');
  }
  renderTab(currentTab);
  renderSettings();
  return true;
}
function deleteHouse(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deleteHouse',null))return false;
  if(!requireAccommodationMutation())return false;
  var current = getCurrentConference(); if(!current) return;
  if(!editHouseId) return;
  var houseToDelete = null;
  var houses = current.houses || [];
  for (var i = 0; i < houses.length; i++) {
    if (houses[i].id === editHouseId) {
      houseToDelete = houses[i];
      break;
    }
  }
  if(!houseToDelete) return;
  var preflight = getConferenceHousePreflight(houseToDelete);
  var deleteMessage = preflight.occupantCount
    ? 'حذف البيت "' + (houseToDelete.name || 'بيت غير مسمى') + '"؟ يحتوي على ' + preflight.floorCount + ' دور و' + preflight.roomCount + ' غرفة و' + preflight.occupantCount + ' نزيل. سيتم حذف بيانات التسكين نهائيًا.'
    : 'حذف البيت "' + (houseToDelete.name || 'بيت غير مسمى') + '"؟ يحتوي على ' + preflight.floorCount + ' دور و' + preflight.roomCount + ' غرفة.';
  if(!confirm(deleteMessage)) return;
  
  var newHouses = [];
  for (var i = 0; i < houses.length; i++) {
    if (houses[i].id !== editHouseId) {
      newHouses.push(houses[i]);
    }
  }
  current.houses = newHouses;
  var removedRoomIds = {};
  preflight.roomIds.forEach(function(roomId) { removedRoomIds[roomId] = true; });
  current.accommodationDisplayedRoomIds = (current.accommodationDisplayedRoomIds || []).filter(function(roomId) {
    return !removedRoomIds[roomId];
  });

  if(!save())return false;
  closeHouseModal();
  renderAccommodation();
  renderSettings();
  return true;
}
function setCurrentConference(confObj){
  if(!confObj) return;
  normalizeConference(confObj);
  var conf = confObj.conf || {name:'المؤتمر',startDate:'',endDate:'',days:1};
  updateLogoText();
  DAYS = conf.days || 1;
}
function saveTemplate(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveTemplate',null))return false;
  var name = prompt('أدخل اسم القالب:','قالب '+new Date().toISOString().slice(0,10));
  if(!name) return;
  updateCurrentConferenceData();
  var conferenceTemplate={id:uid(),name:name,createdAt:new Date().toISOString(),data:deepClone(getCurrentConference())};
  if(window.OrganizationTemplateSync&&typeof window.OrganizationTemplateSync.scopeTemplate==='function'){
    window.OrganizationTemplateSync.scopeTemplate(conferenceTemplate);
  }
  appData.templates.push(conferenceTemplate);
  if(!saveTemplateOnly())return false;
  renderSettings();
  showToast('✅ تم حفظ القالب');
  return true;
}
function restoreBackup(id){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('restoreBackup',null))return false;
  var backup = null;
  var backups = appData.backups || [];
  for (var i = 0; i < backups.length; i++) {
    if (backups[i].id === id) {
      backup = backups[i];
      break;
    }
  }
  if(!backup) return;
  if(!confirm('استعادة النسخة الاحتياطية ستستبدل البيانات الحالية. متابعة؟')) return;
  appData = deepClone(backup.data);
  normalizeAppData();
  var restoredCandidate=String(appData.currentConferenceId||'');
  var restoredAuthorization=window.ConferenceActivationAuthorization;
  if(restoredAuthorization){
    restoredAuthorization.capturePersistedCandidate(restoredCandidate,'backup');
    restoredAuthorization.deactivate(restoredCandidate,
      'unverified_legacy_unscoped','backup_authorization_unverified');
  }
  appData.currentConferenceId=null;
  if(!save())return false;
  renderSettings();
  showSelectConferenceModal();
  showToast('✅ تم استعادة النسخة الاحتياطية');
  return true;
}
function restoreArchive(id){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('restoreArchive',null))return false;
  var archive = null;
  var archives = appData.archives || [];
  for (var i = 0; i < archives.length; i++) {
    if (archives[i].id === id) {
      archive = archives[i];
      break;
    }
  }
  if(!archive) return;
  if(!confirm('استعادة الأرشيف ستنشئ نسخة جديدة من المؤتمر. متابعة؟')) return;
  var restored = deepClone(archive.data);
  restored.id = uid();
  restored.name = restored.name + ' (مستعاد)';
  restored.createdAt = new Date().toISOString();
  restored.updatedAt = restored.createdAt;
  appData.conferences.push(restored);
  normalizeConference(restored);
  if(window.ConferenceActivationAuthorization){
    window.ConferenceActivationAuthorization.capturePersistedCandidate(
      restored.id,'archive');
    window.ConferenceActivationAuthorization.deactivate(restored.id,
      'unverified_legacy_unscoped','archive_authorization_unverified');
  }
  appData.currentConferenceId = null;
  if(!save())return false;
  renderSettings();
  showSelectConferenceModal();
  showToast('✅ تم استعادة مؤتمر من الأرشيف');
  return true;
}
function setCurrentConferenceById(id, options){
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  var activationAuthorization=window.ConferenceActivationAuthorization;
  if(activationAuthorization&&
    !activationAuthorization.canDisplay(String(id||''))){
    activationAuthorization.authorizeLocalOnly(appData,String(id||''));
  }
  if(!activationAuthorization||
    !activationAuthorization.canDisplay(String(id||'')))return false;
  options = options || {};
  if(window.ConferenceEditLockManager&&
    window.ConferenceEditLockManager.getState&&
    ['editing','acquiring','lost'].indexOf(
      window.ConferenceEditLockManager.getState().status)>=0){
    window.ConferenceEditLockManager.endAccommodationEdit();
  }
  var next = null;
  var conferences = appData.conferences || [];
  for (var i = 0; i < conferences.length; i++) {
    if (conferences[i].id === id) {
      if(typeof isConferenceImportRecoveryPending==='function'&&
        isConferenceImportRecoveryPending(appData,id))return;
      next = conferences[i];
      break;
    }
  }
  if(!next) return;

  currentConferenceRuntimeAccessRole=
    Object.prototype.hasOwnProperty.call(currentConferenceRuntimeAccessRoles,id)
      ?currentConferenceRuntimeAccessRoles[id]:null;
  appData.currentConferenceId = next.id;
  if(window.AutomaticSyncOrchestrator&&
    typeof window.AutomaticSyncOrchestrator.schedule==='function'){
    window.AutomaticSyncOrchestrator.schedule('conference_changed');
  }
  setCurrentConference(next);
  if(!saveCurrentConferenceSelection())return false;
  syncCurrentConferenceRefs();

  var currentAfterSync = getCurrentConference();
  if(!currentAfterSync || currentAfterSync.id !== id){
    console.warn("Conference switch lost. currentConferenceId was reset after save/sync.");
    return;
  }

  var applicationBody = ge('applicationBody');
  var wasStartup = applicationBody && applicationBody.style.display === 'none';
  setApplicationMode('application');
  refreshPeopleDatalist();
  renderAccommodation();
  renderTransports();
  renderSettings();
  if (wasStartup) restoreLastApplicationTab();
  else if (!switchTab(currentTab)) switchTab(0);
  if(!options.skipToast) showToast('✅ تم تبديل المؤتمر');
  return true;
}

function completeCurrentConference(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('completeCurrentConference',null))return false;
  var conference = getCurrentConference();
  if(!conference) return;
  conference.status = 'completed';
  conference.completedAt = new Date().toISOString();
  appData.currentConferenceId = null;
  if(!save())return false;
  showSelectConferenceModal();
  return true;
}

function deleteCurrentConference(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deleteCurrentConference',null))return false;
  updateCurrentConferenceData();
  var current = getCurrentConference();
  if(!current) return;
  var displayName = current.name || ((current.conf || {}).name) || 'المؤتمر';
  if(!confirm('هل أنت متأكد من حذف المؤتمر "'+displayName+'"؟ سيتم حذف جميع بياناته المرتبطة نهائيًا.')) return;

  var conferences = appData.conferences || [];
  var removedIndex = -1;
  for (var i = 0; i < conferences.length; i++) {
    if (conferences[i].id === current.id) {
      removedIndex = i;
      break;
    }
  }
  if (removedIndex === -1) return;

  conferences.splice(removedIndex, 1);

  if (appData.trash && Array.isArray(appData.trash.rooms)) {
    appData.trash.rooms = appData.trash.rooms.filter(function(item) {
      var payload = item.payload || {};
      return payload.conferenceId !== current.id;
    });
  }

  appData.currentConferenceId = null;
  if(!save())return false;
  showSelectConferenceModal();
  showToast('🗑️ تم حذف المؤتمر');
  return true;
}

function moveTemplateToTrash(id){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('moveTemplateToTrash',null))return false;
  var target = null;
  (appData.templates || []).forEach(function(t){ if (!target && t.id === id) target = t; });
  if (!target) return;
  if (!confirm('حذف القالب؟ يمكن استعادته من سلة المحذوفات.')) return;
  pushTrashItem('templates', target);
  appData.templates = removeByIdFromArray(appData.templates, id);
  if(window.ConferenceTemplateHousesEditor){
    window.ConferenceTemplateHousesEditor.handleTemplateDeleted(id);
  }
  if(!saveTemplateOnly())return false;
  renderSettings();
  showToast('🗑️ تم نقل القالب إلى سلة المحذوفات');
}

function moveArchiveToTrash(id){
  var target = null;
  (appData.archives || []).forEach(function(a){ if (!target && a.id === id) target = a; });
  if (!target) return;
  if (!confirm('حذف عنصر الأرشيف؟ يمكن استعادته من سلة المحذوفات.')) return;
  pushTrashItem('archives', target);
  appData.archives = removeByIdFromArray(appData.archives, id);
  if(!save())return false;
  renderSettings();
  showToast('🗑️ تم نقل الأرشيف إلى سلة المحذوفات');
}

function moveBackupToTrash(id){
  var target = null;
  (appData.backups || []).forEach(function(b){ if (!target && b.id === id) target = b; });
  if (!target) return;
  if (!confirm('حذف النسخة الاحتياطية؟ يمكن استعادتها من سلة المحذوفات.')) return;
  pushTrashItem('backups', target);
  appData.backups = removeByIdFromArray(appData.backups, id);
  if(!save())return false;
  renderSettings();
  showToast('🗑️ تم نقل النسخة إلى سلة المحذوفات');
}

function restoreTrashItem(type, trashId){
  var list = (appData.trash && appData.trash[type]) || [];
  var item = null;
  list.forEach(function(x){ if (!item && x.id === trashId) item = x; });
  if (!item) return;

  if (type === 'templates') appData.templates.push(item.payload);
  else if (type === 'archives') appData.archives.push(item.payload);
  else if (type === 'backups') appData.backups.push(item.payload);
  else if (type === 'houseTemplates') appData.houseTemplates.push(item.payload);
  else if (type === 'rooms') {
    var payload = item.payload || {};
    var conf = null;
    (appData.conferences || []).forEach(function(c){ if (!conf && c.id === payload.conferenceId) conf = c; });
    if (!conf) { alert('تعذر استرجاع الغرفة: المؤتمر غير موجود.'); return; }
    var house = null;
    (conf.houses || []).forEach(function(h){ if (!house && h.id === payload.houseId) house = h; });
    if (!house) {
      house = { id: payload.houseId || uid(), name: payload.houseName || 'بيت', description: '', floors: [] };
      conf.houses = conf.houses || [];
      conf.houses.push(house);
    }
    var floor = null;
    (house.floors || []).forEach(function(f){ if (!floor && f.id === payload.floorId) floor = f; });
    if (!floor) {
      floor = { id: payload.floorId || uid(), name: payload.floorName || 'دور', rooms: [] };
      house.floors = house.floors || [];
      house.floors.push(floor);
    }
    floor.rooms = floor.rooms || [];
    var roomClone = deepClone(payload.room || {});
    if (!roomClone.id) roomClone.id = uid();
    floor.rooms.push(roomClone);
  }

  appData.trash[type] = removeByIdFromArray(appData.trash[type], trashId);
  if(!save())return false;
  renderSettings();
  renderTab(currentTab);
  showToast('✅ تم الاسترجاع من سلة المحذوفات');
}

function purgeTrashItem(type, trashId){
  if (!confirm('حذف نهائي من سلة المحذوفات؟ لا يمكن التراجع.')) return;
  appData.trash[type] = removeByIdFromArray((appData.trash || {})[type] || [], trashId);
  if(!save())return false;
  renderSettings();
  showToast('🗑️ تم الحذف النهائي');
}

// ═══════════════════════════════════════════════════════
// PERSIST
// ═══════════════════════════════════════════════════════
function exportJsonFile(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('exportJsonFile',null))return false;
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  updateCurrentConferenceData();
  var data=JSON.stringify(appData,null,2);
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([data],{type:'application/json;charset=utf-8'}));
  a.download='conference_'+new Date().toISOString().slice(0,10)+'.json';
  a.click();showToast('✅ تم تصدير JSON');
}

var memberActivationDiagnosticState={
  trace:[],currentStage:null,exceptionStage:null,settingsResolved:false
};
var currentConferenceRuntimeAccessRole=null;
var currentConferenceRuntimeAccessRoles=Object.create(null);
function traceMemberActivation(stage,status,reason){
  memberActivationDiagnosticState.currentStage=String(stage||'unknown');
  memberActivationDiagnosticState.trace.push({
    at:new Date().toISOString(),stage:memberActivationDiagnosticState.currentStage,
    status:String(status||'reached'),reason:reason?String(reason):null
  });
  memberActivationDiagnosticState.trace=
    memberActivationDiagnosticState.trace.slice(-30);
}
function getMemberActivationDiagnostics(){
  return deepClone(memberActivationDiagnosticState);
}
function runMemberActivationStep(stage,callback){
  traceMemberActivation(stage,'entered',null);
  try{
    var value=callback();
    traceMemberActivation(stage,'completed',null);
    return {ok:true,value:value};
  }catch(error){
    memberActivationDiagnosticState.exceptionStage=stage;
    traceMemberActivation(stage,'exception',error&&error.name||'Error');
    return {ok:false,value:null};
  }
}
function activatePersistedConferenceById(id,options){
  options=options||{};
  var activationAuthorization=window.ConferenceActivationAuthorization;
  if(!activationAuthorization||
    !activationAuthorization.activate(String(id||'')))return false;
  if(options.accessRole){
    currentConferenceRuntimeAccessRoles[String(id)]=String(options.accessRole);
  }
  currentConferenceRuntimeAccessRole=
    Object.prototype.hasOwnProperty.call(
      currentConferenceRuntimeAccessRoles,String(id)
    )?currentConferenceRuntimeAccessRoles[String(id)]:null;
  memberActivationDiagnosticState={
    trace:[],currentStage:null,exceptionStage:null,settingsResolved:false
  };
  traceMemberActivation('activation_enter','entered',null);
  var matching=(appData&&Array.isArray(appData.conferences)
    ?appData.conferences:[]).find(function(item){
      return item&&String(item.id)===String(id);
    });
  if(!matching){
    traceMemberActivation('conference_resolved','return','conference_not_found');
    return false;
  }
  appData.currentConferenceId=matching.id;
  traceMemberActivation('current_id_set','completed',null);
  var current=getCurrentConference();
  if(!current||String(current.id)!==String(id)){
    traceMemberActivation('conference_resolved','return','conference_not_resolved');
    return false;
  }
  traceMemberActivation('conference_resolved','completed',null);
  var applicationBody=ge('applicationBody');
  var wasStartup=applicationBody&&applicationBody.style.display==='none';
  var steps=[
    ['set_current_conference',function(){setCurrentConference(current)}],
    ['sync_current_references',function(){syncCurrentConferenceRefs()}],
    ['set_application_mode',function(){setApplicationMode('application')}],
    ['refresh_people_datalist',function(){refreshPeopleDatalist()}],
    ['render_accommodation',function(){if(ge('tab0'))renderAccommodation()}],
    ['render_transports',function(){if(ge('tab1'))renderTransports()}],
    ['render_settings',function(){
      if(ge('tab6')){
        renderSettings();
        memberActivationDiagnosticState.settingsResolved=true;
      }
    }],
    ['render_current_tab',function(){
      if(wasStartup)restoreLastApplicationTab();
      else if(!switchTab(currentTab))switchTab(0);
    }]
  ];
  for(var stepIndex=0;stepIndex<steps.length;stepIndex++){
    if(!runMemberActivationStep(steps[stepIndex][0],steps[stepIndex][1]).ok){
      traceMemberActivation('activation_return','return','step_failed');
      return false;
    }
  }
  if(options.alreadyPersisted!==true&&window.AutomaticSyncOrchestrator&&
    typeof window.AutomaticSyncOrchestrator.schedule==='function'){
    window.AutomaticSyncOrchestrator.schedule('conference_changed');
  }
  traceMemberActivation('activation_return','completed',null);
  return true;
}
function downloadFullApplicationBackup(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('downloadFullApplicationBackup',null))return false;
  try{
    if(!window.FullBackupService||
      typeof window.FullBackupService.createAndDownloadFullBackup!=='function'){
      throw new Error('FULL_BACKUP_SERVICE_UNAVAILABLE');
    }
    var result=window.FullBackupService.createAndDownloadFullBackup(appData);
    showToast('✅ تم تنزيل النسخة الاحتياطية الكاملة: '+result.fileName);
    return result;
  }catch(error){
    console.error('تعذر تنزيل النسخة الاحتياطية الكاملة:',error);
    showToast('❌ تعذر تنزيل النسخة الاحتياطية الكاملة. تحقق من البيانات وحاول مرة أخرى.','#E74C3C');
    return null;
  }
}
var fullRestorePreflightState=null;
function closeFullRestorePreflight(){
  if(fullRestorePreflightState&&fullRestorePreflightState.running)return;
  var modal=ge('fullRestorePreflightModal');
  if(modal)modal.remove();
  var confirmation=ge('fullRestoreConfirmationModal');
  if(confirmation)confirmation.remove();
  fullRestorePreflightState=null;
}
function readFullRestoreSyncLinks(){
  var result={syncLinks:[],warnings:[]};
  try{
    var raw=localStorage.getItem(
      (window.BrowserStorageNamespace||browserStorageNamespace)
        .key('conference_manager_sync_links')
    );
    if(!raw)return result;
    var parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'){
      result.warnings.push({
        code:'SYNC_LINKS_READ_INVALID',
        message:'تعذر فهم بيانات روابط المزامنة المحلية.'
      });
      return result;
    }
    result.syncLinks=parsed;
  }catch(error){
    result.warnings.push({
      code:'SYNC_LINKS_READ_FAILED',
      message:'تعذر قراءة روابط المزامنة المحلية، واستمر فحص النسخة بدونها.'
    });
  }
  return result;
}
function fullRestorePreviewCountRows(preview){
  var rows=[
    ['المؤتمرات','conferenceCount'],
    ['القوالب','templateCount'],
    ['الأرشيف','archiveCount'],
    ['النسخ الداخلية','internalBackupCount'],
    ['قوالب البيوت','houseTemplateCount'],
    ['الأشخاص','peopleCount']
  ];
  var html='<div class="settings-list">';
  rows.forEach(function(row){
    html+='<div class="settings-list-item"><span>'+row[0]+'</span>'+
      '<span>الحالي: <strong>'+preview.current[row[1]]+
      '</strong> — القادم: <strong>'+preview.incoming[row[1]]+
      '</strong></span></div>';
  });
  return html+'</div>';
}
function fullRestorePreviewIssues(title,items,errorStyle){
  if(!items||!items.length)return '';
  var html='<div class="modal-section"><strong>'+esc(title)+'</strong>';
  items.forEach(function(item){
    html+='<div class="sync-settings-message'+
      (errorStyle?' sync-settings-error':'')+'">'+
      esc(item.code||'NOTICE')+' — '+esc(item.message||'')+'</div>';
  });
  return html+'</div>';
}
function showFullRestorePreflightModal(input){
  closeFullRestorePreflight();
  fullRestorePreflightState={
    file:input.file,
    candidate:input.candidate,
    preview:input.preview,
    backupDocument:input.backupDocument,
    running:false
  };
  var preview=input.preview;
  var candidate=input.candidate;
  var file=input.file;
  var modal=document.createElement('div');
  modal.id='fullRestorePreflightModal';
  modal.className='overlay app-modal';
  modal.onclick=function(event){
    if(event.target===modal)closeFullRestorePreflight();
  };
  var sizeMb=Math.round((file.fileSize/1024/1024)*100)/100;
  var html='<div class="modal" style="max-width:720px">'+
    '<div class="mhead"><span>فحص نسخة احتياطية كاملة</span>'+
    '<span style="cursor:pointer" onclick="closeFullRestorePreflight()">✕</span></div>'+
    '<div class="mbody"><div class="modal-section">'+
    '<div><strong>الملف:</strong> '+esc(file.fileName)+'</div>'+
    '<div><strong>الحجم:</strong> '+sizeMb+' MB</div>'+
    '<div><strong>تاريخ النسخة:</strong> '+esc(preview.source.fileCreatedAt)+'</div>'+
    '<div><strong>إصدار التطبيق المصدر:</strong> '+esc(preview.source.appVersion)+'</div>'+
    '<div><strong>إصدار البيانات:</strong> '+esc(preview.source.dataSchemaVersion)+'</div>'+
    '<div><strong>المؤتمر الحالي داخل النسخة:</strong> '+
    esc(preview.incoming.currentConferenceName||'—')+'</div></div>'+
    '<div class="modal-section"><strong>مقارنة البيانات</strong>'+
    fullRestorePreviewCountRows(preview)+'</div>'+
    '<div class="sync-settings-message sync-settings-error">'+
    'الاستعادة ستستبدل جميع بيانات البرنامج الحالية.</div>'+
    '<div class="sync-settings-message">'+
    'سيتم فحص الملف محليًا داخل هذا الجهاز ولن يتم رفعه إلى الإنترنت.</div>'+
    fullRestorePreviewIssues('أخطاء تمنع الاستعادة',candidate.errors,true)+
    fullRestorePreviewIssues('تحذيرات الفحص',
      candidate.warnings.concat(preview.warnings||[]),false)+
    fullRestorePreviewIssues('مخاطر الروابط السحابية',preview.risks,false)+
    '<div id="fullRestoreExecutionStatus" class="sync-settings-message" style="display:none"></div>'+
    '<div class="row" style="margin-top:12px">'+
    '<button id="executeFullRestoreButton" class="btn btn-red" '+
    (candidate.errors.length?'disabled':'onclick="showFullRestoreConfirmation()"')+
    '>استعادة جميع بيانات البرنامج</button>'+
    '<button class="btn btn-blue" onclick="closeFullRestorePreflight()">إغلاق</button>'+
    '</div></div></div>';
  modal.innerHTML=html;
  document.body.appendChild(modal);
}
function closeFullRestoreConfirmation(){
  var modal=ge('fullRestoreConfirmationModal');
  if(modal)modal.remove();
}
function showFullRestoreConfirmation(){
  if(!fullRestorePreflightState||
    fullRestorePreflightState.running||
    fullRestorePreflightState.candidate.errors.length)return;
  closeFullRestoreConfirmation();
  var modal=document.createElement('div');
  modal.id='fullRestoreConfirmationModal';
  modal.className='overlay app-modal';
  modal.innerHTML='<div class="modal" style="max-width:560px">'+
    '<div class="mhead"><span>تأكيد الاستعادة الكاملة</span></div>'+
    '<div class="mbody"><div class="sync-settings-message sync-settings-error">'+
    'سيتم استبدال جميع بيانات البرنامج الحالية بالنسخة المختارة. سيتم إنشاء نسخة حماية محلية أولًا. هل تريد المتابعة؟</div>'+
    '<div class="row" style="margin-top:12px">'+
    '<button class="btn btn-red" onclick="executeConfirmedFullRestore()">نعم، استعادة جميع البيانات</button>'+
    '<button class="btn btn-gray" onclick="closeFullRestoreConfirmation()">إلغاء</button>'+
    '</div></div></div>';
  document.body.appendChild(modal);
}
function renderFullRestoreFailure(result){
  var rollback=result.rollback||{};
  var safety=result.safetyBackup||{};
  var message='فشلت الاستعادة عند المرحلة: '+(result.failedStage||'unknown')+'. ';
  if(rollback.attempted){
    message+=rollback.success
      ?'تمت استعادة البيانات السابقة بنجاح. '
      :'فشل جزء من استعادة البيانات السابقة. لا تغلق البرنامج وراجع نسخة الحماية. ';
  }
  message+=safety.created
    ?'توجد نسخة حماية محلية برقم '+safety.id+'.'
    :'لم يتم تأكيد إنشاء نسخة حماية.';
  return message;
}
function executeConfirmedFullRestore(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('executeConfirmedFullRestore',null))return false;
  var state=fullRestorePreflightState;
  if(!state||state.running)return;
  closeFullRestoreConfirmation();
  state.running=true;
  var button=ge('executeFullRestoreButton');
  var status=ge('fullRestoreExecutionStatus');
  if(button)button.disabled=true;
  if(status){
    status.style.display='block';
    status.classList.remove('sync-settings-error');
    status.textContent='جارٍ إنشاء نسخة حماية واستعادة البيانات...';
  }
  window.FullBackupService.executeFullRestore({
    confirmed:true,
    backupDocument:state.backupDocument,
    candidateResult:state.candidate,
    preview:state.preview
  },{
    currentAppData:appData,
    supportedDataSchemaVersion:appData.version,
    normalizeCandidate:normalizeAppDataCandidate,
    applyAppData:function(value){appData=value;}
  }).then(function(result){
    if(result.success){
      if(status){
        status.textContent='تمت استعادة البيانات بنجاح. سيتم إعادة تشغيل البرنامج.';
      }
      showToast('✅ تمت استعادة البيانات بنجاح. سيتم إعادة تشغيل البرنامج.');
      setTimeout(function(){window.location.reload();},1500);
      return;
    }
    state.running=false;
    if(button)button.disabled=false;
    if(status){
      status.classList.add('sync-settings-error');
      status.textContent=renderFullRestoreFailure(result);
    }
  }).catch(function(error){
    state.running=false;
    if(button)button.disabled=false;
    if(status){
      status.classList.add('sync-settings-error');
      status.textContent='تعذر إكمال الاستعادة بأمان. لم تتم إعادة تشغيل البرنامج.';
    }
    console.error('تعذر تنفيذ الاستعادة الكاملة:',error);
  });
}
function closePostRestoreCloudReviewModal(){
  var modal=ge('postRestoreCloudReviewModal');
  if(modal)modal.remove();
}
function readPostRestoreSyncLinksStrict(){
  var raw=localStorage.getItem(
    (window.BrowserStorageNamespace||browserStorageNamespace)
      .key('conference_manager_sync_links')
  );
  if(!raw)return {};
  var parsed=JSON.parse(raw);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){
    throw new Error('FULL_RESTORE_SYNC_LINKS_MALFORMED');
  }
  return parsed;
}
function showPostRestoreCloudReviewBanner(){
  var existing=ge('postRestoreCloudReviewBanner');
  if(existing)return;
  var banner=document.createElement('div');
  banner.id='postRestoreCloudReviewBanner';
  banner.className='update-bar';
  banner.style.display='flex';
  banner.innerHTML='<span>مراجعة الربط السحابي بعد الاستعادة مطلوبة. المزامنة متوقفة مؤقتًا.</span>'+
    '<button class="btn btn-orange btn-sm" onclick="showPostRestoreCloudReviewModal()">فتح المراجعة</button>';
  document.body.appendChild(banner);
}
function postRestoreAffectedNames(review){
  var names=[];
  (review.affectedLinks||[]).forEach(function(link){
    var conference=(appData.conferences||[]).find(function(item){
      return item&&item.id===link.localConferenceId;
    });
    names.push(conference&&conference.name||link.localConferenceId);
  });
  return names;
}
function showPostRestoreCloudReviewModal(){
  closePostRestoreCloudReviewModal();
  var service=window.FullBackupService;
  var markerResult=service.getFullRestoreCloudReviewMarker();
  var review=null;
  var readError=null;
  try{
    var links=readPostRestoreSyncLinksStrict();
    if(markerResult.malformed){
      throw new Error(markerResult.errorCode);
    }
    review=service.buildPostRestoreCloudReview(
      appData,
      links,
      markerResult.marker
    );
  }catch(error){
    readError=error;
  }
  var modal=document.createElement('div');
  modal.id='postRestoreCloudReviewModal';
  modal.className='overlay app-modal';
  var html='<div class="modal" style="max-width:680px">'+
    '<div class="mhead"><span>مراجعة الربط السحابي بعد الاستعادة</span></div>'+
    '<div class="mbody"><div class="sync-settings-message">'+
    'تمت استعادة نسخة احتياطية كاملة. أوقف البرنامج المزامنة مؤقتًا حتى لا تُرفع البيانات المستعادة إلى مؤتمرات سحابية مرتبطة سابقًا.</div>';
  if(readError){
    html+='<div class="sync-settings-message sync-settings-error">'+
      'تعذر قراءة عقد الروابط السحابية بأمان. بقيت المزامنة متوقفة ولم يتم تغيير الروابط.</div>';
  }else{
    var names=postRestoreAffectedNames(review);
    html+='<div class="modal-section">'+
      '<div><strong>المؤتمرات المستعادة:</strong> '+review.restoredConferenceIds.length+'</div>'+
      '<div><strong>الروابط المتأثرة:</strong> '+review.affectedLinks.length+'</div>'+
      '<div><strong>الروابط غير المتأثرة:</strong> '+review.unaffectedLinks.length+'</div>'+
      '<div><strong>الروابط غير الصالحة:</strong> '+review.malformedLinks.length+'</div>'+
      (names.length?'<div><strong>المؤتمرات المتأثرة:</strong> '+esc(names.join('، '))+'</div>':'')+
      '</div><div class="sync-settings-message">'+
      'ستتم مراجعة عمليات المزامنة المحلية القديمة أولًا. لن تُعزل إلا العمليات التي يثبت أنها لم تُنفذ، وستبقى المزامنة متوقفة إذا تعذر إثبات حالة أي عملية. لن تُحذف أي بيانات من Supabase.</div>';
  }
  html+='<div id="postRestoreCloudReviewStatus" class="sync-settings-message" style="display:none"></div>'+
    '<div class="row" style="margin-top:12px">'+
    '<button id="completePostRestoreCloudReviewButton" class="btn btn-orange" '+
    (readError?'disabled':'onclick="completePostRestoreCloudReviewFromUI()"')+
    '>مراجعة العمليات وإلغاء الروابط القديمة</button>'+
    '<button class="btn btn-gray" onclick="closePostRestoreCloudReviewModal()">المراجعة لاحقًا</button>'+
    '</div></div></div>';
  modal.innerHTML=html;
  document.body.appendChild(modal);
}
function completePostRestoreCloudReviewFromUI(){
  var button=ge('completePostRestoreCloudReviewButton');
  var status=ge('postRestoreCloudReviewStatus');
  if(button)button.disabled=true;
  if(status){
    status.style.display='block';
    status.classList.remove('sync-settings-error');
    status.textContent='جارٍ تنظيف الروابط المحلية المتأثرة...';
  }
  window.FullBackupService.completePostRestoreCloudReview({
    currentAppData:appData
  }).then(function(result){
    if(!result.success){
      if(button)button.disabled=false;
      if(status){
        status.classList.add('sync-settings-error');
        if(result.errorCode==='FULL_RESTORE_QUEUE_REVIEW_REQUIRED'){
          var queueReview=result.queueReview||{};
          var inspectionCount=(queueReview.requiresInspection||[]).length;
          var unresolvedCount=(queueReview.unresolved||[]).length;
          status.textContent='بقيت المزامنة متوقفة بأمان. توجد '+
            (inspectionCount+unresolvedCount)+
            ' عملية لم يمكن إثبات حالتها بعد؛ أعد المحاولة بعد استعادة الاتصال والجلسة المعتمدة.';
        }else{
          status.textContent='تعذر إكمال مراجعة الروابط بأمان: '+
            result.errorCode;
        }
      }
      return;
    }
    var banner=ge('postRestoreCloudReviewBanner');
    if(banner)banner.remove();
    if(status){
      status.textContent=result.affectedLinkCount
        ?'تم إلغاء الروابط المحلية القديمة. يمكنك إعادة الربط يدويًا لاحقًا.'
        :'تمت مراجعة الربط السحابي، ولا توجد روابط متعارضة.';
    }
    showToast(result.affectedLinkCount
      ?'✅ تم إلغاء الروابط المحلية القديمة واستكمال التشغيل.'
      :'✅ تمت مراجعة الربط السحابي، ولا توجد روابط متعارضة.');
    setTimeout(closePostRestoreCloudReviewModal,1200);
  });
}
function inspectFullApplicationBackup(event){
  var input=event&&event.target;
  var file=input&&input.files&&input.files[0];
  if(!file)return;
  var service=window.FullBackupService;
  if(!service||typeof service.readFullBackupFile!=='function'){
    showToast('❌ خدمة فحص النسخة الاحتياطية غير متاحة.','#E74C3C');
    input.value='';
    return;
  }
  service.readFullBackupFile(file).then(function(readResult){
    var candidate=service.prepareFullRestoreCandidate(readResult.document,{
      supportedDataSchemaVersion:appData.version
    });
    var preview=service.buildFullRestorePreview(
      appData,
      readResult.document,
      candidate.candidateAppData
    );
    var linkRead=readFullRestoreSyncLinks();
    preview.risks=service.detectFullRestoreCloudLinkRisks(
      candidate.candidateAppData,
      {syncLinks:linkRead.syncLinks}
    );
    preview.warnings=linkRead.warnings;
    showFullRestorePreflightModal({
      file:readResult,
      candidate:candidate,
      preview:preview,
      backupDocument:readResult.document
    });
  }).catch(function(error){
    console.error('تعذر فحص النسخة الاحتياطية الكاملة:',error);
    showToast('❌ تعذر فحص النسخة الاحتياطية: '+
      (error&&error.code?error.code:'ملف غير صالح'),'#E74C3C');
  }).then(function(){
    input.value='';
  });
}
function createConferenceFromObject(data, name){
  data=data&&typeof data==='object'?data:{};
  var confObj=deepClone(data);
  var legacyRooms=Array.isArray(confObj.rooms)?confObj.rooms:[];
  var conferenceName=name||confObj.name||(confObj.conf&&confObj.conf.name)||'المؤتمر';
  confObj.id=confObj.id||uid();
  confObj.name=conferenceName;
  confObj.startDate=confObj.startDate||(confObj.conf&&confObj.conf.startDate)||'';
  confObj.endDate=confObj.endDate||(confObj.conf&&confObj.conf.endDate)||'';
  confObj.days=confObj.days||(confObj.conf&&confObj.conf.days)||1;
  confObj.conf=confObj.conf||{name:conferenceName,startDate:confObj.startDate,endDate:confObj.endDate,days:confObj.days};
  confObj.houses=Array.isArray(confObj.houses)&&confObj.houses.length
    ? confObj.houses
    : convertLegacyRoomsToHouses(legacyRooms,conferenceName);
  confObj.transports=Array.isArray(confObj.transports)?confObj.transports:[];
  confObj.restaurant=confObj.restaurant||createDefaultRestaurant();
  confObj.status=confObj.status||'active';
  confObj.completedAt=confObj.completedAt||null;
  confObj.createdAt=confObj.createdAt||new Date().toISOString();
  confObj.updatedAt=confObj.updatedAt||new Date().toISOString();
  confObj.activityLog=Array.isArray(confObj.activityLog)?confObj.activityLog:[];
  normalizeConference(confObj);
  return confObj;
}
function buildAppDataFromLegacy(raw){
  var legacy = {
    conf: raw.conf || raw,
    houses: Array.isArray(raw.houses) ? raw.houses : [],
    rooms: raw.rooms || [],
    transports: raw.transports || [],
    restaurant: raw.restaurant || createDefaultRestaurant(),
    restaurantV3: raw.restaurantV3 || createDefaultRestaurantV3()
  };
  return {
    version: '2.0.0',
    currentConferenceId: null,
    conferences: [createConferenceFromObject(legacy)],
    templates: [],
    archives: [],
    backups: [],
    houseTemplates: [],
    peopleDb: { version: '1.0.0', people: [] },
    trash: { templates: [], archives: [], backups: [], houseTemplates: [], rooms: [] }
  };
}

function isImportableConferenceObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  var hasIdentity=!!(value.id||value.name||(value.conf&&value.conf.name));
  var hasConferenceData=!!(
    value.conf||
    Array.isArray(value.houses)||
    Array.isArray(value.rooms)||
    Array.isArray(value.transports)||
    value.restaurant||
    value.startDate||
    value.endDate||
    value.status||
    value.peopleDb
  );
  return hasIdentity&&hasConferenceData;
}

function getImportedConferenceCandidates(rawData){
  if(!rawData||typeof rawData!=='object'||Array.isArray(rawData))return [];
  var container=rawData.appData&&typeof rawData.appData==='object'?rawData.appData:rawData;
  var candidates=[];
  if(Array.isArray(container.conferences)){
    candidates=container.conferences.filter(isImportableConferenceObject);
  }else if(container.conference&&isImportableConferenceObject(container.conference)){
    candidates=[container.conference];
  }else if(container.data&&isImportableConferenceObject(container.data)){
    candidates=[container.data];
  }else if(isImportableConferenceObject(container)){
    candidates=[container];
  }
  return candidates;
}

function selectImportedConference(candidates){
  if(!candidates.length)return null;
  if(candidates.length===1)return candidates[0];
  var lines=['يحتوي الملف على عدة مؤتمرات. اكتب رقم المؤتمر المطلوب استيراده:'];
  candidates.forEach(function(conference,index){
    var name=conference.name||(conference.conf&&conference.conf.name)||'مؤتمر بدون اسم';
    var status=conference.status==='completed'?'مكتمل':'نشط';
    lines.push((index+1)+' - '+name+' ('+status+')');
  });
  var selected=prompt(lines.join('\n'),'1');
  if(selected===null)return null;
  var selectedIndex=parseInt(selected,10)-1;
  if(selectedIndex<0||selectedIndex>=candidates.length||String(selectedIndex+1)!==String(parseInt(selected,10))){
    alert('اختيار المؤتمر غير صالح.');
    return null;
  }
  return candidates[selectedIndex];
}

function importSingleConferenceData(importedData){
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  var importedConference=createConferenceFromObject(importedData);
  var previousConferences=deepClone(appData.conferences||[]);
  var previousCurrentConferenceId=appData.currentConferenceId;
  var existingIndex=-1;
  (appData.conferences||[]).some(function(conference,index){
    if(conference&&String(conference.id)===String(importedConference.id)){
      existingIndex=index;
      return true;
    }
    return false;
  });

  if(existingIndex!==-1){
    var duplicateChoice=prompt(
      'يوجد مؤتمر محفوظ بنفس المعرّف. ماذا تريد أن تفعل؟\n1 - استبدال المؤتمر الموجود\n2 - استيراده كنسخة جديدة\n3 - إلغاء',
      '3'
    );
    if(duplicateChoice===null||duplicateChoice==='3')return false;
    if(duplicateChoice==='1'){
      appData.conferences[existingIndex]=importedConference;
    }else if(duplicateChoice==='2'){
      importedConference.id=uid();
      importedConference.name=(importedConference.name||(importedConference.conf&&importedConference.conf.name)||'المؤتمر')+' - نسخة مستوردة';
      if(importedConference.conf)importedConference.conf.name=importedConference.name;
      appData.conferences.push(importedConference);
    }else{
      alert('اختيار غير صالح. لم يتم استيراد المؤتمر.');
      return false;
    }
  }else{
    appData.conferences.push(importedConference);
  }

  if(window.ConferenceActivationAuthorization){
    window.ConferenceActivationAuthorization.capturePersistedCandidate(
      importedConference.id,'import');
    window.ConferenceActivationAuthorization.deactivate(importedConference.id,
      'unverified_legacy_unscoped','import_authorization_unverified');
  }
  appData.currentConferenceId=null;
  if(!save()){
    appData.conferences=previousConferences;
    appData.currentConferenceId=previousCurrentConferenceId;
    if(window.ConferenceActivationAuthorization){
      window.ConferenceActivationAuthorization.capturePersistedCandidate(
        previousCurrentConferenceId,'import_rollback');
    }
    showToast('تعذر حفظ المؤتمر المستورد، وتمت استعادة بيانات المؤتمرات السابقة.','#E74C3C');
    return false;
  }

  showSelectConferenceModal();
  showToast('✅ تم استيراد المؤتمر وإضافته إلى المؤتمرات المحفوظة');
  return true;
}

function loadFromFile(e){
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  var f=e.target.files[0];if(!f)return;
  var r=new FileReader();
  r.onload=function(ev){
    var text=ev.target.result;
    var loaded=false;
    var rawData=null;

    if(f.name.toLowerCase().endsWith('.json')){
      try{rawData=JSON.parse(text);loaded=true;}catch(er){loaded=false;}
    }

    if(!loaded){
      var m1=text.match(/\/\/__S__\nvar _d=([\s\S]*?);\n(appData|conf)=/);
      if(m1){try{rawData=JSON.parse(m1[1]);loaded=true;}catch(er){loaded=false;}}
    }

    if(!loaded){
      var m2=text.match(/\/\/__SEED_START__\nvar _s=([\s\S]*?);\nrooms=/);
      if(m2){try{var d=JSON.parse(m2[1]);rawData={conf:d.conf||{name:'المؤتمر',startDate:'',endDate:'',days:1},rooms:d.rooms||[],transports:d.transports||d.extraTransports||[],restaurant:d.restaurant||createDefaultRestaurant()};loaded=true;}catch(er){loaded=false;}}
    }

    if(!loaded){
      var m3=text.match(/\/ __DATA_SEED_START__\nvar _s=([\s\S]*?);\nrooms=/);
      if(m3){try{var d=JSON.parse(m3[1]);var trans=[];if(d.busSeats&&d.busSeats.some(function(s){return s.name})){trans=[{id:'bus_main',name:'أتوبيس 1',icon:'🚌',capacity:50,seats:d.busSeats}];}if(d.extraTransports)trans=trans.concat(d.extraTransports);rawData={conf:d.conf||{name:'المؤتمر',startDate:'',endDate:'',days:1},rooms:d.rooms||[],transports:trans,restaurant:d.restaurant||createDefaultRestaurant()};loaded=true;}catch(er){loaded=false;}}
    }

    if(!loaded){
      var m4=text.match(/var rooms\s*=\s*(\[[\s\S]*?\]);/);
      if(m4){try{rawData={conf:{name:'المؤتمر',startDate:'',endDate:'',days:1},rooms:JSON.parse(m4[1]),transports:[],restaurant:createDefaultRestaurant()};loaded=true;}catch(er){loaded=false;}}
    }

    if(!loaded){
      var m5=text.match(/"conf_v[0-9]+"[^{]*(\{[\s\S]*?\})\s*[,;]/);
      if(m5){try{var d=JSON.parse(m5[1]);rawData={conf:d.conf||{name:'المؤتمر',startDate:'',endDate:'',days:1},rooms:d.rooms||[],transports:d.transports||[],restaurant:d.restaurant||createDefaultRestaurant()};loaded=true;}catch(er){loaded=false;}}
    }

    if(loaded && rawData){
      var candidates=getImportedConferenceCandidates(rawData);
      if(!candidates.length){
        alert('لا يحتوي الملف على بيانات مؤتمر صالحة للاستيراد.');
        e.target.value='';
        return;
      }
      var importedData=selectImportedConference(candidates);
      if(!importedData){
        e.target.value='';
        return;
      }
      if(!confirm('سيتم استيراد بيانات المؤتمر من الملف وإضافتها إلى المؤتمرات المحفوظة. لن تتأثر القوالب أو الأرشيفات أو النسخ الاحتياطية. هل تريد المتابعة؟')){
        e.target.value = '';
        return;
      }
      importSingleConferenceData(importedData);
    } else {
      alert('❌ لم يتم التعرف على صيغة الملف\nجرب "💾 حفظ ملف" من النسخة القديمة أولاً');
    }
  };
  r.readAsText(f,'utf-8');e.target.value='';
}

function updateLogoText() {
  var logoEl = ge('logo-text');
  var accountLabel = logoEl && logoEl.querySelector('.application-account-label');
  var identity = window.SupabaseAuth &&
    typeof window.SupabaseAuth.getAccountIdentity === 'function'
    ? window.SupabaseAuth.getAccountIdentity()
    : {authenticated:false,label:''};
  var startupActions = ge('startupAuthActions');
  var signedOut = startupActions &&
    startupActions.querySelector('[data-startup-auth-signed-out]');
  var signedIn = startupActions &&
    startupActions.querySelector('[data-startup-auth-signed-in]');
  var startupName = startupActions &&
    startupActions.querySelector('[data-startup-auth-account-name]');
  if (accountLabel) accountLabel.textContent = identity.label;
  if (signedOut) signedOut.style.display = identity.authenticated ? 'none' : '';
  if (signedIn) signedIn.style.display = identity.authenticated ? '' : 'none';
  if (startupName) startupName.textContent = identity.label;
  renderGlobalConferenceHeader();
}

function accommodationIcon(name,className,title){
  return window.AppIcons&&typeof window.AppIcons.icon==='function'
    ?window.AppIcons.icon(name,className,title):'';
}

function renderGlobalConferenceHeader(){
  var container = ge('globalConferenceHeader');
  if(!container) return;
  var current = getCurrentConference();
  if(!current){
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  var conf = current.conf || {};
  var isCompleted = current.status === 'completed';
  var houseNames = (current.houses || []).map(function(house){ return house.name || 'بيت غير مسمى'; });
  var houseName = houseNames.length ? houseNames.join('، ') : 'لم يتم اختيار بيت';
  var h = '<section class="global-conference-header '+(isCompleted?'global-conference-header-completed':'')+'"><span class="global-conference-compact-icon">'+accommodationIcon('users')+'</span><div class="global-conference-content"><small class="global-conference-eyebrow">المؤتمر الحالي</small>';
  h += '<div class="global-conference-main"><div class="global-conference-name">'+esc(conf.name||current.name||'المؤتمر')+'</div>';
  h += '<span class="global-conference-status '+(isCompleted?'global-conference-status-completed':'global-conference-status-active')+'">'+(isCompleted?'منتهي':'نشط')+'</span></div>';
  h += '<div class="global-conference-meta">';
  h += '<span class="global-conference-house">'+accommodationIcon('building')+' '+esc(houseName)+'</span>';
  h += '<span class="global-conference-dates">'+esc(conf.startDate||'-')+' — '+esc(conf.endDate||'-')+'</span>';
  h += '<span>المدة: '+(conf.days||1)+' يوم</span>';
  h += '</div></div><span class="global-conference-chevron">'+accommodationIcon('chevronDown')+'</span></section>';
  container.innerHTML = h;
  container.style.display = '';
}

function saveToFile(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveToFile',null))return false;
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  updateCurrentConferenceData();
  var data = JSON.stringify({appData: appData}, null, 2);
  var orig = document.documentElement.outerHTML;
  var block = '<script>\n' +
    '//__S__\n' +
    'var _d=' + data + ';\n' +
    'appData=_d.appData;\n' +
    '//__E__\n' +
    '</script>';
  var upd;
  if (orig.indexOf('//__S__') !== -1) {
    upd = orig.replace(/<script>\s*\/\/__S__[\s\S]*?\/\/__E__\s*<\/script>/, block);
  } else {
    upd = orig.replace('</body>', block + '\n</body>');
  }
  var blob = new Blob([upd], { type: 'text/html;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'المؤتمر_' + new Date().toISOString().slice(0, 10) + '.html';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('✅ تم حفظ ملف HTML');
}

function switchSettingsTab(tab) {
  if(window.ConferenceTemplateHousesEditor){
    window.ConferenceTemplateHousesEditor.close();
  }
  settingsTab = tab || 'general';
  renderSettings();
  resetAdministrativeViewScroll();
}

function mountSyncSettingsSection(){
  var target=ge('tab6');
  var navigation=target&&target.querySelector('.settings-nav');
  if(!navigation||!window.SyncSettingsUI||
    typeof window.SyncSettingsUI.renderSection!=='function')return;
  navigation.insertAdjacentHTML(
    'afterend',
    window.SyncSettingsUI.renderSection()
  );
}

function refreshConferenceMembersSection(){
  if(window.ConferenceMembersUI&&
    typeof window.ConferenceMembersUI.refresh==='function'){
    window.ConferenceMembersUI.refresh();
  }
}

function refreshOrganizationMembersSection(){
  if(window.OrganizationMembersUI&&
    typeof window.OrganizationMembersUI.initialize==='function'){
    window.OrganizationMembersUI.initialize();
  }
}

function renderHouseTemplateDetails(house) {
  if (!house) {
    return '<div style="color:#95a5a6;text-align:center;padding:18px">اختر بيتًا لعرض غرفه هنا</div>';
  }

  var h = '';
  var contentAuthorization=window.HouseTemplateContentAuthorization;
  var canEditContent=!!contentAuthorization&&
    typeof contentAuthorization.canEdit==='function'&&
    contentAuthorization.canEdit(house.id);
  h += '<div class="house-template-details-header">';
  h += '<div class="house-template-details-title">';
  h += '<div class="house-template-name">' + esc(house.name || 'بيت غير مسمى') + '</div>';
  if (house.description) {
    h += '<div style="font-size:10px;color:#5a7a9a;margin-top:2px">' + esc(house.description) + '</div>';
  }
  h += '</div>';
  h += '<div class="house-template-actions">';
        if (window.HouseTemplateSharingUI && typeof window.HouseTemplateSharingUI.renderAction === 'function') h += window.HouseTemplateSharingUI.renderAction(house);
        if (canEditContent) {
        h += '<button class="btn btn-blue btn-sm" onclick="openHouseTemplateEditor(\'' + house.id + '\')">إدارة</button>';
        h += '<button class="btn btn-gray btn-sm" onclick="openHouseTemplateEditor(\'' + house.id + '\')">تعديل</button>';
        }
        if (canEditContent) {
        h += '<button class="btn btn-teal btn-sm" onclick="duplicateHouseTemplate(\'' + house.id + '\')">نسخ</button>';
        }
        if (canEditContent) {
        h += '<button class="btn btn-red btn-sm" onclick="deleteHouseTemplate(\'' + house.id + '\')">حذف</button>';
        }
  h += '</div>';
  h += '</div>';

  if (canEditContent) {
    h += '<div class="house-template-create-actions">';
    h += '<button class="btn btn-purple btn-sm" onclick="openTemplateFloorModal(\'' + house.id + '\', null)">➕ إضافة دور</button>';
    h += '<button class="btn btn-blue btn-sm" onclick="openTemplateRoomModal(\'' + house.id + '\', null, null)">➕ إضافة غرفة</button>';
    h += '</div>';
  } else {
    h += '<div class="settings-summary-note">قالب مشترك — للعرض والاستخدام فقط</div>';
  }

  if (!house.floors || !house.floors.length) {
    h += '<div style="color:#AAB5C0;padding:12px;font-size:11px">لا توجد أدوار داخل هذا البيت بعد</div>';
    return h;
  }

  h += '<div class="house-template-floors">';
  house.floors.forEach(function(floor) {
    h += '<div class="house-floor-accordion">';
    h += '<div class="house-floor-header">';
    h += '<button type="button" class="settings-branding-toggle house-floor-toggle" aria-expanded="false" onclick="var content=this.parentNode.nextElementSibling;var isOpen=content.classList.toggle(\'settings-branding-content-open\');content.setAttribute(\'aria-hidden\',isOpen?\'false\':\'true\');this.setAttribute(\'aria-expanded\',isOpen?\'true\':\'false\');this.querySelector(\'.settings-branding-toggle-arrow\').textContent=isOpen?\'▲\':\'▼\'"><span>' + esc(floor.name || 'دور غير مسمى') + ' <b class="settings-count-badge">' + ((floor.rooms || []).length) + ' غرف</b></span><span class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button>';
    h += '<div class="house-floor-actions">';
    if (canEditContent) {
    h += '<button class="btn btn-blue btn-sm" onclick="ht_addRoomToTemplate(\'' + house.id + '\', \'' + floor.id + '\')">➕ غرفة</button>';
    h += '<button class="btn btn-gray btn-sm" onclick="ht_editFloorName(\'' + house.id + '\', \'' + floor.id + '\')">تعديل</button>';
    h += '<button class="btn btn-red btn-sm" onclick="ht_deleteFloorFromTemplate(\'' + house.id + '\', \'' + floor.id + '\')">حذف</button>';
    }
    h += '</div></div>';
    h += '<div class="settings-branding-content house-floor-content" aria-hidden="true">';

    if (floor.rooms && floor.rooms.length) {
      h += '<div class="house-rooms-grid">';
      floor.rooms.forEach(function(room) {
        h += '<div class="house-room-card">';
        h += '<div class="house-room-info">';
        h += '<div class="house-room-number">غرفة ' + esc(room.number || '') + '</div>';
        h += '<div class="house-room-beds">' + (parseInt(room.beds, 10) || 1) + ' أسرة</div>';
        if (room.closed) {
          h += '<div style="font-size:10px;color:#C0392B;margin-top:2px">مغلقة' + (room.closedDay ? ' من يوم ' + esc(room.closedDay) : '') + '</div>';
        }
        if (room.notes) {
          h += '<div style="font-size:10px;color:#7D4E00;margin-top:2px">' + esc(room.notes) + '</div>';
        }
        h += '</div>';
        h += '<div class="house-room-actions">';
        if (canEditContent) {
        h += '<button class="btn btn-gray btn-sm" onclick="openTemplateRoomModal(\'' + house.id + '\', \'' + floor.id + '\', \'' + room.id + '\')">تعديل</button>';
        h += '<button class="btn btn-red btn-sm" onclick="ht_deleteRoomFromTemplate(\'' + house.id + '\', \'' + floor.id + '\', \'' + room.id + '\')">حذف</button>';
        }
        h += '</div>';
        h += '</div>';
      });
      h += '</div>';
    } else {
      h += '<div style="color:#AAB5C0;font-size:11px;padding:4px 0">لا توجد غرف في هذا الدور</div>';
    }
    h += '</div></div>';
  });
  h += '</div>';

  return h;
}

function getHouseTemplateRooms(house){
  var rooms=[];
  (house&&house.floors||[]).forEach(function(floor){
    (floor.rooms||[]).forEach(function(room){rooms.push(room)});
  });
  return rooms;
}

function renderRoomTypeStatCards(rooms,includeTotal){
  var summary=buildRoomTypeSummary(rooms);
  var icons={
    single:'1️⃣',
    double:'2️⃣',
    triple:'3️⃣',
    quadruple:'4️⃣',
    quintuple:'5️⃣',
    sextuple:'6️⃣',
    sevenPlus:'7️⃣'
  };
  var h='<div class="house-templates-heading-stats" dir="rtl" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;width:100%">';
  if(includeTotal){
    h+='<div class="house-heading-stat-card"><span class="house-heading-stat-icon">🚪</span><span class="house-heading-stat-label">إجمالي الغرف</span><strong>'+summary.counts.total+'</strong></div>';
  }
  summary.items.forEach(function(item){
    if(!item.count||item.key==='unknown')return;
    h+='<div class="house-heading-stat-card"><span class="house-heading-stat-icon">'+icons[item.key]+'</span><span class="house-heading-stat-label">'+item.label+'</span><strong>'+item.count+'</strong></div>';
  });
  h+='</div>';
  return h;
}

// ═══════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════
var LAST_APPLICATION_TAB_KEY = browserStorageNamespace.key(
  'conference_manager_last_tab'
);
var APPLICATION_VIEW_KEY = browserStorageNamespace.key(
  'conference_manager_view'
);
var SETTINGS_INTERNAL_VIEW_KEY = browserStorageNamespace.key(
  'conference_manager_settings_internal_view'
);
var currentApplicationView = 'application';

function getValidApplicationTabIds(){
  return [0, 1, 2, 3, 4, 5, 6];
}

function normalizeLegacyApplicationTabId(tabId){
  var parsedTabId=typeof tabId==='number'?tabId:parseInt(tabId,10);
  if(!isFinite(parsedTabId))return null;
  // Legacy mapping: 2(Restaurant)->2(Accounts), 3(Search)->5(Search), 4(Cards)->4(Cards), 5(Settings)->6(Settings), 6(Accounts)->2(Accounts), 7(Reports)->3(Reports)
  if (parsedTabId === 2) return 2; // Restaurant/Accounts -> Accounts
  if (parsedTabId === 3) return 5; // Search -> Search
  if (parsedTabId === 4) return 4; // Cards -> Cards
  if (parsedTabId === 5) return 6; // Settings -> Settings
  if (parsedTabId === 6) return 2; // Accounts -> Accounts
  if (parsedTabId === 7) return 3; // Reports -> Reports
  return getValidApplicationTabIds().indexOf(parsedTabId) > -1 ? parsedTabId : null;
}

function isValidApplicationTab(tabId){
  var parsedTabId = typeof tabId === 'number'
    ? tabId
    : parseInt(tabId, 10);

  if(!isFinite(parsedTabId)) return false;
  if (getValidApplicationTabIds().indexOf(parsedTabId) === -1) return false;
  var tabButton = document.querySelectorAll('.tab')[parsedTabId];
  var tabContent = ge('tab' + parsedTabId);
  return !!(tabButton && tabContent && !tabButton.hidden && tabButton.style.display !== 'none' && !tabContent.hidden);
}

function getStoredLastTab(){
  try {
    var storedTab = localStorage.getItem(LAST_APPLICATION_TAB_KEY);
    var parsedTabId = parseInt(storedTab, 10);
    return isValidApplicationTab(parsedTabId) ? parsedTabId : null;
  } catch (e) {
    return null;
  }
}

function saveLastTab(tabId){
  if (!isValidApplicationTab(tabId)) return;
  try {
    localStorage.setItem(LAST_APPLICATION_TAB_KEY, String(tabId));
  } catch (e) {}
}

function getStoredApplicationView(){
  try{
    var storedView=localStorage.getItem(APPLICATION_VIEW_KEY);
    if(storedView==='startup'||storedView==='application')return storedView;
    if(localStorage.getItem(LAST_APPLICATION_TAB_KEY)==='home')return 'startup';
  }catch(e){}
  return 'application';
}

function saveApplicationView(view){
  if(view!=='startup'&&view!=='application')return;
  currentApplicationView=view;
  try{
    localStorage.setItem(APPLICATION_VIEW_KEY,view);
  }catch(e){}
}

function getStoredSettingsInternalView(){
  try{
    return localStorage.getItem(SETTINGS_INTERNAL_VIEW_KEY)==='organization-members'
      ?'organization-members':'';
  }catch(e){return '';}
}

function saveSettingsInternalView(view){
  try{
    if(view==='organization-members')localStorage.setItem(SETTINGS_INTERNAL_VIEW_KEY,view);
    else localStorage.removeItem(SETTINGS_INTERNAL_VIEW_KEY);
  }catch(e){}
}

function restoreLastApplicationTab(){
  var storedTab = getStoredLastTab();
  var restoredTab=storedTab===null?0:storedTab;
  var settingsTabId=getApplicationTabIdByName('settings');
  if(restoredTab===settingsTabId){
    settingsTab=getStoredSettingsInternalView()||'general';
  }
  var restored=switchTab(restoredTab);
  if(!restored)switchTab(0);
  if(restored&&restoredTab===settingsTabId){
    resetAdministrativeViewScroll();
    if(settingsTab==='organization-members')refreshOrganizationMembersSection();
  }
}

function resetAdministrativeViewScroll(){
  if(typeof window.scrollTo!=='function')return;
  try{window.scrollTo({top:0,left:0,behavior:'auto'});}catch(error){window.scrollTo(0,0);}
}

function switchTab(n){
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  var tabId = typeof n === 'number' ? n : parseInt(n, 10);
  if (!isValidApplicationTab(tabId)) return false;
  var settingsTabId=getApplicationTabIdByName('settings');
  if(tabId!==settingsTabId&&window.ConferenceTemplateHousesEditor){
    window.ConferenceTemplateHousesEditor.close();
  }
  if(!getCurrentConference()&&tabId!==settingsTabId){
    showToast('يرجى اختيار مؤتمر أو إنشاء مؤتمر جديد أولًا.','#E67E22');
    return false;
  }
  var previousTab=currentTab;
  closeOrganizationManagementScreen();
  currentTab=tabId;
  document.body.classList.toggle('accommodation-shell-active',tabId===0);
  if(tabId===2&&previousTab!==2)v3AccordionOpenSection='';
  saveApplicationView('application');
  var homeTabButton = ge('homeTabButton');
  if(homeTabButton) homeTabButton.classList.remove('active', 'main-tab-active');
  document.querySelectorAll('.tab').forEach(function(t,i){t.className='tab main-tab'+(i===tabId?' active main-tab-active':'')});
  getValidApplicationTabIds().forEach(function(id){ge('tab'+id).style.display=id===tabId?'':'none';});
  renderTab(tabId);
  saveLastTab(tabId);
  return true;
}

function getApplicationTabIdByName(tabName){
  var tabButton=document.querySelector('.tab[data-tab-name="'+tabName+'"]');
  if(!tabButton)return null;
  var tabId=parseInt(tabButton.getAttribute('data-tab-id'),10);
  return isValidApplicationTab(tabId)?tabId:null;
}

/*
يفتح الإعدادات من شاشة البداية عند وجود مؤتمر محدد.
لا ينفذ منطق عرض مستقل، ويعتمد على مسار التطبيق المركزي
من خلال setApplicationMode() ثم يفتح التبويب عبر switchTab().
*/
function openSettingsFromHome(){
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  var settingsTabId=getApplicationTabIdByName('settings');
  if(settingsTabId===null)return false;
  setApplicationMode('application');
  var opened=switchTab(settingsTabId);
  if(opened)resetAdministrativeViewScroll();
  return opened;
}

function openOrganizationMembersFromManagement(organizationId){
  var ui=window.OrganizationMembersUI;
  if(!ui||typeof ui.initializeAndSelect!=='function')return false;
  settingsTab='organization-members';
  if(!openSettingsFromHome())return false;
  saveSettingsInternalView('organization-members');
  return ui.initializeAndSelect(String(organizationId||''));
}

function returnToOrganizationManagementFromMembers(){
  settingsTab='general';
  saveSettingsInternalView('');
  return window.OrganizationManagementUI&&
    typeof window.OrganizationManagementUI.open==='function'
    ?window.OrganizationManagementUI.open({returnView:'settings'}):false;
}

function showHomePage(){
  return openStartupScreen({clearCurrentConference:false,persistView:true});
}
function renderTab(n){
  renderGlobalConferenceHeader();
  if (n === 0) renderAccommodation();
  else if (n === 1) renderTransports();
  else if (n === 2) renderAccounts();
  else if (n === 3) renderV3Reports();
  else if (n === 4) renderCards();
  else if (n === 5) renderSearch();
  else if (n === 6) renderSettings();
}

function getAccommodationPricingModeLabel(mode){
  var labels={
    per_person_night:'Person Night',
    per_room_night:'Room Night',
    per_person_day:'لكل شخص في اليوم',
    per_room_day:'لكل غرفة في اليوم',
    fixed_package:'باقة ثابتة',
    per_day_package:'باقة يومية',
    room_type:'حسب نوع الغرفة'
  };
  return labels[mode]||'غير محدد';
}

function getAirConditioningPricingModeLabel(mode){
  var labels={
    per_person_day:'لكل شخص في اليوم',
    per_room_day:'لكل غرفة في اليوم',
    per_unit_day:'لكل جهاز في اليوم',
    fixed_package:'باقة ثابتة',
    per_day_package:'باقة يومية',
    included:'مشمول'
  };
  return labels[mode]||'غير محدد';
}

function getV3ReportsContext(conference){
  conference=conference||getCurrentConference();
  return {
    conference:conference,
    mealSummary:calculateMealSummary(conference),
    accommodationSummary:calculateAccommodationSummary(conference),
    airConditioningSummary:calculateAirConditioningSummary(conference),
    financialSummary:calculateFinancialV3Summary(conference)
  };
}

function renderV3ReportsTopCards(context){
  var financial=context.financialSummary;
  var html='<div class="settings-summary-grid reports-v3-top-grid">';
  [
    ['الإقامة',financial.accommodationTotal,getAccommodationPricingModeLabel(financial.breakdown.accommodation.pricingMode)],
    ['المطعم',financial.restaurantTotal,'حسب الوجبات المجدولة'],
    ['التكييف',financial.airConditioningTotal,getAirConditioningPricingModeLabel(financial.breakdown.airConditioning.pricingMode)],
    ['الإجمالي النهائي',financial.grandTotal,'بعد الإضافات والخصومات','reports-v3-top-card-final']
  ].forEach(function(card){
    html+='<div class="reports-v3-top-card '+(card[3]||'')+'"><span>'+esc(card[0])+'</span><strong>'+formatAccountMoney(card[1])+'</strong><small>'+esc(card[2])+'</small></div>';
  });
  html+='</div>';
  return html;
}

function renderV3FinancialSummaryReport(context){
  var financial=context.financialSummary;
  var html='<section class="settings-section reports-v3-section reports-v3-financial-summary">';
  html+='<div class="settings-section-title">الملخص المالي</div>';
  html+='<div class="reports-v3-secondary-grid">';
  [
    ['المجموع قبل التعديلات',financial.subtotal],
    ['إجمالي الإضافات',financial.additionsTotal],
    ['إجمالي الخصومات',financial.deductionsTotal]
  ].forEach(function(item){
    html+='<div class="reports-v3-secondary-item"><span>'+esc(item[0])+'</span><strong>'+formatAccountMoney(item[1])+'</strong></div>';
  });
  html+='</div></section>';
  return html;
}

function renderV3AccommodationReport(context){
  var summary=context.accommodationSummary;
  var financial=context.financialSummary;
  var html='<section class="settings-section reports-v3-section">';
  html+='<div class="settings-section-title">تقرير الإقامة</div>';
  html+='<div class="reports-v3-result-card"><span>إجمالي تكلفة الإقامة</span><strong>'+formatAccountMoney(summary.totalCost)+'</strong></div>';
  html+='<div class="reports-v3-metrics-grid">';
  [
    ['عدد الأشخاص',summary.totalPersons],
    ['Person Nights',summary.totalPersonNights],
    ['Person Days',summary.totalPersonDays],
    ['Room Nights',summary.roomNights],
    ['Room Days',summary.roomDays],
    ['نسبة الإشغال',Math.round((summary.occupancyRate||0)*100)/100+'%'],
    ['طريقة التسعير',getAccommodationPricingModeLabel(financial.breakdown.accommodation.pricingMode)]
  ].forEach(function(item){
    html+='<div class="reports-v3-metric"><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>';
  });
  html+='</div>';
  html+='<div class="card reports-v3-subcard"><div class="card-title">جدول الليالي</div><div class="reports-v3-table-scroll"><table><thead><tr><th>الليلة</th><th>من</th><th>إلى</th><th>الأشخاص</th><th>الغرف المشغولة</th><th>نسبة الإشغال</th><th>التكلفة</th></tr></thead><tbody>';
  if(!(summary.dailySummary||[]).length){
    html+='<tr><td colspan="7" class="settings-empty-state">لا توجد ليالٍ في جدول المؤتمر.</td></tr>';
  }else{
    summary.dailySummary.forEach(function(item){
      html+='<tr><td>ليلة '+item.night+'</td><td>'+esc(formatConferenceScheduleDate(item.date))+'</td><td>'+esc(formatConferenceScheduleDate(item.nextDate))+'</td><td>'+item.persons+'</td><td>'+item.occupiedRooms+'</td><td>'+Math.round((item.occupancyRate||0)*100)/100+'%</td><td>'+formatAccountMoney(item.cost)+'</td></tr>';
    });
  }
  html+='</tbody></table></div></div>';
  html+='<div class="card reports-v3-subcard"><div class="card-title">جدول الأيام</div><div class="reports-v3-table-scroll"><table><thead><tr><th>اليوم</th><th>التاريخ</th><th>الأشخاص</th><th>الغرف المشغولة</th><th>التكلفة</th></tr></thead><tbody>';
  if(!(summary.daySummary||[]).length){
    html+='<tr><td colspan="5" class="settings-empty-state">لا توجد أيام في جدول المؤتمر.</td></tr>';
  }else{
    summary.daySummary.forEach(function(item){
      html+='<tr><td>اليوم '+item.dayNumber+'</td><td>'+esc(formatConferenceScheduleDate(item.date))+'</td><td>'+item.persons+'</td><td>'+item.occupiedRooms+'</td><td>'+formatAccountMoney(item.cost)+'</td></tr>';
    });
  }
  html+='</tbody></table></div></div>';
  html+='</section>';
  return html;
}

function renderV3AirConditioningReport(context){
  var summary=context.airConditioningSummary;
  var html='<section class="settings-section reports-v3-section">';
  html+='<div class="settings-section-title">تقرير التكييف</div>';
  html+='<div class="reports-v3-result-card"><span>إجمالي التكييف</span><strong>'+formatAccountMoney(summary.totalCost)+'</strong></div>';
  html+='<div class="reports-v3-metrics-grid">';
  [
    ['Person Days',summary.totalPersonDays],
    ['Room Days',summary.totalRoomDays],
    ['Unit Days',summary.totalUnitDays],
    ['طريقة التسعير',getAirConditioningPricingModeLabel(summary.pricingMode)]
  ].forEach(function(item){
    html+='<div class="reports-v3-metric"><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>';
  });
  html+='</div>';
  html+='<div class="card reports-v3-subcard"><div class="card-title">جدول الأيام</div><div class="reports-v3-table-scroll"><table><thead><tr><th>اليوم</th><th>التاريخ</th><th>الأشخاص</th><th>الغرف</th><th>الأجهزة</th><th>التكلفة</th></tr></thead><tbody>';
  if(!(summary.daySummary||[]).length){
    html+='<tr><td colspan="6" class="settings-empty-state">لا توجد أيام في جدول المؤتمر.</td></tr>';
  }else{
    summary.daySummary.forEach(function(item){
      html+='<tr><td>اليوم '+item.dayNumber+'</td><td>'+esc(formatConferenceScheduleDate(item.date))+'</td><td>'+item.persons+'</td><td>'+item.rooms+'</td><td>'+item.units+'</td><td>'+formatAccountMoney(item.cost)+'</td></tr>';
    });
  }
  html+='</tbody></table></div></div>';
  html+='</section>';
  return html;
}

function renderV3RestaurantReport(context){
  var summary=context.mealSummary;
  var financial=context.financialSummary;
  var html='<section class="settings-section reports-v3-section">';
  html+='<div class="settings-section-title">تقرير المطعم</div>';
  html+='<div class="reports-v3-result-card"><span>الإجمالي النهائي</span><strong>'+formatAccountMoney(summary.grandTotal)+'</strong></div>';
  html+='<div class="reports-v3-metrics-grid">';
  [
    ['عدد الوجبات',financial.breakdown.restaurant.totalMeals],
    ['إجمالي الإفطار',formatAccountMoney(summary.mealTotals.breakfast||0)],
    ['إجمالي الغداء',formatAccountMoney(summary.mealTotals.lunch||0)],
    ['إجمالي العشاء',formatAccountMoney(summary.mealTotals.dinner||0)]
  ].forEach(function(item){
    html+='<div class="reports-v3-metric"><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>';
  });
  html+='</div>';
  html+='<div class="card reports-v3-subcard"><div class="card-title">جدول الوجبات الحالي</div><div class="reports-v3-table-scroll"><table><thead><tr><th>اليوم</th><th>التاريخ</th><th>الإفطار</th><th>الغداء</th><th>العشاء</th><th>إجمالي اليوم</th></tr></thead><tbody>';
  if(!(summary.days||[]).length){
    html+='<tr><td colspan="6" class="settings-empty-state">لا توجد بيانات وجبات حالية.</td></tr>';
  }else{
    summary.days.forEach(function(day){
      html+='<tr><td>اليوم '+day.day+'</td><td>'+esc(formatConferenceScheduleDate(day.date))+'</td><td>'+formatAccountMoney(day.meals.breakfast.total)+'<div class="reports-v3-cell-note">'+day.meals.breakfast.finalCount+' × '+formatAccountMoney(day.meals.breakfast.price)+'</div></td><td>'+formatAccountMoney(day.meals.lunch.total)+'<div class="reports-v3-cell-note">'+day.meals.lunch.finalCount+' × '+formatAccountMoney(day.meals.lunch.price)+'</div></td><td>'+formatAccountMoney(day.meals.dinner.total)+'<div class="reports-v3-cell-note">'+day.meals.dinner.finalCount+' × '+formatAccountMoney(day.meals.dinner.price)+'</div></td><td>'+formatAccountMoney(day.total)+'</td></tr>';
    });
  }
  html+='</tbody></table></div></div>';
  html+='</section>';
  return html;
}

function renderV3ReportsActions(){
  return '<div class="settings-branding-actions no-print reports-v3-actions">'+
    '<button class="btn btn-green" onclick="printV3Reports()">🖨️ طباعة التقرير</button>'+
    '<button class="btn btn-blue" onclick="saveV3ReportsPdf()">📄 حفظ PDF</button>'+
    '<button class="btn btn-purple" onclick="exportV3ReportsExcel()">📊 تصدير Excel</button>'+
  '</div>';
}

function renderV3Reports(){
  var container=ge('tab3');
  if(!container)return;
  var conference=getCurrentConference();
  if(!conference){
    container.innerHTML='<div class="settings-dashboard"><div class="settings-empty-state">لا توجد بيانات مؤتمر جاهزة حاليًا.</div></div>';
    return;
  }
  var context=getV3ReportsContext(conference);
  var conferenceName=(conference.conf&&conference.conf.name)||conference.name||'المؤتمر';
  var periodText=getV3ReportsPeriodText(conference);
  var html='<div id="v3ReportsPage" class="settings-dashboard reports-v3-dashboard">';
  html+='<section class="settings-section reports-v3-hero"><div class="reports-v3-header"><div><div class="settings-section-title">تقارير الحسابات</div><div class="reports-v3-header-meta"><span>'+esc(conferenceName)+'</span><span>'+esc(periodText)+'</span></div></div>';
  html+=renderV3ReportsActions();
  html+='</div>';
  html+=renderV3ReportsTopCards(context);
  html+='</section>';
  html+=renderV3FinancialSummaryReport(context);
  html+=renderV3AccommodationReport(context);
  html+=renderV3RestaurantReport(context);
  html+=renderV3AirConditioningReport(context);
  html+='</div>';
  container.innerHTML=html;
}

function buildV3ReportsPrintDocument(title){
  var reportPage=ge('v3ReportsPage');
  if(!reportPage)return '';
  return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>'+esc(title)+'</title><link rel="stylesheet" href="style.css"><style>body{background:#fff;padding:18px} .no-print{display:none!important} .reports-v3-dashboard{gap:12px} .reports-v3-section,.reports-v3-hero,.settings-section{box-shadow:none;border:1px solid #dce7f0} table{page-break-inside:auto} tr{page-break-inside:avoid} .reports-v3-top-grid{grid-template-columns:repeat(4,minmax(120px,1fr))} @media print{body{padding:0} .reports-v3-hero,.reports-v3-section,.settings-section{break-inside:avoid}}</style></head><body>'+reportPage.outerHTML+'</body></html>';
}

function openV3ReportsPrintWindow(title){
  var printHtml=buildV3ReportsPrintDocument(title);
  if(!printHtml)return null;
  var printWindow=window.open('','_blank','width=1200,height=900');
  if(!printWindow){
    showToast('تعذر فتح نافذة الطباعة.','#E74C3C');
    return null;
  }
  printWindow.document.open();
  printWindow.document.write(printHtml);
  printWindow.document.close();
  return printWindow;
}

function printV3Reports(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('printV3Reports',null))return false;
  var printWindow=openV3ReportsPrintWindow('تقارير الحسابات');
  if(!printWindow)return false;
  printWindow.focus();
  printWindow.onload=function(){printWindow.print();};
  return true;
}

function getV3ReportsPeriodText(conference){
  conference=conference||getCurrentConference();
  if(!conference)return '-';
  var startDate=conference.startDate||(conference.conf&&conference.conf.startDate)||'';
  var endDate=conference.endDate||(conference.conf&&conference.conf.endDate)||'';
  if(!startDate&&!endDate)return '-';
  return formatConferenceScheduleDate(startDate||'-')+' - '+formatConferenceScheduleDate(endDate||'-');
}

function buildV3ReportsPdfHeaderHtml(conference,generatedAtText){
  var conferenceName=esc((conference&&((conference.conf&&conference.conf.name)||conference.name))||'المؤتمر');
  var periodText=esc(getV3ReportsPeriodText(conference));
  var generatedAt=esc(generatedAtText||'');
  return '<section class="settings-section reports-v3-section reports-v3-pdf-meta" style="margin-bottom:10px">'+
    '<div class="settings-section-title">تقرير الحسابات</div>'+
    '<div class="settings-summary-grid" style="grid-template-columns:repeat(3,minmax(160px,1fr))">'+
      '<div class="settings-summary-card"><span>اسم المؤتمر</span><strong style="direction:rtl">'+conferenceName+'</strong></div>'+
      '<div class="settings-summary-card"><span>الفترة</span><strong style="direction:rtl">'+periodText+'</strong></div>'+
      '<div class="settings-summary-card"><span>تاريخ إنشاء التقرير</span><strong style="direction:rtl">'+generatedAt+'</strong></div>'+
    '</div>'+
  '</section>';
}

function createV3ReportsPdfStage(){
  var reportPage=ge('v3ReportsPage');
  var conference=getCurrentConference();
  if(!reportPage||!conference)return null;
  var generatedAtText=(new Date()).toLocaleString('ar-EG');
  var stage=document.createElement('div');
  var wrapper=document.createElement('div');
  var clone=reportPage.cloneNode(true);
  stage.setAttribute('aria-hidden','true');
  stage.style.cssText='position:fixed;left:-10000px;top:0;width:1122px;max-width:none;padding:0;margin:0;background:#ffffff;z-index:-1;overflow:visible;';
  wrapper.style.cssText='width:1122px;max-width:none;padding:20px;background:#ffffff;direction:rtl;';
  clone.id='v3ReportsPdfPage';
  clone.style.width='100%';
  clone.style.maxWidth='none';
  clone.style.margin='0';
  clone.querySelectorAll('.no-print').forEach(function(element){element.remove()});
  Array.prototype.forEach.call(clone.children,function(child){
    if(child&&child.classList)child.classList.add('reports-v3-pdf-section');
  });
  var headerHost=document.createElement('div');
  headerHost.innerHTML=buildV3ReportsPdfHeaderHtml(conference,generatedAtText);
  wrapper.appendChild(headerHost.firstChild);
  wrapper.appendChild(clone);
  stage.appendChild(wrapper);
  document.body.appendChild(stage);
  return {
    stage:stage,
    wrapper:wrapper,
    reportNode:clone,
    conference:conference,
    generatedAtText:generatedAtText
  };
}

function removeV3ReportsPdfStage(stageState){
  if(stageState&&stageState.stage&&stageState.stage.parentNode){
    stageState.stage.parentNode.removeChild(stageState.stage);
  }
}

function captureElementAsCanvas(element,options){
  if(typeof html2canvas!=='function')return Promise.reject(new Error('html2canvas unavailable'));
  if(!element)return Promise.reject(new Error('element unavailable'));
  return waitForCardCaptureAssets(element).then(function(){
    return html2canvas(element,{
      scale:2,
      backgroundColor:'#ffffff',
      useCORS:true,
      logging:false,
      scrollX:0,
      scrollY:0,
      windowWidth:element.scrollWidth||1122,
      windowHeight:element.scrollHeight||element.offsetHeight||0
    });
  }).then(function(canvas){
    if(!options||!options.trim)return canvas;
    var bounds=element.getBoundingClientRect();
    var cropWidth=Math.min(canvas.width,Math.ceil((element.scrollWidth||bounds.width||canvas.width)*(canvas.width/Math.max(1,bounds.width||element.scrollWidth||canvas.width))));
    if(cropWidth>=canvas.width)return canvas;
    var cropped=document.createElement('canvas');
    cropped.width=cropWidth;
    cropped.height=canvas.height;
    var context=cropped.getContext('2d');
    if(!context)return canvas;
    context.drawImage(canvas,0,0,cropWidth,canvas.height,0,0,cropWidth,canvas.height);
    return cropped;
  });
}

function captureV3ReportsSectionCanvases(stageState){
  var sections=[];
  if(stageState&&stageState.wrapper){
    stageState.wrapper.querySelectorAll('.reports-v3-pdf-meta,.reports-v3-hero,.reports-v3-section').forEach(function(section){
      sections.push(section);
    });
  }
  return sections.reduce(function(chain,section){
    return chain.then(function(results){
      return captureElementAsCanvas(section,{trim:true}).then(function(canvas){
        results.push(canvas);
        return results;
      });
    });
  },Promise.resolve([]));
}

function createBlankPdfPageCanvas(width,height){
  var canvas=document.createElement('canvas');
  canvas.width=width;
  canvas.height=height;
  var context=canvas.getContext('2d');
  if(context){
    context.fillStyle='#ffffff';
    context.fillRect(0,0,width,height);
  }
  return canvas;
}

function sliceCanvasVertically(sourceCanvas,startY,height){
  var slice=document.createElement('canvas');
  slice.width=sourceCanvas.width;
  slice.height=height;
  var context=slice.getContext('2d');
  if(context){
    context.fillStyle='#ffffff';
    context.fillRect(0,0,slice.width,slice.height);
    context.drawImage(sourceCanvas,0,startY,sourceCanvas.width,height,0,0,sourceCanvas.width,height);
  }
  return slice;
}

function buildV3ReportsPdfPageCanvases(sectionCanvases){
  var pageWidth=1240;
  var pageHeight=1754;
  var pageMargin=48;
  var pageGap=18;
  var contentWidth=pageWidth-pageMargin*2;
  var contentHeight=pageHeight-pageMargin*2;
  var pages=[];
  var currentPage=createBlankPdfPageCanvas(pageWidth,pageHeight);
  var currentContext=currentPage.getContext('2d');
  var currentY=pageMargin;
  function pushCurrentPage(){
    pages.push(currentPage);
    currentPage=createBlankPdfPageCanvas(pageWidth,pageHeight);
    currentContext=currentPage.getContext('2d');
    currentY=pageMargin;
  }
  sectionCanvases.forEach(function(sectionCanvas){
    if(!sectionCanvas||!currentContext)return;
    var sectionScale=contentWidth/Math.max(1,sectionCanvas.width);
    var renderedHeight=sectionCanvas.height*sectionScale;
    if(renderedHeight<=contentHeight){
      if(currentY>pageMargin&&currentY+renderedHeight>pageHeight-pageMargin){
        pushCurrentPage();
      }
      currentContext.drawImage(sectionCanvas,pageMargin,currentY,contentWidth,renderedHeight);
      currentY+=renderedHeight+pageGap;
      return;
    }
    if(currentY>pageMargin)pushCurrentPage();
    var maxSourceSliceHeight=Math.max(1,Math.floor(contentHeight/sectionScale));
    for(var offsetY=0;offsetY<sectionCanvas.height;offsetY+=maxSourceSliceHeight){
      var sliceHeight=Math.min(maxSourceSliceHeight,sectionCanvas.height-offsetY);
      var sliceCanvas=sliceCanvasVertically(sectionCanvas,offsetY,sliceHeight);
      var sliceRenderedHeight=sliceHeight*sectionScale;
      currentContext.drawImage(sliceCanvas,pageMargin,pageMargin,contentWidth,sliceRenderedHeight);
      offsetY+sliceHeight<sectionCanvas.height?pushCurrentPage():currentY=pageMargin+sliceRenderedHeight+pageGap;
    }
  });
  if(currentY>pageMargin||!pages.length)pages.push(currentPage);
  return pages;
}

function canvasToJpegBytes(canvas,quality){
  var dataUrl=canvas.toDataURL('image/jpeg',quality||0.95);
  var base64=dataUrl.split(',')[1]||'';
  var binary=atob(base64);
  var bytes=new Uint8Array(binary.length);
  for(var index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
}

function concatenatePdfByteParts(parts){
  var totalLength=0;
  parts.forEach(function(part){totalLength+=part.length});
  var combined=new Uint8Array(totalLength);
  var offset=0;
  parts.forEach(function(part){combined.set(part,offset);offset+=part.length});
  return combined;
}

function encodePdfString(value){
  return new TextEncoder().encode(String(value));
}

function buildSimplePdfFromJpegPages(pageImages){
  var pageWidthPt=595.28;
  var pageHeightPt=841.89;
  var objectCount=2+pageImages.length*3;
  var objectBodies=new Array(objectCount+1);
  var catalogId=1;
  var pagesId=2;
  var pageIds=[];
  var contentIds=[];
  var imageIds=[];
  pageImages.forEach(function(pageImage,pageIndex){
    imageIds[pageIndex]=3+pageIndex*3;
    contentIds[pageIndex]=4+pageIndex*3;
    pageIds[pageIndex]=5+pageIndex*3;
  });
  pageImages.forEach(function(pageImage,pageIndex){
    var imageId=imageIds[pageIndex];
    var contentId=contentIds[pageIndex];
    var pageId=pageIds[pageIndex];
    var imageHeader='<< /Type /XObject /Subtype /Image /Width '+pageImage.width+' /Height '+pageImage.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+pageImage.bytes.length+' >>\nstream\n';
    var imageFooter='\nendstream';
    objectBodies[imageId]=concatenatePdfByteParts([encodePdfString(imageHeader),pageImage.bytes,encodePdfString(imageFooter)]);
    var contentStream='q\n'+pageWidthPt+' 0 0 '+pageHeightPt+' 0 0 cm\n/Im'+(pageIndex+1)+' Do\nQ';
    var contentHeader='<< /Length '+contentStream.length+' >>\nstream\n';
    objectBodies[contentId]=encodePdfString(contentHeader+contentStream+'\nendstream');
    objectBodies[pageId]=encodePdfString('<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 '+pageWidthPt+' '+pageHeightPt+'] /Resources << /XObject << /Im'+(pageIndex+1)+' '+imageId+' 0 R >> >> /Contents '+contentId+' 0 R >>');
  });
  objectBodies[catalogId]=encodePdfString('<< /Type /Catalog /Pages '+pagesId+' 0 R >>');
  objectBodies[pagesId]=encodePdfString('<< /Type /Pages /Count '+pageIds.length+' /Kids ['+pageIds.map(function(id){return id+' 0 R'}).join(' ')+'] >>');
  var parts=[encodePdfString('%PDF-1.4\n% Generated offline\n')];
  var offsets=new Array(objectCount+1);
  var currentLength=parts[0].length;
  for(var objectId=1;objectId<=objectCount;objectId++){
    offsets[objectId]=currentLength;
    var prefix=encodePdfString(objectId+' 0 obj\n');
    var suffix=encodePdfString('\nendobj\n');
    parts.push(prefix);
    parts.push(objectBodies[objectId]);
    parts.push(suffix);
    currentLength+=prefix.length+objectBodies[objectId].length+suffix.length;
  }
  var xrefOffset=currentLength;
  var xref='xref\n0 '+(objectCount+1)+'\n0000000000 65535 f \n';
  for(var entryIndex=1;entryIndex<=objectCount;entryIndex++){
    xref+=String(offsets[entryIndex]).padStart(10,'0')+' 00000 n \n';
  }
  var trailer='trailer\n<< /Size '+(objectCount+1)+' /Root '+catalogId+' 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF';
  parts.push(encodePdfString(xref+trailer));
  return concatenatePdfByteParts(parts);
}

function downloadV3ReportsPdfBlob(blob,fileName){
  var url=URL.createObjectURL(blob);
  var anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(function(){URL.revokeObjectURL(url)},1000);
}

function saveV3ReportsPdf(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveV3ReportsPdf',null))return false;
  if(typeof html2canvas!=='function'){
    showToast('تعذر إنشاء ملف PDF لأن مكتبة html2canvas غير متاحة محليًا.','#E74C3C');
    return false;
  }
  var stageState=createV3ReportsPdfStage();
  if(!stageState){
    showToast('تعذر تجهيز التقرير لإنشاء ملف PDF.','#E74C3C');
    return false;
  }
  showToast('جارٍ إنشاء ملف PDF...','#1F4E79');
  captureV3ReportsSectionCanvases(stageState).then(function(sectionCanvases){
    var pageCanvases=buildV3ReportsPdfPageCanvases(sectionCanvases);
    var pageImages=pageCanvases.map(function(canvas){
      return {
        width:canvas.width,
        height:canvas.height,
        bytes:canvasToJpegBytes(canvas,0.95)
      };
    });
    var pdfBytes=buildSimplePdfFromJpegPages(pageImages);
    var conferenceName=safeCardPngFilePart((stageState.conference&&((stageState.conference.conf&&stageState.conference.conf.name)||stageState.conference.name))||'المؤتمر','المؤتمر');
    var fileName='تقرير-الحسابات-'+conferenceName+'.pdf';
    downloadV3ReportsPdfBlob(new Blob([pdfBytes],{type:'application/pdf'}),fileName);
    removeV3ReportsPdfStage(stageState);
    showToast('تم إنشاء ملف PDF.');
  }).catch(function(error){
    removeV3ReportsPdfStage(stageState);
    if(typeof console!=='undefined'&&console.error)console.error('تعذر إنشاء PDF لتقارير الحسابات:',error);
    showToast('تعذر إنشاء ملف PDF.','#E74C3C');
  });
  return true;
}

function buildV3FinancialSummarySheet(context){
  var financial=context.financialSummary;
  return {
    name:'Financial Summary',
    rows:[
      ['Metric','Value'],
      ['Accommodation Total',financial.accommodationTotal],
      ['Air Conditioning Total',financial.airConditioningTotal],
      ['Restaurant Total',financial.restaurantTotal],
      ['Additions Total',financial.additionsTotal],
      ['Deductions Total',financial.deductionsTotal],
      ['Subtotal',financial.subtotal],
      ['Grand Total',financial.grandTotal]
    ]
  };
}

function buildV3AccommodationSheet(context){
  var summary=context.accommodationSummary;
  var financial=context.financialSummary;
  var rows=[
    ['Metric','Value'],
    ['Total Persons',summary.totalPersons],
    ['Person Nights',summary.totalPersonNights],
    ['Person Days',summary.totalPersonDays],
    ['Room Nights',summary.roomNights],
    ['Room Days',summary.roomDays],
    ['Occupancy Rate',Math.round((summary.occupancyRate||0)*100)/100],
    ['Pricing Mode',getAccommodationPricingModeLabel(financial.breakdown.accommodation.pricingMode)],
    ['Total Cost',summary.totalCost],
    [],
    ['Night','From','To','Persons','Occupied Rooms','Occupancy Rate','Cost']
  ];
  (summary.dailySummary||[]).forEach(function(item){
    rows.push([item.night,item.date,item.nextDate,item.persons,item.occupiedRooms,Math.round((item.occupancyRate||0)*100)/100,item.cost]);
  });
  rows.push([]);
  rows.push(['Day','Date','Persons','Occupied Rooms','Cost']);
  (summary.daySummary||[]).forEach(function(item){
    rows.push([item.dayNumber,item.date,item.persons,item.occupiedRooms,item.cost]);
  });
  return {name:'Accommodation',rows:rows};
}

function buildV3AirConditioningSheet(context){
  var summary=context.airConditioningSummary;
  var rows=[
    ['Metric','Value'],
    ['Person Days',summary.totalPersonDays],
    ['Room Days',summary.totalRoomDays],
    ['Unit Days',summary.totalUnitDays],
    ['Pricing Mode',getAirConditioningPricingModeLabel(summary.pricingMode)],
    ['Total Cost',summary.totalCost],
    [],
    ['Day','Date','Persons','Rooms','Units','Cost']
  ];
  (summary.daySummary||[]).forEach(function(item){
    rows.push([item.dayNumber,item.date,item.persons,item.rooms,item.units,item.cost]);
  });
  return {name:'Air Conditioning',rows:rows};
}

function buildV3RestaurantSheet(context){
  var summary=context.mealSummary;
  var financial=context.financialSummary;
  var rows=[
    ['Metric','Value'],
    ['Total Meals',financial.breakdown.restaurant.totalMeals],
    ['Breakfast Total',summary.mealTotals.breakfast||0],
    ['Lunch Total',summary.mealTotals.lunch||0],
    ['Dinner Total',summary.mealTotals.dinner||0],
    ['Grand Total',summary.grandTotal],
    [],
    ['Day','Date','Breakfast Total','Lunch Total','Dinner Total','Day Total']
  ];
  (summary.days||[]).forEach(function(day){
    rows.push([day.day,day.date,day.meals.breakfast.total,day.meals.lunch.total,day.meals.dinner.total,day.total]);
  });
  return {name:'Restaurant',rows:rows};
}

function exportV3ReportsExcel(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('exportV3ReportsExcel',null))return false;
  if(typeof XLSX==='undefined'||!XLSX.utils){
    showToast('مكتبة تصدير Excel غير متاحة محليًا.','#E74C3C');
    return false;
  }
  var conference=getCurrentConference();
  if(!conference)return false;
  var context=getV3ReportsContext(conference);
  var workbook=XLSX.utils.book_new();
  [
    buildV3FinancialSummarySheet(context),
    buildV3AccommodationSheet(context),
    buildV3AirConditioningSheet(context),
    buildV3RestaurantSheet(context)
  ].forEach(function(sheet){
    var worksheet=XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook,worksheet,sheet.name);
  });
  XLSX.writeFile(workbook,'V3_Reports_'+sanitizeFinancialReportExcelText((conference.name||'conference'))+'.xlsx',{compression:true});
  showToast('تم تصدير Excel.');
  return true;
}

// ═══════════════════════════════════════════════════════
// STATS BAR
// ═══════════════════════════════════════════════════════
function statsHtml(section){
  var current = getCurrentConference();
  if (!current) return '';
  var allRooms = getAllRooms();
  var activeC = 0;
  for (var i = 0; i < allRooms.length; i++) {
    if (!allRooms[i].closed) {
      activeC++;
    }
  }
  var closedC = allRooms.length - activeC;
  var ag=activeGuests();
  var extraBedChildren=allRooms.reduce(function(total,room){
    return total+(room.guests||[]).filter(function(guest){return !gl(guest)&&guest.bedType==='extra'&&guest.extraBedPersonType==='child'}).length;
  },0);
  var displayedAdults=Math.max(0,ag.adults.length-extraBedChildren);
  var displayedChildren=ag.children.length+extraBedChildren;
  var baseBeds=allRooms.reduce(function(a,r){return a+(parseInt(r.beds,10)||0)},0);
  var extraBeds=allRooms.reduce(function(a,r){return a+(parseInt(r.extraBeds,10)||0)},0);
  var totalBeds=baseBeds+extraBeds;
  var usedExtraBeds=allRooms.reduce(function(total,room){
    return total+(room.guests||[]).filter(function(guest){return !gl(guest)&&guest.bedType==='extra'}).length;
  },0);
  var availableExtraBeds=Math.max(0,extraBeds-usedExtraBeds);
  var activeOccupants=[];
  allRooms.forEach(function(room){activeOccupants=activeOccupants.concat(getAccommodationOccupants(room));});
  var occupiedRooms=allRooms.filter(function(room){return getAccommodationOccupants(room).length>0;}).length;
  var arrivedCount=activeOccupants.filter(function(person){return person.arrived===true;}).length;
  var deliveredKeys=allRooms.filter(function(room){return !!room.keyHolderPersonId;}).length;
  var emptyRooms=Math.max(0,allRooms.length-occupiedRooms);
  var notArrivedCount=Math.max(0,activeOccupants.length-arrivedCount);
  var undeliveredKeys=Math.max(0,allRooms.length-deliveredKeys);
  var occupancyPercent=totalBeds?Math.round((activeOccupants.length/totalBeds)*100):0;
  var tSeats=0,tUsed=0;
  (current.transports || []).forEach(function(t){
    tSeats+=t.capacity;
    var usedSeatsInTransport = 0;
    for (var i = 0; i < t.seats.length; i++) {
      var s = t.seats[i];
      if (s.name && s.type !== 'child_shared' && s.type !== 'infant') {
        usedSeatsInTransport++;
      }
    }
    tUsed += usedSeatsInTransport;
  });
  var h='<div class="stats accommodation-summary-grid">';
  h+='<div class="stat-card accommodation-summary-card stat-rooms"><span class="accommodation-summary-icon">'+accommodationIcon('building')+'</span><div class="stat-val accommodation-summary-value">'+activeC+'<small>'+(closedC?' +'+closedC:'')+'</small></div><div class="stat-lbl accommodation-summary-label">إجمالي الغرف</div><span class="accommodation-summary-meta"><span>غرفة</span></span></div>';
  h+='<div class="stat-card accommodation-summary-card stat-guests"><span class="accommodation-summary-icon">'+accommodationIcon('users')+'</span><div class="stat-val accommodation-summary-value">'+activeOccupants.length+'</div><div class="stat-lbl accommodation-summary-label">إجمالي النزلاء</div><span class="accommodation-summary-meta"><span>نزيل</span></span></div>';
  h+='<div class="stat-card accommodation-summary-card stat-occupied"><span class="accommodation-summary-icon">'+accommodationIcon('bed')+'</span><div class="stat-val accommodation-summary-value">'+occupiedRooms+'</div><div class="stat-lbl accommodation-summary-label">الغرف المشغولة</div><span class="accommodation-summary-meta"><span>غرفة</span><small>فارغة: '+emptyRooms+'</small></span></div>';
  h+='<div class="stat-card accommodation-summary-card stat-arrived"><span class="accommodation-summary-icon">'+accommodationIcon('checkCircle')+'</span><div class="stat-val accommodation-summary-value">'+arrivedCount+'</div><div class="stat-lbl accommodation-summary-label">النزلاء الذين وصلوا</div><span class="accommodation-summary-meta"><span>نزيل</span><small>لم يصلوا: '+notArrivedCount+'</small></span></div>';
  h+='<div class="stat-card accommodation-summary-card stat-keys"><span class="accommodation-summary-icon">'+accommodationIcon('key')+'</span><div class="stat-val accommodation-summary-value">'+deliveredKeys+'</div><div class="stat-lbl accommodation-summary-label">المفاتيح المسلمة</div><span class="accommodation-summary-meta"><span>غرفة</span><small>غير مسلمة: '+undeliveredKeys+'</small></span></div>';
  h+='<div class="stat-card accommodation-summary-card stat-rate"><span class="accommodation-summary-icon">'+accommodationIcon('chart')+'</span><div class="stat-val accommodation-summary-value">'+occupancyPercent+'%</div><div class="stat-lbl accommodation-summary-label">نسبة الإشغال</div><span class="accommodation-summary-meta"><span>من السعة</span></span></div>';
  h+='</div>';
  var secondary='<div class="accommodation-secondary-summary" aria-label="ملخص إضافي للتسكين"><span>'+accommodationIcon('user')+' الأطفال: <strong>'+displayedChildren+'</strong></span><span>'+accommodationIcon('bed')+' الأسرة الإضافية: <strong>'+extraBeds+'</strong></span><span>المتاح: <strong>'+availableExtraBeds+'</strong></span></div>';
  if(section==='primary')return h;
  if(section==='secondary')return secondary;
  return h+secondary;
}

// ═══════════════════════════════════════════════════════
// TAB 0: ROOMS
// ═══════════════════════════════════════════════════════
function getAccommodationActivitySnapshot(houses){
  var snapshot={rooms:{},guests:{},children:{}};
  (houses||[]).forEach(function(house){
    (house.floors||[]).forEach(function(floor){
      (floor.rooms||[]).forEach(function(room){
        var roomInfo={id:room.id||'',number:room.number||'',beds:parseInt(room.beds,10)||1,extraBeds:parseInt(room.extraBeds,10)||0,notes:room.notes||'',closed:!!room.closed,closedDay:room.closedDay||null};
        snapshot.rooms[roomInfo.id]=roomInfo;
        (room.guests||[]).forEach(function(guest,index){
          var key=guest.id||guest.guestId||guest.personId||('guest:'+roomInfo.id+':'+index+':'+(guest.name||''));
          snapshot.guests[key]={id:guest.id||guest.guestId||guest.personId||'',name:gn(guest)||guest.name||'',roomId:roomInfo.id,roomNumber:roomInfo.number,data:JSON.stringify([guest.personId||'',guest.name||'',guest.arrivalDay||1,guest.leftDay||'',guest.bedType||'',guest.extraBedPersonType||''])};
        });
        (room.children||[]).forEach(function(child,index){
          var key=child.personId||child.id||('child:'+(child.name||'')+'|'+(child.guardianPersonId||child.guardian||'')+'|'+index);
          snapshot.children[key]={id:child.id||child.personId||'',name:child.name||'',roomId:roomInfo.id,roomNumber:roomInfo.number,data:JSON.stringify([child.personId||'',child.name||'',child.guardianPersonId||'',child.guardian||'',child.arrivalDay||1,child.leftDay||''])};
        });
      });
    });
  });
  return snapshot;
}
function logAccommodationChanges(beforeHouses,afterHouses,options){
  options=options||{};
  var before=getAccommodationActivitySnapshot(beforeHouses);
  var after=getAccommodationActivitySnapshot(afterHouses);
  var fullMove=options.fullRoomMove||null;
  var fullMoveOccurred=!!fullMove&&(Object.keys(after.guests).some(function(key){return before.guests[key]&&before.guests[key].roomId===fullMove.sourceId&&after.guests[key].roomId===fullMove.targetId})||Object.keys(after.children).some(function(key){return before.children[key]&&before.children[key].roomId===fullMove.sourceId&&after.children[key].roomId===fullMove.targetId}));
  Object.keys(after.rooms).forEach(function(roomId){
    var oldRoom=before.rooms[roomId];
    var room=after.rooms[roomId];
    if(!oldRoom){addActivityLog('room_created','تم إنشاء الغرفة '+room.number,{section:'accommodation',entityType:'room',entityId:roomId});return}
    if(oldRoom.number!==room.number||oldRoom.beds!==room.beds||oldRoom.notes!==room.notes||oldRoom.closedDay!==room.closedDay)addActivityLog('room_updated','تم تعديل بيانات الغرفة '+room.number,{details:'السعة: '+room.beds+(room.notes?' — الملاحظات: '+room.notes:''),section:'accommodation',entityType:'room',entityId:roomId});
    if(oldRoom.closed!==room.closed)addActivityLog(room.closed?'room_closed':'room_opened',room.closed?'تم غلق الغرفة '+room.number:'تم فتح الغرفة '+room.number,{section:'accommodation',entityType:'room',entityId:roomId});
    if(oldRoom.extraBeds!==room.extraBeds){
      addActivityLog(room.extraBeds>oldRoom.extraBeds?'extra_bed_added':'extra_bed_removed',room.extraBeds>oldRoom.extraBeds?'تم إضافة سرير إضافي بالغرفة '+room.number:'تم إزالة سرير إضافي من الغرفة '+room.number,{details:'عدد الأسرة الإضافية: '+room.extraBeds,section:'accommodation',entityType:'room',entityId:roomId});
    }
  });
  Object.keys(before.rooms).forEach(function(roomId){if(!after.rooms[roomId])addActivityLog('room_deleted','تم حذف الغرفة '+before.rooms[roomId].number,{section:'accommodation',entityType:'room',entityId:roomId})});
  if(fullMoveOccurred)addActivityLog('room_occupancy_moved','تم نقل تسكين الغرفة '+fullMove.sourceNumber+' إلى الغرفة '+fullMove.targetNumber,{details:'الغرفة السابقة: '+fullMove.sourceNumber+' — الغرفة الجديدة: '+fullMove.targetNumber,section:'accommodation',entityType:'room',entityId:fullMove.targetId||''});
  Object.keys(after.guests).forEach(function(key){
    var oldGuest=before.guests[key];
    var guest=after.guests[key];
    if(!oldGuest){addActivityLog('guest_added','تم إضافة '+guest.name+' إلى الغرفة '+guest.roomNumber,{section:'accommodation',entityType:'person',entityId:guest.id});return}
    if(oldGuest.roomId!==guest.roomId){
      if(!fullMoveOccurred||oldGuest.roomId!==fullMove.sourceId||guest.roomId!==fullMove.targetId)addActivityLog('guest_moved','تم نقل '+guest.name+' من الغرفة '+oldGuest.roomNumber+' إلى الغرفة '+guest.roomNumber,{details:'الغرفة السابقة: '+oldGuest.roomNumber+' — الغرفة الجديدة: '+guest.roomNumber,section:'accommodation',entityType:'person',entityId:guest.id});
    }else if(oldGuest.data!==guest.data)addActivityLog('guest_updated','تم تعديل بيانات '+guest.name+' داخل الغرفة '+guest.roomNumber,{section:'accommodation',entityType:'person',entityId:guest.id});
  });
  Object.keys(before.guests).forEach(function(key){var guest=before.guests[key];if(!after.guests[key]&&(!fullMoveOccurred||guest.roomId!==fullMove.sourceId))addActivityLog('guest_removed','تم حذف '+guest.name+' من الغرفة '+guest.roomNumber,{section:'accommodation',entityType:'person',entityId:guest.id})});
  Object.keys(after.children).forEach(function(key){var child=after.children[key];var oldChild=before.children[key];if(!oldChild)addActivityLog('child_added','تم إضافة طفل مرافق '+child.name+' إلى الغرفة '+child.roomNumber,{section:'accommodation',entityType:'child',entityId:child.id});else if(oldChild.roomId===child.roomId&&oldChild.data!==child.data)addActivityLog('guest_updated','تم تعديل بيانات '+child.name+' داخل الغرفة '+child.roomNumber,{section:'accommodation',entityType:'child',entityId:child.id})});
  Object.keys(before.children).forEach(function(key){var child=before.children[key];if(!after.children[key]&&(!fullMoveOccurred||child.roomId!==fullMove.sourceId))addActivityLog('child_removed','تم حذف طفل مرافق من الغرفة '+child.roomNumber,{details:child.name,section:'accommodation',entityType:'child',entityId:child.id})});
}

function getAccommodationPersonDisplayName(person){
  if(typeof person==='string'){
    var stringPerson=typeof getPersonById==='function'?getPersonById(person):null;
    return stringPerson&&stringPerson.fullName?stringPerson.fullName:person;
  }
  person=person||{};
  var lookupId=person.personId||(!person.name?person.id:null);
  var resolved=lookupId&&typeof getPersonById==='function'
    ?getPersonById(lookupId):null;
  return resolved&&resolved.fullName?resolved.fullName:(person.name||'');
}

var userManagementAccessState={status:'idle',capabilities:null};
var organizationManagementAccessState={status:'idle',canOpen:false};
function closeOrganizationManagementScreen(){
  var screen=ge('organizationManagementScreen');
  if(screen)screen.style.display='none';
}
function applyOrganizationManagementEntryVisibility(){
  var visible=organizationManagementAccessState.status==='loaded'&&
    organizationManagementAccessState.canOpen===true;
  if(!document.querySelectorAll)return;
  document.querySelectorAll('[data-organization-management-entry]').forEach(function(entry){
    entry.style.display=visible?'':'none';
  });
}
function ensureOrganizationManagementAccess(){
  if(organizationManagementAccessState.status!=='idle'||
    !window.OrganizationManagementService||
    typeof window.OrganizationManagementService.list!=='function')return;
  organizationManagementAccessState.status='loading';
  applyOrganizationManagementEntryVisibility();
  window.OrganizationManagementService.list().then(function(response){
    var data=response&&response.ok&&response.data?response.data:null;
    organizationManagementAccessState.status=response&&response.ok?'loaded':'error';
    organizationManagementAccessState.canOpen=!!(data&&(
      data.canCreate===true||Array.isArray(data.organizations)&&data.organizations.some(function(organization){
        var capabilities=organization&&organization.capabilities||{};
        return capabilities.canManageMembers===true||capabilities.canEdit===true||
          capabilities.canArchive===true||capabilities.canRestore===true;
      })
    ));
    applyOrganizationManagementEntryVisibility();
    if(ge('tab6')&&ge('tab6').style.display!=='none')renderSettings();
  }).catch(function(){
    organizationManagementAccessState={status:'error',canOpen:false};
    applyOrganizationManagementEntryVisibility();
  });
}
function ensureUserManagementAccess(){
  if(userManagementAccessState.status!=='idle'||
    !window.UserManagementReadService||
    typeof window.UserManagementReadService.getActorCapabilities!=='function')return;
  userManagementAccessState.status='loading';
  window.UserManagementReadService.getActorCapabilities().then(function(response){
    userManagementAccessState.status=response&&response.ok?'loaded':'error';
    userManagementAccessState.capabilities=response&&response.ok
      ?response.data.capabilities:null;
    renderSettings();
  }).catch(function(){
    userManagementAccessState={status:'error',capabilities:null};
    renderSettings();
  });
}

function canEditCurrentConferenceData(){
  var current=getCurrentConference();
  var authorization=window.ConferenceActivationAuthorization;
  return !!(current&&authorization&&authorization.canEdit(current.id));
}

function canEditCurrentConferenceAccommodation(){
  return canEditCurrentConferenceData()&&!!(window.ConferenceEditLockManager&&
    window.ConferenceEditLockManager.canMutateAccommodation());
}

function beginAccommodationEditing(){
  if(!window.ConferenceEditLockManager)return Promise.resolve(false);
  return window.ConferenceEditLockManager.beginAccommodationEdit();
}

function endAccommodationEditing(){
  if(!window.ConferenceEditLockManager)return Promise.resolve(false);
  return window.ConferenceEditLockManager.endAccommodationEdit();
}

function requireAccommodationMutation(){
  return !!(window.ConferenceEditLockManager&&
    window.ConferenceEditLockManager.requireAccommodationMutation());
}

function normalizeAccommodationSearchText(value){
  var arabicDigits='٠١٢٣٤٥٦٧٨٩';
  var persianDigits='۰۱۲۳۴۵۶۷۸۹';
  return String(value===undefined||value===null?'':value)
    .replace(/[٠-٩]/g,function(digit){return String(arabicDigits.indexOf(digit));})
    .replace(/[۰-۹]/g,function(digit){return String(persianDigits.indexOf(digit));})
    .trim()
    .toLowerCase()
    .replace(/\s+/g,' ');
}

function accommodationRoomMatchesSearch(room,normalizedQuery){
  if(!normalizedQuery)return true;
  if(normalizeAccommodationSearchText(room&&room.number).indexOf(normalizedQuery)!==-1)return true;
  var people=(room&&room.guests||[]).concat(room&&room.children||[]);
  return people.some(function(person){
    var name=typeof getAccommodationPersonDisplayName==='function'
      ?getAccommodationPersonDisplayName(person)
      :(typeof gn==='function'?gn(person):(person&&person.name||''));
    return normalizeAccommodationSearchText(name).indexOf(normalizedQuery)!==-1;
  });
}

function getAccommodationOccupants(room){
  return (room&&room.guests||[]).filter(function(person){return !gl(person);})
    .concat((room&&room.children||[]).filter(function(person){return !person.leftDay;}));
}

function getAccommodationPersonIdentity(person){
  return String((person&&(person.personId||person.id))||'');
}

function reconcileAccommodationRoomKeyHolders(conference){
  (conference&&conference.houses||[]).forEach(function(house){
    (house.floors||[]).forEach(function(floor){
      (floor.rooms||[]).forEach(function(room){
        var holderId=String(room.keyHolderPersonId||'');
        if(holderId&&!getAccommodationOccupants(room).some(function(person){
          return getAccommodationPersonIdentity(person)===holderId;
        }))room.keyHolderPersonId='';
      });
    });
  });
}

function setAccommodationQuickFilter(filter){
  accommodationQuickFilter=filter||'all';
  renderAccommodation();
}

function accommodationRoomMatchesQuickFilter(room,filter){
  var occupants=getAccommodationOccupants(room);
  if(filter==='occupied')return occupants.length>0;
  if(filter==='empty')return occupants.length===0;
  if(filter==='arrived')return occupants.some(function(person){return person.arrived===true;});
  if(filter==='not-arrived')return occupants.some(function(person){return person.arrived!==true;});
  if(filter==='key-delivered')return !!room.keyHolderPersonId;
  if(filter==='key-not-delivered')return !room.keyHolderPersonId;
  return true;
}

function toggleAccommodationFloor(houseId,floorId){
  var key=String(houseId)+'|'+String(floorId);
  accommodationCollapsedFloors[key]=!accommodationCollapsedFloors[key];
  renderAccommodation();
}

function setAccommodationPersonArrival(houseId,floorId,roomId,personId,arrived){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('setAccommodationPersonArrival',null))return false;
  if(!requireAccommodationMutation())return false;
  var result=findRoomInHouses((getCurrentConference()||{}).houses||[],houseId,floorId,roomId);
  if(!result||!result.room)return false;
  var person=getAccommodationOccupants(result.room).filter(function(item){return getAccommodationPersonIdentity(item)===String(personId);})[0];
  if(!person)return false;
  person.arrived=arrived===true;
  if(!save())return false;
  renderAccommodation();
  return true;
}

function setAccommodationRoomKeyHolder(houseId,floorId,roomId,personId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('setAccommodationRoomKeyHolder',null))return false;
  if(!requireAccommodationMutation())return false;
  var result=findRoomInHouses((getCurrentConference()||{}).houses||[],houseId,floorId,roomId);
  if(!result||!result.room)return false;
  var nextId=String(personId||'');
  if(nextId&&!getAccommodationOccupants(result.room).some(function(item){return getAccommodationPersonIdentity(item)===nextId;}))return false;
  result.room.keyHolderPersonId=nextId;
  if(!save())return false;
  renderAccommodation();
  return true;
}

function closeOpenRoomActionMenus(exceptElement){
  document.querySelectorAll('.room-more-actions[open]').forEach(function(menu){
    if(menu!==exceptElement)menu.removeAttribute('open');
  });
}

document.addEventListener('click',function(event){
  var target=event.target;
  var menu=target&&target.closest?target.closest('.room-more-actions'):null;
  if(!menu){
    closeOpenRoomActionMenus();
    return;
  }
  if(target.closest('button'))closeOpenRoomActionMenus();
},true);

document.addEventListener('keydown',function(event){
  if(event.key==='Escape'&&document.querySelector('.room-more-actions[open]'))closeOpenRoomActionMenus();
});

function renderAccommodationQuickFilters(extraClass){
  var filters=[['all','home','كل الغرف'],['occupied','bed','الغرف المشغولة'],['empty','door','الغرف الفارغة'],['arrived','checkCircle','النزلاء الذين وصلوا'],['not-arrived','circle','النزلاء الذين لم يصلوا'],['key-delivered','key','المفاتيح المسلمة'],['key-not-delivered','key','المفاتيح غير المسلمة']];
  var h='<aside class="accommodation-sidebar '+String(extraClass||'')+'"><section class="accommodation-filter-panel sidebar-card" aria-label="فلترة سريعة"><h2>فلترة سريعة</h2><div class="accommodation-quick-filters">'+filters.map(function(item){return '<button type="button" class="filter-item '+(accommodationQuickFilter===item[0]?'active':'')+'" onclick="setAccommodationQuickFilter(\''+item[0]+'\')"><span>'+accommodationIcon(item[1])+'</span>'+item[2]+'</button>';}).join('')+'</div></section>';
  h+='<section class="accommodation-legend sidebar-card"><h2>مفتاح الرموز</h2><div><span class="legend-item"><i class="legend-arrived">'+accommodationIcon('checkCircle')+'</i> وصل</span><span class="legend-item"><i class="legend-waiting">'+accommodationIcon('circle')+'</i> لم يصل</span><span class="legend-item"><i class="legend-arrived">'+accommodationIcon('key')+'</i> المفتاح مُسلّم</span><span class="legend-item"><i class="legend-warning">'+accommodationIcon('key')+'</i> المفتاح غير مُسلّم</span><span class="legend-item"><i>'+accommodationIcon('bed')+'</i> متبقي سرير</span></div></section></aside>';
  return h;
}

function updateAccommodationSearch(value){
  accommodationSearchQuery=String(value===undefined||value===null?'':value);
  renderAccommodation();
  var input=ge('accommodationSearchInput');
  if(input){
    input.focus();
    if(typeof input.setSelectionRange==='function')input.setSelectionRange(input.value.length,input.value.length);
  }
}

function clearAccommodationSearch(){
  accommodationSearchQuery='';
  renderAccommodation();
  var input=ge('accommodationSearchInput');
  if(input)input.focus();
}

function renderAccommodationSearchControls(matchCount,isFiltering){
  var value=String(accommodationSearchQuery||'');
  var h='<div class="accommodation-search" role="search">';
  h+='<div class="accommodation-search-controls"><span class="accommodation-search-icon" aria-hidden="true">'+accommodationIcon('search')+'</span><input id="accommodationSearchInput" type="search" value="'+esc(value)+'" placeholder="ابحث برقم الغرفة أو اسم النزيل..." aria-label="ابحث باسم شخص أو رقم غرفة" oninput="updateAccommodationSearch(this.value)">';
  h+='<button type="button" class="btn accommodation-search-clear" onclick="clearAccommodationSearch()" '+(value?'':'disabled')+'>مسح '+accommodationIcon('close')+'</button></div>';
  h+='</div>';
  if(isFiltering)h+='<div class="accommodation-search-count" aria-live="polite">'+(matchCount===1?'غرفة واحدة مطابقة':matchCount+' غرف مطابقة')+'</div>';
  return h;
}

function renderAccommodation() {
  var current = getCurrentConference();
  renderGlobalConferenceHeader();
  var normalizedSearchQuery=normalizeAccommodationSearchText(accommodationSearchQuery);
  var isFiltering=!!normalizedSearchQuery;
  var lockState=window.ConferenceEditLockManager&&
    window.ConferenceEditLockManager.getState?window.ConferenceEditLockManager.getState():{status:'viewing'};
  var editControls='<div class="accommodation-edit-mode-toolbar">';
  if(lockState.status==='editing')editControls+='<button class="btn btn-red" onclick="endAccommodationEditing()">إنهاء تعديل التسكين</button><span class="accommodation-edit-state">وضع التعديل فعّال على هذا الجهاز</span>';
  else editControls+='<button class="btn btn-blue" '+(lockState.status==='acquiring'?'disabled':'')+' onclick="beginAccommodationEditing()">'+(lockState.status==='acquiring'?'جارٍ طلب القفل...':'بدء تعديل التسكين')+'</button><span class="accommodation-edit-state">وضع مشاهدة فقط</span>';
  editControls+='</div>';
  var h='<main class="accommodation-dashboard">'+(isFiltering?'':statsHtml('primary'));
  if (!current || !current.houses || !current.houses.length) {
    if(!isFiltering)h+='<div class="accommodation-edit-toolbar accommodation-edit-toolbar-empty">'+editControls+'</div>';
    h += '<div class="card" style="text-align:center;padding:20px;color:#95a5a6;">لم يتم اختيار بيت للمؤتمر.';
    if(canEditCurrentConferenceAccommodation())h += '<div style="margin-top:10px"><button class="btn btn-blue" onclick="openAssignConferenceHouseSelector()">اختيار بيت المؤتمر</button></div>';
    h += '</div>';
    ge('tab0').innerHTML = h+'</main>';
    return;
  }

  var displayed = canEditCurrentConferenceAccommodation()
    ?ensureAccommodationDisplayState(current)
    :ensureAccommodationDisplayState(deepClone(current));
  var allRooms = getAllRooms();
  var visibleRooms=allRooms.filter(function(roomEntry){
    return !!displayed[roomEntry.id]&&accommodationRoomMatchesSearch(roomEntry,normalizedSearchQuery)&&
      (isFiltering||accommodationRoomMatchesQuickFilter(roomEntry,accommodationQuickFilter));
  });
  h+='<div class="accommodation-edit-toolbar'+(isFiltering?' is-searching':'')+'">'+(isFiltering?'':editControls+statsHtml('secondary'))+renderAccommodationSearchControls(visibleRooms.length,isFiltering)+'</div>';
  if(isFiltering&&!visibleRooms.length){
    h+='<div class="card accommodation-search-empty" role="status">لا توجد غرف مطابقة.</div>';
    ge('tab0').innerHTML=h+'</main>';
    return;
  }
  h+='<div class="accommodation-workspace'+(isFiltering?' is-searching':'')+'"><div class="accommodation-primary-column">';
  var canEditAccommodation=canEditCurrentConferenceAccommodation();
  var grouped = {};
  if(!isFiltering){
    (current.houses || []).forEach(function(house) {
      if (!grouped[house.id]) grouped[house.id] = { house: house, floors: {} };
      (house.floors || []).forEach(function(floor) {
        if (!grouped[house.id].floors[floor.id]) {
          grouped[house.id].floors[floor.id] = { floor: floor, rooms: [] };
        }
      });
    });
  }
  visibleRooms.forEach(function(roomEntry) {
    var house = roomEntry.house || { id: '', name: 'بيت غير معروف', description: '' };
    var floor = roomEntry.floor || { id: '', name: 'دور غير مسمى' };
    var displayFloorId = roomEntry.closed ? '__closed_rooms__' : floor.id;
    if (!grouped[house.id]) {
      grouped[house.id] = { house: house, floors: {} };
    }
    if (!grouped[house.id].floors[displayFloorId]) {
      grouped[house.id].floors[displayFloorId] = {
        floor:roomEntry.closed
          ?{id:'__closed_rooms__',name:'الغرف المغلقة'}
          :floor,
        rooms: []
      };
    }
    grouped[house.id].floors[displayFloorId].rooms.push(roomEntry);
  });

  Object.keys(grouped).forEach(function(houseKey) {
    var houseEntry = grouped[houseKey];
    var house = houseEntry.house;
    h += '<section class="card accommodation-house section-card"><div class="accommodation-house-title"><span>'+accommodationIcon('building')+'</span><strong>' + esc(house.name) + '</strong>'+(canEditAccommodation?'<details class="accommodation-house-menu"><summary>'+accommodationIcon('more')+'</summary><div><button class="btn btn-blue btn-sm" onclick="openActiveRoomsManager(\'' + house.id + '\')">إدارة غرف التسكين</button><button class="btn btn-red btn-sm" onclick="removeConferenceHouseFromAccommodation(\'' + house.id + '\')">إزالة بيت المؤتمر</button></div></details>':'')+'</div>';
    if (house.description) {
      h += '<p style="font-size:11px; color:#5a7a9a; margin:-8px 0 10px 0;">' + esc(house.description) + '</p>';
    }

    var selectedHouseRooms=allRooms.filter(function(room){
      return room.house&&room.house.id===house.id;
    });
    var openSelectedHouseRooms=selectedHouseRooms.filter(function(room){return !room.closed});
    var closedSelectedHouseRooms=selectedHouseRooms.length-openSelectedHouseRooms.length;
    h+='<div class="card accommodation-house-summary">';
    h+='<div style="font-weight:800;color:#1F4E79;margin-bottom:10px">ملخص غرف التسكين</div>';
    h+='<div class="house-templates-heading-stats" dir="rtl" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;width:100%;margin-bottom:10px">';
    h+='<div class="house-heading-stat-card"><span class="house-heading-stat-icon">'+accommodationIcon('checkCircle')+'</span><span class="house-heading-stat-label">الغرف المختارة</span><strong>'+selectedHouseRooms.length+'</strong></div>';
    h+='<div class="house-heading-stat-card"><span class="house-heading-stat-icon">'+accommodationIcon('door')+'</span><span class="house-heading-stat-label">المفتوحة</span><strong>'+openSelectedHouseRooms.length+'</strong></div>';
    h+='<div class="house-heading-stat-card"><span class="house-heading-stat-icon">'+accommodationIcon('lock')+'</span><span class="house-heading-stat-label">المغلقة</span><strong>'+closedSelectedHouseRooms+'</strong></div>';
    h+='</div>';
    if(selectedHouseRooms.length){
      h+=renderRoomTypeStatCards(selectedHouseRooms,false);
    }else{
      h+='<div style="color:#95A5A6;font-size:11px;margin-top:7px">لم يتم اختيار غرف للتسكين بعد.</div>';
    }
    h+='</div>';

    var floorKeys=Object.keys(houseEntry.floors);
    var closedFloorIndex=floorKeys.indexOf('__closed_rooms__');
    if(closedFloorIndex!==-1){
      floorKeys.splice(closedFloorIndex,1);
      floorKeys.push('__closed_rooms__');
    }
    var hasActiveRoomsInHouse = false;
    floorKeys.forEach(function(floorKeyCheck){
      if((houseEntry.floors[floorKeyCheck].rooms || []).length) hasActiveRoomsInHouse = true;
    });
    if(!hasActiveRoomsInHouse){
      h += '<div style="color:#AAB5C0;font-size:11px;padding:8px 0">لم يتم اختيار غرف للتسكين بعد. استخدم إدارة غرف التسكين لاختيار الغرف.</div>';
      h += '</section>';
      return;
    }

    floorKeys.forEach(function(floorKey) {
      var floorEntry = houseEntry.floors[floorKey];
      if(!(floorEntry.rooms || []).length) return;
      var floor = floorEntry.floor;
      var floorStateKey=String(house.id)+'|'+String(floor.id);
      var floorCollapsed=!isFiltering&&accommodationCollapsedFloors[floorStateKey]===true;
      var floorOccupants = 0;
      var floorBaseBeds = 0;
      floorEntry.rooms.forEach(function(room){
        floorBaseBeds += parseInt(room.beds, 10) || 1;
        (room.guests || []).forEach(function(guest){ if(!gl(guest)) floorOccupants++; });
        (room.children || []).forEach(function(child){ if(!child.leftDay) floorOccupants++; });
      });
      h += '<div class="floor-container'+(floorCollapsed?' is-collapsed':'')+'">';
      h += '<button type="button" class="accommodation-floor-header floor-header" aria-expanded="'+(floorCollapsed?'false':'true')+'" onclick="toggleAccommodationFloor(\''+house.id+'\',\''+floor.id+'\')"><span class="floor-heading-icon">'+accommodationIcon('building')+'</span><span class="floor-title">'+esc(floor.name)+' <small>'+floorEntry.rooms.length+' غرفة</small></span><span class="accommodation-floor-toggle">'+accommodationIcon(floorCollapsed?'chevronDown':'chevronUp')+'</span></button>';
      h += '<div class="grid3 accommodation-floor-rooms">';
      floorEntry.rooms.forEach(function(r) {
        var roomFloorId=r.floor&&r.floor.id?r.floor.id:floor.id;
        var ag = [], ac = [], lg = [];
        (r.guests || []).forEach(function(g) {
          if (!gl(g)) ag.push(g);
          else lg.push(g);
        });
        (r.children || []).forEach(function(c) {
          if (!c.leftDay) ac.push(c);
        });
        var totalResidents = ag.length + ac.length;
        var occupiedBeds = countRoomOccupancy(r);
        var bedsCount = parseInt(r.beds, 10) || 1;
        var extraBeds = parseInt(r.extraBeds || 0, 10) || 0;
        var autoExtraBeds = parseInt(r.autoExtraBeds || 0, 10) || 0;
        var totalCapacity = bedsCount + extraBeds;
        var isClosed = !!r.closed;
        var isOverCapacity = occupiedBeds > totalCapacity;
        var headClass = isClosed ? 'rcard-head-gray' : isOverCapacity ? 'rcard-head-red' : occupiedBeds >= bedsCount ? 'rcard-head-green' : occupiedBeds > 0 ? 'rcard-head-orange' : 'rcard-head-gray';
        var headColor = isClosed ? '#95A5A6' : isOverCapacity ? '#E74C3C' : occupiedBeds >= bedsCount ? '#27AE60' : occupiedBeds > 0 ? '#E67E22' : '#95A5A6';
        var occupancyDisplayText = occupiedBeds + ' / ' + bedsCount;
        var roomIndicators = '';
        var hasActiveChild = (r.children || []).some(function(c){
          return !c.leftDay;
        });
        if(isClosed) roomIndicators += '<span title="غرفة مغلقة">'+accommodationIcon('lock')+'</span>';
        if(totalResidents > 0)roomIndicators += '<span title="يوجد نزلاء">'+accommodationIcon('users')+'</span>';
        if(extraBeds > 0) roomIndicators += '<span title="يوجد أسرة إضافية">'+accommodationIcon('plus')+'</span>';
        if(r.notes) roomIndicators += '<span title="توجد ملاحظات">'+accommodationIcon('note')+'</span>';
        var extraBedsBadge = '';
        if(extraBeds > 0){
          var usedExtraBeds = Math.max(0, occupiedBeds - bedsCount);
          var emptyExtraBeds = extraBeds - usedExtraBeds;
          var badgeBg = (usedExtraBeds === 0) ? '#3498DB' : (emptyExtraBeds === 0) ? '#E67E22' : '#F1C40F';
          var badgeText = usedExtraBeds > 0 ? (emptyExtraBeds > 0 ? usedExtraBeds + '/' + extraBeds : extraBeds) : extraBeds;
          var badgeTitle = emptyExtraBeds > 0 ? 'متاح: ' + emptyExtraBeds : 'مستخدم: ' + usedExtraBeds;
          extraBedsBadge = '<span class="room-extra-badge" style="--badge-color:' + badgeBg + '" title="' + badgeTitle + '">'+accommodationIcon('bed')+' +' + badgeText + '</span>';
        }
        var remainingBeds=Math.max(0,bedsCount-occupiedBeds);
        var roomStatus=isClosed?'مغلقة':occupiedBeds>=bedsCount?'مكتملة':occupiedBeds>0?'متبقية '+remainingBeds:'فارغة';
        var roomStatusClass=isClosed||occupiedBeds===0?'status-neutral':occupiedBeds>=bedsCount?'status-complete':'status-warning';
        var roomOccupants=getAccommodationOccupants(r);
        var keyHolder=roomOccupants.filter(function(person){return getAccommodationPersonIdentity(person)===String(r.keyHolderPersonId||'');})[0]||null;
        h += '<article class="rcard accommodation-room-card room-card" style="--room-status-color:' + headColor + '">';
        h += '<div class="rcard-head ' + headClass + '"><span class="accommodation-room-name"><b>' + esc(r.number) + '</b><i>'+accommodationIcon('bed')+'</i><span class="accommodation-room-indicators">' + roomIndicators + '</span></span><span class="accommodation-room-status-badge status-pill '+roomStatusClass+'">'+roomStatus+'</span><span class="accommodation-room-occupancy-badge">'+accommodationIcon('users')+' '+occupancyDisplayText+'</span>'+extraBedsBadge+'</div>';
        h += '<div class="rcard-body">';
        h += '<label class="accommodation-room-key key-status '+(keyHolder?'key-delivered':'key-pending')+'"><span>'+accommodationIcon('key')+' المفتاح: <strong>'+(keyHolder?'استلمه '+esc(getAccommodationPersonDisplayName(keyHolder)):'لم يُسلَّم بعد')+'</strong></span><small>'+(canEditAccommodation?accommodationIcon('chevronDown'):'')+'</small><select aria-label="تغيير مستلم مفتاح الغرفة" '+(canEditAccommodation?'onchange="setAccommodationRoomKeyHolder(\''+house.id+'\',\''+roomFloorId+'\',\''+r.id+'\',this.value)"':'disabled')+'><option value="">لم يُسلَّم بعد</option>'+roomOccupants.map(function(person){var identity=getAccommodationPersonIdentity(person);return identity?'<option value="'+esc(identity)+'" '+(keyHolder===person?'selected':'')+'>'+esc(getAccommodationPersonDisplayName(person))+'</option>':'';}).join('')+'</select></label>';
        ag.forEach(function(g) {
          var guestIdentity=getAccommodationPersonIdentity(g);
          h += '<div class="guest-row person-row"><span>'+accommodationIcon('user')+' ' + esc(getAccommodationPersonDisplayName(g)) + (g.bedType==='extra'?'<small>'+accommodationIcon('plus')+'</small>':'')+'</span><button type="button" class="accommodation-arrival status-pill '+(g.arrived===true?'arrived':'not-arrived')+'" '+(canEditAccommodation&&guestIdentity?'onclick="setAccommodationPersonArrival(\''+house.id+'\',\''+roomFloorId+'\',\''+r.id+'\',\''+esc(guestIdentity)+'\','+(g.arrived===true?'false':'true')+')"':'disabled')+'>'+accommodationIcon(g.arrived===true?'checkCircle':'circle')+(g.arrived===true?'وصل':'لم يصل')+'</button></div>';
        });
        ac.forEach(function(c) { var childIdentity=getAccommodationPersonIdentity(c);h += '<div class="guest-row person-row"><span>'+accommodationIcon('user')+' '+esc(getAccommodationPersonDisplayName(c))+(c.bedType==='extra'?'<small>'+accommodationIcon('plus')+'</small>':'')+'</span><button type="button" class="accommodation-arrival status-pill '+(c.arrived===true?'arrived':'not-arrived')+'" '+(canEditAccommodation&&childIdentity?'onclick="setAccommodationPersonArrival(\''+house.id+'\',\''+roomFloorId+'\',\''+r.id+'\',\''+esc(childIdentity)+'\','+(c.arrived===true?'false':'true')+')"':'disabled')+'>'+accommodationIcon(c.arrived===true?'checkCircle':'circle')+(c.arrived===true?'وصل':'لم يصل')+'</button></div>' });
        if (lg.length) h += '<div style="font-size:9px;color:#E74C3C;margin-top:3px">غادر: ' + lg.map(function(g) { return esc(gn(g)) }).join('، ') + '</div>';
        if (!totalResidents && !lg.length) h += '<div class="accommodation-empty-room">لا يوجد نزلاء</div>';
        if(canEditAccommodation){
          h += '<div class="accommodation-room-actions">';
          h += '<button class="btn accommodation-room-edit action-button" onclick="openRoomEditor(\''+house.id+'\', \''+roomFloorId+'\', \''+r.id+'\')">'+accommodationIcon('eye')+' عرض التفاصيل</button>';
          h += '<details class="room-more-actions" name="room-actions"><summary>'+accommodationIcon('more')+'</summary><div><button class="btn" onclick="openMoveRoomDialog(\'' + house.id + '\', \'' + roomFloorId + '\', \'' + r.id + '\')">نقل الغرفة</button><button class="btn" onclick="clearConferenceRoom(\'' + house.id + '\', \'' + roomFloorId + '\', \'' + r.id + '\')">تفريغ البيانات</button><button class="btn" onclick="toggleConferenceRoomClosed(\'' + house.id + '\', \'' + roomFloorId + '\', \'' + r.id + '\')">' + (isClosed ? 'فتح الغرفة' : 'إغلاق الغرفة') + '</button><button class="btn btn-red" onclick="deleteConferenceRoom(\'' + house.id + '\', \'' + roomFloorId + '\', \'' + r.id + '\')">حذف الغرفة</button></div></details>';
          h += '</div>';
        }
        h += '</div></article>';
      });
      h += '</div></div>';
    });
    h += '</section>';
  });
  h+='</div>'+(isFiltering?'':renderAccommodationQuickFilters())+'</div>';
  ge('tab0').innerHTML = h+'</main>';
}
var editRoomData = {};
var personDialogContext = { guestRowId: null, childRowId: null, targetField: '' };
var activeRoomsManager = { houseId: null };
var searchableSelectState = { title: '', items: [], onSelect: null };
var guestPersonPickerState = { rowId: '', items: [], onSelect: null };
var guestPersonPickerOutsideHandler = null;
var guestPersonPickerPositionHandler = null;
var partialTransferState;

function deactivateAccommodationRoom(roomId){
  if(!requireAccommodationMutation())return false;
  var current = getCurrentConference();
  var result = current ? findRoomByIdInHouses(current.houses || [], roomId) : null;
  if(!current || !result || !result.room) return false;
  var room = result.room;
  var preflight = getAccommodationRoomsPreflight([room]);
  if(preflight.occupantCount){
    if(!confirm('إلغاء تنشيط الغرفة "' + (room.number || 'بدون رقم') + '"؟ تحتوي على ' + preflight.guestCount + ' ضيف و' + preflight.childCount + ' طفل، بإجمالي ' + preflight.occupantCount + ' نزيل. سيتم مسح بيانات تسكينهم من الغرفة.')){
      return false;
    }
  }
  var prepared = prepareAccommodationDisplayedRoomIds(current, [room.id], false);
  if(!prepared.ok) return false;
  commitAccommodationDisplayChange(current, prepared.ids, preflight.occupiedRooms);
  return true;
}

function closeSearchableSelectDialog(){
  var modal = ge('searchableSelectModal');
  if(modal) modal.style.display = 'none';
  searchableSelectState = { title: '', items: [], onSelect: null };
}

function renderSearchableSelectList(){
  var list = ge('searchableSelectList');
  var input = ge('searchableSelectSearch');
  if(!list) return;
  var q = normalizePersonKey(input ? input.value : '');
  list.innerHTML = '';
  var shown = 0;
  var items = Array.isArray(searchableSelectState.items) ? searchableSelectState.items : [];
  items.forEach(function(item){
    if(!item || !item.label) return;
    var hay = normalizePersonKey((item.searchText || '') + ' ' + (item.label || ''));
    if(q && hay.indexOf(q) === -1) return;
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'btn modal-list-item';
    row.style.cssText = 'width:100%;text-align:right;display:block;margin-bottom:6px;padding:8px 10px;border:1px solid #E3EEF9;background:#fff;color:#1F4E79';
    row.textContent = item.label;
    row.onclick = function(){
      var fn = searchableSelectState.onSelect;
      closeSearchableSelectDialog();
      if(typeof fn === 'function') fn(item.data);
    };
    list.appendChild(row);
    shown++;
  });
  if(!shown){
    list.innerHTML = '<div class="modal-empty-state">لا توجد نتائج</div>';
  }
}

function openSearchableSelectDialog(title, items, onSelect){
  var modal = ge('searchableSelectModal');
  var titleEl = ge('searchableSelectTitle');
  var input = ge('searchableSelectSearch');
  if(!modal || !titleEl || !input){
    return;
  }
  searchableSelectState.title = title || 'اختر';
  searchableSelectState.items = (items || []).filter(function(item){
    return !!(item && item.label);
  });
  searchableSelectState.onSelect = onSelect || null;
  titleEl.textContent = searchableSelectState.title;
  input.value = '';
  renderSearchableSelectList();
  modal.style.display = 'flex';
  setTimeout(function(){ input.focus(); }, 0);
}

function getRoomMoveTargetsFromHouses(houses, excludeRoomId){
  var out = [];
  (houses || []).forEach(function(house){
    (house.floors || []).forEach(function(floor){
      (floor.rooms || []).forEach(function(room){
        if(room.id === excludeRoomId) return;
        out.push({ house: house, floor: floor, room: room });
      });
    });
  });
  return out;
}

function getRoomMoveTargetFloors(house, excludeRoomId, currentFloorId, options){
  if(!house) return [];
  options = options || {};
  var targets = getRoomMoveTargetsFromHouses([house], excludeRoomId);
  if(options.activeOnly){
    var displayed = getActiveRoomIdsMap();
    targets = targets.filter(function(t){ return !!displayed[t.room.id]; });
  }
  var floorMap = {};
  targets.forEach(function(t){
    if(t.floor.id === currentFloorId) return;
    if(!floorMap[t.floor.id]){
      floorMap[t.floor.id] = { house: t.house, floor: t.floor, rooms: [] };
    }
    floorMap[t.floor.id].rooms.push(t.room);
  });
  var floors = [];
  Object.keys(floorMap).forEach(function(id){ floors.push(floorMap[id]); });
  return floors;
}

function getEditorAssignedMap(excludeRoomId){
  if(editRoomData && editRoomData.draftHouses){
    return getAssignedPersonIdsInHouses(editRoomData.draftHouses, excludeRoomId);
  }
  return getAssignedPersonIdsInCurrentConference(excludeRoomId);
}

function isPersonAssignedElsewhereInEditor(personId, excludeRoomId){
  if(!personId) return false;
  return !!getEditorAssignedMap(excludeRoomId)[personId];
}

function cloneHouseTemplateToConference(template, options){
  options = options || {};
  var source = deepClone(template || {});
  normalizeHouseStructure(source);
  var out = {
    id: uid(),
    name: source.name || 'بيت غير مسمى',
    description: source.description || '',
    sourceTemplateId: source.id || null,
    floors: []
  };
  (source.floors || []).forEach(function(floor){
    var newFloor = { id: uid(), sourceTemplateFloorId: floor.id || null, name: floor.name || 'دور غير مسمى', rooms: [] };
    (floor.rooms || []).forEach(function(room){
      if (options.selectedRooms && !options.selectedRooms[floor.id + '::' + room.id]) return;
      newFloor.rooms.push({
        id: uid(),
        sourceTemplateRoomId: room.id || null,
        number: room.number || '',
        beds: parseInt(room.beds, 10) || 1,
        extraBeds: parseInt(room.extraBeds, 10) || 0,
        notes: room.notes || '',
        guests: [],
        children: [],
        closed: !!room.closed,
        closedDay: room.closedDay === undefined ? null : room.closedDay
      });
    });
    if (!options.selectedRooms || newFloor.rooms.length) out.floors.push(newFloor);
  });
  return out;
}

function openAssignConferenceHouseSelector(){
  var current = getCurrentConference();
  var templates = appData.houseTemplates || [];
  if(!current) return;
  if(!templates.length){
    alert('لا توجد بيوت مؤتمر متاحة في المكتبة.');
    return;
  }
  var items = templates.map(function(t){
    return {
      label: (t.name || 'بيت غير مسمى') + (t.description ? ' - ' + t.description : ''),
      searchText: (t.name || '') + ' ' + (t.description || ''),
      data: t
    };
  });
  openSearchableSelectDialog('إسناد بيت للمؤتمر', items, function(template){
    if(!template) return;
    if(!requireAccommodationMutation())return;
    current.houses = current.houses || [];
    var alreadyAssigned = current.houses.some(function(house) { return house.sourceTemplateId === template.id; });
    if (alreadyAssigned) {
      alert('هذا البيت مضاف بالفعل إلى المؤتمر الحالي');
      return;
    }
    var newHouse = cloneHouseTemplateToConference(template);
    current.houses.push(newHouse);
    var displayedMap = ensureAccommodationDisplayState(current);
    current.accommodationDisplayedRoomIds = (current.accommodationDisplayedRoomIds || []).filter(function(id){
      return !!displayedMap[id];
    });
    if(!save())return;
    renderAccommodation();
    showToast('✅ تم إسناد بيت المؤتمر');
  });
}

function removeConferenceHouseFromAccommodation(houseId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('removeConferenceHouseFromAccommodation',null))return false;
  if(!requireAccommodationMutation())return false;
  var current = getCurrentConference();
  if(!current || !current.houses) return;
  var idx = -1;
  for(var i=0;i<current.houses.length;i++){
    if(current.houses[i].id === houseId){ idx = i; break; }
  }
  if(idx === -1) return;
  var removedHouse = current.houses[idx];
  var preflight = getConferenceHousePreflight(removedHouse);
  var removeMessage = preflight.occupantCount
    ? 'إزالة البيت "' + (removedHouse.name || 'بيت غير مسمى') + '"؟ يحتوي على ' + preflight.floorCount + ' دور و' + preflight.roomCount + ' غرفة و' + preflight.occupantCount + ' نزيل. سيتم حذف بيانات التسكين نهائيًا.'
    : 'إزالة البيت "' + (removedHouse.name || 'بيت غير مسمى') + '"؟ يحتوي على ' + preflight.floorCount + ' دور و' + preflight.roomCount + ' غرفة.';
  if(!confirm(removeMessage)) return;

  var removedRoomIds = {};
  preflight.roomIds.forEach(function(roomId){ removedRoomIds[roomId] = true; });

  current.houses.splice(idx, 1);
  ensureAccommodationDisplayState(current);
  current.accommodationDisplayedRoomIds = (current.accommodationDisplayedRoomIds || []).filter(function(id){
    return !removedRoomIds[id];
  });
  if(!(current.houses || []).length){
    current.accommodationDisplayedRoomIds = [];
  }
  if(!save())return false;
  if(activeRoomsManager.houseId === houseId){
    closeAddRoomPickerModal();
  }
  renderAccommodation();
  showToast('🗑️ تم إزالة بيت المؤتمر');
}

function getRoomMoveTargets(excludeRoomId){
  var current = getCurrentConference();
  if(!current) return [];
  return getRoomMoveTargetsFromHouses(current.houses || [], excludeRoomId);
}

function pickTargetRoomPrompt(excludeRoomId, title, options, onSelect){
  options = options || {};
  var targets = (editRoomData && editRoomData.draftHouses)
    ? getRoomMoveTargetsFromHouses(editRoomData.draftHouses, excludeRoomId)
    : getRoomMoveTargets(excludeRoomId);
  if(options.activeOnly){
    var displayed = getActiveRoomIdsMap();
    targets = targets.filter(function(t){ return !!displayed[t.room.id]; });
  }
  if(options.sameHouseOnly && options.sourceHouseId){
    targets = targets.filter(function(t){ return t.house.id === options.sourceHouseId; });
  }
  if(options.excludeHouseId && options.excludeFloorId){
    targets = targets.filter(function(t){ return !(t.house.id === options.excludeHouseId && t.floor.id === options.excludeFloorId); });
  }
  if(!targets.length){
    alert('لا توجد غرف أخرى متاحة للاختيار.');
    return;
  }
  var items = targets.map(function(t){
    var occ = countRoomOccupancy(t.room);
    var cap = parseInt(t.room.beds, 10) || 1;
    return {
      label: (t.house.name || 'بيت') + ' / ' + (t.floor.name || 'دور') + ' / غرفة ' + (t.room.number || '-') + ' (' + occ + '/' + cap + ')',
      searchText: (t.house.name || '') + ' ' + (t.floor.name || '') + ' ' + (t.room.number || ''),
      data: t
    };
  });
  openSearchableSelectDialog(title || 'اختر الغرفة الهدف', items, function(picked){
    if(typeof onSelect === 'function') onSelect(picked || null);
  });
}

function openNewRoomForFloor(houseId, floorId) {
  openActiveRoomsManager(houseId);
}

function renderAddRoomPickerModal(){
  openActiveRoomsManager(activeRoomsManager.houseId);
}

function closeAddRoomPickerModal(){
  ge('addRoomFromTemplateModal').style.display = 'none';
  activeRoomsManager.houseId = null;
}

function confirmAddRoomFromTemplate(){
  closeAddRoomPickerModal();
}

function openActiveRoomsManager(houseId){
  if(!requireAccommodationMutation())return false;
  var house = getHouseById(houseId);
  if(!house){
    alert('لا يمكن فتح إدارة الغرف النشطة: البيت غير موجود في المؤتمر الحالي.');
    return;
  }
  activeRoomsManager.houseId = houseId;
  renderActiveRoomsManager();
  ge('addRoomFromTemplateModal').style.display = 'flex';
}

function renderActiveRoomsManager(){
  var current = getCurrentConference();
  var house = getHouseById(activeRoomsManager.houseId);
  var container = ge('active_rooms_container');
  if(!container || !current || !house) return;
  var displayed = ensureAccommodationDisplayState(current);
  var h = '<div style="margin-bottom:10px;color:#5a7a9a;font-size:11px">اختر الغرف النشطة التي تظهر في شاشة التسكين.</div>';
  h += '<div class="row" style="gap:6px;margin-bottom:10px;flex-wrap:wrap">';
  h += '<button class="btn btn-blue btn-sm" onclick="setAllActiveRoomsForHouse(true)">تحديد الكل</button>';
  h += '<button class="btn btn-gray btn-sm" onclick="setAllActiveRoomsForHouse(false)">إلغاء تحديد الكل</button>';
  h += '</div>';
  (house.floors || []).forEach(function(floor){
    h += '<div style="border:1px solid #E5EEF7;border-radius:10px;padding:8px 10px;margin-bottom:10px;background:#FAFCFF">';
    h += '<div style="font-weight:700;color:#1F4E79;margin-bottom:6px">'+esc(floor.name || 'دور غير مسمى')+'</div>';
    h += '<div class="row" style="gap:6px">';
    h += '<button class="btn btn-blue btn-sm" onclick="setAllActiveRoomsForFloor(\'' + house.id + '\',\'' + floor.id + '\',true)">تحديد الدور</button>';
    h += '<button class="btn btn-gray btn-sm" onclick="setAllActiveRoomsForFloor(\'' + house.id + '\',\'' + floor.id + '\',false)">إلغاء تحديد الدور</button>';
    h += '</div></div>';
    if((floor.rooms || []).length){
      (floor.rooms || []).forEach(function(room){
        var checked = !!displayed[room.id];
        h += '<label class="modal-list-item'+(checked?' selected':'')+'" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #E5EEF7;border-radius:8px;margin-bottom:6px;background:' + (checked ? '#EAF8EF' : '#fff') + ';cursor:pointer">';
        h += '<input type="checkbox" style="width:auto" ' + (checked ? 'checked' : '') + ' onchange="toggleActiveRoom(\'' + room.id + '\', this.checked)">';
        h += '<div style="flex:1;min-width:0"><div style="font-weight:700">غرفة ' + esc(room.number || '') + '</div><div style="font-size:10px;color:#7a8ea6">' + (parseInt(room.beds, 10) || 1) + ' أسرة</div></div>';
        h += '</label>';
      });
    }else{
      h += '<div style="color:#AAB5C0;font-size:11px;padding:4px 0">لا توجد غرف في هذا الدور</div>';
    }
    h += '</div>';
  });
  var availableTemplateRooms = getAvailableTemplateRoomsForConferenceHouse(house);
  if (availableTemplateRooms.length) {
    h += '<div style="margin-top:12px;border-top:1px solid #DDE8F2;padding-top:10px">';
    h += '<div style="font-weight:700;color:#1F4E79;margin-bottom:8px">غرف جديدة متاحة من القالب</div>';
    availableTemplateRooms.forEach(function(room) {
      h += '<div class="modal-list-item" style="display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid #E5EEF7;border-radius:8px;margin-bottom:6px;background:#fff">';
      h += '<div style="flex:1;min-width:0"><div style="font-weight:700">غرفة ' + esc(room.number || '') + '</div>';
      h += '<div style="font-size:10px;color:#7a8ea6">' + esc(room.templateFloorName || '') + ' • ' + room.beds + ' أسرة</div></div>';
      if (room.conferenceFloorId) {
        h += '<button class="btn btn-green btn-sm" onclick="addAvailableTemplateRoom(\'' + room.templateRoomId + '\')">إضافة</button>';
      } else {
        h += '<span style="font-size:10px;color:#C0392B">أضف الدور أولًا</span>';
      }
      h += '</div>';
    });
    h += '</div>';
  }
  container.innerHTML = h;
}

function addAvailableTemplateRoom(templateRoomId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('addAvailableTemplateRoom',null))return false;
  if(!requireAccommodationMutation())return false;
  var current = getCurrentConference();
  var house = getHouseById(activeRoomsManager.houseId);
  if(!current || !house)return false;
  var previousHouses = deepClone(current.houses || []);
  var previousDisplayedRoomIds = (current.accommodationDisplayedRoomIds || []).slice();
  var previousDisplayInitialized = current.accommodationDisplayStateInitialized;
  var room = addAvailableTemplateRoomToConferenceHouse(house, templateRoomId);
  if(!room){
    renderActiveRoomsManager();
    return false;
  }
  var prepared = prepareAccommodationDisplayedRoomIds(current, [room.id], true);
  if(!prepared.ok){
    current.houses = previousHouses;
    renderActiveRoomsManager();
    return false;
  }
  commitAccommodationDisplayChange(current, prepared.ids, []);
  if(!save()){
    current.houses = previousHouses;
    current.accommodationDisplayedRoomIds = previousDisplayedRoomIds;
    current.accommodationDisplayStateInitialized = previousDisplayInitialized;
    return false;
  }
  addActivityLog('room_created','تم إنشاء الغرفة '+room.number,{section:'accommodation',entityType:'room',entityId:room.id});
  renderAccommodation();
  renderActiveRoomsManager();
  return true;
}

function toggleActiveRoom(roomId, checked){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('toggleActiveRoom',null))return false;
  if(!requireAccommodationMutation())return false;
  var current = getCurrentConference();
  if(!current) return;
  var result = findRoomByIdInHouses(current.houses || [], roomId);
  if(!result){
    renderActiveRoomsManager();
    return;
  }
  if(checked){
    if(result.room.closed){
      alert('لا يمكن تنشيط غرفة مغلقة');
      renderActiveRoomsManager();
      return;
    }
    var prepared = prepareAccommodationDisplayedRoomIds(current, [roomId], true);
    if(!prepared.ok){ renderActiveRoomsManager(); return; }
    commitAccommodationDisplayChange(current, prepared.ids, []);
  }else if(!deactivateAccommodationRoom(roomId)){
    renderActiveRoomsManager();
    return;
  }
  if(!save())return false;
  addActivityLog(checked?'room_created':'room_deleted',checked?'تم إنشاء الغرفة '+result.room.number:'تم حذف الغرفة '+result.room.number,{section:'accommodation',entityType:'room',entityId:result.room.id});
  renderAccommodation();
  renderActiveRoomsManager();
}

function setAllActiveRoomsForFloor(houseId, floorId, checked){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('setAllActiveRoomsForFloor',null))return false;
  if(!requireAccommodationMutation())return false;
  var current = getCurrentConference();
  var house = getHouseById(houseId);
  var floor = null;
  if(!current || !house) return;
  (house.floors || []).forEach(function(f){ if(!floor && f.id === floorId) floor = f; });
  if(!floor) return;
  var rooms = (floor.rooms || []).filter(function(room){ return !checked || !room.closed; });
  var normalized = prepareAccommodationDisplayedRoomIds(current, [], true);
  if(!normalized.ok) return;
  var active = {};
  normalized.ids.forEach(function(id){ active[id] = true; });
  var affectedRooms = checked ? rooms.filter(function(room){ return !active[room.id]; }) : rooms.filter(function(room){ return !!active[room.id]; });
  var preflight = getAccommodationRoomsPreflight(affectedRooms);
  if(!checked){
    var floorMessage = 'إلغاء تنشيط غرف الدور "' + (floor.name || 'دور غير مسمى') + '"؟ عدد الغرف المتأثرة ' + preflight.roomCount + '، منها ' + preflight.occupiedRoomCount + ' غرفة مشغولة، وبها ' + preflight.guestCount + ' ضيف و' + preflight.childCount + ' طفل، بإجمالي ' + preflight.occupantCount + ' نزيل.';
    if(preflight.occupantCount) floorMessage += ' سيتم مسح بيانات تسكينهم.';
    if(!confirm(floorMessage)) return;
  }
  var prepared = prepareAccommodationDisplayedRoomIds(current, preflight.roomIds, checked);
  if(!prepared.ok) return;
  commitAccommodationDisplayChange(current, prepared.ids, checked ? [] : preflight.occupiedRooms);
  if(!save())return false;
  affectedRooms.forEach(function(room){addActivityLog(checked?'room_created':'room_deleted',checked?'تم إنشاء الغرفة '+room.number:'تم حذف الغرفة '+room.number,{section:'accommodation',entityType:'room',entityId:room.id})});
  renderAccommodation();
  renderActiveRoomsManager();
}

function setAllActiveRoomsForHouse(checked){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('setAllActiveRoomsForHouse',null))return false;
  if(!requireAccommodationMutation())return false;
  var current = getCurrentConference();
  var house = getHouseById(activeRoomsManager.houseId);
  if(!current || !house) return;
  var rooms = [];
  (house.floors || []).forEach(function(floor){
    (floor.rooms || []).forEach(function(room){
      if(!checked || !room.closed) rooms.push(room);
    });
  });
  var normalized = prepareAccommodationDisplayedRoomIds(current, [], true);
  if(!normalized.ok) return;
  var active = {};
  normalized.ids.forEach(function(id){ active[id] = true; });
  var affectedRooms = checked ? rooms.filter(function(room){ return !active[room.id]; }) : rooms.filter(function(room){ return !!active[room.id]; });
  var preflight = getAccommodationRoomsPreflight(affectedRooms);
  if(!checked){
    var houseMessage = 'إلغاء تنشيط غرف البيت "' + (house.name || 'بيت غير مسمى') + '"؟ عدد الغرف ' + preflight.roomCount + '، منها ' + preflight.occupiedRoomCount + ' غرفة مشغولة، وبها ' + preflight.guestCount + ' ضيف و' + preflight.childCount + ' طفل، بإجمالي ' + preflight.occupantCount + ' نزيل.';
    if(preflight.occupantCount) houseMessage += ' سيتم مسح بيانات تسكينهم.';
    if(!confirm(houseMessage)) return;
  }
  var prepared = prepareAccommodationDisplayedRoomIds(current, preflight.roomIds, checked);
  if(!prepared.ok) return;
  commitAccommodationDisplayChange(current, prepared.ids, checked ? [] : preflight.occupiedRooms);
  if(!save())return false;
  affectedRooms.forEach(function(room){addActivityLog(checked?'room_created':'room_deleted',checked?'تم إنشاء الغرفة '+room.number:'تم حذف الغرفة '+room.number,{section:'accommodation',entityType:'room',entityId:room.id})});
  renderAccommodation();
  renderActiveRoomsManager();
}

function validateExtraBedsReduction(oldValue, newValue, capacity){
  if(newValue >= oldValue) return { ok: true };
  var allRows = getGuestSlotData();
  var rowsToRemove = allRows.slice(capacity + newValue);
  var occupiedRows = rowsToRemove.filter(function(row){ return row.name.trim() !== ''; });
  if(occupiedRows.length > 0){
    var firstExtraIndex = newValue + 1;
    return { ok: false, message: '⚠️ لا يمكن تقليل الأسرة الإضافية. السرير الإضافي ' + firstExtraIndex + ' بها نزيل(ة). يرجى إزالة النزيل أولاً.' };
  }
  return { ok: true };
}

function renderRoomEditorFromDraft(){
  closeGuestPersonPicker();
  var draftResult = findRoomInHouses(editRoomData.draftHouses, editRoomData.houseId, editRoomData.floorId, editRoomData.roomId)
    || findRoomByIdInHouses(editRoomData.draftHouses, editRoomData.roomId);
  if(!draftResult || !draftResult.room){
    alert('تعذر فتح بيانات الغرفة.');
    closeRM();
    return;
  }

  editRoomData.houseId = draftResult.house.id;
  editRoomData.floorId = draftResult.floor.id;
  editRoomData.roomId = draftResult.room.id;

  ge('rmTitle').textContent = 'تعديل الغرفة ' + draftResult.room.number;
  ge('rmContext').textContent = draftResult.house.name + ' • ' + draftResult.floor.name;
  ge('m_num').value = draftResult.room.number;
  ge('m_beds').value = draftResult.room.beds;
  ge('m_extra_beds').value = draftResult.room.extraBeds || 0;
  ge('m_notes').value = draftResult.room.notes || '';
  ge('m_closed').checked = !!draftResult.room.closed;
  ge('m_closed_day').value = draftResult.room.closedDay || '';
  ge('m_closed_day').disabled = !draftResult.room.closed;
  ge('m_num').disabled = true;
  ge('m_beds').disabled = true;
  ge('m_notes').disabled = false;

  var moveBtn = ge('moveRoomBtn');
  if (moveBtn) {
    moveBtn.onclick = function(){ openMoveRoomDialog(editRoomData.houseId, editRoomData.floorId, editRoomData.roomId); };
  }

  ge('m_guests').innerHTML = '';
  ge('m_children').innerHTML = '';
  refreshPeopleDatalist({ assignedMap: getEditorAssignedMap(editRoomData.roomId), excludeAssigned: true, excludeRoomId: editRoomData.roomId });

  var days = getDays();
  var extraBeds = draftResult.room.extraBeds || 0;
  syncGuestSlotsByCapacity(draftResult.room.beds || 1, (draftResult.room.guests || []), days, extraBeds);
  (draftResult.room.children || []).forEach(function(c) { addCI(c.name, c.guardian, c.leftDay, c.personId, c.guardianPersonId, c.id, c.arrivalDay); });
  ge('rmGuestsCount').textContent = (draftResult.room.guests || []).filter(function(g){return !!String(g&&g.name||'').trim();}).length;
  ge('rmChildrenCount').textContent = (draftResult.room.children || []).filter(function(c){return !!String(c&&c.name||'').trim();}).length;

  ge('m_closed').onchange = function(){
    ge('m_closed_day').disabled = !this.checked;
    if(!this.checked) ge('m_closed_day').value = '';
  };

  var oldExtraBeds = draftResult.room.extraBeds || 0;
  var capacity = draftResult.room.beds || 1;
  ge('m_extra_beds').onchange = function(){
    var newValue = parseInt(this.value, 10) || 0;
    if(newValue < oldExtraBeds){
      var validation = validateExtraBedsReduction(oldExtraBeds, newValue, capacity);
      if(!validation.ok){
        alert(validation.message);
        this.value = oldExtraBeds;
        return;
      }
    }
    oldExtraBeds = newValue;
    var currentGuests = getGuestSlotData();
    ge('m_guests').innerHTML = '';
    syncGuestSlotsByCapacity(capacity, currentGuests, getDays(), newValue);
    currentGuests.forEach(function(slot) { bindGuestPersonRow(slot.id); });
  };

}

function openRoomEditor(houseId, floorId, roomId) {
  if(!requireAccommodationMutation())return false;
  var result = roomId ? (getRoomByContext(houseId, floorId, roomId) || getRoomById(roomId)) : null;
  var room = result ? result.room : null;
  var floor = result ? result.floor : null;
  var house = result ? result.house : null;
  if (!room) {
    alert('إضافة الغرف من شاشة التسكين غير متاحة. اختر غرفة من زر إضافة غرفة في الدور.');
    return;
  }
  if (!house || !floor) {
    house = getHouseById(houseId);
    if (!house) return;
    (house.floors || []).forEach(function(item) {
      if (!floor && item.id === floorId) floor = item;
    });
    if (!floor) return;
  }

  editRoomData = {
    houseId: house.id,
    floorId: floor.id,
    roomId: room ? room.id : null,
    draftHouses: deepClone((getCurrentConference() || {}).houses || []),
    fullRoomMove: null
  };

  renderRoomEditorFromDraft();

  ge('roomModal').style.display='flex';
}

function closeRM(){
  closeGuestPersonPicker();
  ge('roomModal').style.display='none';
  editRoomData = {};
}
function getAssignedPeopleInEditor() {
  var assigned = {};
  var modal = ge('roomModal');
  if (!modal || modal.style.display === 'none') {
    return assigned;
  }
  modal.querySelectorAll('.guest-person-row').forEach(function(row) {
    var personId = row.querySelector('.person-id');
    if (personId && personId.value) {
      assigned[personId.value] = true;
    }
  });
  return assigned;
}

function bindGuestPersonRow(rowId,options){
  var row = ge(rowId);
  if(!row) return;
  var nameInput = row.querySelector('.person-name');
  var idInput = row.querySelector('.person-id');
  var metaEl = row.querySelector('.person-meta');
  if(!nameInput || !idInput) return;
  if(!nameInput.value.trim()&&row.getAttribute('data-bed-type')==='extra'){
    row.querySelectorAll('.extra-bed-person-type').forEach(function(input){input.checked=false});
  }
  var person = findPersonByName(nameInput.value);
  if(person){
    if (isPersonAssignedElsewhereInEditor(person.id, editRoomData.roomId)) {
      idInput.value = '';
      nameInput.style.borderColor = '#E74C3C';
      if(metaEl) metaEl.textContent = 'هذا الشخص مسكن بالفعل في غرفة أخرى.';
      return;
    }
    idInput.value = person.id;
    nameInput.value = person.fullName;
    nameInput.style.borderColor = '#27AE60';
    if(metaEl) metaEl.textContent = personMetaText(person);

    var allInputs = Array.prototype.slice.call(document.querySelectorAll('#roomModal .person-name'));
    var currentIndex = allInputs.indexOf(nameInput);

    if (currentIndex > -1) {
      for (var i = currentIndex + 1; i < allInputs.length; i++) {
        if (allInputs[i].value.trim() === '') {
          allInputs[i].focus();
          if(options && options.reason === 'POST_SELECTION_NEXT_ROW'){
            var nextRow = allInputs[i].closest('.guest-person-row');
            if(nextRow) openGuestPersonPicker(nextRow.id, null, 'POST_SELECTION_NEXT_ROW');
          }
          break;
        }
      }
    }
  } else {
    idInput.value = '';
    nameInput.style.borderColor = nameInput.value ? '#F39C12' : '#BDD7EE';
    if(metaEl) metaEl.textContent = '';
  }

  var assignedInEditor = getAssignedPeopleInEditor();
  var assignedInConference = getAssignedPersonIdsInCurrentConference(editRoomData.roomId);
  for (var id in assignedInConference) {
    assignedInEditor[id] = true;
  }
  refreshPeopleDatalist({ assignedMap: assignedInEditor, excludeAssigned: false });
}

function ensureGuestPersonPickerPopover(){
  var popover = ge('guestPersonPickerPopover');
  if(popover) return popover;
  popover = document.createElement('section');
  popover.id = 'guestPersonPickerPopover';
  popover.className = 'guest-person-picker-popover';
  popover.setAttribute('role','dialog');
  popover.setAttribute('aria-modal','false');
  popover.setAttribute('aria-label','اختيار شخص');
  popover.innerHTML = '<div class="guest-person-picker-head"><div><strong>اختيار شخص</strong><span id="guestPersonPickerTarget"></span></div><button type="button" class="guest-person-picker-close" aria-label="إغلاق" onclick="closeGuestPersonPicker()">✕</button></div><div class="guest-person-picker-search-wrap"><span aria-hidden="true">⌕</span><input id="guestPersonPickerSearch" type="search" placeholder="بحث عن اسم أو رقم..." autocomplete="off" oninput="renderGuestPersonPickerList()"></div><div id="guestPersonPickerList" class="guest-person-picker-list"></div><div class="guest-person-picker-hint">اضغط لاختيار شخص — البحث يعمل تلقائيًا</div>';
  document.body.appendChild(popover);
  return popover;
}

function removeGuestPersonPickerListeners(){
  if(guestPersonPickerOutsideHandler){
    document.removeEventListener('pointerdown',guestPersonPickerOutsideHandler,true);
    guestPersonPickerOutsideHandler = null;
  }
  if(guestPersonPickerPositionHandler){
    window.removeEventListener('resize',guestPersonPickerPositionHandler);
    window.removeEventListener('scroll',guestPersonPickerPositionHandler,true);
    if(window.visualViewport){
      window.visualViewport.removeEventListener('resize',guestPersonPickerPositionHandler);
      window.visualViewport.removeEventListener('scroll',guestPersonPickerPositionHandler);
    }
    guestPersonPickerPositionHandler = null;
  }
}

function closeGuestPersonPicker(){
  var popover = ge('guestPersonPickerPopover');
  var targetRow = ge(guestPersonPickerState.rowId);
  if(targetRow) targetRow.classList.remove('guest-person-picker-target');
  if(popover){ popover.classList.remove('is-open','place-above'); popover.style.display = 'none'; }
  removeGuestPersonPickerListeners();
  guestPersonPickerState = { rowId: '', items: [], onSelect: null };
}

function renderGuestPersonPickerList(){
  var list = ge('guestPersonPickerList');
  var search = ge('guestPersonPickerSearch');
  if(!list) return;
  var queryText = search ? search.value.trim() : '';
  var query = normalizePersonKey(queryText);
  list.innerHTML = '';
  var shown = 0;
  guestPersonPickerState.items.forEach(function(item){
    var haystack = normalizePersonKey(item.searchText || item.label || '');
    if(query && haystack.indexOf(query) === -1) return;
    var button = document.createElement('button');
    button.type = 'button';button.className = 'guest-person-picker-option';
    var icon = document.createElement('span');
    icon.className = 'guest-person-picker-icon';icon.setAttribute('aria-hidden','true');icon.textContent = '●';
    var text = document.createElement('span');text.className = 'guest-person-picker-text';
    var name = document.createElement('strong');name.textContent = item.label;text.appendChild(name);
    if(item.secondaryText){
      var phone = document.createElement('small');phone.className = 'guest-person-picker-phone';phone.textContent = item.secondaryText;text.appendChild(phone);
    }
    var arrow = document.createElement('span');arrow.className = 'guest-person-picker-arrow';arrow.setAttribute('aria-hidden','true');arrow.textContent = '‹';
    button.appendChild(icon);button.appendChild(text);button.appendChild(arrow);
    button.onclick = function(){
      var select = guestPersonPickerState.onSelect;
      closeGuestPersonPicker();
      if(typeof select === 'function') select(item.data);
    };
    list.appendChild(button);shown++;
  });
  var existingPerson = queryText ? findPersonByName(queryText) : null;
  if(query && !existingPerson){
    var createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'guest-person-picker-option guest-person-picker-new-name';
    createButton.textContent = 'استخدام "' + queryText + '" كاسم جديد';
    createButton.onclick = function(){ selectGuestPersonPickerNewName(queryText); };
    list.appendChild(createButton);shown++;
  }
  if(!shown) list.innerHTML = '<div class="guest-person-picker-empty">لا توجد نتائج</div>';
}

function selectGuestPersonPickerNewName(name){
  name = String(name || '').trim();
  if(!name) return;
  var row = ge(guestPersonPickerState.rowId);
  var nameInput = row && row.querySelector('.person-name');
  var idInput = row && row.querySelector('.person-id');
  if(!nameInput || !idInput) return;
  nameInput.value = name;
  idInput.value = '';
  var rowId = row.id;
  closeGuestPersonPicker();
  bindGuestPersonRow(rowId);
}

function positionGuestPersonPicker(){
  var popover = ge('guestPersonPickerPopover');
  var row = ge(guestPersonPickerState.rowId);
  var input = row && row.querySelector('.person-name');
  if(!popover || !input || !popover.classList.contains('is-open')) return;
  var rect = input.getBoundingClientRect();
  var viewport = window.visualViewport;
  var viewportTop = viewport ? viewport.offsetTop : 0;
  var viewportLeft = viewport ? viewport.offsetLeft : 0;
  var viewportWidth = viewport ? viewport.width : window.innerWidth;
  var viewportHeight = viewport ? viewport.height : window.innerHeight;
  var gap = 8;
  var availableBelow = viewportTop + viewportHeight - rect.bottom - gap;
  var availableAbove = rect.top - viewportTop - gap;
  var placeAbove = availableBelow < 230 && availableAbove > availableBelow;
  var available = Math.max(180,(placeAbove ? availableAbove : availableBelow) - gap);
  var width = Math.min(560,Math.max(286,Math.min(rect.width + 110,viewportWidth - 16)));
  popover.style.width = width + 'px';
  popover.style.setProperty('--guest-person-picker-max-height',Math.min(470,available) + 'px');
  popover.classList.toggle('place-above',placeAbove);
  var measuredHeight = Math.min(popover.offsetHeight,Math.min(470,available));
  var left = Math.max(viewportLeft + 8,Math.min(rect.right - width,viewportLeft + viewportWidth - width - 8));
  var top = placeAbove ? rect.top - measuredHeight - gap : rect.bottom + gap;
  top = Math.max(viewportTop + 8,Math.min(top,viewportTop + viewportHeight - measuredHeight - 8));
  popover.style.left = left + 'px';popover.style.top = top + 'px';
}

function openGuestPersonPickerPopover(rowId,items,onSelect){
  closeGuestPersonPicker();
  var row = ge(rowId);
  var input = row && row.querySelector('.person-name');
  if(!row || !input) return;
  var popover = ensureGuestPersonPickerPopover();
  guestPersonPickerState = { rowId: rowId, items: items || [], onSelect: onSelect || null };
  row.classList.add('guest-person-picker-target');
  var target = ge('guestPersonPickerTarget');
  if(target) target.textContent = row.getAttribute('data-slot-label') || 'الخانة الحالية';
  var search = ge('guestPersonPickerSearch');if(search) search.value = '';
  popover.style.display = 'flex';popover.classList.add('is-open');
  renderGuestPersonPickerList();positionGuestPersonPicker();
  guestPersonPickerPositionHandler = positionGuestPersonPicker;
  window.addEventListener('resize',guestPersonPickerPositionHandler);
  window.addEventListener('scroll',guestPersonPickerPositionHandler,true);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',guestPersonPickerPositionHandler);
    window.visualViewport.addEventListener('scroll',guestPersonPickerPositionHandler);
  }
  guestPersonPickerOutsideHandler = function(outsideEvent){
    if(popover.contains(outsideEvent.target) || input === outsideEvent.target) return;
    closeGuestPersonPicker();
  };
  document.addEventListener('pointerdown',guestPersonPickerOutsideHandler,true);
  var focusSearch = function(){ if(search){ search.focus();positionGuestPersonPicker(); } };
  if(window.requestAnimationFrame) window.requestAnimationFrame(focusSearch); else setTimeout(focusSearch,0);
}

function openGuestPersonPicker(rowId,event,reason){
  var postSelection = reason === 'POST_SELECTION_NEXT_ROW';
  if(!postSelection && (!event || event.isTrusted !== true)) return;
  var row = ge(rowId);
  if(!row) return;
  var nameInput = row.querySelector('.person-name');
  var idInput = row.querySelector('.person-id');
  if(!nameInput || !idInput) return;
  var assigned = getEditorAssignedMap(editRoomData.roomId);
  var assignedInEditor = getAssignedPeopleInEditor();
  Object.keys(assignedInEditor).forEach(function(personId){ assigned[personId] = true; });
  if(idInput.value) delete assigned[idInput.value];
  var items = getPeopleList().filter(function(person){
    return person && person.id && !assigned[person.id];
  }).map(function(person){
    return {
      label: person.fullName,
      secondaryText: person.phone || '',
      searchText: person.fullName + ' ' + (person.phone || ''),
      data: person
    };
  });
  openGuestPersonPickerPopover(rowId,items,function(person){
    if(!person) return;
    nameInput.value = person.fullName;
    idInput.value = person.id;
    bindGuestPersonRow(rowId,{reason:'POST_SELECTION_NEXT_ROW'});
  });
}

function openGuestPersonPickerFromKeyboard(rowId,event){
  if(!event || event.isTrusted !== true || ['Enter','ArrowDown'].indexOf(event.key) < 0) return;
  event.preventDefault();
  openGuestPersonPicker(rowId,event);
}

function accommodationArrivalDayOptions(days,selected){
  days=parseInt(days,10)||1;
  selected=normalizeAccommodationArrivalDay(selected,days);
  var html='';
  for(var day=1;day<=days;day++){
    html+='<option value="'+day+'" '+(day===selected?'selected':'')+'>اليوم '+day+'</option>';
  }
  return html;
}

function createGuestSlotRow(slot, index, days, isExtra, capacity){
  slot = slot || {};
  var name = slot.name || '';
  var personId = slot.personId || '';
  var guestId = slot.guestId || '';
  var arrivalDay = normalizeAccommodationArrivalDay(slot.arrivalDay,days);
  var leftDay = slot.leftDay || '';
  var extraBedPersonType = slot.extraBedPersonType==='adult'||slot.extraBedPersonType==='child'?slot.extraBedPersonType:'';
  var id = 'g_' + uid();
  var div = document.createElement('div');
  div.className = 'guest-person-row';
  div.id = id;
  div.setAttribute('data-bed-type',isExtra?'extra':'');
  var slotLabel = '';
  if(isExtra){
    var extraIndex = index - (capacity || 0) + 1;
    div.setAttribute('data-slot-label','سرير إضافي ' + extraIndex);
    slotLabel = '<div class="guest-slot-label guest-slot-label-extra">سرير إضافي ' + extraIndex + '</div>';
  } else {
    div.setAttribute('data-slot-label','سرير ' + (index + 1));
    slotLabel = '<div class="guest-slot-label">سرير ' + (index + 1) + '</div>';
  }
  var extraTypeControls = isExtra
    ? '<div class="extra-bed-type-controls"><span>نوع الاستخدام</span><label><input class="extra-bed-person-type" type="radio" name="extra_bed_type_'+id+'" value="adult" '+(extraBedPersonType==='adult'?'checked':'')+' style="width:auto"> بالغ</label><label><input class="extra-bed-person-type" type="radio" name="extra_bed_type_'+id+'" value="child" '+(extraBedPersonType==='child'?'checked':'')+' style="width:auto"> طفل</label></div>'
    : '';
  div.innerHTML = slotLabel
    + '<div class="guest-slot-person">'
    + '<input class="person-name" style="width:100%;border-color:' + (name ? '#27AE60' : '#BDD7EE') + '" placeholder="ابحث أو اكتب اسمًا" value="' + esc(name) + '" onclick="openGuestPersonPicker(\''+id+'\',event)" onkeydown="openGuestPersonPickerFromKeyboard(\''+id+'\',event)" oninput="bindGuestPersonRow(\''+id+'\')">'
    + '<input type="hidden" class="person-id" value="' + esc(personId) + '">'
    + '<input type="hidden" class="guest-entry-id" value="' + esc(guestId) + '">'
    + '<div class="person-meta" style="font-size:9px;color:#5a7a9a;margin-top:2px"></div>'
    + '</div>'
    + extraTypeControls
    + '<div class="guest-slot-day guest-slot-arrival"><label class="lbl">يوم الوصول</label>'
    + '<select class="guest-arrival-day" style="width:78px;font-size:10px">' + accommodationArrivalDayOptions(days, arrivalDay) + '</select></div>'
    + '<div class="guest-slot-day guest-slot-left"><label class="lbl">غادر يوم</label>'
    + '<select class="guest-left-day" style="width:70px;font-size:10px">' + dayOptions(days, leftDay) + '</select></div>'
    + '<button class="btn btn-blue btn-sm guest-slot-move" type="button" onclick="openMoveGuestDialog(\''+id+'\')" title="نقل النزيل">↔️</button>'
    + '<button class="btn btn-red btn-sm guest-slot-remove" type="button" onclick="removeGuestFromEditorRow(\''+id+'\')" title="إزالة النزيل">✕</button>';
  return div;
}

function getGuestSlotData(){
  var rows = [];
  ge('m_guests').querySelectorAll('.guest-person-row').forEach(function(row){
    var inp = row.querySelector('.person-name');
    var pid = row.querySelector('.person-id');
    var gid = row.querySelector('.guest-entry-id');
    var arrivalSelect = row.querySelector('.guest-arrival-day');
    var leftSelect = row.querySelector('.guest-left-day');
    var extraType = row.querySelector('.extra-bed-person-type:checked');
    rows.push({
      id: row.id,
      guestId: gid ? gid.value : '',
      name: inp ? inp.value.trim() : '',
      personId: pid ? pid.value : '',
      arrivalDay: normalizeAccommodationArrivalDay(arrivalSelect&&arrivalSelect.value,getDays()),
      leftDay: leftSelect && leftSelect.value ? parseInt(leftSelect.value, 10) : null,
      bedType: row.getAttribute('data-bed-type')==='extra'?'extra':'',
      extraBedPersonType: extraType?extraType.value:''
    });
  });
  return rows;
}

function syncGuestSlotsByCapacity(capacity, seedGuests, days, extraBeds){
  capacity = parseInt(capacity, 10) || 1;
  extraBeds = parseInt(extraBeds, 10) || 0;
  days = days || getDays();
  var totalSlots = capacity + extraBeds;
  var slots = [];
  if (Array.isArray(seedGuests)) {
    slots = seedGuests.map(function(g){ return { guestId: g.guestId || g.id || '', name: g.name || '', personId: g.personId || '', arrivalDay:normalizeAccommodationArrivalDay(g.arrivalDay,days), leftDay: g.leftDay || null, bedType: g.bedType==='extra'?'extra':'', extraBedPersonType:g.extraBedPersonType==='adult'||g.extraBedPersonType==='child'?g.extraBedPersonType:'' }; });
  } else {
    slots = getGuestSlotData();
  }
  
  // Keep original order - only adjust size
  var out = slots.slice(0, totalSlots);  // Keep first totalSlots items
  while (out.length < totalSlots) {
    out.push({ name: '', personId: '', arrivalDay:1, leftDay: null, guestId: '' });
  }

  var container = ge('m_guests');
  container.innerHTML = '';
  out.forEach(function(slot, i){
    var isExtra = i >= capacity;
    var row = createGuestSlotRow(slot, i, days, isExtra, capacity);
    container.appendChild(row);
    bindGuestPersonRow(row.id);
  });
}

function bindChildPersonRow(rowId, field){
  var row = ge(rowId);
  if(!row) return;
  var inputClass = field === 'guardian' ? '.guardian-name' : '.child-name';
  var hiddenClass = field === 'guardian' ? '.guardian-person-id' : '.child-person-id';
  var input = row.querySelector(inputClass);
  var hidden = row.querySelector(hiddenClass);
  if(!input || !hidden) return;
  var person = findPersonByName(input.value);
  if(person){
    hidden.value = person.id;
    input.value = person.fullName;
    input.style.borderColor = '#27AE60';
  } else {
    hidden.value = '';
    input.style.borderColor = input.value ? '#F39C12' : '#BDD7EE';
  }
}

function addGuestInput(name, leftDay, days, personId, arrivalDay) {
  var slots = getGuestSlotData();
  slots.push({ guestId: '', name: name || '', personId: personId || '', arrivalDay:normalizeAccommodationArrivalDay(arrivalDay,days||getDays()), leftDay: leftDay || null });
  syncGuestSlotsByCapacity(slots.length, slots, days || getDays());
}

function applyEditorFormToDraftRoom(){
  var roomResult = findRoomInHouses(editRoomData.draftHouses, editRoomData.houseId, editRoomData.floorId, editRoomData.roomId)
    || findRoomByIdInHouses(editRoomData.draftHouses, editRoomData.roomId);
  if (!roomResult || !roomResult.room) return { ok: false };
  var room = roomResult.room;
  var roomCapacity = parseInt(room.beds, 10) || 1;
  var conferenceDays=getDays();

  var guests = [];
  var missingExtraBedPersonType = false;
  var invalidStayRange = false;
  ge('m_guests').querySelectorAll('.guest-person-row').forEach(function(d,index){
    var inp = d.querySelector('.person-name');
    var pid = d.querySelector('.person-id');
    var gid = d.querySelector('.guest-entry-id');
    var arrivalSelect = d.querySelector('.guest-arrival-day');
    var leftSelect = d.querySelector('.guest-left-day');
    var extraType = d.querySelector('.extra-bed-person-type:checked');
    if(inp && inp.value.trim()){
      var personId = pid ? pid.value : '';
      if(personId && isPersonAssignedElsewhereInEditor(personId, room.id)) personId = '';
      var finalName = resolvePersonName(personId, inp.value.trim());
      var arrivalDay=normalizeAccommodationArrivalDay(arrivalSelect&&arrivalSelect.value,conferenceDays);
      var leftDay=leftSelect&&leftSelect.value?parseInt(leftSelect.value,10):null;
      if(!isAccommodationStayRangeValid(arrivalDay,leftDay,conferenceDays))invalidStayRange=true;
      var guest={
        id: gid && gid.value ? gid.value : (d.id.startsWith('g_') ? d.id.substring(2) : uid()),
        personId: personId || null,
        name: finalName,
        arrivalDay:arrivalDay,
        leftDay:leftDay
      };
      if(index >= roomCapacity){
        guest.bedType='extra';
        if(extraType&&(extraType.value==='adult'||extraType.value==='child')) guest.extraBedPersonType=extraType.value;
        else missingExtraBedPersonType=true;
      }
      guests.push(guest);
    }
  });

  if(missingExtraBedPersonType){
    alert('اختر نوع مستخدم السرير الإضافي: بالغ أو طفل.');
    return { ok: false };
  }
  if(invalidStayRange){
    alert('يجب أن يكون يوم المغادرة بعد يوم الوصول.');
    return { ok: false };
  }

  var seenPerson = {};
  for(var gi=0; gi<guests.length; gi++){
    if(!guests[gi].personId) continue;
    if(seenPerson[guests[gi].personId]){
      alert('لا يمكن تسكين نفس الشخص أكثر من مرة في نفس الغرفة.');
      return { ok: false };
    }
    if(isPersonAssignedElsewhereInEditor(guests[gi].personId, room.id)){
      alert('يوجد شخص مسكن بالفعل في غرفة أخرى.');
      return { ok: false };
    }
    seenPerson[guests[gi].personId] = true;
  }

  var children = [];
  ge('m_children').querySelectorAll('.child-box').forEach(function(box){
    var childInput = box.querySelector('.child-name');
    var childIdInput = box.querySelector('.child-person-id');
    var guardianInput = box.querySelector('.guardian-name');
    var guardianIdInput = box.querySelector('.guardian-person-id');
    var arrivalSelect = box.querySelector('.child-arrival-day');
    var leftSelect = box.querySelector('.child-left-day');
    if(childInput && childInput.value.trim()){
      var childPersonId = childIdInput ? childIdInput.value : '';
      if(!childPersonId){
        var childPerson = findPersonByName(childInput.value.trim());
        childPersonId = childPerson ? childPerson.id : '';
      }
      var guardianPersonId = guardianIdInput ? guardianIdInput.value : '';
      if(!guardianPersonId && guardianInput && guardianInput.value.trim()){
        var guardianPerson = findPersonByName(guardianInput.value.trim());
        guardianPersonId = guardianPerson ? guardianPerson.id : '';
      }
      var childArrivalDay=normalizeAccommodationArrivalDay(arrivalSelect&&arrivalSelect.value,conferenceDays);
      var childLeftDay=leftSelect&&leftSelect.value?parseInt(leftSelect.value,10):null;
      if(!isAccommodationStayRangeValid(childArrivalDay,childLeftDay,conferenceDays))invalidStayRange=true;
      children.push({
        id: box.id.startsWith('ci_') ? box.id.substring(3) : uid(),
        personId: childPersonId || null,
        name: resolvePersonName(childPersonId, childInput.value.trim()),
        guardianPersonId: guardianPersonId || null,
        guardian: resolvePersonName(guardianPersonId, guardianInput ? guardianInput.value.trim() : ''),
        arrivalDay:childArrivalDay,
        leftDay:childLeftDay
      });
    }
  });

  if(invalidStayRange){
    alert('يجب أن يكون يوم المغادرة بعد يوم الوصول.');
    return { ok: false };
  }

  room.notes = ge('m_notes').value || '';
  room.closed = !!ge('m_closed').checked;
  room.closedDay = room.closed ? (ge('m_closed_day').value ? parseInt(ge('m_closed_day').value, 10) : null) : null;
  room.extraBeds = (function(){ var v = parseInt(ge('m_extra_beds').value,10); return isNaN(v) ? 0 : v; })();
  room.guests = guests;
  syncRoomGuestBedTypes(room);
  room.children = children;
  return { ok: true, room: room, floor: roomResult.floor, house: roomResult.house };
}

function removeGuestFromEditorRow(rowId){
  if(!editRoomData || !editRoomData.draftHouses) return;
  var row = ge(rowId);
  if(!row) return;
  var nameInput = row.querySelector('.person-name');
  var pidInput = row.querySelector('.person-id');
  var gidInput = row.querySelector('.guest-entry-id');
  var guestId = gidInput ? gidInput.value : '';
  var guestName = nameInput ? nameInput.value.trim() : '';
  var guestPersonId = pidInput ? pidInput.value : '';
  if(nameInput)nameInput.value='';
  if(!applyEditorFormToDraftRoom().ok){
    if(nameInput)nameInput.value=guestName;
    return;
  }
  var roomResult = findRoomInHouses(editRoomData.draftHouses, editRoomData.houseId, editRoomData.floorId, editRoomData.roomId)
    || findRoomByIdInHouses(editRoomData.draftHouses, editRoomData.roomId);
  if(!roomResult || !roomResult.room) return;
  if(guestId){
    roomResult.room.guests = (roomResult.room.guests || []).filter(function(g){ return g.id !== guestId; });
  }else{
    var removed = false;
    roomResult.room.guests = (roomResult.room.guests || []).filter(function(g){
      if(removed) return true;
      if(guestPersonId && g.personId === guestPersonId){ removed = true; return false; }
      if(!guestPersonId && g.name === guestName){ removed = true; return false; }
      return true;
    });
  }
  syncRoomGuestBedTypes(roomResult.room);
  renderRoomEditorFromDraft();
}

function openMoveGuestDialog(rowId){
  if(!editRoomData || !editRoomData.draftHouses) return;
  if(!applyEditorFormToDraftRoom().ok) return;

  var row = ge(rowId);
  if(!row) return;
  var nameInput = row.querySelector('.person-name');
  var pidInput = row.querySelector('.person-id');
  var gidInput = row.querySelector('.guest-entry-id');
  var arrivalSelect = row.querySelector('.guest-arrival-day');
  var daySelect = row.querySelector('.guest-left-day');
  var guestName = nameInput ? nameInput.value.trim() : '';
  var guestPersonId = pidInput ? pidInput.value : '';
  var guestId = gidInput ? gidInput.value : '';
  var arrivalDay = normalizeAccommodationArrivalDay(arrivalSelect&&arrivalSelect.value,getDays());
  var leftDay = daySelect && daySelect.value ? parseInt(daySelect.value, 10) : null;

  if(!guestName){
    alert('اختر نزيلاً أولاً.');
    return;
  }

  pickTargetRoomPrompt(editRoomData.roomId, 'نقل نزيل', { activeOnly: true }, function(targetRoomResult){
    if(!targetRoomResult) return;

    var sourceRoomResult = findRoomInHouses(editRoomData.draftHouses, editRoomData.houseId, editRoomData.floorId, editRoomData.roomId)
      || findRoomByIdInHouses(editRoomData.draftHouses, editRoomData.roomId);
    if(!sourceRoomResult || !sourceRoomResult.room) return;

    var sourceRoom = sourceRoomResult.room;
    var targetRoom = targetRoomResult.room;

    if(guestPersonId && isPersonAssignedElsewhereInEditor(guestPersonId, editRoomData.roomId)){
      alert('يوجد شخص مسكن بالفعل في غرفة أخرى.');
      return;
    }

    var guestsToMoveCount = gl({ leftDay: leftDay }) ? 0 : 1;

    var validation = prepareTransfer(sourceRoom, targetRoom, guestsToMoveCount, { sameHouseOnly: false });

    if (!validation.canTransfer) {
      alert(validation.message || 'لا يمكن إتمام عملية النقل.');
      return;
    }

    if (validation.needsExtraBeds > 0) {
      if (!confirm('الغرفة الهدف لا تسع النزيل. هل تريد إضافة ' + validation.needsExtraBeds + ' سرير إضافي تلقائياً؟')) {
        return;
      }
      targetRoom.extraBeds = (parseInt(targetRoom.extraBeds, 10) || 0) + validation.needsExtraBeds;
      targetRoom.autoExtraBeds = (parseInt(targetRoom.autoExtraBeds || 0, 10) || 0) + validation.needsExtraBeds;
    }

    var movedGuest = null;
    if(guestId){
      (sourceRoomResult.room.guests || []).forEach(function(g){ if(!movedGuest && g.id === guestId) movedGuest = deepClone(g); });
      sourceRoomResult.room.guests = (sourceRoomResult.room.guests || []).filter(function(g){ return g.id !== guestId; });
    } else {
      var removed = false;
      sourceRoomResult.room.guests = (sourceRoomResult.room.guests || []).filter(function(g){
        if(removed) return true;
        if(guestPersonId && g.personId === guestPersonId){ movedGuest = deepClone(g); removed = true; return false; }
        if(!guestPersonId && g.name === guestName){ movedGuest = deepClone(g); removed = true; return false; }
        return true;
      });
    }

    if(!movedGuest){
      movedGuest = {
        id: guestId || uid(),
        personId: guestPersonId || null,
        name: resolvePersonName(guestPersonId, guestName),
        arrivalDay:arrivalDay,
        leftDay: leftDay
      };
    }

    targetRoom.guests = targetRoom.guests || [];
    targetRoom.guests.push(movedGuest);

    var movedChildren = [];
    sourceRoomResult.room.children = (sourceRoomResult.room.children || []).filter(function(c){
      var isLinked = false;
      if(movedGuest.personId && c.guardianPersonId && c.guardianPersonId === movedGuest.personId) isLinked = true;
      if(!isLinked && !c.guardianPersonId && c.guardian && movedGuest.name && c.guardian === movedGuest.name) isLinked = true;
      if(isLinked){ movedChildren.push(c); return false; }
      return true;
    });
    if(movedChildren.length){
      cleanupAutoExtraBeds(sourceRoomResult.room);
      targetRoom.children = targetRoom.children || [];
      targetRoom.children = targetRoom.children.concat(movedChildren);
    }

    cleanupAutoExtraBeds(sourceRoomResult.room);
    syncRoomGuestBedTypes(sourceRoomResult.room);
    syncRoomGuestBedTypes(targetRoom);
    renderRoomEditorFromDraft();
    showToast('↔️ تم نقل النزيل (مؤقتًا حتى الحفظ)');
  });
}

function openMoveRoomDialog(houseId, floorId, roomId){
  if(!requireAccommodationMutation())return false;
  var useDraft = !!(editRoomData && editRoomData.draftHouses);
  var sourceResult = useDraft
    ? (findRoomInHouses(editRoomData.draftHouses, houseId, floorId, roomId) || findRoomByIdInHouses(editRoomData.draftHouses, roomId))
    : (getRoomByContext(houseId, floorId, roomId) || getRoomById(roomId));
  if(!sourceResult || !sourceResult.room) return;

  if(useDraft && ge('roomModal').style.display === 'flex'){
    if(!applyEditorFormToDraftRoom().ok) return;
  }

  pickTargetRoomPrompt(roomId, 'نقل تسكين الغرفة', {
    activeOnly: true,
    sameHouseOnly: true,
    sourceHouseId: sourceResult.house.id
  }, function(targetRoomResult){
    if(!targetRoomResult) return;
    if(!requireAccommodationMutation())return;

    var sourceRoom = sourceResult.room;
    var targetRoom = targetRoomResult.room;
    var sourceExtraBedsBefore=parseInt(sourceRoom.extraBeds,10)||0;
    var sourceResidentCount=(sourceRoom.guests||[]).length+(sourceRoom.children||[]).length;
    var incomingOccupancy = countRoomOccupancy(sourceRoom);

    if(sourceResidentCount === 0){
      alert('لا يوجد نزلاء أو أطفال لنقلهم من الغرفة المصدر.');
      return;
    }

    console.log("SOURCE", sourceRoom);
    console.log("TARGET", targetRoomResult);
    console.log("TARGET.ROOM", targetRoomResult && targetRoomResult.room);
    console.log("CALL", prepareTransfer);

    var validation = prepareTransfer(sourceRoom, targetRoom, incomingOccupancy, {
      sameHouseOnly: true,
      sourceHouseId: sourceResult.house.id,
      targetHouseId: targetRoomResult.house.id
    });

    if (!validation.canTransfer) {
      alert(validation.message || 'لا يمكن إتمام عملية النقل.');
      return;
    }

    var doFullTransfer = function(){
      var sourceSnapshot = deepClone({guests:sourceRoom.guests||[],children:sourceRoom.children||[],extraBeds:sourceRoom.extraBeds,autoExtraBeds:sourceRoom.autoExtraBeds});
      var targetSnapshot = deepClone({guests:targetRoom.guests||[],children:targetRoom.children||[],extraBeds:targetRoom.extraBeds,autoExtraBeds:targetRoom.autoExtraBeds});
      var duplicateGuest = (sourceRoom.guests || []).some(function(guest){
        return (targetRoom.guests || []).some(function(targetGuest){ return isSameAccommodationGuest(guest,targetGuest); });
      });
      var duplicateChild = (sourceRoom.children || []).some(function(child){
        return (targetRoom.children || []).some(function(targetChild){ return isSameAccommodationGuest(child,targetChild); });
      });
      if(duplicateGuest || duplicateChild){
        alert('تعذر النقل لأن بعض بيانات الغرفة المصدر موجودة بالفعل في الغرفة الهدف.');
        return false;
      }
      if (validation.needsExtraBeds > 0) {
        targetRoom.extraBeds = (parseInt(targetRoom.extraBeds, 10) || 0) + validation.needsExtraBeds;
        targetRoom.autoExtraBeds = (parseInt(targetRoom.autoExtraBeds || 0, 10) || 0) + validation.needsExtraBeds;
      }
      targetRoom.guests = (targetRoom.guests || []).concat(sourceRoom.guests || []);
      targetRoom.children = (targetRoom.children || []).concat(sourceRoom.children || []);
      sourceRoom.guests = [];
      sourceRoom.children = [];
      cleanupAutoExtraBeds(sourceRoom);
      syncRoomGuestBedTypes(sourceRoom);
      syncRoomGuestBedTypes(targetRoom);
      var fullSourceUpdated = sourceRoom.guests.length === 0 && sourceRoom.children.length === 0;
      var fullTargetUpdated = targetRoom.guests.length === targetSnapshot.guests.length + sourceSnapshot.guests.length &&
        targetRoom.children.length === targetSnapshot.children.length + sourceSnapshot.children.length;
      if(!fullSourceUpdated || !fullTargetUpdated){
        restorePartialTransferRoomSnapshot(sourceRoom,sourceSnapshot);
        restorePartialTransferRoomSnapshot(targetRoom,targetSnapshot);
        alert('لم يتم نقل بيانات الغرفة لأن تحديث المصدر أو الهدف لم يكتمل.');
        return false;
      }

      if(useDraft){
        editRoomData.fullRoomMove={sourceId:sourceRoom.id,targetId:targetRoom.id,sourceNumber:sourceRoom.number||'',targetNumber:targetRoom.number||''};
        renderRoomEditorFromDraft();
        showToast('↔️ تم نقل بيانات الغرفة (مؤقتًا حتى الحفظ)');
        return;
      }

      var current = getCurrentConference();
      setRoomDisplayedInAccommodation(current, sourceResult.room.id, true);
      if(!save()){
        restorePartialTransferRoomSnapshot(sourceRoom,sourceSnapshot);
        restorePartialTransferRoomSnapshot(targetRoom,targetSnapshot);
        alert('تعذر حفظ نقل الغرفة. لم يتم اعتماد أي تغيير على الغرفتين.');
        return false;
      }
      if(sourceResidentCount)addActivityLog('room_occupancy_moved','تم نقل تسكين الغرفة '+sourceRoom.number+' إلى الغرفة '+targetRoom.number,{details:'الغرفة السابقة: '+sourceRoom.number+' — الغرفة الجديدة: '+targetRoom.number,section:'accommodation',entityType:'room',entityId:targetRoom.id});
      if(validation.needsExtraBeds>0)addActivityLog('extra_bed_added','تم إضافة سرير إضافي بالغرفة '+targetRoom.number,{details:'عدد الأسرة الإضافية: '+targetRoom.extraBeds,section:'accommodation',entityType:'room',entityId:targetRoom.id});
      if((parseInt(sourceRoom.extraBeds,10)||0)<sourceExtraBedsBefore)addActivityLog('extra_bed_removed','تم إزالة سرير إضافي من الغرفة '+sourceRoom.number,{details:'عدد الأسرة الإضافية: '+(parseInt(sourceRoom.extraBeds,10)||0),section:'accommodation',entityType:'room',entityId:sourceRoom.id});
      renderAccommodation();
      showToast('↔️ تم نقل بيانات الغرفة');

      if(editRoomData && editRoomData.roomId === roomId){
        openRoomEditor(targetRoomResult.house.id, targetRoomResult.floor.id, targetRoomResult.room.id);
      }
    };

    var currentOccupancy = countRoomOccupancy(targetRoom);
    var targetCapacity = parseInt(targetRoom.beds, 10) || 1;
    var targetExtraBeds = parseInt(targetRoom.extraBeds || 0, 10);
    var totalTargetCapacity = targetCapacity + targetExtraBeds;
    var finalOccupancy = currentOccupancy + incomingOccupancy;

    if (finalOccupancy <= totalTargetCapacity) {
      doFullTransfer();
      return;
    }

    partialTransferState = {
      sourceRoom: sourceRoom,
      targetRoom: targetRoom,
      targetCapacity: parseInt(targetRoom.beds, 10) || 1,
      targetExtraBeds: parseInt(targetRoom.extraBeds || 0, 10),
      currentOccupancy: countRoomOccupancy(targetRoom),
      incomingOccupancy: incomingOccupancy,
      useDraft: useDraft,
      overflowConfirmed: true,
      selectedGuestIds: [],
      guestOptions: buildPartialTransferGuestOptions(sourceRoom)
    };
    renderPartialTransferActionView();
    var modal = ge('partialTransferModal');
    if(modal) modal.style.display = 'flex';
  });
}

function getAccommodationEffectiveCapacity(room){
  if(!room) return 0;
  var baseCapacity = Array.isArray(room.beds) ? room.beds.length : (parseInt(room.beds, 10) || 1);
  var extraBeds = Math.max(0, parseInt(room.extraBeds, 10) || 0);
  return baseCapacity + extraBeds;
}

function buildPartialTransferGuestOptions(room){
  var usedKeys = {};
  return (room && room.guests || []).map(function(guest,index){
    var baseKey = guest && guest.id
      ? 'guest:' + guest.id
      : guest && guest.personId
        ? 'person:' + guest.personId
        : 'legacy:' + index + ':' + uid();
    var key = baseKey;
    while(usedKeys[key]) key = baseKey + ':' + uid();
    usedKeys[key] = true;
    return { key: key, guest: guest };
  });
}

function getLivePartialTransferGuestOptions(state){
  if(!state || !state.sourceRoom) return [];
  var sourceGuests = state.sourceRoom.guests || [];
  state.guestOptions = (state.guestOptions || []).filter(function(option){
    return option && sourceGuests.indexOf(option.guest) !== -1;
  });
  return state.guestOptions;
}

function isSameAccommodationGuest(first,second){
  if(!first || !second) return false;
  if(first.personId && second.personId) return first.personId === second.personId;
  if(first.id && second.id) return first.id === second.id;
  return first === second;
}

function closePartialTransferModal(){
  var modal = ge('partialTransferModal');
  if(modal) modal.style.display = 'none';
  partialTransferState = {};
}

function renderPartialTransferActionView(){
  var state = partialTransferState;
  if(!state || !state.sourceRoom || !state.targetRoom) return;
  state.currentOccupancy = countRoomOccupancy(state.targetRoom);
  var effectiveCapacity = getAccommodationEffectiveCapacity(state.targetRoom);
  var finalOccupancy = state.currentOccupancy + state.incomingOccupancy;
  var overflow = Math.max(finalOccupancy - effectiveCapacity, 0);
  var content = '';
  setPartialTransferModalHeading('تنبيه تجاوز السعة','الغرفة الهدف ' + (state.targetRoom.number || ''),'⚠');
  content += '<section class="transfer-capacity-warning">';
  content += '<div class="transfer-warning-message"><span>!</span><div><strong>الغرفة الهدف ستتجاوز سعتها</strong><small>اختر النزلاء الذين تريد نقلهم بما يناسب المساحة المتاحة.</small></div></div>';
  content += '<div class="transfer-capacity-summary">';
  content += '<div><span>السعة</span><strong>' + effectiveCapacity + '</strong></div>';
  content += '<div><span>الإشغال الحالي</span><strong>' + state.currentOccupancy + '</strong></div>';
  content += '<div><span>الإشغال الوارد</span><strong>' + state.incomingOccupancy + '</strong></div>';
  content += '<div><span>الإشغال النهائي</span><strong>' + finalOccupancy + '</strong></div>';
  content += '<div class="is-overflow"><span>مقدار التجاوز</span><strong>+' + overflow + '</strong></div>';
  content += '</div></section>';
  content += '<div class="transfer-modal-footer">';
  content += '<button class="btn btn-purple" onclick="partialTransferSelectGuests()">اختيار نزلاء للنقل</button>';
  content += '<button class="btn btn-gray" onclick="closePartialTransferModal()">إلغاء</button>';
  content += '</div>';
  ge('partialTransferContent').innerHTML = content;
}

function setPartialTransferModalHeading(title,context,icon){
  var titleElement = ge('partialTransferTitle');
  var contextElement = ge('partialTransferContext');
  var iconElement = ge('partialTransferIcon');
  if(titleElement) titleElement.textContent = title || 'نقل جزئي';
  if(contextElement) contextElement.textContent = context || '';
  if(iconElement) iconElement.textContent = icon || '↔';
}

function partialTransferContinue(){
  renderPartialTransferGuestView();
}

function partialTransferSelectGuests(){
  if(!requireAccommodationMutation())return false;
  renderPartialTransferGuestView();
}

function renderPartialTransferGuestView(){
  var state = partialTransferState;
  if(!state || !state.sourceRoom || !state.targetRoom) return;
  state.currentOccupancy = countRoomOccupancy(state.targetRoom);
  var totalTargetCapacity = getAccommodationEffectiveCapacity(state.targetRoom);
  var totalAvailable = Math.max(totalTargetCapacity - state.currentOccupancy, 0);
  var guestOptions = getLivePartialTransferGuestOptions(state);
  var validKeys = {};
  guestOptions.forEach(function(option){ validKeys[option.key] = true; });
  state.selectedGuestIds = (state.selectedGuestIds || []).filter(function(id){ return !!validKeys[id]; });
  var selected = state.selectedGuestIds.length;
  var selectedOccupancy = guestOptions.filter(function(option){
    return state.selectedGuestIds.indexOf(option.key) !== -1 && !gl(option.guest);
  }).length;
  var willNeedExtra = Math.max(selectedOccupancy - totalAvailable, 0);
  var allSelected = guestOptions.length > 0 && selected === guestOptions.length;

  var content = '';
  setPartialTransferModalHeading('نقل جزئي','إلى الغرفة ' + (state.targetRoom.number || ''),'↔');
  content += '<div class="transfer-availability-summary"><span>السعة المتاحة في الغرفة الهدف</span><strong>' + totalAvailable + '</strong>';
  if(willNeedExtra > 0){
    content += '<small>سيتم إنشاء ' + willNeedExtra + ' أسرّة إضافية تلقائيًا وفق السياسة الحالية</small>';
  }
  content += '</div>';
  content += '<section class="partial-transfer-guests"><div class="partial-transfer-section-title"><div><strong>النزلاء في الغرفة المصدر</strong><small>الغرفة ' + esc(state.sourceRoom.number || '') + '</small></div>';
  content += '<label class="partial-transfer-select-all"><input type="checkbox"' + (allSelected ? ' checked' : '') + ' onchange="partialTransferToggleAll(this)"><span>اختر الكل</span></label></div>';

  if(!guestOptions.length){
    content += '<div class="partial-transfer-empty">لا يوجد نزلاء متاحون في الغرفة المصدر.</div>';
  } else {
    content += '<div id="partialTransferGuestList" class="partial-transfer-guest-list">';
    guestOptions.forEach(function(option){
      var g = option.guest || {};
      var checked = state.selectedGuestIds.indexOf(option.key) !== -1 ? ' checked' : '';
      var bedLabel = g.bedType === 'extra' ? 'سرير إضافي' : 'سرير أساسي';
      content += '<label class="partial-transfer-guest-row">';
      content += '<span class="partial-transfer-guest-icon">👤</span><span class="partial-transfer-guest-name"><strong>' + esc(g.name || '') + '</strong><small>' + bedLabel + '</small></span>';
      content += '<input type="checkbox"' + checked + ' onchange="partialTransferToggleGuestSelection(decodeURIComponent(\'' + encodeURIComponent(option.key) + '\'), this)">';
      content += '</label>';
    });
    content += '</div>';
  }
  content += '</section><div class="transfer-modal-footer">';
  content += '<button class="btn btn-blue" onclick="partialTransferConfirmSelection()">تأكيد النقل (' + selected + ')</button>';
  content += '<button class="btn btn-gray" onclick="closePartialTransferModal()">إلغاء</button></div>';
  ge('partialTransferContent').innerHTML = content;
}

function partialTransferToggleAll(checkbox){
  var state = partialTransferState;
  if(!state || !state.sourceRoom || !state.targetRoom) return;
  state.selectedGuestIds = checkbox.checked
    ? getLivePartialTransferGuestOptions(state).map(function(option){ return option.key; })
    : [];
  renderPartialTransferGuestView();
}

function partialTransferToggleGuestSelection(guestId, checkbox){
  var state = partialTransferState;
  if(!state || !state.sourceRoom || !state.targetRoom) return;
  state.selectedGuestIds = state.selectedGuestIds || [];
  if(checkbox.checked){
    if(state.selectedGuestIds.indexOf(guestId) === -1){
      state.selectedGuestIds.push(guestId);
    }
  } else {
    state.selectedGuestIds = state.selectedGuestIds.filter(function(id){ return id !== guestId; });
  }
  renderPartialTransferGuestView();
}

function partialTransferConfirmSelection(){
  var state = partialTransferState;
  if(!state || !state.sourceRoom || !state.targetRoom) return;
  var selectedIds = (state.selectedGuestIds || []).slice();
  if(!selectedIds.length){
    alert('❌ اختر نزيلاً واحداً على الأقل للنقل.');
    return;
  }

  var selectedMap = {};
  selectedIds.forEach(function(id){ selectedMap[id] = true; });
  var matchedOptions = getLivePartialTransferGuestOptions(state).filter(function(option){ return !!selectedMap[option.key]; });
  var matchedIds = matchedOptions.map(function(option){ return option.key; });
  var movedGuests = matchedOptions.map(function(option){ return option.guest; });
  if(!movedGuests.length || movedGuests.length !== selectedIds.length){
    alert('تعذر مطابقة النزلاء المحددين مع الغرفة المصدر. أعد فتح نافذة النقل وحاول مرة أخرى.');
    renderPartialTransferGuestView();
    return false;
  }

  var duplicateMovedGuest = movedGuests.some(function(guest,index){
    return movedGuests.slice(0,index).some(function(previousGuest){ return isSameAccommodationGuest(guest,previousGuest); });
  });
  if(duplicateMovedGuest){
    alert('تعذر النقل لأن قائمة الاختيار تحتوي على نزيل مكرر.');
    return false;
  }

  var targetGuestsBefore = state.targetRoom.guests || [];
  var hasDuplicateTargetGuest = movedGuests.some(function(guest){
    return targetGuestsBefore.some(function(targetGuest){ return isSameAccommodationGuest(guest,targetGuest); });
  });
  if(hasDuplicateTargetGuest){
    alert('تعذر النقل لأن أحد النزلاء المحددين موجود بالفعل في الغرفة الهدف.');
    return false;
  }

  var sourceSnapshot = deepClone({
    guests: state.sourceRoom.guests || [],
    children: state.sourceRoom.children || [],
    extraBeds: state.sourceRoom.extraBeds,
    autoExtraBeds: state.sourceRoom.autoExtraBeds
  });
  var targetSnapshot = deepClone({
    guests: state.targetRoom.guests || [],
    children: state.targetRoom.children || [],
    extraBeds: state.targetRoom.extraBeds,
    autoExtraBeds: state.targetRoom.autoExtraBeds
  });
  var sourceExtraBedsBefore = parseInt(state.sourceRoom.extraBeds,10) || 0;
  var targetExtraBeds = Math.max(0,parseInt(state.targetRoom.extraBeds,10) || 0);
  var currentOccupancy = countRoomOccupancy(state.targetRoom);
  var totalAvailable = getAccommodationEffectiveCapacity(state.targetRoom) - currentOccupancy;
  var movedOccupancy = movedGuests.filter(function(guest){ return !gl(guest); }).length;
  var needed = Math.max(movedOccupancy - totalAvailable, 0);
  var movedGuestReferences = movedGuests.slice();

  state.sourceRoom.guests = (state.sourceRoom.guests || []).filter(function(guest){
    return movedGuestReferences.indexOf(guest) === -1;
  });
  state.targetRoom.guests = targetGuestsBefore.concat(movedGuests.map(function(guest){ return deepClone(guest); }));
  if(needed > 0){
    state.targetRoom.extraBeds = targetExtraBeds + needed;
    state.targetRoom.autoExtraBeds = (parseInt(state.targetRoom.autoExtraBeds || 0, 10)) + needed;
  }

  var movedChildren = [];
  state.sourceRoom.children = (state.sourceRoom.children || []).filter(function(c){
    var isLinked = false;
    if(c.guardianPersonId && movedGuests.some(function(g){ return g.personId && g.personId === c.guardianPersonId; })) isLinked = true;
    if(!isLinked && !c.guardianPersonId && c.guardian && movedGuests.some(function(g){ return g.name && c.guardian === g.name; })) isLinked = true;
    if(isLinked){ movedChildren.push(c); return false; }
    return true;
  });
  var hasDuplicateTargetChild = movedChildren.some(function(child){
    return (state.targetRoom.children || []).some(function(targetChild){ return isSameAccommodationGuest(child,targetChild); });
  });
  if(hasDuplicateTargetChild){
    restorePartialTransferRoomSnapshot(state.sourceRoom,sourceSnapshot);
    restorePartialTransferRoomSnapshot(state.targetRoom,targetSnapshot);
    state.guestOptions = buildPartialTransferGuestOptions(state.sourceRoom);
    alert('تعذر النقل لأن أحد الأطفال المرتبطين موجود بالفعل في الغرفة الهدف.');
    renderPartialTransferGuestView();
    return false;
  }
  if(movedChildren.length){
    state.targetRoom.children = state.targetRoom.children || [];
    state.targetRoom.children = state.targetRoom.children.concat(movedChildren.map(function(child){ return deepClone(child); }));
  }

  cleanupAutoExtraBeds(state.sourceRoom);
  syncRoomGuestBedTypes(state.sourceRoom);
  syncRoomGuestBedTypes(state.targetRoom);
  var sourceUpdated = state.sourceRoom.guests.length === sourceSnapshot.guests.length - movedGuests.length &&
    movedGuestReferences.every(function(guest){ return state.sourceRoom.guests.indexOf(guest) === -1; });
  var targetUpdated = state.targetRoom.guests.length === targetSnapshot.guests.length + movedGuests.length &&
    movedGuests.every(function(guest){
      if(!guest.id && !guest.personId) return true;
      return (state.targetRoom.guests || []).some(function(targetGuest){ return isSameAccommodationGuest(guest,targetGuest); });
    });
  var movedCount = movedGuests.length;
  if(!sourceUpdated || !targetUpdated || movedCount === 0){
    restorePartialTransferRoomSnapshot(state.sourceRoom,sourceSnapshot);
    restorePartialTransferRoomSnapshot(state.targetRoom,targetSnapshot);
    state.guestOptions = buildPartialTransferGuestOptions(state.sourceRoom);
    alert('لم يتم النقل لأن تحديث الغرفة المصدر أو الهدف لم يكتمل.');
    renderPartialTransferGuestView();
    return false;
  }

  if(!state.useDraft){
    if(!save()){
      restorePartialTransferRoomSnapshot(state.sourceRoom,sourceSnapshot);
      restorePartialTransferRoomSnapshot(state.targetRoom,targetSnapshot);
      state.guestOptions = buildPartialTransferGuestOptions(state.sourceRoom);
      alert('تعذر حفظ النقل. لم يتم اعتماد أي تغيير على الغرفتين.');
      renderPartialTransferGuestView();
      return false;
    }
    movedGuests.forEach(function(guest){addActivityLog('guest_moved','تم نقل '+(gn(guest)||guest.name||'شخص')+' من الغرفة '+state.sourceRoom.number+' إلى الغرفة '+state.targetRoom.number,{details:'الغرفة السابقة: '+state.sourceRoom.number+' — الغرفة الجديدة: '+state.targetRoom.number,section:'accommodation',entityType:'person',entityId:guest.id||guest.personId||''})});
    if(needed>0)addActivityLog('extra_bed_added','تم إضافة سرير إضافي بالغرفة '+state.targetRoom.number,{details:'عدد الأسرة الإضافية: '+state.targetRoom.extraBeds,section:'accommodation',entityType:'room',entityId:state.targetRoom.id});
    if((parseInt(state.sourceRoom.extraBeds,10)||0)<sourceExtraBedsBefore)addActivityLog('extra_bed_removed','تم إزالة سرير إضافي من الغرفة '+state.sourceRoom.number,{details:'عدد الأسرة الإضافية: '+(parseInt(state.sourceRoom.extraBeds,10)||0),section:'accommodation',entityType:'room',entityId:state.sourceRoom.id});
    renderAccommodation();
  } else {
    renderRoomEditorFromDraft();
  }
  state.currentOccupancy = countRoomOccupancy(state.targetRoom);
  state.selectedGuestIds = [];
  closePartialTransferModal();
  var toastMsg = '↔️ تم نقل ' + movedCount + ' نزلاء';
  if(state.useDraft) toastMsg += ' (مؤقتًا حتى الحفظ)';
  if(needed > 0) toastMsg += ' (تم إنشاء ' + needed + ' أسرّة إضافية)';
  showToast(toastMsg);
  return { movedIds: matchedIds, movedCount: movedCount };
}

function restorePartialTransferRoomSnapshot(room,snapshot){
  if(!room || !snapshot) return;
  room.guests = deepClone(snapshot.guests || []);
  room.children = deepClone(snapshot.children || []);
  if(snapshot.extraBeds === undefined) delete room.extraBeds;
  else room.extraBeds = snapshot.extraBeds;
  if(snapshot.autoExtraBeds === undefined) delete room.autoExtraBeds;
  else room.autoExtraBeds = snapshot.autoExtraBeds;
}

function cleanupAutoExtraBeds(room){
  var autoExtra = parseInt(room.autoExtraBeds || 0, 10);
  if(autoExtra <= 0) return;
  var baseCapacity = parseInt(room.beds, 10) || 1;
  var totalExtra = parseInt(room.extraBeds || 0, 10);
  var manualExtra = Math.max(0, totalExtra - autoExtra);
  var guestCount = (room.guests || []).length;
  var occupiedExtra = Math.max(0, guestCount - baseCapacity);
  var autoNeeded = Math.max(0, occupiedExtra - manualExtra);
  var autoRemovable = autoExtra - autoNeeded;
  if(autoRemovable > 0){
    room.extraBeds = Math.max(0, totalExtra - autoRemovable);
    room.autoExtraBeds = autoExtra - autoRemovable;
    if(room.autoExtraBeds === 0) delete room.autoExtraBeds;
  }
}

function partialTransferGuest(guestId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('partialTransferGuest',null))return false;
  if(!requireAccommodationMutation())return false;
  var state = partialTransferState;
  if(!state || !state.sourceRoom || !state.targetRoom) return;
  state.currentOccupancy = countRoomOccupancy(state.targetRoom);
  var available = Math.max(getAccommodationEffectiveCapacity(state.targetRoom) - state.currentOccupancy, 0);
  if(available <= 0) return;

  var guestIndex = -1;
  var guest = null;
  (state.sourceRoom.guests || []).forEach(function(g, idx){ if(g && g.id === guestId) { guestIndex = idx; guest = g; } });
  if(guestIndex === -1 || !guest) return;

  var movedGuest = deepClone(guest);
  state.sourceRoom.guests.splice(guestIndex, 1);
  state.targetRoom.guests = state.targetRoom.guests || [];
  state.targetRoom.guests.push(movedGuest);
  syncRoomGuestBedTypes(state.sourceRoom);
  syncRoomGuestBedTypes(state.targetRoom);

  var movedChildren = [];
  state.sourceRoom.children = (state.sourceRoom.children || []).filter(function(c){
    var isLinked = false;
    if(guest.personId && c.guardianPersonId && c.guardianPersonId === guest.personId) isLinked = true;
    if(!isLinked && !c.guardianPersonId && c.guardian && guest.name && c.guardian === guest.name) isLinked = true;
    if(isLinked){ movedChildren.push(c); return false; }
    return true;
  });
  if(movedChildren.length){
    state.targetRoom.children = state.targetRoom.children || [];
    state.targetRoom.children = state.targetRoom.children.concat(movedChildren);
  }

  state.currentOccupancy += 1;
  if(!state.useDraft){
    if(!save())return false;
    addActivityLog('guest_moved','تم نقل '+(gn(guest)||guest.name||'شخص')+' من الغرفة '+state.sourceRoom.number+' إلى الغرفة '+state.targetRoom.number,{details:'الغرفة السابقة: '+state.sourceRoom.number+' — الغرفة الجديدة: '+state.targetRoom.number,section:'accommodation',entityType:'person',entityId:guest.id||guest.personId||''});
    renderAccommodation();
  } else {
    renderRoomEditorFromDraft();
  }
  renderPartialTransferGuestView();
}

function addCI(name,guardian,leftDay,personId,guardianPersonId,childId,arrivalDay){
  name=name||'';guardian=guardian||'';leftDay=leftDay||'';personId=personId||'';guardianPersonId=guardianPersonId||'';childId=childId||uid();
  var id='ci_'+childId;var days=getDays();
  arrivalDay=normalizeAccommodationArrivalDay(arrivalDay,days);
  var div=document.createElement('div');div.className='child-box';div.id=id;
  div.innerHTML='<div class="row"><div style="flex:2"><label class="lbl">اسم الطفل</label><input class="child-name" list="people_datalist" placeholder="الاسم" value="'+esc(name)+'" oninput="bindChildPersonRow(\''+id+'\',\'child\')"><input type="hidden" class="child-person-id" value="'+esc(personId)+'"></div>'
    +'<div style="flex:2"><label class="lbl">ولي الأمر</label><input class="guardian-name" list="people_datalist_guardian" placeholder="ولي الأمر" value="'+esc(guardian)+'" oninput="bindChildPersonRow(\''+id+'\',\'guardian\')"><input type="hidden" class="guardian-person-id" value="'+esc(guardianPersonId)+'"></div>'
    +'<button class="btn btn-purple btn-sm" style="align-self:flex-end;padding:6px 8px" onclick="openQuickAddPersonForChild(\''+id+'\',\'child\')">+ طفل</button>'
    +'<button class="btn btn-purple btn-sm" style="align-self:flex-end;padding:6px 8px" onclick="openQuickAddPersonForChild(\''+id+'\',\'guardian\')">+ ولي</button>'
    +'<button class="btn btn-red btn-sm" style="align-self:flex-end;padding:6px 8px" onclick="document.getElementById(\''+id+'\').remove()">✕</button></div>'
    +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:5px;font-size:10px"><span style="display:flex;align-items:center;gap:5px"><label class="lbl" style="margin:0">يوم الوصول:</label><select class="child-arrival-day" style="width:82px;font-size:10px">'+accommodationArrivalDayOptions(days,arrivalDay)+'</select></span><span style="display:flex;align-items:center;gap:5px"><label class="lbl" style="margin:0">غادر يوم:</label><select class="child-left-day" style="width:80px;font-size:10px">'+dayOptions(days,leftDay)+'</select></span></div>';
  ge('m_children').appendChild(div);
  bindChildPersonRow(id, 'child');
  bindChildPersonRow(id, 'guardian');
}

function saveRoomData(options){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveRoomData',null))return false;
  if(!requireAccommodationMutation())return false;
  options = options || {};
  if(!editRoomData || !editRoomData.draftHouses) return false;

  var applyRes = applyEditorFormToDraftRoom();
  if(!applyRes.ok) return false;

  var current = getCurrentConference();
  if(!current) return false;
  var previousHouses=deepClone(current.houses||[]);
  var fullRoomMove=editRoomData.fullRoomMove||null;
  current.houses = deepClone(editRoomData.draftHouses);
  linkRoomPeopleToDatabase(current);
  ensureAccommodationDisplayState(current);

  refreshPeopleDatalist({ excludeAssigned: true, excludeRoomId: applyRes.room.id });
  if(!save())return false;
  logAccommodationChanges(previousHouses,current.houses,{fullRoomMove:fullRoomMove});
  renderAccommodation();
  if(!options.keepOpen) closeRM();
  if(!options.silent) showToast('✅ تم حفظ بيانات الغرفة');
  return true;
}

function clearConferenceRoom(houseId, floorId, roomId) {
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('clearConferenceRoom',null))return false;
  if(!requireAccommodationMutation())return false;
  var result = getRoomByContext(houseId, floorId, roomId) || getRoomById(roomId);
  if (!result) return;
  if (!confirm('تفريغ بيانات الغرفة بالكامل؟ سيتم حذف النزلاء فقط مع بقاء رقم الغرفة والأسرة والملاحظات.')) return;
  var removedGuests=(result.room.guests||[]).slice();
  var removedChildren=(result.room.children||[]).slice();
  var previousExtraBeds=parseInt(result.room.extraBeds,10)||0;
  result.room.guests = [];
  result.room.children = [];
  // تنظيف الأسرّة الإضافية المؤقتة عند إخلاء الغرفة يدوياً
  cleanupAutoExtraBeds(result.room);
  if(!save())return false;
  removedGuests.forEach(function(guest){addActivityLog('guest_removed','تم حذف '+(gn(guest)||guest.name||'شخص')+' من الغرفة '+result.room.number,{section:'accommodation',entityType:'person',entityId:guest.id||guest.personId||''})});
  removedChildren.forEach(function(child){addActivityLog('child_removed','تم حذف طفل مرافق من الغرفة '+result.room.number,{details:child.name||'',section:'accommodation',entityType:'child',entityId:child.id||child.personId||''})});
  if((parseInt(result.room.extraBeds,10)||0)<previousExtraBeds)addActivityLog('extra_bed_removed','تم إزالة سرير إضافي من الغرفة '+result.room.number,{details:'عدد الأسرة الإضافية: '+(parseInt(result.room.extraBeds,10)||0),section:'accommodation',entityType:'room',entityId:result.room.id});
  renderAccommodation();
  showToast('🧹 تم تفريغ بيانات الغرفة');
}

function toggleConferenceRoomClosed(houseId, floorId, roomId) {
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('toggleConferenceRoomClosed',null))return false;
  if(!requireAccommodationMutation())return false;
  var result = getRoomByContext(houseId, floorId, roomId) || getRoomById(roomId);
  if (!result) return;
  result.room.closed = !result.room.closed;
  if(!save())return false;
  addActivityLog(result.room.closed?'room_closed':'room_opened',result.room.closed?'تم غلق الغرفة '+result.room.number:'تم فتح الغرفة '+result.room.number,{section:'accommodation',entityType:'room',entityId:result.room.id});
  renderAccommodation();
  showToast(result.room.closed ? '🔒 تم إغلاق الغرفة مؤقتًا' : '🔓 تم فتح الغرفة');
}

function deleteConferenceRoom(houseId, floorId, roomId) {
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deleteConferenceRoom',null))return false;
  if(!requireAccommodationMutation())return false;
  var result = getRoomByContext(houseId, floorId, roomId) || getRoomById(roomId);
  if (!result) return;
  if (!deactivateAccommodationRoom(result.room.id)) return;
  if(!save())return false;
  closeRM();
  addActivityLog('room_deleted','تم حذف الغرفة '+result.room.number,{section:'accommodation',entityType:'room',entityId:result.room.id});
  renderAccommodation();
  showToast('🗑️ تم إزالة الغرفة من التسكين');
}

// ═══════════════════════════════════════════════════════
// TAB 1: TRANSPORTS
// ═══════════════════════════════════════════════════════
function renderTransports(){
  var current = getCurrentConference();
  if (!current) {
    ge('tab1').innerHTML = '<div class="transport-empty-state transport-empty-state-standalone">'+accommodationIcon('bus')+'<strong>لا توجد بيانات مؤتمر جاهزة حالياً.</strong></div>';
    return;
  }
  var transports = current.transports || [];
  var canEditTransport=canEditCurrentConferenceData();
  var totalSeats=0,totalUsed=0;
  transports.forEach(function(transport){
    totalSeats+=transport.capacity;
    (transport.seats||[]).forEach(function(seat){
      if(seat.name&&seat.type!=='child_shared'&&seat.type!=='infant')totalUsed++;
    });
  });
  var totalAvailable=Math.max(0,totalSeats-totalUsed);
  var totalUnassigned=unassigned('').length;
  var h='<div class="transport-dashboard">';
  h+='<section class="transport-stats" aria-label="إحصائيات المواصلات">';
  h+='<article class="transport-stat transport-stat-primary"><span class="transport-stat-icon">'+accommodationIcon('bus')+'</span><div><strong>'+transports.length+'</strong><span>وسائل النقل</span></div></article>';
  h+='<article class="transport-stat transport-stat-primary"><span class="transport-stat-icon">'+accommodationIcon('building')+'</span><div><strong>'+totalSeats+'</strong><span>إجمالي المقاعد</span></div></article>';
  h+='<article class="transport-stat transport-stat-success"><span class="transport-stat-icon">'+accommodationIcon('user')+'</span><div><strong>'+totalUsed+'</strong><span>المقاعد المشغولة</span></div></article>';
  h+='<article class="transport-stat transport-stat-success"><span class="transport-stat-icon">'+accommodationIcon('checkCircle')+'</span><div><strong>'+totalAvailable+'</strong><span>المقاعد المتاحة</span></div></article>';
  h+='<article class="transport-stat transport-stat-warning"><span class="transport-stat-icon">'+accommodationIcon('users')+'</span><div><strong>'+totalUnassigned+'</strong><span>غير المسكنين</span></div></article>';
  h+='</section>';
  h+='<section class="transport-toolbar no-print"><div class="transport-toolbar-title"><span>'+accommodationIcon('bus')+'</span><div><strong>إدارة المواصلات</strong><small>وسائل النقل وتوزيع المقاعد</small></div></div>';
  if(canEditTransport){
    h+='<div class="transport-toolbar-actions">';
    if(transports.length) h+='<button class="btn transport-action-secondary" onclick="openBulkAssign()">'+accommodationIcon('users')+'<span>تسكين جماعي</span></button>';
    h+='<button class="btn transport-action-primary" onclick="openTM(null)">'+accommodationIcon('plus')+'<span>إضافة وسيلة</span></button>';
    h+='</div>';
  }
  h+='</section>';
  h+='<section class="transport-vehicles-workspace">';
  if(!transports.length){
    h+='<div class="transport-empty-state">'+accommodationIcon('bus')+'<strong>لا توجد وسائل مواصلات</strong><span>أضف وسيلة نقل لبدء توزيع المشاركين على المقاعد.</span>';
    if(canEditTransport)h+='<button class="btn transport-action-primary" onclick="openTM(null)">'+accommodationIcon('plus')+'<span>إضافة وسيلة</span></button>';
    h+='</div>';
  }
  transports.forEach(function(t){
    var realSeats = [], sharedKids = [];
    (t.seats || []).forEach(function(s) {
      if (s.name) {
        if (s.type !== 'child_shared' && s.type !== 'infant') {
          realSeats.push(s);
        } else {
          sharedKids.push(s);
        }
      }
    });
    // also collect riders stored on parent seats
    var riderList=[];
    t.seats.forEach(function(s){if(s.riders&&s.riders.length)s.riders.forEach(function(r,riderIndex){riderList.push({r:getTransportRiderData(r),riderIndex:riderIndex,parentSeat:s.seat,parentName:s.name})})});
    var used=realSeats.length;
    var available=Math.max(0,t.capacity-used);
    var occupancyPercent=t.capacity?Math.min(100,Math.round((used/t.capacity)*100)):0;
    var occupancyState=available===0?'full':available<=Math.max(2,Math.ceil(t.capacity*.15))?'near':'available';
    var occupancyText=occupancyState==='full'?'مكتمل':occupancyState==='near'?'قارب على الامتلاء':'متاح';
    h+='<article class="transport-vehicle-card transport-capacity-'+occupancyState+'">';
    h+='<header class="transport-vehicle-header"><span class="transport-vehicle-icon">'+accommodationIcon('bus')+'</span><div class="transport-vehicle-heading"><strong>'+esc(t.name)+'</strong><span>'+used+' / '+t.capacity+' كرسي</span></div><div class="transport-vehicle-status"><span class="transport-status-badge">'+occupancyText+'</span><small>المتاح: '+available+'</small></div>';
    if(canEditTransport)h+='<button class="btn transport-vehicle-edit" onclick="openTM(\''+t.id+'\')" aria-label="تعديل وسيلة النقل">'+accommodationIcon('settings')+'<span>تعديل</span></button>';
    h+='</header>';
    h+='<div class="transport-capacity-summary"><div><span>إشغال المقاعد</span><strong>'+occupancyPercent+'%</strong></div><div class="transport-capacity-track"><span style="width:'+occupancyPercent+'%"></span></div></div>';
    h+='<section class="transport-seat-section"><div class="transport-section-title"><div><span>'+accommodationIcon('bus')+'</span><strong>خريطة المقاعد</strong></div><div class="transport-seat-legend"><span class="is-empty">فارغ</span><span class="is-occupied">مشغول</span><span class="is-child">طفل</span><span class="is-shared">مشارك</span></div></div>';
    h+='<div class="seat-grid transport-seat-grid">';
    t.seats.forEach(function(s){
      var riders=s.riders&&s.riders.length?s.riders:[];
      var cls='seat'+(s.name?s.type==='child_seat'?' ch':s.type==='child_shared'||s.type==='infant'?' shared':' occ':'');
      var stateText=!s.name?'فارغ':s.type==='child_seat'?'طفل':s.type==='child_shared'||s.type==='infant'?'مشارك':'مشغول';
      var seatIcon=!s.name?'circle':s.type==='child_shared'||s.type==='infant'?'users':'user';
      var show=s.name?s.name.split(' ')[0]:'';
      h+='<div class="'+cls+' transport-seat" '+(canEditTransport?'onclick="openSM(\''+t.id+'\','+s.seat+')" ':'')+'title="'+(s.name||'فارغ')+(riders.length?' + '+riders.map(function(r){return getTransportRiderData(r).name}).join(', '):'')+'">';
      h+='<div class="transport-seat-head"><strong>'+s.seat+'</strong><span>'+accommodationIcon(seatIcon)+'</span></div><small>'+stateText+'</small>';
      if(show)h+='<span class="transport-seat-name">'+esc(show)+'</span>';
      if(riders.length)h+='<b class="transport-seat-linked">'+accommodationIcon('users')+' '+riders.length+'</b>';
      h+='</div>';
    });
    h+='</div></section>';
    if(sharedKids.length||riderList.length){
      h+='<section class="transport-shared-summary"><div class="transport-section-title"><div><span>'+accommodationIcon('users')+'</span><strong>الأطفال المشاركون</strong></div><small>لا يُحتسب لهم كرسي مستقل</small></div><div class="transport-shared-list">';
      sharedKids.forEach(function(s){h+='<span>'+accommodationIcon('users')+'<strong>'+esc(s.name)+'</strong><small>'+esc(formatTransportSeatLabel(s.note)||'مع ولي الأمر')+'</small></span>'});
      riderList.forEach(function(x){h+='<span>'+accommodationIcon('users')+'<strong>'+esc(x.r.name)+'</strong><small>مع '+esc(x.parentName||'المرافق')+' — كرسي '+x.parentSeat+'</small></span>'});
      h+='</div></section>';
    }
    if(used>0||sharedKids.length||riderList.length){
      h+='<section class="transport-passenger-section"><div class="transport-section-title"><div><span>'+accommodationIcon('users')+'</span><strong>تفاصيل الركاب</strong></div></div><div class="transport-passenger-list"><div class="transport-passenger-head"><span>الكرسي</span><span>الاسم</span><span>الغرفة</span><span>النوع</span>'+(canEditTransport?'<span>الإجراءات</span>':'')+'</div>';
      var occupiedSeats = [];
      (t.seats || []).forEach(function(s) {
        if (s.name && s.type !== 'child_shared' && s.type !== 'infant') {
          occupiedSeats.push(s);
        }
      });
      occupiedSeats.forEach(function(s){
        h+='<div class="transport-passenger-row"><b data-label="الكرسي">'+s.seat+'</b><span data-label="الاسم">'+esc(s.name)+(s.type==='child_seat'&&!s.personId?' <small class="transport-manual-badge">اسم يدوي</small>':'')+'</span><span data-label="الغرفة">'+esc(s.room)+'</span><span data-label="النوع"><i class="transport-passenger-type '+(s.type==='child_seat'?'is-child':'is-adult')+'">'+(s.type==='child_seat'?'طفل — كرسي مستقل':'بالغ')+'</i></span>';
        if(canEditTransport)h+='<span data-label="الإجراءات"><div class="transport-rider-actions"><button class="btn transport-row-edit" onclick="openSM(\''+t.id+'\','+s.seat+')">'+accommodationIcon('settings')+'<span>تعديل</span></button><button class="btn transport-row-delete" onclick="removeTransportSeatRider(\''+t.id+'\','+s.seat+',null)">'+accommodationIcon('close')+'<span>حذف</span></button></div></span>';
        h+='</div>';
      });
      sharedKids.forEach(function(s){
        h+='<div class="transport-passenger-row is-shared"><b data-label="الكرسي">'+s.seat+'</b><span data-label="الاسم">'+esc(s.name)+(!s.personId?' <small class="transport-manual-badge">اسم يدوي</small>':'')+'</span><span data-label="الغرفة">'+esc(s.room)+'</span><span data-label="النوع"><i class="transport-passenger-type is-shared">طفل مشارك — '+esc(formatTransportSeatLabel(s.note))+'</i></span>';
        if(canEditTransport)h+='<span data-label="الإجراءات"><div class="transport-rider-actions"><button class="btn transport-row-edit" onclick="openSM(\''+t.id+'\','+s.seat+')">'+accommodationIcon('settings')+'<span>تعديل</span></button><button class="btn transport-row-delete" onclick="removeTransportSeatRider(\''+t.id+'\','+s.seat+',null)">'+accommodationIcon('close')+'<span>حذف</span></button></div></span>';
        h+='</div>';
      });
      riderList.forEach(function(item){
        var riderEditHandler=item.r.type==='child_shared'?'openTransportRiderEditor(\''+t.id+'\','+item.parentSeat+','+item.riderIndex+')':'openSM(\''+t.id+'\','+item.parentSeat+')';
        h+='<div class="transport-passenger-row is-shared"><b data-label="الكرسي">'+item.parentSeat+'</b><span data-label="الاسم">'+esc(item.r.name)+(!item.r.personId?' <small class="transport-manual-badge">اسم يدوي</small>':'')+'</span><span data-label="الغرفة">'+esc(item.r.room||'')+'</span><span data-label="النوع"><i class="transport-passenger-type is-shared">طفل مشارك مع '+esc(item.parentName||'المرافق')+'</i></span>';
        if(canEditTransport)h+='<span data-label="الإجراءات"><div class="transport-rider-actions"><button class="btn transport-row-edit" onclick="'+riderEditHandler+'">'+accommodationIcon('settings')+'<span>تعديل</span></button><button class="btn transport-row-delete" onclick="removeTransportSeatRider(\''+t.id+'\','+item.parentSeat+','+item.riderIndex+')">'+accommodationIcon('close')+'<span>حذف</span></button></div></span>';
        h+='</div>';
      });
      h+='</div></section>';
    }
    h+='</article>';
  });
  h+='</section></div>';
  ge('tab1').innerHTML=h;
}

// ── Transport Modal ──────────────────────────────────────
function openTM(id){
  var current = getCurrentConference();
  var transports = current.transports || [];
  editTransId=id;ge('delTransBtn').style.display=id?'block':'none';
  if(id){
    var t = null;
    for (var i = 0; i < transports.length; i++) {
      if (transports[i].id === id) { t = transports[i]; break; }
    }
    if (!t) return;
    ge('tmTitle').textContent='✏️ '+t.name;ge('t_name').value=t.name;ge('t_icon').value=t.icon;ge('t_cap').value=t.capacity;
  }
  else{ge('tmTitle').textContent='➕ وسيلة جديدة';ge('t_name').value='';ge('t_icon').value='🚌';ge('t_cap').value='';}
  ge('transportModal').style.display='flex';
}
function closeTM(){ge('transportModal').style.display='none'}
function saveTransport(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveTransport',editTransportId?'update':'create'))return false;
  var current = getCurrentConference();
  var transports = current.transports || [];
  var name=ge('t_name').value.trim();var icon=ge('t_icon').value;var cap=parseInt(ge('t_cap').value);
  if(!name){alert('أدخل الاسم');return}if(!cap||cap<1||cap>300){alert('العدد 1-300');return}
  var successMessage='';
  if(editTransId){
    var t = null;
    for (var i = 0; i < transports.length; i++) {
      if (transports[i].id === editTransId) { t = transports[i]; break; }
    }
    if(t){
      if(cap < t.capacity){
        var removedSeats = (t.seats || []).filter(function(seat){ return seat.seat > cap; });
        var removedPassengers = removedSeats.filter(function(seat){ return !!seat.name; });
        if(removedPassengers.length && !confirm('تقليل السعة سيحذف ' + removedSeats.length + ' مقعد، منها ' + removedPassengers.length + ' مقعد مشغول. سيتم حذف بيانات الركاب الموجودين عليها. هل تريد المتابعة؟')) return;
      }
      t.name=name;t.icon=icon;
      if(cap!==t.capacity){
        var old=t.seats;t.seats=[];
        for(var i=1;i<=cap;i++){
          var ex = null;
          for (var j = 0; j < old.length; j++) { if (old[j].seat === i) { ex = old[j]; break; } }
          t.seats.push(ex||{seat:i,name:'',room:'',type:'adult',note:''});
        }
        t.capacity=cap;
      }
    }
    successMessage='✅ تم التعديل';
  } else {
    var seats=[];for(var i=1;i<=cap;i++)seats.push({seat:i,name:'',room:'',type:'adult',note:''});
    transports.push({id:uid(), name:name, icon:icon, capacity:cap, seats:seats});
    successMessage='✅ أُضيفت '+name;
  }
  if(!save())return false;
  closeTM();
  renderTransports();
  showToast(successMessage);
  return true;
}
function deleteTransport(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deleteTransport',null))return false;
  var current = getCurrentConference();
  var transports = current.transports || [];
  var t = null, tIndex = -1;
  for (var i = 0; i < transports.length; i++) {
    if (transports[i].id === editTransId) {
      t = transports[i];
      tIndex = i;
      break;
    }
  }

  if(!t || !confirm('حذف ' + t.name + '؟')) return;

  var index = tIndex;

  if(index !== -1){
    current.transports.splice(index,1);
  }

  if(!save())return false;
  closeTM();
  renderTransports();
  showToast('🗑️ تم حذف وسيلة المواصلات', '#E74C3C');
  return true;
}
// ── Seat Modal ───────────────────────────────────────────
var editSeatRiderIndex = null;
var seatManualSharedChildren = [];

function normalizeTransportSeatNumber(value){
  var match = String(value === undefined || value === null ? '' : value).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function formatTransportSeatLabel(value){
  var seatNumber = normalizeTransportSeatNumber(value);
  return seatNumber === null ? '' : 'كرسي ' + seatNumber;
}

function getAvailableTransportSeats(transport,options){
  options=options||{};
  var allowed={};
  (options.allowedSeatNumbers||[]).forEach(function(value){
    var seatNumber=normalizeTransportSeatNumber(value);
    if(seatNumber!==null)allowed[seatNumber]=true;
  });
  var excluded={};
  (options.excludedSeatNumbers||[]).forEach(function(value){
    var seatNumber=normalizeTransportSeatNumber(value);
    if(seatNumber!==null)excluded[seatNumber]=true;
  });
  var adultSeatNumber=normalizeTransportSeatNumber(options.adultSeatNumber);
  return ((transport&&transport.seats)||[]).filter(function(seat){
    var seatNumber=normalizeTransportSeatNumber(seat.seat);
    if(seatNumber===null||seatNumber===adultSeatNumber||excluded[seatNumber])return false;
    return !seat.name||allowed[seatNumber];
  }).map(function(seat){return normalizeTransportSeatNumber(seat.seat);}).sort(function(a,b){return a-b;});
}

function buildAvailableTransportSeatOptions(seatNumbers,selectedValue){
  var selectedSeat=normalizeTransportSeatNumber(selectedValue);
  var h='<option value="">'+(seatNumbers.length?'اختر كرسيًا متاحًا':'لا توجد كراسٍ متاحة')+'</option>';
  seatNumbers.forEach(function(seatNumber){
    h+='<option value="'+seatNumber+'" '+(seatNumber===selectedSeat?'selected':'')+'>'+esc(formatTransportSeatLabel(seatNumber))+'</option>';
  });
  return h;
}

function getTransportRiderData(rider){
  return rider && rider.r ? rider.r : (rider || {});
}

function getTransportById(transportId){
  var current = getCurrentConference();
  var found = null;
  ((current && current.transports) || []).forEach(function(transport){ if(transport.id === transportId) found = transport; });
  return found;
}

function renderSeatGuardianOptions(selectedSeatNumber){
  var select = ge('s_guardian_select');
  var transport = getTransportById(editSeatTransId);
  if(!select || !transport) return;
  select.innerHTML = '<option value="">— اختر المرافق —</option>';
  (transport.seats || []).forEach(function(seat){
    if(!seat.name || seat.type !== 'adult') return;
    var option = document.createElement('option');
    option.value = seat.seat;
    option.textContent = seat.name + ' — ' + formatTransportSeatLabel(seat.seat);
    if(normalizeTransportSeatNumber(selectedSeatNumber) === seat.seat) option.selected = true;
    select.appendChild(option);
  });
}

function getSharedRiderGuardianSeat(rider, fallbackSeatNumber){
  return normalizeTransportSeatNumber(rider.guardianSeat || rider.note || fallbackSeatNumber);
}

function isTransportChildAssignedElsewhere(child, transportId, seatNumber, riderIndex){
  var current = getCurrentConference();
  var found = false;
  ((current && current.transports) || []).some(function(transport){
    return (transport.seats || []).some(function(seat){
      if(!(transport.id === transportId && seat.seat === seatNumber) && seat.name && (seat.type === 'child_shared' || seat.type === 'child_seat')){
        if(child.personId && seat.personId ? child.personId === seat.personId : child.name === seat.name){ found = true; return true; }
      }
      return (seat.riders || []).some(function(storedRider,index){
        if(transport.id === transportId && seat.seat === seatNumber && index === riderIndex) return false;
        var rider = getTransportRiderData(storedRider);
        if(rider.type !== 'child_shared') return false;
        return child.personId && rider.personId ? child.personId === rider.personId : child.name === rider.name;
      });
    });
  });
  return found;
}

function renderManualSharedChildren(){
  var container = ge('s_manual_children_list');
  if(!container) return;
  var h = '';
  seatManualSharedChildren.forEach(function(child,index){
    var mode=child.mode==='independent'?'independent':'shared';
    h += '<div class="transport-manual-child transport-child-assignment-row">'
      +'<input class="transport-child-name" value="'+esc(child.name)+'" aria-label="اسم الطفل" onchange="updateManualSharedChild('+index+',\'name\',this.value)">'
      +'<small>اسم يدوي</small>'
      +'<select class="transport-child-mode" aria-label="طريقة الجلوس" onchange="updateManualSharedChild('+index+',\'mode\',this.value)"><option value="shared" '+(mode==='shared'?'selected':'')+'>مع المرافق</option><option value="independent" '+(mode==='independent'?'selected':'')+'>كرسي مستقل</option></select>'
      +'<select class="transport-child-seat-number" data-manual-index="'+index+'" style="display:'+(mode==='independent'?'':'none')+'" onchange="updateManualSharedChild('+index+',\'seatNumber\',this.value)">'+buildAvailableTransportSeatOptions(child.seatNumber?[normalizeTransportSeatNumber(child.seatNumber)]:[],child.seatNumber)+'</select>'
      +'<button type="button" class="btn btn-red btn-sm" onclick="removeManualSharedChildFromSeat('+index+')">حذف</button></div>';
  });
  container.innerHTML = h;
}

function updateManualSharedChild(index,field,value){
  var child=seatManualSharedChildren[index];
  if(!child)return;
  child[field]=field==='name'?String(value).trim():value;
  if(field==='mode'&&value!=='independent')child.seatNumber='';
  if(field==='mode')renderManualSharedChildren();
  refreshAdultChildSeatSelectors();
}

function addManualSharedChildToSeat(){
  var input = ge('s_manual_child_name');
  var name = input ? input.value.trim() : '';
  if(!name) return;
  var duplicate = seatManualSharedChildren.some(function(child){ return child.name === name; });
  if(!duplicate) ge('s_shared_children_list').querySelectorAll('.s-shared-child:checked').forEach(function(checkbox){ if(checkbox.getAttribute('data-name') === name) duplicate = true; });
  if(duplicate){ alert('هذا الطفل مضاف بالفعل'); return; }
  seatManualSharedChildren.push({name:name,mode:'shared',seatNumber:''});
  input.value = '';
  renderManualSharedChildren();
  refreshAdultChildSeatSelectors();
}

function removeManualSharedChildFromSeat(index){
  seatManualSharedChildren.splice(index,1);
  renderManualSharedChildren();
  refreshAdultChildSeatSelectors();
}

function getSeatEditorPersonId(name){
  var personId = '';
  getAllRooms().some(function(room){
    return (room.guests || []).some(function(guest){
      if(gn(guest) !== name) return false;
      personId = guest && guest.personId ? guest.personId : '';
      return true;
    });
  });
  return personId;
}

function isSharedChildAssignedToTransport(child, excludedTransportId, excludedSeatNumber){
  var current = getCurrentConference();
  var assigned = false;
  ((current && current.transports) || []).some(function(transport){
    return (transport.seats || []).some(function(seat){
      if(transport.id === excludedTransportId && seat.seat === excludedSeatNumber) return false;
      if(seat.name && (seat.type === 'child_shared' || seat.type === 'infant')){
        if(child.personId && seat.personId) assigned = child.personId === seat.personId;
        else assigned = seat.name === child.name;
        if(assigned) return true;
      }
      return (seat.riders || []).some(function(storedRider){
        var rider = getTransportRiderData(storedRider);
        if(child.personId && rider.personId) return child.personId === rider.personId;
        return rider.name === child.name;
      });
    });
  });
  return assigned;
}

function getEligibleSharedChildren(guardianPersonId, guardianName, excludedTransportId, excludedSeatNumber){
  var children = [];
  var seen = {};
  getAllRooms().forEach(function(room){
    if(room.closed) return;
    (room.children || []).forEach(function(child){
      if(child.leftDay) return;
      var linked = guardianPersonId && child.guardianPersonId
        ? child.guardianPersonId === guardianPersonId
        : (!child.guardianPersonId && child.guardian === guardianName);
      if(!linked || isSharedChildAssignedToTransport(child, excludedTransportId, excludedSeatNumber)) return;
      var childKey = child.personId || child.name;
      if(seen[childKey]) return;
      seen[childKey] = true;
      children.push({ name: child.name, room: room.number, personId: child.personId || '', guardianPersonId: child.guardianPersonId || '' });
    });
  });
  return children;
}

function transportChildMatches(left,right){
  if(left.personId&&right.personId)return left.personId===right.personId;
  return !!left.name&&left.name===right.name;
}

function getAdultLinkedChildAssignments(transport,adultSeat){
  var linked=[];
  if(!transport||!adultSeat)return linked;
  (adultSeat.riders||[]).forEach(function(storedRider,index){
    var child=getTransportRiderData(storedRider);
    if(child.type!=='child_shared')return;
    var belongs=false;
    if(adultSeat.personId&&child.guardianPersonId)belongs=adultSeat.personId===child.guardianPersonId;
    else if(child.guardianSeat!==undefined&&child.guardianSeat!==null)belongs=normalizeTransportSeatNumber(child.guardianSeat)===adultSeat.seat;
    else if(child.guardianName)belongs=child.guardianName===adultSeat.name;
    else belongs=true;
    if(belongs)linked.push({name:child.name||'',room:child.room||'',personId:child.personId||'',guardianPersonId:child.guardianPersonId||'',mode:'shared',seatNumber:'',riderIndex:index});
  });
  (transport.seats||[]).forEach(function(seat){
    if(seat===adultSeat||!seat.name||seat.type!=='child_seat')return;
    var belongs=false;
    if(adultSeat.personId&&seat.guardianPersonId)belongs=adultSeat.personId===seat.guardianPersonId;
    else if(seat.guardianSeat!==undefined&&seat.guardianSeat!==null)belongs=normalizeTransportSeatNumber(seat.guardianSeat)===adultSeat.seat;
    else if(seat.guardianName)belongs=seat.guardianName===adultSeat.name;
    if(belongs)linked.push({name:seat.name,room:seat.room||'',personId:seat.personId||'',guardianPersonId:seat.guardianPersonId||'',mode:'independent',seatNumber:seat.seat,sourceSeat:seat});
  });
  return linked;
}

function refreshAdultChildSeatSelectors(){
  var section=ge('s_shared_children_section');
  if(!section||ge('s_type').value!=='adult')return;
  var transport=getTransportById(editSeatTransId);
  var adultSeat=transport?(transport.seats||[]).find(function(seat){return seat.seat===editSeatNum;}):null;
  if(!transport||!adultSeat)return;
  var allowed=getAdultLinkedChildAssignments(transport,adultSeat).filter(function(child){return child.mode==='independent';}).map(function(child){return child.seatNumber;});
  var selectors=Array.prototype.slice.call(section.querySelectorAll('.transport-child-seat-number'));
  var reservations={};
  selectors.forEach(function(select){
    var row=select.closest('.transport-child-assignment-row');
    var checkbox=row.querySelector('.s-shared-child');
    var mode=row.querySelector('.transport-child-mode');
    var active=(!checkbox||checkbox.checked)&&mode&&mode.value==='independent';
    var seatNumber=active?normalizeTransportSeatNumber(select.value):null;
    if(seatNumber!==null)reservations[seatNumber]=(reservations[seatNumber]||0)+1;
  });
  selectors.forEach(function(select){
    var row=select.closest('.transport-child-assignment-row');
    var checkbox=row.querySelector('.s-shared-child');
    var mode=row.querySelector('.transport-child-mode');
    var active=(!checkbox||checkbox.checked)&&mode&&mode.value==='independent';
    var selectedSeat=normalizeTransportSeatNumber(select.value);
    var excluded=[];
    Object.keys(reservations).forEach(function(value){if(normalizeTransportSeatNumber(value)!==selectedSeat)excluded.push(value);});
    var available=getAvailableTransportSeats(transport,{adultSeatNumber:adultSeat.seat,allowedSeatNumbers:allowed,excludedSeatNumbers:excluded});
    select.innerHTML=buildAvailableTransportSeatOptions(available,selectedSeat);
    select.style.display=active?'':'none';select.disabled=!active;
  });
}

function toggleAdultChildAssignmentRow(control){
  var row=control&&control.closest?control.closest('.transport-child-assignment-row'):null;
  if(!row)return;
  var checkbox=row.querySelector('.s-shared-child');
  var mode=row.querySelector('.transport-child-mode');
  var seatInput=row.querySelector('.transport-child-seat-number');
  var show=!!(checkbox&&checkbox.checked&&mode&&mode.value==='independent');
  if(seatInput&&!show)seatInput.value='';
  if(seatInput){seatInput.style.display=show?'':'none';seatInput.disabled=!show;}
  refreshAdultChildSeatSelectors();
}

function renderSeatSharedChildren(){
  var section = ge('s_shared_children_section');
  var list = ge('s_shared_children_list');
  if(!section || !list) return;
  var type = ge('s_type').value;
  if(type !== 'adult'){
    section.style.display = 'none';
    list.innerHTML = '';
    renderManualSharedChildren();
    return;
  }
  section.style.display = '';
  renderManualSharedChildren();
  var guardianName = ge('s_name').value.trim();
  var guardianPersonId = ge('s_person_id').value || getSeatEditorPersonId(guardianName);
  ge('s_person_id').value = guardianPersonId;
  var current = getCurrentConference();
  var transport = null;
  ((current && current.transports) || []).forEach(function(item){ if(item.id === editSeatTransId) transport = item; });
  var seat = transport ? transport.seats.find(function(item){ return item.seat === editSeatNum; }) : null;
  var sameAdult=!!(seat&&seat.name&&(guardianPersonId&&seat.personId?guardianPersonId===seat.personId:guardianName===seat.name));
  var linked=sameAdult?getAdultLinkedChildAssignments(transport,seat):[];
  var registeredLinked=[];
  seatManualSharedChildren=[];
  linked.forEach(function(child){
    if(child.personId)registeredLinked.push(child);
    else seatManualSharedChildren.push({name:child.name,mode:child.mode,seatNumber:child.seatNumber||''});
  });
  renderManualSharedChildren();
  if(!guardianName){
    list.innerHTML = '<div class="modal-empty-state">اختر المرافق أولاً</div>';
    refreshAdultChildSeatSelectors();
    return;
  }
  var children = getEligibleSharedChildren(guardianPersonId, guardianName, editSeatTransId, editSeatNum);
  registeredLinked.forEach(function(linkedChild){
    if(!children.some(function(child){return transportChildMatches(child,linkedChild);})){children.push(linkedChild);}
  });
  if(!children.length){
    list.innerHTML = '<div class="modal-empty-state">لا يوجد أطفال مرتبطون بهذا المرافق</div>';
    refreshAdultChildSeatSelectors();
    return;
  }
  var h = '';
  children.forEach(function(child){
    var currentChild=null;
    registeredLinked.some(function(item){if(transportChildMatches(item,child)){currentChild=item;return true;}return false;});
    var mode=currentChild&&currentChild.mode==='independent'?'independent':'shared';
    var selectedSeat=currentChild&&currentChild.seatNumber||'';
    h += '<div class="transport-shared-child-option transport-child-assignment-row"><input type="checkbox" class="s-shared-child" data-person-id="'+esc(child.personId)+'" data-guardian-person-id="'+esc(child.guardianPersonId)+'" data-name="'+esc(child.name)+'" data-room="'+esc(child.room)+'" '+(currentChild?'checked':'')+' onchange="toggleAdultChildAssignmentRow(this)"> <span><strong>'+esc(child.name)+'</strong><small>غرفة '+esc(child.room)+'</small></span><select class="transport-child-mode" aria-label="طريقة الجلوس" onchange="toggleAdultChildAssignmentRow(this)"><option value="shared" '+(mode==='shared'?'selected':'')+'>مع المرافق</option><option value="independent" '+(mode==='independent'?'selected':'')+'>كرسي مستقل</option></select><select class="transport-child-seat-number" style="display:'+(currentChild&&mode==='independent'?'':'none')+'" '+(currentChild&&mode==='independent'?'':'disabled')+' onchange="refreshAdultChildSeatSelectors()">'+buildAvailableTransportSeatOptions(selectedSeat?[normalizeTransportSeatNumber(selectedSeat)]:[],selectedSeat)+'</select></div>';
  });
  list.innerHTML = h;
  refreshAdultChildSeatSelectors();
}

function handleSeatPersonInput(){
  ge('s_person_id').value = getSeatEditorPersonId(ge('s_name').value.trim());
  renderSeatSharedChildren();
}

function openSM(transId,seatNum){
  var current = getCurrentConference();
  var transports = current.transports || [];
  editSeatTransId=transId;editSeatNum=seatNum;editSeatRiderIndex=null;seatManualSharedChildren=[];
  var t = null;
  for (var i = 0; i < transports.length; i++) { if (transports[i].id === transId) { t = transports[i]; break; } }
  if (!t) return;

  var s = null;
  for (var i = 0; i < t.seats.length; i++) { if (t.seats[i].seat === seatNum) { s = t.seats[i]; break; } }
  if (!s) return;

  ge('smTitle').textContent=t.icon+' '+t.name+' — كرسي '+seatNum;
  var sel=ge('s_pick');sel.innerHTML='<option value="">— اختر —</option>';
  // for child_shared/infant show ALL guests (including assigned) since they share a seat
  var isSharedSeat=s.type==='child_shared'||s.type==='infant';
  var list=isSharedSeat?allGuestsForPick():unassigned(s.name);
  list.forEach(function(g){
    var opt=document.createElement('option');opt.value=g.name;opt.textContent=g.name+' (غرفة '+g.room+')';
    opt.dataset.room=g.room;opt.dataset.child=g.guardian?'1':'0';opt.dataset.personId=g.personId||'';
    if(s.name===g.name)opt.selected=true;sel.appendChild(opt);
  });
  ge('s_name').value=s.name||'';ge('s_room').value=s.room||'';ge('s_type').value=s.type||'adult';ge('s_note').value=s.note||'';ge('s_person_id').value=s.personId||getSeatEditorPersonId(s.name||'');ge('s_child_seat_number').value=seatNum;ge('s_manual_child_name').value='';
  (s.riders||[]).forEach(function(storedRider){var rider=getTransportRiderData(storedRider);if(rider.type==='child_shared'&&!rider.personId&&rider.name)seatManualSharedChildren.push({name:rider.name});});
  toggleSeatNote();ge('clearSeatBtn').style.display=s.name?'block':'none';
  ge('seatModal').style.display='flex';
}
function openTransportRiderEditor(transId,seatNum,riderIndex){
  openSM(transId,seatNum);
  var transport=getTransportById(transId);
  var seat=transport?(transport.seats||[]).find(function(item){return item.seat===seatNum;}):null;
  var rider=seat?getTransportRiderData((seat.riders||[])[riderIndex]):null;
  if(!rider)return;
  editSeatRiderIndex=riderIndex;seatManualSharedChildren=[];
  ge('smTitle').textContent='تعديل الطفل — '+rider.name;
  ge('s_name').value=rider.name||'';ge('s_room').value=rider.room||'';ge('s_person_id').value=rider.personId||'';ge('s_type').value=rider.type||'child_shared';ge('s_note').value=rider.note||'';ge('s_child_seat_number').value='';
  Array.prototype.forEach.call(ge('s_pick').options,function(option){option.selected=option.value===rider.name;});
  toggleSeatNote();renderSeatGuardianOptions(getSharedRiderGuardianSeat(rider,seatNum));
  ge('clearSeatBtn').style.display='none';
}
function closeSM(){ge('seatModal').style.display='none'}
function pickGuest(){
  var sel=ge('s_pick');var opt=sel.options[sel.selectedIndex];if(!opt||!opt.value)return;
  ge('s_name').value=opt.value;ge('s_room').value=opt.dataset.room||'';ge('s_person_id').value=opt.dataset.personId||'';
  // auto-set type: child from room children → child_seat by default
  ge('s_type').value=opt.dataset.child==='1'?'child_seat':'adult';
  toggleSeatNote();
}
function renderStandaloneChildSeatOptions(){
  var select=ge('s_child_seat_number');
  var transport=getTransportById(editSeatTransId);
  if(!select||!transport)return;
  var sourceSeat=(transport.seats||[]).find(function(seat){return seat.seat===editSeatNum;});
  var allowed=[];
  if(sourceSeat&&editSeatRiderIndex===null&&sourceSeat.name&&sourceSeat.type==='child_seat')allowed.push(sourceSeat.seat);
  var selectedSeat=normalizeTransportSeatNumber(select.value);
  if(selectedSeat===null&&allowed.length)selectedSeat=allowed[0];
  if(selectedSeat===null&&sourceSeat&&!sourceSeat.name)selectedSeat=sourceSeat.seat;
  var available=getAvailableTransportSeats(transport,{allowedSeatNumbers:allowed});
  select.innerHTML=buildAvailableTransportSeatOptions(available,selectedSeat);
}
function toggleSeatNote(){
  var tp=ge('s_type').value;
  var noteRow=ge('s_note_row');
  var guardianRow=ge('s_guardian_row');
  var childSeatRow=ge('s_child_seat_row');
  noteRow.style.display=tp==='infant'?'block':'none';
  guardianRow.style.display=tp==='child_shared'?'block':'none';
  childSeatRow.style.display=tp==='child_seat'?'block':'none';
  if(tp==='child_shared') renderSeatGuardianOptions(ge('s_guardian_select').value||normalizeTransportSeatNumber(ge('s_note').value)||editSeatNum);
  if(tp==='child_seat') renderStandaloneChildSeatOptions();
  // update label based on type
  var lbl=noteRow.querySelector('label');
  if(lbl){
    if(tp==='infant') lbl.textContent='رقم كرسي المرافق (الرضيع يجلس معه — لا يُحتسب كرسي)';
    else lbl.textContent='اسم ولي الأمر / رقم كرسيه';
  }
  // change note placeholder
  var noteInp=ge('s_note');
  if(noteInp){
    if(tp==='infant'){
      var normalizedSeat = normalizeTransportSeatNumber(noteInp.value);
      noteInp.type='number';noteInp.min='1';noteInp.placeholder='مثال: 5';noteInp.value=normalizedSeat===null?'':normalizedSeat;
    }else{
      noteInp.type='text';noteInp.removeAttribute('min');noteInp.placeholder='اسم ولي الأمر / رقم كرسيه';
    }
  }
  renderSeatSharedChildren();
}

function saveChildSeatAssignment(transport,name,room,type,personId){
  if(!name){alert('أدخل اسم الطفل');return false;}
  if(isTransportChildAssignedElsewhere({name:name,personId:personId},editSeatTransId,editSeatNum,editSeatRiderIndex)){
    alert('هذا الطفل مسجل بالفعل على كرسي آخر');
    return false;
  }
  var sourceSeat=(transport.seats||[]).find(function(seat){return seat.seat===editSeatNum;});
  if(!sourceSeat)return false;
  if(type==='child_shared'){
    var guardianSeatNumber=normalizeTransportSeatNumber(ge('s_guardian_select').value);
    var guardianSeat=(transport.seats||[]).find(function(seat){return seat.seat===guardianSeatNumber;});
    if(!guardianSeat||!guardianSeat.name||guardianSeat.type!=='adult'){
      alert('اختر المرافق الذي سيشارك الطفل معه.');
      return false;
    }
    guardianSeat.riders=guardianSeat.riders||[];
    var duplicate=guardianSeat.riders.some(function(storedRider,index){
      if(guardianSeat===sourceSeat&&index===editSeatRiderIndex)return false;
      var rider=getTransportRiderData(storedRider);
      return personId&&rider.personId?personId===rider.personId:name===rider.name;
    });
    if(duplicate){alert('هذا الطفل مضاف بالفعل مع المرافق');return false;}
    if(editSeatRiderIndex!==null&&editSeatRiderIndex!==undefined)sourceSeat.riders.splice(editSeatRiderIndex,1);
    else if(sourceSeat.name===name){sourceSeat.name='';sourceSeat.room='';sourceSeat.type='adult';sourceSeat.note='';sourceSeat.personId='';}
    guardianSeat.riders.push({r:{name:name,room:room,type:'child_shared',note:String(guardianSeatNumber),personId:personId||'',guardianPersonId:guardianSeat.personId||'',guardianName:guardianSeat.name,guardianSeat:guardianSeatNumber}});
    return true;
  }
  var independentSeatNumber=normalizeTransportSeatNumber(ge('s_child_seat_number').value);
  var targetSeat=(transport.seats||[]).find(function(seat){return seat.seat===independentSeatNumber;});
  if(independentSeatNumber===null||!targetSeat){alert('اختر كرسيًا متاحًا للطفل «'+name+'».');return false;}
  var sourceIsTarget=targetSeat===sourceSeat&&editSeatRiderIndex===null;
  var allowedSeats=sourceIsTarget?[sourceSeat.seat]:[];
  var latestAvailable=getAvailableTransportSeats(transport,{allowedSeatNumbers:allowedSeats});
  if(latestAvailable.indexOf(independentSeatNumber)===-1){alert('الكرسي المحدد للطفل «'+name+'» لم يعد متاحًا، اختر كرسيًا آخر.');return false;}
  if(editSeatRiderIndex!==null&&editSeatRiderIndex!==undefined)sourceSeat.riders.splice(editSeatRiderIndex,1);
  else if(!sourceIsTarget&&sourceSeat.name===name){sourceSeat.name='';sourceSeat.room='';sourceSeat.type='adult';sourceSeat.note='';sourceSeat.personId='';}
  targetSeat.name=name;targetSeat.room=room;targetSeat.type='child_seat';targetSeat.note='';targetSeat.personId=personId||'';targetSeat.riders=targetSeat.riders||[];
  return true;
}

function saveAdultSeatAssignments(transport,adultSeat,name,room,personId,note){
  var currentLinked=getAdultLinkedChildAssignments(transport,adultSeat);
  var requested=[];
  var seen={};
  var seenNames={};
  var invalidDuplicate=false;
  ge('s_shared_children_list').querySelectorAll('.s-shared-child:checked').forEach(function(checkbox){
    var row=checkbox.closest('.transport-child-assignment-row');
    var childName=checkbox.getAttribute('data-name')||'';
    var childPersonId=checkbox.getAttribute('data-person-id')||'';
    var key=childPersonId||'name:'+childName;
    if(!childName||seen[key]||seenNames[childName]){invalidDuplicate=true;return;}
    seen[key]=true;seenNames[childName]=true;
    requested.push({name:childName,room:checkbox.getAttribute('data-room')||'',personId:childPersonId,guardianPersonId:checkbox.getAttribute('data-guardian-person-id')||'',mode:row.querySelector('.transport-child-mode').value,seatNumber:row.querySelector('.transport-child-seat-number').value});
  });
  seatManualSharedChildren.forEach(function(child){
    var childName=String(child.name||'').trim();
    var key='name:'+childName;
    if(!childName)return;
    if(seen[key]||seenNames[childName]){invalidDuplicate=true;return;}
    seen[key]=true;seenNames[childName]=true;
    requested.push({name:childName,room:'',personId:'',guardianPersonId:'',mode:child.mode==='independent'?'independent':'shared',seatNumber:child.seatNumber||''});
  });
  if(invalidDuplicate){alert('لا يمكن إضافة الطفل نفسه أكثر من مرة');return false;}

  var releasableSeats={};
  currentLinked.forEach(function(child){if(child.mode==='independent')releasableSeats[child.seatNumber]=true;});
  var releasableSeatNumbers=Object.keys(releasableSeats);
  var reservedSeats={};
  for(var i=0;i<requested.length;i++){
    var child=requested[i];
    if(child.mode!=='independent')continue;
    var seatNumber=normalizeTransportSeatNumber(child.seatNumber);
    var target=(transport.seats||[]).find(function(seat){return seat.seat===seatNumber;});
    if(seatNumber===null||!target){alert('اختر كرسيًا متاحًا للطفل «'+child.name+'».');return false;}
    if(seatNumber===adultSeat.seat){alert('لا يمكن استخدام كرسي المرافق نفسه ككرسي مستقل للطفل');return false;}
    if(reservedSeats[seatNumber]){alert('لا يمكن تعيين أكثر من طفل على الكرسي نفسه');return false;}
    var latestAvailable=getAvailableTransportSeats(transport,{adultSeatNumber:adultSeat.seat,allowedSeatNumbers:releasableSeatNumbers,excludedSeatNumbers:Object.keys(reservedSeats)});
    if(latestAvailable.indexOf(seatNumber)===-1){alert('الكرسي المحدد للطفل «'+child.name+'» لم يعد متاحًا، اختر كرسيًا آخر.');return false;}
    reservedSeats[seatNumber]=true;
    child.seatNumber=seatNumber;
  }

  for(var j=0;j<requested.length;j++){
    var requestedChild=requested[j];
    var assignedOutside=false;
    ((getCurrentConference()||{}).transports||[]).some(function(otherTransport){
      return (otherTransport.seats||[]).some(function(storedSeat){
        var isCurrentIndependent=otherTransport===transport&&currentLinked.some(function(linkedChild){return linkedChild.sourceSeat===storedSeat&&transportChildMatches(linkedChild,requestedChild);});
        if(isCurrentIndependent)return false;
        if(storedSeat.name&&(storedSeat.type==='child_shared'||storedSeat.type==='child_seat')&&transportChildMatches(storedSeat,requestedChild))return assignedOutside=true;
        return (storedSeat.riders||[]).some(function(storedRider,index){
          var rider=getTransportRiderData(storedRider);
          var isCurrentShared=otherTransport===transport&&storedSeat===adultSeat&&currentLinked.some(function(linkedChild){return linkedChild.mode==='shared'&&linkedChild.riderIndex===index&&transportChildMatches(linkedChild,requestedChild);});
          if(isCurrentShared)return false;
          return rider.type==='child_shared'&&transportChildMatches(rider,requestedChild)&&(assignedOutside=true);
        });
      });
    });
    if(assignedOutside){alert('الطفل "'+requestedChild.name+'" مسجل بالفعل على كرسي آخر');return false;}
  }

  currentLinked.forEach(function(child){
    if(child.mode!=='independent'||!child.sourceSeat)return;
    child.sourceSeat.name='';child.sourceSeat.room='';child.sourceSeat.type='adult';child.sourceSeat.note='';child.sourceSeat.personId='';
    delete child.sourceSeat.guardianPersonId;delete child.sourceSeat.guardianName;delete child.sourceSeat.guardianSeat;
  });
  var linkedRiderIndexes={};
  currentLinked.forEach(function(child){if(child.mode==='shared')linkedRiderIndexes[child.riderIndex]=true;});
  adultSeat.riders=(adultSeat.riders||[]).filter(function(storedRider,index){return !linkedRiderIndexes[index];});
  adultSeat.name=name;adultSeat.room=room;adultSeat.type='adult';adultSeat.note=note;adultSeat.personId=personId||'';
  requested.forEach(function(child){
    if(child.mode==='shared'){
      adultSeat.riders.push({r:{name:child.name,room:child.room,type:'child_shared',note:String(adultSeat.seat),personId:child.personId||'',guardianPersonId:personId||child.guardianPersonId||'',guardianName:name,guardianSeat:adultSeat.seat}});
      return;
    }
    var target=(transport.seats||[]).find(function(seat){return seat.seat===child.seatNumber;});
    target.name=child.name;target.room=child.room;target.type='child_seat';target.note='';target.personId=child.personId||'';target.guardianPersonId=personId||child.guardianPersonId||'';target.guardianName=name;target.guardianSeat=adultSeat.seat;target.riders=target.riders||[];
  });
  return true;
}

function saveSeat(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveSeat',null))return false;
  var current = getCurrentConference();
  var transports = current.transports || [];
  var name=ge('s_name').value.trim();var room=ge('s_room').value.trim();var type=ge('s_type').value;var note=ge('s_note').value.trim();var personId=ge('s_person_id').value||getSeatEditorPersonId(name);
  var t = null;
  for (var i = 0; i < transports.length; i++) { if (transports[i].id === editSeatTransId) { t = transports[i]; break; } }
  if (!t) return;

  if(type==='child_shared'||type==='child_seat'){
    if(!saveChildSeatAssignment(t,name,room,type,personId))return;
    if(!save())return false;
    closeSM();renderTransports();showToast('✅ تم حفظ تسكين الطفل');
    return;
  }

  // child_shared / infant: attach to parent's seat, don't consume a new seat number
  if(type==='infant'){
    if(!name){alert('أدخل اسم الطفل');return}
    if(isSharedChildAssignedToTransport({name:name,personId:personId},editSeatTransId,editSeatNum)){
      alert('هذا الطفل مسجل بالفعل على كرسي آخر');
      return;
    }
    // find parent seat from note (e.g. "مع والده — كرسي 5")
    var pSeatNum=normalizeTransportSeatNumber(note);
    if(pSeatNum!==null){
      var pSeat = null;
      for (var i = 0; i < t.seats.length; i++) {
        if (t.seats[i].seat === pSeatNum) { pSeat = t.seats[i]; break; }
      }
      if(pSeat&&pSeat.name){
        // store child on the parent seat as a "rider"
        if(!pSeat.riders)pSeat.riders=[];
        // remove from old seat if editing
        var oldSeat=t.seats.find(function(x){return x.seat===editSeatNum});
        if(oldSeat&&oldSeat.name===name){oldSeat.name='';oldSeat.room='';oldSeat.type='adult';oldSeat.note='';oldSeat.riders=[];}
        // add as rider
        var already = false;
        for (var i = 0; i < pSeat.riders.length; i++) {
          var riderName = pSeat.riders[i].r ? pSeat.riders[i].r.name : pSeat.riders[i].name;
          if (riderName === name) { already = true; break; }
        }
        if(!already)pSeat.riders.push({r: {name:name,room:room,type:type,note:String(pSeatNum),personId:personId||''}});
        if(!save())return false;
        closeSM();renderTransports();showToast('✅ '+name+' أُضيف مع '+pSeat.name+' (كرسي '+pSeatNum+')');
        return;
      }
    }
    // no parent seat found — just save on current seat as shared marker
    var s=t.seats.find(function(x){return x.seat===editSeatNum});
    s.name=name;s.room=room;s.type=type;s.note=pSeatNum===null?'':String(pSeatNum);s.personId=personId||'';
    s.riders=[];
    if(!save())return false;
    closeSM();renderTransports();showToast('✅ '+name+' — مع ولي أمره');
    return;
  }
  // regular seat (adult / child_seat / special)
  if(name){
    var dup=null;
    for (var i = 0; i < transports.length; i++) {
      var tr = transports[i];
      for (var j = 0; j < tr.seats.length; j++) {
        var sx = tr.seats[j];
        if (sx.name === name && sx.type !== 'child_shared' && sx.type !== 'infant' && !(tr.id === editSeatTransId && sx.seat === editSeatNum)) {
          dup = tr.name + ' كرسي ' + sx.seat;
          break;
        }
      }
      if (dup) break;
    }
    if(dup&&!confirm('⚠️ "'+name+'" في '+dup+'. تأكيد؟'))return;
  }
  var s = null;
  for (var i = 0; i < t.seats.length; i++) { if (t.seats[i].seat === editSeatNum) { s = t.seats[i]; break; } }
  if (!s) return;
  if(type==='adult'&&name){
    if(!saveAdultSeatAssignments(t,s,name,room,personId,note))return;
    if(!save())return false;
    closeSM();renderTransports();showToast('✅ كرسي '+editSeatNum+' — '+name);
    return;
  }
  s.name=name;s.room=room;s.type=type;s.note=note;s.personId=personId||'';
  if(!save())return false;
  closeSM();renderTransports();showToast('✅ كرسي '+editSeatNum+' — '+name);
}

function removeTransportSeatRider(transportId,seatNumber,riderIndex){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('removeTransportSeatRider',null))return false;
  var current=getCurrentConference();
  var transport=null;
  ((current&&current.transports)||[]).forEach(function(item){if(item.id===transportId)transport=item;});
  if(!transport)return false;
  var seat=null;
  (transport.seats||[]).forEach(function(item){if(item.seat===seatNumber)seat=item;});
  if(!seat)return false;
  var isNested=riderIndex!==null&&riderIndex!==undefined;
  var rider=isNested?getTransportRiderData((seat.riders||[])[riderIndex]):seat;
  var riderName=(rider&&rider.name)||'الراكب';
  var linkedSharedChildren=[];
  if(!isNested&&seat.type==='adult'){
    (seat.riders||[]).forEach(function(storedRider,index){
      var child=getTransportRiderData(storedRider);
      if(child.type!=='child_shared')return;
      var linked=false;
      if(seat.personId&&child.guardianPersonId)linked=seat.personId===child.guardianPersonId;
      else if(child.guardianSeat!==undefined&&child.guardianSeat!==null)linked=normalizeTransportSeatNumber(child.guardianSeat)===seat.seat;
      else if(child.guardianName)linked=child.guardianName===seat.name;
      else linked=true;
      if(linked)linkedSharedChildren.push({index:index,name:child.name});
    });
  }
  var confirmation=linkedSharedChildren.length
    ? 'سيتم إزالة "'+riderName+'" والأطفال المشاركين معه من هذا الكرسي. هل تريد المتابعة؟'
    : 'هل تريد إزالة "'+riderName+'" من هذا الكرسي؟';
  if(!confirm(confirmation))return false;
  if(isNested){
    seat.riders.splice(riderIndex,1);
  }else{
    if(linkedSharedChildren.length){
      var linkedIndexes={};linkedSharedChildren.forEach(function(child){linkedIndexes[child.index]=true;});
      seat.riders=(seat.riders||[]).filter(function(storedRider,index){return !linkedIndexes[index];});
    }
    seat.name='';seat.room='';seat.type='adult';seat.note='';seat.personId='';
  }
  if(!save())return false;
  renderTransports();showToast('تمت إزالة '+riderName+' من الكرسي','#E74C3C');
  return true;
}
function clearSeat(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('clearSeat',null))return false;
  if(removeTransportSeatRider(editSeatTransId,editSeatNum,null))closeSM();
}

// ═══════════════════════════════════════════════════════
// TAB 2: RESTAURANT
// ═══════════════════════════════════════════════════════
var MEALS={breakfast:{label:'🌅 فطار',key:'breakfast'},lunch:{label:'🍽️ غداء',key:'lunch'},dinner:{label:'🌙 عشاء',key:'dinner'}};
var MKEYS=['breakfast','lunch','dinner'];

function isPersonPresentOnDay(person,day){
  var targetDay=Number(day);
  if(!isFinite(targetDay)||targetDay<1)return false;
  targetDay=Math.floor(targetDay);

  var arrivalDay=Number(person&&person.arrivalDay);
  if(!isFinite(arrivalDay)||arrivalDay<1)arrivalDay=1;
  else arrivalDay=Math.floor(arrivalDay);
  if(arrivalDay>targetDay)return false;

  var rawLeftDay=person&&person.leftDay;
  if(rawLeftDay===undefined||rawLeftDay===null||rawLeftDay==='')return true;
  var leftDay=Number(rawLeftDay);
  if(!isFinite(leftDay)||leftDay<1)return true;
  return Math.floor(leftDay)>targetDay;
}

function personsOnDay(day){
  var current = getCurrentConference();
  if (!current) return {adults:0, children:0, rooms:[]};
  var adults=0,children=0;
  getAllRooms().forEach(function(r) {
    if (!isRoomActiveOnDay(r, day)) return;
    (r.guests || []).forEach(function(g) { if (isPersonPresentOnDay(g,day)) adults++; });
    (r.children || []).forEach(function(c) { if (isPersonPresentOnDay(c,day)) children++; });
  });
  return {adults:adults,children:children};
}

function restaurantExceptionHandlerKey(value){
  return String(value||'')
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/\r/g,'\\r')
    .replace(/\n/g,'\\n');
}

function setRestaurantV3MealBoundary(field,value){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('setRestaurantV3MealBoundary',null))return false;
  if(field!=='firstMeal'&&field!=='lastMeal')return false;
  if(MKEYS.indexOf(value)===-1)return false;
  var current=getCurrentConference();
  if(!current)return false;
  getConferenceMealPlan(current)[field]=value;
  if(!save())return false;
  renderAccounts();
  return true;
}

function setRestaurantV3BasePrice(mealKey,value){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('setRestaurantV3BasePrice',null))return false;
  if(MKEYS.indexOf(mealKey)===-1)return false;
  var current=getCurrentConference();
  if(!current)return false;
  var price=Number(value);
  getConferenceMealPlan(current).prices[mealKey]=isFinite(price)?price:0;
  if(!save())return false;
  renderAccounts();
  return true;
}

function getRestaurantV3ScheduleDay(day,conference){
  day=Number(day);
  return buildConferenceMealSchedule(conference).filter(function(item){
    return item.day===day;
  })[0]||null;
}

function isRestaurantV3MealEnabled(day,mealKey,conference){
  var scheduleDay=getRestaurantV3ScheduleDay(day,conference);
  return !!(scheduleDay&&scheduleDay.meals&&scheduleDay.meals[mealKey]===true);
}

function finishRestaurantV3ExceptionChange(message){
  var current=getCurrentConference();
  if(!current||!save())return false;
  calculateMealSummary(current);
  renderAccounts();
  showToast(message);
  return true;
}

function saveRestaurantV3PriceOverride(){
  var current=getCurrentConference();
  var day=Number(ge('restaurantV3PriceDay').value);
  var meal=ge('restaurantV3PriceMeal').value;
  var price=Number(ge('restaurantV3PriceValue').value);
  if(!day||MKEYS.indexOf(meal)===-1){
    alert('يرجى اختيار اليوم والوجبة.');
    return false;
  }
  if(!isRestaurantV3MealEnabled(day,meal,current)){
    alert('هذه الوجبة غير مفعلة في اليوم المحدد.');
    return false;
  }
  if(!isFinite(price)||price<0){
    alert('يجب إدخال سعر صحيح غير سالب.');
    return false;
  }
  var list=getConferenceMealPlan(current).mealPriceOverrides;
  var existing=list.filter(function(item){return Number(item.day)===day&&item.meal===meal})[0];
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveRestaurantV3PriceOverride',existing?'update':'create'))return false;
  if(existing){
    existing.price=price;
  }else{
    list.push({day:day,meal:meal,price:price});
  }
  return finishRestaurantV3ExceptionChange('تم حفظ الاستثناء.');
}

function editRestaurantV3PriceOverride(day,meal){
  var item=getConferenceMealPlan().mealPriceOverrides.filter(function(entry){
    return Number(entry.day)===Number(day)&&entry.meal===meal;
  })[0];
  if(!item)return;
  ge('restaurantV3PriceDay').value=String(item.day);
  refreshRestaurantV3MealOptions('restaurantV3Price');
  ge('restaurantV3PriceMeal').value=item.meal;
  ge('restaurantV3PriceValue').value=item.price;
}

function deleteRestaurantV3PriceOverride(day,meal){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deleteRestaurantV3PriceOverride',null))return false;
  var plan=getConferenceMealPlan();
  plan.mealPriceOverrides=plan.mealPriceOverrides.filter(function(item){
    return !(Number(item.day)===Number(day)&&item.meal===meal);
  });
  return finishRestaurantV3ExceptionChange('تم حذف الاستثناء.');
}

function saveRestaurantV3CountOverride(){
  var current=getCurrentConference();
  var day=Number(ge('restaurantV3CountDay').value);
  var meal=ge('restaurantV3CountMeal').value;
  var extra=Number(ge('restaurantV3CountExtra').value);
  var deduction=Number(ge('restaurantV3CountDeduction').value);
  var note=ge('restaurantV3CountNote').value.trim();
  if(!day||MKEYS.indexOf(meal)===-1){
    alert('يرجى اختيار اليوم والوجبة.');
    return false;
  }
  if(!isRestaurantV3MealEnabled(day,meal,current)){
    alert('هذه الوجبة غير مفعلة في اليوم المحدد.');
    return false;
  }
  if(!Number.isInteger(extra)||extra<0||!Number.isInteger(deduction)||deduction<0){
    alert('يجب أن تكون الإضافة والخصم أعدادًا صحيحة غير سالبة.');
    return false;
  }
  if(extra===0&&deduction===0){
    alert('يجب إدخال عدد إضافي أو عدد مخصوم.');
    return false;
  }
  var list=getConferenceMealPlan(current).mealCountOverrides;
  var existing=list.filter(function(item){return Number(item.day)===day&&item.meal===meal})[0];
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveRestaurantV3CountOverride',existing?'update':'create'))return false;
  var value={day:day,meal:meal,extra:extra,deduction:deduction};
  if(note)value.note=note;
  if(existing){
    existing.extra=value.extra;
    existing.deduction=value.deduction;
    if(value.note)existing.note=value.note;
    else delete existing.note;
  }else{
    list.push(value);
  }
  return finishRestaurantV3ExceptionChange('تم حفظ الاستثناء.');
}

function editRestaurantV3CountOverride(day,meal){
  var item=getConferenceMealPlan().mealCountOverrides.filter(function(entry){
    return Number(entry.day)===Number(day)&&entry.meal===meal;
  })[0];
  if(!item)return;
  ge('restaurantV3CountDay').value=String(item.day);
  refreshRestaurantV3MealOptions('restaurantV3Count');
  ge('restaurantV3CountMeal').value=item.meal;
  ge('restaurantV3CountExtra').value=item.extra||0;
  ge('restaurantV3CountDeduction').value=item.deduction||0;
  ge('restaurantV3CountNote').value=item.note||'';
}

function deleteRestaurantV3CountOverride(day,meal){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deleteRestaurantV3CountOverride',null))return false;
  var plan=getConferenceMealPlan();
  plan.mealCountOverrides=plan.mealCountOverrides.filter(function(item){
    return !(Number(item.day)===Number(day)&&item.meal===meal);
  });
  return finishRestaurantV3ExceptionChange('تم حذف الاستثناء.');
}

function getRestaurantV3People(conference){
  conference=conference||getCurrentConference();
  var people=[];
  var indexes={};
  function addPerson(personId,name,sourcePerson){
    personId=String(personId||'').trim();
    if(!personId)return;
    var item={personId:personId,name:String(name||'').trim()||'بدون اسم',sourcePerson:sourcePerson||null};
    if(indexes[personId]===undefined){
      indexes[personId]=people.length;
      people.push(item);
    }else if(people[indexes[personId]].name==='بدون اسم'&&item.name!=='بدون اسم'){
      people[indexes[personId]]=item;
    }
  }
  getConferenceHouseRooms(conference).forEach(function(room){
    (room.guests||[]).concat(room.children||[]).forEach(function(person){
      addPerson(person&&person.personId,resolvePersonName(person&&person.personId,person&&person.name),person);
    });
  });
  ((conference.peopleDb&&conference.peopleDb.people)||[]).forEach(function(person){
    addPerson(person&&person.id,person&&person.fullName,person);
  });
  return people.sort(function(left,right){return left.name.localeCompare(right.name,'ar')});
}

function findRestaurantV3Person(personId,conference){
  return getRestaurantV3People(conference).filter(function(person){
    return person.personId===String(personId||'');
  })[0]||null;
}

function saveRestaurantV3PersonOverride(){
  var current=getCurrentConference();
  var personId=ge('restaurantV3PersonId').value;
  var day=Number(ge('restaurantV3PersonDay').value);
  var meal=ge('restaurantV3PersonMeal').value;
  var included=ge('restaurantV3PersonIncluded').value==='true';
  var note=ge('restaurantV3PersonNote').value.trim();
  var validDays={};
  buildConferenceMealSchedule(current).forEach(function(item){validDays[item.day]=true});
  if(!personId){
    alert('يرجى اختيار الشخص.');
    return false;
  }
  if(!validDays[day]||MKEYS.indexOf(meal)===-1){
    alert('يرجى اختيار اليوم والوجبة.');
    return false;
  }
  if(!isRestaurantV3MealEnabled(day,meal,current)){
    alert('هذه الوجبة غير مفعلة في اليوم المحدد.');
    return false;
  }
  var value={personId:personId,day:day,meal:meal,included:included};
  if(note)value.note=note;
  var list=getConferenceMealPlan(current).personOverrides;
  var existing=list.filter(function(item){
    return String(item.personId)===personId&&Number(item.day)===day&&item.meal===meal;
  })[0];
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveRestaurantV3PersonOverride',existing?'update':'create'))return false;
  if(existing){
    existing.included=included;
    if(note)existing.note=note;
    else delete existing.note;
  }else{
    list.push(value);
  }
  return finishRestaurantV3ExceptionChange('تم حفظ استثناء الوجبة.');
}

function editRestaurantV3PersonOverride(personId,day,meal){
  var item=getRestaurantV3PersonMealException(personId,day,meal);
  if(!item)return;
  ge('restaurantV3PersonId').value=item.personId;
  ge('restaurantV3PersonDay').value=String(item.day);
  refreshRestaurantV3MealOptions('restaurantV3Person');
  ge('restaurantV3PersonMeal').value=item.meal;
  ge('restaurantV3PersonIncluded').value=String(item.included);
  ge('restaurantV3PersonNote').value=item.note||'';
}

function deleteRestaurantV3PersonOverride(personId,day,meal){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deleteRestaurantV3PersonOverride',null))return false;
  var plan=getConferenceMealPlan();
  plan.personOverrides=plan.personOverrides.filter(function(item){
    return !(String(item.personId)===String(personId)&&Number(item.day)===Number(day)&&item.meal===meal);
  });
  return finishRestaurantV3ExceptionChange('تم حذف استثناء الوجبة.');
}

function filterRestaurantV3People(value){
  var query=String(value||'').trim().toLowerCase();
  var select=ge('restaurantV3PersonId');
  if(!select)return;
  Array.prototype.forEach.call(select.options,function(option,index){
    if(index===0)return;
    option.hidden=!!query&&String(option.textContent||'').toLowerCase().indexOf(query)===-1;
  });
}

function refreshRestaurantV3MealOptions(prefix){
  var dayElement=ge(prefix+'Day');
  var mealElement=ge(prefix+'Meal');
  if(!dayElement||!mealElement)return;
  var day=Number(dayElement.value);
  Array.prototype.forEach.call(mealElement.options,function(option){
    if(!option.value)return;
    option.disabled=!isRestaurantV3MealEnabled(day,option.value);
  });
  if(mealElement.value&&mealElement.options[mealElement.selectedIndex].disabled)mealElement.value='';
}

function renderRestaurantV3Settings(conference){
  var plan=getConferenceMealPlan(conference);
  var mealSchedule=buildConferenceMealSchedule(conference);
  var summary=calculateMealSummary(conference);
  var labels={breakfast:'فطار',lunch:'غداء',dinner:'عشاء'};
  var people=getRestaurantV3People(conference);
  var personExceptionIcon=window.AppIcons&&typeof window.AppIcons.icon==='function'?window.AppIcons.icon('user','',''):'';
  var priceExceptionIcon=window.AppIcons&&typeof window.AppIcons.icon==='function'?window.AppIcons.icon('money','',''):'';
  function dayOptions(includeBlank){
    var options='<option value="">اختر اليوم</option>';
    mealSchedule.forEach(function(item){
      options+='<option value="'+item.day+'">اليوم '+item.day+' — '+esc(formatConferenceScheduleDate(item.date))+'</option>';
    });
    return options;
  }
  function mealOptions(includeBlank){
    var options='<option value="">اختر الوجبة</option>';
    MKEYS.forEach(function(mealKey){options+='<option value="'+mealKey+'">'+labels[mealKey]+'</option>'});
    return options;
  }
  function hasPersonOverrideOnDay(day){
    return plan.personOverrides.some(function(item){
      return Number(item.day)===day&&typeof item.included==='boolean';
    });
  }
  var html='<div class="card"><div class="card-title">حساب المطعم</div>';
  html+='<div class="row restaurant-v3-boundaries">';
  html+='<div class="restaurant-v3-field restaurant-v3-field-medium"><label class="lbl">أول وجبة</label><select onchange="setRestaurantV3MealBoundary(\'firstMeal\',this.value)">';
  MKEYS.forEach(function(mealKey){
    html+='<option value="'+mealKey+'" '+(plan.firstMeal===mealKey?'selected':'')+'>'+labels[mealKey]+'</option>';
  });
  html+='</select></div>';
  html+='<div class="restaurant-v3-field restaurant-v3-field-medium"><label class="lbl">آخر وجبة</label><select onchange="setRestaurantV3MealBoundary(\'lastMeal\',this.value)">';
  MKEYS.forEach(function(mealKey){
    html+='<option value="'+mealKey+'" '+(plan.lastMeal===mealKey?'selected':'')+'>'+labels[mealKey]+'</option>';
  });
  html+='</select></div></div>';
  html+='<div class="accounts-table-scroll restaurant-v3-base-prices"><table><thead><tr><th>الوجبة</th><th>السعر الأساسي</th></tr></thead><tbody>';
  MKEYS.forEach(function(mealKey){
    html+='<tr><td><b>'+labels[mealKey]+'</b></td><td><input class="restaurant-v3-price-input" type="number" min="0" step="0.5" value="'+
      esc(plan.prices[mealKey])+'" onchange="setRestaurantV3BasePrice(\''+mealKey+'\',this.value)"></td></tr>';
  });
  html+='</tbody></table></div>';
  html+='<div class="accounts-table-scroll"><table><thead><tr><th>اليوم</th><th>التاريخ</th>';
  MKEYS.forEach(function(mealKey){html+='<th>'+labels[mealKey]+'</th>'});
  html+='<th>إجمالي اليوم</th>';
  html+='</tr></thead><tbody>';
  if(!mealSchedule.length){
    html+='<tr><td colspan="6" class="restaurant-v3-muted-cell">حدد فترة المؤتمر لبناء جدول الوجبات.</td></tr>';
  }else{
    mealSchedule.forEach(function(scheduleDay){
      var daySummary=summary.days.filter(function(item){return item.day===scheduleDay.day})[0];
      html+='<tr><td><b>'+scheduleDay.day+'</b>'+(hasPersonOverrideOnDay(scheduleDay.day)?' <span class="restaurant-v3-exception-icon" title="استثناء شخص">'+personExceptionIcon+'</span>':'')+
        '</td><td>'+esc(formatConferenceScheduleDate(scheduleDay.date))+'</td>';
      MKEYS.forEach(function(mealKey){
        var mealSummary=daySummary&&daySummary.meals[mealKey];
        var hasPrice=plan.mealPriceOverrides.some(function(item){return Number(item.day)===scheduleDay.day&&item.meal===mealKey});
        var hasCount=plan.mealCountOverrides.some(function(item){return Number(item.day)===scheduleDay.day&&item.meal===mealKey});
        html+='<td class="restaurant-v3-meal-state '+(scheduleDay.meals[mealKey]?'is-included':'is-muted')+'">'+
          (scheduleDay.meals[mealKey]
            ?'<b>✓</b><div class="restaurant-v3-meal-detail">'+mealSummary.finalCount+' × '+mealSummary.price+'</div>'
            :'—')+
          (hasPrice?' <span class="restaurant-v3-exception-icon" title="سعر استثنائي">'+priceExceptionIcon+'</span>':'')+
          (hasCount?' <span title="تعديل عدد">±</span>':'')+'</td>';
      });
      html+='<td><b>'+esc(daySummary?daySummary.total:0)+'</b></td></tr>';
    });
  }
  html+='</tbody></table></div>';
  html+='<div class="restaurant-v3-result"><span>النتيجة الحالية</span><strong>'+esc(summary.grandTotal)+'</strong><small>إجمالي المطعم</small></div></div>';

  html+='<div class="card"><div class="card-title">استثناءات أسعار الوجبات</div>';
  html+='<div class="row" style="align-items:flex-end"><div style="flex:1;min-width:160px"><label class="lbl">اليوم</label>'+
    '<select id="restaurantV3PriceDay" onchange="refreshRestaurantV3MealOptions(\'restaurantV3Price\')">'+dayOptions(false)+'</select></div>';
  html+='<div style="flex:1;min-width:130px"><label class="lbl">الوجبة</label><select id="restaurantV3PriceMeal">'+mealOptions(false)+'</select></div>';
  html+='<div style="flex:1;min-width:130px"><label class="lbl">السعر الاستثنائي</label><input id="restaurantV3PriceValue" type="number" min="0" step="0.5"></div>';
  html+='<button type="button" class="btn btn-sm" onclick="saveRestaurantV3PriceOverride()">إضافة أو حفظ</button></div>';
  if(!plan.mealPriceOverrides.length){
    html+='<div class="restaurant-v3-empty-note">لا توجد استثناءات مسجلة.</div>';
  }else{
    html+='<div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>اليوم والوجبة</th><th>السعر الأساسي</th><th>السعر الاستثنائي</th><th>إجراءات</th></tr></thead><tbody>';
    plan.mealPriceOverrides.forEach(function(item){
      html+='<tr><td>'+labels[item.meal]+' — اليوم '+item.day+'</td><td>'+esc(plan.prices[item.meal])+'</td><td><b>'+esc(item.price)+'</b></td>'+
        '<td><button class="btn btn-gray btn-sm" onclick="editRestaurantV3PriceOverride('+item.day+',\''+item.meal+'\')">تعديل</button> '+
        '<button class="btn btn-red btn-sm" onclick="deleteRestaurantV3PriceOverride('+item.day+',\''+item.meal+'\')">حذف</button></td></tr>';
    });
    html+='</tbody></table></div>';
  }
  html+='</div>';

  html+='<div class="card"><div class="card-title">تعديلات أعداد الوجبات</div>';
  html+='<div class="row" style="align-items:flex-end"><div style="flex:1;min-width:150px"><label class="lbl">اليوم</label>'+
    '<select id="restaurantV3CountDay" onchange="refreshRestaurantV3MealOptions(\'restaurantV3Count\')">'+dayOptions(false)+'</select></div>';
  html+='<div style="flex:1;min-width:120px"><label class="lbl">الوجبة</label><select id="restaurantV3CountMeal">'+mealOptions(false)+'</select></div>';
  html+='<div><label class="lbl">عدد إضافي</label><input id="restaurantV3CountExtra" type="number" min="0" step="1" value="0" style="width:100px"></div>';
  html+='<div><label class="lbl">عدد مخصوم</label><input id="restaurantV3CountDeduction" type="number" min="0" step="1" value="0" style="width:100px"></div>';
  html+='<div style="flex:1;min-width:150px"><label class="lbl">ملاحظة</label><input id="restaurantV3CountNote" maxlength="120"></div>';
  html+='<button type="button" class="btn btn-sm" onclick="saveRestaurantV3CountOverride()">إضافة أو حفظ</button></div>';
  if(!plan.mealCountOverrides.length){
    html+='<div class="restaurant-v3-empty-note">لا توجد استثناءات مسجلة.</div>';
  }else{
    html+='<div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>اليوم والوجبة</th><th>العدد الأساسي</th><th>الإضافة</th><th>الخصم</th><th>العدد النهائي</th><th>الملاحظة</th><th>إجراءات</th></tr></thead><tbody>';
    plan.mealCountOverrides.forEach(function(item){
      html+='<tr><td>'+labels[item.meal]+' — اليوم '+item.day+'</td><td>'+getMealBaseCount(item.day,item.meal,conference)+'</td>'+
        '<td>'+item.extra+'</td><td>'+item.deduction+'</td><td><b>'+getMealFinalCount(item.day,item.meal,conference)+'</b></td>'+
        '<td>'+esc(item.note||'—')+'</td><td><button class="btn btn-gray btn-sm" onclick="editRestaurantV3CountOverride('+item.day+',\''+item.meal+'\')">تعديل</button> '+
        '<button class="btn btn-red btn-sm" onclick="deleteRestaurantV3CountOverride('+item.day+',\''+item.meal+'\')">حذف</button></td></tr>';
    });
    html+='</tbody></table></div>';
  }
  html+='</div>';

  var mealExceptions=plan.personOverrides.filter(function(item){
    return item.day!==undefined&&MKEYS.indexOf(item.meal)!==-1&&typeof item.included==='boolean';
  });
  html+='<div class="card"><div class="card-title">استثناءات وجبات الأشخاص</div>';
  html+='<div style="margin-bottom:8px"><label class="lbl">بحث بالاسم</label><input type="search" placeholder="اكتب اسم الشخص" oninput="filterRestaurantV3People(this.value)"></div>';
  html+='<div class="row" style="align-items:flex-end"><div style="flex:2;min-width:190px"><label class="lbl">الشخص</label><select id="restaurantV3PersonId"><option value="">اختر الشخص</option>';
  people.forEach(function(person){html+='<option value="'+esc(person.personId)+'">'+esc(person.name)+'</option>'});
  html+='</select></div><div style="flex:1;min-width:150px"><label class="lbl">اليوم</label><select id="restaurantV3PersonDay" onchange="refreshRestaurantV3MealOptions(\'restaurantV3Person\')">'+dayOptions(false)+'</select></div>';
  html+='<div style="flex:1;min-width:130px"><label class="lbl">الوجبة</label><select id="restaurantV3PersonMeal">'+mealOptions(false)+'</select></div>';
  html+='<div style="flex:1;min-width:150px"><label class="lbl">نوع الاستثناء</label><select id="restaurantV3PersonIncluded"><option value="true">إضافة للوجبة</option><option value="false">استبعاد من الوجبة</option></select></div>';
  html+='<div style="flex:1;min-width:170px"><label class="lbl">ملاحظة اختيارية</label><input id="restaurantV3PersonNote" maxlength="120"></div>';
  html+='<button type="button" class="btn btn-sm" onclick="saveRestaurantV3PersonOverride()">حفظ</button></div>';
  if(!mealExceptions.length){
    html+='<div class="restaurant-v3-empty-note">لا توجد استثناءات مسجلة.</div>';
  }else{
    html+='<div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>الشخص</th><th>اليوم</th><th>الوجبة</th><th>النوع</th><th>الملاحظة</th><th>إجراءات</th></tr></thead><tbody>';
    mealExceptions.forEach(function(item){
      var person=findRestaurantV3Person(item.personId,conference);
      var personKey=restaurantExceptionHandlerKey(item.personId);
      html+='<tr><td><b>'+esc(person?person.name:item.personId)+'</b></td><td>'+item.day+'</td><td>'+labels[item.meal]+'</td>'+
        '<td>'+(item.included?'إضافة للوجبة':'استبعاد من الوجبة')+'</td><td>'+esc(item.note||'—')+'</td>'+
        '<td><button class="btn btn-gray btn-sm" onclick="editRestaurantV3PersonOverride(\''+esc(personKey)+'\','+item.day+',\''+item.meal+'\')">تعديل</button> '+
        '<button class="btn btn-red btn-sm" onclick="deleteRestaurantV3PersonOverride(\''+esc(personKey)+'\','+item.day+',\''+item.meal+'\')">حذف</button></td></tr>';
    });
    html+='</tbody></table></div>';
  }
  html+='</div>';
  return html;
}

// ═══════════════════════════════════════════════════════
// TAB 3: SEARCH
// ═══════════════════════════════════════════════════════
function renderSearch(){
  var current = getCurrentConference();
  if (!current) {
    ge('tab5').innerHTML = '<div class="card" style="text-align:center;padding:20px;color:#95a5a6;">لا توجد بيانات مؤتمر جاهزة حالياً.</div>';
    return;
  }
  var h='<div class="card"><div class="card-title">🔍 بحث — رقم الغرفة أو اسم الشخص</div>';
  h+='<div class="row" style="margin-bottom:8px"><input id="sInput" style="flex:1;font-size:12px;border-color:#2E75B6" placeholder="اكتب رقم الغرفة أو اسم الشخص..." onkeyup="liveSearch(this.value)"><button class="btn btn-gray btn-sm" onclick="ge(\'sInput\').value=\'\';liveSearch(\'\')">مسح</button></div>';
  h+='<div id="sRes"></div></div>';
  ge('tab5').innerHTML=h;
}
function liveSearch(q){
  q=(q||'').trim();var el=ge('sRes');if(!q){el.innerHTML='';return}
  var h='';
  var current = getCurrentConference();
  var transports = current.transports || [];
  
  var roomResults = [];
  getAllRooms().forEach(function(r) {
    if (r.number.indexOf(q) !== -1) {
      roomResults.push({ room: r, house: r.house, floor: r.floor });
    }
  });

  roomResults.forEach(function(res) {
    var r = res.room, house = res.house, floor = res.floor;
    var ag=r.guests.filter(function(g){return !gl(g)});var lg=r.guests.filter(function(g){return gl(g)});var ac=r.children.filter(function(c){return !c.leftDay});
    var tSeats=[];transports.forEach(function(t){t.seats.filter(function(s){return s.room===r.number&&s.name}).forEach(function(s){tSeats.push({t:t,s:s})})});
    h+='<div style="border:2px solid #2E75B6;border-radius:11px;overflow:hidden;margin-bottom:8px">';
    h+='<div style="background:linear-gradient(135deg,#1F4E79,#2E75B6);color:#fff;padding:8px 12px;font-weight:700;display:flex;justify-content:space-between;font-size:12px"><span>🏨 غرفة '+esc(r.number)+' ('+esc(house.name)+')</span><span style="opacity:.9">'+(ag.length+ac.length)+'/'+r.beds+'</span></div>';
    h+='<div style="padding:10px">';
    ag.forEach(function(g,i){h+='<div style="display:flex;justify-content:space-between;padding:4px 7px;background:'+(i%2===0?'#EAF4FC':'#fff')+';border-radius:5px;margin-bottom:2px;font-size:11px"><span>👤 '+esc(gn(g))+'</span><span class="pill p-adult">بالغ</span></div>'});
    ac.forEach(function(c){h+='<div style="background:#FFF9EC;border:1px solid #F9D57A;border-radius:5px;padding:4px 7px;margin-bottom:2px;display:flex;justify-content:space-between;font-size:11px"><span>🧒 '+esc(c.name)+'</span><span style="color:#7D4E00;font-size:9px">'+esc(c.guardian)+'</span></div>'});
    if(lg.length)h+='<div style="font-size:9px;color:#E74C3C;margin-top:3px">غادر: '+lg.map(function(g){return esc(gn(g))}).join('، ')+'</div>';
    if(tSeats.length){h+='<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">';tSeats.forEach(function(x){h+='<span style="background:#D5F5E3;border:1.5px solid #27AE60;border-radius:5px;padding:2px 7px;font-size:9px;font-weight:700">'+esc(x.t.icon)+' كرسي '+x.s.seat+': '+esc(x.s.name)+'</span>'});h+='</div>';}
    h+='<div class="row" style="margin-top:7px;gap:4px"><button class="btn btn-blue btn-sm" onclick="openRoomEditor(\''+house.id+'\', \''+floor.id+'\', \''+r.id+'\')">✏️</button></div>';
    h+='</div></div>';
  });

  var nRes=[],tRes=[];

  getAllRooms().forEach(function(r){

    (r.guests || []).forEach(function(g){
      if(gn(g).indexOf(q)>=0){
        nRes.push({
          name:gn(g),
          room:r.number,
          house:r.house.name,
          type:'بالغ',
          note:'',
          members:null
        });
      }
    });

    (r.children || []).forEach(function(c){
      if(c.name.indexOf(q)>=0){
        nRes.push({
          name:c.name,
          room:r.number,
          house:r.house.name,
          type:'طفل',
          left:!!c.leftDay
        });
      }
    });

  });

  transports.forEach(function(t) {
    (t.seats || []).forEach(function(s) {
      if (s.name && s.name.indexOf(q) >= 0) {
        tRes.push({ t: t, s: s });
      }
    });
  });

  if(!nRes.length&&!tRes.length&&!roomResults.length){el.innerHTML='<div style="text-align:center;padding:14px;color:#E74C3C;font-size:12px">❌ لا نتائج لـ "'+esc(q)+'"</div>';return}
  if(nRes.length){
    h+='<div style="font-weight:700;color:#1F4E79;margin:7px 0 4px;font-size:11px">👤 نتائج الاسم</div>';
    nRes.forEach(function(p){
      var tSeat=null;transports.forEach(function(t){var sx=t.seats.find(function(s){return s.name===p.name});if(sx)tSeat={t:t,s:sx}});
      h+='<div style="background:#EAF4FC;border:1.5px solid #BDD7EE;border-radius:9px;padding:8px 11px;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;gap:5px">';
      h+='<div><div style="font-weight:700;font-size:12px">'+(p.left?'<s style="opacity:.5">'+esc(p.name)+'</s> <span class="pill p-left">غادر</span>':esc(p.name))+'</div>';
      h+='<div style="font-size:10px;color:#5a7a9a">غرفة '+esc(p.room)+' ('+esc(p.house)+')</div>';
      if(tSeat)h+='<div style="font-size:10px;color:#27AE60">'+esc(tSeat.t.icon)+' كرسي '+tSeat.s.seat+'</div>';
      h+='</div><span class="pill '+(p.type==='بالغ'?'p-adult':'p-child')+'">'+esc(p.type)+'</span></div>';
    });
  }
  if(tRes.length){
    h+='<div style="font-weight:700;color:#27AE60;margin:7px 0 4px;font-size:11px">🚌 في المواصلات</div>';
    tRes.forEach(function(x){
      h+='<div style="background:#D5F5E3;border:1.5px solid #27AE60;border-radius:9px;padding:8px 11px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">';
      h+='<div><div style="font-weight:700;font-size:12px">'+esc(x.s.name)+'</div><div style="font-size:10px;color:#1B5E20">'+esc(x.t.icon)+' '+esc(x.t.name)+' — كرسي '+x.s.seat+'</div></div>';
      h+='<button class="btn btn-blue btn-sm" onclick="openSM(\''+x.t.id+'\','+x.s.seat+')">✏️</button></div>';
    });
  }
  el.innerHTML=h;
}

// ═══════════════════════════════════════════════════════
// TAB 4: CARDS
// ═══════════════════════════════════════════════════════
function cardHandlerKey(value){
  return String(value || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r/g,'\\r').replace(/\n/g,'\\n');
}
function normalizeConferenceCardTheme(value){
  return value==='modern-banner'?'modern-banner':'classic';
}
function conferenceCardBedLabel(card){
  if(card&&card.personType==='child')return '👨‍👧 مرافق لولي الأمر';
  if(!card||card.bedType!=='extra')return '';
  if(card.extraBedPersonType==='child')return '🧒➕🛏️ طفل على سرير إضافي';
  return '➕🛏️ سرير إضافي';
}
function conferenceRoomMemberText(member){
  var label=conferenceCardBedLabel(member);
  return (label?label+' — ':'')+(member&&member.name||'');
}
function renderModernBannerCard(card){
  var checked=!!selectedCards[card.key];
  var handlerKey=cardHandlerKey(card.key);
  var branding=card.branding||{};
  var banner=branding.banner||branding.bannerPrepared||branding.logo||'assets/logo.jpg';
  var serviceLogo=branding.serviceLogo||branding.watermark||branding.logo||'assets/logo.jpg';
  var displayColors=getConferenceBrandingDisplayColors(branding);
  var primaryColor=displayColors[0];
  var secondaryColor=displayColors[1];
  var textColor=branding.textColor||'#1A2A3A';
  var fontFamily=branding.fontFamily||"'Segoe UI',Arial,sans-serif";
  var bannerPosition=branding.bannerPosition==='top'?'top center':(branding.bannerPosition==='bottom'?'bottom center':'center center');
  var h='<div class="guest-card welcome-card welcome-card-modern'+(checked?' welcome-card-selected':'')+'" data-key="'+esc(card.key)+'" style="--welcome-primary:'+esc(primaryColor)+';--welcome-secondary:'+esc(secondaryColor)+';--welcome-text:'+esc(textColor)+';--welcome-font:'+esc(fontFamily)+';--modern-banner-position:'+bannerPosition+'">';
  h+='<img class="welcome-card-watermark" src="'+esc(serviceLogo)+'" alt="" onerror="this.style.display=\'none\'">';
  if(cardsSelectionMode)h+='<label class="no-print welcome-card-selector"><input type="checkbox" '+(checked?'checked':'')+' onchange="toggleCard(\''+handlerKey+'\')"> تحديد</label>';
  h+='<div class="modern-banner-media"><img class="modern-banner-image" src="'+esc(banner)+'" alt="الصورة الدعائية للمؤتمر" onerror="this.style.display=\'none\'"></div>';
  h+='<div class="welcome-card-body modern-banner-body">';
  h+='<div class="modern-banner-welcome">أهلاً بك</div>';
  h+='<div class="modern-banner-conference">'+esc(card.conferenceName||'المؤتمر')+'</div>';
  h+='<div class="welcome-card-person modern-banner-person"><strong>'+esc(card.name)+'</strong></div>';
  var bedLabel=conferenceCardBedLabel(card);
  if(bedLabel)h+='<div class="modern-banner-welcome">'+esc(bedLabel)+'</div>';
  h+='<div class="modern-banner-location">';
  if(card.houseName)h+='<span class="modern-banner-location-item">'+esc(card.houseName)+'</span>';
  if(card.room)h+='<span class="modern-banner-location-item">'+esc(card.room)+'</span>';
  if(card.floor)h+='<span class="modern-banner-location-item">'+esc(card.floor)+'</span>';
  h+='</div></div>';
  h+='<div class="welcome-card-footer"></div>';
  h+='<div class="no-print welcome-card-actions"><button class="btn btn-blue btn-sm" onclick="shareCard(\''+handlerKey+'\')">🔗</button><button class="btn btn-green btn-sm" onclick="downloadCardPng(\''+handlerKey+'\',this)">🖼️ PNG</button><button class="btn btn-purple btn-sm" onclick="printOne(\''+handlerKey+'\')">🖨️</button></div>';
  h+='</div>';
  return h;
}
function renderModernBannerExport(card){
  var branding=card.branding||{};
  var banner=branding.banner||branding.bannerPrepared||branding.logo||'assets/logo.jpg';
  var serviceLogo=branding.serviceLogo||branding.watermark||branding.logo||'assets/logo.jpg';
  var displayColors=getConferenceBrandingDisplayColors(branding);
  var primaryColor=displayColors[0];
  var secondaryColor=displayColors[1];
  var textColor=branding.textColor||'#1A2A3A';
  var fontFamily=branding.fontFamily||"'Segoe UI',Arial,sans-serif";
  var bannerPosition=branding.bannerPosition==='top'?'top center':(branding.bannerPosition==='bottom'?'bottom center':'center center');
  var isRoom=card.type==='room';
  var h='<div class="guest-card welcome-card welcome-card-modern'+(isRoom?' welcome-card-modern-room':'')+'" style="--welcome-primary:'+esc(primaryColor)+';--welcome-secondary:'+esc(secondaryColor)+';--welcome-text:'+esc(textColor)+';--welcome-font:'+esc(fontFamily)+';--modern-banner-position:'+bannerPosition+';width:350px;max-width:none;margin:0">';
  h+='<img class="welcome-card-watermark" src="'+esc(serviceLogo)+'" alt="" onerror="this.style.display=\'none\'">';
  h+='<div class="modern-banner-media"><img class="modern-banner-image" src="'+esc(banner)+'" alt="الصورة الدعائية للمؤتمر" onerror="this.style.display=\'none\'"></div>';
  if(isRoom){
    var guests=(card.members||[]).filter(function(member){return !member.hasLeft});
    var guestCountClass=getModernRoomGuestsCountClass(guests.length);
    h+='<div class="welcome-card-body modern-banner-room-body">';
    h+='<div class="modern-banner-welcome">أهلاً بك</div>';
    h+='<div class="modern-banner-conference">'+esc(card.conferenceName||'المؤتمر')+'</div>';
    h+='<div class="modern-banner-room-number">الغرفة '+esc(card.roomNumber||'—')+'</div>';
    h+='<div class="modern-banner-room-location">';
    if(card.houseName)h+='<span>'+esc(card.houseName)+'</span>';
    if(card.floorName)h+='<span>'+esc(card.floorName)+'</span>';
    h+='</div>';
    h+='<div class="modern-banner-room-guests '+guestCountClass+'">';
    if(guests.length)guests.forEach(function(member){h+='<div>'+esc(conferenceRoomMemberText(member))+'</div>'});
    else h+='<div class="modern-banner-room-empty">لا يوجد تسكين حاليًا</div>';
    h+='</div></div>';
  }else{
    h+='<div class="welcome-card-body modern-banner-body">';
    h+='<div class="modern-banner-welcome">أهلاً بك</div>';
    h+='<div class="modern-banner-conference">'+esc(card.conferenceName||'المؤتمر')+'</div>';
    h+='<div class="welcome-card-person modern-banner-person"><strong>'+esc(card.name)+'</strong></div>';
    var exportBedLabel=conferenceCardBedLabel(card);
    if(exportBedLabel)h+='<div class="modern-banner-welcome">'+esc(exportBedLabel)+'</div>';
    h+='<div class="modern-banner-location">';
    if(card.houseName)h+='<span class="modern-banner-location-item">'+esc(card.houseName)+'</span>';
    if(card.roomNumber)h+='<span class="modern-banner-location-item">'+esc(card.roomNumber)+'</span>';
    if(card.floorName)h+='<span class="modern-banner-location-item">'+esc(card.floorName)+'</span>';
    h+='</div></div>';
  }
  h+='<div class="welcome-card-footer"></div></div>';
  return h;
}
function getModernRoomGuestsCountClass(count){
  if(count<=3)return 'room-guests-count-small';
  if(count<=6)return 'room-guests-count-medium';
  return 'room-guests-count-large';
}
function renderModernBannerRoomCard(card){
  var checked=!!selectedCards[card.key];
  var handlerKey=cardHandlerKey(card.key);
  var branding=card.branding||{};
  var banner=branding.banner||branding.bannerPrepared||branding.logo||'assets/logo.jpg';
  var serviceLogo=branding.serviceLogo||branding.watermark||branding.logo||'assets/logo.jpg';
  var displayColors=getConferenceBrandingDisplayColors(branding);
  var primaryColor=displayColors[0];
  var secondaryColor=displayColors[1];
  var textColor=branding.textColor||'#1A2A3A';
  var fontFamily=branding.fontFamily||"'Segoe UI',Arial,sans-serif";
  var bannerPosition=branding.bannerPosition==='top'?'top center':(branding.bannerPosition==='bottom'?'bottom center':'center center');
  var guests=(card.members||[]).filter(function(member){return !member.hasLeft});
  var guestCountClass=getModernRoomGuestsCountClass(guests.length);
  var h='<div class="guest-card welcome-card welcome-card-modern welcome-card-modern-room'+(checked?' welcome-card-selected':'')+'" data-key="'+esc(card.key)+'" style="--welcome-primary:'+esc(primaryColor)+';--welcome-secondary:'+esc(secondaryColor)+';--welcome-text:'+esc(textColor)+';--welcome-font:'+esc(fontFamily)+';--modern-banner-position:'+bannerPosition+'">';
  h+='<img class="welcome-card-watermark" src="'+esc(serviceLogo)+'" alt="" onerror="this.style.display=\'none\'">';
  if(cardsSelectionMode)h+='<label class="no-print welcome-card-selector"><input type="checkbox" '+(checked?'checked':'')+' onchange="toggleCard(\''+handlerKey+'\')"> تحديد</label>';
  h+='<div class="modern-banner-media"><img class="modern-banner-image" src="'+esc(banner)+'" alt="الصورة الدعائية للمؤتمر" onerror="this.style.display=\'none\'"></div>';
  h+='<div class="welcome-card-body modern-banner-room-body">';
  h+='<div class="modern-banner-welcome">أهلاً بك</div>';
  h+='<div class="modern-banner-conference">'+esc(card.conferenceName||'المؤتمر')+'</div>';
  h+='<div class="modern-banner-room-number">الغرفة '+esc(card.room||'—')+'</div>';
  h+='<div class="modern-banner-room-location">';
  if(card.houseName)h+='<span>'+esc(card.houseName)+'</span>';
  if(card.floor)h+='<span>'+esc(card.floor)+'</span>';
  h+='</div>';
  h+='<div class="modern-banner-room-guests '+guestCountClass+'">';
  if(guests.length)guests.forEach(function(member){h+='<div>'+esc(conferenceRoomMemberText(member))+'</div>'});
  else h+='<div class="modern-banner-room-empty">لا يوجد تسكين حاليًا</div>';
  h+='</div></div>';
  h+='<div class="welcome-card-footer"></div>';
  h+='<div class="no-print welcome-card-actions"><button class="btn btn-blue btn-sm" onclick="shareCard(\''+handlerKey+'\')">🔗</button><button class="btn btn-green btn-sm" onclick="downloadCardPng(\''+handlerKey+'\',this)">🖼️ PNG</button><button class="btn btn-purple btn-sm" onclick="printOne(\''+handlerKey+'\')">🖨️</button></div>';
  h+='</div>';
  return h;
}
function renderPersonConferenceCard(card){
  var checked=!!selectedCards[card.key];
  var handlerKey=cardHandlerKey(card.key);
  var branding=card.branding||{};
  if(normalizeConferenceCardTheme(branding.cardTheme)==='modern-banner')return renderModernBannerCard(card);
  var banner=branding.bannerPrepared||branding.banner||branding.logo||'assets/logo.jpg';
  var serviceLogo=branding.serviceLogo||branding.watermark||branding.logo||'assets/logo.jpg';
  var displayColors=getConferenceBrandingDisplayColors(branding);
  var primaryColor=displayColors[0];
  var secondaryColor=displayColors[1];
  var textColor=branding.textColor||'#1A2A3A';
  var fontFamily=branding.fontFamily||"'Segoe UI',Arial,sans-serif";
  var h='<div class="guest-card welcome-card'+(checked?' welcome-card-selected':'')+'" data-key="'+esc(card.key)+'" style="--welcome-primary:'+esc(primaryColor)+';--welcome-secondary:'+esc(secondaryColor)+';--welcome-text:'+esc(textColor)+';--welcome-font:'+esc(fontFamily)+'">';
  h+='<img class="welcome-card-watermark" src="'+esc(serviceLogo)+'" alt="" onerror="this.style.display=\'none\'">';
  if(cardsSelectionMode)h+='<label class="no-print welcome-card-selector"><input type="checkbox" '+(checked?'checked':'')+' onchange="toggleCard(\''+handlerKey+'\')"> تحديد</label>';
  h+='<div class="welcome-card-header"><img class="welcome-card-banner" src="'+esc(banner)+'" alt="الصورة الدعائية للمؤتمر" onerror="this.style.display=\'none\'"><div class="welcome-card-heading"><div class="welcome-card-greeting">أهلاً بك في</div><div class="welcome-card-conference">'+esc(card.conferenceName||'المؤتمر')+'</div></div></div>';
  h+='<div class="welcome-card-body">';
  h+='<div class="welcome-card-person"><span class="welcome-card-person-label">ضيف المؤتمر</span><strong>'+esc(card.name)+'</strong></div>';
  var bedLabel=conferenceCardBedLabel(card);
  if(bedLabel)h+='<div class="welcome-card-person-label" style="text-align:center">'+esc(bedLabel)+'</div>';
  h+='<div class="welcome-card-location">';
  if(card.houseName)h+='<div class="welcome-card-location-item"><span class="welcome-card-location-label">البيت</span><strong>'+esc(card.houseName)+'</strong></div>';
  if(card.room)h+='<div class="welcome-card-location-item"><span class="welcome-card-location-label">الغرفة</span><strong>'+esc(card.room)+'</strong></div>';
  if(card.floor)h+='<div class="welcome-card-location-item"><span class="welcome-card-location-label">الدور</span><strong>'+esc(card.floor)+'</strong></div>';
  h+='</div></div>';
  h+='<div class="welcome-card-footer"></div>';
  h+='<div class="no-print welcome-card-actions"><button class="btn btn-blue btn-sm" onclick="shareCard(\''+handlerKey+'\')">🔗</button><button class="btn btn-green btn-sm" onclick="downloadCardPng(\''+handlerKey+'\',this)">🖼️ PNG</button><button class="btn btn-purple btn-sm" onclick="printOne(\''+handlerKey+'\')">🖨️</button></div>';
  h+='</div>';
  return h;
}
function renderCards(){
  var tab = ge('tab4');
  if(typeof CardEngine === 'undefined' || !CardEngine || typeof CardEngine.getPersonCards !== 'function' || typeof CardEngine.getRoomCards !== 'function'){
    tab.innerHTML = '<div class="card" style="text-align:center;padding:20px;color:#95a5a6;">تعذر تحميل نظام الكروت.</div>';
    return;
  }
  var context = typeof CardEngine.getConferenceContext === 'function' ? CardEngine.getConferenceContext() : null;
  if (!context || !context.conference) { tab.innerHTML = ''; return; }

  var selC=getSelectedCardKeys().length;
  var totalCards=0;
  var items=[];
  function transportText(summary){
    var parts=[];
    (summary||[]).forEach(function(item){
      var label=item.transportName||'';
      if(item.seatNumber!==undefined&&item.seatNumber!==null&&item.seatNumber!=='')label+=(label?' ':'')+'كرسي '+item.seatNumber;
      if(label)parts.push(label);
    });
    return parts.join(' | ');
  }
  if(cardMode==='person'){
    var personCards=CardEngine.getPersonCards();
    totalCards=personCards.length;
    personCards.forEach(function(card){
      if(card.hasLeft)return;
      items.push({
        key:card.key,
        name:card.name,
        room:card.roomNumber,
        floor:card.floorName,
        conferenceName:card.conferenceName,
        houseName:card.houseName,
        branding:card.branding||{},
        personType:card.personType,
        bedType:card.bedType||'',
        extraBedPersonType:card.extraBedPersonType||'',
        type:card.personType==='child'?'🧒 طفل':'بالغ',
        note:card.personType==='child'?'ولي الأمر: '+(card.guardianName||''):'',
        members:null,
        transportText:transportText((card.transportSummary||[]).slice(0,1))
      });
    });
  } else {
    var roomCards=CardEngine.getRoomCards();
    totalCards=roomCards.length;
    roomCards.forEach(function(card){
      var members=(card.members||[]).filter(function(member){return !member.hasLeft;});
      if(!members.length)return;
      items.push({
        key:card.key,
        name:'غرفة '+card.roomNumber,
        room:card.roomNumber,
        floor:card.floorName,
        conferenceName:card.conferenceName,
        houseName:card.houseName,
        branding:card.branding||{},
        type:'غرفة',
        note:'',
        members:members,
        guests:members.map(function(member){return conferenceRoomMemberText(member)}),
        transportText:transportText(card.transportSummary)
      });
    });
  }
  var h='<div class="card no-print cards-dashboard">';
  h+='<div class="cards-dashboard-title">🪪 كروت الضيوف</div>';
  h+='<div class="cards-dashboard-stats"><div class="cards-dashboard-stat"><span>🪪</span><div><small>إجمالي الكروت</small><strong>'+totalCards+'</strong></div></div><div class="cards-dashboard-stat"><span>👁️</span><div><small>الكروت المعروضة حاليًا</small><strong>'+items.length+'</strong></div></div><div class="cards-dashboard-stat"><span>☑️</span><div><small>الكروت المحددة</small><strong>'+selC+'</strong></div></div></div>';
  h+='<div class="cards-dashboard-controls"><div class="cards-mode-controls"><button class="btn '+(cardMode==='person'?'btn-purple':'btn-gray')+'" onclick="setCardMode(\'person\')">👤 لكل فرد</button><button class="btn '+(cardMode==='room'?'btn-purple':'btn-gray')+'" onclick="setCardMode(\'room\')">🚪 لكل غرفة</button></div>';
  h+='<div class="cards-selection-controls"><button class="btn '+(cardsSelectionMode?'btn-purple':'btn-blue')+' btn-sm" onclick="toggleCardsSelectionMode()">☑️ تحديد متعدد</button>';
  if(cardsSelectionMode)h+='<button class="btn btn-blue btn-sm" onclick="selAll(true)">✔️ كل المعروض</button><button class="btn btn-gray btn-sm" onclick="clearSelectedCards()">✖️ إلغاء التحديد</button>';
  h+='</div></div></div>';
  if(selC)h+='<div class="card no-print cards-selection-actions"><strong>تم تحديد '+selC+' كارت</strong><div class="cards-selection-actions-buttons"><button class="btn btn-green" onclick="shareSelectedCards()">📤 مشاركة</button><button class="btn btn-blue" onclick="downloadSelectedCards()">💾 تحميل PNG</button><button class="btn btn-purple" onclick="printSel()">🖨️ طباعة</button><button class="btn btn-gray" onclick="clearSelectedCards()">✖️ إلغاء التحديد</button></div></div>';
  h+='<div class="grid3'+(cardMode==='person'?' welcome-cards-grid':'')+'" id="cardsGrid">';
  items.forEach(function(it){
    var checked=!!selectedCards[it.key];
    var handlerKey=cardHandlerKey(it.key);
    if(!it.members){
      h+=renderPersonConferenceCard(it);
      return;
    }
    if(normalizeConferenceCardTheme((it.branding||{}).cardTheme)==='modern-banner'){
      h+=renderModernBannerRoomCard(it);
      return;
    }
    h+='<div class="guest-card" data-key="'+esc(it.key)+'" style="'+(checked?'box-shadow:0 0 0 3px #27AE60':'')+';position:relative">';
    if(cardsSelectionMode)h+='<label class="no-print" style="position:absolute;top:5px;left:5px;background:#fff;border-radius:4px;padding:1px 5px;font-size:9px;display:flex;align-items:center;gap:2px;z-index:2;cursor:pointer"><input type="checkbox" '+(checked?'checked':'')+' onchange="toggleCard(\''+handlerKey+'\')" style="width:auto"> تحديد</label>';
    h+='<div class="gc-head">🪪 '+(it.members?'بطاقة غرفة':'بطاقة ضيف')+'</div>';
    h+='<div class="gc-body">';
    h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">'+(it.members?'الغرفة':'الاسم')+'</span><span style="font-weight:700">'+esc(it.name)+'</span></div>';
    h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">الغرفة/الدور</span><span>غرفة '+esc(it.room)+' — دور '+esc(it.floor)+'</span></div>';
    if(!it.members)h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">النوع</span><span>'+esc(it.type)+'</span></div>';
    else{h+='<div style="margin-top:4px">';it.members.forEach(function(m){h+='<div class="gc-row" style="font-size:10px"><span>'+esc(conferenceRoomMemberText(m))+'</span></div>'});h+='</div>';}
    if(it.note)h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">ملاحظة</span><span style="font-size:10px;color:#7D4E00">'+esc(it.note)+'</span></div>';
    if(it.transportText)h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">المواصلة</span><span style="font-size:10px">'+esc(it.transportText)+'</span></div>';
    h+='</div><div class="gc-foot">أهلاً وسهلاً 🌟</div>';
    h+='<div class="no-print" style="display:flex;gap:4px;padding:6px;background:#FAF5FF"><button class="btn btn-blue btn-sm" style="flex:1" onclick="shareCard(\''+handlerKey+'\')">🔗</button><button class="btn btn-purple btn-sm" style="flex:1" onclick="printOne(\''+handlerKey+'\')">🖨️</button></div>';
    h+='</div>';
  });
  h+='</div>';
  tab.innerHTML=h;
}
function setCardMode(m){cardMode=m==='room'?'room':'person';try{localStorage.setItem(CARDS_VIEW_MODE_KEY,cardMode)}catch(e){}renderCards()}
function toggleCard(k){selectedCards[k]=!selectedCards[k];renderCards()}
function getSelectedCardKeys(){
  return Object.keys(selectedCards).filter(function(key){
    return selectedCards[key]&&typeof CardEngine!=='undefined'&&CardEngine&&typeof CardEngine.getCardByKey==='function'&&!!CardEngine.getCardByKey(key);
  });
}
function toggleCardsSelectionMode(){
  cardsSelectionMode=!cardsSelectionMode;
  if(!cardsSelectionMode)selectedCards={};
  renderCards();
}
function clearSelectedCards(){selectedCards={};renderCards()}
var cardPngDownloads={};
var cardPngFiles={};
var cardPngFilePromises={};
function waitForCardCaptureAssets(element){
  var waits=[];
  if(document.fonts&&document.fonts.ready)waits.push(document.fonts.ready.catch(function(){}));
  element.querySelectorAll('img').forEach(function(image){
    if(image.complete){
      if(typeof image.decode==='function')waits.push(image.decode().catch(function(){}));
      return;
    }
    waits.push(new Promise(function(resolve){
      function done(){image.removeEventListener('load',done);image.removeEventListener('error',done);resolve()}
      image.addEventListener('load',done);
      image.addEventListener('error',done);
    }));
  });
  return Promise.all(waits).then(function(){
    return new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve)})});
  });
}
function captureCardElementAsPng(element,options){
  if(typeof html2canvas!=='function')return Promise.reject(new Error('html2canvas unavailable'));
  if(!element)return Promise.reject(new Error('card element unavailable'));
  var exportWidth=350;
  var stage=document.createElement('div');
  var exportCard=element.cloneNode(true);
  stage.setAttribute('aria-hidden','true');
  stage.style.cssText='position:fixed;left:-10000px;top:0;width:'+exportWidth+'px;max-width:none;margin:0;background:#fff;z-index:-1;';
  exportCard.classList.remove('welcome-card-selected');
  exportCard.style.width=exportWidth+'px';
  exportCard.style.maxWidth='none';
  exportCard.style.margin='0';
  var exportMedia=exportCard.querySelector('.modern-banner-media');
  var exportImage=exportCard.querySelector('.modern-banner-image');
  if(exportMedia){
    exportMedia.style.width='100%';
    exportMedia.style.height='180px';
    exportMedia.style.flex='0 0 180px';
    exportMedia.style.overflow='hidden';
  }
  if(exportImage){
    exportImage.style.display='block';
    exportImage.style.width='100%';
    exportImage.style.height='100%';
    exportImage.style.maxWidth='none';
    exportImage.style.objectFit='cover';
  }
  exportCard.querySelectorAll('.no-print').forEach(function(control){control.remove()});
  stage.appendChild(exportCard);
  document.body.appendChild(stage);
  function removeExportStage(){if(stage.parentNode)stage.parentNode.removeChild(stage)}
  return waitForCardCaptureAssets(exportCard).then(function(){
    var bounds=exportCard.getBoundingClientRect();
    var footer=exportCard.querySelector('.welcome-card-footer');
    var footerBounds=footer?footer.getBoundingClientRect():bounds;
    var visualHeight=Math.ceil(footerBounds.bottom-bounds.top);
    var captureOptions={
      scale:2,
      backgroundColor:'#ffffff',
      useCORS:true,
      logging:false,
      scrollX:0,
      scrollY:0
    };
    Object.keys(options||{}).forEach(function(name){captureOptions[name]=options[name]});
    var capturePromise;
    try{
      capturePromise=html2canvas(exportCard,captureOptions);
    }catch(error){
      removeExportStage();
      throw error;
    }
    return capturePromise.then(function(canvas){
      var renderedWidth=Math.max(1,bounds.width);
      var ratio=canvas.width/renderedWidth;
      var cropHeight=Math.min(canvas.height,Math.ceil(visualHeight*ratio));
      if(cropHeight>=canvas.height){removeExportStage();return canvas}
      var croppedCanvas=document.createElement('canvas');
      croppedCanvas.width=canvas.width;
      croppedCanvas.height=cropHeight;
      var croppedContext=croppedCanvas.getContext('2d');
      if(!croppedContext){removeExportStage();return canvas}
      croppedContext.drawImage(canvas,0,0,canvas.width,cropHeight,0,0,canvas.width,cropHeight);
      removeExportStage();
      return croppedCanvas;
    },function(error){
      removeExportStage();
      throw error;
    });
  },function(error){
    removeExportStage();
    throw error;
  });
}
function captureModernBannerCardAsPng(card,options){
  if(typeof html2canvas!=='function')return Promise.reject(new Error('html2canvas unavailable'));
  if(!card)return Promise.reject(new Error('card unavailable'));
  var stage=document.createElement('div');
  stage.setAttribute('aria-hidden','true');
  stage.style.cssText='position:fixed;left:-10000px;top:0;width:350px;max-width:none;margin:0;background:#fff;z-index:-1;';
  stage.innerHTML=renderModernBannerExport(card);
  var exportCard=stage.firstElementChild;
  if(!exportCard)return Promise.reject(new Error('card export unavailable'));
  document.body.appendChild(stage);
  function removeExportStage(){if(stage.parentNode)stage.parentNode.removeChild(stage)}
  return waitForCardCaptureAssets(exportCard).then(function(){
    var captureOptions={
      scale:2,
      backgroundColor:'#ffffff',
      useCORS:true,
      logging:false,
      scrollX:0,
      scrollY:0
    };
    Object.keys(options||{}).forEach(function(name){captureOptions[name]=options[name]});
    var capturePromise;
    try{
      capturePromise=html2canvas(exportCard,captureOptions);
    }catch(error){
      removeExportStage();
      throw error;
    }
    return capturePromise.then(function(canvas){
      removeExportStage();
      return canvas;
    },function(error){
      removeExportStage();
      throw error;
    });
  },function(error){
    removeExportStage();
    throw error;
  });
}
function findVisibleCardElementByKey(key){
  var cards=document.querySelectorAll('#cardsGrid .welcome-card[data-key]');
  for(var i=0;i<cards.length;i++)if(cards[i].dataset.key===key)return cards[i];
  return null;
}
function safeCardPngFilePart(value,fallback){
  var cleaned=String(value||'').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').replace(/\s+/g,'-').replace(/[. -]+$/g,'');
  return cleaned||fallback;
}
function getCardPngSignature(key){
  var card=typeof CardEngine!=='undefined'&&CardEngine&&typeof CardEngine.getCardByKey==='function'?CardEngine.getCardByKey(key):null;
  if(!card||(!card.personType&&card.type!=='room'))return '';
  var branding=card.branding||{};
  var displayColors=getConferenceBrandingDisplayColors(branding);
  var roomGuests=card.type==='room'?(card.members||[]).filter(function(member){return !member.hasLeft}).map(function(member){return [member.name||'',member.personType||'',member.bedType||'',member.extraBedPersonType||'']}):[];
  return JSON.stringify([
    'capture-v8',
    card.key||key,
    card.type||card.personType||'',
    card.name||'',
    card.conferenceName||'',
    card.houseName||'',
    card.roomNumber||'',
    card.floorName||'',
    card.bedType||'',
    card.extraBedPersonType||'',
    roomGuests,
    branding.banner||'',
    branding.bannerPrepared||'',
    branding.serviceLogo||'',
    branding.autoColors===true,
    branding.bannerPosition||'',
    branding.bannerFit||'',
    normalizeConferenceCardTheme(branding.cardTheme),
    displayColors[0],
    displayColors[1],
    branding.logo||'',
    branding.watermark||'',
    branding.primaryColor||'',
    branding.secondaryColor||'',
    branding.textColor||'',
    branding.fontFamily||''
  ]);
}
function getCardPngFile(key){
  var signature=getCardPngSignature(key);
  if(!signature)return Promise.reject(new Error('card unavailable'));
  if(cardPngFiles[key]&&cardPngFiles[key].signature===signature)return Promise.resolve(cardPngFiles[key].file);
  if(cardPngFilePromises[key]&&cardPngFilePromises[key].signature===signature)return cardPngFilePromises[key].promise;
  if(typeof html2canvas!=='function')return Promise.reject(new Error('html2canvas unavailable'));
  var card=typeof CardEngine!=='undefined'&&CardEngine&&typeof CardEngine.getCardByKey==='function'?CardEngine.getCardByKey(key):null;
  if(!card||(!card.personType&&card.type!=='room'))return Promise.reject(new Error('card unavailable'));
  var isModernBanner=normalizeConferenceCardTheme((card.branding||{}).cardTheme)==='modern-banner';
  var element=isModernBanner?null:findVisibleCardElementByKey(key);
  if(!isModernBanner&&!element)return Promise.reject(new Error('card unavailable'));
  var capturePromise=isModernBanner?captureModernBannerCardAsPng(card):captureCardElementAsPng(element);
  var promise=capturePromise.then(function(canvas){
    return new Promise(function(resolve,reject){
      canvas.toBlob(function(blob){
        if(!blob){reject(new Error('png unavailable'));return}
        var personName=safeCardPngFilePart(card.name,'ضيف');
        var roomNumber=safeCardPngFilePart(card.roomNumber,'بدون-غرفة');
        var fileName=card.type==='room'?'بطاقة-غرفة-'+roomNumber+'.png':'بطاقة-'+personName+'-'+roomNumber+'.png';
        var file=new File([blob],fileName,{type:'image/png'});
        resolve(file);
      },'image/png');
    });
  }).then(function(file){
    if(cardPngFilePromises[key]&&cardPngFilePromises[key].promise===promise)delete cardPngFilePromises[key];
    if(getCardPngSignature(key)!==signature)return getCardPngFile(key);
    cardPngFiles[key]={signature:signature,file:file};
    return file;
  },function(error){
    if(cardPngFilePromises[key]&&cardPngFilePromises[key].promise===promise)delete cardPngFilePromises[key];
    throw error;
  });
  cardPngFilePromises[key]={signature:signature,promise:promise};
  return promise;
}
function downloadCardPngFile(file){
  var url=URL.createObjectURL(file);
  var link=document.createElement('a');
  link.download=file.name;
  link.href=url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function(){URL.revokeObjectURL(url)},1000);
}
function downloadCardPng(key,button){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('downloadCardPng',null))return false;
  if(cardPngDownloads[key])return;
  cardPngDownloads[key]=true;
  var oldText=button?button.textContent:'';
  if(button){button.disabled=true;button.textContent='جارٍ الإنشاء...'}
  getCardPngFile(key).then(function(file){
    downloadCardPngFile(file);
  }).catch(function(){
    showToast('تعذر إنشاء صورة الكارت.','#E74C3C');
  }).then(function(){
    delete cardPngDownloads[key];
    if(button){button.disabled=false;button.textContent=oldText}
  });
}
function selAll(v){document.querySelectorAll('#cardsGrid .guest-card').forEach(function(el){selectedCards[el.dataset.key]=v});renderCards()}
function cardText(k){var c=document.querySelector('.guest-card[data-key="'+k+'"]');if(!c)return'';var l=[];c.querySelectorAll('.gc-row').forEach(function(r){var s=r.querySelectorAll('span');if(s.length>=2)l.push(s[0].textContent+': '+s[1].textContent)});return'🪪 بطاقة ضيف\n'+l.join('\n')+'\nأهلاً وسهلاً 🌟'}
var shareCenterCardKey='';
function getShareCenterCard(){
  if(!shareCenterCardKey||typeof CardEngine==='undefined'||!CardEngine||typeof CardEngine.getCardByKey!=='function')return null;
  return CardEngine.getCardByKey(shareCenterCardKey);
}
function normalizePhoneNumber(phone){
  var arabicDigits='٠١٢٣٤٥٦٧٨٩';
  var easternDigits='۰۱۲۳۴۵۶۷۸۹';
  var normalized=String(phone||'').trim().replace(/[٠-٩]/g,function(digit){return arabicDigits.indexOf(digit)}).replace(/[۰-۹]/g,function(digit){return easternDigits.indexOf(digit)}).replace(/[\s()\-]/g,'').replace(/[^0-9+]/g,'');
  if(normalized.indexOf('0020')===0)normalized=normalized.substring(2);
  else if(normalized.indexOf('+20')===0)normalized=normalized.substring(1);
  normalized=normalized.replace(/\D/g,'');
  if(/^01\d{9}$/.test(normalized))normalized='20'+normalized.substring(1);
  return normalized;
}
function buildConferenceCardShareMessage(card){
  if(card&&card.type==='room'){
    var guestNames=(card.members||[]).filter(function(member){return !member.hasLeft}).map(function(member){return member.name||''}).filter(function(name){return !!name});
    return 'أهلاً بك في '+(card.conferenceName||'')+'\n\nالغرفة:\n'+(card.roomNumber||'')+'\n\nالبيت:\n'+(card.houseName||'')+'\n\nالدور:\n'+(card.floorName||'')+(guestNames.length?'\n\nالمقيمون:\n'+guestNames.join('\n'):'')+'\n\nنتمنى لكم مؤتمرًا مباركًا.';
  }
  return 'أهلاً بك في '+(card.conferenceName||'')+'\n\nالاسم:\n'+(card.name||'')+'\n\nالبيت:\n'+(card.houseName||'')+'\n\nالغرفة:\n'+(card.roomNumber||'')+'\n\nالدور:\n'+(card.floorName||'')+'\n\nنتمنى لك مؤتمرًا مباركًا.';
}
function setShareCenterButtonBusy(button,busy,busyText){
  if(!button)return;
  if(busy){button.dataset.originalText=button.textContent;button.disabled=true;button.textContent=busyText}
  else{button.disabled=false;button.textContent=button.dataset.originalText||button.textContent;delete button.dataset.originalText}
}
function closeShareCenter(){
  var modal=ge('shareCenterModal');
  if(modal&&modal.parentNode)modal.parentNode.removeChild(modal);
  shareCenterCardKey='';
}
function openShareCenter(key){
  if(typeof CardEngine==='undefined'||!CardEngine||typeof CardEngine.getCardByKey!=='function'){showToast('تعذر تحميل نظام الكروت.','#E74C3C');return}
  var card=CardEngine.getCardByKey(key);
  if(!card||(!card.personType&&card.type!=='room')){showToast('تعذر العثور على الكارت.','#E74C3C');return}
  var cardTitle=card.type==='room'?'الغرفة '+(card.roomNumber||'—'):(card.name||'ضيف');
  closeShareCenter();
  shareCenterCardKey=key;
  var overlay=document.createElement('div');
  overlay.id='shareCenterModal';
  overlay.className='overlay app-modal share-center-overlay';
  overlay.onclick=function(event){if(event.target===overlay)closeShareCenter()};
  overlay.innerHTML='<div class="modal share-center-modal" role="dialog" aria-modal="true" aria-labelledby="shareCenterTitle"><div class="mhead"><span id="shareCenterTitle">مشاركة بطاقة المؤتمر</span><span class="share-center-close" role="button" tabindex="0" onclick="closeShareCenter()">✕</span></div><div class="mbody"><div class="share-center-person"><strong>'+esc(cardTitle)+'</strong><div class="share-center-details"><span><b>الغرفة</b>'+esc(card.roomNumber||'—')+'</span><span><b>الدور</b>'+esc(card.floorName||'—')+'</span><span><b>البيت</b>'+esc(card.houseName||'—')+'</span></div></div><label class="lbl" for="shareCenterPhone">رقم الهاتف</label><input id="shareCenterPhone" class="share-center-phone" type="tel" inputmode="tel" value="'+esc(card.phone||'')+'" placeholder="اكتب أي رقم للإرسال دون حفظه"><div class="share-center-phone-note">يُستخدم هذا الرقم لهذه المشاركة فقط ولا يتم حفظه.</div><div class="share-center-actions"><button class="btn btn-green share-center-primary-action" onclick="shareCenterViaSystem(this)">📤 مشاركة الكارت</button><button class="btn btn-green" onclick="openShareCenterWhatsApp(this)">💬 فتح واتساب</button><button class="btn btn-blue" onclick="downloadShareCenterPng(this)">💾 تنزيل PNG</button></div></div></div>';
  document.body.appendChild(overlay);
  overlay.style.display='flex';
  var phoneInput=ge('shareCenterPhone');
  if(phoneInput&&!card.phone)phoneInput.focus();
}
function shareCard(k){openShareCenter(k)}
var selectedCardsQueue=[];
var selectedCardsQueueIndex=0;
var selectedCardsQueueMode='share';
var selectedCardsOnePhonePrepared=false;
function getCardShareTitle(card){
  return card&&card.type==='room'?'الغرفة '+(card.roomNumber||'—'):((card&&card.name)||'ضيف');
}
function closeSelectedCardsShareCenter(){
  var modal=ge('selectedCardsShareModal');
  if(modal&&modal.parentNode)modal.parentNode.removeChild(modal);
  selectedCardsQueue=[];
  selectedCardsQueueIndex=0;
  selectedCardsOnePhonePrepared=false;
}
function createSelectedCardsShareOverlay(title,content){
  var currentModal=ge('selectedCardsShareModal');
  if(currentModal&&currentModal.parentNode)currentModal.parentNode.removeChild(currentModal);
  var overlay=document.createElement('div');
  overlay.id='selectedCardsShareModal';
  overlay.className='overlay app-modal share-center-overlay';
  overlay.onclick=function(event){if(event.target===overlay)closeSelectedCardsShareCenter()};
  overlay.innerHTML='<div class="modal share-center-modal cards-bulk-share-modal" role="dialog" aria-modal="true"><div class="mhead"><span>'+esc(title)+'</span><span class="share-center-close" role="button" tabindex="0" onclick="closeSelectedCardsShareCenter()">✕</span></div><div class="mbody">'+content+'</div></div>';
  document.body.appendChild(overlay);
  overlay.style.display='flex';
  return overlay;
}
function shareSelectedCards(){
  var keys=getSelectedCardKeys();
  if(!keys.length){showToast('اختر كارتًا واحدًا على الأقل.','#E67E22');return}
  if(keys.length===1){shareCard(keys[0]);return}
  addActivityLog('cards_share_started','تم بدء مشاركة مجموعة كروت',{details:'عدد الكروت: '+keys.length,section:'cards',entityType:'card_selection',entityId:''});
  var content='<p class="cards-bulk-share-intro">اختر طريقة مشاركة '+keys.length+' كارت.</p><div class="share-center-actions"><button class="btn btn-green share-center-primary-action" onclick="openSelectedCardsQueue(\'share\')">إرسال بالتتابع لكل صاحب</button><button class="btn btn-blue" onclick="openSelectedCardsOnePhone()">مشاركة الكروت مع رقم واحد</button></div>';
  createSelectedCardsShareOverlay('مركز مشاركة الكروت',content);
}
function downloadSelectedCards(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('downloadSelectedCards',null))return false;
  var keys=getSelectedCardKeys();
  if(!keys.length){showToast('اختر كارتًا واحدًا على الأقل.','#E67E22');return}
  if(keys.length===1){downloadCardPng(keys[0],null);return}
  openSelectedCardsQueue('download');
}
function openSelectedCardsQueue(mode){
  selectedCardsQueue=getSelectedCardKeys();
  selectedCardsQueueIndex=0;
  selectedCardsQueueMode=mode==='download'?'download':'share';
  renderSelectedCardsQueueItem();
}
function renderSelectedCardsQueueItem(){
  if(selectedCardsQueueIndex>=selectedCardsQueue.length){
    createSelectedCardsShareOverlay('اكتملت القائمة','<div class="cards-queue-complete">✅ تمت مراجعة جميع الكروت المحددة.</div><div class="share-center-actions"><button class="btn btn-gray" onclick="closeSelectedCardsShareCenter()">إغلاق</button></div>');
    return;
  }
  var key=selectedCardsQueue[selectedCardsQueueIndex];
  var card=CardEngine.getCardByKey(key);
  if(!card){selectedCardsQueueIndex++;renderSelectedCardsQueueItem();return}
  var counter=(selectedCardsQueueIndex+1)+' من '+selectedCardsQueue.length;
  var primaryText=selectedCardsQueueMode==='download'?'💾 تنزيل الكارت الحالي':'📤 مشاركة الكارت الحالي';
  var primaryAction=selectedCardsQueueMode==='download'?'downloadSelectedQueueCard(this)':'shareSelectedQueueCard(this)';
  var content='<div class="cards-queue-counter">'+counter+'</div><div class="share-center-person"><strong>'+esc(getCardShareTitle(card))+'</strong><div class="share-center-details"><span><b>الغرفة</b>'+esc(card.roomNumber||'—')+'</span><span><b>الدور</b>'+esc(card.floorName||'—')+'</span><span><b>البيت</b>'+esc(card.houseName||'—')+'</span></div></div><label class="lbl" for="selectedQueuePhone">رقم الهاتف</label><input id="selectedQueuePhone" class="share-center-phone" type="tel" inputmode="tel" value="'+esc(card.phone||'')+'" placeholder="رقم بديل لهذه المشاركة فقط"><div class="share-center-phone-note">الرقم مؤقت ولا يتم حفظه.</div><div class="share-center-actions"><button class="btn btn-green share-center-primary-action" onclick="'+primaryAction+'">'+primaryText+'</button><button class="btn btn-gray" onclick="skipSelectedQueueCard()">تخطي والانتقال للتالي</button></div>';
  createSelectedCardsShareOverlay(selectedCardsQueueMode==='download'?'تنزيل الكروت بالتتابع':'إرسال بالتتابع لكل صاحب',content);
}
function advanceSelectedCardsQueue(){selectedCardsQueueIndex++;renderSelectedCardsQueueItem()}
function skipSelectedQueueCard(){advanceSelectedCardsQueue()}
function shareSelectedQueueCard(button){
  var key=selectedCardsQueue[selectedCardsQueueIndex];
  var card=CardEngine.getCardByKey(key);
  if(!card)return;
  if(!navigator.share||!navigator.canShare){showToast('هذا الجهاز لا يدعم مشاركة الصور مباشرة. استخدم تنزيل PNG.','#E67E22');return}
  setShareCenterButtonBusy(button,true,'جارٍ تجهيز الكارت...');
  getCardPngFile(key).then(function(file){
    var data={title:getCardShareTitle(card),text:buildConferenceCardShareMessage(card),files:[file]};
    if(!navigator.canShare(data)){var error=new Error('file sharing unsupported');error.name='NotSupportedError';throw error}
    return navigator.share(data);
  }).then(function(){advanceSelectedCardsQueue()}).catch(function(error){
    if(error&&error.name==='AbortError')return;
    if(error&&error.name==='NotSupportedError'){showToast('هذا الجهاز لا يدعم مشاركة الصور مباشرة. استخدم تنزيل PNG.','#E67E22');return}
    showToast('تعذر مشاركة صورة الكارت عبر النظام.','#E74C3C');
  }).then(function(){setShareCenterButtonBusy(button,false,'')});
}
function downloadSelectedQueueCard(button){
  var key=selectedCardsQueue[selectedCardsQueueIndex];
  setShareCenterButtonBusy(button,true,'جارٍ تجهيز الكارت...');
  getCardPngFile(key).then(function(file){
    downloadCardPngFile(file);
    advanceSelectedCardsQueue();
  }).catch(function(){showToast('تعذر إنشاء صورة الكارت.','#E74C3C')}).then(function(){setShareCenterButtonBusy(button,false,'')});
}
function openSelectedCardsOnePhone(){
  selectedCardsQueue=getSelectedCardKeys();
  selectedCardsOnePhonePrepared=false;
  var content='<label class="lbl" for="selectedCardsOnePhone">رقم الهاتف</label><input id="selectedCardsOnePhone" class="share-center-phone" type="tel" inputmode="tel" placeholder="أدخل الرقم المستخدم لفتح واتساب"><div class="share-center-phone-note">الرقم مؤقت ولا يتم حفظه، ولن تُرسل الملفات تلقائيًا.</div><div class="share-center-actions"><button class="btn btn-green share-center-primary-action" onclick="shareSelectedCardsFiles(this)">📤 تجهيز ومشاركة جميع الكروت</button><button id="selectedCardsOpenWhatsApp" class="btn btn-green" disabled onclick="openSelectedCardsWhatsApp()">💬 فتح واتساب يدويًا</button><button class="btn btn-blue" onclick="openSelectedCardsQueue(\'share\')">مشاركة الملفات فرديًا</button><button class="btn btn-gray" onclick="openSelectedCardsQueue(\'download\')">تحميل الملفات فرديًا</button></div>';
  createSelectedCardsShareOverlay('مشاركة الكروت مع رقم واحد',content);
}
function shareSelectedCardsFiles(button){
  var keys=selectedCardsQueue.slice();
  if(!keys.length)return;
  setShareCenterButtonBusy(button,true,'جارٍ تجهيز الكروت...');
  Promise.all(keys.map(function(key){return getCardPngFile(key)})).then(function(files){
    selectedCardsOnePhonePrepared=true;
    var whatsappButton=ge('selectedCardsOpenWhatsApp');
    if(whatsappButton)whatsappButton.disabled=false;
    if(!navigator.share||!navigator.canShare){var unavailableError=new Error('multiple file sharing unsupported');unavailableError.name='NotSupportedError';throw unavailableError}
    var data={title:'كروت المؤتمر',files:files};
    if(!navigator.canShare(data)){var error=new Error('multiple file sharing unsupported');error.name='NotSupportedError';throw error}
    return navigator.share(data);
  }).catch(function(error){
    if(error&&error.name==='AbortError')return;
    if(error&&error.name==='NotSupportedError'){showToast('هذا الجهاز لا يدعم مشاركة عدة صور مباشرة. استخدم المشاركة أو التحميل الفردي.','#E67E22');return}
    showToast('تعذر تجهيز أو مشاركة الكروت.','#E74C3C');
  }).then(function(){setShareCenterButtonBusy(button,false,'')});
}
function openSelectedCardsWhatsApp(){
  if(!selectedCardsOnePhonePrepared){showToast('جهّز ملفات الكروت أولًا.','#E67E22');return}
  var input=ge('selectedCardsOnePhone');
  var phone=normalizePhoneNumber(input?input.value:'');
  if(!phone){showToast('أدخل رقم هاتف صحيح.','#E74C3C');if(input)input.focus();return}
  if(!/^20(?:10|11|12|15)\d{8}$/.test(phone)){showToast('رقم الهاتف غير صحيح.','#E74C3C');if(input)input.focus();return}
  var whatsappWindow=window.open('https://wa.me/'+phone,'conferenceWhatsAppBulkShare');
  if(!whatsappWindow){showToast('تعذر فتح واتساب. يرجى السماح بالنوافذ المنبثقة.','#E67E22');return}
  whatsappWindow.focus();
}
function downloadShareCenterPng(button){
  var key=shareCenterCardKey;
  if(!key)return;
  downloadCardPng(key,button);
}
function shareCenterViaSystem(button){
  var card=getShareCenterCard();
  if(!card)return;
  if(!navigator.share||!navigator.canShare){showToast('هذا الجهاز لا يدعم مشاركة الصور مباشرة. يمكنك فتح واتساب أو تنزيل PNG.','#E67E22');return}
  addActivityLog('card_shared','تمت مشاركة كارت واحد',{details:getCardShareTitle(card),section:'cards',entityType:card.type==='room'?'room':'person',entityId:shareCenterCardKey});
  setShareCenterButtonBusy(button,true,'جارٍ تجهيز البطاقة...');
  getCardPngFile(shareCenterCardKey).then(function(file){
    var shareData={title:card.type==='room'?'بطاقة الغرفة '+(card.roomNumber||''):'بطاقة '+(card.name||'ضيف'),text:buildConferenceCardShareMessage(card),files:[file]};
    if(!navigator.canShare(shareData)){var unsupportedError=new Error('file sharing unsupported');unsupportedError.name='NotSupportedError';throw unsupportedError}
    return navigator.share(shareData);
  }).catch(function(error){
    if(error&&error.name==='AbortError')return;
    if(error&&error.name==='NotSupportedError'){showToast('هذا الجهاز لا يدعم مشاركة الصور مباشرة. يمكنك فتح واتساب أو تنزيل PNG.','#E67E22');return}
    showToast('تعذر مشاركة صورة البطاقة عبر النظام.','#E74C3C');
  }).then(function(){setShareCenterButtonBusy(button,false,'')});
}
function copyCardPngToClipboard(file){
  if(!navigator.clipboard||typeof navigator.clipboard.write!=='function'||typeof ClipboardItem==='undefined')return Promise.reject(new Error('image clipboard unsupported'));
  var item=new ClipboardItem({'image/png':file});
  return navigator.clipboard.write([item]);
}
function openShareCenterWhatsApp(button){
  var card=getShareCenterCard();
  var phoneInput=ge('shareCenterPhone');
  var inputPhone=phoneInput?phoneInput.value:'';
  var phone=normalizePhoneNumber(inputPhone);
  if(!card)return;
  if(!phone){showToast('أدخل رقم هاتف صحيح.','#E74C3C');if(phoneInput)phoneInput.focus();return}
  if(!/^20(?:10|11|12|15)\d{8}$/.test(phone)){showToast('رقم الهاتف غير صحيح.','#E74C3C');if(phoneInput)phoneInput.focus();return}
  addActivityLog('card_shared','تمت مشاركة كارت واحد',{details:getCardShareTitle(card),section:'cards',entityType:card.type==='room'?'room':'person',entityId:shareCenterCardKey});
  var whatsappUrl='https://wa.me/'+phone;
  var supportsImageClipboard=navigator.clipboard&&typeof navigator.clipboard.write==='function'&&typeof ClipboardItem!=='undefined';
  if(!supportsImageClipboard){
    var fallbackWindow=window.open(whatsappUrl,'_blank');
    if(!fallbackWindow){showToast('تعذر فتح واتساب. يرجى السماح بالنوافذ المنبثقة.','#E74C3C');return}
    showToast('هذا المتصفح لا يدعم نسخ الصور، استخدم زر تنزيل PNG لإرسال الكارت.','#E67E22');
    return;
  }
  if(!document.hasFocus()){
    showToast(
      'اضغط داخل صفحة البرنامج ثم حاول مرة أخرى.',
      '#E67E22'
    );
    return;
  }
  setShareCenterButtonBusy(button,true,'جارٍ نسخ الكارت...');
  getCardPngFile(shareCenterCardKey).then(function(file){
    return copyCardPngToClipboard(file);
  }).then(function(){
    showToast('تم نسخ الكارت. بعد فتح واتساب استخدم لصق (Ctrl+V أو Paste) لإرسال الصورة.','#27AE60');
    var whatsappWindow=window.open(
      whatsappUrl,
      'conferenceWhatsAppShare'
    );
    if(!whatsappWindow){
      showToast(
        'تم نسخ الكارت، لكن تعذر فتح واتساب. يرجى السماح بالنوافذ المنبثقة.',
        '#E67E22'
      );
      return;
    }
    whatsappWindow.focus();
  }).catch(function(error){
    var whatsappWindow=window.open(
      whatsappUrl,
      'conferenceWhatsAppShare'
    );
    if(!whatsappWindow){
      showToast(
        'تعذر فتح واتساب. يرجى السماح بالنوافذ المنبثقة.',
        '#E67E22'
      );
    }else{
      whatsappWindow.focus();
    }
    console.error(
      'تعذر نسخ صورة الكارت إلى الحافظة:',
      error
    );
    if(
      error&&
      (
        error.name==='NotAllowedError'||
        error.name==='SecurityError'
      )
    ){
      showToast(
        'رفض المتصفح نسخ الصورة أو أن الصفحة ليست في سياق آمن. استخدم زر تنزيل PNG.',
        '#E67E22'
      );
      return;
    }
    showToast(
      'هذا المتصفح لا يدعم نسخ الصور. استخدم زر تنزيل PNG.',
      '#E67E22'
    );
  }).then(function(){setShareCenterButtonBusy(button,false,'')});
}
function printOne(k){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('printOne',null))return false;
  addActivityLog('card_printed','تمت طباعة كارت واحد',{section:'cards',entityType:'card',entityId:k});
  document.body.classList.add('print-single-card');
  document.body.classList.remove('print-multiple-cards');
  document.querySelectorAll('.guest-card').forEach(function(el){
    el.classList.remove('print-page-break');
    el.style.display = el.dataset.key === k ? '' : 'none';
  });
  window.print();setTimeout(function(){document.querySelectorAll('.guest-card').forEach(function(el){el.style.display=''});document.body.classList.remove('print-single-card')},500)}
function printSel(){if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('printSel',null))return false;var ks=Object.keys(selectedCards).filter(function(k){return selectedCards[k]});if(!ks.length){alert('اختر كارت واحد على الأقل');return}addActivityLog('cards_printed','تمت طباعة مجموعة كروت',{details:'عدد الكروت: '+ks.length,section:'cards',entityType:'card_selection',entityId:''});document.body.classList.remove('print-single-card');document.body.classList.add('print-multiple-cards');var printedCount=0;document.querySelectorAll('.guest-card').forEach(function(el){var isPrinted=!!selectedCards[el.dataset.key];el.style.display=isPrinted?'':'none';el.classList.remove('print-page-break');if(isPrinted){printedCount++;if(printedCount%8===0)el.classList.add('print-page-break')}});window.print();setTimeout(function(){document.querySelectorAll('.guest-card').forEach(function(el){el.style.display='';el.classList.remove('print-page-break')});document.body.classList.remove('print-multiple-cards')},500)}

// ═══════════════════════════════════════════════════════
// TAB 5: SETTINGS
// ═══════════════════════════════════════════════════════
var startupClockTimer = null;

function updateStartupDateTime(){
  var now = new Date();
  var dayName = ge('startupDayName');
  var dateText = ge('startupDateText');
  var timeText = ge('startupTimeText');
  if(dayName) dayName.textContent = now.toLocaleDateString('ar-EG', { weekday: 'long' });
  if(dateText) dateText.textContent = now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  if(timeText) timeText.textContent = now.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
}

function setApplicationMode(mode){
  var startup = mode === 'startup';
  if(startup&&window.ConferenceTemplateHousesEditor){
    window.ConferenceTemplateHousesEditor.close();
  }
  var startupScreen = ge('startupScreen');
  var topbar = ge('applicationTopbar');
  var body = ge('applicationBody');
  if(startupScreen) startupScreen.style.display = startup ? 'flex' : 'none';
  if(topbar) topbar.style.display = startup ? 'none' : '';
  if(body) body.style.display = startup ? 'none' : '';
  if(startup){
    updateStartupDateTime();
    if(!startupClockTimer) startupClockTimer = setInterval(updateStartupDateTime, 30000);
  } else if(startupClockTimer){
    clearInterval(startupClockTimer);
    startupClockTimer = null;
  }
}

/*
==================================================
Application Navigation - Central Entry Points
==================================================

قواعد مهمة:

1. أي انتقال إلى شاشة البداية أو الصفحة الرئيسية
   يجب أن يمر من خلال:
   openStartupScreen(options)

2. أي فتح لمؤتمر من شاشة البداية
   يجب أن يمر من خلال:
   openConferenceFromStartup(conferenceId)

3. يمنع تنفيذ إظهار أو إخفاء العناصر التالية مباشرة
   من أي مسار آخر:
   - startupScreen
   - appShell
   - tabs
   - tab contents

4. يمنع تعديل currentConferenceId داخل مسارات العرض فقط.
   يتم تغييره فقط عند:
   - اختيار مؤتمر
   - إنهاء مؤتمر
   - حذف مؤتمر
   - العودة الصريحة مع clearCurrentConference:true

5. حالة الواجهة تحفظ بشكل مستقل عن آخر تبويب:
   - conference_manager_view
   - conference_manager_last_tab

6. لا تضع القيمة "home" داخل مفتاح أرقام التبويبات.

أي ميزة أو زر جديد يحتاج التنقل يجب أن يستخدم
الدوال المركزية الحالية بدل إنشاء مسار مستقل.
*/
function openStartupScreen(options){
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  ensureOrganizationManagementAccess();
  options=options||{};
  closeOrganizationManagementScreen();
  document.body.classList.remove('accommodation-shell-active');
  var clearCurrentConference=options.clearCurrentConference===true;
  var persistView=options.persistView!==false;
  var previousCurrentConferenceId=appData.currentConferenceId;

  if(clearCurrentConference&&previousCurrentConferenceId){
    appData.currentConferenceId=null;
    if(!save()){
      appData.currentConferenceId=previousCurrentConferenceId;
      return false;
    }
  }

  showStartupConferenceList();
  setApplicationMode('startup');
  getValidApplicationTabIds().forEach(function(id){
    var content=ge('tab'+id);
    if(content)content.style.display='none';
  });
  document.querySelectorAll('.tab').forEach(function(tab){
    tab.classList.remove('active','main-tab-active');
  });
  var homeTabButton=ge('homeTabButton');
  if(homeTabButton)homeTabButton.classList.add('active','main-tab-active');
  currentApplicationView='startup';
  if(persistView)saveApplicationView('startup');
  return true;
}

function conferenceStatusText(conference){
  if(conference && conference.status === 'active') return 'نشط';
  if(conference && conference.status === 'completed') return 'مكتمل';
  return '';
}

function conferenceStatusBadge(conference){
  var statusText = conferenceStatusText(conference);
  var background = conference && conference.status === 'completed' ? '#E8EAF6' : '#D5F5E3';
  var color = conference && conference.status === 'completed' ? '#3949AB' : '#1E8449';
  return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:'+background+';color:'+color+';font-size:10px;font-weight:700">'+statusText+'</span>';
}

function renderStartupConferenceGroup(title, emptyMessage, conferences){
  var html = '<div style="margin:14px 0 8px;font-weight:700;color:#1F4E79">'+title+'</div>';
  if(!conferences.length){
    return html + '<div style="padding:10px;background:#F7FBFF;border-radius:8px;color:#7A8EA6;text-align:center;font-size:11px">'+emptyMessage+'</div>';
  }
  html += '<div style="display:flex;flex-direction:column;gap:10px">';
  conferences.forEach(function(conf){
    html += '<div style="padding:12px;background:#F7FBFF;border:1px solid #E3EEF9;border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:10px">';
    html += '<div><div style="display:flex;align-items:center;gap:7px;font-weight:600;color:#1F4E79">'+esc(conf.name || 'المؤتمر')+' '+conferenceStatusBadge(conf)+'</div>';
    html += '<div style="font-size:12px;color:#666">'+esc(conf.startDate || '-')+' — '+esc(conf.endDate || '-')+'</div></div>';
    html += '<button class="btn btn-blue btn-sm" onclick="openConferenceFromStartup(\''+conf.id+'\')">فتح</button></div>';
  });
  return html + '</div>';
}

function getStartupConferenceParticipantCount(conference){
  var people = conference && conference.peopleDb && Array.isArray(conference.peopleDb.people) ? conference.peopleDb.people : [];
  var seen = {};
  var count = 0;
  people.forEach(function(person, index){
    if(!person) return;
    var key = person.id || ((person.fullName || person.name || '') + '|' + (person.phone || '')) || ('person_' + index);
    if(seen[key]) return;
    seen[key] = true;
    count++;
  });
  return count;
}

function renderStartupConferenceCards(conferences, status){
  if(!conferences.length){
    var emptyIcon=status==='completed'&&window.AppIcons
      ?'<span class="startup-empty-icon">'+window.AppIcons.icon('checkCircle','','')+'</span>'
      :'';
    return '<div class="startup-empty">'+emptyIcon+'<span>'+(status === 'active' ? 'لا توجد مؤتمرات نشطة' : 'لا توجد مؤتمرات مكتملة')+'</span></div>';
  }
  var html = '';
  conferences.forEach(function(conf){
    var days = parseInt(conf.days || ((conf.conf || {}).days), 10) || 1;
    var participantCount = getStartupConferenceParticipantCount(conf);
    var statusClass = status === 'active' ? 'startup-status-active' : 'startup-status-completed';
    var cardClass = status === 'active' ? 'startup-conference-card-active' : 'startup-conference-card-completed';
    if(conf.__startupDiscoveredRemoteId&&
      startupDiscoveredOpenBusy[conf.__startupDiscoveredRemoteId]){
      html += '<article class="startup-conference-card '+cardClass+'" aria-disabled="true">';
    }else if(conf.__startupDiscoveredRemoteId){
      html += '<article class="startup-conference-card '+cardClass+'" onclick="openDiscoveredConferenceFromStartup(\''+conf.__startupDiscoveredRemoteId+'\')">';
    }else{
      html += '<article class="startup-conference-card '+cardClass+'" onclick="openConferenceFromStartup(\''+conf.id+'\')">';
    }
    html += '<div class="startup-conference-head"><span class="startup-status-badge '+statusClass+'">'+conferenceStatusText(conf)+'</span><strong>'+esc(conf.name || ((conf.conf || {}).name) || 'المؤتمر')+'</strong></div>';
    html += '<div class="startup-conference-meta">';
    html += '<span>📅 '+esc(conf.startDate || ((conf.conf || {}).startDate) || '-')+'</span>';
    html += '<span>← 📅 '+esc(conf.endDate || ((conf.conf || {}).endDate) || '-')+'</span>';
    html += '<span>📅 '+days+' أيام</span>';
    html += '<span>👥 '+participantCount+' مشارك</span>';
    html += '</div><span class="startup-conference-open">'+accommodationIcon('eye')+(status === 'active' ? 'فتح المؤتمر' : 'عرض التفاصيل')+'</span></article>';
  });
  return html;
}

var startupDiscoveredOpenBusy=Object.create(null);
function openDiscoveredConferenceFromStartup(remoteConferenceId){
  if(!window.DiscoveredConferenceOpenService||
    typeof window.DiscoveredConferenceOpenService.open!=='function')return false;
  remoteConferenceId=String(remoteConferenceId||'');
  if(startupDiscoveredOpenBusy[remoteConferenceId]){
    return startupDiscoveredOpenBusy[remoteConferenceId];
  }
  var flight=window.DiscoveredConferenceOpenService.open(remoteConferenceId)
    .then(function(result){
      if(!result||!result.ok){
        var failedStage=result&&(result.failedStage||result.status||
          result.data&&result.data.failedStage)||'unknown';
        showToast('تعذر إكمال العملية بأمان. المرحلة: '+failedStage,'#E74C3C');
      }
      return result;
    })
    .finally(function(){
      if(startupDiscoveredOpenBusy[remoteConferenceId]===flight){
        delete startupDiscoveredOpenBusy[remoteConferenceId];
        showStartupConferenceList();
      }
    });
  startupDiscoveredOpenBusy[remoteConferenceId]=flight;
  showStartupConferenceList();
  return flight;
}

function getStartupConferenceViewModel(){
  var localConferences=Array.isArray(appData&&appData.conferences)
    ?appData.conferences.filter(function(conference){
      return !conference||
        typeof isConferenceImportRecoveryPending!=='function'||
        !isConferenceImportRecoveryPending(appData,conference.id);
    }):[];
  var merged=localConferences.slice();
  var remoteIds=Object.create(null);
  localConferences.forEach(function(conference){
    if(!conference)return;
    var localId=String(conference.id||'');
    var link=window.ConferenceLinkStore&&
      typeof window.ConferenceLinkStore.get==='function'
      ?window.ConferenceLinkStore.get(localId):null;
    var linkedRemoteId=String(link&&link.remoteConferenceId||'');
    if(linkedRemoteId)remoteIds[linkedRemoteId]=true;
  });
  var discovered=window.StartupConferenceDiscovery&&
    typeof window.StartupConferenceDiscovery.getRecords==='function'
    ?window.StartupConferenceDiscovery.getRecords():[];
  discovered.forEach(function(record){
    var remoteId=String(record&&record.remoteConferenceId||'');
    var conference=record&&record.conference;
    if(!remoteId||remoteIds[remoteId]||!conference)return;
    remoteIds[remoteId]=true;
    var viewConference=typeof structuredClone==='function'
      ?structuredClone(conference)
      :JSON.parse(JSON.stringify(conference));
    viewConference.__startupDiscoveredRemoteId=remoteId;
    merged.push(viewConference);
  });
  return merged;
}

function showStartupConferenceList(){
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  var conferences = getStartupConferenceViewModel();
  var activeConferences = [];
  var completedConferences = [];
  conferences.forEach(function(conf){
    if(conf.status === 'active') activeConferences.push(conf);
    if(conf.status === 'completed') completedConferences.push(conf);
  });
  var activeList = ge('startupActiveList');
  var completedList = ge('startupCompletedList');
  var activeCount = ge('startupActiveCount');
  var completedCount = ge('startupCompletedCount');
  var activeStat = ge('startupActiveStat');
  var completedStat = ge('startupCompletedStat');
  var peopleStat = ge('startupPeopleStat');
  if(activeList) activeList.innerHTML = renderStartupConferenceCards(activeConferences, 'active');
  if(completedList) completedList.innerHTML = renderStartupConferenceCards(completedConferences, 'completed');
  if(activeCount) activeCount.textContent = activeConferences.length;
  if(completedCount) completedCount.textContent = completedConferences.length;
  if(activeStat) activeStat.textContent = activeConferences.length;
  if(completedStat) completedStat.textContent = completedConferences.length;
  if(peopleStat){
    var totalParticipants = 0;
    conferences.forEach(function(conf){ totalParticipants += getStartupConferenceParticipantCount(conf); });
    peopleStat.textContent = totalParticipants;
  }
}

function returnToStartupScreen(){
  if(!openStartupScreen({clearCurrentConference:true,persistView:true}))return false;
  document.querySelectorAll('.overlay').forEach(function(modal){ modal.style.display = 'none'; });
  var completedModal = ge('completedConfModal');
  if(completedModal) completedModal.remove();
  var selectModal = ge('selectConfModal');
  if(selectModal) selectModal.remove();
  return true;
}

function showSelectConferenceModal(){
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  openStartupScreen({clearCurrentConference:false,persistView:true});
  var startupList = ge('startupConferenceList');
  if(startupList){
    startupList.style.display = 'none';
    startupList.innerHTML = '';
  }
  return;
  var current = null;
  if (appData.currentConferenceId) {
    var allConfs = appData.conferences || [];
    for (var i = 0; i < allConfs.length; i++) {
      if (allConfs[i].id === appData.currentConferenceId) {
        current = allConfs[i];
        break;
      }
    }
  }
  if (current && current.status === 'active') return;
  var confs = (appData.conferences || []).filter(function(conf){ return conf.status === 'active'; });
  var completedConfs = (appData.conferences || []).filter(function(conf){ return conf.status === 'completed'; });
  if (confs.length === 0) {
    var html = '<div id="selectConfModal" class="final-dialog-backdrop">';
    html += '<div class="final-dialog-panel final-dialog-panel-compact final-dialog-panel-centered">';
    html += '<div class="final-dialog-title">📌 لا توجد مؤتمرات محفوظة</div>';
    html += '<div class="final-dialog-description">يرجى إنشاء مؤتمر جديد للبدء.</div>';
    html += '<button class="btn btn-blue final-dialog-full-action" data-system-conference-create onclick="createNewConference();var m=ge(\'selectConfModal\');if(m)m.remove();">➕ إنشاء أول مؤتمر</button>';
    if (completedConfs.length) {
      html += '<button class="btn btn-purple final-dialog-full-action" onclick="openCompletedConferencesModal()">📂 فتح مؤتمر سابق</button>';
    }
    html += '<button class="btn btn-gray final-dialog-full-action" onclick="ge(\'selectConfImportInput\').click()">📂 استيراد مؤتمر</button>';
    html += '<input id="selectConfImportInput" type="file" accept=".html,.json" style="display:none" onchange="loadFromFile(event);var m=ge(\'selectConfModal\');if(m)m.remove();">';
    html += '</div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  } else {
    var html = '<div id="selectConfModal" class="final-dialog-backdrop">';
    html += '<div class="final-dialog-panel final-dialog-panel-wide">';
    html += '<div class="final-dialog-title">📌 لا يوجد مؤتمر نشط</div>';
    html += '<div class="final-dialog-notice">اختر مؤتمراً أو أنشئ واحداً جديداً</div>';
    html += '<div class="final-dialog-action-row"><button class="btn btn-green final-dialog-full-action" data-system-conference-create onclick="openNewConferenceModal(\'create\');var m=ge(\'selectConfModal\');if(m)m.remove();">➕ إنشاء مؤتمر جديد</button></div>';
    html += '<div class="final-dialog-action-row"><button class="btn btn-gray final-dialog-full-action" onclick="ge(\'selectConfImportInput\').click()">📂 استيراد مؤتمر</button><input id="selectConfImportInput" type="file" accept=".html,.json" style="display:none" onchange="loadFromFile(event);var m=ge(\'selectConfModal\');if(m)m.remove();"></div>';
    html += '<div class="final-dialog-section-title">المؤتمرات المحفوظة:</div>';
    html += '<div class="final-dialog-list">';
    confs.forEach(function(conf){
      html += '<div class="final-dialog-list-item">';
      html += '<div><div class="final-dialog-item-title">'+esc(conf.name)+'</div><div class="final-dialog-item-meta">'+esc(conf.startDate||'-')+'</div></div>';
      html += '<button class="btn btn-blue btn-sm" onclick="openConferenceFromStartup(\''+conf.id+'\');var m=ge(\'selectConfModal\');if(m)m.remove();">فتح</button>';
      html += '</div>';
    });
    html += '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }
}

function openCompletedConferencesModal(){
  var completedConfs = (appData.conferences || []).filter(function(conf){
    return conf.status === 'completed'&&
      (typeof isConferenceImportRecoveryPending!=='function'||
        !isConferenceImportRecoveryPending(appData,conf.id));
  });
  if(!completedConfs.length){
    alert('لا توجد مؤتمرات سابقة متاحة.');
    return;
  }
  var html = '<div id="completedConfModal" class="final-dialog-backdrop">';
  html += '<div class="final-dialog-panel final-dialog-panel-wide">';
  html += '<div class="final-dialog-title">📂 فتح مؤتمر سابق</div>';
  html += '<div class="final-dialog-list">';
  completedConfs.forEach(function(conf){
    html += '<div class="final-dialog-list-item">';
    html += '<div><div class="final-dialog-item-title">'+esc(conf.name)+'</div><div class="final-dialog-item-meta">'+esc(conf.startDate||'-')+'</div></div>';
    html += '<button class="btn btn-blue btn-sm" onclick="openPreviousConferenceById(\''+conf.id+'\');var m=ge(\'completedConfModal\');if(m)m.remove();var s=ge(\'selectConfModal\');if(s)s.remove();">فتح</button>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div class="final-dialog-footer"><button class="btn btn-gray final-dialog-full-action" onclick="var m=ge(\'completedConfModal\');if(m)m.remove();">إغلاق</button></div>';
  html += '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function openPreviousConferenceById(id){
  return openConferenceFromStartup(id);
}

/*
نقطة الدخول المركزية الوحيدة لفتح مؤتمر من شاشة البداية.
يجب أن تمر جميع بطاقات وقوائم اختيار المؤتمرات من خلال هذه الدالة.
*/
function openConferenceFromStartup(id){
  return setCurrentConferenceById(id);
}

var conferenceBrandingDraft=null;
var conferenceBrandingColorRequest=0;
var conferenceBrandingBannerRequest=0;
var conferenceBrandingDisplayColorCache={};
function getDefaultConferenceBranding(){
  return {
    banner:'',
    bannerPrepared:'',
    serviceLogo:'',
    autoColors:false,
    bannerPosition:'center',
    bannerFit:'contain',
    cardTheme:'classic',
    logo:'',
    watermark:'',
    primaryColor:'#6C3483',
    secondaryColor:'#8E44AD',
    textColor:'#1A2A3A',
    fontFamily:"'Segoe UI',Arial,sans-serif"
  };
}
function getConferenceBrandingSettings(conference){
  var defaults=getDefaultConferenceBranding();
  var branding=conference&&conference.branding?conference.branding:{};
  return {
    banner:branding.banner||branding.logo||defaults.banner,
    bannerPrepared:branding.bannerPrepared||defaults.bannerPrepared,
    serviceLogo:branding.serviceLogo||branding.watermark||branding.logo||defaults.serviceLogo,
    autoColors:branding.autoColors===true,
    bannerPosition:branding.bannerPosition==='top'||branding.bannerPosition==='bottom'?branding.bannerPosition:defaults.bannerPosition,
    bannerFit:branding.bannerFit==='cover'?'cover':defaults.bannerFit,
    cardTheme:normalizeConferenceCardTheme(branding.cardTheme),
    logo:branding.logo||defaults.logo,
    watermark:branding.watermark||defaults.watermark,
    primaryColor:branding.primaryColor||defaults.primaryColor,
    secondaryColor:branding.secondaryColor||defaults.secondaryColor,
    textColor:branding.textColor||defaults.textColor,
    fontFamily:branding.fontFamily||defaults.fontFamily
  };
}
function renderConferenceBrandingSettings(){
  var branding=conferenceBrandingDraft||getDefaultConferenceBranding();
  var h='<section class="settings-section settings-branding-section">';
  h+='<button type="button" class="settings-branding-toggle" aria-expanded="false" aria-controls="settings_branding_content" onclick="toggleConferenceBrandingSection()"><span>🎨 هوية المؤتمر</span><span id="settings_branding_arrow" class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button>';
  h+='<div id="settings_branding_content" class="settings-branding-content" aria-hidden="true">';
  h+='<div class="settings-branding-grid">';
  h+='<div class="settings-branding-field"><label class="lbl" for="branding_card_theme">تصميم الكارت</label><select id="branding_card_theme" onchange="updateConferenceBrandingPreview()"><option value="classic" '+(branding.cardTheme==='classic'?'selected':'')+'>التصميم الحالي</option><option value="modern-banner" '+(branding.cardTheme==='modern-banner'?'selected':'')+'>صورة الهيدر بعرض الكارت</option></select></div>';
  h+='<div class="settings-branding-field"><label class="lbl">📷 الصورة الدعائية للمؤتمر</label><label class="btn btn-blue settings-branding-file-button">اختيار صورة<input id="branding_banner_file" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onchange="readConferenceBrandingImage(this,\'banner\')"></label><span id="branding_banner_name" class="settings-branding-file-name">'+(branding.banner?'تم اختيار صورة دعائية':'لا توجد صورة دعائية')+'</span></div>';
  h+='<div class="settings-branding-field"><label class="lbl">🖼️ لوجو الخدمة</label><label class="btn btn-blue settings-branding-file-button">اختيار صورة<input id="branding_service_logo_file" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onchange="readConferenceBrandingImage(this,\'serviceLogo\')"></label><span id="branding_service_logo_name" class="settings-branding-file-name">'+(branding.serviceLogo?'تم اختيار لوجو الخدمة':'لا يوجد لوجو خدمة')+'</span></div>';
  h+='<div class="settings-branding-field settings-branding-auto-field"><label class="settings-branding-auto-toggle"><input id="branding_auto_colors" type="checkbox" '+(branding.autoColors?'checked':'')+' onchange="toggleConferenceBrandingAutoColors(this.checked)"><span>استخراج الألوان تلقائيًا من الصورة الدعائية</span></label></div>';
  h+='<div class="settings-branding-field"><label class="lbl" for="branding_primary_color">🎨 اللون الأساسي</label><input id="branding_primary_color" type="color" value="'+esc(branding.primaryColor)+'" oninput="prepareConferenceBrandingDraftBanner()"></div>';
  h+='<div class="settings-branding-field"><label class="lbl" for="branding_secondary_color">🎨 اللون الثانوي</label><input id="branding_secondary_color" type="color" value="'+esc(branding.secondaryColor)+'" oninput="prepareConferenceBrandingDraftBanner()"></div>';
  h+='<div class="settings-branding-field"><label class="lbl" for="branding_text_color">🖋️ لون النص</label><input id="branding_text_color" type="color" value="'+esc(branding.textColor)+'" oninput="updateConferenceBrandingPreview()"></div>';
  h+='<div class="settings-branding-field"><label class="lbl" for="branding_font_family">🔤 الخط</label><input id="branding_font_family" type="text" value="'+esc(branding.fontFamily)+'" readonly></div>';
  h+='</div>';
  h+='<div class="settings-branding-preview-title">معاينة الكارت</div><div id="branding_card_preview" class="settings-branding-preview"></div>';
  h+='<div class="settings-branding-actions"><button class="btn btn-green" onclick="saveConferenceBranding()">💾 حفظ الهوية</button><button class="btn btn-gray" onclick="resetConferenceBranding()">استعادة التصميم الافتراضي</button></div>';
  h+='</div></section>';
  return h;
}
function toggleConferenceBrandingSection(){
  var content=ge('settings_branding_content');
  if(!content)return;
  var section=content.closest('.settings-branding-section');
  var toggle=section?section.querySelector('.settings-branding-toggle'):null;
  var arrow=ge('settings_branding_arrow');
  var isOpen=content.classList.toggle('settings-branding-content-open');
  content.setAttribute('aria-hidden',isOpen?'false':'true');
  if(toggle)toggle.setAttribute('aria-expanded',isOpen?'true':'false');
  if(arrow)arrow.textContent=isOpen?'▲':'▼';
}
function readConferenceBrandingImage(input,field){
  var file=input&&input.files?input.files[0]:null;
  if(!file)return;
  if(!/^image\/(png|jpeg|webp)$/i.test(file.type||'')){
    input.value='';
    showToast('اختر صورة بصيغة PNG أو JPG أو WEBP.','#E74C3C');
    return;
  }
  var reader=new FileReader();
  reader.onload=function(event){
    var isBanner=field==='banner';
    compressConferenceBrandingImage(event.target.result||'',{
      maxWidth:isBanner?1200:500,
      maxHeight:isBanner?600:500,
      quality:isBanner?.72:.75,
      backgroundColor:isBanner?(conferenceBrandingDraft&&conferenceBrandingDraft.primaryColor||'#6C3483'):'#FFFFFF'
    }).then(function(compressed){
      conferenceBrandingDraft=conferenceBrandingDraft||getDefaultConferenceBranding();
      conferenceBrandingDraft[field]=compressed;
      if(isBanner)conferenceBrandingDraft.bannerPrepared='';
      var nameElement=ge(isBanner?'branding_banner_name':'branding_service_logo_name');
      if(nameElement)nameElement.textContent=file.name;
      if(isBanner){
        var colorPromise=conferenceBrandingDraft.autoColors?applyConferenceBrandingAutoColors(compressed):Promise.resolve(false);
        colorPromise.then(function(){prepareConferenceBrandingDraftBanner()});
      }else updateConferenceBrandingPreview();
    }).catch(function(){showToast('تعذر ضغط صورة الهوية.','#E74C3C')});
  };
  reader.onerror=function(){showToast('تعذر قراءة ملف الصورة.','#E74C3C')};
  reader.readAsDataURL(file);
}
function conferenceBrandingColorHex(red,green,blue){
  function part(value){return Math.max(0,Math.min(255,value)).toString(16).padStart(2,'0')}
  return '#'+part(red)+part(green)+part(blue);
}
function compressConferenceBrandingImage(imageDataUrl,options){
  options=options||{};
  return new Promise(function(resolve,reject){
    if(!imageDataUrl){resolve('');return}
    var image=new Image();
    image.onload=function(){
      try{
        var maxWidth=Math.max(1,parseInt(options.maxWidth,10)||1200);
        var maxHeight=Math.max(1,parseInt(options.maxHeight,10)||600);
        var quality=typeof options.quality==='number'?Math.max(0,Math.min(1,options.quality)):.72;
        var scale=Math.min(1,maxWidth/image.naturalWidth,maxHeight/image.naturalHeight);
        var width=Math.max(1,Math.round(image.naturalWidth*scale));
        var height=Math.max(1,Math.round(image.naturalHeight*scale));
        var canvas=document.createElement('canvas');
        canvas.width=width;
        canvas.height=height;
        var context=canvas.getContext('2d');
        if(!context)throw new Error('canvas unavailable');
        context.fillStyle=options.backgroundColor||'#FFFFFF';
        context.fillRect(0,0,width,height);
        context.drawImage(image,0,0,width,height);
        resolve(canvas.toDataURL('image/jpeg',quality));
      }catch(error){reject(error)}
    };
    image.onerror=function(){reject(new Error('branding image load failed'))};
    image.src=imageDataUrl;
  });
}
function prepareConferenceBannerForHeader(imageDataUrl,backgroundColor){
  return new Promise(function(resolve,reject){
    if(!imageDataUrl){resolve('');return}
    var image=new Image();
    image.onload=function(){
      try{
        var canvas=document.createElement('canvas');
        canvas.width=900;
        canvas.height=252;
        var context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('canvas unavailable');
        var scale=Math.max(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
        var drawWidth=Math.max(1,Math.round(image.naturalWidth*scale));
        var drawHeight=Math.max(1,Math.round(image.naturalHeight*scale));
        var drawX=Math.round((canvas.width-drawWidth)/2);
        var drawY=Math.round((canvas.height-drawHeight)/2);
        context.clearRect(0,0,canvas.width,canvas.height);
        context.drawImage(image,drawX,drawY,drawWidth,drawHeight);
        resolve(canvas.toDataURL('image/jpeg',.65));
      }catch(error){reject(error)}
    };
    image.onerror=function(){reject(new Error('banner load failed'))};
    image.src=imageDataUrl;
  });
}
function prepareConferenceBrandingDraftBanner(){
  conferenceBrandingDraft=syncConferenceBrandingDraftFromInputs();
  var banner=conferenceBrandingDraft.banner;
  var request=++conferenceBrandingBannerRequest;
  if(!banner){conferenceBrandingDraft.bannerPrepared='';updateConferenceBrandingPreview();return Promise.resolve('')}
  var displayColors=getConferenceBrandingDisplayColors(conferenceBrandingDraft);
  return prepareConferenceBannerForHeader(banner,displayColors[0]).then(function(prepared){
    if(request!==conferenceBrandingBannerRequest||conferenceBrandingDraft.banner!==banner)return '';
    conferenceBrandingDraft.bannerPrepared=prepared;
    updateConferenceBrandingPreview();
    return prepared;
  }).catch(function(){
    if(request===conferenceBrandingBannerRequest)updateConferenceBrandingPreview();
    return '';
  });
}
function compressConferenceBrandingDraftImages(){
  conferenceBrandingDraft=syncConferenceBrandingDraftFromInputs();
  var originalBanner=conferenceBrandingDraft.banner||'';
  var originalServiceLogo=conferenceBrandingDraft.serviceLogo||'';
  return Promise.all([
    compressConferenceBrandingImage(originalBanner,{
      maxWidth:1200,
      maxHeight:600,
      quality:.72,
      backgroundColor:conferenceBrandingDraft.primaryColor||'#6C3483'
    }),
    compressConferenceBrandingImage(originalServiceLogo,{
      maxWidth:500,
      maxHeight:500,
      quality:.75,
      backgroundColor:'#FFFFFF'
    })
  ]).then(function(images){
    conferenceBrandingDraft.banner=images[0];
    conferenceBrandingDraft.serviceLogo=images[1];
    if(images[0]!==originalBanner)conferenceBrandingDraft.bannerPrepared='';
    return conferenceBrandingDraft;
  });
}
function extractConferenceBannerColors(dataUrl){
  return new Promise(function(resolve,reject){
    if(!dataUrl){reject(new Error('banner unavailable'));return}
    var image=new Image();
    image.onload=function(){
      try{
        var canvas=document.createElement('canvas');
        canvas.width=48;
        canvas.height=48;
        var context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('canvas unavailable');
        context.drawImage(image,0,0,canvas.width,canvas.height);
        var pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
        var buckets={};
        for(var i=0;i<pixels.length;i+=4){
          if(pixels[i+3]<128)continue;
          var red=pixels[i],green=pixels[i+1],blue=pixels[i+2];
          if(red>238&&green>238&&blue>238)continue;
          if(red<22&&green<22&&blue<22)continue;
          var max=Math.max(red,green,blue),min=Math.min(red,green,blue);
          if(max-min<18)continue;
          var qr=Math.min(255,Math.round(red/32)*32);
          var qg=Math.min(255,Math.round(green/32)*32);
          var qb=Math.min(255,Math.round(blue/32)*32);
          var key=qr+'|'+qg+'|'+qb;
          if(!buckets[key])buckets[key]={red:0,green:0,blue:0,count:0,score:0};
          buckets[key].red+=red;
          buckets[key].green+=green;
          buckets[key].blue+=blue;
          buckets[key].count++;
          buckets[key].score+=(max-min)/255;
        }
        var colors=Object.keys(buckets).map(function(key){
          var bucket=buckets[key];
          return {
            red:Math.round(bucket.red/bucket.count),
            green:Math.round(bucket.green/bucket.count),
            blue:Math.round(bucket.blue/bucket.count),
            weight:bucket.count*(1+bucket.score/bucket.count)
          };
        }).sort(function(a,b){return b.weight-a.weight});
        if(!colors.length)throw new Error('colors unavailable');
        var primary=colors[0];
        var secondary=null;
        for(var c=1;c<colors.length;c++){
          var candidate=colors[c];
          var distance=Math.sqrt(Math.pow(primary.red-candidate.red,2)+Math.pow(primary.green-candidate.green,2)+Math.pow(primary.blue-candidate.blue,2));
          if(distance>=85){secondary=candidate;break}
        }
        if(!secondary)throw new Error('secondary color unavailable');
        resolve([
          conferenceBrandingColorHex(primary.red,primary.green,primary.blue),
          conferenceBrandingColorHex(secondary.red,secondary.green,secondary.blue)
        ]);
      }catch(error){reject(error)}
    };
    image.onerror=function(){reject(new Error('banner load failed'))};
    image.src=dataUrl;
  });
}
function loadConferenceBrandingDisplayColors(banner){
  if(!banner)return Promise.resolve(null);
  var cached=conferenceBrandingDisplayColorCache[banner];
  if(cached&&cached.colors)return Promise.resolve(cached.colors);
  if(cached&&cached.promise)return cached.promise;
  var promise=extractConferenceBannerColors(banner).then(function(colors){
    conferenceBrandingDisplayColorCache[banner]={colors:colors};
    if(currentTab===4)setTimeout(function(){renderCards()},0);
    if(ge('branding_card_preview'))setTimeout(function(){updateConferenceBrandingPreview()},0);
    return colors;
  }).catch(function(){
    delete conferenceBrandingDisplayColorCache[banner];
    return null;
  });
  conferenceBrandingDisplayColorCache[banner]={promise:promise};
  return promise;
}
function getConferenceBrandingDisplayColors(branding){
  branding=branding||{};
  var manualColors=[branding.primaryColor||'#6C3483',branding.secondaryColor||'#8E44AD'];
  var banner=branding.banner||branding.logo||'';
  if(!branding.autoColors||!banner)return manualColors;
  var cached=conferenceBrandingDisplayColorCache[banner];
  if(cached&&cached.colors)return cached.colors.slice();
  loadConferenceBrandingDisplayColors(banner);
  return manualColors;
}
function setConferenceBrandingColorControlsDisabled(disabled){
  var primary=ge('branding_primary_color');
  var secondary=ge('branding_secondary_color');
  if(primary)primary.disabled=!!disabled;
  if(secondary)secondary.disabled=!!disabled;
  if(primary&&primary.parentNode)primary.parentNode.classList.toggle('settings-branding-color-disabled',!!disabled);
  if(secondary&&secondary.parentNode)secondary.parentNode.classList.toggle('settings-branding-color-disabled',!!disabled);
}
function applyConferenceBrandingAutoColors(dataUrl){
  conferenceBrandingDraft=conferenceBrandingDraft||getDefaultConferenceBranding();
  var banner=dataUrl||conferenceBrandingDraft.banner;
  var request=++conferenceBrandingColorRequest;
  if(!banner){updateConferenceBrandingPreview();return Promise.resolve(false)}
  return loadConferenceBrandingDisplayColors(banner).then(function(colors){
    if(request!==conferenceBrandingColorRequest||!conferenceBrandingDraft.autoColors||conferenceBrandingDraft.banner!==banner)return false;
    updateConferenceBrandingPreview();
    return !!colors;
  }).catch(function(){
    if(request===conferenceBrandingColorRequest)updateConferenceBrandingPreview();
    return false;
  });
}
function toggleConferenceBrandingAutoColors(enabled){
  conferenceBrandingDraft=conferenceBrandingDraft||getDefaultConferenceBranding();
  conferenceBrandingDraft.autoColors=!!enabled;
  setConferenceBrandingColorControlsDisabled(enabled);
  if(enabled)applyConferenceBrandingAutoColors(conferenceBrandingDraft.banner).then(function(){prepareConferenceBrandingDraftBanner()});
  else{conferenceBrandingColorRequest++;prepareConferenceBrandingDraftBanner()}
}
function syncConferenceBrandingDraftFromInputs(){
  conferenceBrandingDraft=conferenceBrandingDraft||getDefaultConferenceBranding();
  var primary=ge('branding_primary_color');
  var secondary=ge('branding_secondary_color');
  var textColor=ge('branding_text_color');
  var font=ge('branding_font_family');
  var autoColors=ge('branding_auto_colors');
  var cardTheme=ge('branding_card_theme');
  if(primary)conferenceBrandingDraft.primaryColor=primary.value||'#6C3483';
  if(secondary)conferenceBrandingDraft.secondaryColor=secondary.value||'#8E44AD';
  if(textColor)conferenceBrandingDraft.textColor=textColor.value||'#1A2A3A';
  if(font)conferenceBrandingDraft.fontFamily=font.value||"'Segoe UI',Arial,sans-serif";
  if(autoColors)conferenceBrandingDraft.autoColors=!!autoColors.checked;
  if(cardTheme)conferenceBrandingDraft.cardTheme=normalizeConferenceCardTheme(cardTheme.value);
  return conferenceBrandingDraft;
}
function updateConferenceBrandingPreview(){
  var preview=ge('branding_card_preview');
  if(!preview)return;
  var current=getCurrentConference();
  var conf=current&&current.conf?current.conf:{};
  var branding=syncConferenceBrandingDraftFromInputs();
  setConferenceBrandingColorControlsDisabled(branding.autoColors);
  preview.innerHTML=renderPersonConferenceCard({
    key:'branding-preview',
    name:'اسم الضيف',
    conferenceName:conf.name||(current&&current.name)||'المؤتمر',
    houseName:'بيت المؤتمر',
    room:'101',
    floor:'الدور الأول',
    branding:branding
  });
}
function resetConferenceBranding(){
  conferenceBrandingDraft=getDefaultConferenceBranding();
  var primary=ge('branding_primary_color');
  var secondary=ge('branding_secondary_color');
  var textColor=ge('branding_text_color');
  var font=ge('branding_font_family');
  var bannerInput=ge('branding_banner_file');
  var serviceLogoInput=ge('branding_service_logo_file');
  var autoColors=ge('branding_auto_colors');
  var cardTheme=ge('branding_card_theme');
  if(primary)primary.value=conferenceBrandingDraft.primaryColor;
  if(secondary)secondary.value=conferenceBrandingDraft.secondaryColor;
  if(textColor)textColor.value=conferenceBrandingDraft.textColor;
  if(font)font.value=conferenceBrandingDraft.fontFamily;
  if(bannerInput)bannerInput.value='';
  if(serviceLogoInput)serviceLogoInput.value='';
  if(autoColors)autoColors.checked=false;
  if(cardTheme)cardTheme.value=conferenceBrandingDraft.cardTheme;
  if(ge('branding_banner_name'))ge('branding_banner_name').textContent='لا توجد صورة دعائية';
  if(ge('branding_service_logo_name'))ge('branding_service_logo_name').textContent='لا يوجد لوجو خدمة';
  setConferenceBrandingColorControlsDisabled(false);
  updateConferenceBrandingPreview();
}
function saveConferenceBranding(){
  var current=getCurrentConference();
  if(!current)return Promise.resolve(false);
  var previousBranding=current.branding;
  var previousCardTheme=normalizeConferenceCardTheme((previousBranding||{}).cardTheme);
  var previousUpdatedAt=current.updatedAt;
  var branding=syncConferenceBrandingDraftFromInputs();
  var duplicateLegacyLogo=!!branding.logo&&branding.logo===branding.banner;
  var duplicateLegacyWatermark=!!branding.watermark&&branding.watermark===branding.serviceLogo;
  return compressConferenceBrandingDraftImages().then(function(){
    branding=syncConferenceBrandingDraftFromInputs();
    return branding.banner&&!branding.bannerPrepared?prepareConferenceBrandingDraftBanner():branding.bannerPrepared||'';
  }).then(function(){
    branding=syncConferenceBrandingDraftFromInputs();
    var storedBranding={
      banner:branding.banner||'',
      bannerPrepared:branding.bannerPrepared||'',
      serviceLogo:branding.serviceLogo||'',
      autoColors:branding.autoColors===true,
      bannerPosition:branding.bannerPosition||'center',
      bannerFit:branding.bannerFit==='contain'?'contain':'cover',
      cardTheme:normalizeConferenceCardTheme(branding.cardTheme),
      logo:duplicateLegacyLogo?'':(branding.logo||''),
      watermark:duplicateLegacyWatermark?'':(branding.watermark||''),
      primaryColor:branding.primaryColor||'#6C3483',
      secondaryColor:branding.secondaryColor||'#8E44AD',
      textColor:branding.textColor||'#1A2A3A',
      fontFamily:branding.fontFamily||"'Segoe UI',Arial,sans-serif"
    };
    current.branding=storedBranding;
    current.updatedAt=new Date().toISOString();
    if(save()===false){
      current.branding={
        banner:storedBranding.banner,
        bannerPrepared:'',
        serviceLogo:storedBranding.serviceLogo,
        autoColors:storedBranding.autoColors,
        bannerPosition:storedBranding.bannerPosition,
        bannerFit:storedBranding.bannerFit,
        cardTheme:storedBranding.cardTheme,
        logo:storedBranding.logo,
        watermark:storedBranding.watermark,
        primaryColor:storedBranding.primaryColor,
        secondaryColor:storedBranding.secondaryColor,
        textColor:storedBranding.textColor,
        fontFamily:storedBranding.fontFamily
      };
      current.updatedAt=new Date().toISOString();
      if(save()!==false){
        addActivityLog('branding_updated','تم تعديل هوية المؤتمر',{section:'settings',entityType:'conference',entityId:current.id});
        if(previousCardTheme!==storedBranding.cardTheme)addActivityLog('card_theme_changed','تم تغيير تصميم الكروت',{details:storedBranding.cardTheme==='modern-banner'?'صورة الهيدر بعرض الكارت':'التصميم الحالي',section:'cards',entityType:'conference',entityId:current.id});
        conferenceBrandingDraft=getConferenceBrandingSettings(current);
        if(currentTab===4)renderCards();
        showToast('✅ تم حفظ الهوية دون النسخة المحسنة للبنر لتوفير المساحة');
        return true;
      }
      current.branding=previousBranding;
      current.updatedAt=previousUpdatedAt;
      showToast('تعذر حفظ الهوية. قد تكون الصور أكبر من مساحة التخزين المتاحة.','#E74C3C');
      return false;
    }
    addActivityLog('branding_updated','تم تعديل هوية المؤتمر',{section:'settings',entityType:'conference',entityId:current.id});
    if(previousCardTheme!==storedBranding.cardTheme)addActivityLog('card_theme_changed','تم تغيير تصميم الكروت',{details:storedBranding.cardTheme==='modern-banner'?'صورة الهيدر بعرض الكارت':'التصميم الحالي',section:'cards',entityType:'conference',entityId:current.id});
    conferenceBrandingDraft=getConferenceBrandingSettings(current);
    if(currentTab===4)renderCards();
    showToast('✅ تم حفظ هوية المؤتمر');
    return true;
  }).catch(function(){
    current.branding=previousBranding;
    current.updatedAt=previousUpdatedAt;
    showToast('تعذر ضغط صور الهوية.','#E74C3C');
    return false;
  });
}

function activityLogSectionTitle(section){
  var titles={conference:'المؤتمر',accommodation:'التسكين',cards:'الكروت',settings:'الإعدادات',general:'عام'};
  return titles[section]||'عام';
}
function renderActivityLogSection(){
  return '<section class="settings-section settings-branding-section activity-log-section"><button type="button" class="settings-branding-toggle" aria-expanded="false" aria-controls="settings_activity_log_content" onclick="toggleActivityLogSection()"><span>سجل العمليات</span><span id="settings_activity_log_arrow" class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button><div id="settings_activity_log_content" class="settings-branding-content activity-log-content" aria-hidden="true"><div class="activity-log-filters"><select id="activityLogSectionFilter" onchange="renderActivityLog()"><option value="all">الكل</option><option value="conference">المؤتمر</option><option value="accommodation">التسكين</option><option value="cards">الكروت</option><option value="settings">الإعدادات</option><option value="general">عام</option></select><input id="activityLogSearch" type="search" placeholder="بحث في عنوان العملية أو التفاصيل" oninput="renderActivityLog()"></div><div id="activityLogList" class="activity-log-list"></div><div class="activity-log-actions"><button class="btn btn-red btn-sm" onclick="clearActivityLog()">مسح سجل العمليات</button></div></div></section>';
}
function toggleActivityLogSection(){
  var content=ge('settings_activity_log_content');
  if(!content)return;
  var section=content.closest('.activity-log-section');
  var toggle=section?section.querySelector('.settings-branding-toggle'):null;
  var arrow=ge('settings_activity_log_arrow');
  var isOpen=content.classList.toggle('settings-branding-content-open');
  content.setAttribute('aria-hidden',isOpen?'false':'true');
  if(toggle)toggle.setAttribute('aria-expanded',isOpen?'true':'false');
  if(arrow)arrow.textContent=isOpen?'▲':'▼';
}
function renderActivityLog(){
  var list=ge('activityLogList');
  if(!list)return;
  var conference=getCurrentConference();
  var entries=conference&&Array.isArray(conference.activityLog)?conference.activityLog.slice():[];
  var sectionFilter=ge('activityLogSectionFilter');
  var searchInput=ge('activityLogSearch');
  var section=sectionFilter?sectionFilter.value:'all';
  var search=String(searchInput?searchInput.value:'').trim().toLowerCase();
  entries.sort(function(a,b){return String(b.createdAt||'').localeCompare(String(a.createdAt||''))});
  entries=entries.filter(function(entry){
    if(section!=='all'&&entry.section!==section)return false;
    if(!search)return true;
    return String((entry.title||'')+' '+(entry.details||'')).toLowerCase().indexOf(search)!==-1;
  });
  if(!entries.length){list.innerHTML='<div class="settings-empty-state">لا توجد عمليات مسجلة حتى الآن</div>';return}
  var h='';
  entries.forEach(function(entry){
    var createdAt=new Date(entry.createdAt||'');
    var dateText=isNaN(createdAt.getTime())?'—':createdAt.toLocaleString('ar-EG',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    h+='<article class="activity-log-item"><time>'+esc(dateText)+'</time><strong>'+esc(entry.title||'عملية غير محددة')+'</strong>';
    if(entry.details)h+='<p>'+esc(entry.details)+'</p>';
    h+='<span>القسم: '+esc(activityLogSectionTitle(entry.section))+'</span></article>';
  });
  list.innerHTML=h;
}
function clearActivityLog(){
  var conference=getCurrentConference();
  if(!conference)return;
  if(!confirm('هل أنت متأكد من مسح سجل العمليات لهذا المؤتمر؟ لا يمكن التراجع عن هذا الإجراء.'))return;
  conference.activityLog=[];
  addActivityLog('activity_log_cleared','تم مسح سجل العمليات',{section:'settings',entityType:'conference',entityId:conference.id});
  renderActivityLog();
}

function updateAccommodationV3Setting(field,value){
  if(!requireAccommodationMutation())return false;
  var current=getCurrentConference();
  if(!current)return false;
  var plan=getConferenceAccommodationPlan(current);
  if(field==='pricingMode'){
    if(ACCOMMODATION_V3_PRICING_MODES.indexOf(value)===-1)return false;
    plan.pricingMode=value;
  }else if(
    field==='personNight'||field==='roomNight'||field==='personDay'||
    field==='roomDay'||field==='packagePrice'||field==='packageDayPrice'
  ){
    var price=Number(value);
    if(!isFinite(price)||price<0){
      alert('يجب إدخال سعر صحيح غير سالب.');
      renderSettings();
      return false;
    }
    plan.prices[field]=price;
  }else{
    return false;
  }
  if(!save())return false;
  if(ge('tab2')&&ge('tab2').style.display!=='none'&&typeof renderAccounts==='function')renderAccounts();
  else renderSettings();
  return true;
}

function updateAccommodationV3RoomTypePrice(roomType,value){
  if(!requireAccommodationMutation())return false;
  var current=getCurrentConference();
  if(!current)return false;
  var validTypes=['single','double','triple','quadruple','quintuple','sextuple','sevenPlus'];
  if(validTypes.indexOf(roomType)===-1)return false;
  var price=Number(value);
  if(!isFinite(price)||price<0){
    alert('يجب إدخال سعر صحيح غير سالب.');
    renderSettings();
    return false;
  }
  getConferenceAccommodationPlan(current).roomTypePrices[roomType]=price;
  if(!save())return false;
  renderSettings();
  return true;
}

function renderAccommodationV3Settings(conference){
  var plan=getConferenceAccommodationPlan(conference);
  var summary=calculateAccommodationSummary(conference);
  var typeLabels={
    single:'سنجل',
    double:'دبل',
    triple:'ثلاثي',
    quadruple:'رباعي',
    quintuple:'خماسي',
    sextuple:'سداسي',
    sevenPlus:'سباعي فأكثر'
  };
  var modeLabels={
    per_person_night:'Person Night',
    per_room_night:'Room Night',
    per_person_day:'لكل شخص في اليوم',
    per_room_day:'لكل غرفة في اليوم',
    fixed_package:'Fixed Package',
    per_day_package:'باقة لكل يوم',
    room_type:'Room Type'
  };
  var html='<div class="v3-engine-body">';
  html+='<div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="lbl">نوع التسعير</label><select onchange="updateAccommodationV3Setting(\'pricingMode\',this.value)">';
  ACCOMMODATION_V3_PRICING_MODES.forEach(function(mode){
    html+='<option value="'+mode+'" '+(plan.pricingMode===mode?'selected':'')+'>'+modeLabels[mode]+'</option>';
  });
  html+='</select></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر Person Night</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.personNight)+'" onchange="updateAccommodationV3Setting(\'personNight\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر Room Night</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.roomNight)+'" onchange="updateAccommodationV3Setting(\'roomNight\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر الشخص في اليوم</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.personDay)+'" onchange="updateAccommodationV3Setting(\'personDay\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر الغرفة في اليوم</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.roomDay)+'" onchange="updateAccommodationV3Setting(\'roomDay\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر الباقة الثابتة</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.packagePrice)+'" onchange="updateAccommodationV3Setting(\'packagePrice\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر الباقة اليومية</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.packageDayPrice)+'" onchange="updateAccommodationV3Setting(\'packageDayPrice\',this.value)"></div>';
  html+='</div>';
  html+='<div class="settings-section-title" style="margin-top:12px">أسعار أنواع الغرف</div><div class="settings-branding-grid">';
  Object.keys(typeLabels).forEach(function(key){
    html+='<div class="settings-branding-field"><label class="lbl">'+typeLabels[key]+'</label><input type="number" min="0" step="0.5" value="'+esc(plan.roomTypePrices[key]||0)+'" onchange="updateAccommodationV3RoomTypePrice(\''+key+'\',this.value)"></div>';
  });
  html+='</div>';
  html+='<div class="stats" style="margin-top:12px">';
  html+='<div class="stat-card"><div class="stat-val">'+summary.totalPersons+'</div><div class="stat-lbl">إجمالي الأشخاص</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+summary.totalPersonNights+'</div><div class="stat-lbl">Person Nights</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+summary.totalPersonDays+'</div><div class="stat-lbl">Person Days</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+summary.occupiedRooms+'</div><div class="stat-lbl">الغرف المشغولة</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+summary.roomNights+'</div><div class="stat-lbl">Room Nights</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+summary.roomDays+'</div><div class="stat-lbl">Room Days</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+Math.round(summary.occupancyRate*100)/100+'%</div><div class="stat-lbl">نسبة الإشغال</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+esc(summary.totalCost)+'</div><div class="stat-lbl">إجمالي الإقامة</div></div>';
  html+='</div>';
  html+='<div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>الليلة</th><th>من</th><th>إلى</th><th>الأشخاص</th><th>الغرف المشغولة</th><th>نسبة الإشغال</th><th>تكلفة الليلة</th></tr></thead><tbody>';
  if(!summary.dailySummary.length){
    html+='<tr><td colspan="7" class="settings-empty-state">لا توجد ليالٍ في جدول المؤتمر.</td></tr>';
  }else{
    summary.dailySummary.forEach(function(item){
      html+='<tr><td>ليلة '+item.night+'</td><td>'+esc(formatConferenceScheduleDate(item.date))+'</td><td>'+esc(formatConferenceScheduleDate(item.nextDate))+'</td><td>'+item.persons+'</td><td>'+item.occupiedRooms+'</td><td>'+Math.round(item.occupancyRate*100)/100+'%</td><td>'+esc(item.cost)+'</td></tr>';
    });
  }
  html+='</tbody></table></div>';
  html+='<div class="settings-section-title" style="margin-top:12px">جدول أيام الإقامة</div>';
  html+='<div style="overflow-x:auto;margin-top:8px"><table><thead><tr><th>اليوم</th><th>التاريخ</th><th>الأشخاص</th><th>الغرف المشغولة</th><th>تكلفة اليوم</th></tr></thead><tbody>';
  if(!summary.daySummary.length){
    html+='<tr><td colspan="5" class="settings-empty-state">لا توجد أيام في جدول المؤتمر.</td></tr>';
  }else{
    summary.daySummary.forEach(function(item){
      html+='<tr><td>اليوم '+item.dayNumber+'</td><td>'+esc(formatConferenceScheduleDate(item.date))+'</td><td>'+item.persons+'</td><td>'+item.occupiedRooms+'</td><td>'+esc(item.cost)+'</td></tr>';
    });
  }
  html+='</tbody></table></div></div>';
  return html;
}

function updateAirConditioningV3Setting(field,value){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('updateAirConditioningV3Setting',null))return false;
  var current=getCurrentConference();
  if(!current)return false;
  var plan=getConferenceAirConditioningPlan(current);
  if(field==='enabled'||field==='includeEmptyRooms'||field==='includeClosedRooms'){
    plan[field]=value===true||value==='true';
  }else if(field==='pricingMode'){
    if(AIR_CONDITIONING_V3_PRICING_MODES.indexOf(value)===-1)return false;
    plan.pricingMode=value;
  }else if(
    field==='personDay'||field==='roomDay'||field==='unitDay'||
    field==='fixedPackage'||field==='packageDayPrice'
  ){
    var price=Number(value);
    if(!isFinite(price)||price<0){
      alert('يجب إدخال سعر صحيح غير سالب.');
      renderSettings();
      return false;
    }
    plan.prices[field]=price;
  }else{
    return false;
  }
  if(!save())return false;
  if(ge('tab2')&&ge('tab2').style.display!=='none'&&typeof renderAccounts==='function')renderAccounts();
  else renderSettings();
  return true;
}

function renderAirConditioningV3Settings(conference){
  var plan=getConferenceAirConditioningPlan(conference);
  var summary=calculateAirConditioningSummary(conference);
  var modeLabels={
    per_person_day:'لكل شخص في اليوم',
    per_room_day:'لكل غرفة في اليوم',
    per_unit_day:'لكل جهاز في اليوم',
    fixed_package:'باقة ثابتة للمؤتمر',
    per_day_package:'باقة لكل يوم',
    included:'التكييف مشمول'
  };
  var html='<div class="v3-engine-body">';
  html+='<div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input type="checkbox" '+(plan.enabled?'checked':'')+' onchange="updateAirConditioningV3Setting(\'enabled\',this.checked)"><span>تفعيل حساب التكييف</span></label></div>';
  html+='<div class="settings-branding-field"><label class="lbl">نوع التسعير</label><select onchange="updateAirConditioningV3Setting(\'pricingMode\',this.value)">';
  AIR_CONDITIONING_V3_PRICING_MODES.forEach(function(mode){
    html+='<option value="'+mode+'" '+(plan.pricingMode===mode?'selected':'')+'>'+modeLabels[mode]+'</option>';
  });
  html+='</select></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر الشخص في اليوم</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.personDay)+'" onchange="updateAirConditioningV3Setting(\'personDay\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر الغرفة في اليوم</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.roomDay)+'" onchange="updateAirConditioningV3Setting(\'roomDay\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر الجهاز في اليوم</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.unitDay)+'" onchange="updateAirConditioningV3Setting(\'unitDay\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">مبلغ الباقة الثابتة</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.fixedPackage)+'" onchange="updateAirConditioningV3Setting(\'fixedPackage\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">سعر الباقة اليومية</label><input type="number" min="0" step="0.5" value="'+esc(plan.prices.packageDayPrice)+'" onchange="updateAirConditioningV3Setting(\'packageDayPrice\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input type="checkbox" '+(plan.includeEmptyRooms?'checked':'')+' onchange="updateAirConditioningV3Setting(\'includeEmptyRooms\',this.checked)"><span>احتساب الغرف الفارغة</span></label></div>';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input type="checkbox" '+(plan.includeClosedRooms?'checked':'')+' onchange="updateAirConditioningV3Setting(\'includeClosedRooms\',this.checked)"><span>احتساب الغرف المغلقة</span></label></div>';
  html+='</div>';
  html+='<div class="stats" style="margin-top:12px">';
  html+='<div class="stat-card"><div class="stat-val">'+summary.totalPersonDays+'</div><div class="stat-lbl">Person Days</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+summary.totalRoomDays+'</div><div class="stat-lbl">Room Days</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+summary.totalUnitDays+'</div><div class="stat-lbl">Unit Days</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+esc(summary.totalCost)+'</div><div class="stat-lbl">إجمالي التكييف</div></div>';
  html+='</div>';
  html+='<div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>اليوم</th><th>التاريخ</th><th>الأشخاص</th><th>الغرف</th><th>الأجهزة</th><th>التكلفة</th></tr></thead><tbody>';
  if(!summary.daySummary.length){
    html+='<tr><td colspan="6" class="settings-empty-state">لا توجد أيام في جدول المؤتمر.</td></tr>';
  }else{
    summary.daySummary.forEach(function(item){
      html+='<tr><td>اليوم '+item.dayNumber+'</td><td>'+esc(formatConferenceScheduleDate(item.date))+'</td><td>'+item.persons+'</td><td>'+item.rooms+'</td><td>'+item.units+'</td><td>'+esc(item.cost)+'</td></tr>';
    });
  }
  html+='</tbody></table></div></div>';
  return html;
}

var migrationAuditReport = null;
var migrationAuditFilter = 'all';
var migrationAuditExpandedCodes = {};

function runMigrationAudit(){
  if(!window.MigrationAudit||typeof window.MigrationAudit.auditAppData!=='function')return false;
  migrationAuditReport = window.MigrationAudit.auditAppData(appData);
  renderSettings();
  return true;
}

function setMigrationAuditFilter(filter){
  migrationAuditFilter = filter==='errors'||filter==='warnings'?filter:'all';
  renderSettings();
}

function toggleMigrationAuditCode(code,issueType){
  try{code=decodeURIComponent(code)}catch(error){}
  var key=issueType+':'+code;
  migrationAuditExpandedCodes[key]=!migrationAuditExpandedCodes[key];
  renderSettings();
}

function renderMigrationAuditIssue(issue){
  var location = [];
  if(issue.houseId)location.push('البيت: '+esc(issue.houseId));
  if(issue.floorId)location.push('الدور: '+esc(issue.floorId));
  if(issue.roomId)location.push('الغرفة: '+esc(issue.roomId));
  if(issue.entityId)location.push('entityId: '+esc(issue.entityId));
  if(issue.personId)location.push('personId: '+esc(issue.personId));
  return '<div class="settings-list-item"><div><div style="font-weight:700">'+esc(issue.message||'')+'</div>'+
    '<div style="font-size:10px;color:#5a7a9a;margin-top:3px"><code>'+esc(issue.code||'')+'</code>'+
    (location.length?' · '+location.join(' · '):'')+'</div></div></div>';
}

function renderMigrationAuditIssueList(issues,title){
  var h='<div style="margin-top:10px"><div style="font-size:12px;font-weight:800;color:#1f4e79;margin-bottom:6px">'+esc(title)+'</div>';
  if(!issues.length)return h+'<div class="settings-empty-state">لا توجد نتائج في هذا القسم.</div></div>';
  h+='<div class="settings-list">';
  issues.forEach(function(issue){ h+=renderMigrationAuditIssue(issue); });
  return h+'</div></div>';
}

function groupMigrationAuditIssuesByCode(report,type){
  var groups={};
  var issues=(report[type]||[]).map(function(issue){
    return {issue:issue,conferenceName:''};
  });
  (report.conferences||[]).forEach(function(conference){
    (conference[type]||[]).forEach(function(issue){
      issues.push({
        issue: issue,
        conferenceName: conference.conferenceName||conference.conferenceId||'مؤتمر بدون اسم'
      });
    });
  });
  issues.forEach(function(entry){
    var code=entry.issue.code||'UNKNOWN';
    if(!groups[code])groups[code]=[];
    groups[code].push(entry);
  });
  return groups;
}

function renderMigrationAuditDetailValue(value,seen,depth){
  seen=seen||[];
  depth=depth||0;
  if(value===undefined||value===null||value==='')return '<span style="color:#8799aa">—</span>';
  if(typeof value!=='object')return '<span>'+esc(String(value))+'</span>';
  if(seen.indexOf(value)!==-1)return '<span style="color:#8799aa">قيمة متكررة داخليًا</span>';
  if(depth>=6)return '<span style="color:#8799aa">تفاصيل متداخلة بعمق</span>';
  var nextSeen=seen.concat([value]);
  if(Array.isArray(value)){
    if(!value.length)return '<span style="color:#8799aa">مصفوفة فارغة</span>';
    return '<ul style="margin:4px 0;padding-right:18px">'+value.map(function(item){
      return '<li>'+renderMigrationAuditDetailValue(item,nextSeen,depth+1)+'</li>';
    }).join('')+'</ul>';
  }
  var keys=Object.keys(value);
  if(!keys.length)return '<span style="color:#8799aa">كائن فارغ</span>';
  return '<dl style="margin:4px 0;display:grid;grid-template-columns:minmax(90px,auto) 1fr;gap:4px 8px">'+keys.map(function(key){
    return '<dt style="font-weight:700">'+esc(key)+'</dt><dd style="margin:0;min-width:0;overflow-wrap:anywhere">'+
      renderMigrationAuditDetailValue(value[key],nextSeen,depth+1)+'</dd>';
  }).join('')+'</dl>';
}

function renderMigrationAuditExpandedIssue(entry){
  var issue=entry.issue||{};
  var fields=[
    ['اسم المؤتمر',entry.conferenceName],
    ['conferenceId',issue.conferenceId],
    ['houseId',issue.houseId],
    ['floorId',issue.floorId],
    ['roomId',issue.roomId],
    ['entityId',issue.entityId],
    ['personId',issue.personId]
  ].filter(function(field){
    return field[1]!==undefined&&field[1]!==null&&field[1]!=='';
  });
  var h='<div class="settings-list-item" style="align-items:stretch"><div style="width:100%">';
  h+='<div style="font-weight:700">'+esc(issue.message||'')+'</div>';
  if(fields.length){
    h+='<dl style="margin:7px 0 0;display:grid;grid-template-columns:minmax(105px,auto) 1fr;gap:4px 8px">';
    fields.forEach(function(field){
      h+='<dt style="font-weight:700;color:#5a7a9a">'+esc(field[0])+'</dt><dd style="margin:0;overflow-wrap:anywhere">'+esc(String(field[1]))+'</dd>';
    });
    h+='</dl>';
  }
  if(issue.details!==undefined&&issue.details!==null){
    h+='<div style="margin-top:8px;padding-top:7px;border-top:1px solid #e7eef5"><strong>التفاصيل</strong>'+
      renderMigrationAuditDetailValue(issue.details,[],0)+'</div>';
  }
  return h+'</div></div>';
}

function renderMigrationAuditCodeCounts(groups,title,issueType){
  var codes=Object.keys(groups).sort();
  var h='<div style="margin-top:10px"><div style="font-size:12px;font-weight:800;color:#1f4e79;margin-bottom:6px">'+esc(title)+'</div>';
  if(!codes.length)return h+'<div class="settings-empty-state">لا توجد أكواد.</div></div>';
  h+='<div class="settings-list">';
  codes.forEach(function(code){
    var key=issueType+':'+code;
    var expanded=!!migrationAuditExpandedCodes[key];
    var encodedCode=encodeURIComponent(code);
    h+='<div style="border:1px solid #e7eef5;border-radius:10px;background:#fbfdff;overflow:hidden">';
    h+='<button type="button" class="settings-branding-toggle" aria-expanded="'+(expanded?'true':'false')+'" onclick="toggleMigrationAuditCode(\''+encodedCode+'\',\''+issueType+'\')">';
    h+='<span><code>'+esc(code)+'</code> <b class="settings-count-badge">'+groups[code].length+'</b> <small style="color:#647b91">'+(issueType==='errors'?'خطأ':'تحذير')+'</small></span>';
    h+='<span class="settings-branding-toggle-arrow" aria-hidden="true">'+(expanded?'▲':'▼')+'</span></button>';
    if(expanded){
      h+='<div style="padding:9px"><div class="settings-list">';
      groups[code].forEach(function(entry){h+=renderMigrationAuditExpandedIssue(entry);});
      h+='</div></div>';
    }
    h+='</div>';
  });
  return h+'</div></div>';
}

function renderMigrationAuditSection(){
  if(!window.DiagnosticsPrivacyPolicy||
    !window.DiagnosticsPrivacyPolicy.canViewConferenceDiagnostics())return '';
  var h='<section class="settings-section"><div class="settings-section-title">فحص جاهزية المزامنة</div>';
  h+='<div class="settings-branding-actions"><button class="btn btn-blue" onclick="runMigrationAudit()">تشغيل الفحص</button></div>';
  if(!migrationAuditReport){
    return h+'<div class="settings-empty-state" style="margin-top:10px">لم يتم تشغيل الفحص بعد.</div></section>';
  }

  var report=migrationAuditReport;
  var summaryCards=[
    ['الحالة',report.valid?'جاهز للمزامنة':'يحتاج إصلاح'],
    ['المؤتمرات',report.summary.conferences],
    ['الأخطاء',report.summary.errors],
    ['التحذيرات',report.summary.warnings],
    ['البيوت',report.stats.houses],
    ['الأدوار',report.stats.floors],
    ['الغرف',report.stats.rooms],
    ['الأشخاص',report.stats.people],
    ['النزلاء',report.stats.guests],
    ['الأطفال',report.stats.children]
  ];
  h+='<div class="settings-summary-grid" style="margin-top:10px">';
  summaryCards.forEach(function(card){
    h+='<div class="settings-summary-card"><strong>'+esc(String(card[1]))+'</strong><span>'+esc(card[0])+'</span></div>';
  });
  var errorCodeGroups=groupMigrationAuditIssuesByCode(report,'errors');
  var warningCodeGroups=groupMigrationAuditIssuesByCode(report,'warnings');
  var conferencesWithErrors=report.conferences.filter(function(conference){
    return conference.errors.length>0;
  }).map(function(conference){
    return conference.conferenceName||conference.conferenceId||'مؤتمر بدون اسم';
  });
  h+='</div><div class="settings-branding-actions">';
  h+='<button class="btn '+(migrationAuditFilter==='all'?'btn-purple':'btn-gray')+' btn-sm" onclick="setMigrationAuditFilter(\'all\')">الكل</button>';
  h+='<button class="btn '+(migrationAuditFilter==='errors'?'btn-purple':'btn-gray')+' btn-sm" onclick="setMigrationAuditFilter(\'errors\')">الأخطاء فقط</button>';
  h+='<button class="btn '+(migrationAuditFilter==='warnings'?'btn-purple':'btn-gray')+' btn-sm" onclick="setMigrationAuditFilter(\'warnings\')">التحذيرات فقط</button></div>';
  if(migrationAuditFilter!=='warnings'){
    h+=renderMigrationAuditCodeCounts(errorCodeGroups,'أكواد الأخطاء','errors');
    h+='<div style="margin-top:10px"><div style="font-size:12px;font-weight:800;color:#1f4e79;margin-bottom:6px">المؤتمرات التي بها أخطاء</div>';
    h+=conferencesWithErrors.length
      ? '<div class="settings-list">'+conferencesWithErrors.map(function(name){return '<div class="settings-list-item"><div>'+esc(name)+'</div></div>';}).join('')+'</div></div>'
      : '<div class="settings-empty-state">لا توجد مؤتمرات بها أخطاء.</div></div>';
  }
  if(migrationAuditFilter!=='errors'){
    h+=renderMigrationAuditCodeCounts(warningCodeGroups,'أكواد التحذيرات','warnings');
  }

  if(migrationAuditFilter!=='warnings'&&(report.errors||[]).length){
    h+=renderMigrationAuditIssueList(report.errors,'أخطاء عامة');
  }
  if(migrationAuditFilter!=='errors'&&(report.warnings||[]).length){
    h+=renderMigrationAuditIssueList(report.warnings,'تحذيرات عامة');
  }
  report.conferences.forEach(function(conference){
    var errors=migrationAuditFilter==='warnings'?[]:conference.errors;
    var warnings=migrationAuditFilter==='errors'?[]:conference.warnings;
    h+='<div style="margin-top:12px;padding:11px;border:1px solid #e4edf5;border-radius:11px;background:#fbfdff">';
    h+='<div style="font-weight:800;color:#1f4e79">'+esc(conference.conferenceName||conference.conferenceId||'مؤتمر بدون اسم')+'</div>';
    h+='<div style="font-size:10px;color:#647b91;margin-top:3px">الأخطاء: '+conference.errors.length+' · التحذيرات: '+conference.warnings.length+'</div>';
    if(migrationAuditFilter!=='warnings')h+=renderMigrationAuditIssueList(errors,'الأخطاء');
    if(migrationAuditFilter!=='errors')h+=renderMigrationAuditIssueList(warnings,'التحذيرات');
    h+='</div>';
  });
  return h+'</section>';
}

function renderSettings(){
  var current = getCurrentConference();
  var activeSettingsTab = settingsTab || 'general';
  ensureUserManagementAccess();
  ensureOrganizationManagementAccess();
  if(activeSettingsTab==='organization-members'){
    var organizationMembersUi=window.OrganizationMembersUI;
    var organizationMembersHtml='<div class="settings-dashboard" dir="rtl">';
    organizationMembersHtml+='<div class="settings-nav"><button class="btn btn-gray btn-sm" onclick="returnToOrganizationManagementFromMembers()">← العودة إلى إدارة المؤسسات</button></div>';
    organizationMembersHtml+=organizationMembersUi&&
      typeof organizationMembersUi.renderSection==='function'
      ?organizationMembersUi.renderSection({})
      :'<div class="settings-empty-state">تعذر تحميل إدارة أعضاء المؤسسة.</div>';
    organizationMembersHtml+='</div>';
    ge('tab6').innerHTML=organizationMembersHtml;
    return;
  }
  var canOpenUserManagement=userManagementAccessState.status==='loaded'&&
    userManagementAccessState.capabilities&&
    userManagementAccessState.capabilities.canOpenUserManagement===true;
  if(activeSettingsTab==='users'&&!canOpenUserManagement){
    activeSettingsTab='general';
    settingsTab='general';
  }
  var h='<div class="settings-dashboard" dir="rtl">';
  h+='<div class="settings-nav">';
  h+='<button class="btn '+(activeSettingsTab==='general'?'btn-purple':'btn-gray')+' btn-sm" onclick="switchSettingsTab(\'general\')">⚙️ إعدادات الحدث</button>';
  h+='<button class="btn '+(activeSettingsTab==='houses'?'btn-purple':'btn-gray')+' btn-sm" onclick="switchSettingsTab(\'houses\')">🏠 بيوت المؤتمرات</button>';
  if(canOpenUserManagement)h+='<button class="btn '+(activeSettingsTab==='users'?'btn-purple':'btn-gray')+' btn-sm" onclick="switchSettingsTab(\'users\')">👥 إدارة المستخدمين</button>';
  if(organizationManagementAccessState.status==='loaded'&&organizationManagementAccessState.canOpen)h+='<button class="btn btn-gray btn-sm" data-organization-management-entry onclick="OrganizationManagementUI.open({returnView:\'settings\'})">🏢 إدارة المؤسسات</button>';
  h+='</div>';
  if (activeSettingsTab === 'houses') {
    h += '<section class="settings-section settings-library-section">' + renderHouseTemplatesSettings() + '</section></div>';
    ge('tab6').innerHTML = h;
    return;
  }
  if (activeSettingsTab === 'users') {
    if(window.UserManagementUI&&
      typeof window.UserManagementUI.renderSection==='function'){
      h+=window.UserManagementUI.renderSection();
    }else{
      h+='<div class="settings-empty-state">تعذر تحميل نموذج إدارة المستخدمين.</div>';
    }
    h+='</div>';
    ge('tab6').innerHTML=h;
    if(window.UserManagementUI&&
      typeof window.UserManagementUI.initialize==='function'){
      window.UserManagementUI.initialize();
    }
    return;
  }
  if(window.ConferenceSyncUI&&
    typeof window.ConferenceSyncUI.renderSection==='function'){
    h+=window.ConferenceSyncUI.renderSection({localConference:current});
  }
  if(window.ConferenceMembersUI&&
    typeof window.ConferenceMembersUI.renderSection==='function'){
    var membershipLink=current&&window.ConferenceLinkStore&&
      typeof window.ConferenceLinkStore.get==='function'
      ?window.ConferenceLinkStore.get(current.id)
      :null;
    h+=window.ConferenceMembersUI.renderSection({
      localConference:current,
      remoteConferenceId:membershipLink&&
        membershipLink.remoteConferenceId||''
    });
  }
  if(window.OrganizationMembersUI&&
    typeof window.OrganizationMembersUI.renderSection==='function'){
    h+=window.OrganizationMembersUI.renderSection({});
  }
  if(window.ConflictResolutionUI&&
    typeof window.ConflictResolutionUI.renderSection==='function'){
    h+=window.ConflictResolutionUI.renderSection({localConference:current});
  }
  if(window.RealtimeLocksUI&&
    typeof window.RealtimeLocksUI.renderSection==='function'){
    h+=window.RealtimeLocksUI.renderSection({localConference:current});
  }
  if(window.WrongRemoteBindingRepairUI&&
    typeof window.WrongRemoteBindingRepairUI.render==='function'){
    h+=window.WrongRemoteBindingRepairUI.render();
  }
  h += renderMigrationAuditSection();
  if (!current) {
    h += '<div class="settings-empty-state">يرجى اختيار مؤتمر أو إنشاء مؤتمر جديد أولًا لعرض هذا القسم.</div></div>';
    ge('tab6').innerHTML = h;
    mountSyncSettingsSection();
    refreshConferenceMembersSection();
    refreshOrganizationMembersSection();
    return;
  }
  conferenceBrandingDraft=getConferenceBrandingSettings(current);
  var conf = (current || {}).conf || {};
  var peopleCount = getPeopleList().length;
  h+='<div class="settings-summary-grid">';
  h+='<div class="settings-summary-card"><strong>'+appData.conferences.length+'</strong><span>عدد المؤتمرات</span></div>';
  h+='<div class="settings-summary-card"><strong>'+peopleCount+'</strong><span>عدد الأشخاص</span></div>';
  h+='<div class="settings-summary-card"><strong>'+appData.templates.length+'</strong><span>عدد القوالب</span></div>';
  h+='<div class="settings-summary-card"><strong>'+appData.backups.length+'</strong><span>عدد النسخ الاحتياطية</span></div>';
  h+='<div class="settings-summary-card"><strong>'+appData.archives.length+'</strong><span>عدد العناصر المؤرشفة</span></div>';
  h+='</div>';
  h+='<section class="settings-section"><div class="settings-section-title">المؤتمر الحالي</div>';
  h+='<div class="settings-conference-selector"><div><label class="lbl">اختر مؤتمر</label><select id="conf_select">';
  appData.conferences.forEach(function(c){
    h+='<option value="'+c.id+'"'+(c.id===appData.currentConferenceId?' selected':'')+'>'+esc(c.name)+' — '+conferenceStatusText(c)+'</option>';
  });
  h+='</select></div>';
  h+='<div><label class="lbl">المؤتمر الحالي</label><div class="settings-current-conference">'+esc(current?current.name:'')+' <span>'+conferenceStatusText(current)+'</span></div></div>';
  h+='</div></section>';
  h+=renderConferenceBrandingSettings();
  if(window.ConferenceOperationalUI&&
    typeof window.ConferenceOperationalUI.renderSection==='function'){
    h+=window.ConferenceOperationalUI.renderSection({
      localConference:getCurrentConference()
    });
  }
  h+=renderActivityLogSection();
  h+='<section class="settings-section settings-conference-management"><div class="settings-section-title">إدارة المؤتمر</div><div class="settings-action-groups">';
  h+='<div class="settings-action-group"><div class="settings-action-group-title">إدارة</div><div class="settings-actions-grid">';
  h+='<button class="btn btn-green" onclick="editCurrentConference()">✏️ تعديل بيانات المؤتمر</button>';
  h+='<button class="btn btn-blue" data-system-conference-create onclick="createNewConference()">➕ مؤتمر جديد</button>';
  h+='</div></div>';
  h+='<div class="settings-action-group"><div class="settings-action-group-title">حفظ واسترجاع</div><div class="settings-actions-grid">';
  h+='<button class="btn btn-gray" onclick="backupAppData()">🔁 إنشاء نسخة احتياطية</button>';
  h+='<button class="btn btn-blue" onclick="downloadFullApplicationBackup()">تنزيل نسخة احتياطية كاملة</button>';
  h+='<button class="btn btn-green" onclick="saveToFile()">حفظ ملف HTML</button>';
  h+='<button class="btn btn-blue" onclick="exportJsonFile()">تصدير JSON</button>';
  h+='<button class="btn btn-purple" onclick="ge(\'fullBackupPreflightInput\').click()">فحص نسخة احتياطية كاملة</button>';
  h+='<input id="fullBackupPreflightInput" type="file" accept=".json,application/json" style="display:none" onchange="inspectFullApplicationBackup(event)">';
  h+='<button class="btn btn-orange" onclick="archiveCurrentConference()">🗄️ أرشفة المؤتمر</button>';
  h+='<button class="btn btn-purple" onclick="saveTemplate()">✳️ إنشاء قالب</button>';
  h+='</div><div class="settings-summary-note">يحفظ جميع المؤتمرات والقوالب والأرشيفات وبيانات البرنامج في ملف واحد.</div>';
  h+='<div class="settings-summary-note">يقرأ النسخة ويعرض محتوياتها ومخاطر الاستعادة قبل استبدال أي بيانات.</div>';
  h+='<div class="settings-summary-note">سيتم فحص الملف محليًا داخل هذا الجهاز ولن يتم رفعه إلى الإنترنت.</div>';
  h+='<div class="settings-summary-note">قد يحتوي الملف على بيانات شخصية ومالية. احتفظ به في مكان آمن.</div></div>';
  h+='<div class="settings-action-group settings-action-group-sensitive"><div class="settings-action-group-title">عمليات حساسة</div><div class="settings-actions-grid">';
  h+='<button class="btn btn-orange" onclick="if(confirm(\'هل أنت متأكد من إنهاء هذا المؤتمر؟ لن يتم حذف أي بيانات، وسيتم نقله إلى قائمة المؤتمرات المنتهية.\')) completeCurrentConference()">✅ إنهاء المؤتمر</button>';
  h+='<button class="btn btn-red" onclick="deleteCurrentConference()">🗑 حذف المؤتمر</button>';
  h+='<button class="btn btn-gray" onclick="returnToStartupScreen()">العودة إلى شاشة البداية</button>';
  h+='</div></div></div></section>';
  h += renderPeopleDatabaseSection();
  h+='<section class="settings-section settings-branding-section settings-ui-accordion"><button type="button" class="settings-branding-toggle" aria-expanded="false" onclick="var content=this.nextElementSibling;var isOpen=content.classList.toggle(\'settings-branding-content-open\');content.setAttribute(\'aria-hidden\',isOpen?\'false\':\'true\');this.setAttribute(\'aria-expanded\',isOpen?\'true\':\'false\');this.querySelector(\'.settings-branding-toggle-arrow\').textContent=isOpen?\'▲\':\'▼\'"><span>القوالب</span><span class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button><div class="settings-branding-content settings-ui-accordion-content" aria-hidden="true">';
  if(appData.templates.length){
    h+='<div class="settings-list">';
    appData.templates.forEach(function(t){
      h+='<div class="settings-list-item">';
      h+='<div><div style="font-weight:700">'+esc(t.name)+'</div><div style="font-size:10px;color:#5a7a9a">'+esc(t.createdAt||'')+'</div></div>';
      h+='<div class="row" style="gap:6px">';
      h+='<button class="btn btn-purple btn-sm" onclick="ConferenceTemplateHousesEditor.open(\''+t.id+'\')">إدارة بيوت وغرف القالب</button>';
      h+='<button class="btn btn-blue btn-sm" onclick="applyTemplate(\''+t.id+'\')">تشغيل</button>';
      h+='<button class="btn btn-red btn-sm" onclick="moveTemplateToTrash(\''+t.id+'\')">حذف</button>';
      h+='</div></div>';
    });
    h+='</div>';
  } else {
    h+='<div class="settings-empty-state">لا توجد قوالب محفوظة</div>';
  }
  h+='</div></section>';
  h+='<section class="settings-section settings-branding-section settings-ui-accordion"><button type="button" class="settings-branding-toggle" aria-expanded="false" onclick="var content=this.nextElementSibling;var isOpen=content.classList.toggle(\'settings-branding-content-open\');content.setAttribute(\'aria-hidden\',isOpen?\'false\':\'true\');this.setAttribute(\'aria-expanded\',isOpen?\'true\':\'false\');this.querySelector(\'.settings-branding-toggle-arrow\').textContent=isOpen?\'▲\':\'▼\'"><span>الأرشيف</span><span class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button><div class="settings-branding-content settings-ui-accordion-content" aria-hidden="true">';
  if(appData.archives.length){
    h+='<div class="settings-list">';
    appData.archives.slice().reverse().forEach(function(a){
      h+='<div class="settings-list-item settings-history-item">';
      h+='<div><div style="font-weight:700">'+esc(a.name)+'</div><div style="font-size:10px;color:#5a7a9a">'+esc(a.archivedAt)+'</div></div>';
      h+='<div class="row" style="gap:6px">';
      h+='<button class="btn btn-blue btn-sm" onclick="restoreArchive(\''+a.id+'\')">استعادة</button>';
      h+='<button class="btn btn-red btn-sm" onclick="moveArchiveToTrash(\''+a.id+'\')">حذف</button>';
      h+='</div>';
      h+='</div>';
    });
    h+='</div>';
  } else {
    h+='<div class="settings-empty-state">لا توجد محتويات في الأرشيف</div>';
  }
  h+='</div></section>';
  h+='<section class="settings-section settings-branding-section settings-ui-accordion"><button type="button" class="settings-branding-toggle" aria-expanded="false" onclick="var content=this.nextElementSibling;var isOpen=content.classList.toggle(\'settings-branding-content-open\');content.setAttribute(\'aria-hidden\',isOpen?\'false\':\'true\');this.setAttribute(\'aria-expanded\',isOpen?\'true\':\'false\');this.querySelector(\'.settings-branding-toggle-arrow\').textContent=isOpen?\'▲\':\'▼\'"><span>النسخ الاحتياطية</span><span class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button><div class="settings-branding-content settings-ui-accordion-content" aria-hidden="true">';
  if(appData.backups.length){
    h+='<div class="settings-list">';
    appData.backups.slice().reverse().forEach(function(b){
      h+='<div class="settings-list-item settings-history-item">';
      h+='<div><div style="font-weight:700">'+esc(b.name)+'</div><div style="font-size:10px;color:#5a7a9a">'+esc(b.createdAt)+'</div></div>';
      h+='<div class="row" style="gap:6px">';
      h+='<button class="btn btn-blue btn-sm" onclick="restoreBackup(\''+b.id+'\')">استعادة</button>';
      h+='<button class="btn btn-red btn-sm" onclick="moveBackupToTrash(\''+b.id+'\')">حذف</button>';
      h+='</div>';
      h+='</div>';
    });
    h+='</div>';
  } else {
    h+='<div class="settings-empty-state">لا توجد نسخ احتياطية بعد</div>';
  }
  h+='</div></section>';
  h += renderTrashSection();
  h+='<section class="settings-section settings-branding-section settings-ui-accordion settings-event-summary"><button type="button" class="settings-branding-toggle" aria-expanded="false" onclick="var content=this.nextElementSibling;var isOpen=content.classList.toggle(\'settings-branding-content-open\');content.setAttribute(\'aria-hidden\',isOpen?\'false\':\'true\');this.setAttribute(\'aria-expanded\',isOpen?\'true\':\'false\');this.querySelector(\'.settings-branding-toggle-arrow\').textContent=isOpen?\'▲\':\'▼\'"><span>ملخص الحدث</span><span class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button><div class="settings-branding-content settings-ui-accordion-content" aria-hidden="true">';
  var ag=activeGuests();var days=getDays();
  h+='<div class="stats">';
  h+='<div class="stat-card" style="border-top:4px solid #1F4E79"><div class="stat-val" style="color:#1F4E79">'+days+'</div><div class="stat-lbl">📅 الأيام</div></div>';
  h+='<div class="stat-card" style="border-top:4px solid #27AE60"><div class="stat-val" style="color:#27AE60">'+(ag.adults.length+ag.children.length)+'</div><div class="stat-lbl">👥 إجمالي الأفراد</div></div>';
  h+='<div class="stat-card" style="border-top:4px solid #E67E22"><div class="stat-val" style="color:#E67E22">'+((current||{}).transports||[]).length+'</div><div class="stat-lbl">🚌 وسائل مواصلات</div></div>';
  h+='</div>';
  // per-day attendance
  h+='<div style="margin-top:10px"><div style="font-size:12px;font-weight:700;color:#1F4E79;margin-bottom:6px">📈 الحضور اليومي</div>';
  for(var d=1;d<=days;d++){
    var p=personsOnDay(d);var total=p.adults+p.children;
    var pct=ag.adults.length+ag.children.length>0?Math.round(total/(ag.adults.length+ag.children.length)*100):0;
    h+='<div class="day-report-row" style="background:#EAF4FC">';
    h+='<div style="font-weight:700;min-width:50px">يوم '+d+'</div>';
    h+='<div class="settings-attendance-progress" style="flex:1;background:#BDD7EE;border-radius:6px;height:10px;overflow:hidden"><div style="background:#2E75B6;width:'+pct+'%;height:100%"></div></div><strong class="settings-attendance-percent">'+pct+'%</strong>';
    h+='<div style="min-width:80px;text-align:left">'+total+' شخص ('+p.adults+' بالغ + '+p.children+' طفل)</div>';
    h+='</div>';
  }
  h+='</div></div></section></div>';
  ge('tab6').innerHTML=h;
  if(window.SystemAccessService&&
    typeof window.SystemAccessService.applyUi==='function'){
    window.SystemAccessService.applyUi();
  }
  mountSyncSettingsSection();
  refreshConferenceMembersSection();
  refreshOrganizationMembersSection();
  var conferenceSelect = ge('conf_select');
  if(conferenceSelect){
    conferenceSelect.value = appData.currentConferenceId || '';
    conferenceSelect.onchange = function(){
      setCurrentConferenceById(this.value);
    };
  }
  updateConferenceBrandingPreview();
  renderActivityLog();
}

function renderPeopleDatabaseSection(){
  var people = getPeopleList();
  var h = '<section class="settings-section settings-branding-section settings-ui-accordion"><button type="button" class="settings-branding-toggle" aria-expanded="false" onclick="var content=this.nextElementSibling;var isOpen=content.classList.toggle(\'settings-branding-content-open\');content.setAttribute(\'aria-hidden\',isOpen?\'false\':\'true\');this.setAttribute(\'aria-expanded\',isOpen?\'true\':\'false\');this.querySelector(\'.settings-branding-toggle-arrow\').textContent=isOpen?\'▲\':\'▼\'"><span class="settings-accordion-heading">قاعدة بيانات الأشخاص <b class="settings-count-badge">'+people.length+'</b></span><span class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button><div class="settings-branding-content settings-ui-accordion-content" aria-hidden="true">';
  h += '<div class="settings-people-toolbar">';
  h += '<button class="btn btn-blue" onclick="openPeopleExcelImport()">📥 استيراد ملف إكسل</button>';
  h += '<button class="btn btn-purple" onclick="openPersonDialog()">➕ إضافة شخص جديد</button>';
  h += '</div>';
  if(!people.length){
    h += '<div class="settings-empty-state">لا توجد بيانات أشخاص بعد.</div>';
  } else {
    h += '<div class="settings-list settings-people-list">';
    people.slice().reverse().slice(0, 30).forEach(function(p){
      h += '<div class="settings-list-item">';
      h += '<div><div style="font-weight:700">' + esc(p.fullName) + '</div><div style="font-size:10px;color:#5a7a9a">' + esc(personMetaText(p) || '-') + '</div></div>';
      h += '<div class="row" style="gap:4px">';
      h += '<button class="btn btn-gray btn-sm" onclick="openPersonDialog(\'' + p.id + '\')">✏️ تعديل</button>';
      h += '<button class="btn btn-red btn-sm" onclick="deletePersonFromDatabase(\'' + p.id + '\')">🗑️ حذف</button>';
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div></section>';
  return h;
}

function importPeopleExcelFile(e){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('importPeopleExcelFile',null))return false;
  var f = e.target.files && e.target.files[0];
  if(!f) return;
  if(typeof XLSX === 'undefined'){
    alert('تعذر استيراد Excel: مكتبة XLSX غير متاحة.');
    e.target.value = '';
    return;
  }
  var reader = new FileReader();
  reader.onload = function(ev){
    try {
      var workbook = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
      var firstSheetName = workbook.SheetNames && workbook.SheetNames.length ? workbook.SheetNames[0] : null;
      if(!firstSheetName){ alert('ملف Excel فارغ.'); return; }
      var sheet = workbook.Sheets[firstSheetName];
      var rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if(!rows.length){ alert('لا توجد صفوف قابلة للاستيراد.'); return; }

      var added = 0, updated = 0, skipped = 0;
      rows.forEach(function(row){
        var fullName = readImportField(row, ['الاسم', 'Name']);
        if(!fullName){ skipped++; return; }
        var personData = {
          fullName: fullName,
          phone: readImportField(row, ['رقم الموبايل', 'الموبايل', 'Phone', 'Mobile']),
          age: readImportField(row, ['السن', 'العمر', 'Age'])
        };
        var existing = findExistingPerson(personData.fullName, personData.phone);
        var person = upsertPerson(personData, true);
        if(!person){ skipped++; return; }
        if(existing) updated++;
        else added++;
      });

      if(!save())return;
      refreshPeopleDatalist();
      renderSettings();
      showToast('✅ الأشخاص: جديد ' + added + ' • تحديث ' + updated + ' • تخطي ' + skipped);
    } catch(err){
      alert('فشل قراءة ملف Excel. تأكد من الصيغة.');
    }
  };
  reader.readAsArrayBuffer(f);
  e.target.value = '';
}

function openPersonDialog(personId){
  var person = personId ? getPersonById(personId) : null;
  ge('personDialogId').value = person ? person.id : '';
  ge('person_full_name').value = person ? person.fullName : '';
  ge('person_church').value = person ? person.church : '';
  ge('person_phone').value = person ? person.phone : '';
  ge('person_gender').value = person ? person.gender : '';
  ge('person_age').value = person ? person.age : '';
  ge('person_notes').value = person ? person.notes : '';
  ge('personModalTitle').textContent = person ? '✏️ تعديل شخص' : '➕ إضافة شخص جديد';
  ge('personModal').style.display = 'flex';
}

function closePersonDialog(){
  ge('personModal').style.display = 'none';
  personDialogContext = { guestRowId: null, childRowId: null, targetField: '' };
}

function deletePersonFromDatabase(personId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deletePersonFromDatabase',null))return false;
  var person = getPersonById(personId);
  if(!person) return;
  var displayName = esc(person.fullName || 'الشخص');
  if(!confirm('هل أنت متأكد من حذف "' + displayName + '"؟')) return;
  
  var current = getCurrentConference();
  if(!current) return;
  
  var isUsed = false;
  var houses = current.houses || [];
  for(var h=0;h<houses.length;h++){
    var house = houses[h];
    var floors = house.floors || [];
    for(var f=0;f<floors.length;f++){
      var floor = floors[f];
      var rooms = floor.rooms || [];
      for(var r=0;r<rooms.length;r++){
        var room = rooms[r];
        var guests = room.guests || [];
        var children = room.children || [];
        for(var g=0;g<guests.length;g++){
          if(guests[g] === personId || (guests[g] && guests[g].personId === personId)){ isUsed = true; break; }
        }
        for(var c=0;c<children.length;c++){
          if(children[c] === personId || (children[c] && (children[c].personId === personId || children[c].guardianPersonId === personId))){ isUsed = true; break; }
        }
        if(isUsed) break;
      }
      if(isUsed) break;
    }
    if(isUsed) break;
  }
  
  if(isUsed){
    alert('لا يمكن حذف "' + displayName + '" لأنه مرتبط حاليًا بتسكين نزيل أو طفل أو ولي أمر داخل إحدى الغرف.');
    return;
  }
  
  var people = getPeopleList();
  var newPeople = [];
  for(var i=0;i<people.length;i++){
    if(people[i].id !== personId) newPeople.push(people[i]);
  }
  var peopleDb = getPeopleDb();
  peopleDb.people = newPeople;
  if(!save())return false;
  renderSettings();
  showToast('🗑️ تم حذف الشخص');
  return true;
}

function savePersonDialog(){
  var personId = ge('personDialogId').value;
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('savePersonDialog',personId?'update':'create'))return false;
  var fullName = ge('person_full_name').value.trim();
  if(!fullName){ alert('الاسم الكامل مطلوب.'); return; }
  var personData = {
    id: personId || uid(),
    fullName: fullName,
    church: ge('person_church').value.trim(),
    phone: ge('person_phone').value.trim(),
    gender: ge('person_gender').value.trim(),
    age: ge('person_age').value.trim(),
    notes: ge('person_notes').value.trim()
  };
  var person = upsertPerson(personData, true);
  if(!person){ alert('تعذر حفظ الشخص.'); return; }

  if(personDialogContext.guestRowId){
    var row = ge(personDialogContext.guestRowId);
    if(row){
      var nameInput = row.querySelector('.person-name');
      var idInput = row.querySelector('.person-id');
      if(nameInput) nameInput.value = person.fullName;
      if(idInput) idInput.value = person.id;
      bindGuestPersonRow(personDialogContext.guestRowId);
    }
  }
  if(personDialogContext.childRowId){
    var cRow = ge(personDialogContext.childRowId);
    if(cRow){
      if(personDialogContext.targetField === 'guardian'){
        var gInput = cRow.querySelector('.guardian-name');
        var gId = cRow.querySelector('.guardian-person-id');
        if(gInput) gInput.value = person.fullName;
        if(gId) gId.value = person.id;
        bindChildPersonRow(personDialogContext.childRowId, 'guardian');
      } else {
        var cInput = cRow.querySelector('.child-name');
        var cId = cRow.querySelector('.child-person-id');
        if(cInput) cInput.value = person.fullName;
        if(cId) cId.value = person.id;
        bindChildPersonRow(personDialogContext.childRowId, 'child');
      }
    }
  }

  if(!save())return false;
  refreshPeopleDatalist();
  if(ge('tab6') && ge('tab6').style.display !== 'none') renderSettings();
  closePersonDialog();
  showToast('✅ تم حفظ بيانات الشخص');
  return true;
}

function openQuickAddPersonForGuest(rowId){
  personDialogContext = { guestRowId: rowId, childRowId: null, targetField: '' };
  openPersonDialog();
}

function openQuickAddPersonForChild(rowId, field){
  personDialogContext = { guestRowId: null, childRowId: rowId, targetField: field || 'child' };
  openPersonDialog();
}

function renderTrashSection(){
  var trash = appData.trash || {};
  var types = [
    { key: 'templates', title: 'القوالب' },
    { key: 'archives', title: 'الأرشيف' },
    { key: 'backups', title: 'النسخ الاحتياطية' },
    { key: 'houseTemplates', title: 'بيوت المؤتمرات' },
    { key: 'rooms', title: 'الغرف' }
  ];
  var trashCount = types.reduce(function(total,type){ return total + ((trash[type.key] || []).length); },0);
  var h = '<section class="settings-section settings-branding-section settings-ui-accordion"><button type="button" class="settings-branding-toggle" aria-expanded="false" onclick="var content=this.nextElementSibling;var isOpen=content.classList.toggle(\'settings-branding-content-open\');content.setAttribute(\'aria-hidden\',isOpen?\'false\':\'true\');this.setAttribute(\'aria-expanded\',isOpen?\'true\':\'false\');this.querySelector(\'.settings-branding-toggle-arrow\').textContent=isOpen?\'▲\':\'▼\'"><span class="settings-accordion-heading">سلة المحذوفات <b class="settings-count-badge">'+trashCount+'</b></span><span class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button><div class="settings-branding-content settings-ui-accordion-content" aria-hidden="true">';
  var hasAny = false;
  types.forEach(function(t){
    var list = trash[t.key] || [];
    if (!list.length) return;
    hasAny = true;
    h += '<div style="margin-bottom:8px">';
    h += '<div style="font-weight:700;color:#5a7a9a;margin-bottom:4px">' + t.title + '</div>';
    list.slice().reverse().forEach(function(item){
      var title = '';
      if (t.key === 'rooms') {
        var p = item.payload || {};
        title = 'غرفة ' + esc((p.room && p.room.number) || '-') + ' (' + esc(p.houseName || '') + ' - ' + esc(p.floorName || '') + ')';
      } else {
        title = esc((item.payload && item.payload.name) || 'عنصر');
      }
      h += '<div class="row" style="justify-content:space-between;padding:6px 8px;border:1px solid #EEF3F8;border-radius:9px;margin-bottom:5px">';
      h += '<div><div style="font-weight:700">' + title + '</div><div style="font-size:10px;color:#AAB5C0">' + esc(item.deletedAt || '') + '</div></div>';
      h += '<div class="row" style="gap:6px">';
      h += '<button class="btn btn-blue btn-sm" onclick="restoreTrashItem(\'' + t.key + '\', \'' + item.id + '\')">استرجاع</button>';
      h += '<button class="btn btn-red btn-sm" onclick="purgeTrashItem(\'' + t.key + '\', \'' + item.id + '\')">حذف نهائي</button>';
      h += '</div></div>';
    });
    h += '</div>';
  });
  if (!hasAny) {
    h += '<div style="color:#AAB5C0;padding:12px;font-size:11px">سلة المحذوفات فارغة</div>';
  }
  h += '</div></section>';
  return h;
}

function renderHouseTemplatesSettings() {
  var templates = appData.houseTemplates || [];
  appData.houseTemplates = templates;
  var selected = ensureSelectedHouseTemplate();
  var h = '<div class="card">';
  if (selected) {
    h += '<div class="house-templates-heading"><div class="card-title">🏠 '+esc(selected.name || 'بيت غير مسمى')+'</div>';
    h += renderRoomTypeStatCards(getHouseTemplateRooms(selected),true);
    h += '</div>';
  } else {
    h += '<div class="house-templates-heading"><div class="card-title">اختر بيتًا من القائمة</div></div>';
  }
  h += '<div class="house-templates-layout">';
  h += '<aside class="house-templates-sidebar">';
  h += '<button class="btn btn-purple house-create-button" onclick="createHouseTemplate()">➕ إنشاء بيت جديد</button>';
  h += '<div class="house-template-list">';
  if (templates.length) {
    templates.forEach(function(ht) {
      normalizeHouseTemplateStructure(ht);
      var active = selected && selected.id === ht.id;
      var templateRooms=getHouseTemplateRooms(ht);
      h += '<button type="button" class="house-template-list-card'+(active?' selected':'')+'" onclick="selectHouseTemplate(\'' + ht.id + '\')">';
      h += '<strong>' + esc(ht.name || 'بيت غير مسمى') + '</strong>';
      h += '<span>إجمالي الغرف: '+templateRooms.length+'</span>';
      h += '</button>';
    });
  } else {
    h += '<div style="color:#AAB5C0;padding:12px;font-size:11px">لا توجد بيوت محفوظة بعد</div>';
  }
  h += '</div></aside>';
  h += '<main class="house-template-details">';
  h += renderHouseTemplateDetails(selected);
  h += '</main></div>';
  h += '</div>';
  return h;
}

function createHouseTemplate() {
  editHouseTemplateId = null;
  selectedHouseTemplateId = null;
  ge('ht_title').textContent = '🏠 إنشاء خريطة بيت جديدة';
  ge('ht_name').value = '';
  ge('ht_desc').value = '';
  ht_renderTemplate(null);
  ge('houseTemplateModal').style.display = 'flex';
}

function openFloorFromHouseEditor() {
  if (!editHouseTemplateId) {
    alert('احفظ البيت أولاً ثم أضف الأدوار.');
    return;
  }
  if(!window.HouseTemplateContentAuthorization.requireEdit(editHouseTemplateId))return false;
  openTemplateFloorModal(editHouseTemplateId, null);
}

function openTemplateFloorModal(houseId, floorId) {
  if(!window.HouseTemplateContentAuthorization.requireEdit(houseId))return false;
  var house = getHouseTemplateById(houseId);
  if (!house) return;
  templateFloorDialog.houseId = houseId;
  templateFloorDialog.floorId = floorId || null;
  var floor = null;
  if (floorId) {
    (house.floors || []).forEach(function(item) {
      if (item.id === floorId) floor = item;
    });
  }
  ge('tf_title').textContent = floor ? ' تعديل الدور' : 'إضافة دور';
  ge('tf_house_name').textContent = house.name || 'بيت غير مسمى';
  ge('tf_floor_name').value = floor ? floor.name : '';
  ge('houseFloorModal').style.display = 'flex';
}

function closeTemplateFloorModal() {
  ge('houseFloorModal').style.display = 'none';
  templateFloorDialog.houseId = null;
  templateFloorDialog.floorId = null;
}

function refreshConferenceHouseAfterTemplateMutation(template,options){
  options=options||{};
  var currentConference = getCurrentConference();
  var updatedConferenceHouseCount = options.templateFloorId
    ?syncConferenceFloorFromTemplate(
      currentConference,template,options.templateFloorId
    )
    :updateConferenceHousesFromTemplate(currentConference, template);
  return {
    count: updatedConferenceHouseCount,
    render: function(){
      if(!updatedConferenceHouseCount) return;
      renderAccommodation();
      var activeRoomsModal = ge('addRoomFromTemplateModal');
      if(activeRoomsModal && activeRoomsModal.style.display !== 'none'){
        renderActiveRoomsManager();
      }
    }
  };
}

function saveTemplateFloor() {
  if(!window.HouseTemplateContentAuthorization.requireEdit(templateFloorDialog.houseId))return false;
  var house = getHouseTemplateById(templateFloorDialog.houseId);
  if (!house) return;
  var floorName = ge('tf_floor_name').value.trim();
  if (!floorName) {
    alert('أدخل اسم الدور');
    return;
  }
  var floor = null;
  if (templateFloorDialog.floorId) {
    (house.floors || []).forEach(function(item) {
      if (item.id === templateFloorDialog.floorId) floor = item;
    });
    if (!floor) return;
  }
  var duplicateName = false;
  (house.floors || []).forEach(function(item) {
    if (item !== floor && (item.name || '').trim() === floorName) duplicateName = true;
  });
  if (duplicateName) {
    alert('يوجد دور آخر بنفس الاسم في هذا البيت');
    return;
  }
  var previousAppData = deepClone(appData);
  var previousSelectedHouseTemplateId = selectedHouseTemplateId;
  if (floor) {
    floor.name = floorName;
  } else {
    house.floors = house.floors || [];
    floor=createDefaultFloor(floorName);
    house.floors.push(floor);
  }
  var conferenceRefresh=refreshConferenceHouseAfterTemplateMutation(house,{
    templateFloorId:floor.id
  });
  selectedHouseTemplateId = house.id;
  if(!saveTemplateOnly({houseTemplateId:house.id})){
    appData = previousAppData;
    selectedHouseTemplateId = previousSelectedHouseTemplateId;
    return false;
  }
  closeOrganizationManagementScreen();
  var conferenceHeader=ge('globalConferenceHeader');
  if(conferenceHeader)conferenceHeader.style.display='';
  if (editHouseTemplateId === house.id && ge('houseTemplateModal').style.display !== 'none') {
    ht_renderTemplate(house);
  }
  closeTemplateFloorModal();
  conferenceRefresh.render();
  renderSettings();
}

function renderTemplateRoomModal() {
  var houseSel = ge('tr_house');
  var floorSel = ge('tr_floor');
  if (!houseSel || !floorSel) return;
  var houses = appData.houseTemplates || [];
  var selectedHouseId = houseSel.value || (templateRoomDialog.houseId || '');
  houseSel.innerHTML = '';
  houses.forEach(function(house) {
    var opt = document.createElement('option');
    opt.value = house.id;
    opt.textContent = house.name || 'بيت غير مسمى';
    houseSel.appendChild(opt);
  });
  if (!selectedHouseId && houses.length) selectedHouseId = houses[0].id;
  if (selectedHouseId) houseSel.value = selectedHouseId;
  templateRoomDialog.houseId = selectedHouseId || null;

  floorSel.innerHTML = '';
  var house = getHouseTemplateById(selectedHouseId);
  if (house) {
    (house.floors || []).forEach(function(floor) {
      var opt2 = document.createElement('option');
      opt2.value = floor.id;
      opt2.textContent = floor.name || 'دور غير مسمى';
      floorSel.appendChild(opt2);
    });
    if (!templateRoomDialog.floorId || !(house.floors || []).some(function(item) { return item.id === templateRoomDialog.floorId; })) {
      templateRoomDialog.floorId = house.floors && house.floors.length ? house.floors[0].id : null;
    }
    if (templateRoomDialog.floorId) floorSel.value = templateRoomDialog.floorId;
  }
}

function openTemplateRoomModal(houseId, floorId, roomId) {
  if(!window.HouseTemplateContentAuthorization.requireEdit(houseId))return false;
  templateRoomDialog.houseId = houseId || null;
  templateRoomDialog.floorId = floorId || null;
  templateRoomDialog.roomId = roomId || null;
  var house = getHouseTemplateById(houseId);
  var floor = null;
  var room = null;
  if (house) {
    (house.floors || []).forEach(function(item) {
      if (item.id === floorId) floor = item;
    });
    if (floor) {
      (floor.rooms || []).forEach(function(item) {
        if (item.id === roomId) room = item;
      });
    }
  }
  ge('tr_title').textContent = room ? ' تعديل غرفة' : 'إضافة غرفة';
  ge('tr_room_number').value = room ? room.number || '' : '';
  ge('tr_room_beds').value = room ? (room.beds || 1) : 1;
  ge('tr_room_extra_beds').value = room ? (room.extraBeds || 0) : 0;
  ge('tr_room_notes').value = room ? (room.notes || '') : '';
  ge('tr_room_closed').checked = !!(room && room.closed);
  ge('tr_room_closed_day').value = room && room.closedDay !== undefined && room.closedDay !== null ? room.closedDay : '';
  ge('tr_room_closed_day').parentNode.style.display = ge('tr_room_closed').checked ? '' : 'none';
  ge('tr_house').value = houseId || '';
  ge('tr_house').setAttribute('data-original-house-id', room ? houseId : '');
  renderTemplateRoomModal();
  ge('houseRoomModal').style.display = 'flex';
}

function closeTemplateRoomModal() {
  ge('houseRoomModal').style.display = 'none';
  templateRoomDialog.houseId = null;
  templateRoomDialog.floorId = null;
  templateRoomDialog.roomId = null;
}

function saveTemplateRoom() {
  if(!window.HouseTemplateContentAuthorization.requireEdit(
    templateRoomDialog.houseId))return false;
  var houseId = ge('tr_house').value;
  if(!window.HouseTemplateContentAuthorization.requireEdit(houseId))return false;
  var floorId = ge('tr_floor').value;
  var number = ge('tr_room_number').value.trim();
  var beds = parseInt(ge('tr_room_beds').value, 10);
  var extraBeds = parseInt(ge('tr_room_extra_beds').value, 10);
  var notes = ge('tr_room_notes').value.trim();
  var closed = !!ge('tr_room_closed').checked;
  var closedDayRaw = ge('tr_room_closed_day').value;
  var closedDay = !closed || closedDayRaw === '' ? null : parseInt(closedDayRaw, 10);
  if (!houseId || !floorId) { alert('اختر البيت والدور'); return; }
  if (!number) { alert('أدخل رقم الغرفة'); return; }
  if (isNaN(beds) || beds < 1) { alert('عدد الأسرة يجب أن يكون واحدًا على الأقل'); return; }
  if (isNaN(extraBeds)) extraBeds = 0;
  if (extraBeds < 0) { alert('عدد الأسرة الإضافية لا يمكن أن يكون سالبًا'); return; }
  if (closed && closedDayRaw !== '' && (isNaN(closedDay) || closedDay < 1)) { alert('يوم الإغلاق يجب أن يكون رقمًا صحيحًا'); return; }
  var originalHouseId = ge('tr_house').getAttribute('data-original-house-id') || '';
  if (templateRoomDialog.roomId && originalHouseId && houseId !== originalHouseId) {
    alert('لا يمكن نقل الغرفة إلى بيت آخر');
    return;
  }
  var house = getHouseTemplateById(houseId);
  if (!house) return;
  var floor = null;
  (house.floors || []).forEach(function(item) {
    if (item.id === floorId) floor = item;
  });
  if (!floor) return;
  var room = null;
  var originalFloor = null;
  if (templateRoomDialog.roomId) {
    (house.floors || []).forEach(function(item) {
      (item.rooms || []).forEach(function(existingRoom) {
        if (!room && existingRoom.id === templateRoomDialog.roomId) {
          room = existingRoom;
          originalFloor = item;
        }
      });
    });
    if (!room || !originalFloor) return;
  }
  var duplicateNumber = false;
  (house.floors || []).forEach(function(item) {
    (item.rooms || []).forEach(function(existingRoom) {
      if (existingRoom !== room && (existingRoom.number || '').trim() === number) duplicateNumber = true;
    });
  });
  if (duplicateNumber) {
    alert('يوجد غرفة أخرى بنفس الرقم في هذا البيت');
    return;
  }
  var previousAppData = deepClone(appData);
  var previousSelectedHouseTemplateId = selectedHouseTemplateId;
  if (room) {
    room.number = number;
    room.beds = beds;
    room.extraBeds = extraBeds;
    room.notes = notes;
    room.closed = closed;
    room.closedDay = closedDay;
    if (originalFloor !== floor) {
      originalFloor.rooms = (originalFloor.rooms || []).filter(function(item) { return item !== room; });
      floor.rooms = floor.rooms || [];
      floor.rooms.push(room);
    }
  } else {
    floor.rooms = floor.rooms || [];
    floor.rooms.push({ id: uid(), number: number, beds: beds, extraBeds: extraBeds, notes: notes, guests: [], children: [], closed: closed, closedDay: closedDay });
  }
  selectedHouseTemplateId = house.id;
  if(!saveTemplateOnly({houseTemplateId:house.id})){
    appData = previousAppData;
    selectedHouseTemplateId = previousSelectedHouseTemplateId;
    return false;
  }
  if (editHouseTemplateId === house.id && ge('houseTemplateModal').style.display !== 'none') {
    ht_renderTemplate(house);
  }
  closeTemplateRoomModal();
  renderSettings();
}

function saveSettings(){
  var current=getCurrentConference();
  if(!current)return false;
  var conf=current.conf||{};
  var startDate=ge('cfg_start').value;
  var endDate=ge('cfg_end').value;
  var period=null;
  if(startDate||endDate){
    if(!startDate||!endDate){
      alert('يرجى إدخال تاريخ البداية وتاريخ النهاية.');
      return false;
    }
    period=calculateConferencePeriod(startDate,endDate);
    if(!period.valid){
      alert(period.error==='end_before_start'
        ?'تاريخ نهاية المؤتمر يجب ألا يسبق تاريخ البداية.'
        :'أحد تاريخي المؤتمر غير صالح.');
      return false;
    }
  }
  conf.name=ge('cfg_name').value.trim()||'المؤتمر';
  conf.days=period?period.days:(parseInt(ge('cfg_days').value,10)||1);
  conf.nights=period?period.nights:Math.max(0,conf.days-1);
  conf.schedule=period?buildConferenceSchedule(startDate,endDate):[];
  conf.place=ge('cfg_place') ? ge('cfg_place').value.trim() : (conf.place || '');
  conf.startDate=startDate;
  conf.endDate=endDate;
  current.conf=conf;
  current.startDate=startDate;
  current.endDate=endDate;
  current.days=conf.days;
  current.nights=conf.nights;
  current.schedule=conf.schedule;
  syncConferencePeriod(current);
  if (ge('cfg_house_template')) conf.houseTemplateId = ge('cfg_house_template').value || '';
  updateLogoText();
  if(!save())return false;
  renderSettings();showToast('✅ تم حفظ الإعدادات');
  return true;
}

function applyConferenceHouseTemplate(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('applyConferenceHouseTemplate',null))return false;
  if(!requireAccommodationMutation())return false;
  var current = getCurrentConference();
  if (!current) return;
  var conf = current.conf || {};
  var templateId = ge('cfg_house_template') ? (ge('cfg_house_template').value || '') : '';
  var preflight = getConferenceHousesPreflight(current.houses || []);

  if (preflight.houseCount) {
    var actionName = templateId ? 'استبدال بيوت المؤتمر' : 'إزالة بيوت المؤتمر';
    var confirmationMessage = preflight.occupantCount
      ? actionName + '؟ تحتوي البيوت الحالية على ' + preflight.roomCount + ' غرفة و' + preflight.occupantCount + ' نزيل. سيتم حذف بيانات التسكين نهائيًا.'
      : actionName + '؟ تحتوي البيوت الحالية على ' + preflight.roomCount + ' غرفة.';
    if (!confirm(confirmationMessage)) return;
  }

  if (templateId) {
    var template = getHouseTemplateById(templateId);
    if (template) {
      var newHouse = cloneHouseTemplateToConference(template);
      current.houses = [newHouse];
      current.accommodationDisplayedRoomIds = [];
      if(!save())return false;
      renderSettings();
      renderAccommodation();
      showToast('✅ تم تطبيق بيت المؤتمر المختار');
    }
  }

  if (!templateId) {
    current.houses = [];
    current.accommodationDisplayedRoomIds = [];
    if(!save())return false;
    renderSettings();
    renderAccommodation();
    showToast('✅ تم إزالة بيت المؤتمر');
    return;
  }
}

function saveHouseTemplate() {
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveHouseTemplate',editHouseTemplateId?'update':'create'))return false;
  if(editHouseTemplateId&&
    !window.HouseTemplateContentAuthorization.requireEdit(editHouseTemplateId))return false;
  if (!editHouseTemplateId && !confirm('سيتم إنشاء خريطة بيت جديدة. متابعة؟')) return;
  var name = ge('ht_name').value.trim();
  if (!name) { alert('الرجاء إدخال اسم للبيت.'); return; }

  var previousAppData = deepClone(appData);
  var previousSelectedHouseTemplateId = selectedHouseTemplateId;
  var previousEditHouseTemplateId = editHouseTemplateId;
  var template = editHouseTemplateId ? getHouseTemplateById(editHouseTemplateId) : null;
  if (!template) {
    template = { id: editHouseTemplateId || uid(), name: '', description: '', floors: [] };
  }
  var existingFloors = template.floors || [];
  var savedFloors = [];
  template.name = name;
  template.description = ge('ht_desc').value.trim();

  ge('ht_floors_container').querySelectorAll('.ht-floor-box').forEach(function(floorEl) {
    var floorId = floorEl.id.replace('ht_floor_', '');
    var floor = null;
    for (var floorIndex = 0; floorIndex < existingFloors.length; floorIndex++) {
      if (existingFloors[floorIndex].id === floorId) {
        floor = existingFloors[floorIndex];
        break;
      }
    }
    if (!floor) floor = { id: floorId, name: '', rooms: [] };
    var existingRooms = floor.rooms || [];
    var savedRooms = [];
    floor.name = floorEl.querySelector('.ht-floor-name').value.trim() || 'دور غير مسمى';
    floorEl.querySelectorAll('.ht-room-box').forEach(function(roomEl) {
      var roomId = roomEl.getAttribute('data-room-id');
      if (!roomId) {
        roomId = uid();
        roomEl.setAttribute('data-room-id', roomId);
      }
      var room = null;
      for (var roomIndex = 0; roomIndex < existingRooms.length; roomIndex++) {
        if (existingRooms[roomIndex].id === roomId) {
          room = existingRooms[roomIndex];
          break;
        }
      }
      if (!room) {
        room = { id: roomId, number: '', beds: 1, extraBeds: 0, notes: '', guests: [], children: [], closed: false, closedDay: null };
      }
      room.number = roomEl.querySelector('.ht-room-number').value.trim();
      room.beds = parseInt(roomEl.querySelector('.ht-room-beds').value, 10) || 1;
      room.notes = roomEl.querySelector('.ht-room-notes').value.trim();
      if (room.number) { // Only save rooms that have a number
        savedRooms.push(room);
      }
    });
    floor.rooms = savedRooms;
    savedFloors.push(floor);
  });
  template.floors = savedFloors;

  if (editHouseTemplateId) {
    var index = -1;
    var templates = appData.houseTemplates || [];
    for (var i = 0; i < templates.length; i++) {
      if (templates[i].id === editHouseTemplateId) {
        index = i;
        break;
      }
    }
    if (index !== -1) appData.houseTemplates[index] = template;
  } else {
    appData.houseTemplates.push(template);
  }
    if(window.OrganizationTemplateSync&&typeof window.OrganizationTemplateSync.scopeTemplate==='function'){
      window.OrganizationTemplateSync.scopeTemplate(template);
    }
    selectedHouseTemplateId = template.id;
  if(!saveTemplateOnly({houseTemplateId:template.id})){
    appData = previousAppData;
    selectedHouseTemplateId = previousSelectedHouseTemplateId;
    editHouseTemplateId = previousEditHouseTemplateId;
    return false;
  }
  closeHouseTemplateEditor();
  renderSettings();
  showToast('✅ تم حفظ خريطة البيت بنجاح');
}

function deleteHouseTemplate(id) {
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deleteHouseTemplate',null))return false;
  if(!window.HouseTemplateContentAuthorization.requireEdit(id))return false;
  var target = null;
  (appData.houseTemplates || []).forEach(function(ht){ if (!target && ht.id === id) target = ht; });
  if (!target) return;
  if (!confirm('حذف خريطة البيت "' + (target.name || 'بيت غير مسمى') + '"؟ يمكن استعادتها من سلة المحذوفات.')) return;
  var previousAppData = deepClone(appData);
  var previousSelectedHouseTemplateId = selectedHouseTemplateId;
  var previousEditHouseTemplateId = editHouseTemplateId;
  pushTrashItem('houseTemplates', target);
  appData.houseTemplates = removeByIdFromArray(appData.houseTemplates, id);
  if (selectedHouseTemplateId === id) {
    selectedHouseTemplateId = appData.houseTemplates.length ? appData.houseTemplates[0].id : null;
  }
  if(!saveTemplateOnly({houseTemplateId:id})){
    appData = previousAppData;
    selectedHouseTemplateId = previousSelectedHouseTemplateId;
    editHouseTemplateId = previousEditHouseTemplateId;
    return false;
  }
  renderSettings();
  showToast('🗑️ تم نقل خريطة البيت إلى سلة المحذوفات', '#E74C3C');
}

function duplicateHouseTemplate(id) {
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('duplicateHouseTemplate',null))return false;
  if(!window.HouseTemplateContentAuthorization||
    typeof window.HouseTemplateContentAuthorization.requireCopy!=='function'||
    !window.HouseTemplateContentAuthorization.requireCopy(id))return false;
  var original = null;
  var templates = appData.houseTemplates || [];
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === id) {
      original = templates[i]; break;
    }
  }
  if (!original) return;
  var newTemplate = {
    id: uid(),
    name: (original.name || 'بيت غير مسمى') + ' (نسخة)',
    description: original.description || '',
    floors: []
  };
  (original.floors || []).forEach(function(floor) {
    var newFloor = { id: uid(), name: floor.name || 'دور غير مسمى', rooms: [] };
    (floor.rooms || []).forEach(function(room) {
      newFloor.rooms.push({
        id: uid(),
        number: room.number || '',
        beds: typeof room.beds === 'number' ? room.beds : (parseInt(room.beds, 10) || 1),
        extraBeds: typeof room.extraBeds === 'number' ? room.extraBeds : (parseInt(room.extraBeds, 10) || 0),
        notes: room.notes || '',
        guests: [],
        children: [],
        closed: !!room.closed,
        closedDay: room.closedDay === undefined ? null : room.closedDay
      });
    });
    newTemplate.floors.push(newFloor);
  });
  appData.houseTemplates.push(newTemplate);
  selectedHouseTemplateId = newTemplate.id;
  if(!saveTemplateOnly())return false;
  renderSettings();
  showToast('✅ تم نسخ الخريطة');
}

var editHouseTemplateId = null;
function openHouseTemplateEditor(id) {
  if(id&&!window.HouseTemplateContentAuthorization.requireEdit(id))return false;
  editHouseTemplateId = id;
  selectedHouseTemplateId = id || selectedHouseTemplateId;
  var template = null;
  if (id) {
    template = getHouseTemplateById(id);
  }
  ge('ht_title').textContent = template ? '🏠 تعديل خريطة البيت' : '🏠 إنشاء خريطة بيت جديدة';
  ge('ht_name').value = template ? template.name : '';
  ge('ht_desc').value = template ? template.description : '';
  ht_renderTemplate(template);
  ge('houseTemplateModal').style.display = 'flex';
}

function closeHouseTemplateEditor() {
  ge('houseTemplateModal').style.display = 'none';
  editHouseTemplateId = null;
}

function openNativeDatePicker(input){
  if (!input || input.disabled || input.readOnly) return;
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
    } catch (e) {}
  }
}

function formatConferenceScheduleDate(value){
  var parts=String(value||'').split('-');
  return parts.length===3?parts[2]+'/'+parts[1]+'/'+parts[0]:String(value||'');
}

function updateConferencePeriodPreview(){
  var preview=ge('conferencePeriodPreview');
  var daysInput=ge('cfg_days');
  var startDate=ge('cfg_start')?ge('cfg_start').value:'';
  var endDate=ge('cfg_end')?ge('cfg_end').value:'';
  if(!preview)return;
  if(!startDate&&!endDate){
    preview.style.color='#5A7A9A';
    preview.textContent='حدد تاريخ البداية والنهاية لحساب مدة المؤتمر تلقائيًا.';
    return;
  }
  if(!startDate||!endDate){
    preview.style.color='#C0392B';
    preview.textContent='يرجى إدخال تاريخ البداية وتاريخ النهاية.';
    return;
  }
  var period=calculateConferencePeriod(startDate,endDate);
  if(!period.valid){
    preview.style.color='#C0392B';
    preview.textContent=period.error==='end_before_start'
      ?'تاريخ نهاية المؤتمر يجب ألا يسبق تاريخ البداية.'
      :'أحد تاريخي المؤتمر غير صالح.';
    return;
  }
  if(daysInput)daysInput.value=period.days;
  var schedule=buildConferenceSchedule(startDate,endDate);
  preview.style.color='#1F4E79';
  preview.innerHTML='<div style="font-weight:800;margin-bottom:5px">مدة المؤتمر: '+period.days+' أيام — '+period.nights+' ليالٍ</div>'+
    '<div>'+schedule.map(function(item){
      return 'اليوم '+item.dayNumber+': '+formatConferenceScheduleDate(item.date);
    }).join(' | ')+'</div>';
}

var conferenceOrganizationOptions=[];
function isConferenceOrganizationUuid(value){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value||''));
}

function renderConferenceOrganizationOptions(selectedId){
  var field=ge('conferenceOrganizationField');
  var select=ge('cfg_organization');
  var message=ge('conferenceOrganizationMessage');
  if(!field||!select)return;
  field.style.display=conferenceDialogMode==='create'?'':'none';
  if(conferenceDialogMode!=='create')return;
  var selected=String(selectedId||'');
  select.innerHTML='<option value="">اختر المؤسسة</option>'+conferenceOrganizationOptions.map(function(item){
    return '<option value="'+esc(item.organizationId)+'"'+
      (item.organizationId===selected?' selected':'')+'>'+esc(item.displayName||item.organizationId)+'</option>';
  }).join('');
  select.disabled=!conferenceOrganizationOptions.length;
  if(message)message.textContent=!conferenceOrganizationOptions.length
    ?'لا توجد مؤسسة نشطة متاحة لهذا الحساب.'
    :conferenceOrganizationOptions.length>1&&!selected
      ?'يجب اختيار مؤسسة قبل إنشاء المؤتمر.'
      :'';
}

function loadConferenceOrganizationOptions(){
  conferenceOrganizationOptions=[];
  renderConferenceOrganizationOptions('');
  if(conferenceDialogMode!=='create'||!window.OrganizationManagementService||
    typeof window.OrganizationManagementService.list!=='function')return Promise.resolve([]);
  return window.OrganizationManagementService.list().then(function(response){
    var organizations=response&&response.ok&&response.data&&
      Array.isArray(response.data.organizations)?response.data.organizations:[];
    conferenceOrganizationOptions=organizations.filter(function(item){
      return item&&item.status==='active'&&isConferenceOrganizationUuid(item.organizationId);
    }).map(function(item){
      return {organizationId:String(item.organizationId),displayName:String(item.displayName||'')};
    });
    var selectedId='';
    var organizationState=window.OrganizationManagementUI&&
      typeof window.OrganizationManagementUI.getState==='function'
      ?window.OrganizationManagementUI.getState():null;
    if(organizationState&&conferenceOrganizationOptions.some(function(item){
      return item.organizationId===organizationState.selectedId;
    }))selectedId=organizationState.selectedId;
    else if(conferenceOrganizationOptions.length===1){
      selectedId=conferenceOrganizationOptions[0].organizationId;
    }
    renderConferenceOrganizationOptions(selectedId);
    return conferenceOrganizationOptions.slice();
  }).catch(function(){
    conferenceOrganizationOptions=[];
    renderConferenceOrganizationOptions('');
    return [];
  });
}

function createConferenceFromSelection(){
  if(conferenceDialogMode!=='edit'&&
    !systemAccessAllowsConferenceCreation())return false;
  var name = (ge('cfg_name') ? ge('cfg_name').value.trim() : '') || 'المؤتمر';
  var startDate = ge('cfg_start') ? ge('cfg_start').value : '';
  var endDate = ge('cfg_end') ? ge('cfg_end').value : '';
  var days = parseInt(ge('cfg_days') ? ge('cfg_days').value : 1, 10) || 1;
  var place = ge('cfg_place') ? ge('cfg_place').value.trim() : '';
  var period=null;
  if(startDate||endDate){
    if(!startDate||!endDate){
      alert('يرجى إدخال تاريخ البداية وتاريخ النهاية.');
      return;
    }
    period=calculateConferencePeriod(startDate,endDate);
    if(!period.valid){
      alert(period.error==='end_before_start'
        ?'تاريخ نهاية المؤتمر يجب ألا يسبق تاريخ البداية.'
        :'أحد تاريخي المؤتمر غير صالح.');
      return;
    }
    days=period.days;
  }
  var nights=period?period.nights:Math.max(0,days-1);
  var schedule=period?buildConferenceSchedule(startDate,endDate):[];

  if (conferenceDialogMode === 'edit') {
    var current = getCurrentConference();
    if (!current) return;
    current.conf = current.conf || {};
    current.conf.name = name;
    current.conf.startDate = startDate;
    current.conf.endDate = endDate;
    current.conf.days = days;
    current.conf.nights = nights;
    current.conf.schedule = schedule;
    current.conf.place = place;
    current.name = name;
    current.startDate = startDate;
    current.endDate = endDate;
    current.days = days;
    current.nights = nights;
    current.schedule = schedule;
    syncConferencePeriod(current);
    addActivityLog('conference_updated','تم تعديل بيانات المؤتمر',{section:'conference',entityType:'conference',entityId:current.id});
    closeNewConferenceModal();
    renderSettings();
    renderTab(currentTab);
    showToast('✅ تم تحديث بيانات المؤتمر');
    return;
  }

  var organizationId=String(ge('cfg_organization')&&ge('cfg_organization').value||'');
  if(!isConferenceOrganizationUuid(organizationId)||
    !conferenceOrganizationOptions.some(function(item){return item.organizationId===organizationId;})){
    alert('يجب اختيار مؤسسة قبل إنشاء المؤتمر.');
    return false;
  }

  var now = new Date().toISOString();
  var newConf = {
    id: uid(),
    organizationId: organizationId,
    name: name,
    startDate: startDate,
    endDate: endDate,
    days: days,
    nights: nights,
    schedule: schedule,
    conf: { name: name, startDate: startDate, endDate: endDate, days: days, nights: nights, schedule: schedule, place: place },
    houses: [],
    accommodationDisplayedRoomIds: [],
    accommodationDisplayStateInitialized: true,
    transports: [],
    restaurant: createDefaultRestaurant(),
    restaurantV3: createDefaultRestaurantV3(),
    peopleDb: { version: '1.0.0', people: [] },
    skipPeopleMigration: true,
    status: 'active',
    completedAt: null,
    createdAt: now,
    updatedAt: now
    ,activityLog: []
  };
  normalizeConference(newConf);
  try{
    if(!window.ConferenceRepository||
      typeof window.ConferenceRepository.addLocalConference!=='function'){
      throw new Error('CONFERENCE_REPOSITORY_UNAVAILABLE');
    }
    var added=window.ConferenceRepository.addLocalConference(
      appData,newConf
    );
    if(!added||added.ok!==true){
      var repositoryError=new Error(
        'ConferenceRepository.addLocalConference failed: '+
        String(added&&added.status||'UNKNOWN_RESULT')
      );
      repositoryError.name='LocalConferenceCreationError';
      repositoryError.cause=added||{
        status:'undefined_repository_result'
      };
      throw repositoryError;
    }
    appData=added.data;
  }catch(error){
    showToast('تعذر إنشاء المؤتمر المحلي بأمان.','#C0392B');
    return;
  }
  setCurrentConferenceById(newConf.id, { skipToast: true });
  addActivityLog('conference_created','تم إنشاء مؤتمر جديد',{section:'conference',entityType:'conference',entityId:newConf.id});
  closeNewConferenceModal();
  showToast('✅ تم إنشاء مؤتمر جديد');
}

function collectConferenceSelection(){
  var selected = [];
  var templates = appData.houseTemplates || [];
  templates.forEach(function(house) {
    var houseBox = ge('nc_house_' + house.id);
    if (!houseBox || !houseBox.checked) return;
    var cloned = deepClone(house);
    normalizeHouseStructure(cloned);
    var houseSelection = conferenceDraft && conferenceDraft.houses ? conferenceDraft.houses[house.id] : null;
    var roomsByFloor = houseSelection && houseSelection.rooms ? houseSelection.rooms : {};
    var filteredFloors = [];
    (cloned.floors || []).forEach(function(floor) {
      var selectedRooms = [];
      (floor.rooms || []).forEach(function(room) {
        if (roomsByFloor[room.id]) {
          selectedRooms.push(room);
        }
      });
      if (selectedRooms.length) {
        floor.rooms = selectedRooms;
        filteredFloors.push(floor);
      }
    });
    if (filteredFloors.length) {
      cloned.floors = filteredFloors;
      selected.push(cloned);
    }
  });
  return selected;
}

function systemAccessAllowsConferenceCreation(){
  if(!window.SupabaseAuth||typeof window.SupabaseAuth.getState!=='function'){
    return true;
  }
  var authState=window.SupabaseAuth.getState();
  if(!authState||!authState.authenticated)return true;
  if(!window.SystemAccessService||
    typeof window.SystemAccessService.getState!=='function'||
    typeof window.SystemAccessService.canCreateConference!=='function'){
    alert('تعذر التحقق حديثًا من صلاحية إنشاء المؤتمرات.');
    return false;
  }
  var access=window.SystemAccessService.getState();
  if(!access.profileLoaded||!access.fresh){
    alert('تعذر التحقق حديثًا من صلاحية إنشاء المؤتمرات.');
    return false;
  }
  if(access.accountStatus==='pending'){
    alert('الحساب ينتظر الاعتماد.');
    return false;
  }
  if(access.accountStatus==='blocked'){
    alert('الحساب موقوف.');
    return false;
  }
  if(!window.SystemAccessService.canCreateConference()){
    alert('هذا الحساب غير مخول بإنشاء مؤتمرات جديدة.');
    return false;
  }
  return true;
}

function openNewConferenceModal(mode){
  if(window.StartupAccessGate&&!window.StartupAccessGate.isAllowed())return false;
  if(mode!=='edit'&&!systemAccessAllowsConferenceCreation())return false;
  conferenceDraft = null;
  conferenceDialogMode = (mode === 'edit') ? 'edit' : 'create';
  var current = getCurrentConference();
  var conf = (conferenceDialogMode === 'edit' && current) ? (current.conf || {}) : {};

  ge('nc_modal_title').textContent = conferenceDialogMode === 'edit' ? '✏️ تعديل المؤتمر' : '➕ مؤتمر جديد';
  ge('nc_save_btn').textContent = conferenceDialogMode === 'edit' ? '💾 حفظ التعديلات' : '💾 إنشاء المؤتمر';
  ge('cfg_name').value = conf.name || '';
  ge('cfg_days').value = conf.days || 1;
  ge('cfg_place').value = conf.place || '';
  ge('cfg_start').value = conf.startDate || '';
  ge('cfg_end').value = conf.endDate || '';

  ge('newConferenceModal').style.display = 'flex';
  updateConferencePeriodPreview();
  if(conferenceDialogMode==='create')loadConferenceOrganizationOptions();
  else renderConferenceOrganizationOptions('');
  return true;
}

function closeNewConferenceModal(){
  ge('newConferenceModal').style.display = 'none';
  conferenceDraft = null;
  conferenceDialogMode = 'create';
  conferenceOrganizationOptions=[];
}

function editCurrentConference(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('editCurrentConference',null))return false;
  openNewConferenceModal('edit');
}

function openConferenceHouseSelector(){
  openNewConferenceModal('edit');
  var houseSel = ge('cfg_house_template');
  if (houseSel) houseSel.focus();
}

function renderNewConferenceModal(){
  var container = ge('nc_houses_container');
  if (!container) return;
  var templates = appData.houseTemplates || [];
  var h = '';
  if (!templates.length) {
    h = '<div style="text-align:center;padding:20px;color:#95a5a6;">لا توجد بيوت محفوظة بعد</div>';
    container.innerHTML = h;
    return;
  }
  templates.forEach(function(house) {
    normalizeHouseStructure(house);
    if (!conferenceDraft.houses[house.id]) {
      conferenceDraft.houses[house.id] = { selected: false, rooms: {} };
    }
    var state = conferenceDraft.houses[house.id];
    h += '<div style="border:1px solid #EEF3F8;border-radius:10px;padding:8px;margin-bottom:8px;background:#fff">';
    h += '<label style="display:flex;align-items:center;gap:6px;font-weight:700;color:#1F4E79;margin-bottom:8px"><input type="checkbox" id="nc_house_'+house.id+'" '+(state.selected ? 'checked' : '')+' onchange="toggleConferenceHouse(\''+house.id+'\', this.checked)" style="width:auto"> '+esc(house.name || 'بيت غير مسمى')+'</label>';
    h += '<div style="padding-right:18px">';
    (house.floors || []).forEach(function(floor) {
      h += '<div style="margin-bottom:6px">';
      h += '<div style="font-size:11px;font-weight:700;color:#5a7a9a;margin-bottom:4px">'+esc(floor.name || 'دور غير مسمى')+'</div>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      (floor.rooms || []).forEach(function(room) {
        var checked = !!state.rooms[room.id];
        h += '<label style="display:flex;align-items:center;gap:4px;font-size:10px;background:'+(checked?'#D5F5E3':'#F7FBFF')+';border:1px solid '+(checked?'#27AE60':'#E3EEF9')+';border-radius:6px;padding:3px 6px">';
        h += '<input type="checkbox" '+(checked ? 'checked' : '')+' onchange="toggleConferenceRoom(\''+house.id+'\', \'" + floor.id + "\', \'" + room.id + "\', this.checked)" style="width:auto">';
        h += 'غرفة '+esc(room.number || '')+'';
        h += '</label>';
      });
      h += '</div></div>';
    });
    h += '</div></div>';
  });
  container.innerHTML = h;
}

function toggleConferenceHouse(houseId, checked){
  if (!conferenceDraft || !conferenceDraft.houses[houseId]) return;
  conferenceDraft.houses[houseId].selected = checked;
  var house = getHouseTemplateById(houseId);
  if (house) {
    (house.floors || []).forEach(function(floor) {
      (floor.rooms || []).forEach(function(room) {
        conferenceDraft.houses[houseId].rooms[room.id] = checked;
      });
    });
  }
  renderNewConferenceModal();
}

function toggleConferenceRoom(houseId, floorId, roomId, checked){
  if (!conferenceDraft) return;
  if (!conferenceDraft.houses[houseId]) conferenceDraft.houses[houseId] = { selected: false, rooms: {} };
  conferenceDraft.houses[houseId].rooms[roomId] = checked;
  if (checked) conferenceDraft.houses[houseId].selected = true;
  renderNewConferenceModal();
}

function createNewConference(){
  return openNewConferenceModal('create');
}

function openImportHouseModal() {
  var container = ge('ih_list_container');
  importHouseDialog.templateId = null;
  importHouseDialog.selectedRooms = {};
  renderImportHouseModal();
  ge('importHouseModal').style.display = 'flex';
}

function renderImportHouseModal() {
  var container = ge('ih_list_container');
  if (!container) return;
  var templates = appData.houseTemplates || [];
  if (!templates.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#95a5a6;">لا توجد خرائط بيوت في المكتبة.</div>';
    return;
  }
  if (!importHouseDialog.templateId) {
    var h = '<div style="margin-bottom:8px;color:#5a7a9a;font-size:11px">اختر بيتًا ثم اختر الغرف التي تريد استيرادها فقط.</div>';
    templates.forEach(function(ht) {
      h += '<div class="import-item" onclick="selectImportHouseTemplate(\'' + ht.id + '\')"><span>🏠 ' + esc(ht.name) + '</span><span>' + (ht.description ? ' - ' + esc(ht.description) : '') + '</span></div>';
    });
    container.innerHTML = h;
    return;
  }

  var template = null;
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === importHouseDialog.templateId) {
      template = templates[i];
      break;
    }
  }
  if (!template) {
    importHouseDialog.templateId = null;
    renderImportHouseModal();
    return;
  }

  var selectedCount = 0;
  var totalCount = 0;
  var h2 = '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">';
  h2 += '<button class="btn btn-gray btn-sm" onclick="backToImportHouseList()">← رجوع</button>';
  h2 += '<div style="font-size:11px;color:#5a7a9a;flex:1;min-width:160px">اختر غرفًا محددة من البيت: <b>' + esc(template.name || 'بيت غير مسمى') + '</b></div>';
  h2 += '</div>';
  h2 += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">';
  h2 += '<div style="font-size:10px;color:#7a8ea6">يمكنك إلغاء أي غرفة لا تريد استيرادها.</div>';
  h2 += '<div class="row" style="gap:6px;flex-wrap:wrap">';
  h2 += '<button class="btn btn-blue btn-sm" onclick="setAllImportRooms(true)">تحديد الكل</button>';
  h2 += '<button class="btn btn-gray btn-sm" onclick="setAllImportRooms(false)">إلغاء الكل</button>';
  h2 += '<button class="btn btn-green btn-sm" onclick="importHouseFromTemplate(\'' + template.id + '\')">استيراد المحدد</button>';
  h2 += '</div></div>';

  (template.floors || []).forEach(function(floor) {
    h2 += '<div style="border:1px solid #E5EEF7;border-radius:10px;padding:8px 10px;margin-bottom:10px;background:#FAFCFF">';
    h2 += '<div style="font-weight:700;color:#1F4E79;margin-bottom:6px">'+esc(floor.name || 'دور غير مسمى')+'</div>';
    if (floor.rooms && floor.rooms.length) {
      floor.rooms.forEach(function(room) {
        totalCount++;
        var key = floor.id + '::' + room.id;
        if (importHouseDialog.selectedRooms[key] === undefined) importHouseDialog.selectedRooms[key] = true;
        if (importHouseDialog.selectedRooms[key]) selectedCount++;
        h2 += '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #E5EEF7;border-radius:8px;margin-bottom:6px;background:' + (importHouseDialog.selectedRooms[key] ? '#EAF8EF' : '#fff') + ';cursor:pointer">';
        h2 += '<input type="checkbox" style="width:auto" ' + (importHouseDialog.selectedRooms[key] ? 'checked' : '') + ' onchange="toggleImportRoom(\'' + template.id + '\', \' ' + floor.id + '::' + room.id + '\', this.checked)">';
        h2 += '<div style="flex:1;min-width:0">';
        h2 += '<div style="font-weight:700">غرفة ' + esc(room.number || '') + '</div>';
        h2 += '<div style="font-size:10px;color:#7a8ea6">' + (parseInt(room.beds, 10) || 1) + ' أسرة' + (room.closed ? ' • مغلقة' : '') + '</div>';
        h2 += '</div>';
        h2 += '</label>';
      });
    } else {
      h2 += '<div style="color:#AAB5C0;font-size:11px;padding:4px 0">لا توجد غرف في هذا الدور</div>';
    }
    h2 += '</div>';
  });

  h2 += '<div style="font-size:10px;color:#5a7a9a;margin-top:6px">المحدد الآن: ' + selectedCount + ' من ' + totalCount + ' غرفة</div>';
  container.innerHTML = h2;
}

function selectImportHouseTemplate(templateId) {
  importHouseDialog.templateId = templateId;
  importHouseDialog.selectedRooms = {};
  renderImportHouseModal();
}

function backToImportHouseList() {
  importHouseDialog.templateId = null;
  importHouseDialog.selectedRooms = {};
  renderImportHouseModal();
}

function setAllImportRooms(checked) {
  var template = null;
  var templates = appData.houseTemplates || [];
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === importHouseDialog.templateId) {
      template = templates[i];
      break;
    }
  }
  if (!template) return;
  (template.floors || []).forEach(function(floor) {
    (floor.rooms || []).forEach(function(room) {
      importHouseDialog.selectedRooms[floor.id + '::' + room.id] = checked;
    });
  });
  renderImportHouseModal();
}

function toggleImportRoom(templateId, roomKey, checked) {
  if (templateId !== importHouseDialog.templateId) return;
  importHouseDialog.selectedRooms[roomKey.trim()] = checked;
  renderImportHouseModal();
}

function closeImportHouseModal() {
  ge('importHouseModal').style.display = 'none';
  importHouseDialog.templateId = null;
  importHouseDialog.selectedRooms = {};
}

function importHouseFromTemplate(templateId) {
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('importHouseFromTemplate',null))return false;
  if(!requireAccommodationMutation())return false;
  var template = null;
  var templates = appData.houseTemplates || [];
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === templateId) {
      template = templates[i]; break;
    }
  }
  if (!template) return;
  var selectedRooms = importHouseDialog.selectedRooms || {};
  var newHouse = cloneHouseTemplateToConference(template, { selectedRooms: selectedRooms });
  if (!newHouse.floors.length) {
    alert('اختر غرفة واحدة على الأقل قبل الاستيراد.');
    return;
  }
  var current = getCurrentConference();
  current.houses.push(newHouse);
  if(!save())return false;
  closeImportHouseModal();
  renderAccommodation();
  showToast('✅ تم استيراد الغرف المحددة');
}
// ═══════════════════════════════════════════════════════
// BULK ASSIGN
// ═══════════════════════════════════════════════════════
var bulkSelected = {}; // name -> true/false

function openBulkAssign(){
  bulkSelected = {};
  var current = getCurrentConference();
  var transports = (current && current.transports) || [];
  // populate transport select
  var sel = ge('bulk_trans');
  sel.innerHTML = '<option value="">— اختر —</option>';
  transports.forEach(function(t){
    var freeSeats = 0;
    (t.seats || []).forEach(function(s) {
      if (!s.name) freeSeats++;
    });
    var opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.icon + ' ' + t.name + ' (' + freeSeats + ' كرسي فارغ)';
    sel.appendChild(opt);
  });
  ge('bulk_guests').innerHTML = '<div style="color:#AAB5C0;text-align:center;padding:14px;font-size:11px">اختر وسيلة المواصلات أولاً</div>';
  ge('bulk_info').textContent = '';
  ge('bulk_count').textContent = '';
  ge('bulkModal').style.display = 'flex';
}
function closeBulk(){ ge('bulkModal').style.display = 'none'; }

function renderBulkGuests(){
  var current = getCurrentConference();
  var transports = current.transports || [];
  var tid = ge('bulk_trans').value;
  if(!tid){ ge('bulk_guests').innerHTML = ''; return; }
  var t = null;
  for (var i = 0; i < transports.length; i++) {
    if (transports[i].id === tid) { t = transports[i]; break; }
  }
  if(!t) return;

  var freeSeats = 0;
  (t.seats || []).forEach(function(s) {
    if (!s.name) freeSeats++;
  });

  var guests = unassigned(''); // all unassigned across all transports
  ge('bulk_info').textContent = 'كراسي فارغة: ' + freeSeats + ' | أفراد لم يُسكَّنوا: ' + guests.length;

  if(!guests.length){
    ge('bulk_guests').innerHTML = '<div style="color:#27AE60;text-align:center;padding:14px;font-size:11px">✅ كل الأفراد تم تسكينهم في مواصلات</div>';
    return;
  }
  // group by room
  var byRoom = {};
  guests.forEach(function(g){
    if(!byRoom[g.room]) byRoom[g.room] = [];
    byRoom[g.room].push(g);
  });
  var h = '';
  Object.keys(byRoom).sort().forEach(function(roomNum){
    h += '<div style="font-size:10px;font-weight:700;color:#1F4E79;margin:6px 0 3px;padding:3px 5px;background:#EAF4FC;border-radius:5px">🏨 غرفة ' + esc(roomNum) + '</div>';
    byRoom[roomNum].forEach(function(g){
      var checked = bulkSelected[g.name] !== false; // default selected
      if(bulkSelected[g.name] === undefined) bulkSelected[g.name] = true;
      h += '<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;margin-bottom:2px;background:'+(checked?'#D5F5E3':'#F8F9FA')+';border:1px solid '+(checked?'#27AE60':'#E0E0E0')+'" id="blbl_'+esc(g.name.replace(/\s/g,'_'))+'">';
      h += '<input type="checkbox" '+(checked?'checked':'')+' style="width:auto" onchange="toggleBulk(\''+esc(g.name)+'\',this.checked)">';
      h += '<span style="font-size:12px;font-weight:'+(checked?'700':'400')+'">'+(g.guardian?'🧒':'👤')+' '+esc(g.name)+'</span>';
      if(g.guardian) h += '<span style="font-size:9px;color:#7D4E00">مع '+esc(g.guardian)+'</span>';
      h += '</label>';
    });
  });
  ge('bulk_guests').innerHTML = h;
  updateBulkCount();
}

function toggleBulk(name, val){
  bulkSelected[name] = val;
  updateBulkCount();
}
function bulkSelectAll(val){
  Object.keys(bulkSelected).forEach(function(k){ bulkSelected[k] = val; });
  // re-render list preserving structure
  renderBulkGuests();
  // restore selection state
  Object.keys(bulkSelected).forEach(function(k){ bulkSelected[k] = val; });
  ge('bulk_guests').querySelectorAll('input[type="checkbox"]').forEach(function(cb){ cb.checked = val; });
  ge('bulk_guests').querySelectorAll('label').forEach(function(lbl){
    lbl.style.background = val ? '#D5F5E3' : '#F8F9FA';
    lbl.style.border = '1px solid ' + (val ? '#27AE60' : '#E0E0E0');
    var sp = lbl.querySelector('span');
    if(sp) sp.style.fontWeight = val ? '700' : '400';
  });
  updateBulkCount();
}
function updateBulkCount(){
  var n = Object.keys(bulkSelected).filter(function(k){ return bulkSelected[k]; }).length;
  ge('bulk_count').textContent = n + ' محدد';
}

function doBulkAssign(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('doBulkAssign',null))return false;
  var current = getCurrentConference();
  var transports = current.transports || [];
  var tid = ge('bulk_trans').value;
  if(!tid){ alert('اختر وسيلة مواصلات'); return; }
  var t = null;
  for (var i = 0; i < transports.length; i++) {
    if (transports[i].id === tid) { t = transports[i]; break; }
  }
  if(!t) return;
  var allUnassigned = unassigned('');
  var toAssign = [];
  for (var i = 0; i < allUnassigned.length; i++) {
    if (bulkSelected[allUnassigned[i].name]) {
      toAssign.push(allUnassigned[i]);
    }
  }
  if(!toAssign.length){ alert('لم تحدد أي أسماء'); return; }
  var freeSeats = []; (t.seats || []).forEach(function(s) { if (!s.name) freeSeats.push(s); });
  if(freeSeats.length < toAssign.length){
    if(!window.confirm('الكراسي الفارغة ('+freeSeats.length+') أقل من المحدد ('+toAssign.length+'). سيُسكَّن أول '+freeSeats.length+' فقط. تأكيد؟')) return;
    toAssign = toAssign.slice(0, freeSeats.length);
  }
  var assigned = 0;
  toAssign.forEach(function(g){
    var seat = freeSeats[assigned];
    if(!seat) return;
    seat.name = g.name;
    seat.room = g.room;
    seat.type = g.guardian ? 'child_seat' : 'adult';
    seat.note = '';
    assigned++;
  });
  if(!save())return false;
  closeBulk();
  renderTransports();
  showToast('⚡ تم تسكين ' + assigned + ' شخص تلقائياً', '#1F4E79');
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
//__S__
//__E__
function recordStartupStage(stage,status,errorCode){
  if(window.StartupAccessGate&&typeof window.StartupAccessGate.recordStage==='function'){
    window.StartupAccessGate.recordStage(stage,status,errorCode);
  }
}
function requireStartupResult(stage,result){
  if(result&&result.ok===false){
    recordStartupStage(stage,'failed',result.status||'STARTUP_STAGE_FAILED');
    var error=new Error(String(stage||'STARTUP_STAGE').toUpperCase()+'_FAILED');
    error.startupStage=stage;
    throw error;
  }
  return result;
}
function completeApplicationStartup(){
  if(!window.applicationStorageReadyPromise){
    recordStartupStage('storage','started');
    window.applicationStorageReadyPromise=Promise.resolve(initializeApplicationStorage()).then(function(){
      syncCurrentConferenceRefs();
      recordStartupStage('storage','completed');
      return true;
    }).catch(function(error){
      recordStartupStage('storage','failed',error&&error.message||'STORAGE_FAILED');
      throw error;
    });
  }
  return window.applicationStorageReadyPromise;
}
function restoreAuthorizedApplicationView(){
  recordStartupStage('view_restore','started');
  var authorization=window.ConferenceActivationAuthorization;
  var current=getCurrentConference();
  if(!current||!authorization||!authorization.canDisplay(current.id)){
    appData.currentConferenceId=null;
    showSelectConferenceModal();
    recordStartupStage('view_restore','completed','NO_AUTHORIZED_CONFERENCE');
    return true;
  }
  syncCurrentConferenceRefs();
  if(!getCurrentConference()){
    showSelectConferenceModal();
  }else if(getStoredApplicationView()==='startup'){
    openStartupScreen({clearCurrentConference:false,persistView:false});
  }else{
    setApplicationMode('application');
    restoreLastApplicationTab();
  }
  var body=ge('applicationBody'),startup=ge('startupScreen');
  if(!(body&&body.style.display!=='none'||startup&&startup.style.display!=='none')){
    recordStartupStage('view_restore','failed','APPLICATION_VIEW_NOT_VISIBLE');
    throw new Error('APPLICATION_VIEW_NOT_VISIBLE');
  }
  recordStartupStage('view_restore','completed');
  return true;
}
function traceRealtimeStartup(){
  recordStartupStage('realtime','started');
  var manager=window.ConferenceRealtimeManager;
  if(!manager||typeof manager.subscribe!=='function')return;
  if(typeof window.startupRealtimeTraceUnsubscribe==='function'){
    window.startupRealtimeTraceUnsubscribe();
  }
  window.startupRealtimeTraceUnsubscribe=manager.subscribe(function(state){
    if(!state)return;
    if(state.status==='subscribed'){
      recordStartupStage('realtime','subscribed');
    }else if(state.status==='error'){
      recordStartupStage('realtime','failed',state.lastError&&state.lastError.code||'REALTIME_FAILED');
    }else return;
    if(typeof window.startupRealtimeTraceUnsubscribe==='function'){
      window.startupRealtimeTraceUnsubscribe();
      window.startupRealtimeTraceUnsubscribe=null;
    }
  });
}
function completeAuthorizedApplicationStartup(){
  recordStartupStage('auth','passed');
  recordStartupStage('account','passed');
  recordStartupStage('device','passed');
  var cloudReviewPending=false;
  return Promise.resolve(completeApplicationStartup()).then(function(){
    try{
      cloudReviewPending=!!(window.FullBackupService&&typeof window.FullBackupService.isFullRestoreCloudReviewPending==='function'&&window.FullBackupService.isFullRestoreCloudReviewPending());
    }catch(error){
      cloudReviewPending=true;
    }
    if(cloudReviewPending){
      console.warn('تم إيقاف المزامنة مؤقتًا لحين مراجعة روابط النسخة المستعادة.');
      showPostRestoreCloudReviewBanner();
      setTimeout(showPostRestoreCloudReviewModal,0);
      recordStartupStage('discovery','skipped','CLOUD_REVIEW_PENDING');
      return;
    }
    recordStartupStage('discovery','started');
    var discovery=window.StartupConferenceDiscovery&&typeof window.StartupConferenceDiscovery.refresh==='function'
      ?window.StartupConferenceDiscovery.refresh():Promise.resolve({ok:true,status:'unavailable'});
    return Promise.resolve(discovery).then(function(result){requireStartupResult('discovery',result);recordStartupStage('discovery','completed');var authorization=window.ConferenceActivationAuthorization,openService=window.DiscoveredConferenceOpenService;return authorization.reconcileStartup({appData:appData,persistedCandidate:authorization.getPersistedCandidate(),discovered:result&&result.data&&result.data.conferences||[],links:window.ConferenceLinkStore,validateCloud:function(remoteId){return openService.validateAuthorization(remoteId);}}).then(function(decision){appData.currentConferenceId=decision&&decision.ok?decision.localConferenceId:null;return result;});}).catch(function(error){if(!(error&&error.startupStage))recordStartupStage('discovery','failed',error&&error.message||'DISCOVERY_FAILED');throw error;});
  }).then(function(){
    if(cloudReviewPending){recordStartupStage('linking','skipped','CLOUD_REVIEW_PENDING');return;}
    recordStartupStage('linking','started');
    var linking=window.AutomaticConferenceLinking&&typeof window.AutomaticConferenceLinking.initialize==='function'
      ?window.AutomaticConferenceLinking.initialize():{ok:true,status:'unavailable'};
    requireStartupResult('linking',linking);
    return Promise.resolve(linking&&linking.promise).then(function(result){requireStartupResult('linking',result);recordStartupStage('linking','completed');}).catch(function(error){if(!(error&&error.startupStage))recordStartupStage('linking','failed',error&&error.message||'LINKING_FAILED');throw error;});
  }).then(function(){
    if(cloudReviewPending){recordStartupStage('queue_recovery','skipped','CLOUD_REVIEW_PENDING');return;}
    recordStartupStage('queue_recovery','started');
    var recovery=window.StartupQueueRecovery&&typeof window.StartupQueueRecovery.run==='function'
      ?window.StartupQueueRecovery.run():Promise.resolve({ok:true,status:'unavailable'});
    return Promise.resolve(recovery).then(function(result){requireStartupResult('queue_recovery',result);recordStartupStage('queue_recovery','completed');}).catch(function(error){if(!(error&&error.startupStage))recordStartupStage('queue_recovery','failed',error&&error.message||'QUEUE_RECOVERY_FAILED');throw error;});
  }).then(function(){
    if(cloudReviewPending){recordStartupStage('orchestrator','skipped','CLOUD_REVIEW_PENDING');return restoreAuthorizedApplicationView();}
    recordStartupStage('orchestrator','started');
    return Promise.resolve().then(function(){
      var result=window.AutomaticSyncOrchestrator&&typeof window.AutomaticSyncOrchestrator.start==='function'
        ?window.AutomaticSyncOrchestrator.start():{ok:true,status:'unavailable'};
      requireStartupResult('orchestrator',result);
      recordStartupStage('orchestrator','completed');
    }).catch(function(error){if(!(error&&error.startupStage))recordStartupStage('orchestrator','failed',error&&error.message||'ORCHESTRATOR_FAILED');throw error;}).then(function(){traceRealtimeStartup();return restoreAuthorizedApplicationView();});
  });
}
window.applicationStorageReadyPromise=null;
if(window.StartupAccessGate&&typeof window.StartupAccessGate.run==='function'){
  window.StartupAccessGate.run({
    completeApplicationStartup:completeAuthorizedApplicationStartup
  });
}else{
  throw new Error('STARTUP_ACCESS_GATE_REQUIRED');
}
