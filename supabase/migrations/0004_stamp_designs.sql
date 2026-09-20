-- Apply after 0001, 0002 and 0003. Paste the complete file into SQL Editor.
-- Optional designs extend backup schema 4; RPC versions require this migration
-- rather than letting an older server silently discard a user's choice.
begin;

do $$
begin
  if to_regtype('public.stamp_design') is not null then
    raise exception '0004_stamp_designs.sql is already applied; do not run it again';
  end if;
  if strpos(pg_get_functiondef('public.mutate_notebook_v1(uuid,text,jsonb)'::regprocedure),
    'set constraints public.itinerary_parent_guard deferred;') = 0 then
    raise exception 'Apply 0003_fix_itinerary_edit.sql before 0004_stamp_designs.sql';
  end if;
end $$;

alter function public.mutate_notebook_v1(uuid,text,jsonb) rename to mutate_notebook_without_stamp_designs;
alter function public.restore_notebook_v1(uuid,jsonb) rename to restore_notebook_without_stamp_designs;
alter function public.load_notebook_v4(uuid) rename to load_notebook_without_stamp_designs;
revoke all on function public.mutate_notebook_without_stamp_designs(uuid,text,jsonb) from public, authenticated;
revoke all on function public.restore_notebook_without_stamp_designs(uuid,jsonb) from public, authenticated;
revoke all on function public.load_notebook_without_stamp_designs(uuid) from public, authenticated;
revoke all on function public.load_notebook_v4_without_storage_path(uuid) from public, authenticated;

create domain public.stamp_design as text check (value in (
  'auto','mountain','penguin','house','cape','lighthouse','road',
  'boat','huts','promenade','wine','cliff','pin'
));
alter table public.places add column stamp_kind public.stamp_design;
alter table public.itinerary_items add column stamp_kind public.stamp_design;
alter table public.activity_templates add column stamp_kind public.stamp_design;
alter table public.travel_stamps add column stamp_kind public.stamp_design;

create function public.validate_stamp_design_record(p_record jsonb)
returns void language plpgsql immutable set search_path = ''
as $$
begin
  if p_record ? 'stampKind' and (
    jsonb_typeof(p_record->'stampKind') <> 'string'
    or p_record->>'stampKind' not in (
      'auto','mountain','penguin','house','cape','lighthouse','road',
      'boat','huts','promenade','wine','cliff','pin'
    )
  ) then raise exception 'Invalid stamp design'; end if;
end $$;
revoke all on function public.validate_stamp_design_record(jsonb) from public;

create function public.refresh_live_stamp_designs()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_table_name = 'places' then
    update public.travel_stamps s
      set stamp_kind = coalesce(i.stamp_kind, new.stamp_kind, 'auto')
      from public.itinerary_items i
      where i.trip_id = new.trip_id and i.place_id = new.id
        and s.trip_id = i.trip_id and s.itinerary_item_id = i.id and not s.detached;
  else
    update public.travel_stamps s
      set stamp_kind = coalesce(new.stamp_kind, p.stamp_kind, 'auto')
      from public.places p
      where p.trip_id = new.trip_id and p.id = new.place_id
        and s.trip_id = new.trip_id and s.itinerary_item_id = new.id and not s.detached;
  end if;
  return new;
end $$;
create trigger places_refresh_stamp_design after update of stamp_kind on public.places
for each row execute function public.refresh_live_stamp_designs();
create trigger items_refresh_stamp_design after update of stamp_kind, place_id on public.itinerary_items
for each row execute function public.refresh_live_stamp_designs();

create or replace function public.detach_item_memories()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  update public.travel_stamps
    set stamp_kind = coalesce(old.stamp_kind,
      (select p.stamp_kind from public.places p where p.trip_id = old.trip_id and p.id = old.place_id), 'auto'),
      itinerary_item_id = null, detached = true
    where trip_id = old.trip_id and itinerary_item_id = old.id;
  return old;
end $$;

