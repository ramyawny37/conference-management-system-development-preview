'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');

function load(extra){
  var sandbox=Object.assign({
    window:null,
    Date:Date,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Error:Error,
    Promise:Promise
  },extra||{});
  sandbox.window=sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(root,'js/storage/full-backup.js'),'utf8'),
    sandbox,
    {filename:'full-backup.js'}
  );
  return {api:sandbox.FullBackupService,sandbox:sandbox};
}

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function data(overrides){
  return Object.assign({
    version:'2.0.0',
    currentConferenceId:'conference-1',
    conferences:[{id:'conference-1',name:'First'}],
    templates:[{id:'template-1'}],
    archives:[],
    backups:[],
    houseTemplates:[{id:'house-template-1'}],
    peopleDb:{version:'1.0.0',people:[{id:'person-1'}]}
  },overrides||{});
}

function documentFor(api,appData,overrides){
  var document=api.buildFullBackupDocument(appData,{
    createdAt:'2026-07-30T10:11:12.345Z',
    appVersion:'3.1.1'
  });
  return Object.assign(document,overrides||{});
}

function fileFor(document,overrides){
  var text=JSON.stringify(document);
  return Object.assign({
    name:'backup.json',
    size:text.length,
    text:function(){return Promise.resolve(text);}
  },overrides||{});
}

function hasCode(issues,code){
  return issues.some(function(issue){return issue.code===code;});
}

async function rejectsCode(promise,code){
  var caught=null;
  try{await promise;}catch(error){caught=error;}
  assert.ok(caught,'Expected rejection '+code);
  assert.strictEqual(caught.code,code);
  return caught;
}

async function testFileReading(api){
  var document=documentFor(api,data());
  var before=JSON.stringify(document);
  var result=await api.readFullBackupFile(fileFor(document));
  assert.strictEqual(result.fileName,'backup.json');
  assert.strictEqual(result.validation.valid,true);
  assert.deepStrictEqual(plain(result.document),plain(document));
  assert.strictEqual(JSON.stringify(document),before);

  var adapterCalls=0;
  var adapterResult=await api.readFullBackupFile(
    {name:'adapter.JSON',size:10},
    {reader:function(){
      adapterCalls++;
      return JSON.stringify(document);
    }}
  );
  assert.strictEqual(adapterCalls,1);
  assert.strictEqual(adapterResult.validation.valid,true);
}

async function testFileFailures(api){
  await rejectsCode(
    api.readFullBackupFile(null),
    'FULL_BACKUP_FILE_REQUIRED'
  );
  await rejectsCode(
    api.readFullBackupFile({name:'backup.txt',size:1,text:function(){
      return Promise.resolve('{}');
    }}),
    'FULL_BACKUP_FILE_TYPE_INVALID'
  );
  await rejectsCode(
    api.readFullBackupFile(
      {name:'backup.json',size:11,text:function(){
        throw new Error('must not read');
      }},
      {maxFileSize:10}
    ),
    'FULL_BACKUP_FILE_TOO_LARGE'
  );
  await rejectsCode(
    api.readFullBackupFile({
      name:'backup.json',
      size:4,
      text:function(){return Promise.resolve('{bad');}
    }),
    'FULL_BACKUP_JSON_INVALID'
  );
  await rejectsCode(
    api.readFullBackupFile({
      name:'backup.json',
      size:2,
      text:function(){return Promise.resolve('{}');}
    }),
    'FULL_BACKUP_DOCUMENT_INVALID'
  );
}

function testCandidateCloneAndSchemas(api){
  var source=data();
  var document=documentFor(api,source);
  var before=JSON.stringify(document);
  var equal=api.prepareFullRestoreCandidate(document,{
    supportedDataSchemaVersion:'2.0.0'
  });
  assert.strictEqual(equal.errors.length,0);
  assert.strictEqual(equal.normalizationApplied,false);
  assert.strictEqual(hasCode(equal.warnings,'NORMALIZATION_DEFERRED'),true);
  equal.candidateAppData.conferences[0].name='Changed';
  assert.strictEqual(document.data.appData.conferences[0].name,'First');
  assert.strictEqual(JSON.stringify(document),before);

  var olderDocument=documentFor(api,data({version:'1.9.0'}));
  var older=api.prepareFullRestoreCandidate(olderDocument,{
    supportedDataSchemaVersion:'2.0.0'
  });
  assert.strictEqual(older.errors.length,0);
  assert.strictEqual(hasCode(older.warnings,'OLDER_DATA_SCHEMA'),true);
  assert.strictEqual(hasCode(older.warnings,'NORMALIZATION_DEFERRED'),true);

  var newerDocument=documentFor(api,data({version:'3.0.0'}));
  var newer=api.prepareFullRestoreCandidate(newerDocument,{
    supportedDataSchemaVersion:'2.0.0'
  });
  assert.strictEqual(
    hasCode(newer.errors,'UNSUPPORTED_NEWER_DATA_SCHEMA'),
    true
  );

  var mismatch=documentFor(api,data());
  mismatch.dataSchemaVersion='1.0.0';
  var mismatched=api.prepareFullRestoreCandidate(mismatch,{
    supportedDataSchemaVersion:'2.0.0'
  });
  assert.strictEqual(
    hasCode(mismatched.errors,'DATA_SCHEMA_VERSION_MISMATCH'),
    true
  );
}

