-- Apply after 0005_confirmed_reservations.sql and 0006_itinerary_links.sql.
-- Adds reviewed GetYourGuide product links to tour groups and Google Maps area
-- links to relevant stops. Safe to run again.
begin;
do $$
declare
  v_trip_id uuid;
  v_owner_id uuid;
  v_count integer;
begin
  select count(*), min(trip_id::text)::uuid into v_count, v_trip_id
  from public.notebook_metadata
  where key = 'user.confirmed-reservations' and value = '2026-09-20-v7';
  if v_count <> 1 then
    raise exception 'Expected exactly one confirmed Cape Town itinerary revision v7, found %', v_count;
  end if;
  if exists (
    select 1 from public.notebook_metadata
    where trip_id = v_trip_id and key = 'user.itinerary-links' and value = '2026-09-20-v1'
  ) then return; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='itinerary_items' and column_name='link_url'
  ) then raise exception 'Apply 0006_itinerary_links.sql before 0007_itinerary_link_data.sql'; end if;

  select min(user_id::text)::uuid, count(*) into v_owner_id, v_count
  from public.trip_members where trip_id = v_trip_id and role = 'owner';
  if v_count <> 1 then raise exception 'Expected exactly one trip owner, found %', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  update public.itinerary_items set link_url = case id
    when 'item-group-day2' then 'https://www.getyourguide.com/cape-town-l103/table-mountain-cableway-hop-on-hop-off-combo-ticket-t126722/'
    when 'item-day2-red-bus' then 'https://www.getyourguide.com/cape-town-l103/table-mountain-cableway-hop-on-hop-off-combo-ticket-t126722/'
    when 'item-day2-table-mountain' then 'https://www.getyourguide.com/cape-town-l103/table-mountain-cableway-hop-on-hop-off-combo-ticket-t126722/'
    when 'item-day2-city-sights' then 'https://www.getyourguide.com/cape-town-l103/table-mountain-cableway-hop-on-hop-off-combo-ticket-t126722/'
    when 'item-day2-camps-bay-clifton' then 'https://www.google.com/maps/search/?api=1&query=Camps+Bay+and+Clifton%2C+Cape+Town'
    when 'item-day2-sunset-dinner' then 'https://www.google.com/maps/search/?api=1&query=V%26A+Waterfront+restaurants%2C+Cape+Town'
    when 'item-group-day5' then 'https://www.getyourguide.com/en-gb/cape-town-l103/from-cape-town-cape-point-boulders-beach-full-day-tour-t334741/'
    when 'item-day5-bo-kaap' then 'https://www.google.com/maps/search/?api=1&query=Bo-Kaap%2C+Cape+Town'
    when 'item-day5-hout-bay' then 'https://www.google.com/maps/search/?api=1&query=Hout+Bay+Boatyard%2C+Cape+Town'
    when 'item-day5-chapmans-peak' then 'https://www.google.com/maps/search/?api=1&query=Chapman%27s+Peak+Drive%2C+Cape+Town'
    when 'item-day5-cape-point' then 'https://www.google.com/maps/search/?api=1&query=Cape+of+Good+Hope%2C+Cape+Town'
    when 'item-day5-lighthouse' then 'https://www.google.com/maps/search/?api=1&query=New+Cape+Point+Lighthouse%2C+Cape+Town'
    when 'item-day5-boulders' then 'https://www.google.com/maps/search/?api=1&query=Boulders+Penguin+Colony%2C+Cape+Town'
    when 'item-day5-simons-town' then 'https://www.google.com/maps/search/?api=1&query=Simon%27s+Town%2C+Cape+Town'
    when 'item-day5-muizenberg' then 'https://www.google.com/maps/search/?api=1&query=Muizenberg+Beach%2C+Cape+Town'
    when 'item-day1-check-in-options' then 'https://www.google.com/maps/search/?api=1&query=Hyatt+Regency+Cape+Town%2C+126+Buitengracht+Street'
    else link_url
  end
  where trip_id = v_trip_id and id in (
    'item-group-day2','item-day2-red-bus','item-day2-table-mountain','item-day2-city-sights',
    'item-day2-camps-bay-clifton','item-day2-sunset-dinner',
    'item-group-day5','item-day5-bo-kaap','item-day5-hout-bay','item-day5-chapmans-peak',
    'item-day5-cape-point','item-day5-lighthouse','item-day5-boulders',
    'item-day5-simons-town','item-day5-muizenberg','item-day1-check-in-options'
  );

  insert into public.notebook_metadata(trip_id,key,value,created_by,updated_by)
  values(v_trip_id,'user.itinerary-links','2026-09-20-v1',v_owner_id,v_owner_id);
end $$;
commit;