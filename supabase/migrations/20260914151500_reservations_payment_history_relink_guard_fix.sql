begin;

-- Payments remain immutable. The only extra UPDATE allowed is the partition-key
-- rewrite performed by the guarded standalone-event -> Conference relink.
create or replace function reservations_private.protect_payment_history()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_guard text;
  v_booking_event_id uuid;
  v_booking_partition uuid;
begin
  if tg_op='DELETE' then
    raise exception 'RESERVATIONS_PAYMENT_DELETE_DENIED' using errcode='55000';
  end if;

  if old.scope_partition_id is distinct from new.scope_partition_id
     and old.booking_id=new.booking_id
     and old.organization_id is not distinct from new.organization_id
     and old.amount=new.amount
     and old.payment_date=new.payment_date
     and old.payment_method=new.payment_method
     and old.payment_method_other is not distinct from new.payment_method_other
     and old.reference is not distinct from new.reference
     and old.notes is not distinct from new.notes
     and old.created_at=new.created_at
     and old.created_by=new.created_by
     and old.created_by_device_id=new.created_by_device_id
     and old.status=new.status then
    v_guard:=current_setting('reservations.scope_relink_guard',true);
    select b.event_id,b.scope_partition_id
      into v_booking_event_id,v_booking_partition
    from reservations.bookings b
    where b.id=new.booking_id;

    if v_booking_event_id is not null
       and v_booking_partition=new.scope_partition_id
       and v_guard=(v_booking_event_id::text||':'||old.scope_partition_id::text||':'||new.scope_partition_id::text) then
      return new;
    end if;
  end if;

  if old.organization_id<>new.organization_id
     or old.booking_id<>new.booking_id
     or old.amount<>new.amount
     or old.payment_date<>new.payment_date
     or old.payment_method<>new.payment_method
     or old.payment_method_other is distinct from new.payment_method_other
     or old.reference is distinct from new.reference
     or old.notes is distinct from new.notes
     or old.created_at<>new.created_at
     or old.created_by<>new.created_by
     or old.created_by_device_id<>new.created_by_device_id
     or old.status<>'active'
     or new.status<>'voided' then
    raise exception 'RESERVATIONS_PAYMENT_IMMUTABLE' using errcode='55000';
  end if;

  return new;
end $$;

commit;
