const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261020054724_close_warehouse_update_document_draft_direct_execute.sql'),'utf8');
const dispatcher=fs.readFileSync(path.join(root,'supabase/migrations/20261010201800_flatten_platform_device_operation_dispatcher.sql'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/functions/platform-device-operation/index.ts'),'utf8');
const signature='warehouse.update_document_draft(uuid, uuid, text, uuid, bigint, jsonb)';

test('warehouse draft update denies direct browser execution and preserves dispatcher execution',()=>{
  assert.match(migration,new RegExp(`revoke all on function ${signature.replace(/[().]/g,'\\$&')}[\\s\\S]*from public, anon, authenticated;`,'i'));
  assert.match(migration,new RegExp(`grant execute on function ${signature.replace(/[().]/g,'\\$&')}[\\s\\S]*to service_role;`,'i'));
});

test('warehouse draft update remains routed through the canonical device dispatcher',()=>{
  assert.match(dispatcher,/when 'update_document_draft' then[\s\S]*warehouse\.update_document_draft\(v_session\.device_id,/i);
  assert.match(dispatcher,/p_args\s*\?\s*'p_device_id'[\s\S]*ACTOR_DEVICE_OVERRIDE_DENIED/i);
  assert.match(dispatcher,/device_authorizations[\s\S]*status='approved'[\s\S]*DEVICE_SESSION_INVALID/i);
  assert.match(edge,/const warehouse=new Set\(\[[\s\S]*'update_document_draft'/);
});

test('the ACL correction does not replace warehouse business logic',()=>{
  assert.doesNotMatch(migration,/create\s+(?:or\s+replace\s+)?function/i);
  assert.doesNotMatch(migration,/alter\s+function/i);
  assert.doesNotMatch(migration,/update\s+warehouse\.|insert\s+into\s+warehouse\.|delete\s+from\s+warehouse\./i);
});
