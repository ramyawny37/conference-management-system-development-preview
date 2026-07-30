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
    Error:Error
  },extra||{});
  sandbox.window=sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(root,'js/storage/full-backup.js'),'utf8'),
    sandbox,
    {filename:'full-backup.js'}
  );
  return sandbox.FullBackupService;
}

function appData(){
  return {
    version:'2.0.0',
    currentConferenceId:'conference-1',
    conferences:[{
      id:'conference-1',
      name:'Conference',
      nested:{value:'original'}
    }],
    templates:[],
    archives:[],
    backups:[],
    houseTemplates:[],
    peopleDb:{version:'1.0.0',people:[]}
  };
}

function adapters(options){
  options=options||{};
  var events=[];
  var anchor={
    style:{},
    href:'',
    download:'',
    click:function(){
      events.push('click');
      if(options.clickError)throw new Error('CLICK_FAILED');
    },
    remove:function(){events.push('remove');}
  };
  function FakeBlob(parts,blobOptions){
    this.parts=parts;
    this.type=blobOptions&&blobOptions.type;
    this.size=parts.join('').length;
    events.push('blob');
  }
  return {
    events:events,
    Blob:FakeBlob,
    URL:{
      createObjectURL:function(blob){
        events.push('createObjectURL');
        assert.strictEqual(blob.type,'application/json;charset=utf-8');
        return 'blob:test';
      },
      revokeObjectURL:function(url){
        events.push('revokeObjectURL');
        assert.strictEqual(url,'blob:test');
      }
    },
    document:{
      body:{
        appendChild:function(value){
          assert.strictEqual(value,anchor);
          events.push('append');
        }
      },
      createElement:function(tag){
        assert.strictEqual(tag,'a');
        events.push('createAnchor');
        return anchor;
      }
    },
    anchor:anchor
  };
}

function testFileName(api){
  var name=api.getFullBackupFileName('2026-07-30T10:11:12.345Z');
  assert.strictEqual(
    name,
    'conference-manager-full-backup_2026-07-30_10-11-12.json'
  );
  assert.strictEqual(name.indexOf(':'),-1);
}

function testSerialization(api){
  var document=api.buildFullBackupDocument(appData(),{
    createdAt:'2026-07-30T10:11:12.345Z',
    appVersion:'test'
  });
  var before=JSON.stringify(document);
  var serialized=api.serializeFullBackupDocument(document);
  assert.deepStrictEqual(JSON.parse(serialized),JSON.parse(before));
  assert.strictEqual(JSON.stringify(document),before);
  assert.strictEqual(serialized.indexOf('\n  "backupType"')>=0,true);
}

function testCreateAndDownload(api){
  var source=appData();
  var fake=adapters();
  var options={
    createdAt:'2026-07-30T10:11:12.345Z',
    appVersion:'test',
    Blob:fake.Blob,
    URL:fake.URL,
    document:fake.document
  };
  var result=api.createAndDownloadFullBackup(source,options);
  assert.strictEqual(result.success,true);
  assert.strictEqual(result.createdAt,'2026-07-30T10:11:12.345Z');
  assert.strictEqual(result.document.createdAt,result.createdAt);
  assert.strictEqual(
    result.fileName,
    'conference-manager-full-backup_2026-07-30_10-11-12.json'
  );
  assert.strictEqual(fake.anchor.download,result.fileName);
  assert.strictEqual(fake.anchor.href,'blob:test');
  assert.deepStrictEqual(fake.events,[
    'blob',
    'createObjectURL',
    'createAnchor',
    'append',
    'click',
    'remove',
    'revokeObjectURL'
  ]);
  result.document.data.appData.conferences[0].nested.value='changed';
  assert.strictEqual(source.conferences[0].nested.value,'original');
}

function testValidationFailurePreventsDownload(api){
  var fake=adapters();
  assert.throws(function(){
    api.createAndDownloadFullBackup({
      version:'2.0.0',
      currentConferenceId:'missing',
      conferences:[]
    },{
      createdAt:'2026-07-30T10:11:12.345Z',
      appVersion:'test',
      Blob:fake.Blob,
      URL:fake.URL,
      document:fake.document
    });
  },/FULL_BACKUP_VALIDATION_FAILED: CURRENT_CONFERENCE_NOT_FOUND/);
  assert.deepStrictEqual(fake.events,[]);
}

function testBrowserApisUnavailable(api){
  var document=api.buildFullBackupDocument(appData(),{
    createdAt:'2026-07-30T10:11:12.345Z',
    appVersion:'test'
  });
  assert.throws(function(){
    api.downloadFullBackupDocument(document);
  },/FULL_BACKUP_BROWSER_APIS_UNAVAILABLE/);
}

function testRevokeAfterClickFailure(api){
  var document=api.buildFullBackupDocument(appData(),{
    createdAt:'2026-07-30T10:11:12.345Z',
    appVersion:'test'
  });
  var fake=adapters({clickError:true});
  assert.throws(function(){
    api.downloadFullBackupDocument(document,{
      Blob:fake.Blob,
      URL:fake.URL,
      document:fake.document
    });
  },/CLICK_FAILED/);
  assert.strictEqual(fake.events.indexOf('remove')>=0,true);
  assert.strictEqual(fake.events.indexOf('revokeObjectURL')>=0,true);
  assert.strictEqual(
    fake.events[fake.events.length-1],
    'revokeObjectURL'
  );
}

function testNoStorageOrSaveCalls(){
  var accessCount=0;
  var api=load({
    localStorage:{
      getItem:function(){accessCount++;throw new Error('unexpected');},
      setItem:function(){accessCount++;throw new Error('unexpected');}
    },
    indexedDB:{
      open:function(){accessCount++;throw new Error('unexpected');}
    },
    save:function(){accessCount++;throw new Error('unexpected');}
  });
  var fake=adapters();
  api.createAndDownloadFullBackup(appData(),{
    createdAt:'2026-07-30T10:11:12.345Z',
    appVersion:'test',
    Blob:fake.Blob,
    URL:fake.URL,
    document:fake.document
  });
  assert.strictEqual(accessCount,0);
}

function run(){
  var api=load();
  testFileName(api);
  testSerialization(api);
  testCreateAndDownload(api);
  testValidationFailurePreventsDownload(api);
  testBrowserApisUnavailable(api);
  testRevokeAfterClickFailure(api);
  testNoStorageOrSaveCalls();
  console.log('Full backup phase 2 tests passed.');
}

run();
