'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const source=fs.readFileSync('js/sync/rejected-shared-template-cleanup.js','utf8');
const settingsSource=fs.readFileSync('js/sync/sync-settings-ui.js','utf8');
const TEMPLATE='8bd4bc0b-6104-4da0-aef0-9688a0459a79';
const OPERATION='ece2a707-ff05-4ec0-b674-5445a36346fa';
const MEMBER='dae5cf37-b6fc-49cb-a57b-09e06c2a635d';
const OWNER='6bde50f6-e75f-44c5-9d7f-7f6a2ad808f5';
const ORG='8c2562cc-aa77-4404-8c58-fe36a51280f5';
const OTHER='11111111-1111-4111-8111-111111111111';
function clone(value){return JSON.parse(JSON.stringify(value));}
function fixture(settings={}){
  const canonical={id:TEMPLATE,name:'بيت ابونا سمعان',description:'Canonical',floors:[{id:'cloud-floor',name:'Cloud floor',rooms:[]}]};
  const local={id:TEMPLATE,name:'بيت ابونا سمعان',description:'Canonical',floors:[...canonical.floors,{id:'unauthorized-floor',name:'Member floor',rooms:[]}],cloudOwnerUserId:OWNER,organizationId:null,accessibleOrganizationIds:[ORG],cloudSyncStatus:'synced',cloudRevision:1};
  if(settings.localTemplateId)local.id=settings.localTemplateId;
  const other={id:OTHER,name:'Other',floors:[{id:'other-floor'}],cloudSyncStatus:'synced',cloudRevision:8};
  const data={houseTemplates:[local,other],templates:[],conferences:[],organizationContext:{organizationId:ORG},account:{id:MEMBER}};
  const aliases={libraryTemplateContentOperations:'library_template_content_operations',organizationTemplateOperations:'organization_template_operations',organizationTemplateAccessOperations:'organization_template_access_operations'};
  const operation={operationId:OPERATION,templateId:TEMPLATE,templateType:'house',action:'upsert',status:'unknown',lastErrorCode:settings.errorCode||'42501',baseRevision:settings.baseRevision===undefined?1:settings.baseRevision};
  const stores={library_template_content_operations:[operation,{operationId:'other-content',templateId:OTHER,status:'pending'}],organization_template_operations:[{operationId:'other-org',templateId:OTHER}],organization_template_access_operations:[{operationId:'other-access',templateId:OTHER}]};
  const writes={rpc:[],snapshots:0,deletes:[],localSnapshots:0};
  const values={'sb-project-auth-token':'AUTH','device-identity:user':'DEVICE','organization-context':'ORG','development:data':'DEV'};
  const sandbox={Promise,JSON,Object,Array,String,Number,Date,structuredClone:clone,SK:'conf_v5',appData:data,BrowserStorageNamespace:{environment:settings.environment||'production'},localStorage:{setItem(key,value){if(key==='conf_v5')writes.localSnapshots++;values[key]=value;},getItem:key=>values[key]||null},SupabaseAuth:{getState:()=>({authenticated:true,user:{id:settings.memberId||MEMBER}})},SupabaseDeviceIdentity:{getCurrent:()=>({id:'device'})},SupabaseClientLayer:{getClient:()=>({rpc(name,args){writes.rpc.push({name,args});if(name!=='list_shared_organization_templates')throw new Error('WRITE_RPC_CALLED');if(settings.readFailure)return Promise.resolve({error:{code:'NETWORK_ERROR'}});return Promise.resolve({data:{status:'success',templates:[{templateType:'house',templateId:TEMPLATE,payload:clone(canonical),revision:settings.cloudRevision||1,deletedAt:null,ownerUserId:settings.owner||OWNER,accessibleOrganizationIds:settings.missingAccess?[]:[ORG]}]}});}})},AppIndexedDB:{stores:aliases,getAllRecords:name=>Promise.resolve(clone(stores[name])),deleteRecord(name,id){writes.deletes.push({name,id});const index=stores[name].findIndex(row=>row.operationId===id);if(index>=0)stores[name].splice(index,1);return Promise.resolve();}},StorageRepository:{saveAppSnapshot(next,options){writes.snapshots++;assert.strictEqual(options.skipSyncQueue,true);assert.strictEqual(options.skipTemplateSync,true);if(settings.persistFailure)return Promise.reject(new Error('PERSIST_FAILED'));return Promise.resolve();}}};
  sandbox.window=sandbox;vm.runInNewContext(source,{window:sandbox});return {sandbox,stores,writes,values,canonical,otherBefore:clone(other)};
}
(async function(){
  assert(settingsSource.includes('cleanupRejectedSharedTemplate'));
  assert(settingsSource.includes('استعادة النسخة السحابية وتنظيف العملية المحلية'));
  let env=fixture();
  assert.strictEqual(env.sandbox.RejectedSharedTemplateCleanup.targetTemplateId,TEMPLATE);
  assert.strictEqual(env.sandbox.RejectedSharedTemplateCleanup.targetOperationId,OPERATION);
  assert.strictEqual((await env.sandbox.RejectedSharedTemplateCleanup.preflight()).status,'cleanup_confirmed');
  const cleaned=await env.sandbox.RejectedSharedTemplateCleanup.cleanup();
  assert.strictEqual(cleaned.ok,true,JSON.stringify(cleaned));
  assert.strictEqual(cleaned.data.cloudMutationPerformed,false);
  assert.deepStrictEqual(env.writes.rpc.map(call=>call.name),['list_shared_organization_templates','list_shared_organization_templates']);
  assert.strictEqual(env.writes.snapshots,1);
  assert.strictEqual(env.writes.localSnapshots,0,
    'repository owns the application snapshot mirror');
  assert.deepStrictEqual(env.writes.deletes,[{name:'library_template_content_operations',id:OPERATION}]);
  const restored=env.sandbox.appData.houseTemplates.find(row=>row.id===TEMPLATE);
  assert.deepStrictEqual(clone(restored.floors),env.canonical.floors);
  assert.strictEqual(restored.cloudOwnerUserId,OWNER);
  assert.deepStrictEqual(Array.from(restored.accessibleOrganizationIds),[ORG]);
  assert.strictEqual(restored.cloudRevision,1);
  assert.strictEqual(restored.cloudSyncStatus,'synced');
  assert.deepStrictEqual(clone(env.sandbox.appData.houseTemplates.find(row=>row.id===OTHER)),env.otherBefore);
  assert.deepStrictEqual(env.stores.library_template_content_operations.map(row=>row.operationId),['other-content']);
  assert.deepStrictEqual(env.stores.organization_template_operations.map(row=>row.operationId),['other-org']);
  assert.deepStrictEqual(env.stores.organization_template_access_operations.map(row=>row.operationId),['other-access']);
  assert.strictEqual(env.values['sb-project-auth-token'],'AUTH');assert.strictEqual(env.values['device-identity:user'],'DEVICE');assert.strictEqual(env.values['organization-context'],'ORG');assert.strictEqual(env.values['development:data'],'DEV');
  const repeated=await env.sandbox.RejectedSharedTemplateCleanup.cleanup();
  assert.strictEqual(repeated.status,'already_clean');assert.strictEqual(env.writes.snapshots,1);assert.strictEqual(env.writes.deletes.length,1);

  for(const settings of [{localTemplateId:'wrong'},{errorCode:'OTHER'},{baseRevision:2},{owner:'wrong-owner'},{cloudRevision:2},{missingAccess:true},{readFailure:true},{memberId:'wrong-member'},{environment:'development'}]){
    env=fixture(settings);const response=await env.sandbox.RejectedSharedTemplateCleanup.cleanup();assert.strictEqual(response.ok,false,JSON.stringify(settings));assert.strictEqual(env.writes.snapshots,0);assert.strictEqual(env.writes.deletes.length,0);
  }
  env=fixture({persistFailure:true});const failedPersist=await env.sandbox.RejectedSharedTemplateCleanup.cleanup();assert.strictEqual(failedPersist.ok,false);assert.strictEqual(env.writes.deletes.length,0,'operation must survive canonical persistence failure');
  assert(!/apply_library_template_content_operation|apply_organization_template_access_operation|\.from\s*\(/.test(source));
  console.log('rejected shared template cleanup tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
