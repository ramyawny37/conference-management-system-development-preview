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
var applicationStorageState = {
  storageReady: false,
  loadedSource: null,
  lastLocalSaveAt: null,
  lastIndexedDbSaveAt: null,
  lastStorageError: null
};
var storageInitializationPromise = null;
var applicationSelectionRestored = false;


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

function cloneApplicationStorageData(value){
  if(typeof window.structuredClone==='function'){
    return window.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isValidStoredAppData(value){
  return !!(value&&typeof value==='object'&&!Array.isArray(value)&&
    Array.isArray(value.conferences));
}

function readLocalStorageAppData(){
  var raw=localStorage.getItem(SK);
  if(!raw)return null;
  var parsed=JSON.parse(raw);
  var loadedAppData=null;
  if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&parsed.appData){
    loadedAppData=parsed.appData;
  }else if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
    Array.isArray(parsed.conferences)){
    loadedAppData=parsed;
  }else if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
    loadedAppData=buildAppDataFromLegacy(parsed);
  }
  return isValidStoredAppData(loadedAppData)?loadedAppData:null;
}

function restoreSafeSingleCurrentConferenceSelection(target){
  if(!target||!Array.isArray(target.conferences)||target.currentConferenceId){
    return false;
  }
  var candidates=target.conferences.filter(function(conference){
    return conference&&conference.status==='active'&&
      !(typeof isConferenceImportRecoveryPending==='function'&&
        isConferenceImportRecoveryPending(target,conference.id));
  });
  if(candidates.length!==1)return false;
  var candidate=candidates[0];
  var backup=window.FullBackupService;
  try{
    if(backup&&typeof backup.isFullRestoreCloudReviewPending==='function'&&
      backup.isFullRestoreCloudReviewPending()===true)return false;
    if(backup&&typeof backup.isManualRelinkRequired==='function'&&
      backup.isManualRelinkRequired(candidate.id)===true)return false;
  }catch(error){return false;}
  var links=window.ConferenceLinkStore;
  var link=links&&typeof links.get==='function'?links.get(candidate.id):null;
  if(link&&(
    ['needs_resolution','server_selected_pending_local_apply']
      .indexOf(String(link.linkStatus||''))>=0||
    link.pendingLocalApplication===true||link.conflictId||
    link.syncState&&link.syncState.pendingRemoteApplication===true
  ))return false;
  target.currentConferenceId=candidate.id;
  return true;
}

function initializeApplicationStorage(){
  if(storageInitializationPromise)return storageInitializationPromise;

  var defaults=cloneApplicationStorageData(appData);
  var repository=window.StorageRepository;
  var indexedDbApi=window.AppIndexedDB;
  var deviceApproval=window.DeviceReauthorizationFlow&&
    typeof window.DeviceReauthorizationFlow.waitUntilApproved==='function'
    ?window.DeviceReauthorizationFlow.waitUntilApproved()
    :Promise.resolve();
  storageInitializationPromise=Promise.resolve(deviceApproval)
    .then(function(){
      if(!repository||typeof repository.getAppSnapshot!=='function'){
        throw new Error('INDEXEDDB_REPOSITORY_UNAVAILABLE');
      }
      return repository.getAppSnapshot();
    })
    .then(function(snapshot){
      var validation=indexedDbApi&&typeof indexedDbApi.validateAppSnapshot==='function'
        ?indexedDbApi.validateAppSnapshot(snapshot)
        :{valid:false,reason:'SNAPSHOT_VALIDATOR_UNAVAILABLE'};
      return validation.valid
        ?{source:'indexeddb',data:snapshot.data,savedAt:snapshot.savedAt||null}
        :null;
    })
    .catch(function(error){
      applicationStorageState.lastStorageError=error;
      console.warn('تعذر قراءة بيانات IndexedDB:',error);
      return null;
    })
    .then(function(selection){
      if(selection)return selection;
      try{
        var localData=readLocalStorageAppData();
        if(localData)return {source:'localStorage',data:localData};
      }catch(error){
        applicationStorageState.lastStorageError=error;
        console.warn('تعذر قراءة بيانات localStorage:',error);
      }
      return {source:'defaults',data:defaults};
    })
    .then(function(selection){
      appData=cloneApplicationStorageData(selection.data);
      normalizeAppData();
      applicationSelectionRestored=
        restoreSafeSingleCurrentConferenceSelection(appData);
      updateLogoText();
      var current=getCurrentConference();
      if(current)setCurrentConference(current);

      try{
        localStorage.setItem(SK,JSON.stringify(appData));
        applicationStorageState.lastLocalSaveAt=new Date().toISOString();
      }catch(error){
        applicationStorageState.lastStorageError=error;
        console.warn('تعذر تحديث بيانات localStorage:',error);
      }

      if(selection.source==='indexeddb'&&!applicationSelectionRestored||
        !repository||
        typeof repository.saveAppSnapshot!=='function'){
        return selection;
      }
      return repository.saveAppSnapshot(appData,{skipSyncQueue:true})
        .then(function(){
          applicationStorageState.lastIndexedDbSaveAt=new Date().toISOString();
          return selection;
        })
        .catch(function(error){
          applicationStorageState.lastStorageError=error;
          console.warn('تعذر حفظ Snapshot في IndexedDB:',error);
          return selection;
        });
    })
    .then(function(selection){
      applicationStorageState.storageReady=true;
      applicationStorageState.loadedSource=selection.source;
      if(selection.source==='indexeddb'&&selection.savedAt){
        applicationStorageState.lastIndexedDbSaveAt=selection.savedAt;
      }
      return appData;
    });

  return storageInitializationPromise;
}

