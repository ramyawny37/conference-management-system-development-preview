'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

function read(path){return fs.readFileSync(path,'utf8');}

const contractSource=read('js/supabase/warehouse-device-operation-contract.js');
const transport=read('js/supabase/warehouse-transport.js');
const session=read('js/supabase/device-session.js');
const currentStore=read('js/warehouse/current-store-context.js');
const conferenceContract=read('js/supabase/conference-device-operation-contract.js');
const guarded=read('supabase/migrations/20260829140200_warehouse_v1_guarded_rpc.sql');
const secureReads=read('supabase/migrations/20260829150500_warehouse_secure_read_surface.sql');
const unified=read('supabase/migrations/20260903180000_unified_platform_warehouse_device_operation.sql');
const parties=read('supabase/migrations/20260904160000_warehouse_party_financial_ledger.sql');
const cancellation=read('supabase/migrations/20260905133000_warehouse_draft_cancellation.sql');
const itemUnits=read('supabase/migrations/20260905170000_warehouse_item_unit_conversion.sql');
const catalog=read('supabase/migrations/20260829140000_warehouse_module_permission_catalog.sql');
const reconciliation=read('supabase/migrations/20260831023000_platform_foundation_reconciliation.sql');
const edge=read('supabase/functions/platform-device-operation/index.ts');
const sandbox={window:{}};
vm.runInNewContext(contractSource,sandbox);
const contract=sandbox.window.WarehouseDeviceOperationContract;
const warehouseRuntime=[contractSource,transport,guarded,secureReads,unified,parties,cancellation,itemUnits].join('\n');
const authorizationRuntime=warehouseRuntime+'\n'+edge;

test('Warehouse permission enforcement remains on the canonical module grant adapter',()=>{
  const helper=guarded.match(/create function warehouse_private\.require_permission[\s\S]*?end; \$\$;/i);
  assert.ok(helper,'Warehouse authorization helper must exist');
  assert.match(helper[0],/public\.require_effective_module_permission\(\s*p_device_id,'warehouse',p_permission/i);
  assert.match(helper[0],/case when p_store_id is null then null else 'store' end/i);
  assert.match(helper[0],/p_store_id::text/i);
  assert.doesNotMatch(helper[0],/inventory\.|platform\.user_roles|organization/i);
  for(const permission of catalog.match(/'warehouse\.[a-z]+\.[a-z]+'/g)||[])
    assert.match(permission,/^'warehouse\.[a-z]+\.[a-z]+'$/);
  assert.doesNotMatch(catalog,/inventory\.|organization/i);
});

test('store-aware Warehouse operations enforce exact store resource scope server-side',()=>{
  assert.match(guarded,/require_permission\(p_device_id,'warehouse\.store\.view',p_store_id\)/i);
  assert.match(guarded,/require_permission\(p_device_id,permission,stores\[1\]\)/i);
  assert.match(guarded,/require_permission\(p_device_id,permission,stores\[2\]\)/i);
  assert.match(secureReads,/require_store_set\(p_device_id,'warehouse\.store\.view',stores\)/i);
  assert.match(secureReads,/require_permission\(p_device_id,'warehouse\.reports\.view',p_store_id\)/i);
});

test('all protected Warehouse calls retain the unified device-session execution boundary',()=>{
  assert.match(transport,/invokeModuleProtected\('warehouse',operation,args\)/);
  assert.match(session,/functions\.invoke\('platform-device-operation'/);
  assert.match(edge,/schema\('platform'\)\.rpc\('execute_device_operation'/);
  assert.match(unified,/create or replace function platform\.execute_device_operation/i);
  assert.match(unified,/item\.purpose='PLATFORM_DEVICE_SESSION'/i);
  assert.match(unified,/profile\.account_status='approved'/i);
  for(const entry of contract.DISPATCHABLE)
    assert.match(edge,new RegExp("'"+entry.operation+"'"),'Edge allowlist missing '+entry.operation);
});

test('client actor-device overrides remain rejected at both client and dispatcher boundaries',()=>{
  assert.match(transport,/hasOwnProperty\.call\(args,'p_device_id'\)/);
  assert.match(transport,/hasOwnProperty\.call\(args,'p_actor_device_id'\)/);
  assert.match(transport,/ACTOR_DEVICE_OVERRIDE_DENIED/);
  assert.match(edge,/p_actor_device_id/);
  assert.match(edge,/module==='warehouse'.*p_device_id/);
  assert.match(unified,/p_args \? 'p_actor_device_id'.*p_args \? 'p_device_id'/i);
});

test('Warehouse runtime is Organization-independent and accepts no Organization argument',()=>{
  const organization=/organization_id|organizationId|organization_members|organization_owner|organization_admin|organization membership/i;
  assert.doesNotMatch(warehouseRuntime,organization);
  for(const entry of contract.PROTECTED){
    assert.doesNotMatch(entry.signature,/organization/i,entry.operation);
    assert.equal(entry.requiredArguments.some(argument=>/organization/i.test(argument)),false,entry.operation);
  }
  assert.match(currentStore,/KEY_PREFIX='warehouse-current-store:'/);
  assert.match(currentStore,/KEY_PREFIX\+user\+':'\+device/);
  assert.doesNotMatch(currentStore,organization);
});

test('the reconciled inventory role model is not consumed by Warehouse runtime authorization',()=>{
  assert.match(reconciliation,/create table platform\.permissions/i);
  assert.match(reconciliation,/'inventory\.access'/);
  assert.match(reconciliation,/platform\.user_roles/);
  assert.doesNotMatch(authorizationRuntime,/inventory\.[a-z]|platform\.user_roles|platform\.role_permissions|platform\.permissions/);
});

test('Conference Organization authorization contracts remain present and separate',()=>{
  assert.match(conferenceContract,/device_guarded_list_my_organizations/);
  assert.match(conferenceContract,/device_guarded_get_my_organization_access/);
  assert.match(conferenceContract,/device_guarded_list_organization_members/);
  assert.match(conferenceContract,/is_current_user_organization_member/);
  assert.doesNotMatch(contractSource,/organization/i);
});
