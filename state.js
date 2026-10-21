// ═══════════════════════════════════════════════════════

var appData = {
  version: '2.0.0',
  currentConferenceId: null,
  conferences: [],
  conferenceLifecycle: { schemaVersion: 1, records: {} },
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

function conferenceSelectionPreferenceKey(){
  var auth=window.SupabaseAuth;
  var identity=auth&&typeof auth.getAccountIdentity==='function'
    ?auth.getAccountIdentity():null;
  var integration=window.PlatformIntegration;
  var device=integration&&typeof integration.getDeviceIdentity==='function'
    ?integration.getDeviceIdentity():null;
  var userId=String(identity&&identity.userId||'').trim();
  var deviceId=String(device&&device.id||'').trim();
  if(!userId||!deviceId)return null;
  return browserStorageNamespace.key(
    'conference_selection:'+userId+':'+deviceId
  );
}

function readConferenceSelectionPreference(){
  var key=conferenceSelectionPreferenceKey();
  if(!key)return null;
  try{return String(localStorage.getItem(key)||'').trim()||null;}
  catch(error){return null;}
}

function persistConferenceSelectionPreference(conferenceId){
  var key=conferenceSelectionPreferenceKey();
  if(!key)return false;
  try{
    var value=String(conferenceId||'').trim();
    if(value)localStorage.setItem(key,value);else localStorage.removeItem(key);
    window.applicationPersistedConferenceCandidate=value||null;
    return true;
  }catch(error){
    applicationStorageState.lastStorageError=error;
    return false;
  }
}

function resetConferenceRuntimeSelection(){
  if(appData)appData.currentConferenceId=null;
  if(typeof currentConferenceRuntimeActivationDecision!=='undefined'){
    currentConferenceRuntimeActivationDecision=null;
  }
  window.applicationPersistedConferenceCandidate=null;
  applicationSelectionRestored=false;
  storageInitializationPromise=null;
  window.applicationStorageReadyPromise=null;
  return true;
}


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
  var linked=typeof getCanonicalConferenceCoreLink==='function'&&getCanonicalConferenceCoreLink(current.id);
  var state=linked&&window.PlatformIntegration&&typeof window.PlatformIntegration.getConferenceCoreState==='function'?window.PlatformIntegration.getConferenceCoreState(current.id):null;
  var conf=state&&state.core?state.core:(linked?{}:(current.conf || {name: current.name || 'المؤتمر', startDate: current.startDate || '', endDate: current.endDate || '', days: current.days || 1}));
  DAYS = conf.days || 1;
  updateLogoText();
}

function updateCurrentConferenceData(){
  var current = getCurrentConference();
  if(!current) return;
  if(window.PlatformIntegration&&
    typeof window.PlatformIntegration.getConferenceCoreState==='function'&&
    window.PlatformIntegration.getConferenceCoreState(current.id))return;
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

function restoreSafeSingleCurrentConferenceSelection(target){
  // A local record is not authorization. Sole-conference restoration remains
  // deliberately inactive until the centralized runtime gate approves it.
  return false;
}

function saveTemplateOnly(options){
  return save({
    skipCurrentConferenceUpdate:true,
    skipConferenceTracking:true,
    skipSyncQueue:true
  });
}

function initializeApplicationStorage(){
  if(storageInitializationPromise)return storageInitializationPromise;

  var defaults=cloneApplicationStorageData(appData);
  var repository=window.StorageRepository;
  storageInitializationPromise=Promise.resolve()
    .then(function(){
      if(!repository||typeof repository.getAppData!=='function'){
        throw new Error('LOCAL_PERSISTENCE_UNAVAILABLE');
      }
      return repository.getAppData().then(function(record){
        if(!record)return {source:'defaults',data:defaults};
        if(!window.AppIndexedDB.validateAppDataRecord(record).valid){
          throw new Error('LOCAL_PERSISTENCE_INVALID');
        }
        return {source:'indexeddb',data:record.data,savedAt:record.savedAt||null};
      });
    })
    .then(function(selection){
      window.applicationPersistedConferenceCandidate=
        readConferenceSelectionPreference();
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
    var persistedData=cloneApplicationStorageData(appData);
    json=JSON.stringify(persistedData);
  }catch(e){
    console.error('تعذر حفظ بيانات التطبيق:',e);
    notifyPersistenceFailure('تعذر حفظ البيانات على الجهاز. قد تكون مساحة التخزين ممتلئة. لم يتم تأكيد حفظ آخر تعديل.');
    return false;
  }
  if(currentConference&&String(currentConference.id||'').trim()){
    return true;
  }
  if(window.StorageRepository&&
    typeof window.StorageRepository.saveAppData==='function'){
    window.StorageRepository.saveAppData(
      persistedData,
      undefined
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
    var repositoryError=new Error('Application persistence repository is unavailable.');
    repositoryError.code='LOCAL_PERSISTENCE_REPOSITORY_UNAVAILABLE';
    applicationStorageState.lastStorageError=repositoryError;
    notifyPersistenceFailure('تعذر حفظ البيانات على الجهاز. قد تكون مساحة التخزين ممتلئة. لم يتم تأكيد حفظ آخر تعديل.');
    return false;
  }
  return true;
}

if(typeof window.addEventListener==='function'){
  window.addEventListener('platform-session-reset',resetConferenceRuntimeSelection);
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
