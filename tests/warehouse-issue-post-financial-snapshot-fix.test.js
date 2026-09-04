const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const fix=fs.readFileSync('supabase/migrations/20260904200000_warehouse_issue_post_financial_snapshot_fix.sql','utf8');
const ledger=fs.readFileSync('supabase/migrations/20260904160000_warehouse_party_financial_ledger.sql','utf8');

const snapshots=['previous_balance_snapshot','operation_total_snapshot','remaining_snapshot','resulting_balance_snapshot'];

function snapshotTransitionAllowed(oldRow,newRow){
  if(oldRow.status!=='posted'||newRow.status!=='posted'||!Object.hasOwn(oldRow,'operation_total_snapshot'))return false;
  if(snapshots.some(key=>oldRow[key]!==null||newRow[key]===null))return false;
  const normalized={...newRow};
  for(const key of snapshots)normalized[key]=oldRow[key];
  if(Object.hasOwn(oldRow,'document_kind'))normalized.document_kind=oldRow.document_kind;
  return JSON.stringify(normalized)===JSON.stringify(oldRow);
}

test('stored generated document_kind is normalized only for the exact snapshot comparison',()=>{
  assert.match(fix,/to_jsonb\(new\)[\s\S]*jsonb_build_object\('document_kind',to_jsonb\(old\)->'document_kind'\)[\s\S]*is not distinct from to_jsonb\(old\)/);
  assert.match(fix,/to_jsonb\(old\) \? 'operation_total_snapshot'/);
});

test('real create-extension-post sequence permits one initial snapshot population',()=>{
  const draft={id:'issue',document_kind:'issue',status:'draft',revision:1,posted_at:null,updated_at:'t1',previous_balance_snapshot:null,operation_total_snapshot:null,remaining_snapshot:null,resulting_balance_snapshot:null};
  const posted={...draft,status:'posted',revision:2,posted_at:'t2',updated_at:'t2'};
  const beforeTrigger={...posted,document_kind:null,previous_balance_snapshot:10,operation_total_snapshot:25,remaining_snapshot:20,resulting_balance_snapshot:30};
  assert.equal(snapshotTransitionAllowed(posted,beforeTrigger),true);
});

test('post wrapper keeps inventory, finance, snapshots, audit, and completion in one call transaction',()=>{
  const order=['post_issue_inventory_core','beneficiary_financial_entries','beneficiary_balances','previous_balance_snapshot','issue.finance_applied'];
  let position=-1;
  for(const marker of order){const next=ledger.indexOf(marker,position+1);assert.ok(next>position,marker);position=next;}
  assert.match(ledger,/result:=warehouse\.post_issue_inventory_core\(p_device_id,p_operation_id,p_document_id,p_expected_revision\)/);
});

test('same applied post operation replays before any duplicate finance effect',()=>{
  assert.match(ledger,/result:=warehouse\.post_issue_inventory_core[\s\S]*if document\.operation_total_snapshot is not null then return result; end if;[\s\S]*insert into warehouse\.beneficiary_financial_entries/);
});

test('arbitrary posted Issue header mutation remains prohibited',()=>{
  const posted={id:'issue',document_kind:'issue',status:'posted',revision:2,posted_at:'t2',updated_at:'t2',purpose:'original',previous_balance_snapshot:null,operation_total_snapshot:null,remaining_snapshot:null,resulting_balance_snapshot:null};
  const changed={...posted,document_kind:null,purpose:'changed',previous_balance_snapshot:10,operation_total_snapshot:25,remaining_snapshot:20,resulting_balance_snapshot:30};
  assert.equal(snapshotTransitionAllowed(posted,changed),false);
  assert.match(fix,/raise exception 'WAREHOUSE_POSTED_DOCUMENT_IMMUTABLE'/);
});

test('second financial snapshot mutation remains prohibited',()=>{
  const posted={id:'issue',document_kind:'issue',status:'posted',revision:2,posted_at:'t2',updated_at:'t2',previous_balance_snapshot:10,operation_total_snapshot:25,remaining_snapshot:20,resulting_balance_snapshot:30};
  assert.equal(snapshotTransitionAllowed(posted,{...posted,document_kind:null,resulting_balance_snapshot:31}),false);
});

test('Receipt posted protections do not enter the Issue snapshot exception',()=>{
  const receipt={id:'receipt',document_kind:'receipt',status:'posted',revision:2,posted_at:'t2',updated_at:'t2'};
  assert.equal(snapshotTransitionAllowed(receipt,{...receipt,document_kind:null}),false);
});

test('reversal and delete protections remain unchanged',()=>{
  assert.match(fix,/if tg_op='DELETE' then[\s\S]*WAREHOUSE_DOCUMENT_DELETE_PROHIBITED/);
  assert.match(fix,/if old\.status='reversed' then[\s\S]*WAREHOUSE_REVERSED_DOCUMENT_IMMUTABLE/);
  assert.match(fix,/if new\.status='reversed'[\s\S]*new\.revision is not distinct from old\.revision[\s\S]*'updated_at',to_jsonb\(old\.updated_at\)/);
});
