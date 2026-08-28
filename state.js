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
var accommodationSearchQuery='';
var accommodationQuickFilter='all';
var accommodationCollapsedFloors={};
var settingsTab='general';
var selectedHouseTemplateId=null;
var templateFloorDialog = { houseId: null, floorId: null };
var templateRoomDialog = { houseId: null, floorId: null, roomId: null };
var importHouseDialog = { templateId: null, selectedRooms: {} };
var conferenceDraft = null;
var conferenceDialogMode = 'create';
var browserStorageNamespace=window.BrowserStorageNamespace||{
  key:function(name){return name;}
};
var CARDS_VIEW_MODE_KEY=browserStorageNamespace.key(
  'conference_cards_view_mode'
);
var savedCardsMode=null;
try{savedCardsMode=localStorage.getItem(CARDS_VIEW_MODE_KEY)}catch(e){}
var cardMode=savedCardsMode==='room'?'room':'person',selectedCards={},cardsSelectionMode=false;
var DAYS;

// Constants
var SK=browserStorageNamespace.key('conf_v5');
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
  // A local record is not authorization. Sole-conference restoration remains
  // deliberately inactive until the centralized runtime gate approves it.
  return false;
}

function saveTemplateOnly(options){
  options=options||{};
  var houseTemplateId=options.houseTemplateId||window.editHouseTemplateId||null;
  var authorization=window.HouseTemplateContentAuthorization;
  if(houseTemplateId&&authorization&&
    typeof authorization.requireEdit==='function'&&
    !authorization.requireEdit(houseTemplateId))return false;
  return save({
    skipCurrentConferenceUpdate:true,
    skipConferenceTracking:true,
    skipSyncQueue:true
  });
}

function initializeApplicationStorage(){
  if(storageInitializationPromise)return storageInitializationPromise;

  var defaults=cloneApplicationStorageData(appData);
  var arbitration=window.LocalPersistenceArbitration;
  var deviceApproval=window.DeviceReauthorizationFlow&&
    typeof window.DeviceReauthorizationFlow.waitUntilApproved==='function'
    ?window.DeviceReauthorizationFlow.waitUntilApproved()
    :Promise.resolve();
  storageInitializationPromise=Promise.resolve(deviceApproval)
    .then(function(){
      if(!arbitration||typeof arbitration.inspect!=='function'){
        throw new Error('LOCAL_PERSISTENCE_ARBITRATION_UNAVAILABLE');
      }
      return arbitration.inspect({
        indexedDB:window.AppIndexedDB,
        localStorage:window.localStorage,
        storageKey:SK
      });
    })
    .then(function(result){
      if(!result.ok){
        var error=new Error(result.code||'LOCAL_PERSISTENCE_RECOVERY_REQUIRED');
        error.code=result.code||'LOCAL_PERSISTENCE_RECOVERY_REQUIRED';
        error.persistenceResult=result;
        throw error;
      }
      if(!result.selected)return {source:'defaults',data:defaults};
      return {
        source:result.selected.source,
        data:result.selected.payload,
        savedAt:result.selected.record&&result.selected.record.savedAt||null,
        persistenceStatus:result.status
      };
    })
    .then(function(selection){
      var persistedCandidate=String(selection.data.currentConferenceId||'');
      var activation=window.ConferenceActivationAuthorization;
      if(activation&&typeof activation.capturePersistedCandidate==='function'){
        activation.capturePersistedCandidate(persistedCandidate,selection.source);
      }
      appData=cloneApplicationStorageData(selection.data);
      appData.currentConferenceId=null;
      normalizeAppData();
      applicationSelectionRestored=
        restoreSafeSingleCurrentConferenceSelection(appData);
      updateLogoText();
      var current=getCurrentConference();
      if(current)setCurrentConference(current);

      return selection;
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
    if(typeof reconcileAccommodationRoomKeyHolders==='function'){
      reconcileAccommodationRoomKeyHolders(getCurrentConference());
    }
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
    var activation=window.ConferenceActivationAuthorization;
    var persistedData=activation&&typeof activation.preparePersistedAppData==='function'
      ?activation.preparePersistedAppData(appData):appData;
    json=JSON.stringify(persistedData);
  }catch(e){
    console.error('تعذر حفظ بيانات التطبيق:',e);
    notifyPersistenceFailure('تعذر حفظ البيانات على الجهاز. قد تكون مساحة التخزين ممتلئة. لم يتم تأكيد حفظ آخر تعديل.');
    return false;
  }
  if(window.StorageRepository&&
    typeof window.StorageRepository.saveAppSnapshot==='function'){
    window.StorageRepository.saveAppSnapshot(
      persistedData,
      options.skipSyncQueue===true?{skipSyncQueue:true}:undefined
    )
      .then(function(result){
        applicationStorageState.lastIndexedDbSaveAt=new Date().toISOString();
        if(result&&result.mirror&&result.mirror.ok){
          applicationStorageState.lastLocalSaveAt=new Date().toISOString();
        }else if(result&&result.mirror&&result.mirror.ok===false){
          applicationStorageState.lastStorageError=result.mirror.error||
            new Error(result.mirror.code||'LOCAL_STORAGE_MIRROR_FAILED');
          notifyPersistenceFailure('تعذر حفظ البيانات على الجهاز. قد تكون مساحة التخزين ممتلئة. لم يتم تأكيد حفظ آخر تعديل.');
        }
      })
      .catch(function(indexedDbError){
        applicationStorageState.lastStorageError=indexedDbError;
        console.warn('تعذر حفظ النسخة الاحتياطية في IndexedDB:',indexedDbError);
      });
  }else{
    var repositoryError=new Error('Application snapshot repository is unavailable.');
    repositoryError.code='LOCAL_PERSISTENCE_REPOSITORY_UNAVAILABLE';
    applicationStorageState.lastStorageError=repositoryError;
    notifyPersistenceFailure('تعذر حفظ البيانات على الجهاز. قد تكون مساحة التخزين ممتلئة. لم يتم تأكيد حفظ آخر تعديل.');
    return false;
  }
  return true;
}

function saveCurrentConferenceSelection(){
  var json;
  var activation=window.ConferenceActivationAuthorization;
  var persistedData=activation&&typeof activation.preparePersistedAppData==='function'
    ?activation.preparePersistedAppData(appData):appData;
  try{
    json=JSON.stringify(persistedData);
  }catch(e){
    applicationStorageState.lastStorageError=e;
    return false;
  }
  if(window.StorageRepository&&
    typeof window.StorageRepository.saveAppSnapshot==='function'){
    window.StorageRepository.saveAppSnapshot(persistedData,{skipSyncQueue:true})
      .then(function(result){
        applicationStorageState.lastIndexedDbSaveAt=new Date().toISOString();
        if(result&&result.mirror&&result.mirror.ok){
          applicationStorageState.lastLocalSaveAt=new Date().toISOString();
        }
      })
      .catch(function(indexedDbError){
        applicationStorageState.lastStorageError=indexedDbError;
      });
  }else{
    var repositoryError=new Error('Application snapshot repository is unavailable.');
    repositoryError.code='LOCAL_PERSISTENCE_REPOSITORY_UNAVAILABLE';
    applicationStorageState.lastStorageError=repositoryError;
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
