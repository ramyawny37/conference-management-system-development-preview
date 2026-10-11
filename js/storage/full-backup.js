(function(global){
  'use strict';

  var BACKUP_TYPE='conference-manager-full-backup';
  var FORMAT_VERSION=1;
  var MAXIMUM_FILE_SIZE=100*1024*1024;
  var restoreInProgress=false;
  var EXCLUDED=Object.freeze([
    'supabaseConfig',
    'supabaseSession',
    'deviceIdentity'
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

  function isFullRestoreInProgress(){
    return restoreInProgress;
  }


  function restoreDependencies(options){
    options=isPlainObject(options)?options:{};
    return {
      repository:options.repository||global.StorageRepository,
      normalizer:options.normalizeCandidate||
        global.normalizeAppDataCandidate,
      applyAppData:options.applyAppData||function(value){
        global.appData=value;
      }
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
    return {
      indexedDbWritten:false,
      globalApplyAttempted:false,
      globalApplied:false
    };
  }

  function persistFullRestoreCandidate(candidateAppData,options){
    var dependencies=restoreDependencies(options);
    var context=options&&options.rollbackContext;
    if(!context)context=readRestorePersistenceContext(dependencies);
    if(!dependencies.repository||
      typeof dependencies.repository.saveAppData!=='function'||
      typeof dependencies.repository.getAppData!=='function'){
      return Promise.reject(codedError(
        'FULL_RESTORE_PERSISTENCE_UNAVAILABLE',
        'The application persistence API is unavailable.'
      ));
    }
    var candidate=cloneFullBackupValue(candidateAppData);
    try{
      JSON.stringify(candidate);
    }catch(error){
      return Promise.reject(codedError(
        'FULL_RESTORE_SERIALIZATION_FAILED',
        'The restore candidate could not be serialized.'
      ));
    }
    return Promise.resolve().then(function(){
      return dependencies.repository.saveAppData(candidate,{
        skipTemplateSync:true,
        source:'full_restore'
      });
    }).then(function(){
      context.indexedDbWritten=true;
      return dependencies.repository.getAppData();
    }).then(function(record){
      var indexedJson;
      try{
        indexedJson=JSON.stringify(record&&record.data);
      }catch(error){
        indexedJson='';
      }
      if(!record||!isPlainObject(record.data)||!indexedJson){
        var verificationError=codedError(
          'FULL_RESTORE_VERIFICATION_MISMATCH',
          'The persisted restore candidate did not match the source.'
        );
        verificationError.failedStage='verification';
        throw verificationError;
      }
      return {
        indexedDb:true,
        verified:true,
        data:cloneFullBackupValue(record.data),
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

  function rollbackFullRestore(previousAppData,rollbackContext,options){
    var dependencies=restoreDependencies(options);
    var errors=[];
    var previous=cloneFullBackupValue(previousAppData);
    var indexedPromise=Promise.resolve().then(function(){
      if(!dependencies.repository||
        typeof dependencies.repository.saveAppData!=='function'){
        throw new Error('ROLLBACK_INDEXEDDB_UNAVAILABLE');
      }
      return dependencies.repository.saveAppData(previous,{
        source:'full_restore_rollback'
      });
    }).catch(function(error){
      errors.push({
        stage:'indexeddb_rollback',
        code:'FULL_RESTORE_INDEXEDDB_ROLLBACK_FAILED'
      });
    });
    return indexedPromise.then(function(){
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
    var writesStarted=false;
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
      return createPreRestoreSafetyBackup(previousAppData,options)
        .then(function(backup){
          safetyBackup=backup;
          writesStarted=true;
          return persistFullRestoreCandidate(normalizedCheck.candidateAppData,
            Object.assign({},options,{rollbackContext:rollbackContext}));
        }).then(function(persistence){
          rollbackContext.globalApplyAttempted=true;
          dependencies.applyAppData(
            cloneFullBackupValue(persistence.data)
          );
          rollbackContext.globalApplied=true;
          return {
            success:true,
            restoredAt:new Date().toISOString(),
            sourceBackupCreatedAt:document.createdAt,
            summary:buildFullBackupSummary(
              persistence.data
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
    isFullRestoreInProgress:isFullRestoreInProgress,
    createPreRestoreSafetyBackup:createPreRestoreSafetyBackup,
    persistFullRestoreCandidate:persistFullRestoreCandidate,
    rollbackFullRestore:rollbackFullRestore,
    executeFullRestore:executeFullRestore
  });
})(window);