create function public.mutate_notebook_v2(
  p_trip_id uuid, p_operation text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
  record jsonb;
  item_id text;
  place_id text;
  template_design public.stamp_design;
  source_design public.stamp_design;
begin
  if auth.uid() is null or public.can_edit_trip(p_trip_id) is not true then
    raise exception 'Trip membership with edit access is required';
  end if;
  perform 1 from public.trips where id = p_trip_id for update;
  for record in select value from jsonb_each(p_payload)
    where key in ('place','item','patch','placePatch','itemPatch','details')
  loop
    perform public.validate_stamp_design_record(record);
  end loop;
  if p_operation = 'template.materialize' then
    select stamp_kind into template_design from public.activity_templates
      where trip_id = p_trip_id and id = p_payload->>'templateId';
    select p.stamp_kind into source_design
      from public.activity_template_stops s join public.places p
        on p.trip_id = s.trip_id and
          (p.id = s.place_id or (s.place_id is null and p.name = s.place_name))
      where s.trip_id = p_trip_id and s.template_id = p_payload->>'templateId'
      order by s.position limit 1;
  end if;

  result := public.mutate_notebook_without_stamp_designs(p_trip_id, p_operation, p_payload);
  item_id := result->>'id';
  if p_operation in ('place.create','itinerary.create') then
    update public.places set stamp_kind = (p_payload#>>'{place,stampKind}')::public.stamp_design
      where trip_id = p_trip_id and id = p_payload#>>'{place,id}';
  end if;
  if p_operation = 'place.update' and p_payload->'patch' ? 'stampKind' then
    update public.places set stamp_kind = (p_payload#>>'{patch,stampKind}')::public.stamp_design
      where trip_id = p_trip_id and id = p_payload->>'id';
  elsif p_operation = 'place.schedule' then
    if p_payload->'placePatch' ? 'stampKind' then
      update public.places set stamp_kind = (p_payload#>>'{placePatch,stampKind}')::public.stamp_design
        where trip_id = p_trip_id and id = p_payload->>'placeId';
    end if;
    update public.itinerary_items set stamp_kind = (p_payload#>>'{itemPatch,stampKind}')::public.stamp_design
      where trip_id = p_trip_id and id = item_id;
  elsif p_operation = 'itinerary.create' then
    update public.itinerary_items set stamp_kind = (p_payload#>>'{item,stampKind}')::public.stamp_design
      where trip_id = p_trip_id and id = item_id;
  elsif p_operation = 'itinerary.update' and p_payload->'patch' ? 'stampKind' then
    update public.itinerary_items set stamp_kind = (p_payload#>>'{patch,stampKind}')::public.stamp_design
      where trip_id = p_trip_id and id = p_payload->>'id';
  elsif p_operation = 'template.update' and p_payload->'patch' ? 'stampKind' then
    update public.activity_templates set stamp_kind = (p_payload#>>'{patch,stampKind}')::public.stamp_design
      where trip_id = p_trip_id and id = p_payload->>'id';
  elsif p_operation = 'template.materialize' then
    update public.itinerary_items
      set stamp_kind = coalesce((p_payload#>>'{details,stampKind}')::public.stamp_design, template_design)
      where trip_id = p_trip_id and id = item_id;
    -- The existing RPC may clone a single stop's place to customize its name.
    -- Carry the source place's preference, not the template's group design.
    if (select count(*) from public.activity_template_stops
      where trip_id = p_trip_id and template_id = p_payload->>'templateId') = 1 then
      select i.place_id into place_id from public.itinerary_items i
        where i.trip_id = p_trip_id and i.id = item_id;
      update public.places p set stamp_kind = source_design
        where p.trip_id = p_trip_id and p.id = place_id
          and p.stamp_kind is distinct from source_design;
    end if;
  elsif p_operation = 'stamp.create' then
    update public.travel_stamps s set stamp_kind = coalesce(i.stamp_kind, p.stamp_kind, 'auto')
      from public.itinerary_items i join public.places p
        on p.trip_id = i.trip_id and p.id = i.place_id
      where i.trip_id = p_trip_id and i.id = p_payload->>'itemId'
        and s.trip_id = p_trip_id and s.id = item_id;
  end if;
  return result;
end $$;
revoke all on function public.mutate_notebook_v2(uuid,text,jsonb) from public;
grant execute on function public.mutate_notebook_v2(uuid,text,jsonb) to authenticated;

-- Preserve both existing read layers, including opaque private photo paths.
create function public.load_notebook_v5(p_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  notebook jsonb;
  v_collection text;
  enriched jsonb;
begin
  if auth.uid() is null or public.is_trip_member(p_trip_id) is not true then return null; end if;
  notebook := public.load_notebook_without_stamp_designs(p_trip_id);
  if notebook is null then return null; end if;
  foreach v_collection in array array['places','items','activityTemplates','stamps'] loop
    select coalesce(jsonb_agg(
      e.row || case when d.stamp_kind is null then '{}'::jsonb
        else jsonb_build_object('stampKind', d.stamp_kind) end order by e.ordinality
    ), '[]'::jsonb) into enriched
    from jsonb_array_elements(notebook->v_collection) with ordinality e(row, ordinality)
    left join (
      select 'places' as collection, id, stamp_kind from public.places where trip_id = p_trip_id
      union all select 'items', id, stamp_kind from public.itinerary_items where trip_id = p_trip_id
      union all select 'activityTemplates', id, stamp_kind from public.activity_templates where trip_id = p_trip_id
      union all select 'stamps', id, stamp_kind from public.travel_stamps where trip_id = p_trip_id
    ) d on d.collection = v_collection and d.id = e.row->>'id';
    notebook := jsonb_set(notebook, array[v_collection], enriched);
  end loop;
  return notebook;
end $$;
revoke all on function public.load_notebook_v5(uuid) from public;
grant execute on function public.load_notebook_v5(uuid) to authenticated;

create function public.restore_notebook_v2(p_trip_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
  collection text;
  record jsonb;
begin
  if auth.uid() is null or public.is_trip_owner(p_trip_id) is not true then
    raise exception 'Only a trip owner may restore a notebook';
  end if;
  foreach collection in array array['places','items','activityTemplates','stamps'] loop
    for record in select value from jsonb_array_elements(p_payload->collection) loop
      perform public.validate_stamp_design_record(record);
    end loop;
  end loop;
  result := public.restore_notebook_without_stamp_designs(p_trip_id, p_payload);
  update public.places p set stamp_kind = (r.row->>'stampKind')::public.stamp_design
    from jsonb_array_elements(p_payload->'places') r(row)
    where p.trip_id = p_trip_id and p.id = r.row->>'id';
  update public.itinerary_items i set stamp_kind = (r.row->>'stampKind')::public.stamp_design
    from jsonb_array_elements(p_payload->'items') r(row)
    where i.trip_id = p_trip_id and i.id = r.row->>'id';
  update public.activity_templates t set stamp_kind = (r.row->>'stampKind')::public.stamp_design
    from jsonb_array_elements(p_payload->'activityTemplates') r(row)
    where t.trip_id = p_trip_id and t.id = r.row->>'id';
  -- Restore snapshots last, after live-refresh triggers, including legacy omission.
  update public.travel_stamps s set stamp_kind = (r.row->>'stampKind')::public.stamp_design
    from jsonb_array_elements(p_payload->'stamps') r(row)
    where s.trip_id = p_trip_id and s.id = r.row->>'id';
  return result;
end $$;
revoke all on function public.restore_notebook_v2(uuid,jsonb) from public;
grant execute on function public.restore_notebook_v2(uuid,jsonb) to authenticated;
-- Cached/deployed clients retain their RPC names, with the same validation and
-- snapshot semantics as new clients. Implementations never call these aliases.
create function public.mutate_notebook_v1(
  p_trip_id uuid, p_operation text, p_payload jsonb default '{}'::jsonb
) returns jsonb language sql security invoker set search_path = ''
as $$ select public.mutate_notebook_v2(p_trip_id, p_operation, p_payload) $$;
create function public.restore_notebook_v1(p_trip_id uuid, p_payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select public.restore_notebook_v2(p_trip_id, p_payload) $$;
create function public.load_notebook_v4(p_trip_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select public.load_notebook_v5(p_trip_id) $$;
revoke all on function public.mutate_notebook_v1(uuid,text,jsonb) from public;
revoke all on function public.restore_notebook_v1(uuid,jsonb) from public;
revoke all on function public.load_notebook_v4(uuid) from public;
grant execute on function public.mutate_notebook_v1(uuid,text,jsonb) to authenticated;
grant execute on function public.restore_notebook_v1(uuid,jsonb) to authenticated;
grant execute on function public.load_notebook_v4(uuid) to authenticated;
commit;
