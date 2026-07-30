'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');

function load(){
  var sandbox={
    window:null,
    Date:Date,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Error:Error
  };
  sandbox.window=sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(root,'js/storage/full-backup.js'),'utf8'),
    sandbox,
    {filename:'full-backup.js'}
  );
  return sandbox.FullBackupService;
}

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function appData(){
  return {
    version:'2.0.0',
    currentConferenceId:'conference-1',
    conferences:[{id:'conference-1',name:'Conference'}],
    templates:[{id:'template-1'}],
    archives:[],
    backups:[{id:'backup-1'}],
    houseTemplates:[{id:'house-template-1'}],
    peopleDb:{version:'1.0.0',people:[{id:'person-1'}]},
    trash:{templates:[],archives:[],backups:[],houseTemplates:[],rooms:[]}
  };
}

function hasCode(issues,code){
  return issues.some(function(issue){return issue.code===code;});
}

function testValidDocument(api){
  var document=api.buildFullBackupDocument(appData(),{
    createdAt:'2026-07-30T10:00:00.000Z',
    appVersion:'3.1.1'
  });
  var result=api.validateFullBackupDocument(document);
  assert.strictEqual(result.valid,true);
  assert.deepStrictEqual(plain(result.errors),[]);
  assert.strictEqual(api.isFullBackupDocument(document),true);
  assert.deepStrictEqual(plain(document.summary),{
    conferenceCount:1,
    templateCount:1,
    archiveCount:0,
    internalBackupCount:1,
    houseTemplateCount:1,
    peopleCount:1,
    currentConferenceId:'conference-1'
  });
}

function testBuilderDoesNotMutateOrShare(api){
  var source=appData();
  var before=JSON.stringify(source);
  var document=api.buildFullBackupDocument(source,{
    createdAt:'2026-07-30T10:00:00.000Z',
    appVersion:'test'
  });
  assert.strictEqual(JSON.stringify(source),before);
  document.data.appData.conferences[0].name='Changed';
  document.data.appData.peopleDb.people.push({id:'person-2'});
  assert.strictEqual(source.conferences[0].name,'Conference');
  assert.strictEqual(source.peopleDb.people.length,1);
}

function testValidationFailures(api){
  var document=api.buildFullBackupDocument(appData(),{
    createdAt:'2026-07-30T10:00:00.000Z',
    appVersion:'test'
  });
  var changed=plain(document);
  changed.backupType='wrong';
  assert.strictEqual(
    hasCode(api.validateFullBackupDocument(changed).errors,'BACKUP_TYPE_INVALID'),
    true
  );

  changed=plain(document);
  changed.formatVersion=2;
  assert.strictEqual(
    hasCode(
      api.validateFullBackupDocument(changed).errors,
      'UNSUPPORTED_NEWER_FORMAT'
    ),
    true
  );

  changed=plain(document);
  changed.formatVersion='1';
  assert.strictEqual(
    hasCode(api.validateFullBackupDocument(changed).errors,
      'FORMAT_VERSION_INVALID'),
    true
  );

  changed=plain(document);
  changed.createdAt='not-a-date';
  assert.strictEqual(
    hasCode(api.validateFullBackupDocument(changed).errors,
      'CREATED_AT_INVALID'),
    true
  );

  changed=plain(document);
  changed.data.appData.conferences={};
  assert.strictEqual(
    hasCode(api.validateFullBackupDocument(changed).errors,
      'CONFERENCES_INVALID'),
    true
  );

  changed=plain(document);
  changed.data.appData.currentConferenceId='missing';
  assert.strictEqual(
    hasCode(api.validateFullBackupDocument(changed).errors,
      'CURRENT_CONFERENCE_NOT_FOUND'),
    true
  );
}

