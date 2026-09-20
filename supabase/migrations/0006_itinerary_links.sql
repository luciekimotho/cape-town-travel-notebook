-- Apply after 0004_stamp_designs.sql. Adds one optional, provider-restricted
-- link per itinerary item while preserving old RPC names for cached clients.
begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'itinerary_items' and column_name = 'link_url'
  ) then raise exception '0006_itinerary_links.sql is already applied; do not run it again'; end if;
  if to_regprocedure('public.mutate_notebook_v2(uuid,text,jsonb)') is null
     or to_regprocedure('public.load_notebook_v5(uuid)') is null
     or to_regprocedure('public.restore_notebook_v2(uuid,jsonb)') is null
  then raise exception 'Apply 0004_stamp_designs.sql before 0006_itinerary_links.sql'; end if;
end $$;

alter function public.mutate_notebook_v2(uuid,text,jsonb) rename to mutate_notebook_without_item_links;
alter function public.load_notebook_v5(uuid) rename to load_notebook_without_item_links;
alter function public.restore_notebook_v2(uuid,jsonb) rename to restore_notebook_without_item_links;
revoke all on function public.mutate_notebook_without_item_links(uuid,text,jsonb) from public, authenticated;
revoke all on function public.load_notebook_without_item_links(uuid) from public, authenticated;
revoke all on function public.restore_notebook_without_item_links(uuid,jsonb) from public, authenticated;

alter table public.itinerary_items add column link_url text;
alter table public.itinerary_items add constraint itinerary_link_provider check (
  link_url is null or (
    length(link_url) <= 2000
    and (
      link_url ~ '^https://(www\.)?getyourguide\.com/'
      or link_url ~ '^https://maps\.google\.com/'
      or link_url ~ '^https://maps\.app\.goo\.gl/'
      or link_url ~ '^https://goo\.gl/maps/'
      or link_url ~ '^https://(www\.)?google\.[A-Za-z.]+/maps/'
    )
  )
);

create function public.validate_itinerary_link(p_link text)
returns void language plpgsql immutable set search_path = ''
as $$
begin
  if p_link is null then return; end if;
  if length(p_link) > 2000 or not (
    p_link ~ '^https://(www\.)?getyourguide\.com/'
    or p_link ~ '^https://maps\.google\.com/'
    or p_link ~ '^https://maps\.app\.goo\.gl/'
    or p_link ~ '^https://goo\.gl/maps/'
    or p_link ~ '^https://(www\.)?google\.[A-Za-z.]+/maps/'
  ) then raise exception 'Use an HTTPS GetYourGuide or Google Maps link'; end if;
end $$;
revoke all on function public.validate_itinerary_link(text) from public;