function save(options){
  options=options||{};
  var json;
  try{
    if(!options.skipCurrentConferenceUpdate)updateCurrentConferenceData();
    var currentConference=options.skipConferenceTracking
      ?null:getCurrentConference();
    if(currentConference&&
      window.ConferenceRepository&&
      typeof window.ConferenceRepository.recordLocalChange==='function'){
      var tracked=window.ConferenceRepository.recordLocalChange(
        appData,currentConference.id
      );
      if(tracked&&tracked.ok)appData=tracked.data;
    }
    json=JSON.stringify(appData);
  }catch(e){
    console.error('تعذر حفظ بيانات التطبيق:',e);
    notifyPersistenceFailure('تعذر حفظ البيانات على الجهاز. قد تكون مساحة التخزين ممتلئة. لم يتم تأكيد حفظ آخر تعديل.');
    return false;
  }
  if(window.StorageRepository&&
    typeof window.StorageRepository.saveAppSnapshot==='function'){
    window.StorageRepository.saveAppSnapshot(
      appData,
      options.skipSyncQueue===true?{skipSyncQueue:true}:undefined
    )
      .then(function(){
        applicationStorageState.lastIndexedDbSaveAt=new Date().toISOString();
      })
      .catch(function(indexedDbError){
        applicationStorageState.lastStorageError=indexedDbError;
        console.warn('تعذر حفظ النسخة الاحتياطية في IndexedDB:',indexedDbError);
      });
  }
  try{
    localStorage.setItem(SK,json);
    applicationStorageState.lastLocalSaveAt=new Date().toISOString();
    var b=ge('syncBar');if(b){b.textContent='✔ '+new Date().toLocaleTimeString('ar-EG');}
  }catch(e){
    applicationStorageState.lastStorageError=e;
    console.error('تعذر حفظ بيانات التطبيق:',e);
    notifyPersistenceFailure('تعذر حفظ البيانات على الجهاز. قد تكون مساحة التخزين ممتلئة. لم يتم تأكيد حفظ آخر تعديل.');
  }
  return true;
}

function saveCurrentConferenceSelection(){
  var json;
  try{
    json=JSON.stringify(appData);
  }catch(e){
    applicationStorageState.lastStorageError=e;
    return false;
  }
  if(window.StorageRepository&&
    typeof window.StorageRepository.saveAppSnapshot==='function'){
    window.StorageRepository.saveAppSnapshot(appData,{skipSyncQueue:true})
      .then(function(){
        applicationStorageState.lastIndexedDbSaveAt=new Date().toISOString();
      })
      .catch(function(indexedDbError){
        applicationStorageState.lastStorageError=indexedDbError;
      });
  }
  try{
    localStorage.setItem(SK,json);
    applicationStorageState.lastLocalSaveAt=new Date().toISOString();
  }catch(e){
    applicationStorageState.lastStorageError=e;
    return false;
  }
  return true;
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
