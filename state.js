// ═══════════════════════════════════════════════════════

var appData = {
  version: '2.0.0',
  currentConferenceId: null,
  conferences: [],
  templates: [],
  archives: [],
  backups: [],
  houseTemplates: [],
  peopleDb: { version: '1.0.0', people: [] },

};

// UI and editing state
var currentTab=0,editRoomId=null,editTransId=null,editSeatTransId=null,editSeatNum=null,editHouseId=null;
var settingsTab='general';
var selectedHouseTemplateId=null;
var templateFloorDialog = { houseId: null, floorId: null };
var templateRoomDialog = { houseId: null, floorId: null, roomId: null };
var importHouseDialog = { templateId: null, selectedRooms: {} };
var conferenceDraft = null;
var conferenceDialogMode = 'create';
var CARDS_VIEW_MODE_KEY='conference_cards_view_mode';
var savedCardsMode=null;
try{savedCardsMode=localStorage.getItem(CARDS_VIEW_MODE_KEY)}catch(e){}
var cardMode=savedCardsMode==='room'?'room':'person',selectedCards={},cardsSelectionMode=false;
var DAYS;

// Constants
var SK='conf_v5';


// ═══════════════════════════════════════════════════════
// CORE STATE & PERSISTENCE FUNCTIONS
// ═══════════════════════════════════════════════════════

function notifyPersistenceFailure(message){
  try{
    if(typeof showToast==='function'){
      showToast(message,'#E74C3C');
      return;
    }
  }catch(notificationError){
    console.error('تعذر عرض رسالة فشل التخزين:',notificationError);
  }
  try{
    if(typeof alert==='function')alert(message);
  }catch(notificationError){}
}

function syncCurrentConferenceRefs(){
  var current = getCurrentConference();
  if(!current){
    return;
  }
  var conf = current.conf || {name: current.name || 'المؤتمر', startDate: current.startDate || '', endDate: current.endDate || '', days: current.days || 1};
  DAYS = conf.days || 1;
  updateLogoText();
}

function updateCurrentConferenceData(){
  var current = getCurrentConference();
  if(!current) return;
  var confObj = current.conf || {name: current.name || 'المؤتمر', startDate: current.startDate || '', endDate: current.endDate || '', days: current.days || 1};
  current.name = confObj.name || current.name || 'المؤتمر';
  current.startDate = confObj.startDate || current.startDate || '';
  current.endDate = confObj.endDate || current.endDate || '';
  current.days = confObj.days || current.days || 1;
  syncConferencePeriod(current);
  current.conf = {
    name: current.name,
    startDate: current.startDate,
    endDate: current.endDate,
    days: current.days,
    nights: current.nights,
    schedule: current.schedule,
    place: confObj.place || '',
    houseTemplateId: confObj.houseTemplateId || ''
  };
  // rooms, transports, restaurant are now directly part of the conference object.
  current.updatedAt = new Date().toISOString();
}

function save(){
  try{
    updateCurrentConferenceData();
    var json=JSON.stringify(appData);
    localStorage.setItem(SK,json);
    var b=ge('syncBar');if(b){b.textContent='✔ '+new Date().toLocaleTimeString('ar-EG');}
    if(window.AppIndexedDB&&typeof window.AppIndexedDB.saveAppSnapshot==='function'){
      window.AppIndexedDB.saveAppSnapshot(appData).catch(function(indexedDbError){
        console.warn('تعذر حفظ النسخة الاحتياطية في IndexedDB:',indexedDbError);
      });
    }
    return true;
  }catch(e){
    console.error('تعذر حفظ بيانات التطبيق:',e);
    notifyPersistenceFailure('تعذر حفظ البيانات على الجهاز. قد تكون مساحة التخزين ممتلئة. لم يتم تأكيد حفظ آخر تعديل.');
    return false;
  }
}

function getStorageUsageReport(){
  function measureBytes(value){
    var json;
    try{
      json=JSON.stringify(value);
    }catch(e){
      return 0;
    }
    if(typeof json!=='string')json='';
    try{
      if(typeof Blob==='function')return new Blob([json]).size;
    }catch(e){}
    return json.length*2;
  }

  function sizeEntry(value){
    var bytes=measureBytes(value);
    return {bytes:bytes,kb:Math.round((bytes/1024)*100)/100};
  }

  var conferences=Array.isArray(appData&&appData.conferences)?appData.conferences:[];
  var backups=Array.isArray(appData&&appData.backups)?appData.backups:[];
  var archives=Array.isArray(appData&&appData.archives)?appData.archives:[];
  var templates=Array.isArray(appData&&appData.templates)?appData.templates:[];
  var houseTemplates=Array.isArray(appData&&appData.houseTemplates)?appData.houseTemplates:[];
  var branding=conferences.map(function(conference){
    return conference&&conference.branding?conference.branding:null;
  });

  return {
    total:sizeEntry(appData),
    conferences:sizeEntry(conferences),
    backups:sizeEntry(backups),
    archives:sizeEntry(archives),
    trash:sizeEntry(appData&&appData.trash?appData.trash:{}),
    templates:sizeEntry(templates),
    houseTemplates:sizeEntry(houseTemplates),
    peopleDb:sizeEntry(appData&&appData.peopleDb?appData.peopleDb:{}),
    branding:sizeEntry(branding),
    backupsCount:backups.length,
    archivesCount:archives.length,
    templatesCount:templates.length,
    conferencesCount:conferences.length
  };
}

function logStorageUsageReport(){
  var report=getStorageUsageReport();
  var rows={};
  ['total','conferences','backups','archives','trash','templates','houseTemplates','peopleDb','branding'].forEach(function(section){
    rows[section]={bytes:report[section].bytes,kb:report[section].kb};
  });
  console.log('تقرير استخدام مساحة التخزين التقريبي');
  if(typeof console.table==='function')console.table(rows);
  else console.log(rows);
  console.log('الأعداد',{
    conferences:report.conferencesCount,
    backups:report.backupsCount,
    archives:report.archivesCount,
    templates:report.templatesCount
  });
  return report;
}

function load(){
  var previousAppData=appData;
  try{
    var r=localStorage.getItem(SK);
    if(r){
      var d=JSON.parse(r);
      var loadedAppData=null;
      if(d&&typeof d==='object'&&!Array.isArray(d)&&d.appData) loadedAppData=d.appData;
      else if(d&&typeof d==='object'&&!Array.isArray(d)&&Array.isArray(d.conferences)) loadedAppData=d;
      else if(d&&typeof d==='object'&&!Array.isArray(d)) loadedAppData=buildAppDataFromLegacy(d);
      if(!loadedAppData||typeof loadedAppData!=='object'||Array.isArray(loadedAppData)||!Array.isArray(loadedAppData.conferences)){
        throw new Error('INVALID_STORED_APP_DATA');
      }
      appData=loadedAppData;
      normalizeAppData();
      updateLogoText();
      var current = getCurrentConference();
      if(current) setCurrentConference(current);
    } else {
      normalizeAppData();
    }
    return true;
  }catch(e){
    appData=previousAppData;
    console.error('تعذر قراءة بيانات التطبيق المحفوظة:',e);
    notifyPersistenceFailure('تعذر قراءة البيانات المحفوظة على الجهاز. سيتم تجاهل البيانات التالفة والاستمرار بأمان.');
    return false;
  }
}
