'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.join(
  __dirname,'../js/sync/template-diagnostic-export.js'
),'utf8');
const writes={put:0,delete:0,save:0,rpc:0,sync:0};
const names={
  libraryTemplateContentOperations:'library_template_content_operations',
  organizationTemplateOperations:'organization_template_operations',
  organizationTemplateAccessOperations:'organization_template_access_operations'
};
const rows={
  library_template_content_operations:[{
    operationId:'content-op',templateId:'house-1',status:'unknown',
    lastErrorCode:'42501',baseRevision:4,result:{revision:5},
    createdAt:'2026-08-11T00:00:00.000Z',payload:{people:['secret']},
    accessToken:'secret-token'
  }],
  organization_template_operations:[{
    operationId:'legacy-op',templateId:'house-1',status:'pending',
    expectedRevision:5,resultingRevision:null,password:'secret-password'
  }],
  organization_template_access_operations:[{
    operationId:'access-op',templateId:'house-1',status:'unknown',
    lastErrorCode:'ORGANIZATION_ADMIN_REQUIRED',
    organizationId:'org-1',createdAt:'2026-08-11T00:01:00.000Z',
    authToken:'secret-auth'
  }]
};
const sandbox={window:null,Promise,JSON,Object,Array,String,Number,Date,Error};
sandbox.window=sandbox;
vm.runInNewContext(source,sandbox,{filename:'template-diagnostic-export.js'});

(async function(){
  const bundle=await sandbox.TemplateDiagnosticExport.createBundle({
    appData:{
      currentConferenceId:null,conferences:[],peopleDb:{people:['private']},
      houseTemplates:[{
        id:'house-1',name:'Smoke House',cloudOwnerUserId:'owner-1',
        organizationId:null,accessibleOrganizationIds:['org-1'],
        cloudSyncStatus:'pending',cloudRevision:4,
        createdAt:'2026-08-01T00:00:00.000Z',
        updatedAt:'2026-08-10T00:00:00.000Z',
        floors:[{rooms:[{guests:['private-person']}]}],secret:'hidden'
      }]
    },
    indexedDb:{
      stores:names,
      getAllRecords(name){return Promise.resolve(rows[name]);},
      putRecord(){writes.put++;},deleteRecord(){writes.delete++;}
    },
    auth:{getState(){return {
      authenticated:true,user:{id:'user-1',email:'private@example.com'},
      accessToken:'secret-session'
    };}},
    deviceIdentity:{
      getCurrent(){return {id:'device-1',secret:'device-secret'};},
      getOrCreate(){writes.save++;throw new Error('must not create identity');}
    },
    organizationTemplateSync:{getAdoptionState(){return {
      organizations:[
        {organizationId:'org-1',role:'member',displayName:'private-name'}
      ]
    };}},
    storage:{saveAppSnapshot(){writes.save++;}},
    client:{rpc(){writes.rpc++;}},
    sync:{flush(){writes.sync++;}}
  });

  assert.strictEqual(bundle.context.currentUserId,'user-1');
  assert.strictEqual(bundle.context.currentDeviceId,'device-1');
  assert.ok(bundle.context.timestamp);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(bundle.context.organizationMemberships)),
    [{organizationId:'org-1',role:'member'}]
  );
  assert.strictEqual(bundle.houseTemplates.length,1);
  assert.deepStrictEqual(Object.keys(bundle.houseTemplates[0]),[
    'id','name','ownerUserId','organizationId','accessibleOrganizationIds',
    'cloudSyncStatus','revision','createdAt','updatedAt'
  ]);
  Object.keys(names).forEach(function(key){
    const storeName=names[key];
    assert.ok(Array.isArray(bundle.operationStores[storeName]));
    bundle.operationStores[storeName].forEach(function(row){
      assert.deepStrictEqual(Object.keys(row),[
        'operationId','templateId','status','lastErrorCode',
        'targetOrganizationId','expectedRevision','resultingRevision',
        'createdAt','updatedAt'
      ]);
    });
  });
  assert.strictEqual(bundle.operationStores
    .library_template_content_operations[0].expectedRevision,4);
  assert.strictEqual(bundle.operationStores
    .library_template_content_operations[0].resultingRevision,5);
  assert.deepStrictEqual(writes,{put:0,delete:0,save:0,rpc:0,sync:0});
  const serialized=JSON.stringify(bundle);
  [
    'secret-token','secret-password','secret-auth','secret-session',
    'device-secret','private@example.com','private-person','private-name',
    'peopleDb','conferences','currentConferenceId','floors','payload'
  ].forEach(function(value){
    assert.strictEqual(serialized.includes(value),false,'leaked '+value);
  });
  assert.deepStrictEqual(Object.keys(bundle),[
    'context','houseTemplates','operationStores'
  ]);
  const uiSource=fs.readFileSync(path.join(
    __dirname,'../js/sync/sync-settings-ui.js'
  ),'utf8');
  assert.ok(uiSource.includes('تصدير تشخيص القوالب والعمليات'));
  assert.match(uiSource,
    /function renderSection\(\)[\s\S]{0,500}renderTemplateDiagnosticExport\(\)/
  );
  assert.doesNotMatch(source,
    /saveAppSnapshot|setItem|putRecord|deleteRecord|\.rpc\s*\(|retry|repair/i
  );
  console.log('template diagnostic export tests: passed');
})().catch(function(error){console.error(error);process.exitCode=1;});
