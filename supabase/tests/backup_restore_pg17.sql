-- PostgreSQL 17 integration assertions. Run after 0001 -> 0002 -> 0003 in a
-- Supabase-compatible test database; the transaction leaves no application data.
begin;
do $$
declare
  owner_id constant uuid := '10000000-0000-4000-8000-000000000001';
  outsider_id constant uuid := '10000000-0000-4000-8000-000000000002';
  v_trip_id constant uuid := '20000000-0000-4000-8000-000000000001';
  payload jsonb;
  result jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at)
  values(owner_id,'owner@example.com',now()),(outsider_id,'outsider@example.com',now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.trips(
    id,destination,travellers,start_date,end_date,timezone,notes,created_by,updated_by
  ) values(v_trip_id,'Before restore',2,'2026-09-21','2026-09-21','UTC','',owner_id,owner_id);
  insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('trip-photos',v_trip_id||'/photo-1-30000000-0000-4000-8000-000000000001.jpg',
    owner_id::text,'{"mimetype":"image/jpeg","size":3}'::jsonb);

  payload := $json$
  {
    "schemaVersion":4,
    "trip":{"id":"current","destination":"Restored Cape Town","travellers":2,
      "startDate":"2026-09-21","endDate":"2026-09-21","timezone":"Africa/Johannesburg","notes":"restored"},
    "checklist":[{"id":"check-1","title":"Passport","category":"Documents","completed":false}],
    "days":[{"id":"day-1","date":"2026-09-21","outOfRange":false}],
    "places":[{"id":"place-1","name":"Waterfront","wantToVisit":false,"seeded":false}],
    "activityTemplates":[{"id":"template-1","name":"Walk","description":"A walk","seeded":false,
      "stops":[{"id":"stop-1","placeId":"place-1","placeName":"Waterfront","notes":[]}]}],
    "items":[{"id":"item-1","dayId":"day-1","placeId":"place-1","templateId":"template-1",
      "visited":true,"position":0}],
    "rateSets":[{"id":"rate-1","label":"Recorded","effectiveDate":"2026-09-16",
      "kesPerKes":1,"kesPerUsd":129.5,"kesPerZar":8.1,"active":true,"example":false}],
    "expenses":[{"id":"expense-1","amount":10,"currency":"USD","date":"2026-09-21",
      "category":"Activity","rateSetId":"rate-1","itineraryItemId":"item-1"}],
    "stamps":[{"id":"stamp-1","itineraryItemId":"item-1","placeName":"Waterfront",
      "visitDate":"2026-09-21","detached":false}],
    "photos":[{"id":"photo-1","stampId":"stamp-1","caption":"Ocean","mimeType":"image/jpeg",
      "width":10,"height":10,"size":3,
      "storagePath":"20000000-0000-4000-8000-000000000001/photo-1-30000000-0000-4000-8000-000000000001.jpg"}],
    "metadata":[{"key":"schemaVersion","value":"4"},{"key":"displayCurrency","value":"KES"}]
  }
  $json$::jsonb;

  result := public.restore_notebook_v1(v_trip_id,payload);
  if result#>>'{counts,checklist}' <> '1' or result#>>'{counts,days}' <> '1'
     or result#>>'{counts,items}' <> '1' or result#>>'{counts,places}' <> '1'
     or result#>>'{counts,activityTemplates}' <> '1' or result#>>'{counts,activityTemplateStops}' <> '1'
     or result#>>'{counts,expenses}' <> '1'
     or result#>>'{counts,stamps}' <> '1' or result#>>'{counts,photos}' <> '1'
     or result#>>'{counts,rateSets}' <> '1' or result#>>'{counts,metadata}' <> '2' then
    raise exception 'Restore acknowledgement counts are incorrect: %',result;
  end if;
  if (select count(*) from public.checklist_items where trip_id=v_trip_id) <> 1
     or (select count(*) from public.itinerary_items where trip_id=v_trip_id) <> 1
     or (select count(*) from public.activity_template_stops where trip_id=v_trip_id) <> 1
     or (select count(*) from public.expenses where trip_id=v_trip_id) <> 1
     or (select count(*) from public.photos where trip_id=v_trip_id) <> 1 then
    raise exception 'Restored table counts are incorrect';
  end if;
  if (select count(*) from public.trip_members where trip_id=v_trip_id) <> 1 then
    raise exception 'Restore changed trip membership';
  end if;

  begin
    perform public.restore_notebook_v1(
      v_trip_id,
      jsonb_set(payload,'{items,0,dayId}','"other-trip-day"'::jsonb)
    );
    raise exception 'Invalid references were accepted';
  exception when others then
    if sqlerrm = 'Invalid references were accepted' then raise; end if;
  end;
  if (select destination from public.trips where id=v_trip_id) <> 'Restored Cape Town'
     or (select count(*) from public.checklist_items where trip_id=v_trip_id) <> 1 then
    raise exception 'Rejected restore changed existing content';
  end if;

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  begin
    perform public.restore_notebook_v1(v_trip_id,payload);
    raise exception 'Non-owner restore was accepted';
  exception when others then
    if sqlerrm = 'Non-owner restore was accepted' then raise; end if;
  end;
end $$;
rollback;
