'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const read=file=>fs.readFileSync(file,'utf8');
const index=read('index.html');
const worker=read('service-worker.js');
const editor=read('houseTemplates.js');
const state=read('state.js');
const repository=read('js/storage/storage-repository.js');
const script=read('script.js');
const retired=[
  'js/sync/organization-template-sync.js',
  'js/sync/house-template-content-authorization.js',
  'js/sync/house-template-sharing-ui.js'
];

for(const file of retired){
  assert.equal(fs.existsSync(file),false,file+' must be retired');
  assert.equal(index.includes(file),false,'index loads '+file);
  assert.equal(worker.includes(file),false,'service worker caches '+file);
}
assert.match(index,/houseTemplates\.js/);
assert.match(worker,/\.\/houseTemplates\.js/);
assert.doesNotMatch(index,/houseTemplateSharingModal|مشاركة قالب بيت مع مؤسسة/);
assert.doesNotMatch(script,/HouseTemplateSharingUI|مشاركة مع مؤسسة/);
assert.doesNotMatch(editor+state,/HouseTemplateContentAuthorization/);
for(const name of ['ht_addFloor','ht_deleteFloor','ht_addRoom','ht_deleteRoom','ht_addRoomToTemplate','ht_deleteRoomFromTemplate','ht_editFloorName','ht_deleteFloorFromTemplate']){
  assert.match(editor,new RegExp('function '+name+'\\('),name+' must remain');
}
assert.match(state,/function saveTemplateOnly\(options\)[\s\S]*CanonicalTemplateLibrary[\s\S]*library\.mutate\(type,id,payload\?'upsert':'delete',payload\)/);
assert.match(state,/persistedData\.templates=\[\][\s\S]*persistedData\.houseTemplates=\[\]/);
assert.match(repository,/return persistence\.saveAppData\(appData\)/);
assert.doesNotMatch(repository,/OrganizationTemplateSync|captureLocalSave|skipTemplateSync/);

(async function(){
  const writes=[];
  const sandbox={window:{AppIndexedDB:{saveAppData(data){writes.push(data);return Promise.resolve('saved');}}},Promise,Object,Error};
  vm.runInNewContext(repository,sandbox);
  const data={houseTemplates:[{id:'house',name:'Local',floors:[]}]};
  const result=await sandbox.window.StorageRepository.saveAppData(data);
  assert.equal(result.ok,true);
  assert.equal(result.status,'persisted');
  assert.equal(result.indexedDB,'saved');
  assert.equal(writes.length,1);
  assert.equal(writes[0],data);
  console.log('House Template Organization-sharing retirement tests: passed');
})().catch(function(error){console.error(error);process.exitCode=1;});
