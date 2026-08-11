'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const TARGETS=[
  {id:'5f96dee5-c796-4e75-9a1d-1b1bd3659112',name:'Smoke House',revision:12},
  {id:'835cb97d-50cd-4bba-8285-1d81dfa8608e',name:'اطسا',revision:1},
  {id:'fcee488a-82d7-4e70-b296-fbace0e558a9',name:'التكويني',revision:1}
];
const OTHER={id:'4a55daa6-1dd1-4379-9093-e4b5ca90779a',name:'قالب آخر'};
const ORG='8c2562cc-aa77-4404-8c58-fe36a51280f5';
const USER='6bde50f6-e75f-44c5-9d7f-7f6a2ad808f5';
const DEVICE='71f9f2db-aeff-4e72-b692-a0f926916c62';
const SOURCE=fs.readFileSync(path.join(__dirname,
  '../js/sync/test-house-template-cleanup.js'),'utf8');
const UI_SOURCE=fs.readFileSync(path.join(__dirname,
  '../js/sync/sync-settings-ui.js'),'utf8');

function clone(value){return JSON.parse(JSON.stringify(value));}
function storage(initial){
  const values=new Map(Object.entries(initial||{}));
  return {get length(){return values.size;},key(i){return [...values.keys()][i]||null;},
    getItem(k){return values.has(k)?values.get(k):null;},
    setItem(k,v){values.set(k,String(v));},removeItem(k){values.delete(k);},values};
}
function fixture(settings={}){
  const localTargets=TARGETS.map(item=>({id:item.id,name:item.name,
    organizationId:null,cloudRevision:item.revision,cloudSyncStatus:'synced',
    cloudOwnerUserId:USER,accessibleOrganizationIds:[ORG],floors:[]}));
  const appData={currentConferenceId:null,conferences:settings.conferences||[],
    houseTemplates:[...localTargets,clone(OTHER)],templates:[],
    organizationContext:{organizationId:ORG}};
  const localStorage=storage({conf_v5:JSON.stringify(appData),
    'sb-project-auth-token':'AUTH','device-identity:user':'DEVICE',
    'organization-context':'ORG'});
  const aliases={libraryTemplateContentOperations:'library_template_content_operations',
    organizationTemplateOperations:'organization_template_operations',
    organizationTemplateAccessOperations:'organization_template_access_operations'};
  const stores={};
  Object.values(aliases).forEach(name=>{
    stores[name]=TARGETS.map((item,index)=>({operationId:name+'-'+index,
      templateType:'house',templateId:item.id})).concat([{
      operationId:name+'-other',templateType:'house',templateId:OTHER.id
    }]);
  });
  const cloudRows=TARGETS.map(item=>({templateType:'house',templateId:item.id,
    revision:item.revision,deletedAt:null,ownerUserId:USER,
    accessibleOrganizationIds:[ORG]})).concat([{
    templateType:'house',templateId:OTHER.id,revision:1,deletedAt:null,
    ownerUserId:'another-user',accessibleOrganizationIds:[]
  }]);
  if(settings.cloudDeleted){
    cloudRows.slice(0,3).forEach(row=>{
      row.deletedAt='2026-08-11T00:00:00Z';row.revision++;
    });
  }
  const rpcCalls=[];
  const saved=[];
  const forgotten=[];
  let operationSequence=0;
  const sandbox={window:null,Promise,JSON,Object,String,Number,Array,Date,console,
    structuredClone:clone,localStorage,SK:'conf_v5',appData,
    BrowserStorageNamespace:{environment:settings.environment||'production'},
    crypto:{randomUUID(){operationSequence++;return '00000000-0000-4000-8000-'+
      String(operationSequence).padStart(12,'0');}},
    SupabaseAuth:{getState(){return {authenticated:true,user:{id:USER}};}},
    SupabaseDeviceIdentity:{getCurrent(){return {id:DEVICE};}},
    SupabaseClientLayer:{getClient(){return {rpc(name,input){
      rpcCalls.push({name,input:clone(input)});
      if(name==='list_shared_organization_templates'){
        const rows=clone(cloudRows);
        if(settings.ownerMismatch)rows[0].ownerUserId='another-user';
        return Promise.resolve({data:{status:'success',templates:rows}});
      }
      if(name==='apply_library_template_content_operation'){
        if(settings.deleteFailure)return Promise.resolve({error:{code:'NETWORK_ERROR'}});
        const row=cloudRows.find(item=>item.templateId===input.p_template_id);
        row.deletedAt='2026-08-11T00:00:00Z';row.revision++;
        return Promise.resolve({data:{status:'deleted',revision:row.revision}});
      }
      throw new Error('UNEXPECTED_RPC:'+name);
    }};}},
    AppIndexedDB:{stores:aliases,getAllRecords(name){return Promise.resolve(clone(stores[name]));},
      deleteRecord(name,id){const index=stores[name].findIndex(x=>x.operationId===id);
        if(index>=0)stores[name].splice(index,1);return Promise.resolve();}},
    StorageRepository:{saveAppSnapshot(data,options){
      assert.strictEqual(options.skipSyncQueue,true);
      assert.strictEqual(options.skipTemplateSync,true);
      saved.push(clone(data));return Promise.resolve();}},
    OrganizationTemplateSync:{forgetDeletedTemplates(items){forgotten.push(...clone(items));},
      flush(){throw new Error('SYNC_FLUSH_CALLED');},
      captureLocalSave(){throw new Error('SYNC_CAPTURE_CALLED');}}
  };
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE,sandbox);
  return {sandbox,localStorage,stores,rpcCalls,saved,forgotten,cloudRows};
}

