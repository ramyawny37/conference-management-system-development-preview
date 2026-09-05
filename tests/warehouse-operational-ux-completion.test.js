const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const migration=fs.readFileSync('supabase/migrations/20260905133000_warehouse_draft_cancellation.sql','utf8');
const historical=fs.readFileSync('js/warehouse/historical-operations.js','utf8');
const remaining=fs.readFileSync('js/warehouse/remaining-operations.js','utf8');
const workspace=fs.readFileSync('js/warehouse/workspace.js','utf8');
const contract=fs.readFileSync('js/supabase/warehouse-device-operation-contract.js','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');

test('draft cancellation is guarded, revision-safe, audited and replay-safe',()=>{
  assert.match(migration,/create function warehouse\.cancel_document_draft/);
  assert.match(migration,/warehouse_private\.require_permission/);
  assert.match(migration,/warehouse_private\.begin_operation/);
  assert.match(migration,/p_expected_revision/);
  assert.match(migration,/revision=revision\+1/);
  assert.match(migration,/document\.draft_cancelled/);
  assert.match(migration,/warehouse_private\.complete_operation/);
  assert.match(migration,/approval<>'not_submitted'/);
  assert.match(migration,/status='draft' and revision=p_expected_revision/);
});

test('cancellation is non-delete and cannot mutate stock or finance',()=>{
  const body=migration.match(/create function warehouse\.cancel_document_draft[\s\S]*?end;\n\$\$;/)[0];
  assert.doesNotMatch(body,/delete\s+from/i);
  assert.doesNotMatch(body,/insert\s+into\s+warehouse\.stock_movements/i);
  assert.doesNotMatch(body,/update\s+warehouse\.stock_balances/i);
  assert.doesNotMatch(body,/warehouse\.party_financial_ledger/i);
  assert.match(body,/'stockMovement',false,'financialMutation',false/);
});

test('all draft document families gain only the cancelled lifecycle state',()=>{
  for(const table of ['receipt_documents','issue_documents','transfer_documents','adjustment_documents'])assert.match(migration,new RegExp("'"+table+"'"));
  assert.match(migration,/status in \(''draft'',''posted'',''reversed'',''cancelled''\)/);
  assert.match(migration,/status in \(''draft'',''cancelled''\) and posted_at is null and reversed_at is null/);
  assert.doesNotMatch(migration,/status='cancelled'.*(posted_at|reversed_at)\s*=\s*statement_timestamp/s);
});

test('cancellation is exposed only through the guarded operation path',()=>{
  assert.match(contract,/cancel_document_draft/);
  assert.match(edge,/cancel_document_draft/);
  assert.match(historical,/deps\.mutate\('cancel_document_draft'/);
  assert.match(remaining,/deps\.mutate\('cancel_document_draft'/);
  assert.doesNotMatch(historical,/\.from\(['"]warehouse\./);
  assert.doesNotMatch(remaining,/\.from\(['"]warehouse\./);
});

test('Edge classifier exposes only the four approved cancellation business errors',()=>{
  for(const code of ['WAREHOUSE_CANCELLATION_ARGUMENTS_REQUIRED','WAREHOUSE_CANCELLATION_REASON_REQUIRED','WAREHOUSE_DOCUMENT_STATE_INVALID','WAREHOUSE_CANCELLATION_APPROVAL_STATE_INVALID'])assert.match(edge,new RegExp("safeWarehouseBusiness=new Set\\(\\[[^\\]]*'"+code+"'"));
  assert.match(edge,/safeWarehouseBusiness\.has\(application\).*sqlState\.startsWith\('22'\)/);
  assert.doesNotMatch(edge,/safeWarehouseBusiness[^;]*WAREHOUSE_\*/);
});

test('cancelled UI is labelled and read-only while draft actions remain explicit',()=>{
  assert.match(workspace,/cancelled:'ملغاة'/);
  assert.match(historical,/status==='draft'.*data-wh-receipt-cancel/);
  assert.match(remaining,/status==='draft'.*data-wh-operation-cancel/);
  assert.match(historical,/status==='posted'.*data-wh-receipt-reverse/);
  assert.match(remaining,/status==='draft'.*submit_adjustment_for_approval/);
});

test('receipt summaries and complete readable details use loaded data',()=>{
  assert.match(historical,/lines\.length!==1.*lines\.length\+' أصناف'/);
  assert.match(historical,/item&&item\.name.*' × '/);
  for(const label of ['تاريخ المستند','مخزن الاستلام','المورد','الصنف / SKU / الوحدة','قيمة السطر','إجمالي المستند'])assert.match(historical,new RegExp(label));
});

test('opening balance supports save-only and guarded create then post',()=>{
  assert.match(remaining,/حفظ كمسودة/);
  assert.match(remaining,/حفظ وترحيل/);
  assert.match(remaining,/createOperationId=global\.crypto\.randomUUID\(\),postOperationId=global\.crypto\.randomUUID\(\)/);
  assert.match(remaining,/invoke\('create_adjustment_draft'[\s\S]*invoke\('post_adjustment'/);
  assert.match(remaining,/تم حفظ المسودة، لكن تعذر ترحيلها/);
  assert.match(workspace,/WAREHOUSE_OPENING_BALANCE_EXISTING_HISTORY/);
  assert.doesNotMatch(remaining,/submit_adjustment_for_approval[^\n]*opening_balance/);
});

test('timestamps and issue completion summary are operationally readable',()=>{
  assert.match(remaining,/Intl\.DateTimeFormat\('ar-EG'/);
  assert.match(remaining,/readableTimestamp\(value\(row,\['occurred_at'/);
  for(const label of ['رقم المستند','المستفيد','المخزن','الأصناف','المدفوع الآن','المتبقي'])assert.match(historical,new RegExp(label));
  assert.match(historical,/lineSummary:payload\.lines\.map/);
});