function testOptionalFieldsAndSummaryWarning(api){
  var minimal={
    version:'2.0.0',
    currentConferenceId:null,
    conferences:[]
  };
  var document=api.buildFullBackupDocument(minimal,{
    createdAt:'2026-07-30T10:00:00.000Z',
    appVersion:'test'
  });
  assert.strictEqual(api.validateFullBackupDocument(document).valid,true);
  document.summary.conferenceCount=9;
  var result=api.validateFullBackupDocument(document);
  assert.strictEqual(result.valid,true);
  assert.strictEqual(hasCode(result.warnings,'SUMMARY_MISMATCH'),true);
}

function testSensitiveMetadataWarning(api){
  var document=api.buildFullBackupDocument(appData(),{
    createdAt:'2026-07-30T10:00:00.000Z',
    appVersion:'test'
  });
  document.metadata={supabaseConfig:{url:'example'}};
  document.data.configuration={deviceIdentity:{id:'device-1'}};
  document.accessToken='test-token';
  var result=api.validateFullBackupDocument(document);
  assert.strictEqual(result.valid,true);
  assert.strictEqual(hasCode(result.warnings,'SENSITIVE_METADATA_KEY'),true);
}

function testPrototypePollutionRejected(api){
  var document=api.buildFullBackupDocument(appData(),{
    createdAt:'2026-07-30T10:00:00.000Z',
    appVersion:'test'
  });
  var polluted=JSON.parse(JSON.stringify(document));
  polluted.data.appData.conferences[0].constructor={dangerous:true};
  var result=api.validateFullBackupDocument(polluted);
  assert.strictEqual(result.valid,false);
  assert.strictEqual(hasCode(result.errors,'FORBIDDEN_OBJECT_KEY'),true);

  var input=appData();
  input.conferences[0].prototype={dangerous:true};
  assert.throws(function(){
    api.buildFullBackupDocument(input);
  },/FULL_BACKUP_FORBIDDEN_KEY/);
}

function testJsonRoundTripAndNoExternalConfiguration(api){
  var source=appData();
  var sandboxConfiguration={
    supabaseConfig:{url:'https://example.supabase.co'},
    deviceIdentity:{id:'device-1'}
  };
  var document=api.buildFullBackupDocument(source,{
    createdAt:'2026-07-30T10:00:00.000Z',
    appVersion:'test'
  });
  var json=JSON.stringify(document);
  var restored=JSON.parse(json);
  assert.strictEqual(api.validateFullBackupDocument(restored).valid,true);
  assert.strictEqual(json.indexOf(sandboxConfiguration.supabaseConfig.url),-1);
  assert.strictEqual(json.indexOf(sandboxConfiguration.deviceIdentity.id),-1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(
    restored.data,'localPreferences'
  ),false);
}

function testBuilderInputRulesAndFallback(api){
  assert.throws(function(){
    api.buildFullBackupDocument([]);
  },/FULL_BACKUP_APP_DATA_INVALID/);
  assert.throws(function(){
    api.buildFullBackupDocument({version:'',conferences:[]});
  },/FULL_BACKUP_SCHEMA_VERSION_REQUIRED/);
  assert.throws(function(){
    api.buildFullBackupDocument({version:'1',conferences:{}});
  },/FULL_BACKUP_CONFERENCES_INVALID/);
  var source={version:'1',conferences:[]};
  var document=api.buildFullBackupDocument(source,{
    createdAt:'2026-07-30T10:00:00.000Z'
  });
  assert.strictEqual(document.appVersion,'unknown');
  assert.strictEqual(document.data.appData.currentConferenceId,null);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(source,'currentConferenceId'),
    false
  );
}

function run(){
  var api=load();
  testValidDocument(api);
  testBuilderDoesNotMutateOrShare(api);
  testValidationFailures(api);
  testOptionalFieldsAndSummaryWarning(api);
  testSensitiveMetadataWarning(api);
  testPrototypePollutionRejected(api);
  testJsonRoundTripAndNoExternalConfiguration(api);
  testBuilderInputRulesAndFallback(api);
  console.log('Full backup phase 1 tests passed.');
}

run();