create function public.mutate_notebook_v3(
  p_trip_id uuid, p_operation text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
  item_id text;
  value text;
begin
  if auth.uid() is null or public.can_edit_trip(p_trip_id) is not true then
    raise exception 'Trip membership with edit access is required';
  end if;
  if p_operation = 'place.schedule' and p_payload->'itemPatch' ? 'linkUrl' then
    value := nullif(p_payload#>>'{itemPatch,linkUrl}', '');
  elsif p_operation = 'itinerary.create' and p_payload->'item' ? 'linkUrl' then
    value := nullif(p_payload#>>'{item,linkUrl}', '');
  elsif p_operation = 'itinerary.update' and p_payload->'patch' ? 'linkUrl' then
    value := nullif(p_payload#>>'{patch,linkUrl}', '');
  elsif p_operation = 'template.materialize' and p_payload->'details' ? 'linkUrl' then
    value := nullif(p_payload#>>'{details,linkUrl}', '');
  end if;
  if value is not null then perform public.validate_itinerary_link(value); end if;

  result := public.mutate_notebook_without_item_links(p_trip_id, p_operation, p_payload);
  item_id := result->>'id';
  if p_operation = 'place.schedule' and p_payload->'itemPatch' ? 'linkUrl' then
    update public.itinerary_items set link_url = value
      where trip_id = p_trip_id and id = item_id;
  elsif p_operation = 'itinerary.create' and p_payload->'item' ? 'linkUrl' then
    update public.itinerary_items set link_url = value
      where trip_id = p_trip_id and id = item_id;
  elsif p_operation = 'itinerary.update' and p_payload->'patch' ? 'linkUrl' then
    update public.itinerary_items set link_url = value
      where trip_id = p_trip_id and id = p_payload->>'id';
  elsif p_operation = 'template.materialize' and p_payload->'details' ? 'linkUrl' then
    update public.itinerary_items set link_url = value
      where trip_id = p_trip_id and id = item_id;
  end if;
  return result;
end $$;
revoke all on function public.mutate_notebook_v3(uuid,text,jsonb) from public;
grant execute on function public.mutate_notebook_v3(uuid,text,jsonb) to authenticated;

create function public.load_notebook_v6(p_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  notebook jsonb;
  enriched jsonb;
begin
  if auth.uid() is null or public.is_trip_member(p_trip_id) is not true then return null; end if;
  notebook := public.load_notebook_without_item_links(p_trip_id);
  if notebook is null then return null; end if;
  select coalesce(jsonb_agg(
    e.row || case when i.link_url is null then '{}'::jsonb
      else jsonb_build_object('linkUrl', i.link_url) end order by e.ordinality
  ), '[]'::jsonb) into enriched
  from jsonb_array_elements(notebook->'items') with ordinality e(row, ordinality)
  left join public.itinerary_items i
    on i.trip_id = p_trip_id and i.id = e.row->>'id';
  return jsonb_set(notebook, '{items}', enriched);
end $$;
revoke all on function public.load_notebook_v6(uuid) from public;
grant execute on function public.load_notebook_v6(uuid) to authenticated;

create function public.restore_notebook_v3(p_trip_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
  record jsonb;
begin
  if auth.uid() is null or public.is_trip_owner(p_trip_id) is not true then
    raise exception 'Only a trip owner may restore a notebook';
  end if;
  for record in select value from jsonb_array_elements(p_payload->'items') loop
    if record ? 'linkUrl' then perform public.validate_itinerary_link(nullif(record->>'linkUrl', '')); end if;
  end loop;
  result := public.restore_notebook_without_item_links(p_trip_id, p_payload);
  update public.itinerary_items i set link_url = nullif(r.row->>'linkUrl', '')
    from jsonb_array_elements(p_payload->'items') r(row)
    where i.trip_id = p_trip_id and i.id = r.row->>'id';
  return result;
end $$;
revoke all on function public.restore_notebook_v3(uuid,jsonb) from public;
grant execute on function public.restore_notebook_v3(uuid,jsonb) to authenticated;

-- Preserve deployed/cached client RPC names.
create function public.mutate_notebook_v2(
  p_trip_id uuid, p_operation text, p_payload jsonb default '{}'::jsonb
) returns jsonb language sql security invoker set search_path = ''
as $$ select public.mutate_notebook_v3(p_trip_id, p_operation, p_payload) $$;
create function public.load_notebook_v5(p_trip_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select public.load_notebook_v6(p_trip_id) $$;
create function public.restore_notebook_v2(p_trip_id uuid, p_payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select public.restore_notebook_v3(p_trip_id, p_payload) $$;
revoke all on function public.mutate_notebook_v2(uuid,text,jsonb) from public;
revoke all on function public.load_notebook_v5(uuid) from public;
revoke all on function public.restore_notebook_v2(uuid,jsonb) from public;
grant execute on function public.mutate_notebook_v2(uuid,text,jsonb) to authenticated;
grant execute on function public.load_notebook_v5(uuid) to authenticated;
grant execute on function public.restore_notebook_v2(uuid,jsonb) to authenticated;

commit;
