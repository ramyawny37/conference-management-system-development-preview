-- Applied to Development only: gppwltrifgfxrkzvvxoe
-- Reuse platform.people and the existing canonical conference device router.
begin;
create function public.search_conference_people(p_actor_device_id uuid,p_conference_id uuid,p_query text,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $body$
declare v_items jsonb;
begin
  perform platform_private.require_conference_participation_context(p_actor_device_id,p_conference_id,'conference.people.view',false);
  if length(coalesce(p_query,''))>240 then raise exception 'PERSON_SEARCH_QUERY_TOO_LONG' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('personId',p.id,'fullName',p.full_name,'phone',p.phone,'church',p.church,'gender',p.gender,'dateOfBirth',p.date_of_birth,'revision',p.revision) order by p.full_name,p.id),'[]'::jsonb)
  into v_items from platform_private.search_people(coalesce(p_query,''),null,least(greatest(coalesce(p_limit,20),1),20)) p;
  return jsonb_build_object('items',v_items);
end $body$;
revoke all on function public.search_conference_people(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.search_conference_people(uuid,uuid,text,integer) to service_role;
do $do$
declare v_original text; v_anchor text; v_added text; v_updated text;
begin
  v_original:=pg_get_functiondef('platform_private.route_canonical_conference_operation(uuid,uuid,bytea,uuid,text,jsonb)'::regprocedure);
  v_anchor:='  elsif p_operation=''list_conference_participations'' then';
  if length(v_original)-length(replace(v_original,v_anchor,''))<>length(v_anchor) then raise exception 'CONFERENCE_ROUTE_ANCHOR_NOT_UNIQUE'; end if;
  v_added:='  elsif p_operation=''search_conference_people'' then'||chr(10)||
    '    perform platform_private.require_exact_jsonb_keys(p_args,array[''p_conference_id'',''p_query'',''p_limit'']);'||chr(10)||
    '    return public.search_conference_people(p_actor_device_id,(p_args->>''p_conference_id'')::uuid,p_args->>''p_query'',(p_args->>''p_limit'')::integer);'||chr(10);
  v_updated:=replace(v_original,v_anchor,v_added||v_anchor);
  execute v_updated;
end $do$;
commit;
