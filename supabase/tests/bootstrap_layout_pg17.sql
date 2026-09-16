-- PostgreSQL 17 integration assertions for the additive grouped bootstrap.
begin;
do $$
declare
  owner_id constant uuid := '40000000-0000-4000-8000-000000000001';
  edited_owner_id constant uuid := '40000000-0000-4000-8000-000000000002';
  v_trip_id uuid;
  edited_trip_id uuid;
begin
  insert into auth.users(id,email,email_confirmed_at)
  values(owner_id,'layout-owner@example.com',now()),
        (edited_owner_id,'edited-owner@example.com',now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  v_trip_id := public.create_capetown_2026_trip_v2();
  if (select count(*) from public.itinerary_items where trip_id=v_trip_id) <> 40
     or (select count(*) from public.itinerary_items where trip_id=v_trip_id and parent_id is null) <> 8
     or (select count(*) from public.itinerary_items where trip_id=v_trip_id and parent_id is not null) <> 32
  then raise exception 'Grouped bootstrap item counts are incorrect'; end if;
  if exists (
    select 1 from public.itinerary_items parent
    where parent.trip_id=v_trip_id and parent.parent_id is null
      and (not parent.is_activity_group or
        (select count(*) from public.itinerary_items child
          where child.trip_id=v_trip_id and child.parent_id=parent.id)
        <> (select count(distinct child.position) from public.itinerary_items child
          where child.trip_id=v_trip_id and child.parent_id=parent.id)
        or (select min(child.position) from public.itinerary_items child
          where child.trip_id=v_trip_id and child.parent_id=parent.id) <> 0
        or (select max(child.position)+1 from public.itinerary_items child
          where child.trip_id=v_trip_id and child.parent_id=parent.id)
        <> (select count(*) from public.itinerary_items child
          where child.trip_id=v_trip_id and child.parent_id=parent.id))
  ) then raise exception 'Grouped bootstrap child positions are not compact'; end if;
  if not exists (
    select 1 from public.notebook_metadata where trip_id=v_trip_id
      and key='system.layout' and value='capetown-2026-grouped-v2'
  ) or exists(select 1 from public.expenses where trip_id=v_trip_id)
     or exists(select 1 from public.travel_stamps where trip_id=v_trip_id)
     or exists(select 1 from public.photos where trip_id=v_trip_id)
  then raise exception 'Grouped bootstrap marker or empty-memory invariant is incorrect'; end if;
  if public.create_capetown_2026_trip_v2() <> v_trip_id
     or (select count(*) from public.itinerary_items where trip_id=v_trip_id) <> 40
  then raise exception 'Grouped bootstrap is not idempotent'; end if;

  -- Parent and child are ordinary independent items and can each receive a stamp.
  perform public.mutate_notebook_v1(v_trip_id,'stamp.create','{"itemId":"item-group-day1"}');
  perform public.mutate_notebook_v1(v_trip_id,'stamp.create','{"itemId":"item-day1-arrive-cpt"}');
  if (select count(*) from public.travel_stamps where trip_id=v_trip_id) <> 2 then
    raise exception 'Parent and child were not independently stampable';
  end if;

  perform set_config('request.jwt.claim.sub',edited_owner_id::text,true);
  edited_trip_id := public.create_capetown_2026_trip();
  update public.itinerary_items set notes='User edited this item'
    where trip_id=edited_trip_id and id='item-day1-arrive-cpt';
  begin
    perform public.create_capetown_2026_trip_v2();
    raise exception 'Partially edited bootstrap was regrouped';
  exception when others then
    if sqlerrm='Partially edited bootstrap was regrouped' then raise; end if;
  end;
  if (select count(*) from public.itinerary_items where trip_id=edited_trip_id) <> 32
     or exists(select 1 from public.notebook_metadata
       where trip_id=edited_trip_id and key='system.layout')
  then raise exception 'Refused regroup changed edited bootstrap data'; end if;
end $$;
rollback;
