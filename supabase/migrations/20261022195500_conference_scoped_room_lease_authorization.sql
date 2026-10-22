begin;
create or replace function platform_private.require_resource_lease_writer(
 p_actor_device_id uuid,p_module_id text,p_resource_type text,p_resource_id text,p_scope text
) returns uuid language plpgsql security definer set search_path='' as $$
declare authority jsonb; actor_id uuid; conference_id uuid; room_id uuid;
begin
 if p_actor_device_id is null or p_resource_id is null or btrim(p_resource_id)='' then
   raise exception 'PLATFORM_RESOURCE_LEASE_ARGUMENT_INVALID' using errcode='22023';
 end if;
 perform platform_private.resource_lease_permission_key(p_module_id,p_resource_type,p_scope);
 if p_module_id<>'conference' or p_resource_type<>'accommodation_room'
    or p_resource_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'PLATFORM_RESOURCE_LEASE_RESOURCE_INVALID' using errcode='22023';
 end if;
 begin
   conference_id:=nullif(pg_catalog.current_setting('platform.room_lease_conference_id',true),'')::uuid;
 exception when others then
   raise exception 'PLATFORM_RESOURCE_LEASE_CONFERENCE_REQUIRED' using errcode='42501';
 end;
 if conference_id is null then raise exception 'PLATFORM_RESOURCE_LEASE_CONFERENCE_REQUIRED' using errcode='42501'; end if;
 room_id:=p_resource_id::uuid;
 if not exists (select 1 from public.conference_accommodation_rooms where id=room_id) then
   raise exception 'ACCOMMODATION_ROOM_NOT_FOUND' using errcode='P0002';
 end if;
 if not platform_private.conference_room_is_assigned(conference_id,room_id) then
   raise exception 'ACCOMMODATION_ROOM_CONFERENCE_MISMATCH' using errcode='42501';
 end if;
 authority:=platform_private.require_conference_accommodation_context(
   p_actor_device_id,conference_id,'conference.accommodation.manage',true
 );
 actor_id:=nullif(authority->>'actorUserId','')::uuid;
 if actor_id is null then raise exception 'PLATFORM_RESOURCE_LEASE_AUTHORITY_INVALID' using errcode='42501'; end if;
 return actor_id;
end $$;
revoke all on function platform_private.require_resource_lease_writer(uuid,text,text,text,text) from public,anon,authenticated;
do $migration$
declare d text; original text; operation text; marker text; replacement text; old_keys text; new_keys text;
begin
 select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='platform_private' and p.proname='route_canonical_conference_operation';
 if d is null then raise exception 'CANONICAL_DISPATCH_NOT_FOUND'; end if;
 original:=d;
 foreach operation in array array['acquire_resource_lease','renew_resource_lease','release_resource_lease','get_resource_lease'] loop
   if operation in ('acquire_resource_lease','renew_resource_lease') then
     old_keys:='array[''p_resource_type'',''p_resource_id'',''p_scope'',''p_lease_token'',''p_ttl_seconds'']';
   elsif operation='release_resource_lease' then
     old_keys:='array[''p_resource_type'',''p_resource_id'',''p_scope'',''p_lease_token'']';
   else
     old_keys:='array[''p_resource_type'',''p_resource_id'',''p_scope'']';
   end if;
   new_keys:=replace(old_keys,'array[','array[''p_conference_id'',');
   marker:='perform platform_private.require_exact_jsonb_keys(p_args,'||old_keys||');';
   replacement:='perform platform_private.require_exact_jsonb_keys(p_args,'||new_keys||');'||E'\n    perform pg_catalog.set_config(''platform.room_lease_conference_id'',(p_args->>''p_conference_id'')::uuid::text,true);';
   if position(marker in d)=0 then raise exception 'ROOM_LEASE_DISPATCH_KEYS_NOT_FOUND: %',operation; end if;
   -- Shared key sets occur in the acquire/renew branch; replace only once.
   d:=replace(d,marker,replacement);
 end loop;
 if d=original then raise exception 'ROOM_LEASE_DISPATCH_UNCHANGED'; end if;
 execute d;
end $migration$;
commit;
