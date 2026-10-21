-- Canonical Conference bundle export/restore.
-- User bundles contain operational Conference state only. Platform identities,
-- permissions, devices, sessions, locks, audit and operation ledgers stay server-owned.

create table if not exists platform_private.conference_bundle_operations(
  actor_user_id uuid not null references platform.profiles(user_id) on delete restrict,
  operation_id uuid not null,
  actor_device_id uuid not null references platform.devices(id) on delete restrict,
  mode text not null check(mode in('new','replace')),
  source_conference_id uuid not null,
  target_conference_id uuid not null,
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  primary key(actor_user_id,operation_id)
);
create index if not exists conference_bundle_operations_device_idx on platform_private.conference_bundle_operations(actor_device_id);
alter table platform_private.conference_bundle_operations enable row level security;
alter table platform_private.conference_bundle_operations force row level security;
revoke all on platform_private.conference_bundle_operations from public,anon,authenticated;

create or replace function platform_private.conference_bundle_tables()
returns text[] language sql immutable set search_path='' as $$
 select array[
  'conference_participations','conference_house_assignments','conference_room_assignments',
  'conference_accommodation_occupancies','conference_accommodation_pricing',
  'conference_accommodation_pricing_room_exclusions','conference_air_conditioning_defaults',
  'conference_air_conditioning_house_overrides','conference_air_conditioning_room_overrides',
  'conference_branding','conference_finance_settings','conference_finance_items',
  'conference_finance_adjustments','conference_restaurant_settings',
  'conference_restaurant_price_overrides','conference_restaurant_count_overrides',
  'conference_restaurant_participation_overrides','conference_transport_vehicles',
  'conference_transport_assignments'
 ]::text[]
$$;
revoke all on function platform_private.conference_bundle_tables() from public,anon,authenticated;

create or replace function platform_private.conference_bundle_uuid(p_operation_id uuid,p_source uuid)
returns uuid language sql immutable strict set search_path='' as $$
 select (substr(v,1,8)||'-'||substr(v,9,4)||'-4'||substr(v,14,3)||'-a'||substr(v,18,3)||'-'||substr(v,21,12))::uuid
 from (select md5(p_operation_id::text||':'||p_source::text) v) value
$$;
revoke all on function platform_private.conference_bundle_uuid(uuid,uuid) from public,anon,authenticated;

