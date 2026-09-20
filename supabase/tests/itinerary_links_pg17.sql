-- Run after migrations 0001 through 0006 in a disposable PostgreSQL database.
begin;
do $$
declare
  owner_id uuid := '70000000-0000-4000-8000-000000000001';
  trip uuid;
  loaded jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at)
  values(owner_id,'link-owner@example.com',now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  trip := public.create_capetown_2026_trip_v2();

  perform public.mutate_notebook_v3(trip,'itinerary.update',
    '{"id":"item-day1-arrive-cpt","patch":{"linkUrl":"https://www.getyourguide.com/example-t123/"}}');
  loaded := public.load_notebook_v6(trip);
  if not exists (
    select 1 from jsonb_array_elements(loaded->'items') item
    where item->>'id'='item-day1-arrive-cpt'
      and item->>'linkUrl'='https://www.getyourguide.com/example-t123/'
  ) then raise exception 'Itinerary link did not round-trip'; end if;

  perform public.mutate_notebook_v3(trip,'itinerary.update',
    '{"id":"item-day1-arrive-cpt","patch":{"linkUrl":null}}');
  if (select link_url from public.itinerary_items where trip_id=trip and id='item-day1-arrive-cpt') is not null
  then raise exception 'Itinerary link was not cleared'; end if;

  begin
    perform public.mutate_notebook_v3(trip,'itinerary.update',
      '{"id":"item-day1-arrive-cpt","patch":{"linkUrl":"https://example.com/not-allowed"}}');
    raise exception 'Unsupported itinerary link was accepted';
  exception when others then
    if sqlerrm='Unsupported itinerary link was accepted' then raise; end if;
  end;

  -- Cached clients keep their previous RPC names.
  perform public.mutate_notebook_v2(trip,'itinerary.update',
    '{"id":"item-day1-arrive-cpt","patch":{"notes":"Cached client edit"}}');
  if (select notes from public.itinerary_items where trip_id=trip and id='item-day1-arrive-cpt') <> 'Cached client edit'
  then raise exception 'Legacy mutation wrapper failed'; end if;
  if public.load_notebook_v5(trip) is null then raise exception 'Legacy load wrapper failed'; end if;
end $$;
rollback;
