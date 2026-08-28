'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,
  'js/sync/partial-template-state-cleanup.js'),'utf8');
const uiSource=fs.readFileSync(path.join(root,
  'js/sync/sync-settings-ui.js'),'utf8');
const TEMPLATE='f779cfa5-fb19-4ce3-ac77-eadcc26ac7e1';
const OPERATION='5bef623a-afd1-4162-89a4-622dd23f9c8a';
const OWNER='dae5cf37-b6fc-49cb-a57b-09e06c2a635d';
const ORG='8c2562cc-aa77-4404-8c58-fe36a51280f5';
const OTHER='11111111-1111-4111-8111-111111111111';
function clone(value){return JSON.parse(JSON.stringify(value));}
function fixture(settings={}){
  const aliases={libraryTemplateContentOperations:'library_template_content_operations',
    organizationTemplateOperations:'organization_template_operations',
    organizationTemplateAccessOperations:'organization_template_access_operations'};
  const target={id:TEMPLATE,name:'بيت ابونا سمعان',cloudOwnerUserId:OWNER,
    organizationId:null,accessibleOrganizationIds:[],cloudSyncStatus:'pending',
    cloudRevision:1,floors:[{id:'target-floor'}]};
  const other={id:OTHER,name:'قالب حقيقي',cloudOwnerUserId:'other-owner',
    organizationId:null,accessibleOrganizationIds:[],cloudSyncStatus:'synced',
    cloudRevision:7,floors:[{id:'other-floor'}]};
  const data={houseTemplates:[target,other],templates:[],conferences:[],
    organizationContext:{organizationId:ORG},accountProfile:{id:'account'}};
  const stores={library_template_content_operations:[],
    organization_template_operations:[],organization_template_access_operations:[{
      operationId:OPERATION,templateId:TEMPLATE,templateType:'house',
      organizationId:ORG,action:'grant',status:'unknown',lastErrorCode:'42501'
    },{operationId:'other-operation',templateId:OTHER,templateType:'house',
      organizationId:ORG,action:'grant',status:'unknown',lastErrorCode:'42501'}]};
  if(settings.extraTargetOperation)stores.library_template_content_operations.push({
    operationId:'unexpected',templateId:TEMPLATE,templateType:'house',status:'pending'});
  const writes={snapshots:0,deletes:[],rpc:0,localSnapshots:0};
  const storageValues={'sb-project-auth-token':'AUTH','device-identity:user':'DEVICE',
    'organization-context':'ORG','development:data':'DEVELOPMENT'};
  const storage={getItem:key=>storageValues[key]||null,
    setItem(key,value){if(key==='conf_v5')writes.localSnapshots++;storageValues[key]=value;}};
  const sandbox={Promise,JSON,Object,Array,String,Number,
    BrowserStorageNamespace:{environment:settings.environment||'production'},
    SK:'conf_v5',appData:data,localStorage:storage,
    AppIndexedDB:{stores:aliases,getAllRecords(name){return Promise.resolve(clone(stores[name]));},
      deleteRecord(name,id){writes.deletes.push({name,id});const index=stores[name]
        .findIndex(row=>row.operationId===id);if(index>=0)stores[name].splice(index,1);
        return Promise.resolve();}},
    StorageRepository:{saveAppSnapshot(next,options){writes.snapshots++;
      assert.strictEqual(options.skipSyncQueue,true);
      assert.strictEqual(options.skipTemplateSync,true);
      return Promise.resolve();}},
    SupabaseClientLayer:{getClient(){return {rpc(){writes.rpc++;throw new Error('RPC_CALLED');}};}}
  };
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(source,sandbox);
  return {sandbox,stores,writes,storageValues,otherBefore:clone(other)};
}
(async function(){
  const env=fixture();
  assert.strictEqual(env.sandbox.PartialTemplateStateCleanup.targetTemplateId,TEMPLATE);
  assert.strictEqual(env.sandbox.PartialTemplateStateCleanup.targetOperationId,OPERATION);
  const checked=await env.sandbox.PartialTemplateStateCleanup.preflight();
  assert.strictEqual(checked.status,'cleanup_confirmed');
  const cleaned=await env.sandbox.PartialTemplateStateCleanup.cleanup();
  assert.strictEqual(cleaned.ok,true,JSON.stringify(cleaned));
  assert.strictEqual(cleaned.data.cloudMutationPerformed,false);
  assert.strictEqual(cleaned.data.remainingOperations,0);
  assert.strictEqual(env.writes.rpc,0);
  assert.strictEqual(env.writes.snapshots,1);
  assert.strictEqual(env.writes.localSnapshots,0,
    'repository owns the application snapshot mirror');
  assert.deepStrictEqual(env.writes.deletes,[{
    name:'organization_template_access_operations',id:OPERATION}]);
  const target=env.sandbox.appData.houseTemplates.find(row=>row.id===TEMPLATE);
  assert.strictEqual(target.organizationId,null);
  assert.deepStrictEqual(Array.from(target.accessibleOrganizationIds),[]);
  assert.strictEqual(target.cloudSyncStatus,'synced');
  assert.strictEqual(target.cloudRevision,1);
  assert.deepStrictEqual(clone(env.sandbox.appData.houseTemplates.find(
    row=>row.id===OTHER)),env.otherBefore);
  assert.strictEqual(env.stores.organization_template_access_operations.length,1);
  assert.strictEqual(env.stores.organization_template_access_operations[0].templateId,OTHER);
  assert.strictEqual(env.storageValues['sb-project-auth-token'],'AUTH');
  assert.strictEqual(env.storageValues['device-identity:user'],'DEVICE');
  assert.strictEqual(env.storageValues['organization-context'],'ORG');
  assert.strictEqual(env.storageValues['development:data'],'DEVELOPMENT');
  const repeated=await env.sandbox.PartialTemplateStateCleanup.cleanup();
  assert.strictEqual(repeated.status,'already_clean');
  assert.strictEqual(env.writes.snapshots,1);
  assert.strictEqual(env.writes.deletes.length,1);
  const mismatch=fixture({extraTargetOperation:true});
  assert.strictEqual((await mismatch.sandbox.PartialTemplateStateCleanup.cleanup()).status,
    'operation_identity_mismatch');
  assert.strictEqual(mismatch.writes.snapshots,0);
  assert.strictEqual(mismatch.writes.deletes.length,0);
  const development=fixture({environment:'development'});
  assert.strictEqual((await development.sandbox.PartialTemplateStateCleanup.cleanup()).status,
    'development_environment_blocked');
  assert.strictEqual(development.writes.snapshots,0);
  assert(!/\.rpc\s*\(|\.flush\s*\(|retry|repair|migration/i.test(source));
  assert(uiSource.includes('تنظيف الحالة الجزئية محليًا'));
  console.log('partial template state cleanup tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
