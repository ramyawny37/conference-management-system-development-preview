begin;
create or replace function public.search_reservations_people(p_actor_device_id uuid,p_query text default '',p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_context jsonb;v_items jsonb;
begin
 v_context:=public.require_effective_module_permission(p_actor_device_id,'reservations','reservations.booking.create',null,null);
 if length(coalesce(p_query,''))>240 then raise exception 'PERSON_SEARCH_QUERY_TOO_LONG' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('personId',p.id,'fullName',p.full_name,'phone',p.phone,'church',p.church,'revision',p.revision) order by p.full_name,p.id),'[]'::jsonb)
 into v_items from platform_private.search_people(coalesce(p_query,''),null,least(greatest(coalesce(p_limit,20),1),20)) p;
 return jsonb_build_object('items',v_items);
end $fn$;
revoke all on function public.search_reservations_people(uuid,text,integer) from public,anon;
grant execute on function public.search_reservations_people(uuid,text,integer) to authenticated;
commit;