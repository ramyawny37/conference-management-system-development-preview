'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');

var file=path.resolve(
  __dirname,
  '../supabase/migrations/20260729_4_0_0_conference_membership.sql'
);
var sql=fs.readFileSync(file,'utf8');

function has(pattern,message){
  assert.ok(pattern.test(sql),message);
}

has(/create table public\.conference_membership_operations/i,
  'membership operation table is required');
has(/operation_id uuid primary key/i,
  'membership operations require a unique operation id');
assert.strictEqual(
  /target_user_id uuid not null\s+references auth\.users/i.test(sql),
  false,
  'target deletion must not erase membership idempotency history'
);
has(/operation_type in \('add_manager', 'remove_manager'\)/i,
  'membership operation types must be constrained');
has(/result_status text not null[\s\S]*result_status in \([\s\S]*'added'[\s\S]*'already_manager'[\s\S]*'removed'[\s\S]*'already_removed'/i,
  'original membership result status must be stored and constrained');
has(/enable row level security/i,'operation table must enable RLS');
has(/revoke all on table public\.conference_membership_operations[\s\S]*authenticated/i,
  'membership operations must not be directly writable');

has(/function public\.handle_new_user_profile\(\)/i,
  'profile provisioning trigger function is required');
has(/after insert on auth\.users/i,
  'new auth users must provision profiles');
has(/insert into public\.profiles[\s\S]*from auth\.users[\s\S]*on conflict \(id\) do nothing/i,
  'existing users must be backfilled idempotently');

has(/function public\.get_my_conference_access\(\s*p_conference_id uuid/i,
  'current access RPC is required');
has(/'canManageMembers', membership\.role = 'owner'/i,
  'only owners may manage membership');
has(/'canSync', membership\.role in \('owner', 'manager'\)/i,
  'owner and manager sync capability is required');
has(/'canAcquireLock', membership\.role in \('owner', 'manager'\)/i,
  'lock capability must match write roles');

has(/function public\.list_conference_members\(\s*p_conference_id uuid/i,
  'member listing RPC is required');
has(/if not public\.is_conference_member\(p_conference_id\)/i,
  'member listing must require conference membership');
var listBody=sql.match(
  /function public\.list_conference_members[\s\S]*?\nend;\n\$\$;/i
)[0];
assert.strictEqual(
  /\bemail\b/i.test(listBody),
  false,
  'member listing must not expose email'
);

has(/function public\.lookup_conference_user_by_email\(\s*p_conference_id uuid,\s*p_email text/i,
  'email lookup must be a separate RPC');
has(/if not public\.is_conference_owner\(p_conference_id\)/i,
  'email lookup must be owner-only');
has(/lower\(users\.email\) = lower\(btrim\(p_email\)\)/i,
  'email lookup must use exact normalized matching');

has(/function public\.add_conference_manager\(\s*p_conference_id uuid,\s*p_target_user_id uuid,\s*p_operation_id uuid/i,
  'add manager RPC must use target user id');
has(/function public\.remove_conference_manager\(\s*p_conference_id uuid,\s*p_target_user_id uuid,\s*p_operation_id uuid/i,
  'remove manager RPC must use target user id');

var addBody=sql.match(
  /function public\.add_conference_manager[\s\S]*?\nend;\n\$\$;/i
)[0];
var removeBody=sql.match(
  /function public\.remove_conference_manager[\s\S]*?\nend;\n\$\$;/i
)[0];

assert.strictEqual(/\bemail\b/i.test(addBody),false,
  'add manager must not depend on email');
assert.strictEqual(/\bemail\b/i.test(removeBody),false,
  'remove manager must not depend on email');
has(/add_conference_manager[\s\S]*is_conference_owner\(p_conference_id\)/i,
  'add manager must be owner-only');
has(/remove_conference_manager[\s\S]*is_conference_owner\(p_conference_id\)/i,
  'remove manager must be owner-only');
has(/p_target_user_id = conference_owner_id[\s\S]*owner is already a member/i,
  'adding the owner again must be rejected');
has(/p_target_user_id = conference_owner_id[\s\S]*owner membership cannot be removed/i,
  'owner removal must be rejected');

has(/where operation\.operation_id = p_operation_id/i,
  'operation id must be checked before mutation');
assert.strictEqual(
  (sql.match(/pg_advisory_xact_lock\(/g)||[]).length,
  2,
  'add and remove must serialize operation ids transactionally'
);
has(/existing_operation\.conference_id <> p_conference_id/i,
  'operation id must be scoped to conference');
has(/existing_operation\.actor_user_id <> current_user_id/i,
  'operation id must be scoped to actor');
has(/existing_operation\.target_user_id <> p_target_user_id/i,
  'operation id must be scoped to target');
has(/membership operation id belongs to another operation/i,
  'operation mismatch must fail safely');
assert.strictEqual(
  (sql.match(/'status', existing_operation\.result_status/g)||[]).length,
  2,
  'replays must return the stored original result status'
);
assert.strictEqual(/'status', 'duplicate'/i.test(sql),false,
  'replays must not replace the original status with duplicate');
assert.strictEqual(
  (sql.match(/operation_result_status text/g)||[]).length,
  2,
  'add and remove must calculate an original result status'
);
assert.strictEqual(
  (sql.match(/resulting_role,\s*result_status/g)||[]).length,
  2,
  'add and remove must persist the original result status'
);
assert.ok(
  addBody.indexOf(
    'where operation.operation_id = p_operation_id'
  )<addBody.indexOf('select 1 from auth.users as users'),
  'add replay check must precede mutable target user existence check'
);

has(/delete from public\.conference_locks[\s\S]*user_id = p_target_user_id/i,
  'removing a manager must release that user lock');
has(/function public\.enforce_conference_lock_manager\(\)/i,
  'lock writes require a role enforcement trigger');
has(/has_conference_role\([\s\S]*array\['owner', 'manager'\]/i,
  'lock writes must require owner or manager');
has(/before insert or update or delete on public\.conference_locks/i,
  'lock role enforcement must cover every lock mutation');

[
  'get_my_conference_access',
  'list_conference_members',
  'lookup_conference_user_by_email',
  'add_conference_manager',
  'remove_conference_manager'
].forEach(function(name){
  has(new RegExp(
    'grant execute on function public\\.'+name,
    'i'
  ),name+' must be executable only through an explicit grant');
});

[
  'get_my_conference_access\\(uuid\\)',
  'list_conference_members\\(uuid\\)',
  'lookup_conference_user_by_email\\(\\s*uuid, text\\s*\\)',
  'add_conference_manager\\(\\s*uuid, uuid, uuid\\s*\\)',
  'remove_conference_manager\\(\\s*uuid, uuid, uuid\\s*\\)'
].forEach(function(signature){
  has(new RegExp(
    'revoke all on function public\\.'+signature+
    '\\s*from public, anon, authenticated',
    'i'
  ),signature+' must revoke public, anon, and authenticated explicitly');
});

var grants=(sql.match(
  /grant execute on function public\.[\s\S]*?\bto authenticated;/gi
)||[]);
assert.strictEqual(grants.length,5,
  'only the five public RPCs must be granted to authenticated');
assert.strictEqual(
  /grant execute[\s\S]*\bto (public|anon)\b/i.test(sql),
  false,
  'no public RPC may be granted to public or anon'
);

console.log('conference members SQL contract tests: passed');
