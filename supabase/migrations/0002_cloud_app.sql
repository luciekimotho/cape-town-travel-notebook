-- Cape Town Travel Notebook cloud application upgrade.
-- Apply once after 0001_setup.sql. This adds grouped bootstrap v2, acknowledged
-- trip-scoped mutations, safe versioned photo objects, collaboration controls,
-- and owner-only atomic ZIP restore.

create unique index if not exists photos_one_per_stamp_idx
  on public.photos(trip_id, stamp_id);

alter table public.photos drop constraint if exists photo_private_object_path;
alter table public.photos add constraint photo_private_object_path check (
  object_path = trip_id::text || '/' || id || '.' ||
    case mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end
  or (
    left(object_path, length(trip_id::text || '/' || id || '-'))
      = trip_id::text || '/' || id || '-'
    and substring(object_path from length(trip_id::text || '/' || id || '-') + 1)
      ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.' ||
        case mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end || '$')
  )
);

create or replace function public.can_access_photo_object(
  p_name text, p_require_uploader boolean default false
) returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,240}\.(jpg|png|webp)$'
      then public.is_trip_member(split_part(p_name, '/', 1)::uuid)
    else false
  end
$$;
revoke all on function public.can_access_photo_object(text, boolean) from public;
grant execute on function public.can_access_photo_object(text, boolean) to authenticated;

