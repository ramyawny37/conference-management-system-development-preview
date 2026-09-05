'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const sql=fs.readFileSync('supabase/migrations/20260905170000_warehouse_item_unit_conversion.sql','utf8');
const remaining=fs.readFileSync('js/warehouse/remaining-operations.js','utf8');
const historical=fs.readFileSync('js/warehouse/historical-operations.js','utf8');
const workspace=fs.readFileSync('js/warehouse/workspace.js','utf8');
const contract=fs.readFileSync('js/supabase/warehouse-device-operation-contract.js','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
const ambiguityFix=fs.readFileSync('supabase/migrations/20260905193000_warehouse_item_unit_upsert_ambiguity_fix.sql','utf8');
const statusAmbiguityFix=fs.readFileSync('supabase/migrations/20260905200000_warehouse_item_unit_status_ambiguity_fix.sql','utf8');
const draftCostFix=fs.readFileSync('supabase/migrations/20260905203000_warehouse_unit_conversion_draft_wrapper_and_cost_fix.sql','utf8');

test('item-unit relation is item-specific, guarded, revisioned and not globally attached to units',()=>{
  assert.match(sql,/create table warehouse\.item_units/);
  assert.match(sql,/primary key\(item_id,unit_id\)/);
  assert.match(sql,/conversion_factor numeric\(20,6\).*check \(conversion_factor>0 and conversion_factor<'Infinity'::numeric\)/);
  assert.match(sql,/alter table warehouse\.item_units enable row level security/);
  assert.match(sql,/revoke all on warehouse\.item_units from public,anon,authenticated/);
  assert.doesNotMatch(sql,/alter table warehouse\.units add column conversion_factor/);
  assert.match(sql,/WAREHOUSE_ITEM_UNIT_DUPLICATE/);
});

test('legacy lines backfill as base-unit factor-one snapshots without touching posted projections',()=>{
  for(const table of ['receipt_lines','issue_lines','transfer_lines','adjustment_lines']){
    assert.match(sql,new RegExp('update warehouse\\.'+table+' l set selected_unit_id=i\\.base_unit_id,entered_quantity=l\\.quantity,conversion_factor_snapshot=1'));
    assert.match(sql,new RegExp('alter table warehouse\\.'+table+' disable trigger '+table+'_posted_immutable'));
    assert.match(sql,new RegExp('alter table warehouse\\.'+table+' enable trigger '+table+'_posted_immutable'));
  }
  assert.doesNotMatch(sql,/update warehouse\.stock_movements|update warehouse\.stock_balances|update warehouse\.beneficiary_(balances|financial_entries)/);
  assert.doesNotMatch(sql,/delete from/i);
});

test('server resolves current relation and ignores browser conversion-factor authority',()=>{
  assert.match(sql,/create function warehouse_private\.canonicalize_unit_lines/);
  assert.match(sql,/from warehouse\.item_units iu where iu\.item_id=item\.id and iu\.unit_id=selected\.id/);
  assert.match(sql,/raw_base_quantity:=entered\*relation\.conversion_factor/);
  assert.match(sql,/base_quantity:=round\(raw_base_quantity,base\.precision\)/);
  assert.match(sql,/unitCost',round\(selected_cost\/relation\.conversion_factor,6\)/);
  assert.match(sql,/unitPrice',round\(selected_price\/relation\.conversion_factor,6\)/);
  assert.doesNotMatch(sql,/source_line->>'conversionFactor'/);
});

test('all draft families canonicalize before established idempotency and posting remains base-quantity authoritative',()=>{
  assert.match(sql,/canonical:=warehouse_private\.canonicalize_unit_lines\(p_payload\);[\s\S]*create_document_draft_pre_unit_conversion/);
  assert.match(sql,/canonical:=warehouse_private\.canonicalize_unit_lines\(p_payload\);[\s\S]*update_document_draft_pre_unit_conversion/);
  for(const kind of ['receipt','issue','transfer'])assert.match(sql,new RegExp("p_kind='"+kind+"'"));
  assert.match(sql,/else update warehouse\.adjustment_lines/);
  const post=fs.readFileSync('supabase/migrations/20260829150000_warehouse_post_document_revision_ambiguity_correction.sql','utf8');
  assert.match(post,/line\.quantity/);
  assert.match(post,/WAREHOUSE_OPENING_BALANCE_EXISTING_HISTORY/);
});

test('selected price and cost are snapshotted while base prices feed valuation and finance',()=>{
  for(const column of ['selected_unit_cost','selected_unit_price','entered_quantity','conversion_factor_snapshot'])assert.match(sql,new RegExp(column));
  assert.match(sql,/selected_cost\/relation\.conversion_factor/);
  assert.match(sql,/selected_price\/relation\.conversion_factor/);
  assert.match(sql,/quantity=round\(entered_quantity\*conversion_factor_snapshot,6\)/);
});

test('unsafe base-unit changes and invalid or inactive relations have narrow errors',()=>{
  assert.match(sql,/exists\(select 1 from warehouse\.stock_movements where item_id=old\.id\)/);
  for(const code of ['WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED','WAREHOUSE_ITEM_UNIT_INACTIVE','WAREHOUSE_CONVERSION_FACTOR_INVALID','WAREHOUSE_BASE_UNIT_CHANGE_WITH_HISTORY','WAREHOUSE_UNIT_CONVERSION_PRECISION_INVALID','WAREHOUSE_ITEM_UNIT_DUPLICATE'])assert.match(sql,new RegExp(code));
});

test('secure dispatcher, browser contract, and exact Edge allowlist expose item-unit management',()=>{
  assert.match(sql,/DEVICE_SESSION_INVALID/);
  assert.match(sql,/warehouse_private\.require_permission\(p_device_id,'warehouse\.item\.update'\)/);
  assert.match(sql,/warehouse_private\.begin_operation/);
  assert.match(sql,/warehouse_private\.write_audit/);
  assert.match(contract,/upsert_item_units/);
  assert.match(workspace,/data-wh-item-units/);
  assert.match(edge,/const warehouse=new Set\(\[[^\]]*'upsert_item_units'/);
});

test('Edge propagates exactly the six authorized W2 codes and continues masking unsafe errors',()=>{
  const start=edge.indexOf('function classified('),end=edge.indexOf('\nDeno.serve',start),runnable=edge.slice(start,end).replace('error:unknown','error').replace(/error as \{code\?:unknown,message\?:unknown\}/g,'error'),sandbox={Set,String};vm.runInNewContext(runnable,sandbox);
  for(const code of ['WAREHOUSE_ITEM_UNIT_NOT_CONFIGURED','WAREHOUSE_ITEM_UNIT_INACTIVE','WAREHOUSE_CONVERSION_FACTOR_INVALID','WAREHOUSE_BASE_UNIT_CHANGE_WITH_HISTORY','WAREHOUSE_UNIT_CONVERSION_PRECISION_INVALID','WAREHOUSE_ITEM_UNIT_DUPLICATE'])assert.deepEqual({...sandbox.classified({code:'22023',message:code})},{status:422,code});
  assert.deepEqual({...sandbox.classified({code:'XX000',message:'WAREHOUSE_INTERNAL_SCHEMA_DETAIL'})},{status:500,code:'PLATFORM_DEVICE_OPERATION_FAILED'});
  assert.doesNotMatch(edge,/WAREHOUSE_\*/);
});

test('transaction UIs send unitId and balances remain base-unit displays',()=>{
  assert.match(remaining,/name="unitId"/);
  assert.match(remaining,/unitId:row\.querySelector\('\[name="unitId"\]'\)\.value/);
  assert.match(historical,/unitId:data\.unitId/);
  assert.match(historical,/unitId:line\.unitId/);
  assert.match(workspace,/وحدات الصنف/);
  assert.doesNotMatch(remaining+historical,/conversionFactor\s*:/);
});

test('opening balance unit selector shows only configured active item units',async()=>{
  const store='11111111-1111-4111-8111-111111111111',item='22222222-2222-4222-8222-222222222222',base='33333333-3333-4333-8333-333333333333',pack='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
  const master={items:[{id:item,name:'كشكول',sku:'PRD-1',base_unit_id:base,status:'active'}],units:[{id:base,name:'قطعة',symbol:'قطعة',status:'active'},{id:pack,name:'باكو',symbol:'باكو',status:'active'},{id:other,name:'كرتونة',symbol:'كرتونة',status:'active'}],itemUnits:[{item_id:item,unit_id:base,conversion_factor:1,status:'active'},{item_id:item,unit_id:pack,conversion_factor:10,status:'active'},{item_id:item,unit_id:other,conversion_factor:200,status:'inactive'}]};
  const dom=new JSDOM('<main id="startupScreen"></main><section id="warehouseWorkspace"></section>',{url:'https://example.test/',runScripts:'outside-only'}),window=dom.window;
  window.AppIcons={icon:()=>''};window.showPlatformModules=()=>{};window.prompt=()=>'';window.SupabaseAuth={getAccountIdentity:()=>({authenticated:true,userId:'a'})};window.SupabaseDeviceIdentity={getCurrent:()=>({id:'b'})};window.BrowserStorageNamespace={key:x=>x};window.ApplicationRouting={resolveLogicalRoute:x=>x,getLogicalPathname:()=>'/'};window.WarehouseDeviceOperationContract={get:()=>({operationIdRequired:false,dispatchable:true})};window.WarehouseTransport={invoke:name=>Promise.resolve(name==='discover_stores'?[{id:store,name:'المخزن',status:'active'}]:name==='list_item_master'?master:[])};
  for(const file of ['js/warehouse/current-store-context.js','js/warehouse/historical-operations.js','js/warehouse/party-management.js','js/warehouse/remaining-operations.js','js/warehouse/workspace.js'])window.eval(fs.readFileSync(file,'utf8'));
  window.WarehouseRemainingOperations.setAdjustmentMode('opening_balance');await window.WarehouseWorkspace.load('adjustments?mode=opening_balance');
  const itemSelect=window.document.querySelector('[name="itemId"]');itemSelect.value=item;itemSelect.dispatchEvent(new window.Event('change',{bubbles:true}));
  const values=[...window.document.querySelector('[name="unitId"]').options].map(option=>option.value);
  assert.deepEqual(values,['',base,pack]);
});

test('precision validation rejects fractional pieces without silently rounding and permits configured decimals',()=>{
  assert.match(sql,/entered<>round\(entered,selected\.precision\)/);
  assert.match(sql,/raw_base_quantity<>round\(raw_base_quantity,base\.precision\)/);
  assert.match(sql,/base_quantity:=round\(raw_base_quantity,base\.precision\)/);
  assert.doesNotMatch(sql,/base_quantity:=round\(entered\*relation\.conversion_factor,6\)/);
  assert.equal(2,Math.round(2));
  assert.notEqual(2.5,Math.round(2.5));
  assert.equal(1.234,Number((1.234).toFixed(3)));
});

test('cost, price, opening, transfer and approval snapshot scenarios are mathematically exact',()=>{
  const factor=10;
  assert.deepEqual({entered:3,selectedCost:100,baseQuantity:3*factor,baseCost:100/factor,total:3*100,inventory:3*factor*(100/factor)},{entered:3,selectedCost:100,baseQuantity:30,baseCost:10,total:300,inventory:300});
  assert.deepEqual({entered:2,selectedPrice:120,baseQuantity:2*factor,basePrice:120/factor,total:2*120},{entered:2,selectedPrice:120,baseQuantity:20,basePrice:12,total:240});
  assert.deepEqual({baseQuantity:6*factor,baseCost:100/factor,inventory:6*100},{baseQuantity:60,baseCost:10,inventory:600});
  assert.deepEqual({out:2*factor,in:2*factor},{out:20,in:20});
  assert.match(sql,/conversion_factor_snapshot/);
  assert.match(fs.readFileSync('supabase/migrations/20260829150000_warehouse_post_document_revision_ambiguity_correction.sql','utf8'),/submitted_revision<>p_expected_revision/);
});

test('dual quantity display uses immutable line snapshots and suppresses factor-one duplication',()=>{
  for(const source of [remaining,historical]){
    assert.match(source,/function quantityDisplay/);
    assert.match(source,/conversion_factor_snapshot/);
    assert.match(source,/entered_quantity/);
    assert.match(source,/factor!==1/);
  }
});

test('item-unit upsert ambiguity fix preserves guards, idempotency, revision and audit',()=>{
  assert.match(ambiguityFix,/target_unit_id uuid/);
  assert.doesNotMatch(ambiguityFix,/\bunit_id uuid;/);
  assert.match(ambiguityFix,/on conflict\(item_id,unit_id\) do update/);
  assert.match(ambiguityFix,/warehouse_private\.require_permission\(p_device_id,'warehouse\.item\.update'\)/);
  assert.match(ambiguityFix,/warehouse_private\.begin_operation/);
  assert.match(ambiguityFix,/warehouse_private\.write_audit/);
  assert.match(ambiguityFix,/warehouse_private\.complete_operation/);
  assert.match(ambiguityFix,/update warehouse\.items set revision=revision\+1/);
  assert.doesNotMatch(ambiguityFix,/delete from|stock_movements|stock_balances|beneficiary_financial/i);
});

test('second item-unit ambiguity fix renames status comprehensively without broad changes',()=>{
  assert.match(statusAmbiguityFix,/target_status text/);
  assert.doesNotMatch(statusAmbiguityFix,/\bstatus text;/);
  assert.match(statusAmbiguityFix,/target_status:=coalesce\(entry->>'status','active'\)/);
  assert.match(statusAmbiguityFix,/target_status<>'active'/);
  assert.match(statusAmbiguityFix,/factor,target_status,actor,actor/);
  assert.match(statusAmbiguityFix,/on conflict\(item_id,unit_id\) do update/);
  assert.match(statusAmbiguityFix,/warehouse_private\.require_permission/);
  assert.match(statusAmbiguityFix,/warehouse_private\.begin_operation/);
  assert.match(statusAmbiguityFix,/warehouse_private\.write_audit/);
  assert.match(statusAmbiguityFix,/warehouse_private\.complete_operation/);
  assert.doesNotMatch(statusAmbiguityFix,/delete from|stock_movements|stock_balances|beneficiary_financial/i);
});

test('item-unit dialog separates the generated base relation and submits the authoritative list',()=>{
  assert.match(workspace,/warehouse-item-unit-base/);
  assert.match(workspace,/هذه هي وحدة المخزون الأساسية للصنف/);
  assert.match(workspace,/الوحدات الإضافية/);
  assert.match(workspace,/\+ إضافة وحدة أخرى/);
  assert.match(workspace,/حفظ التغييرات/);
  assert.match(workspace,/units=\[\{unitId:baseId,conversionFactor:1,status:'active'\}\]\.concat/);
  assert.match(workspace,/button\[data-wh-item-units\]/);
  assert.match(workspace,/String\(unit\.id\)!==String\(baseId\)/);
  assert.match(workspace,/option\.disabled=.*selected\.indexOf\(option\.value\)>=0/);
  assert.match(workspace,/if\(unitRow\.dataset\.whPersisted\)/);
  assert.match(workspace,/querySelector\('\[name="status"\]'\)\.value='inactive'/);
  assert.doesNotMatch(workspace,/عدد الوحدات الأساسية/);
});

test('item-unit failure remains masked and preserves the open form while success reloads it',()=>{
  assert.match(workspace,/mutate\('upsert_item_units'[\s\S]*\.catch\(function\(e\)\{error\.textContent=remainingWarehouseError\(e\)/);
  assert.match(workspace,/error\.hidden=false/);
  assert.doesNotMatch(workspace,/catch\(function\(e\)\{host\.innerHTML=''/);
  assert.match(workspace,/function mutate\(name,args,s\)[\s\S]*return load\(s\)\.then/);
  assert.deepEqual({...(()=>{const start=edge.indexOf('function classified('),end=edge.indexOf('\nDeno.serve',start),sandbox={Set,String};vm.runInNewContext(edge.slice(start,end).replace('error:unknown','error').replace(/error as \{code\?:unknown,message\?:unknown\}/g,'error'),sandbox);return sandbox.classified({code:'42702',message:'column reference unit_id is ambiguous'});})()},{status:500,code:'PLATFORM_DEVICE_OPERATION_FAILED'});
});

test('draft wrapper uses an unambiguous created document identifier in every family',()=>{
  assert.match(draftCostFix,/created_document_id uuid/);
  assert.doesNotMatch(draftCostFix,/\bdocument_id uuid;/);
  for(const table of ['receipt_documents','issue_documents','transfer_documents','adjustment_documents'])assert.match(draftCostFix,new RegExp('warehouse\\.'+table+' where id=created_document_id'));
  assert.equal((draftCostFix.match(/l\.document_id=created_document_id/g)||[]).length,4);
  assert.doesNotMatch(draftCostFix,/l\.document_id=document_id|where id=document_id/);
});

test('adjustment inbound cost is canonicalized independently from receipt unit cost',()=>{
  assert.match(draftCostFix,/uses_inbound_cost:=source_line \? 'inboundUnitCost'/);
  assert.match(draftCostFix,/when uses_inbound_cost then nullif\(source_line->>'inboundUnitCost',''\)::numeric else nullif\(source_line->>'unitCost',''\)::numeric/);
  assert.match(draftCostFix,/jsonb_build_object\('selectedUnitCost',selected_cost,'inboundUnitCost',round\(selected_cost\/relation\.conversion_factor,6\)\)/);
  assert.match(draftCostFix,/jsonb_build_object\('selectedUnitCost',selected_cost,'unitCost',round\(selected_cost\/relation\.conversion_factor,6\)\)/);
  assert.deepEqual({enteredQuantity:1,factor:10,quantity:10,selectedUnitCost:100,inboundUnitCost:10,total:100},{enteredQuantity:1,factor:10,quantity:10,selectedUnitCost:100,inboundUnitCost:10,total:100});
  assert.doesNotMatch(draftCostFix,/delete from|update warehouse\.stock_movements|update warehouse\.stock_balances|update warehouse\.beneficiary_/i);
});
