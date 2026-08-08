'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260808_6_4_0_user_management_scoped_read.sql'),'utf8');
const service=fs.readFileSync(path.join(root,'js/sync/user-management-read-service.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'js/sync/user-management-ui.js'),'utf8');
const app=fs.readFileSync(path.join(root,'script.js'),'utf8');

[
  'get_user_management_actor_capabilities','search_user_management_users',
  'get_user_management_overview','get_user_management_devices',
  'require_current_approved_device','security definer',
  "set search_path = pg_catalog, public"
].forEach(value=>assert.ok(migration.toLowerCase().includes(value.toLowerCase()),value));
assert.match(migration,/actor_members\.role in \('organization_owner','organization_admin'\)/);
assert.match(migration,/conferences\.owner_id=actor_id|c\.owner_id=actor_id/);
assert.match(migration,/USER_MANAGEMENT_SCOPE_DENIED/);
assert.doesNotMatch(migration,/grant\s+(select|insert|update|delete)\s+on/i);
assert.match(service,/getActorCapabilities/);
assert.match(service,/canOpenUserManagement/);
assert.match(ui,/if\(caps\.canViewAccount\)/);
assert.match(ui,/if\(caps\.canViewOrganization\)/);
assert.match(ui,/if\(caps\.canViewConferences\)/);
assert.match(ui,/if\(caps\.canViewDevices\)/);
assert.doesNotMatch(ui,/\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
assert.match(app,/canOpenUserManagement===true/);
assert.match(app,/if\(canOpenUserManagement\)h\+=/);
console.log('user management scoped visibility contract tests: passed');
