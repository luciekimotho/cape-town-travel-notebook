-- Run after migrations 0001, 0002 and 0003 in a disposable PostgreSQL database.
begin;
do $$
declare
  owner_id uuid := '50000000-0000-4000-8000-000000000001';
  trip uuid;
  acknowledgement jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values(owner_id,'save-test@example.com',now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  trip := public.create_capetown_2026_trip_v2();
  acknowledgement := public.mutate_notebook_v1(trip,'itinerary.update',
    '{"id":"item-day1-arrive-cpt","patch":{"notes":"Edited note","name":"Arrival test","time":"10:30"}}');
  if acknowledgement->>'ok' <> 'true' or not exists (
    select 1 from public.itinerary_items i join public.places p
      on p.trip_id=i.trip_id and p.id=i.place_id
    where i.trip_id=trip and i.id='item-day1-arrive-cpt'
      and i.notes='Edited note' and i.item_time='10:30'::time and p.name='Arrival test'
  ) then raise exception 'Itinerary edit was not saved'; end if;
  set constraints public.itinerary_parent_guard immediate;
  perform public.mutate_notebook_v1(trip,'itinerary.update',
    '{"id":"item-group-day1","patch":{"dayId":"day-2026-09-22"}}');
  set constraints public.itinerary_parent_guard immediate;
  if exists (select 1 from public.itinerary_items
    where trip_id=trip and (id='item-group-day1' or parent_id='item-group-day1')
      and day_id <> 'day-2026-09-22'
  ) then raise exception 'Group move did not preserve parent/child day alignment'; end if;
  begin
    perform public.mutate_notebook_v1(trip,'itinerary.update',
      '{"id":"item-day1-arrive-cpt","patch":{"dayId":"day-2026-09-23"}}');
    set constraints public.itinerary_parent_guard immediate;
    raise exception 'Invalid child day was accepted';
  exception when others then
    if sqlerrm <> 'A child must be on the same day as its parent' then raise; end if;
  end;
  if (select day_id from public.itinerary_items where trip_id=trip and id='item-day1-arrive-cpt') <> 'day-2026-09-22'
  then raise exception 'Failed edit changed the saved record'; end if;
end $$;
rollback;
