'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const source=fs.readFileSync('js/sync/local-template-copy-cleanup.js','utf8');
const TARGET='5c96c45f-ae22-4993-a3e7-d97e0b2598cf';
const ORIGINAL='8bd4bc0b-6104-4da0-aef0-9688a0459a79';
const MEMBER='dae5cf37-b6fc-49cb-a57b-09e06c2a635d';
function clone(value){return JSON.parse(JSON.stringify(value));}
function runtime(settings={}){
  const target={id:settings.id||TARGET,name:settings.name||'بيت ابونا سمعان (نسخة)',floors:[{id:'copy-floor'}]};
  if(settings.cloudMetadata)target.cloudSyncStatus='synced';
  const original={id:ORIGINAL,name:'بيت ابونا سمعان',cloudOwnerUserId:'owner',accessibleOrganizationIds:['org'],cloudRevision:1,cloudSyncStatus:'synced'};
  const other={id:'other',name:'Other'};
  const data={houseTemplates:settings.missingOriginal?[target,other]:[original,target,other],organizationContext:{id:'org'},account:{id:MEMBER}};
  const names={libraryTemplateContentOperations:'content',organizationTemplateOperations:'organization',organizationTemplateAccessOperations:'access'};
  const stores={content:settings.operation?[{operationId:'op',templateId:TARGET}]:[{operationId:'other-op',templateId:'other'}],organization:[],access:[]};
  const protectedValues={auth:'AUTH',device:'DEVICE',organization:'ORG',development:'DEV',conf_v5:'before'};
  const writes={snapshots:0,set:[],rpc:0};
  const window={JSON,Promise,Object,Array,String,BrowserStorageNamespace:{environment:settings.development?'development':'production'},SK:'conf_v5',appData:data,localStorage:{setItem(key,value){writes.set.push(key);protectedValues[key]=value;}},SupabaseAuth:{getState:()=>({authenticated:true,user:{id:settings.member||MEMBER}})},AppIndexedDB:{stores:names,getAllRecords:name=>Promise.resolve(clone(stores[name]))},StorageRepository:{saveAppSnapshot(next,options){writes.snapshots++;assert.strictEqual(options.skipSyncQueue,true);assert.strictEqual(options.skipTemplateSync,true);if(settings.persistFailure)return Promise.reject(new Error('PERSIST_FAILED'));return Promise.resolve();}},SupabaseClientLayer:{getClient(){writes.rpc++;throw new Error('RPC_FORBIDDEN');}}};
  window.window=window;vm.runInNewContext(source,{window});return {window,writes,protectedValues,original:clone(original),other:clone(other)};
}
(async()=>{
  let r=runtime();
  assert.strictEqual(r.window.LocalTemplateCopyCleanup.targetTemplateId,TARGET);
  assert.strictEqual(r.window.LocalTemplateCopyCleanup.originalTemplateId,ORIGINAL);
  assert.strictEqual(r.window.LocalTemplateCopyCleanup.inspectLocal().status,'local_copy_identity_confirmed');
  assert.strictEqual((await r.window.LocalTemplateCopyCleanup.preflight()).status,'local_copy_confirmed');
  const cleaned=await r.window.LocalTemplateCopyCleanup.cleanup();
  assert.strictEqual(cleaned.ok,true,JSON.stringify(cleaned));
  assert.strictEqual(cleaned.data.cloudMutationPerformed,false);
  assert.strictEqual(r.writes.rpc,0);
  assert.strictEqual(r.writes.snapshots,1);
  assert.strictEqual(r.window.appData.houseTemplates.some(row=>row.id===TARGET),false);
  assert.deepStrictEqual(clone(r.window.appData.houseTemplates.find(row=>row.id===ORIGINAL)),r.original);
  assert.deepStrictEqual(clone(r.window.appData.houseTemplates.find(row=>row.id==='other')),r.other);
  assert.strictEqual(r.protectedValues.auth,'AUTH');assert.strictEqual(r.protectedValues.device,'DEVICE');assert.strictEqual(r.protectedValues.organization,'ORG');assert.strictEqual(r.protectedValues.development,'DEV');
  assert.strictEqual((await r.window.LocalTemplateCopyCleanup.cleanup()).status,'already_clean');
  for(const settings of [{name:'Wrong'},{cloudMetadata:true},{operation:true},{missingOriginal:true},{member:'other'},{development:true}]){
    r=runtime(settings);const before=JSON.stringify(r.window.appData);const response=await r.window.LocalTemplateCopyCleanup.cleanup();assert.strictEqual(response.ok,false,JSON.stringify(settings));assert.strictEqual(JSON.stringify(r.window.appData),before);assert.strictEqual(r.writes.snapshots,0);assert.strictEqual(r.writes.rpc,0);
  }
  r=runtime({persistFailure:true});const failed=await r.window.LocalTemplateCopyCleanup.cleanup();assert.strictEqual(failed.ok,false);assert.strictEqual(r.window.appData.houseTemplates.some(row=>row.id===TARGET),true);
  assert(!/\.rpc\s*\(|\.from\s*\(/.test(source),'cleanup must contain no cloud access');
  console.log('local template copy cleanup tests passed');
})().catch(error=>{console.error(error);process.exit(1);});