function testCandidateIds(api){
  var duplicateConferences=documentFor(api,data({
    conferences:[
      {id:'conference-1',name:'First'},
      {id:'conference-1',name:'Duplicate'}
    ]
  }));
  var result=api.prepareFullRestoreCandidate(duplicateConferences,{
    supportedDataSchemaVersion:'2.0.0'
  });
  assert.strictEqual(hasCode(result.errors,'DUPLICATE_CONFERENCE_ID'),true);

  var missingId=documentFor(api,data({
    currentConferenceId:null,
    conferences:[{name:'Missing'}]
  }));
  result=api.prepareFullRestoreCandidate(missingId,{
    supportedDataSchemaVersion:'2.0.0'
  });
  assert.strictEqual(hasCode(result.errors,'CONFERENCE_ID_INVALID'),true);

  var duplicateTemplates=documentFor(api,data({
    templates:[{id:'same'},{id:'same'}],
    houseTemplates:[{id:'house-same'},{id:'house-same'}]
  }));
  result=api.prepareFullRestoreCandidate(duplicateTemplates,{
    supportedDataSchemaVersion:'2.0.0'
  });
  assert.strictEqual(hasCode(result.errors,'DUPLICATE_TEMPLATE_ID'),true);
  assert.strictEqual(
    hasCode(result.errors,'DUPLICATE_HOUSE_TEMPLATE_ID'),
    true
  );

  var missingCurrent=documentFor(api,data());
  missingCurrent.data.appData.currentConferenceId='not-included';
  missingCurrent.summary.currentConferenceId='not-included';
  assert.throws(function(){
    api.prepareFullRestoreCandidate(missingCurrent,{
      supportedDataSchemaVersion:'2.0.0'
    });
  },/FULL_BACKUP_DOCUMENT_INVALID/);
}

function testPreviewUsesCandidate(api){
  var current=data({
    currentConferenceId:'current',
    conferences:[{id:'current',name:'Current'}],
    templates:[],
    peopleDb:{version:'1',people:[]}
  });
  var incoming=data({
    currentConferenceId:'incoming',
    conferences:[
      {id:'incoming',name:'Incoming'},
      {id:'second',name:'Second'}
    ],
    templates:[{id:'one'},{id:'two'}],
    peopleDb:{version:'1',people:[{},{}]}
  });
  var document=documentFor(api,incoming);
  document.summary.conferenceCount=999;
  document.summary.peopleCount=999;
  var preview=api.buildFullRestorePreview(
    current,
    document,
    plain(incoming)
  );
  assert.strictEqual(preview.incoming.conferenceCount,2);
  assert.strictEqual(preview.incoming.templateCount,2);
  assert.strictEqual(preview.incoming.peopleCount,2);
  assert.strictEqual(preview.incoming.currentConferenceName,'Incoming');
  assert.strictEqual(preview.current.conferenceCount,1);
  assert.strictEqual(preview.current.currentConferenceName,'Current');
  assert.strictEqual(preview.replacement.willReplaceAllApplicationData,true);
}

function testCloudRisks(api){
  var candidate=data();
  var risks=api.detectFullRestoreCloudLinkRisks(candidate,{
    syncLinks:[
      {
        localConferenceId:'conference-1',
        remoteConferenceId:'remote-1'
      },
      {
        localConferenceId:'conference-1',
        remoteConferenceId:'remote-2'
      },
      {localConferenceId:'broken'}
    ]
  });
  assert.strictEqual(
    hasCode(risks,'CONFERENCE_HAS_EXISTING_CLOUD_LINK'),
    true
  );
  assert.strictEqual(hasCode(risks,'DUPLICATE_CLOUD_LINK'),true);
  assert.strictEqual(hasCode(risks,'MALFORMED_SYNC_LINK'),true);
  assert.doesNotThrow(function(){
    var malformed=api.detectFullRestoreCloudLinkRisks(candidate,{
      syncLinks:'invalid'
    });
    assert.strictEqual(hasCode(malformed,'MALFORMED_SYNC_LINKS'),true);
  });
}

async function testNoSideEffectsOrNetwork(){
  var calls=[];
  var loaded=load({
    appData:{sentinel:true},
    localStorage:{
      getItem:function(){calls.push('localStorage.getItem');},
      setItem:function(){calls.push('localStorage.setItem');}
    },
    indexedDB:{open:function(){calls.push('indexedDB.open');}},
    save:function(){calls.push('save');},
    fetch:function(){calls.push('fetch');}
  });
  var api=loaded.api;
  var original=loaded.sandbox.appData;
  var document=documentFor(api,data());
  var file=fileFor(document);
  var read=await api.readFullBackupFile(file);
  api.prepareFullRestoreCandidate(read.document,{
    supportedDataSchemaVersion:'2.0.0'
  });
  api.buildFullRestorePreview(data(),read.document,read.document.data.appData);
  api.detectFullRestoreCloudLinkRisks(read.document.data.appData,{
    syncLinks:[]
  });
  assert.deepStrictEqual(calls,[]);
  assert.strictEqual(loaded.sandbox.appData,original);
  assert.deepStrictEqual(loaded.sandbox.appData,{sentinel:true});
}

async function run(){
  var api=load().api;
  assert.strictEqual(api.getMaximumFullBackupFileSize(),100*1024*1024);
  await testFileReading(api);
  await testFileFailures(api);
  testCandidateCloneAndSchemas(api);
  testCandidateIds(api);
  testPreviewUsesCandidate(api);
  testCloudRisks(api);
  await testNoSideEffectsOrNetwork();
  console.log('Full backup phase 3 tests passed.');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
