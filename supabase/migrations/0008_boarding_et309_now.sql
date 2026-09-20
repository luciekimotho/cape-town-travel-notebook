-- Apply after 0005_confirmed_reservations.sql.
-- Records the user's confirmed 21 September ET309 boarding activity at 01:30
-- Nairobi time. Safe to run again.
begin;
do $$
declare
  v_trip_id uuid;
  v_owner_id uuid;
  v_count integer;
begin
  select count(*), min(trip_id::text)::uuid
  into v_count, v_trip_id
  from public.notebook_metadata
  where key = 'user.confirmed-reservations'
    and value = '2026-09-20-v7';

  if v_count <> 1 then
    raise exception 'Expected exactly one confirmed Cape Town itinerary revision v7, found %', v_count;
  end if;

  if exists (
    select 1 from public.notebook_metadata
    where trip_id = v_trip_id
      and key = 'user.boarding-et309'
      and value = '2026-09-21-v3'
  ) then
    return;
  end if;

  select count(*)
  into v_count
  from public.itinerary_items
  where trip_id = v_trip_id
    and id in ('item-group-day1', 'item-day1-board-et309');

  if v_count <> 2 then
    raise exception 'Expected the ET309 travel group and boarding item, found % matching items', v_count;
  end if;

  select min(user_id::text)::uuid, count(*)
  into v_owner_id, v_count
  from public.trip_members
  where trip_id = v_trip_id and role = 'owner';

  if v_count <> 1 then
    raise exception 'Expected exactly one trip owner, found %', v_count;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  update public.itinerary_items
  set item_time = '01:30',
      notes = 'Boarding Ethiopian Airlines ET309 at NBO Terminal 1C.'
  where trip_id = v_trip_id and id = 'item-day1-board-et309';

  update public.itinerary_items
  set item_time = '01:30'
  where trip_id = v_trip_id and id = 'item-group-day1';

  update public.itinerary_items
  set position = case id
    when 'item-day1-board-et309' then 0
    when 'item-flight-et309' then 1
  end
  where trip_id = v_trip_id
    and id in ('item-day1-board-et309', 'item-flight-et309');

  insert into public.notebook_metadata(
    trip_id, key, value, created_by, updated_by
  ) values
    (v_trip_id, 'item.timezone.item-group-day1', 'Africa/Nairobi', v_owner_id, v_owner_id),
    (v_trip_id, 'item.timezone.item-day1-board-et309', 'Africa/Nairobi', v_owner_id, v_owner_id),
    (v_trip_id, 'item.timezone.item-flight-et309', 'Africa/Nairobi', v_owner_id, v_owner_id),
    (v_trip_id, 'item.timezone.item-day1-arrive-cpt', 'Africa/Addis_Ababa', v_owner_id, v_owner_id)
  on conflict (trip_id, key) do update set
    value = excluded.value,
    updated_by = excluded.updated_by;

  insert into public.notebook_metadata(
    trip_id, key, value, created_by, updated_by
  ) values (
    v_trip_id, 'user.boarding-et309', '2026-09-21-v3', v_owner_id, v_owner_id
  )
  on conflict (trip_id, key) do update set
    value = excluded.value,
    updated_by = excluded.updated_by;
end $$;
commit;
