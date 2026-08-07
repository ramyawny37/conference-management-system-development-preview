'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var root=path.resolve(__dirname,'..');
var migration=fs.readFileSync(path.join(root,
  'supabase/migrations/20260807_6_1_0_conference_role_management.sql'),'utf8');

function has(pattern,message){
  assert.match(migration,pattern,message);
}
function body(name,next){
  var start=migration.indexOf('function public.'+name+'(');
  var end=next?migration.indexOf('function public.'+next+'(',start):migration.length;
  assert.ok(start>=0&&end>start,'missing function '+name);
  return migration.slice(start,end);
}

var roles=['manager','viewer','accommodation_viewer','transport_viewer'];
var general=body('manage_conference_member','device_guarded_manage_conference_member');
var guarded=body('device_guarded_manage_conference_member','add_conference_manager');
var addLegacy=body('add_conference_manager','remove_conference_manager');
var removeLegacy=body('remove_conference_manager','device_guarded_add_conference_manager');

has(/add column if not exists requested_role text null/i,'requested role missing');
has(/add column if not exists previous_role text null/i,'previous role missing');
has(/add column if not exists stored_result jsonb null/i,'stored result missing');
['add_manager','remove_manager','add_member','change_member_role','remove_member']
  .forEach(function(type){has(new RegExp("'"+type+"'"),type+' operation missing');});
roles.forEach(function(role){
  has(new RegExp("'"+role+"'"),role+' role missing');
});
assert.doesNotMatch(
  migration.match(/conference_membership_operations_requested_role_check[\s\S]*?\),/i)[0],
  /'owner'/i,'owner must not be requestable');

has(/function public\.manage_conference_member\([\s\S]*p_requested_role text default null/i,
  'general RPC signature missing');
has(/p_action not in \('add', 'change_role', 'remove'\)/i,'action allowlist missing');
has(/not public\.is_conference_owner\(p_conference_id\)/i,'owner actor check missing');
has(/p_target_user_id = conference_owner_id[\s\S]*owner membership cannot be managed/i,
  'owner target protection missing');
has(/existing_role = 'owner'[\s\S]*owner membership cannot be managed/i,
  'owner row protection missing');
has(/pg_advisory_xact_lock[\s\S]*conference-membership-operation:/i,
  'operation advisory lock missing');
has(/requested_role is distinct from p_requested_role/i,'intent role mismatch missing');
has(/membership operation id belongs to another operation/i,'intent rejection missing');
has(/stored_result[\s\S]*jsonb_build_object\('replayed', true\)/i,
  'stored replay result missing');

roles.forEach(function(from){
  roles.forEach(function(to){
    if(from===to){
      assert.match(general,/existing_role = p_requested_role[\s\S]*result_status := 'unchanged'/i);
    }else{
      assert.match(general,/update public\.conference_members[\s\S]*set role = p_requested_role[\s\S]*result_status := 'role_changed'/i,
        from+' -> '+to+' transition missing');
    }
  });
});
assert.match(general,/p_action = 'add'[\s\S]*insert into public\.conference_members[\s\S]*result_status := 'added'/i);
assert.match(general,/p_action = 'add'[\s\S]*result_status := 'role_conflict'/i,
  'add with different role must not mutate');
assert.match(general,/p_action = 'change_role'[\s\S]*existing_role is null[\s\S]*result_status := 'not_member'/i,
  'change on non-member must not add');
assert.match(general,/delete from public\.conference_members[\s\S]*result_status := 'removed'/i);
assert.match(general,/existing_role is null[\s\S]*result_status := 'already_removed'/i);

assert.ok(guarded.indexOf('require_current_approved_device(p_actor_device_id)')<
  guarded.indexOf('return public.manage_conference_member('),
  'device guard must run before general RPC');
has(/revoke all on function public\.manage_conference_member\([\s\S]*from public, anon/i,
  'general RPC revoke missing');
has(/grant execute on function public\.manage_conference_member\([\s\S]*to authenticated/i,
  'general RPC authenticated grant missing');
assert.match(general,/security definer[\s\S]*set search_path = pg_catalog, public/i);

assert.match(addLegacy,/manage_conference_member\([\s\S]*'add', 'manager'/i,
  'legacy add wrapper missing');
assert.match(addLegacy,/when 'unchanged' then 'already_manager'/i,
  'legacy already_manager mapping missing');
assert.match(addLegacy,/target user has a different conference role/i,
  'legacy different-role behavior missing');
assert.match(addLegacy,/general_result[\s\S]*success[\s\S]*target user has a different conference role/i,
  'legacy replay must preserve different-role failure');
assert.ok(addLegacy.indexOf('if found then')<
  addLegacy.indexOf('select members.role into existing_role'),
  'legacy add replay must precede current membership checks');
assert.match(removeLegacy,/manage_conference_member\([\s\S]*'remove', null/i,
  'legacy remove wrapper missing');
assert.match(removeLegacy,/existing_role <> 'manager'[\s\S]*'already_removed'/i,
  'legacy non-manager removal behavior missing');
assert.ok(removeLegacy.indexOf('if found then')<
  removeLegacy.indexOf('select members.role into existing_role'),
  'legacy remove replay must precede current membership checks');
has(/function public\.device_guarded_add_conference_manager\([\s\S]*require_current_approved_device[\s\S]*add_conference_manager/i,
  'guarded legacy add wrapper missing');
has(/function public\.device_guarded_remove_conference_manager\([\s\S]*require_current_approved_device[\s\S]*remove_conference_manager/i,
  'guarded legacy remove wrapper missing');

assert.doesNotMatch(migration,/create policy|drop policy|alter policy/i,
  'conference member RLS must remain unchanged');
console.log('conference role management contract tests: passed');
