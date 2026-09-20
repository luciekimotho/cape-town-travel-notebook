-- One-time confirmed travel update from the user's 20 September 2026
-- Ethiopian Airlines itinerary and Hyatt Regency reservation.
--
-- Privacy: passenger names, ticket numbers, seats, booking references, phone
-- numbers and email addresses are deliberately not stored.
--
-- This script fails without changing data unless exactly one grouped Cape Town
-- notebook with the expected itinerary IDs exists. Safe to run again.
begin;
do $$
declare
  v_trip_id uuid;
  v_owner_id uuid;
  v_count integer;
begin
  select count(*), min(t.id::text)::uuid
  into v_count, v_trip_id
  from public.trips t
  join public.notebook_metadata marker
    on marker.trip_id = t.id
   and marker.key = 'system.layout'
   and marker.value = 'capetown-2026-grouped-v2'
  where exists (
    select 1 from public.itinerary_items i
    where i.trip_id = t.id and i.id = 'item-day1-check-in-options'
  )
  and exists (
    select 1 from public.itinerary_items i
    where i.trip_id = t.id and i.id = 'item-day8-transfer-cpt'
  );

  if v_count <> 1 then
    raise exception 'Expected exactly one Cape Town 2026 notebook, found %; no reservation data changed', v_count;
  end if;

  if exists (
    select 1 from public.notebook_metadata
    where trip_id = v_trip_id
      and key = 'user.confirmed-reservations'
      and value = '2026-09-20-v7'
  ) then
    return;
  end if;

  select min(user_id::text)::uuid, count(*)
  into v_owner_id, v_count
  from public.trip_members
  where trip_id = v_trip_id and role = 'owner';
  if v_count <> 1 then
    raise exception 'Expected one trip owner, found %; no reservation data changed', v_count;
  end if;
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- The confirmed return arrives on 29 September.
  update public.trips set start_date = '2026-09-20', end_date = '2026-09-29' where id = v_trip_id;
  update public.itinerary_days set out_of_range = false
  where trip_id = v_trip_id and id between 'day-2026-09-20' and 'day-2026-09-29';
  insert into public.itinerary_days(id, trip_id, day_date, out_of_range, created_by, updated_by)
  values
    ('day-2026-09-20', v_trip_id, '2026-09-20', false, v_owner_id, v_owner_id),
    ('day-2026-09-29', v_trip_id, '2026-09-29', false, v_owner_id, v_owner_id)
  on conflict (trip_id, id) do update set day_date = excluded.day_date, out_of_range = false;

  insert into public.places(
    id, trip_id, name, notes, want_to_visit, seeded, created_by, updated_by
  ) values
    ('place-group-predeparture', v_trip_id, 'Final travel preparations',
      'Pre-departure plan in Nairobi local time.', false, false, v_owner_id, v_owner_id),
    ('place-family-dinner', v_trip_id, 'Dinner with family',
      'Dinner before final departure preparations.', false, false, v_owner_id, v_owner_id),
    ('place-kids-time-now', v_trip_id, 'Hanging out with the kids',
      'Family time before the evening departure preparations.', false, false, v_owner_id, v_owner_id),
    ('place-final-packing', v_trip_id, 'Final packing and documents',
      'Complete packing and check passports, tickets, chargers and essential documents.', false, false, v_owner_id, v_owner_id),
    ('place-goodbye-kids', v_trip_id, 'Say goodbye to the kids',
      'Protected family time before leaving for the airport.', false, false, v_owner_id, v_owner_id),
    ('place-final-home-check', v_trip_id, 'Final home check',
      'Check bags, documents, devices and home before departure.', false, false, v_owner_id, v_owner_id),
    ('place-leave-for-nbo', v_trip_id, 'Leave for Nairobi airport',
      'Allow about one hour for the late-night journey; adjust if actual travel time differs.', false, false, v_owner_id, v_owner_id),
    ('place-nbo-checkin', v_trip_id, 'NBO check-in and security',
      'Target Terminal 1C more than three hours before ET309 departs.', false, false, v_owner_id, v_owner_id),
    ('place-board-et309', v_trip_id, 'Board Ethiopian Airlines ET309',
      'Follow the boarding pass and airport displays for the final boarding time.', false, false, v_owner_id, v_owner_id)
  on conflict (trip_id, id) do update set
    name = excluded.name, notes = excluded.notes, want_to_visit = false;

  insert into public.itinerary_items(
    id, trip_id, day_id, place_id, is_activity_group, item_time, notes,
    visited, position, created_by, updated_by
  ) values (
    'item-group-day0', v_trip_id, 'day-2026-09-20', 'place-group-predeparture',
    true, '18:30', 'Pre-departure plan · Nairobi local time (EAT, UTC+3).',
    false, -10, v_owner_id, v_owner_id
  )
  on conflict (trip_id, id) do update set
    day_id = excluded.day_id, place_id = excluded.place_id,
    is_activity_group = true, item_time = excluded.item_time,
    notes = excluded.notes, position = excluded.position;

  insert into public.itinerary_items(
    id, trip_id, day_id, place_id, item_time, notes,
    visited, position, created_by, updated_by
  ) values (
    'item-day0-kids-now', v_trip_id, 'day-2026-09-20', 'place-kids-time-now',
    '13:30', 'Family time before dinner and final packing.',
    false, -20, v_owner_id, v_owner_id
  )
  on conflict (trip_id, id) do update set
    day_id = excluded.day_id, place_id = excluded.place_id,
    parent_id = null, item_time = excluded.item_time,
    notes = excluded.notes, position = excluded.position;

  insert into public.itinerary_items(
    id, trip_id, day_id, place_id, parent_id, item_time, notes,
    visited, position, created_by, updated_by
  ) values
    ('item-day0-dinner', v_trip_id, 'day-2026-09-20', 'place-family-dinner', 'item-group-day0',
      '18:30', 'Dinner with family.', false, 0, v_owner_id, v_owner_id),
    ('item-day0-packing', v_trip_id, 'day-2026-09-20', 'place-final-packing', 'item-group-day0',
      '19:30', 'Finish packing and check passports, tickets, chargers and essential documents.', false, 1, v_owner_id, v_owner_id),
    ('item-day0-goodbye', v_trip_id, 'day-2026-09-20', 'place-goodbye-kids', 'item-group-day0',
      '21:30', 'Protected family time before departure.', false, 2, v_owner_id, v_owner_id),
    ('item-day0-home-check', v_trip_id, 'day-2026-09-20', 'place-final-home-check', 'item-group-day0',
      '22:15', 'Final bag, document, device and home check.', false, 3, v_owner_id, v_owner_id),
    ('item-day0-leave', v_trip_id, 'day-2026-09-20', 'place-leave-for-nbo', 'item-group-day0',
      '22:45', 'Allows about one hour to NBO; adjust if the actual late-night journey differs.', false, 4, v_owner_id, v_owner_id),
    ('item-day0-airport', v_trip_id, 'day-2026-09-20', 'place-nbo-checkin', 'item-group-day0',
      '23:45', 'NBO Terminal 1C check-in and security · ET309 departs 03:00.', false, 5, v_owner_id, v_owner_id)
  on conflict (trip_id, id) do update set
    day_id = excluded.day_id, place_id = excluded.place_id, parent_id = excluded.parent_id,
    item_time = excluded.item_time, notes = excluded.notes, position = excluded.position;

  if not exists (
    select 1 from public.itinerary_items
    where trip_id = v_trip_id and id = 'item-day1-board-et309'
  ) then
    update public.itinerary_items set position = position + 1
    where trip_id = v_trip_id and parent_id = 'item-group-day1';
  end if;
  insert into public.itinerary_items(
    id, trip_id, day_id, place_id, parent_id, item_time, notes,
    visited, position, created_by, updated_by
  ) values (
    'item-day1-board-et309', v_trip_id, 'day-2026-09-21', 'place-board-et309',
    'item-group-day1', '02:00', 'Use the boarding pass and airport displays for the final boarding call.',
    false, 0, v_owner_id, v_owner_id
  )
  on conflict (trip_id, id) do update set
    day_id = excluded.day_id, place_id = excluded.place_id, parent_id = excluded.parent_id,
    item_time = excluded.item_time, notes = excluded.notes, position = excluded.position;

  insert into public.places(
    id, trip_id, name, notes, want_to_visit, seeded, created_by, updated_by
  ) values
    ('place-flight-et309', v_trip_id, 'Ethiopian Airlines ET309 to Addis Ababa',
      'Flight from Nairobi to Addis Ababa.', false, false, v_owner_id, v_owner_id),
    ('place-flight-et847', v_trip_id, 'Ethiopian Airlines ET847 to Cape Town',
      'Flight from Addis Ababa to Cape Town.', false, false, v_owner_id, v_owner_id),
    ('place-flight-et846', v_trip_id, 'Ethiopian Airlines ET846 to Addis Ababa',
      'Flight from Cape Town to Addis Ababa.', false, false, v_owner_id, v_owner_id),
    ('place-flight-et308', v_trip_id, 'Ethiopian Airlines ET308 to Nairobi',
      'Overnight flight from Addis Ababa to Nairobi.', false, false, v_owner_id, v_owner_id)
  on conflict (trip_id, id) do update set
    name = excluded.name, notes = excluded.notes, want_to_visit = false;

  update public.places set
    address = '126 Buitengracht Street, Cape Town CBD, 8000, Cape Town, South Africa',
    notes = '3 nights · King Room · 2 adults · check-in 21 September 2026 from 15:00 · check-out 24 September 2026 from 11:00 to 12:00.',
    want_to_visit = false
  where trip_id = v_trip_id and id = 'place-hyatt-regency';

  update public.places set
    address = 'Cape Town Aquarium 2, V&A Waterfront, Cape Town, 8001, South Africa',
    notes = 'Considering GetYourGuide product 126722: Table Mountain return cableway, one-day hop-on hop-off access on all three routes, multilingual commentary, and historical city and Bo-Kaap walking tours.'
  where trip_id = v_trip_id and id = 'place-red-bus';

  update public.itinerary_items set
    booking_status = 'Idea',
    notes = case id
      when 'item-day2-red-bus' then
        'Considering GetYourGuide product 126722 · one-day hop-on hop-off bus on all three routes · meeting point listed as Cape Town Aquarium 2 at the V&A Waterfront · free cancellation up to 24 hours before · https://www.getyourguide.com/cape-town-l103/table-mountain-cableway-hop-on-hop-off-combo-ticket-t126722/'
      when 'item-day2-table-mountain' then
        'Return Table Mountain cableway ticket included in the considered combo · cableway may move to another day if suspended by weather · combo flexibility lasts 14 days after first use.'
      else
        'Historical city and Bo-Kaap walking tours are included in the considered combo and depart from Stop 5 at 81 Long Street.'
    end
  where trip_id = v_trip_id
    and id in ('item-day2-red-bus','item-day2-table-mountain','item-day2-city-sights');

  update public.places set
    name = 'Historical City & Bo-Kaap Walking Tours',
    notes = 'Walking tours included in the considered Red Bus and Table Mountain combo; depart from Stop 5 at 81 Long Street.'
  where trip_id = v_trip_id and id = 'place-city-sights';

  update public.itinerary_items set
    parent_id = null,
    position = case id
      when 'item-day2-camps-bay-clifton' then 2
      else 3
    end,
    booking_status = 'Idea',
    notes = case id
      when 'item-day2-camps-bay-clifton' then 'Camps Bay and Clifton plan outside the considered combo.'
      else 'Sunset dinner plan outside the considered combo.'
    end
  where trip_id = v_trip_id
    and id in ('item-day2-camps-bay-clifton','item-day2-sunset-dinner');

  update public.itinerary_items set position = case id
    when 'item-day2-red-bus' then 0
    when 'item-day2-table-mountain' then 1
    else 2
  end
  where trip_id = v_trip_id
    and id in ('item-day2-red-bus','item-day2-table-mountain','item-day2-city-sights');

  update public.itinerary_items set item_time = case id
    when 'item-group-day1' then '03:00'::time
    when 'item-group-day2' then '09:00'::time
    when 'item-group-day3' then '09:30'::time
    when 'item-group-day4' then '11:00'::time
    when 'item-group-day6' then '08:00'::time
    when 'item-group-day7' then '10:00'::time
    when 'item-group-day8' then '08:00'::time
    else item_time
  end
  where trip_id = v_trip_id
    and id in ('item-group-day1','item-group-day2','item-group-day3','item-group-day4','item-group-day6','item-group-day7','item-group-day8');

  insert into public.places(
    id, trip_id, name, notes, want_to_visit, seeded, created_by, updated_by
  ) values
    ('place-bo-kaap-peninsula-tour', v_trip_id, 'Bo-Kaap',
      'Photo stop on the considered Cape Peninsula full-day tour.', false, false, v_owner_id, v_owner_id),
    ('place-new-cape-point-lighthouse', v_trip_id, 'New Cape Point Lighthouse',
      'Lighthouse stop on the considered Cape Peninsula full-day tour.', false, false, v_owner_id, v_owner_id),
    ('place-simons-town-tour', v_trip_id, 'Simon''s Town',
      'Lunch and walk stop on the considered Cape Peninsula full-day tour.', false, false, v_owner_id, v_owner_id)
  on conflict (trip_id, id) do update set
    name = excluded.name, notes = excluded.notes, want_to_visit = false;

  update public.places set
    name = case id
      when 'place-hout-bay' then 'Hout Bay Boatyard, Cape Town'
      when 'place-cape-point-good-hope' then 'Cape of Good Hope'
      when 'place-boulders-beach' then 'Boulders Penguin Colony'
      when 'place-muizenberg' then 'Muizenberg Beach'
      else name
    end,
    notes = case id
      when 'place-hout-bay' then 'Photo, shopping and sightseeing stop on the considered Cape Peninsula full-day tour.'
      when 'place-chapmans-peak' then 'Scenic drive and photo stop on the considered Cape Peninsula full-day tour.'
      when 'place-cape-point-good-hope' then 'Nature reserve sightseeing and walk on the considered Cape Peninsula full-day tour.'
      when 'place-boulders-beach' then 'African penguin colony stop on the considered Cape Peninsula full-day tour.'
      when 'place-muizenberg' then 'Coffee, walk and shark-spotter viewpoint stop on the considered Cape Peninsula full-day tour.'
      else notes
    end
  where trip_id = v_trip_id
    and id in ('place-hout-bay','place-chapmans-peak','place-cape-point-good-hope','place-boulders-beach','place-muizenberg');

  update public.itinerary_items set
    item_time = '08:00',
    booking_status = 'Idea',
    notes = '10-hour plan · considering GetYourGuide product 334741 for 25 September; the supplied link was queried for 24 September, so verify availability for the itinerary date · hotel pickup/drop-off, air-conditioned minivan, tolls and fuel included · reserve/penguin entrance fees, optional seal cruise, funicular, meals, drinks and gratuities are additional · free cancellation up to 24 hours before · route subject to change · https://www.getyourguide.com/en-gb/cape-town-l103/from-cape-town-cape-point-boulders-beach-full-day-tour-t334741/'
  where trip_id = v_trip_id and id = 'item-group-day5';

  insert into public.itinerary_items(
    id, trip_id, day_id, place_id, parent_id, item_time, notes,
    booking_status, visited, position, created_by, updated_by
  ) values
    ('item-day5-bo-kaap', v_trip_id, 'day-2026-09-25', 'place-bo-kaap-peninsula-tour',
      'item-group-day5', '08:30', 'Photo stop, guided visit and walk · product indicates about 10 minutes.', 'Idea', false, 0, v_owner_id, v_owner_id),
    ('item-day5-lighthouse', v_trip_id, 'day-2026-09-25', 'place-new-cape-point-lighthouse',
      'item-group-day5', '12:15', 'Lighthouse sightseeing and walk · product indicates about 45 minutes · funicular ticket is additional, or walk up in roughly 15 minutes.', 'Idea', false, 4, v_owner_id, v_owner_id),
    ('item-day5-simons-town', v_trip_id, 'day-2026-09-25', 'place-simons-town-tour',
      'item-group-day5', '13:30', 'Lunch and walk · product indicates about 75 minutes · meals and drinks are additional.', 'Idea', false, 6, v_owner_id, v_owner_id)
  on conflict (trip_id, id) do update set
    day_id = excluded.day_id, place_id = excluded.place_id, parent_id = excluded.parent_id,
    item_time = excluded.item_time, notes = excluded.notes,
    booking_status = excluded.booking_status, position = excluded.position;

  update public.itinerary_items set
    position = case id
      when 'item-day5-hout-bay' then 1
      when 'item-day5-chapmans-peak' then 2
      when 'item-day5-cape-point' then 3
      when 'item-day5-boulders' then 5
      when 'item-day5-muizenberg' then 7
      else position
    end,
    item_time = case id
      when 'item-day5-hout-bay' then '09:30'::time
      when 'item-day5-chapmans-peak' then '10:30'::time
      when 'item-day5-cape-point' then '11:30'::time
      when 'item-day5-boulders' then '15:00'::time
      when 'item-day5-muizenberg' then '16:30'::time
      else item_time
    end,
    booking_status = 'Idea',
    notes = case id
      when 'item-day5-hout-bay' then 'Photo, shopping and sightseeing stop · product indicates about 50 minutes · optional 45-minute seal cruise costs extra.'
      when 'item-day5-chapmans-peak' then 'Scenic drive and photo stops · product indicates about 20 minutes.'
      when 'item-day5-cape-point' then 'Cape of Good Hope sightseeing and walk · product indicates about 30 minutes · reserve entrance fee is additional.'
      when 'item-day5-boulders' then 'African penguin colony visit and walk · plan around 1 hour · Boulders entrance fee is additional.'
      else 'Coffee, walk and shark-spotter viewpoint · product indicates about 25 minutes.'
    end
  where trip_id = v_trip_id
    and id in ('item-day5-hout-bay','item-day5-chapmans-peak','item-day5-cape-point','item-day5-boulders','item-day5-muizenberg');

  -- Preserve the existing child order while inserting ET309 first.
  if not exists (
    select 1 from public.itinerary_items
    where trip_id = v_trip_id and id = 'item-flight-et309'
  ) then
    update public.itinerary_items set position = position + 1
    where trip_id = v_trip_id and parent_id = 'item-group-day1';
  end if;

  insert into public.itinerary_items(
    id, trip_id, day_id, place_id, parent_id, item_time, notes,
    booking_status, visited, position, created_by, updated_by
  ) values (
    'item-flight-et309', v_trip_id, 'day-2026-09-21', 'place-flight-et309',
    'item-group-day1', '03:00',
    'Ethiopian Airlines ET309 · Nairobi (NBO) Terminal 1C → Addis Ababa (ADD) Terminal 2 · departs 03:00 · arrives 05:15 · Economy · breakfast.',
    'Confirmed', false, 0, v_owner_id, v_owner_id
  )
  on conflict (trip_id, id) do update set
    day_id = excluded.day_id, place_id = excluded.place_id, parent_id = excluded.parent_id,
    item_time = excluded.item_time, notes = excluded.notes,
    booking_status = excluded.booking_status, position = excluded.position;

  update public.itinerary_items set
    place_id = 'place-flight-et847',
    item_time = '08:00',
    notes = 'Ethiopian Airlines ET847 · Addis Ababa (ADD) Terminal 2 → Cape Town (CPT) · departs 08:00 · arrives 13:30 · Economy · lunch.',
    booking_status = 'Confirmed'
  where trip_id = v_trip_id and id = 'item-day1-arrive-cpt';

  update public.itinerary_items set
    place_id = 'place-hyatt-regency',
    item_time = '15:00',
    notes = 'Hyatt Regency Cape Town · check-in from 15:00 · 3 nights · King Room · 2 adults.',
    booking_status = 'Confirmed'
  where trip_id = v_trip_id and id = 'item-day1-check-in-options';

  -- The former generic accommodation placeholder is no longer needed.
  delete from public.places p
  where p.trip_id = v_trip_id and p.id = 'place-accommodation-options'
    and not exists (
      select 1 from public.itinerary_items i
      where i.trip_id = p.trip_id and i.place_id = p.id
    );

  update public.itinerary_items set
    item_time = '11:00',
    notes = 'Confirmed Hyatt Regency Cape Town check-out window 11:00–12:00; then transfer to Sea Point. Sea Point accommodation details remain unset.'
  where trip_id = v_trip_id and id = 'item-day4-checkout-transfer';

  insert into public.itinerary_items(
    id, trip_id, day_id, place_id, parent_id, item_time, notes,
    booking_status, visited, position, created_by, updated_by
  ) values (
    'item-flight-et846', v_trip_id, 'day-2026-09-28', 'place-flight-et846',
    'item-group-day8', '15:10',
    'Ethiopian Airlines ET846 · Cape Town (CPT) → Addis Ababa (ADD) Terminal 2 · departs 15:10 · arrives 22:35 · Economy · meal service.',
    'Confirmed', false,
    coalesce((select max(position) + 1 from public.itinerary_items where trip_id = v_trip_id and parent_id = 'item-group-day8'), 0),
    v_owner_id, v_owner_id
  )
  on conflict (trip_id, id) do update set
    day_id = excluded.day_id, place_id = excluded.place_id, parent_id = excluded.parent_id,
    item_time = excluded.item_time, notes = excluded.notes,
    booking_status = excluded.booking_status, position = excluded.position;

  insert into public.itinerary_items(
    id, trip_id, day_id, place_id, parent_id, item_time, notes,
    booking_status, visited, position, created_by, updated_by
  ) values (
    'item-flight-et308', v_trip_id, 'day-2026-09-28', 'place-flight-et308',
    'item-group-day8', '23:35',
    'Ethiopian Airlines ET308 · Addis Ababa (ADD) Terminal 2 → Nairobi (NBO) Terminal 1A · departs 23:35 on 28 September · arrives 01:40 on 29 September · Economy · meal service.',
    'Confirmed', false,
    coalesce((select max(position) + 1 from public.itinerary_items where trip_id = v_trip_id and parent_id = 'item-group-day8'), 0),
    v_owner_id, v_owner_id
  )
  on conflict (trip_id, id) do update set
    day_id = excluded.day_id, place_id = excluded.place_id, parent_id = excluded.parent_id,
    item_time = excluded.item_time, notes = excluded.notes,
    booking_status = excluded.booking_status, position = excluded.position;

  -- Planning times do not change booking status.
  update public.itinerary_items set
    item_time = case id
      when 'item-day1-explore-waterfront' then '17:00'::time
      when 'item-day1-light-shopping' then '18:00'::time
      when 'item-day1-dinner-waterfront' then '19:30'::time
      when 'item-day2-red-bus' then '09:00'::time
      when 'item-day2-table-mountain' then '10:30'::time
      when 'item-day2-city-sights' then '13:30'::time
      when 'item-day2-camps-bay-clifton' then '16:30'::time
      when 'item-day2-sunset-dinner' then '18:30'::time
      when 'item-day3-option-kirstenbosch-wine' then '09:30'::time
      when 'item-day3-option-relaxed' then '09:30'::time
      when 'item-day4-settle-in' then '13:00'::time
      when 'item-day4-promenade' then '15:30'::time
      when 'item-day4-cafes-dining' then '18:30'::time
      when 'item-day5-hout-bay' then '09:30'::time
      when 'item-day5-chapmans-peak' then '10:30'::time
      when 'item-day5-cape-point' then '11:30'::time
      when 'item-day5-boulders' then '15:00'::time
      when 'item-day5-muizenberg' then '16:30'::time
      when 'item-day6-morning-golf' then '08:00'::time
      when 'item-day6-wine-tasting' then '13:00'::time
      when 'item-day6-long-lunch' then '14:30'::time
      when 'item-day6-return-cape-town' then '17:30'::time
      when 'item-day7-sea-point-shopping' then '10:00'::time
      when 'item-day7-va-final-shopping' then '13:00'::time
      when 'item-day7-sunset-cruise' then '17:00'::time
      when 'item-day7-farewell-dinner' then '19:30'::time
      when 'item-day8-breakfast' then '08:00'::time
      when 'item-day8-checkout' then '10:00'::time
      when 'item-day8-transfer-cpt' then '12:00'::time
      else item_time
    end,
    notes = regexp_replace(coalesce(notes, ''), '^Approximate time · ', '')
  where trip_id = v_trip_id
    and booking_status is distinct from 'Confirmed'::public.booking_status
    and not is_activity_group
    and id in (
      'item-day1-explore-waterfront','item-day1-light-shopping','item-day1-dinner-waterfront',
      'item-day2-red-bus','item-day2-table-mountain','item-day2-city-sights',
      'item-day2-camps-bay-clifton','item-day2-sunset-dinner',
      'item-day3-option-kirstenbosch-wine','item-day3-option-relaxed',
      'item-day4-settle-in','item-day4-promenade','item-day4-cafes-dining',
      'item-day5-hout-bay','item-day5-chapmans-peak','item-day5-cape-point',
      'item-day5-boulders','item-day5-muizenberg',
      'item-day6-morning-golf','item-day6-wine-tasting','item-day6-long-lunch',
      'item-day6-return-cape-town','item-day7-sea-point-shopping',
      'item-day7-va-final-shopping','item-day7-sunset-cruise',
      'item-day7-farewell-dinner','item-day8-breakfast','item-day8-checkout',
      'item-day8-transfer-cpt'
    );

  insert into public.notebook_metadata(
    trip_id, key, value, created_by, updated_by
  ) values (
    v_trip_id, 'day.timezone.2026-09-20', 'Africa/Nairobi', v_owner_id, v_owner_id
  )
  on conflict (trip_id, key) do update set value = excluded.value;

  insert into public.notebook_metadata(
    trip_id, key, value, created_by, updated_by
  ) values (
    v_trip_id, 'user.confirmed-reservations', '2026-09-20-v7', v_owner_id, v_owner_id
  )
  on conflict (trip_id, key) do update set value = excluded.value;
end $$;
commit;
