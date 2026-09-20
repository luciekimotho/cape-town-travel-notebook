-- Run after migrations 0001 -> 0002 -> 0003 -> 0004 in a disposable database.
-- All application records are rolled back.
begin;
do $$
#variable_conflict use_variable
declare
  owner_id uuid := '60000000-0000-4000-8000-000000000001';
  outsider_id uuid := '60000000-0000-4000-8000-000000000002';
  trip uuid;
  result jsonb;
  notebook jsonb;
  original jsonb;
  snapshot jsonb;
  stamp_id text;
  scheduled_id text;
  parent_id text;
  child_id text;
  template_id text;
  source_place_id text;
  single_template_id text;
  single_item_id text;
  invalid jsonb;
  collection text;
  design text;
begin
  insert into auth.users(id,email,email_confirmed_at)
    values(owner_id,'design-owner@example.com',now()),(outsider_id,'design-outsider@example.com',now());
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  trip := public.create_capetown_2026_trip_v2();
  set local role authenticated;
  notebook := public.load_notebook_v5(trip);
  if notebook is null or notebook->>'schemaVersion' <> '4' then
    raise exception 'Read wrapper did not preserve schema 4';
  end if;
  if public.load_notebook_v4(trip) <> notebook then
    raise exception 'Legacy and new read RPCs differ';
  end if;
  if has_function_privilege('authenticated','public.mutate_notebook_without_stamp_designs(uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.restore_notebook_without_stamp_designs(uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.load_notebook_without_stamp_designs(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.load_notebook_v4_without_storage_path(uuid)','EXECUTE')
    or has_function_privilege('anon','public.mutate_notebook_v1(uuid,text,jsonb)','EXECUTE') then
    raise exception 'Internal helper or anonymous execution grants are exposed';
  end if;
  if exists(select 1 from jsonb_array_elements(notebook->'places') r where r ? 'stampKind') then
    raise exception 'Legacy designs must remain omitted';
  end if;
  result := public.mutate_notebook_v2(trip,'itinerary.create',
    '{"place":{"id":"design-place","name":"Table Mountain","stampKind":"boat"},
      "item":{"id":"design-item","dayId":"day-2026-09-21","stampKind":"pin"}}');
  if (select stamp_kind from public.places where trip_id=trip and id='design-place') <> 'boat'
    or (select stamp_kind from public.itinerary_items where trip_id=trip and id='design-item') <> 'pin' then
    raise exception 'Creation lost item/place choices';
  end if;
  result := public.mutate_notebook_v1(trip,'stamp.create','{"itemId":"design-item","stampKind":"wine"}');
  stamp_id := result->>'id';
  select to_jsonb(s) - 'updated_at' - 'updated_by' - 'stamp_kind' into snapshot
    from public.travel_stamps s where trip_id=trip and id=stamp_id;
  if (select stamp_kind from public.travel_stamps where trip_id=trip and id=stamp_id) <> 'pin' then
    raise exception 'New stamp trusted stale client choice';
  end if;
  -- An already deployed browser edits notes/name without knowing about designs.
  result := public.mutate_notebook_v1(trip,'itinerary.update',
    '{"id":"design-item","patch":{"notes":"Saved by cached frontend","name":"Cached client name","time":"10:30"}}');
  if result->>'ok' <> 'true' or not exists(
    select 1 from public.itinerary_items where trip_id=trip and id='design-item'
      and notes='Saved by cached frontend' and item_time='10:30'::time and stamp_kind='pin'
  ) or (select stamp_kind from public.travel_stamps where trip_id=trip and id=stamp_id) <> 'pin' then
    raise exception 'Legacy ordinary activity edit failed or erased its selected design';
  end if;
  perform public.mutate_notebook_v1(trip,'place.update',
    '{"id":"design-place","patch":{"notes":"Legacy place edit"}}');
  if (select stamp_kind from public.places where trip_id=trip and id='design-place') <> 'boat' then
    raise exception 'Legacy place edit erased its selected design';
  end if;
  perform public.mutate_notebook_v2(trip,'place.update','{"id":"design-place","patch":{"stampKind":"house"}}');
  if (select stamp_kind from public.travel_stamps where trip_id=trip and id=stamp_id) <> 'pin' then
    raise exception 'Place choice defeated item override';
  end if;
  perform public.mutate_notebook_v1(trip,'itinerary.update',
    '{"id":"design-item","patch":{"stampKind":"auto","name":"Renamed mountain","dayId":"day-2026-09-22"}}');
  if (select stamp_kind from public.travel_stamps where trip_id=trip and id=stamp_id) <> 'auto'
    or (select to_jsonb(s) - 'updated_at' - 'updated_by' - 'stamp_kind' from public.travel_stamps s
      where trip_id=trip and id=stamp_id) <> snapshot then
    raise exception 'Live design edit lost auto or rewrote historical metadata';
  end if;
  perform public.mutate_notebook_v2(trip,'itinerary.delete','{"id":"design-item"}');
  perform public.mutate_notebook_v2(trip,'place.update','{"id":"design-place","patch":{"stampKind":"wine"}}');
  if not exists(select 1 from public.travel_stamps where trip_id=trip and id=stamp_id
    and detached and itinerary_item_id is null and stamp_kind='auto') then
    raise exception 'Detached stamp did not retain its last selection';
  end if;

  result := public.mutate_notebook_v2(trip,'place.schedule',
    '{"placeId":"design-place","dayId":"day-2026-09-21","placePatch":{"stampKind":"cliff"}}');
  scheduled_id := result->>'id';
  result := public.mutate_notebook_v2(trip,'stamp.create',jsonb_build_object('itemId',scheduled_id));
  stamp_id := result->>'id';
  if (select stamp_kind from public.travel_stamps where trip_id=trip and id=stamp_id) <> 'cliff' then
    raise exception 'Scheduled item did not inherit place choice';
  end if;
  result := public.mutate_notebook_v2(trip,'place.schedule',
    '{"placeId":"design-place","dayId":"day-2026-09-22","placePatch":{"stampKind":"boat"},"itemPatch":{"stampKind":"pin"}}');
  if (select stamp_kind from public.itinerary_items where trip_id=trip and id=result->>'id') <> 'pin'
    or (select stamp_kind from public.travel_stamps where trip_id=trip and id=stamp_id) <> 'boat' then
    raise exception 'Scheduling choices did not propagate correctly';
  end if;
  -- A legacy live snapshot with no choice must capture its place fallback on deletion.
  reset role;
  update public.travel_stamps set stamp_kind=null where trip_id=trip and id=stamp_id;
  set local role authenticated;
  perform public.mutate_notebook_v2(trip,'itinerary.delete',jsonb_build_object('id',scheduled_id));
  if (select stamp_kind from public.travel_stamps where trip_id=trip and id=stamp_id) <> 'boat' then
    raise exception 'Deleting legacy item failed to capture effective place choice';
  end if;

  reset role;
  insert into public.activity_templates(id,trip_id,name,description,seeded,created_by,updated_by)
    values('design-multi',trip,'Design group','',false,owner_id,owner_id),
      ('design-single',trip,'Design single','',false,owner_id,owner_id);
  insert into public.activity_template_stops(id,trip_id,template_id,place_id,place_name,notes,position,created_by,updated_by)
    values('design-stop-1',trip,'design-multi','design-place','Test stop','{}',0,owner_id,owner_id),
      ('design-stop-2',trip,'design-multi',null,'Another stop','{}',1,owner_id,owner_id),
      ('design-stop-single',trip,'design-single','design-place','Single stop','{}',0,owner_id,owner_id);
  set local role authenticated;
  select t.id into template_id from public.activity_templates t
    where t.trip_id=trip and (select count(*) from public.activity_template_stops s
      where s.trip_id=trip and s.template_id=t.id)>1 limit 1;
  select place_id into source_place_id from public.activity_template_stops
    where trip_id=trip and activity_template_stops.template_id=template_id order by position limit 1;
  perform public.mutate_notebook_v2(trip,'place.update',
    jsonb_build_object('id',source_place_id,'patch',jsonb_build_object('stampKind','house')));
  perform public.mutate_notebook_v2(trip,'template.update',
    jsonb_build_object('id',template_id,'patch',jsonb_build_object('stampKind','road')));
  result := public.mutate_notebook_v2(trip,'template.materialize',
    jsonb_build_object('templateId',template_id,'dayId','day-2026-09-22'));
  parent_id := result->>'id';
  select id into child_id from public.itinerary_items
    where trip_id=trip and itinerary_items.parent_id=parent_id and place_id=source_place_id;
  if (select stamp_kind from public.itinerary_items where trip_id=trip and id=parent_id) <> 'road'
    or child_id is null
    or (select stamp_kind from public.itinerary_items where trip_id=trip and id=child_id) is not null then
    raise exception 'Template parent default leaked into child';
  end if;
  perform public.mutate_notebook_v2(trip,'stamp.create',jsonb_build_object('itemId',parent_id));
  perform public.mutate_notebook_v2(trip,'stamp.create',jsonb_build_object('itemId',child_id));
  perform public.mutate_notebook_v2(trip,'itinerary.delete_group',jsonb_build_object('id',parent_id));
  if not exists(select 1 from public.travel_stamps where trip_id=trip and stamp_kind='road' and detached)
    or not exists(select 1 from public.travel_stamps where trip_id=trip and stamp_kind='house' and detached) then
    raise exception 'Deleting a template group lost parent/child snapshots';
  end if;

  select t.id into single_template_id from public.activity_templates t
    where t.trip_id=trip and (select count(*) from public.activity_template_stops s
      where s.trip_id=trip and s.template_id=t.id)=1 limit 1;
  perform public.mutate_notebook_v2(trip,'template.update',
    jsonb_build_object('id',single_template_id,'patch',jsonb_build_object(
      'stampKind','wine','stops',jsonb_build_array(jsonb_build_object(
        'id','custom-single-stop','placeId',source_place_id,'placeName','Test stop','notes','[]'::jsonb)))));
  result := public.mutate_notebook_v2(trip,'template.materialize',
    jsonb_build_object('templateId',single_template_id,'dayId','day-2026-09-22',
      'details',jsonb_build_object('name','Custom single stop','stampKind','pin')));
  single_item_id := result->>'id';
  if not exists(select 1 from public.itinerary_items i join public.places p
    on p.trip_id=i.trip_id and p.id=i.place_id
    where i.trip_id=trip and i.id=single_item_id and i.stamp_kind='pin' and p.stamp_kind='house') then
    raise exception 'Single template customization lost place preference or item override';
  end if;

  -- Every allowed design survives the domain, mutation and read wrapper.
  foreach design in array array['auto','mountain','penguin','house','cape','lighthouse','road','boat','huts','promenade','wine','cliff','pin'] loop
    perform public.mutate_notebook_v2(trip,'place.update',
      jsonb_build_object('id','design-place','patch',jsonb_build_object('stampKind',design)));
    notebook := public.load_notebook_v5(trip);
    if not exists(select 1 from jsonb_array_elements(notebook->'places') p
      where p->>'id'='design-place' and p->>'stampKind'=design) then
      raise exception 'Design did not survive read: %', design;
    end if;
  end loop;
  original := public.load_notebook_v4(trip);
  if original <> public.load_notebook_v5(trip) then
    raise exception 'Legacy export omitted designs';
  end if;
  foreach invalid in array array['"invalid"'::jsonb,'null'::jsonb,'12'::jsonb,'{}'::jsonb] loop
    begin
      perform public.mutate_notebook_v2(trip,'place.update',
        jsonb_build_object('id','design-place','patch',jsonb_build_object('stampKind',invalid)));
      raise exception 'Invalid mutation accepted';
    exception when others then
      if sqlerrm <> 'Invalid stamp design' then raise; end if;
    end;
    foreach collection in array array['places','items','activityTemplates','stamps'] loop
      begin
        perform public.restore_notebook_v2(trip,jsonb_set(original,array[collection,'0','stampKind'],invalid));
        raise exception 'Invalid restore accepted';
      exception when others then
        if sqlerrm <> 'Invalid stamp design' then raise; end if;
      end;
    end loop;
  end loop;
  if public.load_notebook_v5(trip) <> original then raise exception 'Invalid input changed notebook'; end if;

  -- Old clients serialize unrecognized fields unchanged in a schema-4 backup.
  result := public.restore_notebook_v1(trip,original::text::jsonb);
  notebook := public.load_notebook_v5(trip);
  foreach collection in array array['places','items','activityTemplates','stamps'] loop
    if exists(
      select 1 from jsonb_array_elements(original->collection) a
      join jsonb_array_elements(notebook->collection) b on a->>'id'=b->>'id'
      where a->'stampKind' is distinct from b->'stampKind'
    ) then raise exception 'Restore lost % stamp choices',collection; end if;
  end loop;
  foreach collection in array array['places','items','activityTemplates','stamps'] loop
    select jsonb_agg(r - 'stampKind') into result from jsonb_array_elements(original->collection) r;
    original := jsonb_set(original,array[collection],result);
  end loop;
  perform public.restore_notebook_v2(trip,original);
  notebook := public.load_notebook_v5(trip);
  foreach collection in array array['places','items','activityTemplates','stamps'] loop
    if exists(select 1 from jsonb_array_elements(notebook->collection) r where r ? 'stampKind') then
      raise exception 'Legacy restore must preserve omitted designs';
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  if public.load_notebook_v5(trip) is not null then raise exception 'Outsider read leaked notebook'; end if;
  if public.load_notebook_v4(trip) is not null then raise exception 'Legacy outsider read leaked notebook'; end if;
  begin
    perform public.mutate_notebook_v1(trip,'place.update','{"id":"design-place","patch":{"notes":"outsider"}}');
    raise exception 'Legacy outsider mutation accepted';
  exception when others then
    if sqlerrm <> 'Trip membership with edit access is required' then raise; end if;
  end;
  begin
    perform public.restore_notebook_v1(trip,original);
    raise exception 'Legacy outsider restore accepted';
  exception when others then
    if sqlerrm <> 'Only a trip owner may restore a notebook' then raise; end if;
  end;
  begin
    perform public.mutate_notebook_v2(trip,'place.update','{"id":"design-place","patch":{"stampKind":"pin"}}');
    raise exception 'Outsider mutation accepted';
  exception when others then
    if sqlerrm <> 'Trip membership with edit access is required' then raise; end if;
  end;
  begin
    perform public.restore_notebook_v2(trip,original);
    raise exception 'Outsider restore accepted';
  exception when others then
    if sqlerrm <> 'Only a trip owner may restore a notebook' then raise; end if;
  end;
  reset role;
end $$;
rollback;