create or replace function platform_private.conference_bundle_rows(p_table text,p_conference_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;
begin
 if not p_table=any(platform_private.conference_bundle_tables()) then
  raise exception 'CONFERENCE_BUNDLE_TABLE_NOT_ALLOWED' using errcode='22023';
 end if;
 execute format(
  'select coalesce(jsonb_agg(to_jsonb(t)-array[''created_by'',''updated_by'',''created_at'',''updated_at'',''revision''] order by t.id::text),''[]''::jsonb) from public.%I t where conference_id=$1',p_table
 ) into v_rows using p_conference_id;
 return v_rows;
exception when undefined_column then
 execute format(
  'select coalesce(jsonb_agg(to_jsonb(t)-array[''created_by'',''updated_by'',''created_at'',''updated_at'',''revision'']),''[]''::jsonb) from public.%I t where conference_id=$1',p_table
 ) into v_rows using p_conference_id;
 return v_rows;
end $$;
revoke all on function platform_private.conference_bundle_rows(text,uuid) from public,anon,authenticated;

create or replace function public.export_conference_canonical_bundle(
 p_actor_device_id uuid,p_conference_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid;v_core public.conferences%rowtype;v_data jsonb;v_sections jsonb='{}'::jsonb;v_table text;v_rows jsonb;v_counts jsonb='{}'::jsonb;
begin
 v_actor:=public.require_current_approved_device(p_actor_device_id);
 perform public.require_effective_module_permission(p_actor_device_id,'conference','conference.data.export','conference',p_conference_id::text);
 select * into v_core from public.conferences where id=p_conference_id and deleted_at is null;
 if not found then raise exception 'CONFERENCE_NOT_FOUND' using errcode='22023'; end if;
 foreach v_table in array platform_private.conference_bundle_tables() loop
  v_rows:=platform_private.conference_bundle_rows(v_table,p_conference_id);
  v_sections:=v_sections||jsonb_build_object(v_table,v_rows);
  v_counts:=v_counts||jsonb_build_object(v_table,jsonb_array_length(v_rows));
 end loop;
 v_data:=jsonb_build_object(
  'conference',to_jsonb(v_core)-array['owner_id','updated_by','created_at','updated_at','deleted_at','revision'],
  'sections',v_sections
 );
 return jsonb_build_object(
  'type','conference-canonical-bundle','schemaVersion',1,
  'manifest',jsonb_build_object(
   'sourceConferenceId',p_conference_id,'sourceRevision',v_core.revision,
   'exportedAt',statement_timestamp(),'sectionCounts',v_counts,
   'payloadSha256',encode(extensions.digest(v_data::text,'sha256'),'hex'),
   'excludedAuthorities',jsonb_build_array('platform-identities','permissions','devices','sessions','locks','audit','operation-ledgers','reservations')
  ),'data',v_data
 );
end $$;
revoke all on function public.export_conference_canonical_bundle(uuid,uuid) from public,anon,authenticated;
grant execute on function public.export_conference_canonical_bundle(uuid,uuid) to service_role;

create or replace function platform_private.validate_conference_canonical_bundle(
 p_actor_device_id uuid,p_bundle jsonb,p_mode text,p_target_conference_id uuid,p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_data jsonb;v_manifest jsonb;v_sections jsonb;v_core jsonb;v_table text;v_rows jsonb;v_row jsonb;v_source uuid;v_target public.conferences%rowtype;v_errors jsonb='[]'::jsonb;v_person uuid;v_house uuid;v_room uuid;
begin
 v_actor:=public.require_current_approved_device(p_actor_device_id);
 if p_mode not in('new','replace') then raise exception 'CONFERENCE_BUNDLE_MODE_INVALID' using errcode='22023'; end if;
 if jsonb_typeof(p_bundle)<>'object' or p_bundle->>'type'<>'conference-canonical-bundle' or p_bundle->>'schemaVersion'<>'1' then
  raise exception 'CONFERENCE_BUNDLE_SCHEMA_UNSUPPORTED' using errcode='22023';
 end if;
 if octet_length(p_bundle::text)>10*1024*1024 then raise exception 'CONFERENCE_BUNDLE_TOO_LARGE' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(p_bundle))<>4 or not (p_bundle ?& array['type','schemaVersion','manifest','data']) then raise exception 'CONFERENCE_BUNDLE_FIELDS_INVALID' using errcode='22023'; end if;
 v_manifest:=p_bundle->'manifest';v_data:=p_bundle->'data';v_core:=v_data->'conference';v_sections:=v_data->'sections';
 if jsonb_typeof(v_manifest)<>'object' or jsonb_typeof(v_data)<>'object' or jsonb_typeof(v_core)<>'object' or jsonb_typeof(v_sections)<>'object' then raise exception 'CONFERENCE_BUNDLE_STRUCTURE_INVALID' using errcode='22023'; end if;
 if encode(extensions.digest(v_data::text,'sha256'),'hex') is distinct from v_manifest->>'payloadSha256' then raise exception 'CONFERENCE_BUNDLE_HASH_MISMATCH' using errcode='22023'; end if;
 v_source:=(v_manifest->>'sourceConferenceId')::uuid;
 if (v_core->>'id')::uuid is distinct from v_source then raise exception 'CONFERENCE_BUNDLE_SOURCE_MISMATCH' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(v_sections) k where not k=any(platform_private.conference_bundle_tables())) then raise exception 'CONFERENCE_BUNDLE_SECTION_NOT_ALLOWED' using errcode='22023'; end if;
 foreach v_table in array platform_private.conference_bundle_tables() loop
  v_rows:=v_sections->v_table;
  if jsonb_typeof(v_rows)<>'array' then raise exception 'CONFERENCE_BUNDLE_SECTION_REQUIRED: %',v_table using errcode='22023'; end if;
  for v_row in select value from jsonb_array_elements(v_rows) loop
   if jsonb_typeof(v_row)<>'object' or (v_row->>'conference_id')::uuid is distinct from v_source then raise exception 'CONFERENCE_BUNDLE_SECTION_SCOPE_INVALID: %',v_table using errcode='22023'; end if;
   if v_row ?| array['created_by','updated_by','owner_id','actor_user_id','actor_device_id','operation_id','session_id'] then raise exception 'CONFERENCE_BUNDLE_AUTHORITY_FIELD_FORBIDDEN' using errcode='22023'; end if;
  end loop;
 end loop;
 for v_person in select distinct (value->>'person_id')::uuid from jsonb_array_elements(v_sections->'conference_participations') where value ? 'person_id' loop
  if not exists(select 1 from platform.people where id=v_person) then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('code','PERSON_REFERENCE_NOT_FOUND','id',v_person)); end if;
 end loop;
 for v_house in select distinct (value->>'house_id')::uuid from jsonb_array_elements(v_sections->'conference_house_assignments') loop
  if not exists(select 1 from public.conference_accommodation_houses where id=v_house and is_active) then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('code','HOUSE_REFERENCE_NOT_FOUND','id',v_house)); end if;
 end loop;
 for v_room in select distinct (value->>'room_id')::uuid from jsonb_array_elements(v_sections->'conference_room_assignments') loop
  if not exists(select 1 from public.conference_accommodation_rooms where id=v_room) then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('code','ROOM_REFERENCE_NOT_FOUND','id',v_room)); end if;
 end loop;
 if p_mode='replace' then
  if p_target_conference_id is null or p_expected_revision is null then raise exception 'CONFERENCE_BUNDLE_REPLACE_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
  perform public.require_effective_module_permission(p_actor_device_id,'conference','conference.data.restore','conference',p_target_conference_id::text);
  select * into v_target from public.conferences where id=p_target_conference_id and deleted_at is null for update;
  if not found then raise exception 'CONFERENCE_NOT_FOUND' using errcode='22023'; end if;
  if v_target.revision<>p_expected_revision then raise exception 'CONFERENCE_BUNDLE_REVISION_CONFLICT' using errcode='40001'; end if;
 else
  perform public.require_effective_module_permission(p_actor_device_id,'conference','conference.lifecycle.create');
  if p_target_conference_id is not null and exists(select 1 from public.conferences where id=p_target_conference_id) then raise exception 'CONFERENCE_BUNDLE_TARGET_EXISTS' using errcode='23505'; end if;
  if exists(select 1 from jsonb_array_elements(v_sections->'conference_air_conditioning_house_overrides') item join public.conference_air_conditioning_house_overrides current on current.house_id=(item->>'house_id')::uuid)
     or exists(select 1 from jsonb_array_elements(v_sections->'conference_air_conditioning_room_overrides') item join public.conference_air_conditioning_room_overrides current on current.room_id=(item->>'room_id')::uuid) then
    v_errors:=v_errors||jsonb_build_array(jsonb_build_object('code','SHARED_OVERRIDE_CONFLICT'));
  end if;
 end if;
 return jsonb_build_object('valid',jsonb_array_length(v_errors)=0,'errors',v_errors,'sourceConferenceId',v_source,'targetConferenceId',p_target_conference_id,'mode',p_mode,'schemaVersion',1);