-- Keep the v4 domain shape while enriching photo metadata with its opaque private path.
alter function public.load_notebook_v4(uuid) rename to load_notebook_v4_without_storage_path;
create function public.load_notebook_v4(p_trip_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select case when b.notebook is null then null else
    jsonb_set(
      b.notebook,
      '{photos}',
      coalesce((
        select jsonb_agg(e.photo || jsonb_build_object('storagePath', p.object_path) order by e.ordinality)
        from jsonb_array_elements(b.notebook->'photos') with ordinality e(photo, ordinality)
        join public.photos p
          on p.trip_id = p_trip_id and p.id = e.photo->>'id'
      ), '[]'::jsonb)
    )
  end
  from (select public.load_notebook_v4_without_storage_path(p_trip_id) notebook) b
$$;
revoke all on function public.load_notebook_v4(uuid) from public;
grant execute on function public.load_notebook_v4(uuid) to authenticated;

create or replace function public.mutation_add_linked_expense(
  p_trip_id uuid, p_item_id text, p_cost jsonb, p_expense_date date
) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_id text := gen_random_uuid()::text;
begin
  if p_cost is null then return null; end if;
  insert into public.expenses(
    id, trip_id, amount, currency, expense_date, category, note,
    recorded_rate_set_id, recorded_rate_label, recorded_rate_effective_date,
    recorded_kes_per_kes, recorded_kes_per_usd, recorded_kes_per_zar,
    itinerary_item_id, created_by, updated_by
  )
  values (
    v_id, p_trip_id, (p_cost->>'amount')::numeric,
    (p_cost->>'currency')::public.expense_currency, p_expense_date, 'Activity',
    nullif(p_cost->>'note', ''), null, null, null, null, null, null,
    p_item_id, auth.uid(), auth.uid()
  );
  return v_id;
end $$;
revoke all on function public.mutation_add_linked_expense(uuid, text, jsonb, date) from public;

create or replace function public.mutate_notebook_v1(
  p_trip_id uuid, p_operation text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id text;
  v_item_id text;
  v_place_id text;
  v_parent_id text;
  v_old_parent_id text;
  v_day_id text;
  v_old_day_id text;
  v_template_id text;
  v_stamp_id text;
  v_old_stamp_id text;
  v_path text;
  v_patch jsonb;
  v_row jsonb;
  v_stop jsonb;
  v_details jsonb;
  v_cost jsonb;
  v_date date;
  v_count integer;
  v_position integer;
  v_name text;
  v_paths text[];
begin
  if auth.uid() is null or not public.can_edit_trip(p_trip_id) then
    raise exception 'Trip membership with edit access is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Mutation payload must be an object';
  end if;
  perform 1 from public.trips where id = p_trip_id for update;
  if not found then raise exception 'Trip not found'; end if;

  if p_operation = 'trip.update' then
    v_patch := coalesce(p_payload->'patch', '{}'::jsonb);
    update public.trips set
      destination = case when v_patch ? 'destination' then trim(v_patch->>'destination') else destination end,
      travellers = case when v_patch ? 'travellers' then (v_patch->>'travellers')::integer else travellers end,
      start_date = case when v_patch ? 'startDate' then (v_patch->>'startDate')::date else start_date end,
      end_date = case when v_patch ? 'endDate' then (v_patch->>'endDate')::date else end_date end,
      timezone = case when v_patch ? 'timezone' then v_patch->>'timezone' else timezone end,
      notes = case when v_patch ? 'notes' then coalesce(v_patch->>'notes', '') else notes end
    where id = p_trip_id;
    update public.itinerary_days d set out_of_range =
      d.day_date not between (select start_date from public.trips where id = p_trip_id)
                         and (select end_date from public.trips where id = p_trip_id)
    where d.trip_id = p_trip_id;
    insert into public.itinerary_days(
      id, trip_id, day_date, out_of_range, created_by, updated_by
    )
    select x::date::text, p_trip_id, x::date, false, auth.uid(), auth.uid()
    from generate_series(
      (select start_date from public.trips where id = p_trip_id),
      (select end_date from public.trips where id = p_trip_id),
      interval '1 day'
    ) x
    on conflict (trip_id, day_date) do update set out_of_range = false;

  elsif p_operation like 'checklist.%' then
    v_id := coalesce(p_payload->>'id', p_payload#>>'{item,id}');
    if p_operation = 'checklist.create' then
      v_row := p_payload->'item';
      insert into public.checklist_items(
        id, trip_id, title, category, due_date, completed, note, created_by, updated_by
      ) values (
        v_id, p_trip_id, trim(v_row->>'title'), trim(v_row->>'category'),
        nullif(v_row->>'dueDate', '')::date, coalesce((v_row->>'completed')::boolean, false),
        nullif(v_row->>'note', ''), auth.uid(), auth.uid()
      );
    elsif p_operation = 'checklist.update' then
      v_patch := p_payload->'patch';
      update public.checklist_items set
        title = case when v_patch ? 'title' then trim(v_patch->>'title') else title end,
        category = case when v_patch ? 'category' then trim(v_patch->>'category') else category end,
        due_date = case when v_patch ? 'dueDate' then nullif(v_patch->>'dueDate', '')::date else due_date end,
        completed = case when v_patch ? 'completed' then (v_patch->>'completed')::boolean else completed end,
        note = case when v_patch ? 'note' then nullif(v_patch->>'note', '') else note end
      where trip_id = p_trip_id and id = v_id;
      if not found then raise exception 'Checklist item not found'; end if;
    elsif p_operation = 'checklist.toggle' then
      update public.checklist_items set completed = not completed
      where trip_id = p_trip_id and id = v_id;
      if not found then raise exception 'Checklist item not found'; end if;
    elsif p_operation = 'checklist.delete' then
      delete from public.checklist_items where trip_id = p_trip_id and id = v_id;
      if not found then raise exception 'Checklist item not found'; end if;
    else raise exception 'Unknown checklist operation';
    end if;

  elsif p_operation = 'place.create' then
    v_row := p_payload->'place'; v_id := v_row->>'id';
    insert into public.places(
      id, trip_id, name, address, notes, google_maps_url, want_to_visit, seeded,
      created_by, updated_by
    ) values (
      v_id, p_trip_id, trim(v_row->>'name'), nullif(v_row->>'address', ''),
      nullif(v_row->>'notes', ''), nullif(v_row->>'googleMapsUrl', ''),
      coalesce((v_row->>'wantToVisit')::boolean, true), coalesce((v_row->>'seeded')::boolean, false),
      auth.uid(), auth.uid()
    );

  elsif p_operation = 'place.update' then
    v_id := p_payload->>'id'; v_patch := p_payload->'patch';
    update public.places set
      name = case when v_patch ? 'name' then trim(v_patch->>'name') else name end,
      address = case when v_patch ? 'address' then nullif(v_patch->>'address', '') else address end,
      notes = case when v_patch ? 'notes' then nullif(v_patch->>'notes', '') else notes end,
      google_maps_url = case when v_patch ? 'googleMapsUrl' then nullif(v_patch->>'googleMapsUrl', '') else google_maps_url end,
      want_to_visit = case when v_patch ? 'wantToVisit' then (v_patch->>'wantToVisit')::boolean else want_to_visit end
    where trip_id = p_trip_id and id = v_id;
    if not found then raise exception 'Place not found'; end if;

  elsif p_operation = 'place.delete' then
    v_id := p_payload->>'id';
    if exists(select 1 from public.itinerary_items where trip_id = p_trip_id and place_id = v_id)
      then raise exception 'Remove this place from the itinerary before deleting it'; end if;
    delete from public.places where trip_id = p_trip_id and id = v_id;
    if not found then raise exception 'Place not found'; end if;

  elsif p_operation = 'place.schedule' then
    v_place_id := p_payload->>'placeId'; v_day_id := p_payload->>'dayId';
    v_id := gen_random_uuid()::text; v_patch := coalesce(p_payload->'itemPatch', '{}'::jsonb);
    perform 1 from public.places where trip_id = p_trip_id and id = v_place_id;
    if not found then raise exception 'Place not found'; end if;
    perform 1 from public.itinerary_days where trip_id = p_trip_id and id = v_day_id;
    if not found then raise exception 'Itinerary day not found'; end if;
    insert into public.itinerary_items(
      id, trip_id, day_id, place_id, parent_id, item_time, notes, booking_status,
      visited, position, created_by, updated_by
    ) values (
      v_id, p_trip_id, v_day_id, v_place_id, nullif(v_patch->>'parentId', ''),
      nullif(v_patch->>'time', '')::time, nullif(v_patch->>'notes', ''),
      nullif(v_patch->>'bookingStatus', '')::public.booking_status,
      false, (extract(epoch from clock_timestamp()) * 1000)::bigint, auth.uid(), auth.uid()
    );
    if nullif(v_patch->>'parentId', '') is not null then
      update public.itinerary_items set is_activity_group = true
      where trip_id = p_trip_id and id = nullif(v_patch->>'parentId', '');
    end if;
    v_patch := coalesce(p_payload->'placePatch', '{}'::jsonb) || '{"wantToVisit":false}'::jsonb;
    update public.places set
      name = case when v_patch ? 'name' then trim(v_patch->>'name') else name end,
      address = case when v_patch ? 'address' then nullif(v_patch->>'address', '') else address end,
      notes = case when v_patch ? 'notes' then nullif(v_patch->>'notes', '') else notes end,
      google_maps_url = case when v_patch ? 'googleMapsUrl' then nullif(v_patch->>'googleMapsUrl', '') else google_maps_url end,
      want_to_visit = false
    where trip_id = p_trip_id and id = v_place_id;
    select day_date into v_date from public.itinerary_days where trip_id = p_trip_id and id = v_day_id;
    perform public.mutation_add_linked_expense(p_trip_id, v_id, p_payload->'cost', v_date);

  elsif p_operation = 'template.update' then
    v_id := p_payload->>'id'; v_patch := p_payload->'patch';
    update public.activity_templates set
      name = case when v_patch ? 'name' then trim(v_patch->>'name') else name end,
      description = case when v_patch ? 'description' then coalesce(v_patch->>'description', '') else description end
    where trip_id = p_trip_id and id = v_id;
    if not found then raise exception 'Activity template not found'; end if;
    if v_patch ? 'stops' then
      delete from public.activity_template_stops where trip_id = p_trip_id and template_id = v_id;
      v_position := 0;
      for v_stop in select value from jsonb_array_elements(v_patch->'stops') loop
        insert into public.activity_template_stops(
          id, trip_id, template_id, place_id, place_name, notes, approximate_minutes,
          optional, position, created_by, updated_by
        ) values (
          v_stop->>'id', p_trip_id, v_id, nullif(v_stop->>'placeId', ''),
          trim(v_stop->>'placeName'),
          array(select jsonb_array_elements_text(coalesce(v_stop->'notes', '[]'::jsonb))),
          nullif(v_stop->>'approximateMinutes', '')::integer,
          coalesce((v_stop->>'optional')::boolean, false), v_position, auth.uid(), auth.uid()
        );
        v_position := v_position + 1;
      end loop;
    end if;

  elsif p_operation = 'template.delete' then
    v_id := p_payload->>'id';
    delete from public.activity_templates where trip_id = p_trip_id and id = v_id;
    if not found then raise exception 'Activity template not found'; end if;

  elsif p_operation = 'template.materialize' then
    v_template_id := p_payload->>'templateId'; v_day_id := p_payload->>'dayId';
    v_details := coalesce(p_payload->'details', '{}'::jsonb); v_cost := p_payload->'cost';
    perform 1 from public.itinerary_days where trip_id = p_trip_id and id = v_day_id;
    if not found then raise exception 'Itinerary day not found'; end if;
    select count(*) into v_count from public.activity_template_stops
      where trip_id = p_trip_id and template_id = v_template_id;
    if v_count = 0 then raise exception 'Activity template has no stops'; end if;
    select day_date into v_date from public.itinerary_days where trip_id = p_trip_id and id = v_day_id;
    if v_count = 1 then
      select to_jsonb(s) into v_stop from public.activity_template_stops s
        where trip_id = p_trip_id and template_id = v_template_id limit 1;
      v_place_id := v_stop->>'place_id';
      if v_details ? 'name' or v_place_id is null then
        v_place_id := gen_random_uuid()::text;
        insert into public.places(
          id, trip_id, name, address, notes, google_maps_url, want_to_visit, seeded,
          created_by, updated_by
        ) values (
          v_place_id, p_trip_id, coalesce(nullif(trim(v_details->>'name'), ''), v_stop->>'place_name'),
          nullif(v_details->>'address', ''), nullif(v_details->>'notes', ''),
          nullif(v_details->>'googleMapsUrl', ''), false, false, auth.uid(), auth.uid()
        );
      end if;
      v_id := gen_random_uuid()::text;
      insert into public.itinerary_items(
        id, trip_id, day_id, place_id, parent_id, template_id, item_time, notes,
        booking_status, visited, position, created_by, updated_by
      ) values (
        v_id, p_trip_id, v_day_id, v_place_id, nullif(v_details->>'parentId', ''),
        v_template_id, nullif(v_details->>'time', '')::time,
        coalesce(nullif(v_details->>'notes', ''), array_to_string(array(select jsonb_array_elements_text(v_stop->'notes')), ' · ')),
        nullif(v_details->>'bookingStatus', '')::public.booking_status, false,
        (extract(epoch from clock_timestamp()) * 1000)::bigint, auth.uid(), auth.uid()
      );
      if nullif(v_details->>'parentId', '') is not null then
        update public.itinerary_items set is_activity_group = true
        where trip_id = p_trip_id and id = nullif(v_details->>'parentId', '');
      end if;
    else
      select name into v_name from public.activity_templates where trip_id = p_trip_id and id = v_template_id;
      v_place_id := gen_random_uuid()::text; v_id := gen_random_uuid()::text;
      insert into public.places(id, trip_id, name, address, notes, google_maps_url, want_to_visit, seeded, created_by, updated_by)
      values(v_place_id, p_trip_id, coalesce(nullif(trim(v_details->>'name'), ''), v_name),
        nullif(v_details->>'address', ''), nullif(v_details->>'notes', ''),
        nullif(v_details->>'googleMapsUrl', ''), false, false, auth.uid(), auth.uid());
      insert into public.itinerary_items(
        id, trip_id, day_id, place_id, template_id, is_activity_group, item_time, notes,
        booking_status, visited, position, created_by, updated_by
      ) values (
        v_id, p_trip_id, v_day_id, v_place_id, v_template_id, true,
        nullif(v_details->>'time', '')::time, nullif(v_details->>'notes', ''),
        nullif(v_details->>'bookingStatus', '')::public.booking_status, false,
        (extract(epoch from clock_timestamp()) * 1000)::bigint, auth.uid(), auth.uid()
      );
      for v_stop in select to_jsonb(s) from public.activity_template_stops s
        where s.trip_id = p_trip_id and s.template_id = v_template_id order by s.position
      loop
        v_place_id := v_stop->>'place_id';
        if v_place_id is null then
          select id into v_place_id from public.places
            where trip_id = p_trip_id and name = v_stop->>'place_name' limit 1;
        end if;
        if v_place_id is null then
          v_place_id := gen_random_uuid()::text;
          insert into public.places(id, trip_id, name, want_to_visit, seeded, created_by, updated_by)
          values(v_place_id, p_trip_id, v_stop->>'place_name', false, true, auth.uid(), auth.uid());
        end if;
        insert into public.itinerary_items(
          id, trip_id, day_id, place_id, parent_id, template_id, notes, visited,
          position, created_by, updated_by
        ) values (
          gen_random_uuid()::text, p_trip_id, v_day_id, v_place_id, v_id, v_template_id,
          concat_ws(' · ',
            case when (v_stop->>'optional')::boolean then 'Optional' end,
            nullif(array_to_string(array(select jsonb_array_elements_text(v_stop->'notes')), ' · '), ''),
            case when (v_stop->>'approximate_minutes') is not null then
              'Approx. ' || (v_stop->>'approximate_minutes') || ' min' end),
          false, (v_stop->>'position')::integer, auth.uid(), auth.uid()
        );
      end loop;
    end if;
    perform public.mutation_add_linked_expense(p_trip_id, v_id, v_cost, v_date);

  elsif p_operation = 'itinerary.create' then
    v_row := p_payload->'place'; v_place_id := v_row->>'id';
    insert into public.places(
      id, trip_id, name, address, notes, google_maps_url, want_to_visit, seeded, created_by, updated_by
    ) values (
      v_place_id, p_trip_id, trim(v_row->>'name'), nullif(v_row->>'address', ''),
      nullif(v_row->>'notes', ''), nullif(v_row->>'googleMapsUrl', ''),
      coalesce((v_row->>'wantToVisit')::boolean, false), coalesce((v_row->>'seeded')::boolean, false),
      auth.uid(), auth.uid()
    );
    v_row := p_payload->'item'; v_id := v_row->>'id'; v_day_id := v_row->>'dayId';
    insert into public.itinerary_items(
      id, trip_id, day_id, place_id, parent_id, template_id, is_activity_group,
      item_time, notes, booking_status, visited, position, created_by, updated_by
    ) values (
      v_id, p_trip_id, v_day_id, v_place_id, nullif(v_row->>'parentId', ''),
      nullif(v_row->>'templateId', ''), coalesce((v_row->>'isActivityGroup')::boolean, false),
      nullif(v_row->>'time', '')::time, nullif(v_row->>'notes', ''),
      nullif(v_row->>'bookingStatus', '')::public.booking_status,
      false, coalesce((v_row->>'position')::bigint, 0),
      auth.uid(), auth.uid()
    );
    if nullif(v_row->>'parentId', '') is not null then
      update public.itinerary_items set is_activity_group = true
      where trip_id = p_trip_id and id = nullif(v_row->>'parentId', '');
    end if;
    select day_date into v_date from public.itinerary_days where trip_id = p_trip_id and id = v_day_id;
    perform public.mutation_add_linked_expense(p_trip_id, v_id, p_payload->'cost', v_date);

  elsif p_operation = 'itinerary.update' then
    v_id := p_payload->>'id'; v_patch := coalesce(p_payload->'patch', '{}'::jsonb);
    select parent_id, day_id, place_id into v_old_parent_id, v_old_day_id, v_place_id
      from public.itinerary_items where trip_id = p_trip_id and id = v_id for update;
    if not found then raise exception 'Itinerary item not found'; end if;
    v_parent_id := case when v_patch ? 'parentId' then nullif(v_patch->>'parentId', '') else v_old_parent_id end;
    v_day_id := case when v_patch ? 'dayId' then v_patch->>'dayId' else v_old_day_id end;
    set constraints itinerary_parent_guard deferred;
    update public.itinerary_items set
      day_id = v_day_id, parent_id = v_parent_id,
      item_time = case when v_patch ? 'time' then nullif(v_patch->>'time', '')::time else item_time end,
      notes = case when v_patch ? 'notes' then nullif(v_patch->>'notes', '') else notes end,
      booking_status = case when v_patch ? 'bookingStatus' then nullif(v_patch->>'bookingStatus', '')::public.booking_status else booking_status end,
      position = case when v_patch ? 'position' then (v_patch->>'position')::bigint else position end
    where trip_id = p_trip_id and id = v_id;
    if v_day_id <> v_old_day_id and v_parent_id is null then
      update public.itinerary_items set day_id = v_day_id
      where trip_id = p_trip_id and parent_id = v_id;
    end if;
    if v_parent_id is distinct from v_old_parent_id then
      if v_parent_id is not null then
        update public.itinerary_items set is_activity_group = true
        where trip_id = p_trip_id and id = v_parent_id;
      end if;
      if v_old_parent_id is not null and not exists(
        select 1 from public.itinerary_items where trip_id = p_trip_id and parent_id = v_old_parent_id
      ) then
        update public.itinerary_items set is_activity_group = false
        where trip_id = p_trip_id and id = v_old_parent_id;
      end if;
    end if;
    if v_patch ? 'name' or v_patch ? 'address' or v_patch ? 'googleMapsUrl' then
      update public.places set
        name = case when v_patch ? 'name' then trim(v_patch->>'name') else name end,
        address = case when v_patch ? 'address' then nullif(v_patch->>'address', '') else address end,
        google_maps_url = case when v_patch ? 'googleMapsUrl' then nullif(v_patch->>'googleMapsUrl', '') else google_maps_url end
      where trip_id = p_trip_id and id = v_place_id;
    end if;
    if p_payload ? 'linkedCost' then
      if p_payload->'linkedCost' = 'null'::jsonb then
        delete from public.expenses where trip_id = p_trip_id and itinerary_item_id = v_id;
      elsif exists(select 1 from public.expenses where trip_id = p_trip_id and itinerary_item_id = v_id) then
        update public.expenses set
          amount = (p_payload#>>'{linkedCost,amount}')::numeric,
          currency = (p_payload#>>'{linkedCost,currency}')::public.expense_currency,
          note = nullif(p_payload#>>'{linkedCost,note}', '')
        where trip_id = p_trip_id and itinerary_item_id = v_id;
      else
        select day_date into v_date from public.itinerary_days where trip_id = p_trip_id and id = v_day_id;
        perform public.mutation_add_linked_expense(p_trip_id, v_id, p_payload->'linkedCost', v_date);
      end if;
    end if;

  elsif p_operation in ('itinerary.delete', 'itinerary.delete_group') then
    v_id := p_payload->>'id';
    select place_id, parent_id into v_place_id, v_old_parent_id from public.itinerary_items
      where trip_id = p_trip_id and id = v_id;
    if not found then raise exception 'Itinerary item not found'; end if;
    if p_operation = 'itinerary.delete' and exists(
      select 1 from public.itinerary_items where trip_id = p_trip_id and parent_id = v_id
    ) then raise exception 'Use group deletion for an itinerary group'; end if;
    delete from public.itinerary_items where trip_id = p_trip_id and id = v_id;
    if v_old_parent_id is not null and not exists(
      select 1 from public.itinerary_items where trip_id = p_trip_id and parent_id = v_old_parent_id
    ) then
      update public.itinerary_items set is_activity_group = false
      where trip_id = p_trip_id and id = v_old_parent_id;
    end if;
    if p_operation = 'itinerary.delete_group'
       and not exists(select 1 from public.itinerary_items where trip_id = p_trip_id and place_id = v_place_id)
    then delete from public.places where trip_id = p_trip_id and id = v_place_id; end if;

  elsif p_operation = 'stamp.create' then
    v_item_id := p_payload->>'itemId'; v_id := gen_random_uuid()::text;
    select p.name, d.day_date into v_name, v_date
    from public.itinerary_items i
    join public.places p on (p.trip_id, p.id) = (i.trip_id, i.place_id)
    join public.itinerary_days d on (d.trip_id, d.id) = (i.trip_id, i.day_id)
    where i.trip_id = p_trip_id and i.id = v_item_id for update of i;
    if not found then raise exception 'Itinerary item not found'; end if;
    insert into public.travel_stamps(
      id, trip_id, itinerary_item_id, place_name, visit_date, detached, created_by, updated_by
    ) values(v_id, p_trip_id, v_item_id, v_name, v_date, false, auth.uid(), auth.uid());
    update public.itinerary_items set visited = true where trip_id = p_trip_id and id = v_item_id;

  elsif p_operation = 'stamp.undo' then
    v_item_id := p_payload->>'itemId';
    select array_agg(p.object_path) into v_paths from public.photos p
      join public.travel_stamps s on (s.trip_id, s.id) = (p.trip_id, p.stamp_id)
      where s.trip_id = p_trip_id and s.itinerary_item_id = v_item_id;
    delete from public.travel_stamps where trip_id = p_trip_id and itinerary_item_id = v_item_id;
    if not found then raise exception 'Stamp not found'; end if;
    update public.itinerary_items set visited = false where trip_id = p_trip_id and id = v_item_id;

  elsif p_operation = 'stamp.delete_detached' then
    v_id := p_payload->>'stampId';
    select array_agg(object_path) into v_paths from public.photos
      where trip_id = p_trip_id and stamp_id = v_id;
    delete from public.travel_stamps where trip_id = p_trip_id and id = v_id and detached;
    if not found then raise exception 'Detached memory not found'; end if;

  elsif p_operation = 'expense.create' then
    v_row := p_payload->'expense'; v_id := v_row->>'id';
    insert into public.expenses(
      id, trip_id, amount, currency, expense_date, category, note,
      recorded_rate_set_id, recorded_rate_label, recorded_rate_effective_date,
      recorded_kes_per_kes, recorded_kes_per_usd, recorded_kes_per_zar,
      itinerary_item_id, created_by, updated_by
    ) values (
      v_id, p_trip_id, (v_row->>'amount')::numeric, (v_row->>'currency')::public.expense_currency,
      (v_row->>'date')::date, trim(v_row->>'category'), nullif(v_row->>'note', ''),
      nullif(v_row->>'rateSetId', ''), null, null, null, null, null,
      nullif(v_row->>'itineraryItemId', ''), auth.uid(), auth.uid()
    );

  elsif p_operation = 'expense.update' then
    v_id := p_payload->>'id'; v_patch := p_payload->'patch';
    update public.expenses set
      amount = case when v_patch ? 'amount' then (v_patch->>'amount')::numeric else amount end,
      currency = case when v_patch ? 'currency' then (v_patch->>'currency')::public.expense_currency else currency end,
      expense_date = case when v_patch ? 'date' then (v_patch->>'date')::date else expense_date end,
      category = case when v_patch ? 'category' then trim(v_patch->>'category') else category end,
      note = case when v_patch ? 'note' then nullif(v_patch->>'note', '') else note end
    where trip_id = p_trip_id and id = v_id;
    if not found then raise exception 'Expense not found'; end if;

  elsif p_operation = 'expense.delete' then
    v_id := p_payload->>'id';
    delete from public.expenses where trip_id = p_trip_id and id = v_id;
    if not found then raise exception 'Expense not found'; end if;

  elsif p_operation = 'metadata.display_currency' then
    if p_payload->>'currency' not in ('KES', 'USD', 'ZAR') then raise exception 'Invalid display currency'; end if;
    insert into public.notebook_metadata(trip_id, key, value, created_by, updated_by)
    values(p_trip_id, 'displayCurrency', p_payload->>'currency', auth.uid(), auth.uid())
    on conflict (trip_id, key) do update set value = excluded.value;
    v_id := 'displayCurrency';

  elsif p_operation = 'rates.activate' then
    v_row := p_payload->'rate'; v_id := v_row->>'id';
    update public.rate_sets set active = false where trip_id = p_trip_id and active;
    insert into public.rate_sets(
      id, trip_id, label, effective_date, kes_per_kes, kes_per_usd, kes_per_zar,
      active, example, created_by, updated_by
    ) values (
      v_id, p_trip_id, trim(v_row->>'label'), (v_row->>'effectiveDate')::date, 1,
      (v_row->>'kesPerUsd')::numeric, (v_row->>'kesPerZar')::numeric,
      true, false, auth.uid(), auth.uid()
    );

  elsif p_operation = 'photo.create' then
    v_row := p_payload->'photo'; v_id := v_row->>'id'; v_path := v_row->>'objectPath';
    insert into public.photos(
      id, trip_id, stamp_id, caption, mime_type, width, height, byte_size,
      object_path, uploaded_by, created_by, updated_by
    ) values (
      v_id, p_trip_id, v_row->>'stampId', coalesce(v_row->>'caption', ''),
      v_row->>'mimeType', (v_row->>'width')::integer, (v_row->>'height')::integer,
      (v_row->>'size')::bigint, v_path, auth.uid(), auth.uid(), auth.uid()
    );

  elsif p_operation = 'photo.delete' then
    v_id := p_payload->>'id';
    delete from public.photos where trip_id = p_trip_id and id = v_id returning object_path into v_path;
    if not found then raise exception 'Photo not found'; end if;

  elsif p_operation = 'photo.replace' then
    v_row := p_payload->'photo';
    v_id := v_row->>'id';
    select stamp_id, object_path into v_old_stamp_id, v_path
      from public.photos
      where trip_id = p_trip_id and id = p_payload->>'oldId'
      for update;
    if not found then raise exception 'Photo to replace not found'; end if;
    if v_id is distinct from p_payload->>'oldId' then
      raise exception 'A replacement photo must preserve its logical photo ID';
    end if;
    if v_row->>'stampId' is distinct from v_old_stamp_id then
      raise exception 'A replacement photo must remain attached to the same stamp';
    end if;
    delete from public.photos
      where trip_id = p_trip_id and id = p_payload->>'oldId';
    insert into public.photos(
      id, trip_id, stamp_id, caption, mime_type, width, height, byte_size,
      object_path, uploaded_by, created_by, updated_by
    ) values (
      v_id, p_trip_id, v_old_stamp_id, coalesce(v_row->>'caption', ''),
      v_row->>'mimeType', (v_row->>'width')::integer, (v_row->>'height')::integer,
      (v_row->>'size')::bigint, v_row->>'objectPath',
      auth.uid(), auth.uid(), auth.uid()
    );

  elsif p_operation = 'photo.update' then
    v_id := p_payload->>'id';
    update public.photos set caption = coalesce(p_payload->>'caption', '')
      where trip_id = p_trip_id and id = v_id;
    if not found then raise exception 'Photo not found'; end if;

  elsif p_operation = 'collaboration.share' then
    perform public.share_trip_with_email(p_trip_id, p_payload->>'email');
    v_id := lower(trim(p_payload->>'email'));

  elsif p_operation = 'collaboration.revoke_pending' then
    perform public.revoke_trip_email_access(p_trip_id);

  elsif p_operation = 'collaboration.remove_editor' then
    if not public.is_trip_owner(p_trip_id) then raise exception 'Only a trip owner may remove an editor'; end if;
    delete from public.trip_members
      where trip_id = p_trip_id and user_id = (p_payload->>'userId')::uuid and role = 'editor';
    if not found then raise exception 'Claimed editor not found'; end if;
    delete from public.trip_email_access where trip_id = p_trip_id;

  else
    raise exception 'Unknown notebook mutation: %', p_operation;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'operation', p_operation, 'id', v_id, 'objectPath', v_path,
    'objectPaths', to_jsonb(v_paths)
  ));
end $$;

revoke all on function public.mutate_notebook_v1(uuid, text, jsonb) from public;
grant execute on function public.mutate_notebook_v1(uuid, text, jsonb) to authenticated;

create or replace function public.trip_collaboration_status(p_trip_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when public.is_trip_member(p_trip_id) then jsonb_build_object(
    'role', public.trip_role(p_trip_id),
    'pending_email', case when public.is_trip_owner(p_trip_id) and a.claimed_at is null then a.email::text end,
    'claimed_email', case when public.is_trip_owner(p_trip_id) and a.claimed_at is not null then a.email::text end,
    'claimed_user_id', case when public.is_trip_owner(p_trip_id) then a.claimed_by end
  ) end
  from public.trips t left join public.trip_email_access a on a.trip_id = t.id
  where t.id = p_trip_id
$$;
revoke all on function public.trip_collaboration_status(uuid) from public;
grant execute on function public.trip_collaboration_status(uuid) to authenticated;

-- Mutations are RPC-only. Reads continue through RLS/list/load, and Storage object writes
-- remain directly available because their ordering is coordinated by the repository.
revoke insert, update, delete on public.trips, public.trip_members,
  public.checklist_items, public.itinerary_days, public.places,
  public.activity_templates, public.activity_template_stops, public.itinerary_items,
  public.rate_sets, public.expenses, public.travel_stamps, public.photos,
  public.notebook_metadata from authenticated;

-- Idempotent grouped-layout bootstrap. Existing v1 trips are upgraded only while
-- every fixed itinerary item is still in its exact initial structural state.
create or replace function public.create_capetown_2026_trip_v2()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_trip_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':capetown-2026-v2',0));
  v_trip_id := public.create_capetown_2026_trip();
  if exists (
    select 1 from public.notebook_metadata
    where trip_id=v_trip_id and key='system.layout' and value='capetown-2026-grouped-v2'
  ) then return v_trip_id; end if;
  if exists (
    select 1 from public.notebook_metadata
    where trip_id=v_trip_id and key='system.layout'
  ) then raise exception 'Trip has a different layout marker'; end if;
  if not exists (
    select 1 from public.notebook_metadata
    where trip_id=v_trip_id and key='system.bootstrap' and value='capetown-2026-v1'
  ) then raise exception 'Only the Cape Town v1 bootstrap can be grouped'; end if;
  if (select count(*) from public.itinerary_items where trip_id=v_trip_id) <> 32
     or (select md5(string_agg(id||chr(31)||coalesce(notes,''),chr(30) order by id))
         from public.itinerary_items where trip_id=v_trip_id)
       <> '8115d453441edf7ad74806a575c509e9'
     or exists(select 1 from public.expenses where trip_id=v_trip_id)
     or exists(select 1 from public.travel_stamps where trip_id=v_trip_id)
     or exists(select 1 from public.photos where trip_id=v_trip_id)
  then raise exception 'Bootstrap itinerary has been edited and cannot be regrouped automatically'; end if;
  if exists (
    select 1
    from (values
      ('item-day1-arrive-cpt','day-2026-09-21','place-cpt-airport',10),
      ('item-day1-check-in-options','day-2026-09-21','place-accommodation-options',20),
      ('item-day1-explore-waterfront','day-2026-09-21','place-va-waterfront',30),
      ('item-day1-light-shopping','day-2026-09-21','place-waterfront-shopping',40),
      ('item-day1-dinner-waterfront','day-2026-09-21','place-waterfront-dinner',50),
      ('item-day2-red-bus','day-2026-09-22','place-red-bus',10),
      ('item-day2-table-mountain','day-2026-09-22','place-table-mountain',20),
      ('item-day2-city-sights','day-2026-09-22','place-city-sights',30),
      ('item-day2-camps-bay-clifton','day-2026-09-22','place-camps-bay-clifton',40),
      ('item-day2-sunset-dinner','day-2026-09-22','place-sunset-dinner',50),
      ('item-day3-option-kirstenbosch-wine','day-2026-09-23','place-kirstenbosch-constantia',10),
      ('item-day3-option-relaxed','day-2026-09-23','place-relaxed-flex-day',20),
      ('item-day4-checkout-transfer','day-2026-09-24','place-sea-point-airbnb',10),
      ('item-day4-settle-in','day-2026-09-24','place-sea-point-airbnb',20),
      ('item-day4-promenade','day-2026-09-24','place-sea-point-promenade',30),
      ('item-day4-cafes-dining','day-2026-09-24','place-sea-point-dining',40),
      ('item-day5-hout-bay','day-2026-09-25','place-hout-bay',10),
      ('item-day5-chapmans-peak','day-2026-09-25','place-chapmans-peak',20),
      ('item-day5-cape-point','day-2026-09-25','place-cape-point-good-hope',30),
      ('item-day5-boulders','day-2026-09-25','place-boulders-beach',40),
      ('item-day5-muizenberg','day-2026-09-25','place-muizenberg',50),
      ('item-day6-morning-golf','day-2026-09-26','place-golf-round',10),
      ('item-day6-wine-tasting','day-2026-09-26','place-winelands',20),
      ('item-day6-long-lunch','day-2026-09-26','place-winelands-lunch',30),
      ('item-day6-return-cape-town','day-2026-09-26','place-sea-point-airbnb',40),
      ('item-day7-sea-point-shopping','day-2026-09-27','place-sea-point-shopping',10),
      ('item-day7-va-final-shopping','day-2026-09-27','place-va-waterfront',20),
      ('item-day7-sunset-cruise','day-2026-09-27','place-sunset-cruise',30),
      ('item-day7-farewell-dinner','day-2026-09-27','place-farewell-dinner',40),
      ('item-day8-breakfast','day-2026-09-28','place-departure-breakfast',10),
      ('item-day8-checkout','day-2026-09-28','place-sea-point-airbnb',20),
      ('item-day8-transfer-cpt','day-2026-09-28','place-cpt-airport',30)
    ) expected(id,day_id,place_id,position)
    left join public.itinerary_items i on i.trip_id=v_trip_id and i.id=expected.id
    where i.id is null or i.day_id<>expected.day_id or i.place_id<>expected.place_id
      or i.position<>expected.position or i.parent_id is not null or i.template_id is not null
      or i.is_activity_group or i.item_time is not null or i.booking_status is not null
      or i.visited or i.created_at<>i.updated_at or i.created_by<>i.updated_by
  ) then raise exception 'Bootstrap itinerary has been edited and cannot be regrouped automatically'; end if;

  insert into public.places(
    id,trip_id,name,want_to_visit,seeded,created_by,updated_by
  ) values
    ('place-group-day1',v_trip_id,'Arrival & V&A Waterfront',false,true,auth.uid(),auth.uid()),
    ('place-group-day2',v_trip_id,'Red Bus & Table Mountain',false,true,auth.uid(),auth.uid()),
    ('place-group-day3',v_trip_id,'Flexible Day',false,true,auth.uid(),auth.uid()),
    ('place-group-day4',v_trip_id,'Move to Sea Point',false,true,auth.uid(),auth.uid()),
    ('place-group-day5',v_trip_id,'Cape Peninsula Tour',false,true,auth.uid(),auth.uid()),
    ('place-group-day6',v_trip_id,'Golf & Wine Tour',false,true,auth.uid(),auth.uid()),
    ('place-group-day7',v_trip_id,'Shopping & Sunset Cruise',false,true,auth.uid(),auth.uid()),
    ('place-group-day8',v_trip_id,'Departure',false,true,auth.uid(),auth.uid());
  insert into public.itinerary_items(
    id,trip_id,day_id,place_id,is_activity_group,visited,position,created_by,updated_by
  ) values
    ('item-group-day1',v_trip_id,'day-2026-09-21','place-group-day1',true,false,0,auth.uid(),auth.uid()),
    ('item-group-day2',v_trip_id,'day-2026-09-22','place-group-day2',true,false,0,auth.uid(),auth.uid()),
    ('item-group-day3',v_trip_id,'day-2026-09-23','place-group-day3',true,false,0,auth.uid(),auth.uid()),
    ('item-group-day4',v_trip_id,'day-2026-09-24','place-group-day4',true,false,0,auth.uid(),auth.uid()),
    ('item-group-day5',v_trip_id,'day-2026-09-25','place-group-day5',true,false,0,auth.uid(),auth.uid()),
    ('item-group-day6',v_trip_id,'day-2026-09-26','place-group-day6',true,false,0,auth.uid(),auth.uid()),
    ('item-group-day7',v_trip_id,'day-2026-09-27','place-group-day7',true,false,0,auth.uid(),auth.uid()),
    ('item-group-day8',v_trip_id,'day-2026-09-28','place-group-day8',true,false,0,auth.uid(),auth.uid());
  update public.itinerary_items i set parent_id=m.parent_id,position=m.compact_position
  from (values
    ('item-day1-arrive-cpt','item-group-day1',0),('item-day1-check-in-options','item-group-day1',1),('item-day1-explore-waterfront','item-group-day1',2),('item-day1-light-shopping','item-group-day1',3),('item-day1-dinner-waterfront','item-group-day1',4),
    ('item-day2-red-bus','item-group-day2',0),('item-day2-table-mountain','item-group-day2',1),('item-day2-city-sights','item-group-day2',2),('item-day2-camps-bay-clifton','item-group-day2',3),('item-day2-sunset-dinner','item-group-day2',4),
    ('item-day3-option-kirstenbosch-wine','item-group-day3',0),('item-day3-option-relaxed','item-group-day3',1),
    ('item-day4-checkout-transfer','item-group-day4',0),('item-day4-settle-in','item-group-day4',1),('item-day4-promenade','item-group-day4',2),('item-day4-cafes-dining','item-group-day4',3),
    ('item-day5-hout-bay','item-group-day5',0),('item-day5-chapmans-peak','item-group-day5',1),('item-day5-cape-point','item-group-day5',2),('item-day5-boulders','item-group-day5',3),('item-day5-muizenberg','item-group-day5',4),
    ('item-day6-morning-golf','item-group-day6',0),('item-day6-wine-tasting','item-group-day6',1),('item-day6-long-lunch','item-group-day6',2),('item-day6-return-cape-town','item-group-day6',3),
    ('item-day7-sea-point-shopping','item-group-day7',0),('item-day7-va-final-shopping','item-group-day7',1),('item-day7-sunset-cruise','item-group-day7',2),('item-day7-farewell-dinner','item-group-day7',3),
    ('item-day8-breakfast','item-group-day8',0),('item-day8-checkout','item-group-day8',1),('item-day8-transfer-cpt','item-group-day8',2)
  ) m(id,parent_id,compact_position)
  where i.trip_id=v_trip_id and i.id=m.id;
  insert into public.notebook_metadata(trip_id,key,value,created_by,updated_by)
  values(v_trip_id,'system.layout','capetown-2026-grouped-v2',auth.uid(),auth.uid());
  return v_trip_id;
end $$;
revoke all on function public.create_capetown_2026_trip_v2() from public;
grant execute on function public.create_capetown_2026_trip_v2() to authenticated;


-- ============================================================================
-- Owner-only atomic backup restore
-- ============================================================================

-- Owner-only cloud restore. Storage uploads happen before this transaction.

create or replace function public.restore_notebook_v1(p_trip_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_trip jsonb;
  v_row jsonb;
  v_template jsonb;
  v_stop jsonb;
  v_old_paths text[];
  v_position integer;
begin
  if auth.uid() is null or not public.is_trip_owner(p_trip_id) then
    raise exception 'Only a trip owner may restore a notebook';
  end if;
  perform 1 from public.trips where id = p_trip_id for update;
  if not found then raise exception 'Trip not found'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'schemaVersion' <> '4' then
    raise exception 'Restore requires schemaVersion 4';
  end if;
  v_trip := p_payload->'trip';
  if jsonb_typeof(v_trip) <> 'object' or v_trip->>'id' <> 'current'
     or nullif(trim(v_trip->>'destination'), '') is null
     or (v_trip->>'startDate')::date > (v_trip->>'endDate')::date then
    raise exception 'Restore trip is invalid';
  end if;
  if exists (
    select 1 from (values
      ('checklist'),('days'),('items'),('places'),('activityTemplates'),
      ('expenses'),('stamps'),('photos'),('rateSets'),('metadata')
    ) k(name)
    where jsonb_typeof(p_payload->k.name) is distinct from 'array'
  ) then raise exception 'Every restore collection must be an array'; end if;

  -- Validate all identities and relationships against the payload before deletion.
  if exists (
    select 1 from (
      select 'checklist' kind, x->>'id' id from jsonb_array_elements(p_payload->'checklist') x
      union all select 'days', x->>'id' from jsonb_array_elements(p_payload->'days') x
      union all select 'items', x->>'id' from jsonb_array_elements(p_payload->'items') x
      union all select 'places', x->>'id' from jsonb_array_elements(p_payload->'places') x
      union all select 'activityTemplates', x->>'id' from jsonb_array_elements(p_payload->'activityTemplates') x
      union all select 'expenses', x->>'id' from jsonb_array_elements(p_payload->'expenses') x
      union all select 'stamps', x->>'id' from jsonb_array_elements(p_payload->'stamps') x
      union all select 'photos', x->>'id' from jsonb_array_elements(p_payload->'photos') x
      union all select 'rateSets', x->>'id' from jsonb_array_elements(p_payload->'rateSets') x
      union all select 'metadata', x->>'key' from jsonb_array_elements(p_payload->'metadata') x
    ) ids
    group by kind, id
    having count(*) > 1 or id is null or length(id) not between 1 and 500
  ) then raise exception 'Restore contains missing or duplicate IDs'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'days') d
    group by d->>'date' having count(*) > 1
  ) then raise exception 'Restore contains duplicate itinerary dates'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'items') i
    where not exists(select 1 from jsonb_array_elements(p_payload->'days') d where d->>'id'=i->>'dayId')
       or not exists(select 1 from jsonb_array_elements(p_payload->'places') p where p->>'id'=i->>'placeId')
       or ((i ? 'templateId') and not exists(
         select 1 from jsonb_array_elements(p_payload->'activityTemplates') t where t->>'id'=i->>'templateId'))
       or ((i ? 'parentId') and not exists(
         select 1 from jsonb_array_elements(p_payload->'items') parent
         where parent->>'id'=i->>'parentId'
           and parent->>'dayId'=i->>'dayId'
           and not (parent ? 'parentId')))
  ) then raise exception 'Restore contains invalid itinerary references'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'activityTemplates') t
    where jsonb_typeof(t->'stops') is distinct from 'array'
  ) then raise exception 'Restore activity template stops must be arrays'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'activityTemplates') t,
      jsonb_array_elements(t->'stops') s
    where ((s ? 'placeId') and not exists(
         select 1 from jsonb_array_elements(p_payload->'places') p where p->>'id'=s->>'placeId'))
  ) then raise exception 'Restore contains invalid activity template references'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload->'activityTemplates') t,
      jsonb_array_elements(t->'stops') s
    group by t->>'id', s->>'id'
    having count(*) > 1 or s->>'id' is null
  ) then raise exception 'Restore contains missing or duplicate activity stop IDs'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'expenses') e
    where ((e ? 'rateSetId') and not exists(
      select 1 from jsonb_array_elements(p_payload->'rateSets') r where r->>'id'=e->>'rateSetId'))
      or ((e ? 'itineraryItemId') and not exists(
        select 1 from jsonb_array_elements(p_payload->'items') i where i->>'id'=e->>'itineraryItemId'))
  ) or exists (
    select 1 from jsonb_array_elements(p_payload->'expenses') e
    where e ? 'itineraryItemId'
    group by e->>'itineraryItemId' having count(*) > 1
  ) then raise exception 'Restore contains invalid expense references'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'stamps') s
    where (coalesce((s->>'detached')::boolean, false) <> not (s ? 'itineraryItemId'))
       or ((s ? 'itineraryItemId') and not exists(
         select 1 from jsonb_array_elements(p_payload->'items') i where i->>'id'=s->>'itineraryItemId'))
  ) or exists (
    select 1 from jsonb_array_elements(p_payload->'stamps') s
    where s ? 'itineraryItemId'
    group by s->>'itineraryItemId' having count(*) > 1
  ) then raise exception 'Restore contains invalid stamp references'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'items') i
    where coalesce((i->>'visited')::boolean, false) <> exists(
      select 1 from jsonb_array_elements(p_payload->'stamps') s
      where s->>'itineraryItemId'=i->>'id')
  ) then raise exception 'Restore visited flags and stamps are inconsistent'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'photos') p
    where not exists(select 1 from jsonb_array_elements(p_payload->'stamps') s where s->>'id'=p->>'stampId')
       or p->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
       or p->>'mimeType' not in ('image/jpeg','image/png','image/webp')
       or (p->>'size')::bigint not between 1 and 52428800
       or (p->>'width')::integer <= 0 or (p->>'height')::integer <= 0
       or not (
         p->>'storagePath' = p_trip_id::text || '/' || (p->>'id') || '.' ||
           case p->>'mimeType' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end
         or (
           left(p->>'storagePath',length(p_trip_id::text || '/' || (p->>'id') || '-'))
             = p_trip_id::text || '/' || (p->>'id') || '-'
           and substring(p->>'storagePath' from length(p_trip_id::text || '/' || (p->>'id') || '-')+1)
             ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.' ||
               case p->>'mimeType' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end || '$')
         )
       )
  ) or exists (
    select 1 from jsonb_array_elements(p_payload->'photos') p
    group by p->>'stampId' having count(*) > 1
  ) then raise exception 'Restore contains invalid photo references or paths'; end if;
  if (select count(*) from jsonb_array_elements(p_payload->'rateSets') r
      where coalesce((r->>'active')::boolean,false)) > 1 then
    raise exception 'Restore contains multiple active rate sets';
  end if;

  select array_agg(object_path order by object_path) into v_old_paths
    from public.photos where trip_id = p_trip_id;

  delete from public.photos where trip_id=p_trip_id;
  delete from public.travel_stamps where trip_id=p_trip_id;
  delete from public.expenses where trip_id=p_trip_id;
  delete from public.itinerary_items where trip_id=p_trip_id;
  delete from public.activity_template_stops where trip_id=p_trip_id;
  delete from public.activity_templates where trip_id=p_trip_id;
  delete from public.places where trip_id=p_trip_id;
  delete from public.itinerary_days where trip_id=p_trip_id;
  delete from public.checklist_items where trip_id=p_trip_id;
  delete from public.rate_sets where trip_id=p_trip_id;
  delete from public.notebook_metadata where trip_id=p_trip_id;

  update public.trips set
    destination=trim(v_trip->>'destination'),
    travellers=(v_trip->>'travellers')::integer,
    start_date=(v_trip->>'startDate')::date,
    end_date=(v_trip->>'endDate')::date,
    timezone=v_trip->>'timezone',
    notes=coalesce(v_trip->>'notes','')
  where id=p_trip_id;

  for v_row in select value from jsonb_array_elements(p_payload->'checklist') loop
    insert into public.checklist_items(id,trip_id,title,category,due_date,completed,note,created_by,updated_by,created_at)
    values(v_row->>'id',p_trip_id,trim(v_row->>'title'),trim(v_row->>'category'),nullif(v_row->>'dueDate','')::date,
      (v_row->>'completed')::boolean,nullif(v_row->>'note',''),auth.uid(),auth.uid(),coalesce((v_row->>'createdAt')::timestamptz,now()));
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'days') loop
    insert into public.itinerary_days(id,trip_id,day_date,out_of_range,created_by,updated_by)
    values(v_row->>'id',p_trip_id,(v_row->>'date')::date,(v_row->>'outOfRange')::boolean,auth.uid(),auth.uid());
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'places') loop
    insert into public.places(id,trip_id,name,address,notes,google_maps_url,want_to_visit,seeded,created_by,updated_by,created_at)
    values(v_row->>'id',p_trip_id,trim(v_row->>'name'),nullif(v_row->>'address',''),nullif(v_row->>'notes',''),
      nullif(v_row->>'googleMapsUrl',''),(v_row->>'wantToVisit')::boolean,coalesce((v_row->>'seeded')::boolean,false),
      auth.uid(),auth.uid(),coalesce((v_row->>'createdAt')::timestamptz,now()));
  end loop;
  for v_template in select value from jsonb_array_elements(p_payload->'activityTemplates') loop
    insert into public.activity_templates(id,trip_id,name,description,seeded,created_by,updated_by,created_at)
    values(v_template->>'id',p_trip_id,trim(v_template->>'name'),coalesce(v_template->>'description',''),
      coalesce((v_template->>'seeded')::boolean,false),auth.uid(),auth.uid(),coalesce((v_template->>'createdAt')::timestamptz,now()));
    v_position:=0;
    for v_stop in select value from jsonb_array_elements(v_template->'stops') loop
      insert into public.activity_template_stops(
        id,trip_id,template_id,place_id,place_name,notes,approximate_minutes,optional,position,created_by,updated_by
      ) values(v_stop->>'id',p_trip_id,v_template->>'id',nullif(v_stop->>'placeId',''),trim(v_stop->>'placeName'),
        array(select jsonb_array_elements_text(coalesce(v_stop->'notes','[]'::jsonb))),
        nullif(v_stop->>'approximateMinutes','')::integer,coalesce((v_stop->>'optional')::boolean,false),
        v_position,auth.uid(),auth.uid());
      v_position:=v_position+1;
    end loop;
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'rateSets') loop
    insert into public.rate_sets(
      id,trip_id,label,effective_date,kes_per_kes,kes_per_usd,kes_per_zar,active,example,created_by,updated_by,created_at
    ) values(v_row->>'id',p_trip_id,trim(v_row->>'label'),(v_row->>'effectiveDate')::date,
      (v_row->>'kesPerKes')::numeric,(v_row->>'kesPerUsd')::numeric,(v_row->>'kesPerZar')::numeric,
      (v_row->>'active')::boolean,(v_row->>'example')::boolean,auth.uid(),auth.uid(),
      coalesce((v_row->>'createdAt')::timestamptz,now()));
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'items') i where not (i.value ? 'parentId') loop
    insert into public.itinerary_items(
      id,trip_id,day_id,place_id,parent_id,template_id,is_activity_group,item_time,notes,booking_status,visited,position,created_by,updated_by,created_at
    ) values(v_row->>'id',p_trip_id,v_row->>'dayId',v_row->>'placeId',null,nullif(v_row->>'templateId',''),
      coalesce((v_row->>'isActivityGroup')::boolean,false),nullif(v_row->>'time','')::time,nullif(v_row->>'notes',''),
      nullif(v_row->>'bookingStatus','')::public.booking_status,(v_row->>'visited')::boolean,(v_row->>'position')::bigint,
      auth.uid(),auth.uid(),coalesce((v_row->>'createdAt')::timestamptz,now()));
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'items') i where i.value ? 'parentId' loop
    insert into public.itinerary_items(
      id,trip_id,day_id,place_id,parent_id,template_id,is_activity_group,item_time,notes,booking_status,visited,position,created_by,updated_by,created_at
    ) values(v_row->>'id',p_trip_id,v_row->>'dayId',v_row->>'placeId',v_row->>'parentId',nullif(v_row->>'templateId',''),
      coalesce((v_row->>'isActivityGroup')::boolean,false),nullif(v_row->>'time','')::time,nullif(v_row->>'notes',''),
      nullif(v_row->>'bookingStatus','')::public.booking_status,(v_row->>'visited')::boolean,(v_row->>'position')::bigint,
      auth.uid(),auth.uid(),coalesce((v_row->>'createdAt')::timestamptz,now()));
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'expenses') loop
    insert into public.expenses(
      id,trip_id,amount,currency,expense_date,category,note,recorded_rate_set_id,
      recorded_rate_label,recorded_rate_effective_date,recorded_kes_per_kes,recorded_kes_per_usd,recorded_kes_per_zar,
      itinerary_item_id,created_by,updated_by,created_at
    ) values(v_row->>'id',p_trip_id,(v_row->>'amount')::numeric,(v_row->>'currency')::public.expense_currency,
      (v_row->>'date')::date,trim(v_row->>'category'),nullif(v_row->>'note',''),nullif(v_row->>'rateSetId',''),
      null,null,null,null,null,nullif(v_row->>'itineraryItemId',''),auth.uid(),auth.uid(),
      coalesce((v_row->>'createdAt')::timestamptz,now()));
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'stamps') loop
    insert into public.travel_stamps(
      id,trip_id,itinerary_item_id,place_name,visit_date,detached,created_by,updated_by,created_at
    ) values(v_row->>'id',p_trip_id,nullif(v_row->>'itineraryItemId',''),trim(v_row->>'placeName'),
      (v_row->>'visitDate')::date,(v_row->>'detached')::boolean,auth.uid(),auth.uid(),
      coalesce((v_row->>'createdAt')::timestamptz,now()));
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'photos') loop
    insert into public.photos(
      id,trip_id,stamp_id,caption,mime_type,width,height,byte_size,object_path,uploaded_by,
      created_by,updated_by,created_at
    ) values(v_row->>'id',p_trip_id,v_row->>'stampId',coalesce(v_row->>'caption',''),v_row->>'mimeType',
      (v_row->>'width')::integer,(v_row->>'height')::integer,(v_row->>'size')::bigint,v_row->>'storagePath',
      auth.uid(),auth.uid(),auth.uid(),coalesce((v_row->>'createdAt')::timestamptz,now()));
  end loop;
  for v_row in select value from jsonb_array_elements(p_payload->'metadata') loop
    insert into public.notebook_metadata(trip_id,key,value,created_by,updated_by)
    values(p_trip_id,v_row->>'key',v_row->>'value',auth.uid(),auth.uid());
  end loop;

  return jsonb_build_object(
    'ok',true,'operation','notebook.restore','objectPaths',coalesce(to_jsonb(v_old_paths),'[]'::jsonb),
    'counts',jsonb_build_object(
      'checklist',jsonb_array_length(p_payload->'checklist'),
      'days',jsonb_array_length(p_payload->'days'),
      'items',jsonb_array_length(p_payload->'items'),
      'places',jsonb_array_length(p_payload->'places'),
      'activityTemplates',jsonb_array_length(p_payload->'activityTemplates'),
      'activityTemplateStops',coalesce((
        select sum(jsonb_array_length(t->'stops'))
        from jsonb_array_elements(p_payload->'activityTemplates') t
      ),0),
      'expenses',jsonb_array_length(p_payload->'expenses'),
      'stamps',jsonb_array_length(p_payload->'stamps'),
      'photos',jsonb_array_length(p_payload->'photos'),
      'rateSets',jsonb_array_length(p_payload->'rateSets'),
      'metadata',jsonb_array_length(p_payload->'metadata')
    )
  );
end $$;

revoke all on function public.restore_notebook_v1(uuid,jsonb) from public;
grant execute on function public.restore_notebook_v1(uuid,jsonb) to authenticated;
