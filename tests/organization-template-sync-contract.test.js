'use strict';
const assert=require('assert'),fs=require('fs');
const sql=fs.readFileSync('supabase/migrations/20260812_6_8_0_organization_template_sync.sql','utf8');
const service=fs.readFileSync('js/sync/organization-template-sync.js','utf8');
[
  'create table public.organization_templates',
  'create table public.organization_template_operations',
  'create table public.organization_template_audit_log',
  'public.list_organization_templates',
  'public.apply_organization_template_operation',
  "p_template_type not in ('house','conference')",
  "p_action not in ('upsert','delete')",
  'TEMPLATE_OPERATION_INTENT_MISMATCH',
  "return jsonb_build_object('status','conflict'",
  'perform public.require_current_approved_device',
  "actor_role not in ('organization_owner','organization_admin')",
  'ARCHIVED_ORGANIZATION_READ_ONLY',
  'enable row level security',
  'revoke all on public.organization_templates',
  'grant execute on function public.list_organization_templates(uuid,uuid) to authenticated'
].forEach(value=>assert(sql.includes(value),'missing contract: '+value));
assert(!/grant\s+(select|insert|update|delete).*organization_templates.*authenticated/i.test(sql));
['captureLocalSave','organizationTemplateOperations','baseRevision','status===\'conflict\'','postgres_changes','visibilitychange','scopeTemplate'].forEach(value=>assert(service.includes(value),'missing client contract '+value));
assert(!/\.from\(['"]organization_templates['"]\)\.(insert|update|delete|upsert)/.test(service),'client must use RPC only');
console.log('organization template sync contract: PASS');
