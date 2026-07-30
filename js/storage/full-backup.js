(function(global){
  'use strict';

  var BACKUP_TYPE='conference-manager-full-backup';
  var FORMAT_VERSION=1;
  var MAXIMUM_FILE_SIZE=100*1024*1024;
  var FULL_RESTORE_STORAGE_KEY='conf_v5';
  var CLOUD_REVIEW_MARKER_KEY=
    'conference_manager_full_restore_pending_cloud_review';
  var SYNC_LINKS_STORAGE_KEY='conference_manager_sync_links';
  var LINKING_ATTEMPTS_STORAGE_KEY='conference_manager_linking_attempts_v1';
  var REMOTE_UPDATES_STORAGE_KEY='conference_manager_remote_update_markers';
  var MANUAL_RELINK_STORAGE_KEY=
    'conference_manager_full_restore_manual_relink_required';
  var FINAL_QUEUE_STATUSES=Object.freeze([
    'applied','resolved','discarded'
  ]);
  var LINK_STATUSES=Object.freeze([
    'linked','upload_pending','needs_resolution','unsynced','disconnected',
    'server_selected_pending_local_apply'
  ]);
  var restoreInProgress=false;
  var cloudReviewInProgress=false;
  var EXCLUDED=Object.freeze([
    'supabaseConfig',
    'supabaseSession',
    'deviceIdentity',
    'syncLinks',
    'syncQueue',
    'transientConflictState'
  ]);
  var FORBIDDEN_KEYS=Object.freeze({
    '__proto__':true,
    'prototype':true,
    'constructor':true
  });
  var SENSITIVE_KEYS=Object.freeze({
    supabaseConfig:true,
    supabaseSession:true,
    deviceIdentity:true,
    syncLinks:true,
    accessToken:true,
    refreshToken:true,
    serviceRoleKey:true
  });
  var SUMMARY_FIELDS=Object.freeze([
    'conferenceCount',
    'templateCount',
    'archiveCount',
    'internalBackupCount',
    'houseTemplateCount',
    'peopleCount'
  ]);

  function getSupportedFullBackupFormatVersion(){
    return FORMAT_VERSION;
  }

  function getFullBackupType(){
    return BACKUP_TYPE;
  }

  function isPlainObject(value){
    return Object.prototype.toString.call(value)==='[object Object]';
  }

  function hasOwn(value,key){
    return Object.prototype.hasOwnProperty.call(value,key);
  }

  function nonEmptyString(value){
    return typeof value==='string'&&value.trim().length>0;
  }

  function isUuid(value){
    // Keep this contract identical to ConferenceLinkStore.isUuid().
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function isValidIsoDate(value){
    return nonEmptyString(value)&&!Number.isNaN(Date.parse(value));
  }

  function joinPath(path,key){
    return path?path+'.'+key:String(key);
  }

  function inspectValue(value,path,seen){
    if(value===null)return;
    var type=typeof value;
    if(type==='function'||type==='symbol'||type==='bigint'||type==='undefined'){
      throw new Error('FULL_BACKUP_VALUE_NOT_SERIALIZABLE: '+(path||'$'));
    }
    if(type==='number'&&!Number.isFinite(value)){
      throw new Error('FULL_BACKUP_VALUE_NOT_SERIALIZABLE: '+(path||'$'));
    }
    if(type!=='object')return;
    if(seen.indexOf(value)>=0){
      throw new Error('FULL_BACKUP_CIRCULAR_REFERENCE: '+(path||'$'));
    }
    seen.push(value);
    Object.keys(value).forEach(function(key){
      if(FORBIDDEN_KEYS[key]){
        throw new Error('FULL_BACKUP_FORBIDDEN_KEY: '+joinPath(path,key));
      }
      inspectValue(value[key],joinPath(path,key),seen);
    });
    seen.pop();
  }

  function cloneFullBackupValue(value){
    inspectValue(value,'',[]);
    var serialized;
    try{
      serialized=JSON.stringify(value);
    }catch(error){
      throw new Error('FULL_BACKUP_VALUE_NOT_SERIALIZABLE');
    }
    if(serialized===undefined){
      throw new Error('FULL_BACKUP_VALUE_NOT_SERIALIZABLE');
    }
    return JSON.parse(serialized);
  }

  function arrayLength(value){
    return Array.isArray(value)?value.length:0;
  }

  function buildFullBackupSummary(appData){
    appData=isPlainObject(appData)?appData:{};
    var people=appData.peopleDb&&Array.isArray(appData.peopleDb.people)
      ?appData.peopleDb.people
      :[];
    return {
      conferenceCount:arrayLength(appData.conferences),
      templateCount:arrayLength(appData.templates),
      archiveCount:arrayLength(appData.archives),
      internalBackupCount:arrayLength(appData.backups),
      houseTemplateCount:arrayLength(appData.houseTemplates),
      peopleCount:people.length,
      currentConferenceId:hasOwn(appData,'currentConferenceId')
        ?appData.currentConferenceId
        :null
    };
  }

  function requireBuildInput(appData){
    if(!isPlainObject(appData)){
      throw new Error('FULL_BACKUP_APP_DATA_INVALID');
    }
    if(!nonEmptyString(appData.version)){
      throw new Error('FULL_BACKUP_SCHEMA_VERSION_REQUIRED');
    }
    if(!Array.isArray(appData.conferences)){
      throw new Error('FULL_BACKUP_CONFERENCES_INVALID');
    }
  }

  function buildFullBackupDocument(appData,options){
    options=isPlainObject(options)?options:{};
    requireBuildInput(appData);
    var clonedAppData=cloneFullBackupValue(appData);
    if(!hasOwn(clonedAppData,'currentConferenceId')){
      clonedAppData.currentConferenceId=null;
    }
    var createdAt=hasOwn(options,'createdAt')
      ?String(options.createdAt)
      :new Date().toISOString();
    var appVersion=nonEmptyString(options.appVersion)
      ?options.appVersion
      :(global.APP_RELEASE&&nonEmptyString(global.APP_RELEASE.version)
        ?global.APP_RELEASE.version
        :'unknown');
    var document={
      backupType:BACKUP_TYPE,
      formatVersion:FORMAT_VERSION,
      createdAt:createdAt,
      appVersion:appVersion,
      dataSchemaVersion:clonedAppData.version,
      summary:buildFullBackupSummary(clonedAppData),
      data:{appData:clonedAppData},
      excluded:EXCLUDED.slice()
    };
    return cloneFullBackupValue(document);
  }

  function validationResult(document){
    return {
      valid:true,
      errors:[],
      warnings:[],
      metadata:{
        backupType:isPlainObject(document)?document.backupType:undefined,
        formatVersion:isPlainObject(document)?document.formatVersion:undefined,
        createdAt:isPlainObject(document)?document.createdAt:undefined,
        appVersion:isPlainObject(document)?document.appVersion:undefined,
        dataSchemaVersion:isPlainObject(document)
          ?document.dataSchemaVersion
          :undefined
      }
    };
  }

  function addIssue(collection,code,path,message){
    collection.push({code:code,path:path,message:message});
  }

  function validateOptionalArray(result,appData,key){
    if(hasOwn(appData,key)&&!Array.isArray(appData[key])){
      addIssue(
        result.errors,
        'APP_DATA_ARRAY_INVALID',
        'data.appData.'+key,
        key+' must be an array when present.'
      );
    }
  }

  function validateSummary(result,summary,appData){
    if(!hasOwn(result.metadata,'backupType'))return;
    if(summary===undefined)return;
    if(!isPlainObject(summary)){
      addIssue(result.errors,'SUMMARY_INVALID','summary',
        'summary must be a plain object when present.');
      return;
    }
    SUMMARY_FIELDS.forEach(function(key){
      if(hasOwn(summary,key)&&
        (!Number.isInteger(summary[key])||summary[key]<0)){
        addIssue(result.errors,'SUMMARY_COUNT_INVALID','summary.'+key,
          key+' must be a non-negative integer.');
      }
    });
    if(!isPlainObject(appData))return;
    var expected=buildFullBackupSummary(appData);
    SUMMARY_FIELDS.concat(['currentConferenceId']).forEach(function(key){
      if(hasOwn(summary,key)&&summary[key]!==expected[key]){
        addIssue(result.warnings,'SUMMARY_MISMATCH','summary.'+key,
          key+' does not match data.appData.');
      }
    });
  }

  function scanForbiddenKeys(value,path,result,seen){
    if(!value||typeof value!=='object'||seen.indexOf(value)>=0)return;
    seen.push(value);
    Object.keys(value).forEach(function(key){
      var childPath=joinPath(path,key);
      if(FORBIDDEN_KEYS[key]){
        addIssue(result.errors,'FORBIDDEN_OBJECT_KEY',childPath,
          'Prototype-pollution keys are not allowed.');
      }else{
        scanForbiddenKeys(value[key],childPath,result,seen);
      }
    });
  }

  function scanSensitiveMetadata(value,path,result,seen){
    if(!value||typeof value!=='object'||seen.indexOf(value)>=0)return;
    seen.push(value);
    Object.keys(value).forEach(function(key){
      var childPath=joinPath(path,key);
      if(SENSITIVE_KEYS[key]){
        addIssue(result.warnings,'SENSITIVE_METADATA_KEY',childPath,
          'Sensitive or device-specific metadata should not be exported.');
      }
      if(!(path==='data'&&key==='appData')){
        scanSensitiveMetadata(value[key],childPath,result,seen);
      }
    });
  }

  function validateFullBackupDocument(document){
    var result=validationResult(document);
    if(!isPlainObject(document)){
      addIssue(result.errors,'DOCUMENT_INVALID','$',
        'The backup document must be a plain object.');
      result.valid=false;
      return result;
    }

    scanForbiddenKeys(document,'',result,[]);
    scanSensitiveMetadata(document,'',result,[]);

    if(document.backupType!==BACKUP_TYPE){
      addIssue(result.errors,'BACKUP_TYPE_INVALID','backupType',
        'backupType is not supported.');
    }
    if(!Number.isInteger(document.formatVersion)){
      addIssue(result.errors,'FORMAT_VERSION_INVALID','formatVersion',
        'formatVersion must be an integer.');
    }else if(document.formatVersion>FORMAT_VERSION){
      addIssue(result.errors,'UNSUPPORTED_NEWER_FORMAT','formatVersion',
        'The backup format is newer than this application supports.');
    }else if(document.formatVersion<FORMAT_VERSION){
      addIssue(result.errors,'UNSUPPORTED_OLDER_FORMAT','formatVersion',
        'The backup format is older than this application supports.');
    }
    if(!nonEmptyString(document.createdAt)||
      Number.isNaN(Date.parse(document.createdAt))){
      addIssue(result.errors,'CREATED_AT_INVALID','createdAt',
        'createdAt must be a parseable ISO date string.');
    }
    if(!nonEmptyString(document.appVersion)){
      addIssue(result.errors,'APP_VERSION_INVALID','appVersion',
        'appVersion must be a non-empty string.');
    }
    if(!nonEmptyString(document.dataSchemaVersion)){
      addIssue(result.errors,'DATA_SCHEMA_VERSION_INVALID','dataSchemaVersion',
        'dataSchemaVersion must be a non-empty string.');
    }

    var data=document.data;
    if(!isPlainObject(data)){
      addIssue(result.errors,'DATA_INVALID','data',
        'data must be a plain object.');
      validateSummary(result,document.summary,null);
      result.valid=result.errors.length===0;
      return result;
    }
    var appData=data.appData;
    if(!isPlainObject(appData)){
      addIssue(result.errors,'APP_DATA_INVALID','data.appData',
        'data.appData must be a plain object.');
      validateSummary(result,document.summary,null);
      result.valid=result.errors.length===0;
      return result;
    }
    if(!nonEmptyString(appData.version)){
      addIssue(result.errors,'APP_DATA_VERSION_INVALID',
        'data.appData.version','appData.version must be a non-empty string.');
    }
    if(!Array.isArray(appData.conferences)){
      addIssue(result.errors,'CONFERENCES_INVALID',
        'data.appData.conferences','conferences must be an array.');
    }
    if(!hasOwn(appData,'currentConferenceId')){
      addIssue(result.errors,'CURRENT_CONFERENCE_ID_MISSING',
        'data.appData.currentConferenceId',
        'currentConferenceId must be present.');
    }else if(appData.currentConferenceId!==null&&
      !nonEmptyString(appData.currentConferenceId)){
      addIssue(result.errors,'CURRENT_CONFERENCE_ID_INVALID',
        'data.appData.currentConferenceId',
        'currentConferenceId must be null or a non-empty string.');
    }else if(appData.currentConferenceId!==null&&
      Array.isArray(appData.conferences)&&
      !appData.conferences.some(function(conference){
        return isPlainObject(conference)&&
          conference.id===appData.currentConferenceId;
      })){
      addIssue(result.errors,'CURRENT_CONFERENCE_NOT_FOUND',
        'data.appData.currentConferenceId',
        'currentConferenceId must identify an included conference.');
    }
    ['templates','archives','backups','houseTemplates'].forEach(function(key){
      validateOptionalArray(result,appData,key);
    });
    if(hasOwn(appData,'peopleDb')){
      if(!isPlainObject(appData.peopleDb)){
        addIssue(result.errors,'PEOPLE_DB_INVALID','data.appData.peopleDb',
          'peopleDb must be a plain object when present.');
      }else if(!Array.isArray(appData.peopleDb.people)){
        addIssue(result.errors,'PEOPLE_INVALID','data.appData.peopleDb.people',
          'peopleDb.people must be an array.');
      }
    }
    if(hasOwn(appData,'trash')){
      if(!isPlainObject(appData.trash)){
        addIssue(result.errors,'TRASH_INVALID','data.appData.trash',
          'trash must be a plain object when present.');
      }else{
        ['templates','archives','backups','houseTemplates','rooms']
          .forEach(function(key){
            if(hasOwn(appData.trash,key)&&!Array.isArray(appData.trash[key])){
              addIssue(result.errors,'TRASH_ARRAY_INVALID',
                'data.appData.trash.'+key,
                'Known trash fields must be arrays when present.');
            }
          });
      }
    }
    validateSummary(result,document.summary,appData);
    result.valid=result.errors.length===0;
    return result;
  }

  function isFullBackupDocument(value){
    return validateFullBackupDocument(value).valid;
  }

  function getFullBackupFileName(createdAt){
    if(!nonEmptyString(createdAt)||Number.isNaN(Date.parse(createdAt))){
      throw new Error('FULL_BACKUP_CREATED_AT_INVALID');
    }
    var utc;
    try{
      utc=new Date(createdAt).toISOString();
    }catch(error){
      throw new Error('FULL_BACKUP_CREATED_AT_INVALID');
    }
    return 'conference-manager-full-backup_'+
      utc.slice(0,10)+'_'+utc.slice(11,19).replace(/:/g,'-')+'.json';
  }

  function serializeFullBackupDocument(document){
    inspectValue(document,'',[]);
    var serialized;
    try{
      serialized=JSON.stringify(document,null,2);
    }catch(error){
      throw new Error('FULL_BACKUP_SERIALIZATION_FAILED');
    }
    if(typeof serialized!=='string'){
      throw new Error('FULL_BACKUP_SERIALIZATION_FAILED');
    }
    return serialized;
  }

  function downloadFullBackupDocument(document,options){
    options=isPlainObject(options)?options:{};
    var BlobConstructor=options.Blob||global.Blob;
    var urlApi=options.URL||global.URL;
    var browserDocument=options.document||global.document;
    if(typeof BlobConstructor!=='function'||
      !urlApi||typeof urlApi.createObjectURL!=='function'||
      typeof urlApi.revokeObjectURL!=='function'||
      !browserDocument||
      typeof browserDocument.createElement!=='function'||
      !browserDocument.body||
      typeof browserDocument.body.appendChild!=='function'){
      throw new Error('FULL_BACKUP_BROWSER_APIS_UNAVAILABLE');
    }
    var fileName=nonEmptyString(options.fileName)
      ?options.fileName
      :getFullBackupFileName(document&&document.createdAt);
    var serialized=hasOwn(options,'serialized')
      ?options.serialized
      :serializeFullBackupDocument(document);
    if(typeof serialized!=='string'){
      throw new Error('FULL_BACKUP_SERIALIZATION_INVALID');
    }
    var blob=new BlobConstructor(
      [serialized],
      {type:'application/json;charset=utf-8'}
    );
    var objectUrl=null;
    var anchor=null;
    var appended=false;
    try{
      objectUrl=urlApi.createObjectURL(blob);
      anchor=browserDocument.createElement('a');
      if(!anchor||typeof anchor.click!=='function'){
        throw new Error('FULL_BACKUP_DOWNLOAD_ANCHOR_UNAVAILABLE');
      }
      anchor.href=objectUrl;
      anchor.download=fileName;
      if(anchor.style)anchor.style.display='none';
      browserDocument.body.appendChild(anchor);
      appended=true;
      anchor.click();
    }finally{
      try{
        if(anchor&&appended){
          if(typeof anchor.remove==='function'){
            anchor.remove();
          }else if(anchor.parentNode&&
            typeof anchor.parentNode.removeChild==='function'){
            anchor.parentNode.removeChild(anchor);
          }
        }
      }finally{
        if(objectUrl!==null){
          urlApi.revokeObjectURL(objectUrl);
        }
      }
    }
    return {
      fileName:fileName,
      sizeBytes:blob.size,
      mimeType:'application/json;charset=utf-8'
    };
  }

  function createAndDownloadFullBackup(appData,options){
    options=isPlainObject(options)?options:{};
    var createdAt=hasOwn(options,'createdAt')
      ?String(options.createdAt)
      :new Date().toISOString();
    var buildOptions={
      createdAt:createdAt
    };
    if(hasOwn(options,'appVersion')){
      buildOptions.appVersion=options.appVersion;
    }
    var document=buildFullBackupDocument(appData,buildOptions);
    var validation=validateFullBackupDocument(document);
    if(!validation.valid){
      var codes=validation.errors.map(function(error){
        return error.code;
      });
      var validationError=new Error(
        'FULL_BACKUP_VALIDATION_FAILED: '+codes.join(', ')
      );
      validationError.validationErrors=validation.errors.slice();
      throw validationError;
    }
    var serialized=serializeFullBackupDocument(document);
    var fileName=getFullBackupFileName(document.createdAt);
    downloadFullBackupDocument(document,{
      Blob:options.Blob,
      URL:options.URL,
      document:options.document,
      fileName:fileName,
      serialized:serialized
    });
    return {
      success:true,
      fileName:fileName,
      createdAt:document.createdAt,
      summary:cloneFullBackupValue(document.summary),
      document:document
    };
  }

  function getMaximumFullBackupFileSize(){
    return MAXIMUM_FILE_SIZE;
  }

  function validateFullBackupFileInput(file,options){
    options=isPlainObject(options)?options:{};
    var errors=[];
    var maxFileSize=hasOwn(options,'maxFileSize')
      ?options.maxFileSize
      :MAXIMUM_FILE_SIZE;
    if(!Number.isFinite(maxFileSize)||maxFileSize<0){
      maxFileSize=MAXIMUM_FILE_SIZE;
    }
    if(!file||typeof file!=='object'){
      addIssue(errors,'FULL_BACKUP_FILE_REQUIRED','file',
        'A full backup file is required.');
    }else{
      if(!nonEmptyString(file.name)){
        addIssue(errors,'FULL_BACKUP_FILE_NAME_INVALID','file.name',
          'The selected file must have a name.');
      }else if(!/\.json$/i.test(file.name.trim())){
        addIssue(errors,'FULL_BACKUP_FILE_TYPE_INVALID','file.name',
          'Only JSON full backup files are supported.');
      }
      if(!Number.isFinite(file.size)||file.size<0){
        addIssue(errors,'FULL_BACKUP_FILE_SIZE_INVALID','file.size',
          'The selected file size must be a non-negative number.');
      }else if(file.size>maxFileSize){
        addIssue(errors,'FULL_BACKUP_FILE_TOO_LARGE','file.size',
          'The selected file exceeds the maximum supported size.');
      }
    }
    return {
      valid:errors.length===0,
      errors:errors,
      maxFileSize:maxFileSize
    };
  }

  function codedError(code,message,details){
    var error=new Error(code+(message?': '+message:''));
    error.code=code;
    if(details)error.details=details;
    return error;
  }

  function readTextWithAdapter(file,options){
    if(typeof options.reader==='function'){
      return Promise.resolve().then(function(){
        return options.reader(file);
      });
    }
    if(options.reader&&typeof options.reader.readAsText==='function'){
      return Promise.resolve().then(function(){
        return options.reader.readAsText(file);
      });
    }
    if(file&&typeof file.text==='function'){
      return Promise.resolve().then(function(){return file.text();});
    }
    var Reader=options.FileReader||global.FileReader;
    if(typeof Reader!=='function'){
      return Promise.reject(codedError(
        'FULL_BACKUP_FILE_READ_FAILED',
        'No supported file reader is available.'
      ));
    }
    return new Promise(function(resolve,reject){
      var reader;
      function cleanup(){
        if(!reader)return;
        reader.onload=null;
        reader.onerror=null;
        reader.onabort=null;
      }
      try{
        reader=new Reader();
        reader.onload=function(){
          var result=reader.result;
          cleanup();
          resolve(result);
        };
        reader.onerror=function(){
          cleanup();
          reject(codedError(
            'FULL_BACKUP_FILE_READ_FAILED',
            'The selected file could not be read.'
          ));
        };
        reader.onabort=reader.onerror;
        reader.readAsText(file,'utf-8');
      }catch(error){
        cleanup();
        reject(codedError(
          'FULL_BACKUP_FILE_READ_FAILED',
          'The selected file could not be read.'
        ));
      }
    });
  }

  function readFullBackupFile(file,options){
    options=isPlainObject(options)?options:{};
    var fileValidation=validateFullBackupFileInput(file,options);
    if(!fileValidation.valid){
      var first=fileValidation.errors[0];
      return Promise.reject(codedError(first.code,first.message,
        fileValidation.errors));
    }
    return readTextWithAdapter(file,options).catch(function(error){
      if(error&&error.code==='FULL_BACKUP_FILE_READ_FAILED')throw error;
      throw codedError('FULL_BACKUP_FILE_READ_FAILED',
        'The selected file could not be read.');
    }).then(function(text){
      if(typeof text!=='string'){
        throw codedError('FULL_BACKUP_FILE_READ_FAILED',
          'The selected file did not return text.');
      }
      var document;
      try{
        document=JSON.parse(text);
      }catch(error){
        throw codedError('FULL_BACKUP_JSON_INVALID',
          'The selected file does not contain valid JSON.');
      }
      var validation=validateFullBackupDocument(document);
      if(!validation.valid){
        var codes=validation.errors.map(function(error){
          return error.code;
        });
        throw codedError(
          'FULL_BACKUP_DOCUMENT_INVALID',
          codes.join(', '),
          validation.errors
        );
      }
      return {
        fileName:file.name,
        fileSize:file.size,
        document:document,
        validation:validation
      };
    });
  }

  function parseDataSchemaVersion(value){
    if(!nonEmptyString(value)||!/^\d+(?:\.\d+)*$/.test(value.trim())){
      return null;
    }
    return value.trim().split('.').map(function(part){
      return Number(part);
    });
  }

  function compareDataSchemaVersions(first,second){
    var left=parseDataSchemaVersion(first);
    var right=parseDataSchemaVersion(second);
    if(!left||!right)return null;
    var length=Math.max(left.length,right.length);
    for(var index=0;index<length;index++){
      var leftPart=left[index]||0;
      var rightPart=right[index]||0;
      if(leftPart>rightPart)return 1;
      if(leftPart<rightPart)return -1;
    }
    return 0;
  }

  function validateCandidateIds(candidate,errors){
    var conferenceIds=Object.create(null);
    candidate.conferences.forEach(function(conference,index){
      var path='candidateAppData.conferences.'+index+'.id';
      if(!isPlainObject(conference)||!nonEmptyString(conference.id)){
        addIssue(errors,'CONFERENCE_ID_INVALID',path,
          'Every conference must have a non-empty string id.');
        return;
      }
      if(conferenceIds[conference.id]){
        addIssue(errors,'DUPLICATE_CONFERENCE_ID',path,
          'Conference ids must be unique.');
      }
      conferenceIds[conference.id]=true;
    });
    if(candidate.currentConferenceId!==null&&
      !conferenceIds[candidate.currentConferenceId]){
      addIssue(errors,'CURRENT_CONFERENCE_NOT_FOUND',
        'candidateAppData.currentConferenceId',
        'currentConferenceId must identify an included conference.');
    }
    [
      {key:'templates',code:'DUPLICATE_TEMPLATE_ID'},
      {key:'houseTemplates',code:'DUPLICATE_HOUSE_TEMPLATE_ID'}
    ].forEach(function(definition){
      var ids=Object.create(null);
      var values=Array.isArray(candidate[definition.key])
        ?candidate[definition.key]
        :[];
      values.forEach(function(value,index){
        if(!isPlainObject(value)||!hasOwn(value,'id')||
          value.id===null||value.id===''){
          return;
        }
        if(!nonEmptyString(value.id)){
          addIssue(errors,definition.code,
            'candidateAppData.'+definition.key+'.'+index+'.id',
            'Optional ids must be non-empty strings when present.');
          return;
        }
        if(ids[value.id]){
          addIssue(errors,definition.code,
            'candidateAppData.'+definition.key+'.'+index+'.id',
            'Ids must be unique when present.');
        }
        ids[value.id]=true;
      });
    });
  }

  function prepareFullRestoreCandidate(document,options){
    options=isPlainObject(options)?options:{};
    var documentValidation=validateFullBackupDocument(document);
    if(!documentValidation.valid){
      throw codedError(
        'FULL_BACKUP_DOCUMENT_INVALID',
        documentValidation.errors.map(function(error){
          return error.code;
        }).join(', '),
        documentValidation.errors
      );
    }
    var supported=hasOwn(options,'supportedDataSchemaVersion')
      ?options.supportedDataSchemaVersion
      :options.currentAppData&&options.currentAppData.version;
    if(!nonEmptyString(supported)){
      throw codedError('SUPPORTED_DATA_SCHEMA_VERSION_REQUIRED',
        'A supported data schema version is required.');
    }
    var source=document.dataSchemaVersion;
    var comparison=compareDataSchemaVersions(source,supported);
    if(comparison===null){
      throw codedError('DATA_SCHEMA_VERSION_INVALID',
        'Data schema versions must contain numeric dot-separated parts.');
    }
    var candidate=cloneFullBackupValue(document.data.appData);
    var errors=[];
    var warnings=[];
    if(candidate.version!==source){
      addIssue(errors,'DATA_SCHEMA_VERSION_MISMATCH',
        'candidateAppData.version',
        'The document and appData schema versions must match.');
    }
    if(comparison>0){
      addIssue(errors,'UNSUPPORTED_NEWER_DATA_SCHEMA','dataSchemaVersion',
        'The backup data schema is newer than this application supports.');
    }else if(comparison<0){
      addIssue(warnings,'OLDER_DATA_SCHEMA','dataSchemaVersion',
        'The backup uses an older data schema.');
    }
    addIssue(warnings,'NORMALIZATION_DEFERRED','candidateAppData',
      'Full normalization is deferred until a safe candidate-only path exists.');
    validateCandidateIds(candidate,errors);
    return {
      candidateAppData:candidate,
      errors:errors,
      warnings:warnings,
      sourceDataSchemaVersion:source,
      supportedDataSchemaVersion:supported,
      normalizationApplied:false
    };
  }

  function previewSummary(appData){
    var summary=buildFullBackupSummary(appData);
    var currentName='';
    if(summary.currentConferenceId!==null&&Array.isArray(appData.conferences)){
      appData.conferences.some(function(conference){
        if(isPlainObject(conference)&&
          conference.id===summary.currentConferenceId){
          currentName=typeof conference.name==='string'
            ?conference.name
            :(conference.conf&&typeof conference.conf.name==='string'
              ?conference.conf.name
              :'');
          return true;
        }
        return false;
      });
    }
    summary.currentConferenceName=currentName;
    return summary;
  }

  function buildFullRestorePreview(
    currentAppData,
    backupDocument,
    candidateAppData
  ){
    return {
      source:{
        fileCreatedAt:backupDocument.createdAt,
        appVersion:backupDocument.appVersion,
        dataSchemaVersion:backupDocument.dataSchemaVersion
      },
      incoming:previewSummary(candidateAppData),
      current:previewSummary(currentAppData),
      replacement:{
        willReplaceAllApplicationData:true
      },
      risks:[],
      warnings:[]
    };
  }

  function cloudRisk(code,conferenceId,severity,message,index){
    var risk={
      code:code,
      conferenceId:conferenceId||null,
      severity:severity,
      message:message
    };
    if(Number.isInteger(index))risk.linkIndex=index;
    return risk;
  }

  function detectFullRestoreCloudLinkRisks(candidateAppData,options){
    options=isPlainObject(options)?options:{};
    var risks=[];
    var candidateIds=Object.create(null);
    if(Array.isArray(candidateAppData&&candidateAppData.conferences)){
      candidateAppData.conferences.forEach(function(conference){
        if(isPlainObject(conference)&&nonEmptyString(conference.id)){
          candidateIds[conference.id]=true;
        }
      });
    }
    var source=options.syncLinks;
    if(source===undefined||source===null)return risks;
    var links;
    if(Array.isArray(source)){
      links=source;
    }else if(isPlainObject(source)){
      links=Object.keys(source).map(function(key){return source[key];});
    }else{
      return [cloudRisk(
        'MALFORMED_SYNC_LINKS',
        null,
        'medium',
        'Stored cloud links are not in a recognized format.'
      )];
    }
    var seen=Object.create(null);
    links.forEach(function(link,index){
      if(!isPlainObject(link)||
        !nonEmptyString(link.localConferenceId)||
        !nonEmptyString(link.remoteConferenceId)){
        risks.push(cloudRisk(
          'MALFORMED_SYNC_LINK',
          link&&nonEmptyString(link.localConferenceId)
            ?link.localConferenceId
            :null,
          'medium',
          'A stored cloud link is malformed.',
          index
        ));
        return;
      }
      var localId=link.localConferenceId;
      if(seen[localId]){
        risks.push(cloudRisk(
          'DUPLICATE_CLOUD_LINK',
          localId,
          'high',
          'More than one cloud link exists for the same local conference.',
          index
        ));
      }
      seen[localId]=true;
      if(candidateIds[localId]){
        risks.push(cloudRisk(
          'CONFERENCE_HAS_EXISTING_CLOUD_LINK',
          localId,
          'high',
          'An imported conference id already has a local cloud link.',
          index
        ));
      }
    });
    return risks;
  }

  function isFullRestoreInProgress(){
    return restoreInProgress;
  }

  function getFullRestoreCloudReviewMarkerKey(){
    return CLOUD_REVIEW_MARKER_KEY;
  }

  function markerStorage(options){
    return options&&options.storage||global.localStorage;
  }

  function validateFullRestoreMarker(value){
    var valid=isPlainObject(value)&&
      value.version===1&&
      isValidIsoDate(value.createdAt)&&
      Array.isArray(value.restoredConferenceIds)&&
      value.restoredConferenceIds.every(nonEmptyString)&&
      (value.sourceBackupCreatedAt===null||
        isValidIsoDate(value.sourceBackupCreatedAt))&&
      (value.safetyBackupId===null||
        nonEmptyString(value.safetyBackupId));
    if(valid){
      var unique=[];
      value.restoredConferenceIds.forEach(function(id){
        if(unique.indexOf(id)<0)unique.push(id);
      });
      valid=unique.length===value.restoredConferenceIds.length;
    }
    return {
      valid:valid,
      errorCode:valid?null:'FULL_RESTORE_MARKER_INVALID'
    };
  }

  function getFullRestoreCloudReviewMarker(options){
    var storage=markerStorage(options);
    var raw;
    try{
      raw=storage&&storage.getItem(CLOUD_REVIEW_MARKER_KEY);
    }catch(error){
      return {
        pending:true,
        malformed:true,
        legacy:false,
        marker:null,
        errorCode:'FULL_RESTORE_MARKER_READ_FAILED'
      };
    }
    if(raw===null||raw===''){
      return {
        pending:false,
        malformed:false,
        legacy:false,
        marker:null
      };
    }
    if(raw==='1'){
      return {
        pending:true,
        malformed:false,
        legacy:true,
        marker:{
          version:0,
          createdAt:null,
          restoredConferenceIds:[],
          sourceBackupCreatedAt:null,
          safetyBackupId:null
        }
      };
    }
    try{
      var parsed=JSON.parse(raw);
      if(!validateFullRestoreMarker(parsed).valid){
        throw new Error('INVALID_MARKER');
      }
      return {
        pending:true,
        malformed:false,
        legacy:false,
        marker:cloneFullBackupValue(parsed)
      };
    }catch(error){
      return {
        pending:true,
        malformed:true,
        legacy:false,
        marker:null,
        errorCode:'FULL_RESTORE_MARKER_MALFORMED'
      };
    }
  }

  function setFullRestoreCloudReviewMarker(value,options){
    if(!validateFullRestoreMarker(value).valid){
      return {ok:false,status:'invalid'};
    }
    try{
      markerStorage(options).setItem(
        CLOUD_REVIEW_MARKER_KEY,
        JSON.stringify(cloneFullBackupValue(value))
      );
      return {ok:true,status:'saved',data:cloneFullBackupValue(value)};
    }catch(error){
      return {ok:false,status:'storage_error'};
    }
  }

  function clearFullRestoreCloudReviewMarker(options){
    try{
      markerStorage(options).removeItem(CLOUD_REVIEW_MARKER_KEY);
      return {ok:true,status:'cleared'};
    }catch(error){
      return {ok:false,status:'storage_error'};
    }
  }

  function isFullRestoreCloudReviewPending(options){
    return getFullRestoreCloudReviewMarker(options).pending;
  }

  function getManualRelinkConferenceIds(options){
    try{
      var raw=markerStorage(options).getItem(MANUAL_RELINK_STORAGE_KEY);
      if(!raw)return [];
      var value=JSON.parse(raw);
      return Array.isArray(value)?value.filter(nonEmptyString):[];
    }catch(error){
      return [];
    }
  }

  function setManualRelinkConferenceIds(ids,options){
    var unique=[];
    (ids||[]).forEach(function(id){
      if(nonEmptyString(id)&&unique.indexOf(id)<0)unique.push(id);
    });
    try{
      if(unique.length){
        markerStorage(options).setItem(
          MANUAL_RELINK_STORAGE_KEY,
          JSON.stringify(unique)
        );
      }else{
        markerStorage(options).removeItem(MANUAL_RELINK_STORAGE_KEY);
      }
      return {ok:true,status:'saved',data:unique};
    }catch(error){
      return {ok:false,status:'storage_error'};
    }
  }

  function isManualRelinkRequired(localConferenceId,options){
    return getManualRelinkConferenceIds(options)
      .indexOf(String(localConferenceId||''))>=0;
  }

  function clearManualRelinkRequirement(localConferenceId,options){
    var id=String(localConferenceId||'');
    return setManualRelinkConferenceIds(
      getManualRelinkConferenceIds(options).filter(function(value){
        return value!==id;
      }),
      options
    );
  }

  function normalizeSyncLinkCollection(syncLinks){
    if(!isPlainObject(syncLinks)){
      return {valid:false,entries:[]};
    }
    return {
      valid:true,
      entries:Object.keys(syncLinks).map(function(key){
        return {key:key,value:syncLinks[key]};
      })
    };
  }

  function buildPostRestoreCloudReview(candidateAppData,syncLinks,marker){
    var restoredIds=[];
    if(marker&&Array.isArray(marker.restoredConferenceIds)&&
      marker.restoredConferenceIds.length){
      marker.restoredConferenceIds.forEach(function(id){
        if(nonEmptyString(id)&&restoredIds.indexOf(id)<0)restoredIds.push(id);
      });
    }else if(Array.isArray(candidateAppData&&candidateAppData.conferences)){
      candidateAppData.conferences.forEach(function(conference){
        if(isPlainObject(conference)&&nonEmptyString(conference.id)&&
          restoredIds.indexOf(conference.id)<0){
          restoredIds.push(conference.id);
        }
      });
    }
    var restoredMap=Object.create(null);
    restoredIds.forEach(function(id){restoredMap[id]=true;});
    var normalized=normalizeSyncLinkCollection(syncLinks);
    var review={
      pending:true,
      restoredConferenceIds:restoredIds,
      affectedLinks:[],
      unaffectedLinks:[],
      malformedLinks:[],
      actionsRequired:true,
      syncLinksRootValid:normalized.valid
    };
    if(!normalized.valid)return review;
    normalized.entries.forEach(function(entry){
      var link=entry.value;
      if(!isValidSyncLink(entry.key,link)){
        review.malformedLinks.push({
          key:entry.key,
          value:link===undefined?null:cloneFullBackupValue(link)
        });
      }else if(restoredMap[link.localConferenceId]){
        review.affectedLinks.push(cloneFullBackupValue(link));
      }else{
        review.unaffectedLinks.push(cloneFullBackupValue(link));
      }
    });
    return review;
  }

  function isValidSyncLink(key,link){
    return isPlainObject(link)&&
      nonEmptyString(key)&&
      nonEmptyString(link.localConferenceId)&&
      link.localConferenceId===key&&
      isUuid(link.remoteConferenceId)&&
      LINK_STATUSES.indexOf(link.linkStatus)>=0&&
      Number.isInteger(link.knownRevision)&&link.knownRevision>=0;
  }

  function isValidQueueOperation(operation){
    return isPlainObject(operation)&&
      isUuid(operation.operationId)&&
      isUuid(operation.conferenceId)&&
      isUuid(operation.deviceId)&&
      nonEmptyString(operation.status)&&
      Number.isInteger(operation.baseRevision)&&operation.baseRevision>=0&&
      // Keep this condition identical to the active Sync Queue contract.
      operation.snapshot&&typeof operation.snapshot==='object'&&
      !Array.isArray(operation.snapshot)&&
      nonEmptyString(operation.schemaVersion)&&
      nonEmptyString(operation.appVersion)&&
      Number.isInteger(operation.attempts)&&operation.attempts>=0&&
      isValidIsoDate(operation.createdAt)&&
      isValidIsoDate(operation.updatedAt);
  }

  function isActiveQueueOperation(operation){
    return FINAL_QUEUE_STATUSES.indexOf(operation.status)<0;
  }

  function isSafePendingRemoteApplicationResult(result,localConferenceId){
    if(!result||typeof result!=='object')return false;
    if(result.ok===false&&result.status==='not_found')return true;
    if(result.ok!==true||result.status!=='applied'||
      !isPlainObject(result.data)||
      result.data.localConferenceId!==localConferenceId||
      result.data.status!=='applied'||
      !isPlainObject(result.data.applicationState)){
      return false;
    }
    return [
      'validationCompleted',
      'backupStored',
      'localSnapshotSaved',
      'linkFinalized',
      'pendingCompleted'
    ].every(function(flag){
      return result.data.applicationState[flag]===true;
    });
  }

  function readJsonStorageRoot(storage,key){
    var raw=storage.getItem(key);
    if(raw===null||raw==='')return {raw:raw,value:{}};
    var value=JSON.parse(raw);
    if(!isPlainObject(value))throw new Error('INVALID_STORAGE_ROOT');
    return {raw:raw,value:value};
  }

  function isValidLinkingAttemptsRoot(root){
    return Object.keys(root).every(function(key){
      var attempt=root[key];
      return isPlainObject(attempt)&&
        attempt.localConferenceId===key&&
        nonEmptyString(attempt.operationId)&&
        nonEmptyString(attempt.requestedConferenceId);
    });
  }

  function removeAffectedLinkingAttempts(localConferenceIds,options){
    options=isPlainObject(options)?options:{};
    var storage=options.storage||global.localStorage;
    var expectedRaw=options.expectedRaw;
    var before;
    try{
      before=readJsonStorageRoot(storage,LINKING_ATTEMPTS_STORAGE_KEY);
      if(before.raw!==expectedRaw){
        return {ok:false,status:'concurrent_change',rollback:null};
      }
      if(!isValidLinkingAttemptsRoot(before.value)){
        return {ok:false,status:'malformed',rollback:null};
      }
    }catch(error){
      return {ok:false,status:'malformed',rollback:null};
    }
    var next=cloneFullBackupValue(before.value);
    localConferenceIds.forEach(function(id){delete next[id];});
    var nextRaw=JSON.stringify(next);
    try{
      storage.setItem(LINKING_ATTEMPTS_STORAGE_KEY,nextRaw);
      var verified=readJsonStorageRoot(
        storage,
        LINKING_ATTEMPTS_STORAGE_KEY
      );
      if(!isValidLinkingAttemptsRoot(verified.value)||
        JSON.stringify(verified.value)!==nextRaw){
        throw new Error('VERIFY_FAILED');
      }
      return {
        ok:true,
        status:'removed',
        previousRaw:before.raw,
        value:next
      };
    }catch(error){
      var rollbackError=null;
      try{
        restoreRawStorage(
          storage,
          LINKING_ATTEMPTS_STORAGE_KEY,
          before.raw
        );
        if(storage.getItem(LINKING_ATTEMPTS_STORAGE_KEY)!==before.raw){
          throw new Error('ROLLBACK_VERIFY_FAILED');
        }
      }catch(restoreError){
        rollbackError='FULL_RESTORE_LINKING_ATTEMPTS_ROLLBACK_FAILED';
      }
      return {
        ok:false,
        status:rollbackError?'rollback_failed':'write_failed',
        rollback:{
          attempted:true,
          success:rollbackError===null,
          attemptsRestored:rollbackError===null,
          errorCode:rollbackError
        }
      };
    }
  }

  function cloudReviewFailure(code,stage,rollback,failSafe){
    return {
      success:false,
      errorCode:code,
      failedStage:stage,
      rollback:rollback||{attempted:false,success:false,errors:[]},
      markerCleared:false,
      syncRestarted:false,
      failSafe:failSafe||null
    };
  }

  function removeAffectedPostRestoreSyncLinks(review,options){
    options=isPlainObject(options)?options:{};
    var storage=options.storage||global.localStorage;
    var before=options.linksSnapshot||
      readJsonStorageRoot(storage,SYNC_LINKS_STORAGE_KEY);
    var next=cloneFullBackupValue(before.value);
    review.affectedLinks.forEach(function(link){
      delete next[link.localConferenceId];
    });
    try{
      storage.setItem(SYNC_LINKS_STORAGE_KEY,JSON.stringify(next));
      var verified=readJsonStorageRoot(storage,SYNC_LINKS_STORAGE_KEY);
      if(JSON.stringify(verified.value)!==JSON.stringify(next)){
        throw new Error('VERIFY_FAILED');
      }
      return {
        ok:true,
        removedConferenceIds:review.affectedLinks.map(function(link){
          return link.localConferenceId;
        }),
        previousRaw:before.raw,
        nextLinks:next
      };
    }catch(error){
      var rollbackErrors=[];
      try{
        restoreRawStorage(storage,SYNC_LINKS_STORAGE_KEY,before.raw);
      }catch(rollbackError){
        rollbackErrors.push({
          key:SYNC_LINKS_STORAGE_KEY,
          code:'STORAGE_ROLLBACK_FAILED'
        });
      }
      return {
        ok:false,
        status:'storage_error',
        previousRaw:before.raw,
        rollback:{
          attempted:true,
          success:rollbackErrors.length===0,
          linksRestored:rollbackErrors.length===0,
          errors:rollbackErrors
        }
      };
    }
  }

  function restoreRawStorage(storage,key,raw){
    if(raw===null||raw===undefined)storage.removeItem(key);
    else storage.setItem(key,raw);
  }

  function completePostRestoreCloudReview(options){
    options=isPlainObject(options)?options:{};
    if(cloudReviewInProgress){
      return Promise.resolve(cloudReviewFailure(
        'FULL_RESTORE_CLOUD_REVIEW_ALREADY_IN_PROGRESS',
        'lock'
      ));
    }
    cloudReviewInProgress=true;
    var storage=options.storage||global.localStorage;
    var queue=options.queue||global.OfflineSyncQueue;
    var pendingStore=options.pendingRemoteApplications||
      global.PendingRemoteApplicationStore;
    var indexedDb=options.indexedDb||global.AppIndexedDB;
    var integration=options.integration||global.OfflineFirstIntegration;
    var autoLinking=options.autoLinking||
      global.AutomaticConferenceLinking;
    var orchestrator=options.orchestrator||
      global.AutomaticSyncOrchestrator;
    var snapshots={};
    var review;
    var removed=[];
    var rollbackNeeded=false;
    var linkWriteRollback=null;
    var runtimeIsolationStarted=false;
    function rollback(){
      var errors=[];
      function restorePart(name,key,raw,validator){
        var restored=false;
        try{
          restoreRawStorage(storage,key,raw);
          var actual=storage.getItem(key);
          restored=actual===raw&&(!validator||validator(actual));
        }catch(error){}
        if(!restored){
          errors.push({key:key,part:name,code:'STORAGE_ROLLBACK_FAILED'});
        }
        return restored;
      }
      function validJsonRoot(raw,validator){
        if(raw===null||raw==='')return true;
        try{
          var parsed=JSON.parse(raw);
          return isPlainObject(parsed)&&(!validator||validator(parsed));
        }catch(error){
          return false;
        }
      }
      function validMarkerRaw(raw){
        if(raw==='1')return true;
        if(raw===null||raw==='')return false;
        try{return validateFullRestoreMarker(JSON.parse(raw)).valid;}
        catch(error){return false;}
      }
      var linksRestored=restorePart(
        'links',
        SYNC_LINKS_STORAGE_KEY,
        snapshots.links,
        function(raw){return validJsonRoot(raw,function(root){
          return Object.keys(root).every(function(key){
            return isValidSyncLink(key,root[key]);
          });
        });}
      );
      var attemptsRestored=restorePart(
        'attempts',
        LINKING_ATTEMPTS_STORAGE_KEY,
        snapshots.attempts,
        function(raw){
          return validJsonRoot(raw,isValidLinkingAttemptsRoot);
        }
      );
      var markerRestored=restorePart(
        'marker',
        CLOUD_REVIEW_MARKER_KEY,
        snapshots.marker,
        validMarkerRaw
      );
      var manualRelinkRestored=restorePart(
        'manual_relink',
        MANUAL_RELINK_STORAGE_KEY,
        snapshots.manualRelink,
        function(raw){
          if(raw===null||raw==='')return true;
          try{
            var ids=JSON.parse(raw);
            return Array.isArray(ids)&&ids.every(nonEmptyString);
          }catch(error){
            return false;
          }
        }
      );
      return {
        attempted:true,
        success:linksRestored&&attemptsRestored&&
          markerRestored&&manualRelinkRestored,
        linksRestored:linksRestored,
        attemptsRestored:attemptsRestored,
        markerRestored:markerRestored,
        manualRelinkRestored:manualRelinkRestored,
        manualRelinkPreserved:false,
        errors:errors
      };
    }
    return Promise.resolve().then(function(){
      var markerResult=getFullRestoreCloudReviewMarker({storage:storage});
      if(!markerResult.pending){
        return {alreadyCompleted:true};
      }
      if(markerResult.malformed){
        throw codedError(
          markerResult.errorCode||'FULL_RESTORE_MARKER_MALFORMED'
        );
      }
      snapshots.marker=storage.getItem(CLOUD_REVIEW_MARKER_KEY);
      var linkRoot;
      try{
        linkRoot=readJsonStorageRoot(storage,SYNC_LINKS_STORAGE_KEY);
      }catch(error){
        throw codedError('FULL_RESTORE_SYNC_LINKS_MALFORMED');
      }
      snapshots.links=linkRoot.raw;
      snapshots.attempts=storage.getItem(LINKING_ATTEMPTS_STORAGE_KEY);
      snapshots.manualRelink=storage.getItem(MANUAL_RELINK_STORAGE_KEY);
      var current=options.currentAppData;
      review=buildPostRestoreCloudReview(
        current,
        linkRoot.value,
        markerResult.marker
      );
      if(!review.syncLinksRootValid){
        throw codedError('FULL_RESTORE_SYNC_LINKS_MALFORMED');
      }
      if(review.malformedLinks.length){
        throw codedError('FULL_RESTORE_SYNC_LINKS_MALFORMED');
      }
      try{
        var attemptsRoot=readJsonStorageRoot(
          storage,
          LINKING_ATTEMPTS_STORAGE_KEY
        );
        if(!isValidLinkingAttemptsRoot(attemptsRoot.value)){
          throw new Error('INVALID_LINKING_ATTEMPTS');
        }
      }catch(error){
        throw codedError('FULL_RESTORE_LINKING_ATTEMPTS_MALFORMED');
      }
      if(!autoLinking||typeof autoLinking.initialize!=='function'||
        !orchestrator||typeof orchestrator.start!=='function'||
        typeof orchestrator.stop!=='function'){
        throw codedError('FULL_RESTORE_SYNC_RESTART_UNAVAILABLE');
      }
      var affectedRemoteIds=review.affectedLinks.map(function(link){
        return link.remoteConferenceId;
      });
      if(!queue||typeof queue.getAllOperations!=='function'){
        throw codedError('FULL_RESTORE_QUEUE_REVIEW_UNAVAILABLE');
      }
      return queue.getAllOperations().then(function(result){
        if(!result||!result.ok){
          throw codedError('FULL_RESTORE_QUEUE_REVIEW_FAILED');
        }
        var operations=result.data&&result.data.operations;
        if(!Array.isArray(operations)||
          operations.some(function(operation){
            return !isValidQueueOperation(operation);
          })){
          throw codedError('FULL_RESTORE_QUEUE_OPERATION_INVALID');
        }
        var active=operations.filter(function(operation){
          return affectedRemoteIds.indexOf(operation.conferenceId)>=0&&
            isActiveQueueOperation(operation);
        });
        if(active.length){
          var blocked=codedError('FULL_RESTORE_QUEUE_REVIEW_REQUIRED');
          blocked.operationCount=active.length;
          throw blocked;
        }
        if(!pendingStore||typeof pendingStore.get!=='function'){
          throw codedError(
            'FULL_RESTORE_PENDING_REMOTE_APPLICATION_REVIEW_UNAVAILABLE'
          );
        }
        return Promise.all(review.affectedLinks.map(function(link){
          return pendingStore.get(link.localConferenceId);
        }));
      }).then(function(pendingResults){
        if((pendingResults||[]).some(function(result){
          return result&&result.ok===true&&result.status==='pending';
        })){
          throw codedError(
            'FULL_RESTORE_PENDING_REMOTE_APPLICATION_REVIEW_REQUIRED'
          );
        }
        if(!Array.isArray(pendingResults)||
          pendingResults.length!==review.affectedLinks.length||
          pendingResults.some(function(result,index){
          return !isSafePendingRemoteApplicationResult(
            result,
            review.affectedLinks[index].localConferenceId
          );
        })){
          throw codedError(
            'FULL_RESTORE_PENDING_REMOTE_APPLICATION_REVIEW_FAILED'
          );
        }
        if(review.affectedLinks.length&&
          (!indexedDb||typeof indexedDb.getRecord!=='function')){
          throw codedError(
            'FULL_RESTORE_SYNC_METADATA_REVIEW_UNAVAILABLE'
          );
        }
        return Promise.all(review.affectedLinks.map(function(link){
          return indexedDb.getRecord('sync_metadata',link.localConferenceId)
            .catch(function(){
              throw codedError('FULL_RESTORE_SYNC_METADATA_REVIEW_FAILED');
            });
        }));
      }).then(function(syncMetadata){
        if((syncMetadata||[]).some(function(record){return !!record;})){
          throw codedError(
            'FULL_RESTORE_SYNC_METADATA_CLEANUP_UNAVAILABLE'
          );
        }
        var remoteRoot;
        try{
          remoteRoot=readJsonStorageRoot(storage,REMOTE_UPDATES_STORAGE_KEY);
        }catch(error){
          throw codedError('FULL_RESTORE_REMOTE_UPDATES_MALFORMED');
        }
        var affectedRemoteIds=review.affectedLinks.map(function(link){
          return link.remoteConferenceId;
        });
        if(affectedRemoteIds.some(function(id){
          return hasOwn(remoteRoot.value,id)&&
            !Array.isArray(remoteRoot.value[id]);
        })){
          throw codedError('FULL_RESTORE_REMOTE_UPDATES_MALFORMED');
        }
        if(affectedRemoteIds.some(function(id){
          return hasOwn(remoteRoot.value,id)&&
            Array.isArray(remoteRoot.value[id])&&remoteRoot.value[id].length;
        })){
          throw codedError(
            'FULL_RESTORE_REMOTE_UPDATE_CLEANUP_UNAVAILABLE'
          );
        }
        if(review.affectedLinks.length&&
          (!integration||
          typeof integration.removeConferenceSync!=='function'||
          typeof integration.clearRemoteUpdate!=='function')){
          throw codedError('FULL_RESTORE_RUNTIME_CLEANUP_UNAVAILABLE');
        }
        runtimeIsolationStarted=true;
        var stopResult=orchestrator.stop();
        if(stopResult&&stopResult.ok===false){
          throw codedError('FULL_RESTORE_SYNC_STOP_FAILED');
        }
        review.affectedLinks.forEach(function(link){
          if(integration&&
            typeof integration.removeConferenceSync==='function'){
            var removeResult=integration.removeConferenceSync(
              link.localConferenceId
            );
            if(removeResult&&removeResult.ok===false){
              throw codedError('FULL_RESTORE_RUNTIME_CLEANUP_FAILED');
            }
          }
          if(integration&&
            typeof integration.clearRemoteUpdate==='function'){
            var clearResult=integration.clearRemoteUpdate(
              link.remoteConferenceId
            );
            if(clearResult&&clearResult.ok===false){
              throw codedError('FULL_RESTORE_RUNTIME_CLEANUP_FAILED');
            }
          }
        });
        var linkResult=removeAffectedPostRestoreSyncLinks(review,{
          storage:storage,
          linksSnapshot:{raw:snapshots.links,value:
            readJsonStorageRoot(storage,SYNC_LINKS_STORAGE_KEY).value}
        });
        if(!linkResult.ok){
          linkWriteRollback=linkResult.rollback;
          throw codedError('FULL_RESTORE_SYNC_LINKS_WRITE_FAILED');
        }
        rollbackNeeded=true;
        removed=linkResult.removedConferenceIds;
        var attemptResult=removeAffectedLinkingAttempts(removed,{
          storage:storage,
          expectedRaw:snapshots.attempts
        });
        if(!attemptResult.ok){
          if(attemptResult.rollback&&
            attemptResult.rollback.success===false){
            linkWriteRollback=attemptResult.rollback;
          }
          throw codedError(
            attemptResult.status==='concurrent_change'
              ?'FULL_RESTORE_LINKING_ATTEMPTS_CHANGED'
              :'FULL_RESTORE_LINKING_ATTEMPT_CLEANUP_FAILED'
          );
        }
        var existingManual=getManualRelinkConferenceIds({storage:storage});
        var manualResult=setManualRelinkConferenceIds(
          existingManual.concat(removed),
          {storage:storage}
        );
        if(!manualResult.ok){
          throw codedError('FULL_RESTORE_MANUAL_RELINK_STATE_FAILED');
        }
        if(removed.some(function(id){
          return !isManualRelinkRequired(id,{storage:storage});
        })){
          throw codedError('FULL_RESTORE_MANUAL_RELINK_VERIFY_FAILED');
        }
        var cleared=clearFullRestoreCloudReviewMarker({storage:storage});
        if(!cleared.ok){
          throw codedError('FULL_RESTORE_MARKER_CLEAR_FAILED');
        }
        if(getFullRestoreCloudReviewMarker({storage:storage}).pending){
          throw codedError('FULL_RESTORE_MARKER_CLEAR_VERIFY_FAILED');
        }
        var autoResult=autoLinking.initialize();
        if(autoResult&&autoResult.ok===false){
          throw codedError('FULL_RESTORE_AUTOMATIC_LINKING_RESTART_FAILED');
        }
        return Promise.resolve(autoResult&&autoResult.promise).then(function(){
          var startResult=orchestrator.start();
          if(startResult&&startResult.ok===false){
            throw codedError('FULL_RESTORE_SYNC_RESTART_FAILED');
          }
          var finalLinks=readJsonStorageRoot(
            storage,
            SYNC_LINKS_STORAGE_KEY
          );
          var finalAttempts=readJsonStorageRoot(
            storage,
            LINKING_ATTEMPTS_STORAGE_KEY
          );
          if(getFullRestoreCloudReviewMarker({storage:storage}).pending||
            !Object.keys(finalLinks.value).every(function(key){
              return isValidSyncLink(key,finalLinks.value[key]);
            })||
            !isValidLinkingAttemptsRoot(finalAttempts.value)||
            removed.some(function(id){
              return hasOwn(finalLinks.value,id)||
                hasOwn(finalAttempts.value,id)||
                !isManualRelinkRequired(id,{storage:storage});
            })){
            throw codedError('FULL_RESTORE_FINAL_STATE_VERIFY_FAILED');
          }
          return {
            success:true,
            affectedLinkCount:review.affectedLinks.length,
            removedConferenceIds:removed,
            unaffectedLinkCount:review.unaffectedLinks.length,
            malformedLinkCount:review.malformedLinks.length,
            queueOperationsHandled:0,
            markerCleared:true,
            syncRestarted:true,
            requiresManualRelinking:removed.length>0
          };
        });
      });
    }).then(function(result){
      if(result&&result.alreadyCompleted){
        return {
          success:true,
          affectedLinkCount:0,
          removedConferenceIds:[],
          unaffectedLinkCount:0,
          malformedLinkCount:0,
          queueOperationsHandled:0,
          markerCleared:true,
          syncRestarted:false,
          requiresManualRelinking:false,
          alreadyCompleted:true
        };
      }
      return result;
    }).catch(function(error){
      var rollbackResult=rollbackNeeded
        ?rollback()
        :linkWriteRollback;
      var failSafe=null;
      if(runtimeIsolationStarted){
        failSafe={
          attempted:true,
          runtimeStopped:false,
          linksRestored:rollbackResult&&
            typeof rollbackResult.linksRestored==='boolean'
            ?rollbackResult.linksRestored
            :rollbackNeeded?false:true,
          attemptsRestored:rollbackResult&&
            typeof rollbackResult.attemptsRestored==='boolean'
            ?rollbackResult.attemptsRestored
            :true,
          markerRestored:false,
          manualRelinkPreserved:false,
          success:false
        };
        try{
          var stoppedResult=orchestrator.stop();
          failSafe.runtimeStopped=!stoppedResult||
            stoppedResult.ok!==false;
        }catch(stopError){}
        var isolatedIds=removed.length
          ?removed
          :review&&review.affectedLinks.map(function(link){
            return link.localConferenceId;
          })||[];
        var markerRestored=getFullRestoreCloudReviewMarker({storage:storage});
        var markerRaw=null;
        try{markerRaw=storage.getItem(CLOUD_REVIEW_MARKER_KEY);}
        catch(markerReadError){}
        if((!markerRestored.pending||markerRestored.malformed||
          markerRaw!==snapshots.marker)&&snapshots.marker!==undefined){
          try{
            restoreRawStorage(
              storage,
              CLOUD_REVIEW_MARKER_KEY,
              snapshots.marker
            );
          }catch(markerError){}
        }
        markerRestored=getFullRestoreCloudReviewMarker({storage:storage});
        try{markerRaw=storage.getItem(CLOUD_REVIEW_MARKER_KEY);}
        catch(markerVerifyError){markerRaw=null;}
        failSafe.markerRestored=markerRestored.pending&&
          !markerRestored.malformed&&markerRaw===snapshots.marker;
        setManualRelinkConferenceIds(
          getManualRelinkConferenceIds({storage:storage}).concat(isolatedIds),
          {storage:storage}
        );
        failSafe.manualRelinkPreserved=true;
        isolatedIds.forEach(function(id){
          if(!isManualRelinkRequired(id,{storage:storage})){
            failSafe.manualRelinkPreserved=false;
          }
        });
        failSafe.success=failSafe.runtimeStopped&&
          failSafe.linksRestored&&
          failSafe.attemptsRestored&&
          failSafe.markerRestored&&
          failSafe.manualRelinkPreserved;
        if(rollbackResult){
          rollbackResult.markerRestored=failSafe.markerRestored;
          rollbackResult.manualRelinkPreserved=
            failSafe.manualRelinkPreserved;
          rollbackResult.success=rollbackResult.success&&
            failSafe.markerRestored&&failSafe.manualRelinkPreserved;
        }
      }
      var failure=cloudReviewFailure(
        error&&error.code||'FULL_RESTORE_CLOUD_REVIEW_FAILED',
        error&&error.code==='FULL_RESTORE_SYNC_LINKS_WRITE_FAILED'
          ?'sync_links_write'
          :'review',
        rollbackResult,
        failSafe
      );
      if(failSafe&&!failSafe.success){
        failure.originalErrorCode=failure.errorCode;
        failure.errorCode='FULL_RESTORE_FAIL_SAFE_FAILED';
      }
      return failure;
    }).finally(function(){
      cloudReviewInProgress=false;
    });
  }

  function isPostRestoreCloudReviewInProgress(){
    return cloudReviewInProgress;
  }

  function restoreDependencies(options){
    options=isPlainObject(options)?options:{};
    return {
      repository:options.repository||global.StorageRepository,
      storage:options.storage||global.localStorage,
      normalizer:options.normalizeCandidate||
        global.normalizeAppDataCandidate,
      orchestrator:options.orchestrator||
        global.AutomaticSyncOrchestrator,
      applyAppData:options.applyAppData||function(value){
        global.appData=value;
      },
      storageKey:options.storageKey||FULL_RESTORE_STORAGE_KEY,
      markerKey:options.markerKey||CLOUD_REVIEW_MARKER_KEY
    };
  }

  function createPreRestoreSafetyBackup(currentAppData,options){
    var dependencies=restoreDependencies(options);
    if(!dependencies.repository||
      typeof dependencies.repository.createLocalBackup!=='function'){
      return Promise.reject(codedError(
        'FULL_RESTORE_SAFETY_BACKUP_UNAVAILABLE',
        'The local safety backup API is unavailable.'
      ));
    }
    var snapshot=cloneFullBackupValue(currentAppData);
    return Promise.resolve().then(function(){
      return dependencies.repository.createLocalBackup(
        snapshot,
        'before_full_restore'
      );
    }).then(function(backup){
      if(!backup||!nonEmptyString(backup.backupId)){
        throw codedError(
          'FULL_RESTORE_SAFETY_BACKUP_FAILED',
          'The local safety backup was not confirmed.'
        );
      }
      return {
        created:true,
        id:backup.backupId,
        record:cloneFullBackupValue(backup)
      };
    }).catch(function(error){
      if(error&&
        (error.code==='FULL_RESTORE_SAFETY_BACKUP_UNAVAILABLE'||
        error.code==='FULL_RESTORE_SAFETY_BACKUP_FAILED')){
        throw error;
      }
      throw codedError(
        'FULL_RESTORE_SAFETY_BACKUP_FAILED',
        'The local safety backup could not be created.'
      );
    });
  }

  function readRestorePersistenceContext(dependencies){
    var localValue=null;
    var markerValue=null;
    try{
      localValue=dependencies.storage.getItem(dependencies.storageKey);
      markerValue=dependencies.storage.getItem(dependencies.markerKey);
    }catch(error){
      throw codedError('FULL_RESTORE_LOCAL_STORAGE_READ_FAILED',
        'Current local persistence state could not be read.');
    }
    return {
      previousLocalValue:localValue,
      previousMarkerValue:markerValue,
      indexedDbWritten:false,
      localStorageWritten:false,
      markerWritten:false,
      globalApplyAttempted:false,
      globalApplied:false
    };
  }

  function persistFullRestoreCandidate(candidateAppData,options){
    var dependencies=restoreDependencies(options);
    var context=options&&options.rollbackContext;
    if(!context)context=readRestorePersistenceContext(dependencies);
    if(!dependencies.repository||
      typeof dependencies.repository.saveAppSnapshot!=='function'||
      typeof dependencies.repository.getAppSnapshot!=='function'){
      return Promise.reject(codedError(
        'FULL_RESTORE_PERSISTENCE_UNAVAILABLE',
        'The application snapshot persistence API is unavailable.'
      ));
    }
    if(!dependencies.storage||
      typeof dependencies.storage.setItem!=='function'||
      typeof dependencies.storage.getItem!=='function'){
      return Promise.reject(codedError(
        'FULL_RESTORE_LOCAL_STORAGE_UNAVAILABLE',
        'Local storage is unavailable.'
      ));
    }
    var candidate=cloneFullBackupValue(candidateAppData);
    var json;
    var markerJson;
    var markerValue=options.markerValue||{
      version:1,
      createdAt:new Date().toISOString(),
      restoredConferenceIds:candidate.conferences.map(function(item){
        return item.id;
      }),
      sourceBackupCreatedAt:null,
      safetyBackupId:null
    };
    if(!validateFullRestoreMarker(markerValue).valid){
      return Promise.reject(codedError(
        'FULL_RESTORE_MARKER_INVALID',
        'The restore marker does not match the required contract.'
      ));
    }
    try{
      json=JSON.stringify(candidate);
      markerJson=JSON.stringify(markerValue);
    }catch(error){
      return Promise.reject(codedError(
        'FULL_RESTORE_SERIALIZATION_FAILED',
        'The restore candidate could not be serialized.'
      ));
    }
    return Promise.resolve().then(function(){
      return dependencies.repository.saveAppSnapshot(candidate,{
        skipSyncQueue:true,
        source:'full_restore'
      });
    }).then(function(){
      context.indexedDbWritten=true;
      try{
        dependencies.storage.setItem(dependencies.storageKey,json);
        context.localStorageWritten=true;
        dependencies.storage.setItem(
          dependencies.markerKey,
          markerJson
        );
        context.markerWritten=true;
      }catch(error){
        var storageError=codedError(
          'FULL_RESTORE_LOCAL_STORAGE_WRITE_FAILED',
          'The restore candidate could not be written to local storage.'
        );
        storageError.failedStage='local_storage_write';
        throw storageError;
      }
      return dependencies.repository.getAppSnapshot();
    }).then(function(snapshot){
      var indexedJson;
      try{
        indexedJson=JSON.stringify(snapshot&&snapshot.data);
      }catch(error){
        indexedJson='';
      }
      var localJson;
      var storedMarkerJson;
      try{
        localJson=dependencies.storage.getItem(dependencies.storageKey);
        storedMarkerJson=dependencies.storage.getItem(
          dependencies.markerKey
        );
      }catch(error){
        localJson=null;
        storedMarkerJson=null;
      }
      if(indexedJson!==json||localJson!==json||
        storedMarkerJson!==markerJson){
        var verificationError=codedError(
          'FULL_RESTORE_VERIFICATION_MISMATCH',
          'The persisted restore candidate did not match the source.'
        );
        verificationError.failedStage='verification';
        throw verificationError;
      }
      var parsedMarker;
      try{
        parsedMarker=JSON.parse(storedMarkerJson);
      }catch(error){
        parsedMarker=null;
      }
      if(!validateFullRestoreMarker(parsedMarker).valid){
        var markerError=codedError(
          'FULL_RESTORE_MARKER_INVALID',
          'The persisted restore marker is invalid.'
        );
        markerError.failedStage='verification';
        throw markerError;
      }
      return {
        indexedDb:true,
        localStorage:true,
        verified:true,
        rollbackContext:context
      };
    }).catch(function(error){
      if(!error.failedStage){
        error.failedStage=context.indexedDbWritten
          ?'verification'
          :'indexeddb_write';
      }
      throw error;
    });
  }

  function restoreStorageValue(storage,key,value){
    if(value===null||value===undefined){
      if(typeof storage.removeItem==='function')storage.removeItem(key);
      else storage.setItem(key,'');
    }else{
      storage.setItem(key,value);
    }
  }

  function rollbackFullRestore(previousAppData,rollbackContext,options){
    var dependencies=restoreDependencies(options);
    var errors=[];
    var previous=cloneFullBackupValue(previousAppData);
    var indexedPromise=Promise.resolve().then(function(){
      if(!dependencies.repository||
        typeof dependencies.repository.saveAppSnapshot!=='function'){
        throw new Error('ROLLBACK_INDEXEDDB_UNAVAILABLE');
      }
      return dependencies.repository.saveAppSnapshot(previous,{
        skipSyncQueue:true,
        source:'full_restore_rollback'
      });
    }).catch(function(error){
      errors.push({
        stage:'indexeddb_rollback',
        code:'FULL_RESTORE_INDEXEDDB_ROLLBACK_FAILED'
      });
    });
    return indexedPromise.then(function(){
      try{
        restoreStorageValue(
          dependencies.storage,
          dependencies.storageKey,
          rollbackContext.previousLocalValue
        );
        restoreStorageValue(
          dependencies.storage,
          dependencies.markerKey,
          rollbackContext.previousMarkerValue
        );
      }catch(error){
        errors.push({
          stage:'local_storage_rollback',
          code:'FULL_RESTORE_LOCAL_STORAGE_ROLLBACK_FAILED'
        });
      }
      if(rollbackContext.globalApplyAttempted||
        rollbackContext.globalApplied){
        try{
          dependencies.applyAppData(cloneFullBackupValue(previous));
        }catch(error){
          errors.push({
            stage:'global_state_rollback',
            code:'FULL_RESTORE_GLOBAL_ROLLBACK_FAILED',
            message:error&&error.message
              ?String(error.message)
              :'Global application state rollback failed.'
          });
        }
      }
      return {
        attempted:true,
        success:errors.length===0,
        errors:errors
      };
    });
  }

  function restoreFailure(error,failedStage,rollback,safetyBackup){
    return {
      success:false,
      errorCode:error&&error.code
        ?error.code
        :'FULL_RESTORE_FAILED',
      errorMessage:error&&error.message
        ?String(error.message)
        :'Full restore failed.',
      failedStage:failedStage||error&&error.failedStage||'unknown',
      rollback:rollback||{
        attempted:false,
        success:false,
        errors:[]
      },
      safetyBackup:safetyBackup||{
        created:false,
        id:null
      }
    };
  }

  function executeFullRestore(restoreInput,options){
    options=isPlainObject(options)?options:{};
    if(restoreInProgress){
      return Promise.resolve(restoreFailure(
        codedError('FULL_RESTORE_ALREADY_IN_PROGRESS'),
        'lock'
      ));
    }
    restoreInProgress=true;
    var dependencies=restoreDependencies(options);
    var previousAppData=null;
    var rollbackContext=null;
    var safetyBackup=null;
    var stopped=false;
    var writesStarted=false;
    function restartAfterFailure(){
      if(stopped&&dependencies.orchestrator&&
        typeof dependencies.orchestrator.start==='function'){
        try{dependencies.orchestrator.start();}catch(error){}
      }
    }
    return Promise.resolve().then(function(){
      if(!restoreInput||restoreInput.confirmed!==true){
        throw codedError('FULL_RESTORE_CONFIRMATION_REQUIRED',
          'Explicit restore confirmation is required.');
      }
      var document=restoreInput.backupDocument;
      var validation=validateFullBackupDocument(document);
      if(!validation.valid){
        throw codedError('FULL_BACKUP_DOCUMENT_INVALID',
          validation.errors.map(function(error){return error.code;}).join(', '));
      }
      var supplied=restoreInput.candidateResult;
      if(!supplied||!isPlainObject(supplied.candidateAppData)){
        throw codedError('FULL_RESTORE_CANDIDATE_INVALID',
          'A prepared restore candidate is required.');
      }
      if(Array.isArray(supplied.errors)&&supplied.errors.length){
        throw codedError('FULL_RESTORE_CANDIDATE_HAS_ERRORS',
          supplied.errors.map(function(error){return error.code;}).join(', '));
      }
      var supported=options.supportedDataSchemaVersion||
        options.currentAppData&&options.currentAppData.version;
      var fresh=prepareFullRestoreCandidate(document,{
        supportedDataSchemaVersion:supported
      });
      if(fresh.errors.length){
        throw codedError('FULL_RESTORE_CANDIDATE_HAS_ERRORS',
          fresh.errors.map(function(error){return error.code;}).join(', '));
      }
      if(typeof dependencies.normalizer!=='function'){
        throw codedError('FULL_RESTORE_NORMALIZER_UNAVAILABLE',
          'Candidate normalization is unavailable.');
      }
      var normalized=dependencies.normalizer(
        cloneFullBackupValue(fresh.candidateAppData)
      );
      if(!isPlainObject(normalized)){
        throw codedError('FULL_RESTORE_NORMALIZATION_FAILED',
          'Candidate normalization returned invalid data.');
      }
      cloneFullBackupValue(normalized);
      var normalizedDocument=buildFullBackupDocument(normalized,{
        createdAt:document.createdAt,
        appVersion:document.appVersion
      });
      var normalizedCheck=prepareFullRestoreCandidate(normalizedDocument,{
        supportedDataSchemaVersion:supported
      });
      if(normalizedCheck.errors.length){
        throw codedError('FULL_RESTORE_NORMALIZED_CANDIDATE_INVALID',
          normalizedCheck.errors.map(function(error){return error.code;}).join(', '));
      }
      previousAppData=cloneFullBackupValue(options.currentAppData);
      rollbackContext=readRestorePersistenceContext(dependencies);
      if(dependencies.orchestrator&&
        typeof dependencies.orchestrator.stop==='function'){
        dependencies.orchestrator.stop();
        stopped=true;
      }
      return createPreRestoreSafetyBackup(previousAppData,options)
        .then(function(backup){
          safetyBackup=backup;
          writesStarted=true;
          return persistFullRestoreCandidate(normalizedCheck.candidateAppData,
            Object.assign({},options,{
              rollbackContext:rollbackContext,
              markerValue:{
                version:1,
                createdAt:new Date().toISOString(),
                restoredConferenceIds:
                  normalizedCheck.candidateAppData.conferences.map(
                    function(conference){return conference.id;}
                  ),
                sourceBackupCreatedAt:document.createdAt,
                safetyBackupId:safetyBackup.id
              }
            }));
        }).then(function(persistence){
          rollbackContext.globalApplyAttempted=true;
          dependencies.applyAppData(
            cloneFullBackupValue(normalizedCheck.candidateAppData)
          );
          rollbackContext.globalApplied=true;
          return {
            success:true,
            restoredAt:new Date().toISOString(),
            sourceBackupCreatedAt:document.createdAt,
            summary:buildFullBackupSummary(
              normalizedCheck.candidateAppData
            ),
            safetyBackup:{
              created:true,
              id:safetyBackup.id
            },
            persistence:{
              indexedDb:persistence.indexedDb,
              localStorage:persistence.localStorage,
              verified:persistence.verified
            },
            reloadRequired:true
          };
        });
    }).catch(function(error){
      if(!writesStarted){
        restartAfterFailure();
        return restoreFailure(
          error,
          error.failedStage||
            (error.code&&error.code.indexOf('SAFETY_BACKUP')>=0
              ?'safety_backup'
              :'precondition'),
          null,
          safetyBackup
        );
      }
      return rollbackFullRestore(
        previousAppData,
        rollbackContext,
        options
      ).then(function(rollback){
        return restoreFailure(
          error,
          error.failedStage,
          rollback,
          safetyBackup
        );
      });
    }).finally(function(){
      restoreInProgress=false;
    });
  }

  global.FullBackupService=Object.freeze({
    getSupportedFullBackupFormatVersion:getSupportedFullBackupFormatVersion,
    getFullBackupType:getFullBackupType,
    cloneFullBackupValue:cloneFullBackupValue,
    buildFullBackupSummary:buildFullBackupSummary,
    buildFullBackupDocument:buildFullBackupDocument,
    validateFullBackupDocument:validateFullBackupDocument,
    isFullBackupDocument:isFullBackupDocument,
    getFullBackupFileName:getFullBackupFileName,
    serializeFullBackupDocument:serializeFullBackupDocument,
    downloadFullBackupDocument:downloadFullBackupDocument,
    createAndDownloadFullBackup:createAndDownloadFullBackup,
    getMaximumFullBackupFileSize:getMaximumFullBackupFileSize,
    validateFullBackupFileInput:validateFullBackupFileInput,
    readFullBackupFile:readFullBackupFile,
    prepareFullRestoreCandidate:prepareFullRestoreCandidate,
    buildFullRestorePreview:buildFullRestorePreview,
    detectFullRestoreCloudLinkRisks:detectFullRestoreCloudLinkRisks,
    isFullRestoreInProgress:isFullRestoreInProgress,
    getFullRestoreCloudReviewMarkerKey:getFullRestoreCloudReviewMarkerKey,
    createPreRestoreSafetyBackup:createPreRestoreSafetyBackup,
    persistFullRestoreCandidate:persistFullRestoreCandidate,
    rollbackFullRestore:rollbackFullRestore,
    executeFullRestore:executeFullRestore,
    getFullRestoreCloudReviewMarker:getFullRestoreCloudReviewMarker,
    validateFullRestoreMarker:validateFullRestoreMarker,
    setFullRestoreCloudReviewMarker:setFullRestoreCloudReviewMarker,
    clearFullRestoreCloudReviewMarker:clearFullRestoreCloudReviewMarker,
    isFullRestoreCloudReviewPending:isFullRestoreCloudReviewPending,
    getManualRelinkConferenceIds:getManualRelinkConferenceIds,
    setManualRelinkConferenceIds:setManualRelinkConferenceIds,
    isManualRelinkRequired:isManualRelinkRequired,
    clearManualRelinkRequirement:clearManualRelinkRequirement,
    buildPostRestoreCloudReview:buildPostRestoreCloudReview,
    removeAffectedPostRestoreSyncLinks:
      removeAffectedPostRestoreSyncLinks,
    completePostRestoreCloudReview:completePostRestoreCloudReview,
    isPostRestoreCloudReviewInProgress:
      isPostRestoreCloudReviewInProgress
  });
})(window);