end $$;
revoke all on function platform_private.validate_conference_canonical_bundle(uuid,jsonb,text,uuid,bigint) from public,anon,authenticated;

create or replace function public.validate_conference_canonical_bundle(
 p_actor_device_id uuid,p_bundle jsonb,p_mode text,p_target_conference_id uuid,p_expected_revision bigint
) returns jsonb language sql security definer set search_path='' as $$
 select platform_private.validate_conference_canonical_bundle(p_actor_device_id,p_bundle,p_mode,p_target_conference_id,p_expected_revision)
$$;
revoke all on function public.validate_conference_canonical_bundle(uuid,jsonb,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.validate_conference_canonical_bundle(uuid,jsonb,text,uuid,bigint) to service_role;

create or replace function platform_private.restore_conference_bundle_table(
 p_table text,p_rows jsonb,p_source uuid,p_target uuid,p_operation_id uuid,p_actor uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare v_row jsonb;v_count integer=0;v_id uuid;
begin
 if not p_table=any(platform_private.conference_bundle_tables()) then raise exception 'CONFERENCE_BUNDLE_TABLE_NOT_ALLOWED' using errcode='22023'; end if;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_row:=v_row||jsonb_build_object('conference_id',p_target,'revision',1,'created_at',statement_timestamp(),'updated_at',statement_timestamp(),'created_by',p_actor,'updated_by',p_actor);
  if p_table=any(array['conference_participations','conference_house_assignments','conference_room_assignments','conference_accommodation_occupancies','conference_finance_items','conference_finance_adjustments','conference_restaurant_price_overrides','conference_restaurant_count_overrides','conference_restaurant_participation_overrides','conference_transport_vehicles','conference_transport_assignments']) then
   v_id:=(v_row->>'id')::uuid;v_row:=jsonb_set(v_row,'{id}',to_jsonb(platform_private.conference_bundle_uuid(p_operation_id,v_id)));
  end if;
  if v_row ? 'participation_id' then v_row:=jsonb_set(v_row,'{participation_id}',to_jsonb(platform_private.conference_bundle_uuid(p_operation_id,(v_row->>'participation_id')::uuid))); end if;
  if v_row ? 'guardian_participation_id' and v_row->>'guardian_participation_id' is not null then v_row:=jsonb_set(v_row,'{guardian_participation_id}',to_jsonb(platform_private.conference_bundle_uuid(p_operation_id,(v_row->>'guardian_participation_id')::uuid))); end if;
  if v_row ? 'house_assignment_id' then v_row:=jsonb_set(v_row,'{house_assignment_id}',to_jsonb(platform_private.conference_bundle_uuid(p_operation_id,(v_row->>'house_assignment_id')::uuid))); end if;
  if p_table='conference_transport_assignments' then v_row:=jsonb_set(v_row,'{vehicle_id}',to_jsonb(platform_private.conference_bundle_uuid(p_operation_id,(v_row->>'vehicle_id')::uuid))); end if;
  execute format('insert into public.%I select (pg_catalog.jsonb_populate_record(null::public.%I,$1)).*',p_table,p_table) using v_row;
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
revoke all on function platform_private.restore_conference_bundle_table(text,jsonb,uuid,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.restore_conference_canonical_bundle(
 p_actor_device_id uuid,p_operation_id uuid,p_bundle jsonb,p_mode text,
 p_target_conference_id uuid,p_expected_revision bigint,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_check jsonb;v_source uuid;v_target uuid;v_core jsonb;v_sections jsonb;v_hash text;v_existing platform_private.conference_bundle_operations%rowtype;v_table text;v_result jsonb;v_auth uuid;
declare v_delete_order text[]=array['conference_transport_assignments','conference_restaurant_participation_overrides','conference_accommodation_occupancies','conference_room_assignments','conference_transport_vehicles','conference_restaurant_count_overrides','conference_restaurant_price_overrides','conference_restaurant_settings','conference_finance_adjustments','conference_finance_items','conference_finance_settings','conference_air_conditioning_room_overrides','conference_air_conditioning_house_overrides','conference_air_conditioning_defaults','conference_accommodation_pricing_room_exclusions','conference_accommodation_pricing','conference_branding','conference_house_assignments','conference_participations'];
declare v_insert_order text[]=array['conference_participations','conference_house_assignments','conference_room_assignments','conference_transport_vehicles','conference_accommodation_pricing','conference_accommodation_pricing_room_exclusions','conference_air_conditioning_defaults','conference_air_conditioning_house_overrides','conference_air_conditioning_room_overrides','conference_branding','conference_finance_settings','conference_finance_items','conference_finance_adjustments','conference_restaurant_settings','conference_restaurant_price_overrides','conference_restaurant_count_overrides','conference_restaurant_participation_overrides','conference_accommodation_occupancies','conference_transport_assignments'];
begin
 v_actor:=public.require_current_approved_device(p_actor_device_id);
 if p_operation_id is null then raise exception 'CONFERENCE_BUNDLE_OPERATION_ID_REQUIRED' using errcode='22023'; end if;
 if p_mode='replace' and p_confirmed is distinct from true then raise exception 'CONFERENCE_BUNDLE_REPLACE_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
 v_check:=platform_private.validate_conference_canonical_bundle(p_actor_device_id,p_bundle,p_mode,p_target_conference_id,p_expected_revision);
 if not (v_check->>'valid')::boolean then raise exception 'CONFERENCE_BUNDLE_REFERENCE_VALIDATION_FAILED' using errcode='22023',detail=v_check->'errors'::text; end if;
 v_source:=(v_check->>'sourceConferenceId')::uuid;v_target:=coalesce(p_target_conference_id,platform_private.conference_bundle_uuid(p_operation_id,v_source));v_core:=p_bundle->'data'->'conference';v_sections:=p_bundle->'data'->'sections';
 v_hash:=encode(extensions.digest(jsonb_build_object('bundle',p_bundle,'mode',p_mode,'target',v_target,'expectedRevision',p_expected_revision)::text,'sha256'),'hex');
 select * into v_existing from platform_private.conference_bundle_operations where actor_user_id=v_actor and operation_id=p_operation_id for update;
 if found then
  if v_existing.request_hash<>v_hash then raise exception 'CONFERENCE_BUNDLE_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
  if v_existing.completed_at is not null then return v_existing.result; end if;
 end if;
 insert into platform_private.conference_bundle_operations(actor_user_id,operation_id,actor_device_id,mode,source_conference_id,target_conference_id,request_hash)
 values(v_actor,p_operation_id,p_actor_device_id,p_mode,v_source,v_target,v_hash)
 on conflict(actor_user_id,operation_id) do nothing;
 if p_mode='replace' then
  update public.conferences set name=v_core->>'name',place=coalesce(v_core->>'place',''),start_date=(v_core->>'start_date')::date,end_date=(v_core->>'end_date')::date,status=v_core->>'status',completed_at=nullif(v_core->>'completed_at','')::timestamptz,revision=revision+1,updated_at=statement_timestamp(),updated_by=v_actor where id=v_target;
 else
  insert into public.conferences(id,name,owner_id,start_date,end_date,status,completed_at,revision,updated_by,place)
  values(v_target,v_core->>'name',v_actor,(v_core->>'start_date')::date,(v_core->>'end_date')::date,v_core->>'status',nullif(v_core->>'completed_at','')::timestamptz,1,v_actor,coalesce(v_core->>'place',''));
 end if;
 foreach v_table in array v_delete_order loop execute format('delete from public.%I where conference_id=$1',v_table) using v_target; end loop;
 -- Guardians are linked after every participation exists.
 perform platform_private.restore_conference_bundle_table('conference_participations',(
  select coalesce(jsonb_agg(value-'guardian_participation_id'),'[]'::jsonb) from jsonb_array_elements(v_sections->'conference_participations')
 ),v_source,v_target,p_operation_id,v_actor);
 foreach v_table in array v_insert_order loop
  if v_table<>'conference_participations' then perform platform_private.restore_conference_bundle_table(v_table,v_sections->v_table,v_source,v_target,p_operation_id,v_actor); end if;
 end loop;
 update public.conference_participations p set guardian_participation_id=platform_private.conference_bundle_uuid(p_operation_id,(source.value->>'guardian_participation_id')::uuid)
 from jsonb_array_elements(v_sections->'conference_participations') source
 where source.value->>'guardian_participation_id' is not null and p.id=platform_private.conference_bundle_uuid(p_operation_id,(source.value->>'id')::uuid) and p.conference_id=v_target;
 v_result:=jsonb_build_object('ok',true,'mode',p_mode,'sourceConferenceId',v_source,'conferenceId',v_target,'revision',(select revision from public.conferences where id=v_target),'operationId',p_operation_id);
 update platform_private.conference_bundle_operations set result=v_result,completed_at=statement_timestamp() where actor_user_id=v_actor and operation_id=p_operation_id;
 select id into v_auth from platform.user_device_authorizations where user_id=v_actor and device_id=p_actor_device_id and status='approved' and revoked_at is null order by approved_at desc nulls last limit 1;
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,scope_id,new_values,metadata,operation_id,source)
 values(v_actor,v_auth,'platform','conference','conference_bundle_'||p_mode,'conference',v_target,'conference',v_target,v_result,jsonb_build_object('sourceConferenceId',v_source,'schemaVersion',1),p_operation_id,'rpc');
 return v_result;
end $$;
revoke all on function public.restore_conference_canonical_bundle(uuid,uuid,jsonb,text,uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.restore_conference_canonical_bundle(uuid,uuid,jsonb,text,uuid,bigint,boolean) to service_role;

-- Extend the single canonical Conference router in place; do not add a parallel API.
do $migration$
declare v_oid oid;v_definition text;v_needle text;v_replacement text;
begin
 select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='platform_private' and p.proname='route_canonical_conference_operation'
 and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_session_id uuid, p_token_hash bytea, p_actor_device_id uuid, p_operation text, p_args jsonb';
 if v_oid is null then raise exception 'CANONICAL_CONFERENCE_ROUTER_NOT_FOUND'; end if;
 v_definition:=pg_get_functiondef(v_oid);
 v_needle:=E'begin\n  if p_operation=\'create_canonical_conference\' then';
 v_replacement:=E'begin\n  if p_operation=\'export_conference_canonical_bundle\' then\n    perform platform_private.require_exact_jsonb_keys(p_args,array[\'p_conference_id\']);\n    return public.export_conference_canonical_bundle(p_actor_device_id,(p_args->>\'p_conference_id\')::uuid);\n  elsif p_operation=\'validate_conference_canonical_bundle\' then\n    perform platform_private.require_exact_jsonb_keys(p_args,array[\'p_bundle\',\'p_mode\',\'p_target_conference_id\',\'p_expected_revision\']);\n    return public.validate_conference_canonical_bundle(p_actor_device_id,p_args->\'p_bundle\',p_args->>\'p_mode\',nullif(p_args->>\'p_target_conference_id\',\'\')::uuid,nullif(p_args->>\'p_expected_revision\',\'\')::bigint);\n  elsif p_operation=\'restore_conference_canonical_bundle\' then\n    perform platform_private.require_exact_jsonb_keys(p_args,array[\'p_operation_id\',\'p_bundle\',\'p_mode\',\'p_target_conference_id\',\'p_expected_revision\',\'p_confirmed\']);\n    return public.restore_conference_canonical_bundle(p_actor_device_id,(p_args->>\'p_operation_id\')::uuid,p_args->\'p_bundle\',p_args->>\'p_mode\',nullif(p_args->>\'p_target_conference_id\',\'\')::uuid,nullif(p_args->>\'p_expected_revision\',\'\')::bigint,(p_args->>\'p_confirmed\')::boolean);\n  elsif p_operation=\'create_canonical_conference\' then';
 if position(v_needle in v_definition)=0 then raise exception 'CANONICAL_CONFERENCE_ROUTER_SHAPE_CHANGED'; end if;
 execute replace(v_definition,v_needle,v_replacement);
end $migration$;

-- Direct browser execution remains closed; only the verified device dispatcher can call.
revoke execute on function platform_private.route_canonical_conference_operation(uuid,uuid,bytea,uuid,text,jsonb) from public,anon,authenticated;
