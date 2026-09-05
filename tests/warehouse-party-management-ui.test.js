const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const party=fs.readFileSync('js/warehouse/party-management.js','utf8');
const workspace=fs.readFileSync('js/warehouse/workspace.js','utf8');
const historical=fs.readFileSync('js/warehouse/historical-operations.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');
const css=fs.readFileSync('style.css','utf8');

test('parties route and Arabic navigation are wired',()=>{
  assert.match(workspace,/\['parties','الأشخاص والجهات'\]/);
  assert.match(workspace,/s==='parties'\?global\.WarehousePartyManagement\.load/);
  assert.match(party,/data-wh-route="parties"/);
});

test('Party screen discovers all statuses through the protected operation',()=>{
  assert.match(party,/deps\.invoke\('discover_parties',\{p_role:null,p_include_inactive:true\}\)/);
});

test('Party create uses the supported payload operation',()=>{
  assert.match(party,/current\.id\?'update_party':'create_party'/);
  for(const field of ['name','phone','governorate','city','status','notes','roles'])assert.match(party,new RegExp(field+':'));
});

test('Party update is revision-aware',()=>{
  assert.match(party,/args\.p_party_id=current\.id/);
  assert.match(party,/args\.p_expected_revision=Number\(current\.revision\)/);
});

test('supplier and beneficiary roles can coexist',()=>{
  assert.match(party,/selected\.push\('supplier'\)/);
  assert.match(party,/selected\.push\('beneficiary'\)/);
  assert.match(party,/يجب اختيار دور واحد على الأقل/);
});

test('search, role, and status filters are present',()=>{
  assert.match(party,/data-wh-party-search/);
  assert.match(party,/data-wh-party-role-filter/);
  assert.match(party,/data-wh-party-status-filter/);
  assert.match(party,/row\.hidden=/);
});

test('inactive Party state is visible and available for management filtering',()=>{
  assert.match(party,/<option value="inactive">غير نشط<\/option>/);
  assert.match(party,/p_include_inactive:true/);
});

test('safe Arabic Party errors cover required authorization and revision cases',()=>{
  for(const code of ['WAREHOUSE_PARTY_REQUIRED','WAREHOUSE_PARTY_ROLE_INVALID','WAREHOUSE_PARTY_REVISION_CONFLICT','WAREHOUSE_PARTY_INACTIVE','MODULE_PERMISSION_REQUIRED','DEVICE_AUTHORIZATION_REQUIRED'])assert.match(party,new RegExp(code));
});

test('no Party deletion or direct browser DML is introduced',()=>{
  assert.doesNotMatch(party,/delete_party|remove_party|\.from\s*\(|\.schema\s*\(|\.rpc\s*\(|supabase/i);
  assert.match(party,/deps\.invoke\(/);
});

test('Receipt supplier discovery remains active-only',()=>{
  assert.match(historical,/discover_parties',\{p_role:'supplier',p_include_inactive:false\}/);
});

test('Issue beneficiary discovery and balance operation are preserved',()=>{
  assert.match(historical,/discover_parties',\{p_role:'beneficiary',p_include_inactive:false\}/);
  assert.match(historical,/get_beneficiary_balance/);
});

test('registered gift recipient remains active Party discovery',()=>{
  assert.match(historical,/discover_parties',\{p_role:null,p_include_inactive:false\}/);
  assert.match(historical,/giftRecipientMode==='registered_person'/);
});

test('Party runtime asset loads before workspace and is precached',()=>{
  const asset='js/warehouse/party-management.js?rev=warehouse-party-management-v1';
  assert.ok(index.includes(asset));
  assert.ok(index.indexOf(asset)<index.indexOf('js/warehouse/workspace.js'));
  assert.ok(worker.includes('./'+asset));
  assert.match(worker,/development-3-4-0-issue-selected-unit-v1/);
});

test('Party list and dialog are responsive within Warehouse styling',()=>{
  assert.match(css,/\.warehouse-party-toolbar\{display:grid/);
  assert.match(css,/\.warehouse-party-list table\{min-width:720px\}/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.warehouse-party-toolbar\{grid-template-columns:1fr\}/);
  assert.match(party,/warehouse-dialog/);
});

test('no duplicate Party storage is introduced',()=>{
  assert.doesNotMatch(party,/localStorage|sessionStorage|indexedDB|fake|mock/i);
});
