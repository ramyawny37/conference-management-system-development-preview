begin;

create function warehouse.list_balances(p_device_id uuid,p_store_id uuid,p_before_item_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,warehouse,warehouse_private as $$
declare bounded_limit integer;
begin
  perform warehouse_private.require_read_session(p_device_id);
  perform warehouse_private.require_permission(p_device_id,'warehouse.store.view',p_store_id);
  perform warehouse_private.require_permission(p_device_id,'warehouse.item.view');
  bounded_limit:=least(greatest(coalesce(p_limit,50),1),100);
  return (select coalesce(jsonb_agg(to_jsonb(b) order by b.item_id),'[]') from (
    select b.store_id,b.item_id,b.quantity_on_hand,b.inventory_value,b.weighted_average_unit_cost,b.last_movement_sequence,b.revision,b.calculated_at
    from warehouse.stock_balances b
    where b.store_id=p_store_id and (p_before_item_id is null or b.item_id>p_before_item_id)
    order by b.item_id
    limit bounded_limit
  ) b);
end; $$;

revoke all on function warehouse.list_balances(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function warehouse.list_balances(uuid,uuid,uuid,integer) to authenticated;

commit;
