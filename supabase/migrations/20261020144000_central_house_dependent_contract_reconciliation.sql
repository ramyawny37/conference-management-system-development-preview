begin;

do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.mutate_conference_accommodation_pricing(uuid,uuid,uuid,bigint,jsonb)'::regprocedure);
 d:=replace(d,'where id=v_room_id and conference_id=p_conference_id for update','where id=v_room_id and platform_private.conference_room_is_assigned(p_conference_id,id) for update');
 if position('where id=v_room_id and conference_id=p_conference_id' in d)>0 then raise exception 'PRICING_CENTRAL_ROOM_PATCH_FAILED';end if;
 execute d;

 d:=pg_get_functiondef('public.mutate_conference_air_conditioning(uuid,uuid,uuid,text,uuid,text,bigint,jsonb)'::regprocedure);
 d:=replace(d,'perform 1 from public.conference_accommodation_houses where id=p_scope_id and conference_id=p_conference','perform 1 from public.conference_house_assignments where conference_id=p_conference and house_id=p_scope_id');
 d:=replace(d,'join public.conference_accommodation_houses h on h.id=f.house_id where rr.id=p_scope_id and h.conference_id=p_conference','join public.conference_house_assignments a on a.house_id=f.house_id and a.conference_id=p_conference where rr.id=p_scope_id');
 if position('h.conference_id=p_conference' in d)>0 then raise exception 'AIR_CONDITIONING_CENTRAL_HOUSE_PATCH_FAILED';end if;
 execute d;
end $patch$;

create or replace function public.mutate_conference_accommodation_structure(p_device uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise exception 'PLATFORM_OPERATION_NOT_ALLOWED' using errcode='42501';
end $$;
revoke all on function public.mutate_conference_accommodation_structure(uuid,text,jsonb) from public,anon,authenticated,service_role;

commit;