(async function(){
  const env=fixture();
  assert.deepStrictEqual(Array.from(env.sandbox.TestHouseTemplateCleanup
    .allowlistedTemplateIds).sort(),TARGETS.map(x=>x.id).sort());
  const inspected=env.sandbox.TestHouseTemplateCleanup.inspectLocal();
  assert.strictEqual(inspected.ok,true);
  assert.strictEqual(inspected.data.templates.length,3);
  assert(!inspected.data.templates.some(item=>item.id===OTHER.id));

  const result=await env.sandbox.TestHouseTemplateCleanup.cleanup();
  assert.strictEqual(result.ok,true,JSON.stringify(result));
  const deleteCalls=env.rpcCalls.filter(call=>
    call.name==='apply_library_template_content_operation');
  assert.strictEqual(deleteCalls.length,3);
  assert.deepStrictEqual(deleteCalls.map(call=>call.input.p_template_id).sort(),
    TARGETS.map(x=>x.id).sort());
  deleteCalls.forEach(call=>{
    assert.strictEqual(call.input.p_action,'delete');
    assert.strictEqual(call.input.p_template_type,'house');
    assert.strictEqual(call.input.p_payload,null);
  });
  assert.deepStrictEqual(env.sandbox.appData.houseTemplates.map(x=>x.id),[OTHER.id]);
  Object.values(env.stores).forEach(rows=>{
    assert.deepStrictEqual(rows.map(x=>x.templateId),[OTHER.id]);
  });
  assert.strictEqual(env.forgotten.length,3);
  assert.strictEqual(env.localStorage.getItem('sb-project-auth-token'),'AUTH');
  assert.strictEqual(env.localStorage.getItem('device-identity:user'),'DEVICE');
  assert.strictEqual(env.localStorage.getItem('organization-context'),'ORG');
  assert.strictEqual(env.sandbox.appData.organizationContext.organizationId,ORG);

  const repeated=await env.sandbox.TestHouseTemplateCleanup.cleanup();
  assert.strictEqual(repeated.ok,true);
  assert.strictEqual(repeated.status,'already_clean');
  assert.strictEqual(env.rpcCalls.filter(call=>
    call.name==='apply_library_template_content_operation').length,3);

  const previouslyDeleted=fixture({cloudDeleted:true});
  const recovered=await previouslyDeleted.sandbox.TestHouseTemplateCleanup.cleanup();
  assert.strictEqual(recovered.ok,true);
  assert.strictEqual(previouslyDeleted.rpcCalls.filter(call=>
    call.name==='apply_library_template_content_operation').length,0,
    'confirmed prior cloud deletes must only finish local cleanup');
  assert.deepStrictEqual(previouslyDeleted.sandbox.appData.houseTemplates
    .map(item=>item.id),[OTHER.id]);

  const failed=fixture({deleteFailure:true});
  const failure=await failed.sandbox.TestHouseTemplateCleanup.cleanup();
  assert.strictEqual(failure.ok,false);
  assert.strictEqual(failed.sandbox.appData.houseTemplates.length,4,
    'cloud failure must not delete any local template');

  const referenced=fixture({conferences:[{id:'real',houses:[{
    sourceTemplateId:TARGETS[0].id}]}]});
  assert.strictEqual(referenced.sandbox.TestHouseTemplateCleanup.inspectLocal().status,
    'conference_references_not_empty');
  assert.strictEqual(referenced.rpcCalls.length,0);

  const mismatch=fixture({ownerMismatch:true});
  const mismatchResult=await mismatch.sandbox.TestHouseTemplateCleanup.cleanup();
  assert.strictEqual(mismatchResult.ok,false);
  assert.strictEqual(mismatch.rpcCalls.filter(call=>
    call.name==='apply_library_template_content_operation').length,0);

  const development=fixture({environment:'development'});
  assert.strictEqual(development.sandbox.TestHouseTemplateCleanup.inspectLocal().status,
    'development_environment_blocked');
  assert.strictEqual(development.rpcCalls.length,0);

  assert(UI_SOURCE.includes('تنظيف قوالب الاختبار'));
  TARGETS.forEach(item=>assert(SOURCE.includes(item.id)));
  assert(!SOURCE.includes(OTHER.id));
  assert(!/\.flush\s*\(|\.captureLocalSave\s*\(|retry|repair/i.test(SOURCE));
  console.log('safe test house template cleanup tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
