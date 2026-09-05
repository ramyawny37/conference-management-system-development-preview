'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sql=fs.readFileSync('supabase/migrations/20260905213000_warehouse_system_owner_self_approval_exception.sql','utf8');
const constraintSql=fs.readFileSync('supabase/migrations/20260905214500_warehouse_system_owner_self_approval_record_constraint.sql','utf8');
const adjustment=sql.slice(0,sql.indexOf('create or replace function warehouse.decide_reversal_approval'));
const reversal=sql.slice(sql.indexOf('create or replace function warehouse.decide_reversal_approval'));

function ordered(source,patterns){
  let offset=-1;
  for(const pattern of patterns){
    const match=source.slice(offset+1).match(pattern);
    assert.ok(match,`missing ${pattern}`);
    offset+=1+match.index;
  }
}

test('adjustment preserves device and permission authorization before the bounded owner exception',()=>{
  ordered(adjustment,[
    /require_permission\(p_device_id,'warehouse\.stock\.approve',d\.store_id\)/,
    /actor:=\(context->>'actorUserId'\)::uuid/,
    /if actor=d\.creator_user_id then/,
    /system_owner_self_approval:=public\.is_system_owner\(actor\)/,
    /if not system_owner_self_approval then raise exception 'WAREHOUSE_CREATOR_SELF_APPROVAL_FORBIDDEN'/
  ]);
});

test('adjustment preserves decision, idempotency, revision, submitted revision and pending lifecycle',()=>{
  ordered(adjustment,[
    /p_decision not in \('approved','rejected'\)/,
    /begin_operation\(p_operation_id,context,'decide_adjustment_approval'/,
    /for update/,
    /status='draft' and approval_status='pending' and revision=p_expected_revision and submitted_revision=revision/,
    /WAREHOUSE_APPROVAL_STATE_INVALID/,
    /complete_operation\(p_operation_id,result\)/
  ]);
});

test('adjustment records the approver and identifies owner self-approval in existing audit architecture',()=>{
  assert.match(adjustment,/insert into warehouse\.approval_records[\s\S]*policy_version[\s\S]*d\.creator_user_id,actor,p_device_id/);
  assert.match(adjustment,/warehouse_approval_policy_v2_system_owner_self_approval/);
  assert.match(adjustment,/write_audit[\s\S]*jsonb_build_object\('systemOwnerSelfApproval',system_owner_self_approval\)/);
});

test('reversal applies the identical bounded owner exception and keeps non-owner prohibition',()=>{
  ordered(reversal,[
    /require_permission\(p_device_id,'warehouse\.stock\.approve',stores\[1\]\)/,
    /actor:=\(context->>'actorUserId'\)::uuid/,
    /if actor=request\.initiator_user_id then/,
    /system_owner_self_approval:=public\.is_system_owner\(actor\)/,
    /if not system_owner_self_approval then raise exception 'WAREHOUSE_REVERSAL_INITIATOR_SELF_APPROVAL_FORBIDDEN'/
  ]);
});

test('reversal preserves all-store permission, idempotency, lifecycle and immutable approval record',()=>{
  assert.match(reversal,/array_length\(stores,1\)=2 then perform warehouse_private\.require_permission/);
  ordered(reversal,[
    /begin_operation\(p_operation_id,context,'decide_reversal_approval'/,
    /for update/,
    /status='pending' and revision=p_expected_revision and submitted_revision=revision/,
    /WAREHOUSE_REVERSAL_APPROVAL_STATE_INVALID/,
    /insert into warehouse\.approval_records/,
    /write_audit[\s\S]*jsonb_build_object\('systemOwnerSelfApproval',system_owner_self_approval\)/,
    /complete_operation\(p_operation_id,result\)/
  ]);
});

test('migration changes only the two approval functions and contains no data mutation outside their runtime bodies',()=>{
  assert.equal((sql.match(/create or replace function/g)||[]).length,2);
  assert.doesNotMatch(sql,/\b(?:alter|drop|truncate|delete)\b/i);
  assert.doesNotMatch(sql,/ADJ-2026-00000090|insert into warehouse\.(?:adjustment_documents|reversal_requests|stock_movements|stock_balances)/i);
});

test('approval record constraint permits equality only under the explicit owner-exception policy',()=>{
  assert.match(constraintSql,/initiator_user_id<>approver_user_id\s+or policy_version='warehouse_approval_policy_v2_system_owner_self_approval'/);
  assert.match(constraintSql,/policy_version in \(\s*'warehouse_approval_policy_v1',\s*'warehouse_approval_policy_v2_system_owner_self_approval'/);
  assert.doesNotMatch(constraintSql,/\b(?:insert|update|delete|truncate)\b/i);
});
