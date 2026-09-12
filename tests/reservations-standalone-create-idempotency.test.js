'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260911120000_reservations_scope_partition_integrity.sql','utf8');
const executable=sql.replace(/\/\*[\s\S]*?\*\//g,'').replace(/--[^\n]*/g,'');
const body=(name)=>executable.match(new RegExp(`function reservations_private\\.${name}[\\s\\S]*?\\$\\$;`))[0];

test('first standalone create serializes, allocates one server partition, and completes one operation',()=>{
 const create=body('create_standalone_event_scoped');
 assert.match(create,/begin_standalone_create\(v_operation_id,v_context,p_args\)/);
 assert.match(create,/if v_replay is not null then return v_replay; end if;[\s\S]*?v_partition:=extensions\.gen_random_uuid\(\)/);
 assert.match(create,/insert into reservations\.events\(scope_type,scope_partition_id/);
 assert.match(create,/complete_standalone_create\(v_operation_id,v_context,p_args,v_result\)/);
});

test('exact sequential and concurrent retries return the original serialized result',()=>{
 const begin=body('begin_standalone_create');
 assert.match(begin,/pg_advisory_xact_lock/);
 assert.match(begin,/select \* into v_prior from reservations\.operations where operation_id=p_operation_id/);
 assert.match(begin,/if not found then return null; end if/);
 assert.match(begin,/return v_prior\.result/);
});

test('changed standalone event intent conflicts while normalized business fields exclude the generated partition',()=>{
 const intent=body('standalone_create_intent');
 const normalized=body('standalone_create_business_args');
 assert.match(intent,/standalone_create_business_args\(p_args\)/);
 assert.doesNotMatch(intent,/scope_partition_id/);
 assert.match(normalized,/p_args \?& array\['p_operation_id','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes'\]/);
 assert.match(normalized,/'name',btrim\(p_args->>'p_name'\)/);
 assert.match(sql,/RESERVATIONS_OPERATION_IDEMPOTENCY_CONFLICT/);
});

test('browser authority injection is rejected before standalone create permission or partition allocation',()=>{
 const normalized=body('standalone_create_business_args');
 for(const key of ['organization_id','p_organization_id','scope_partition_id','p_scope_partition_id','device_id','p_device_id','actor_user_id','p_actor_user_id','actor_device_id','p_actor_device_id']) assert.match(normalized,new RegExp(`'${key}'`));
 assert.match(normalized,/RESERVATIONS_SCOPE_OVERRIDE_DENIED/);
});

test('historical and partition-aware generic replay remains separate from standalone-create replay',()=>{
 const generic=body('begin_operation');
 assert.match(generic,/v_historical_intent/);
 assert.match(generic,/v_prior\.scope_partition_id=v_partition/);
 assert.match(sql,/begin_standalone_create\(v_operation_id,v_context,p_args\)/);
});

test('private helpers stay hardened and scoped entry points remain active beneath C4',()=>{
 for(const fn of ['begin_standalone_create','complete_standalone_create','create_standalone_event_scoped']) assert.match(body(fn),/security definer set search_path=''/);
 assert.match(sql,/revoke all on function reservations_private\.standalone_create_business_args[\s\S]*from public,anon,authenticated,service_role;/);
 assert.match(sql,/grant execute on function reservations_private\.standalone_create_business_args[\s\S]* to postgres;/);
 assert.match(executable,/create or replace function reservations\.read\(p_device_id uuid,p_operation text,p_args jsonb\)[\s\S]*reservations_private\.read_scoped\(p_device_id,p_operation,p_args\)/i);
 assert.match(executable,/create or replace function reservations\.mutate\(p_device_id uuid,p_operation text,p_args jsonb\)[\s\S]*reservations_private\.mutate_scoped\(p_device_id,p_operation,v_args\)/i);
 assert.match(executable,/rename to execute_device_operation_pre_reservations_standalone_dispatch/i);
});

test('C4 Platform dispatcher is a four-contract wrapper with an internal predecessor',()=>{
 const wrapper=executable.match(/create function platform\.execute_device_operation\(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_module text,p_operation text,p_args jsonb\)[\s\S]*?end \$\$;/i);
 assert.ok(wrapper);
 for(const operation of ['list_events','get_dashboard_summary','create_event','update_event']) assert.match(wrapper[0],new RegExp(`'${operation}'`));
 assert.match(wrapper[0],/execute_device_operation_pre_reservations_standalone_dispatch\(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args\)/);
 assert.match(wrapper[0],/return reservations\.read\(v_session\.device_id,p_operation,p_args\)/);
 assert.match(wrapper[0],/return reservations\.mutate\(v_session\.device_id,p_operation,p_args\)/);
 assert.match(sql,/revoke all on function platform\.execute_device_operation_pre_reservations_standalone_dispatch[\s\S]*from public,anon,authenticated,service_role;/);
 assert.match(sql,/grant execute on function platform\.execute_device_operation_pre_reservations_standalone_dispatch[\s\S]*to postgres;/);
});
