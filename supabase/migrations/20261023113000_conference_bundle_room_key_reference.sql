begin;
do $migration$
declare signature regprocedure:='platform_private.restore_conference_bundle_table(text,jsonb,uuid,uuid,uuid,uuid)'::regprocedure;
 d text;marker text;replacement text;
begin
 d:=pg_get_functiondef(signature);
 if position('key_holder_occupancy_id' in d)>0 then return;end if;
 marker:='if v_row ? ''house_assignment_id'' then v_row:=jsonb_set(v_row,''{house_assignment_id}'',to_jsonb(platform_private.conference_bundle_uuid(p_operation_id,(v_row->>''house_assignment_id'')::uuid))); end if;';
 replacement:=marker||E'\n  if v_row ? ''key_holder_occupancy_id'' and v_row->>''key_holder_occupancy_id'' is not null then v_row:=jsonb_set(v_row,''{key_holder_occupancy_id}'',to_jsonb(platform_private.conference_bundle_uuid(p_operation_id,(v_row->>''key_holder_occupancy_id'')::uuid))); end if;';
 if position(marker in d)=0 then raise exception 'CONFERENCE_BUNDLE_ROOM_KEY_REFERENCE_MARKER_MISSING' using errcode='55000';end if;
 execute replace(d,marker,replacement);
end $migration$;
commit;
