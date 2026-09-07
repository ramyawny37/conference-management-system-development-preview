'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const service=read('js/sync/module-permission-administration-service.js');
const ui=read('js/sync/module-permission-administration-ui.js');
const index=read('index.html');
const worker=read('service-worker.js');
const edge=read('supabase/functions/platform-device-operation/index.ts');
const foundation=read('supabase/migrations/20260907140000_module_access_delegation_enforcement.sql');
const administration=read('supabase/migrations/20260907150000_module_permission_administration_backend_surface.sql');
const catalog=read('supabase/migrations/20260829130000_module_permission_catalog_and_grant_adapter.sql');

function contract(file,globalName){
  const sandbox={window:{}};
  vm.runInNewContext(read(file),sandbox);
  return sandbox.window[globalName];
}
function edgeSet(name){
  const declaration=edge.match(new RegExp('const '+name+'=new Set\\(\\[([^\\]]*)\\]\\)'));
  assert.ok(declaration,'missing Edge '+name+' allowlist');
  const values=new Set(Array.from(declaration[1].matchAll(/'([^']+)'/g),match=>match[1]));
  for(const addition of edge.matchAll(new RegExp(name+"\\.add\\('([^']+)'\\)",'g')))values.add(addition[1]);
  const additions=edge.match(new RegExp("for\\(const operation of \\[([^\\]]+)\\]\\)"+name+"\\.add\\(operation\\)"));
  if(additions)for(const match of additions[1].matchAll(/'([^']+)'/g))values.add(match[1]);
  return values;
}
const conferenceContract=contract('js/supabase/conference-device-operation-contract.js','ConferenceDeviceOperationContract');
const warehouseContract=contract('js/supabase/warehouse-device-operation-contract.js','WarehouseDeviceOperationContract');
const conferenceEdge=edgeSet('conference');
const warehouseEdge=edgeSet('warehouse');
const conferenceOperations=['search_module_permission_candidates','list_module_permission_catalog_for_administration','manage_catalog_module_grant','list_module_permission_grants','manage_foundation_module_grant','recover_revoke_final_module_manager'];
const warehouseOperations=['list_permission_administration_stores'];

test('foundation and catalog action vocabularies remain distinct end to end',()=>{
  assert.match(service,/p_action:foundation&&input\.action==='grant'\?'create':input\.action/);
  assert.doesNotMatch(service,/p_action:input\.action==='grant'\?'create':'revoke'/);
  assert.match(foundation,/p_action not in \('create', 'revoke'\)[\s\S]*INVALID_FOUNDATION_GRANT_OPERATION/);
  assert.match(catalog,/p_action not in \('grant', 'revoke'\)[\s\S]*INVALID_MODULE_GRANT_OPERATION/);
});
test('required administration operations have protected client and Edge parity',()=>{
  for(const operation of conferenceOperations){assert.equal(conferenceContract.isProtectedOperation(operation),true,'client missing '+operation);assert.equal(conferenceEdge.has(operation),true,'Edge missing '+operation);}
  for(const operation of warehouseOperations){assert.ok(warehouseContract.get(operation),'client missing '+operation);assert.equal(warehouseEdge.has(operation),true,'Edge missing '+operation);}
});
test('actor device overrides remain rejected at both client and Edge boundaries',()=>{
  assert.match(service,/ACTOR_DEVICE_OVERRIDE_DENIED/);
  assert.match(service,/hasOwnProperty\.call\(args\|\|{},'p_actor_device_id'\)/);
  assert.match(service,/hasOwnProperty\.call\(args\|\|{},'p_device_id'\)/);
  assert.match(edge,/hasOwnProperty\.call\(args,'p_actor_device_id'\)/);
  assert.match(edge,/module==='warehouse'&&Object\.prototype\.hasOwnProperty\.call\(args,'p_device_id'\)/);
});
test('frontend entrypoint loads service before UI',()=>{
  const serviceAsset='js/sync/module-permission-administration-service.js?rev=platform-round3g3-v1';
  const uiAsset='js/sync/module-permission-administration-ui.js?rev=platform-round3g3-v1';
  assert.ok(index.includes(serviceAsset));assert.ok(index.includes(uiAsset));assert.ok(index.indexOf(serviceAsset)<index.indexOf(uiAsset));
});
test('business authority remains server-catalog driven',()=>{
  assert.match(service,/invoke\('list_module_permission_catalog_for_administration'/);
  assert.match(ui,/state\.catalog\.map\(businessRow\)/);
  assert.doesNotMatch(service+ui,/warehouse\.(?:store|item|stock|receipt|issue|transfer|adjustment|approval|reversal|reports)\./);
});
test('foundation and catalog paths remain separated from Organization and Inventory',()=>{
  assert.match(ui,/foundationRow\('module\.access'/);assert.match(ui,/foundationRow\('module\.manage'/);
  assert.match(service,/foundation\?'manage_foundation_module_grant':'manage_catalog_module_grant'/);
  assert.match(service,/!foundation&&String\(input\.permissionKey\|\|''\)\.indexOf\('warehouse\.'\)!==0/);
  assert.doesNotMatch(service+ui,/organization|inventory\./i);
});
test('Round 3G frontend assets remain in the authoritative PWA shell',()=>{
  for(const asset of ['module-permission-administration-service.js?rev=platform-round3g3-v1','module-permission-administration-ui.js?rev=platform-round3g3-v1']){assert.ok(index.includes(asset),'index missing '+asset);assert.ok(worker.includes(asset),'cache shell missing '+asset);}
});
test('required migration sources and dispatcher contracts remain present',()=>{
  assert.ok(fs.existsSync(path.join(root,'supabase/migrations/20260907140000_module_access_delegation_enforcement.sql')));
  assert.ok(fs.existsSync(path.join(root,'supabase/migrations/20260907150000_module_permission_administration_backend_surface.sql')));
  assert.match(foundation,/create or replace function public\.manage_foundation_module_grant/);
  for(const operation of ['search_module_permission_candidates','list_module_permission_catalog_for_administration','manage_catalog_module_grant','list_permission_administration_stores'])assert.match(administration,new RegExp("'"+operation+"'"));
});
