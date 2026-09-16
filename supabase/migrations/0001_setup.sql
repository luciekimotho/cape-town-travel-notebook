-- Cape Town Travel Notebook: complete Supabase setup.
--
-- Contents (in dependency order):
--   1. Core extensions, enums, tables, constraints, and runtime triggers
--   2. Authentication profiles and two-person membership helpers
--   3. Exact-email sharing and Cape Town 2026 owner bootstrap RPCs
--   4. Row-level security, grants, list/load RPCs, and private photo Storage
--
-- Run this first-run setup as one migration after confirming the target project.

-- Cape Town Travel Notebook: core schema and runtime domain integrity.
-- Apply through the Supabase migration runner only after confirming the target project.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

do $$ begin
  create type public.trip_member_role as enum ('owner', 'editor');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.booking_status as enum ('Idea', 'To book', 'Booked', 'Confirmed', 'Cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.expense_currency as enum ('KES', 'USD', 'ZAR');
exception when duplicate_object then null; end $$;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  destination text not null check (length(trim(destination)) between 1 and 200),
  travellers integer not null default 1 check (travellers between 1 and 100),
  start_date date not null,
  end_date date not null,
  timezone text not null default 'UTC' check (length(timezone) between 1 and 100),
  notes text not null default '',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_date_order check (end_date >= start_date)
);

create or replace function public.set_audit_fields()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := coalesce(new.created_at, now());
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

create trigger trips_audit before insert or update on public.trips
for each row execute function public.set_audit_fields();

create table if not exists public.checklist_items (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  category text not null check (length(trim(category)) between 1 and 100),
  due_date date,
  completed boolean not null default false,
  note text,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, id)
);

create table if not exists public.itinerary_days (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  out_of_range boolean not null default false,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, id),
  unique (trip_id, day_date)
);

create table if not exists public.places (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 300),
  address text,
  notes text,
  google_maps_url text,
  want_to_visit boolean not null default false,
  seeded boolean not null default false,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, id)
);

create table if not exists public.activity_templates (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 300),
  description text not null default '',
  seeded boolean not null default false,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, id)
);

create table if not exists public.activity_template_stops (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null,
  template_id text not null,
  place_id text,
  place_name text not null check (length(trim(place_name)) between 1 and 300),
  notes text[] not null default '{}',
  approximate_minutes integer check (approximate_minutes is null or approximate_minutes > 0),
  optional boolean not null default false,
  position integer not null check (position >= 0),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, template_id, id),
  unique (trip_id, template_id, position),
  foreign key (trip_id, template_id) references public.activity_templates(trip_id, id) on delete cascade,
  foreign key (trip_id, place_id) references public.places(trip_id, id) on delete set null (place_id)
);

create table if not exists public.itinerary_items (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null,
  day_id text not null,
  place_id text not null,
  parent_id text,
  template_id text,
  is_activity_group boolean not null default false,
  item_time time,
  notes text,
  booking_status public.booking_status,
  visited boolean not null default false,
  position bigint not null default 0,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, id),
  foreign key (trip_id, day_id) references public.itinerary_days(trip_id, id) on delete cascade,
  foreign key (trip_id, place_id) references public.places(trip_id, id) on delete restrict,
  foreign key (trip_id, parent_id) references public.itinerary_items(trip_id, id) on delete cascade,
  foreign key (trip_id, template_id) references public.activity_templates(trip_id, id) on delete set null (template_id),
  constraint itinerary_not_own_parent check (parent_id is null or parent_id <> id)
);
create index if not exists itinerary_items_day_position_idx
  on public.itinerary_items(trip_id, day_id, parent_id, position);

create or replace function public.check_itinerary_parent()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare parent_day text; parent_parent text;
begin
  if new.parent_id is null then return new; end if;
  select day_id, parent_id into parent_day, parent_parent
    from public.itinerary_items where trip_id = new.trip_id and id = new.parent_id;
  if not found then raise exception 'Parent itinerary item does not exist in this trip'; end if;
  if parent_day <> new.day_id then raise exception 'A child must be on the same day as its parent'; end if;
  if parent_parent is not null then raise exception 'Itinerary nesting is limited to one child level'; end if;
  if exists (select 1 from public.itinerary_items where trip_id = new.trip_id and parent_id = new.id)
  then raise exception 'An item with children cannot become a child'; end if;
  return new;
end $$;
create constraint trigger itinerary_parent_guard
after insert or update of trip_id, day_id, parent_id on public.itinerary_items
deferrable initially immediate for each row execute function public.check_itinerary_parent();

create table if not exists public.rate_sets (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null references public.trips(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 200),
  effective_date date not null,
  kes_per_kes numeric(20,10) not null default 1 check (kes_per_kes = 1),
  kes_per_usd numeric(20,10) not null check (kes_per_usd > 0),
  kes_per_zar numeric(20,10) not null check (kes_per_zar > 0),
  active boolean not null default false,
  example boolean not null default false,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, id)
);
create unique index if not exists rate_sets_one_active_idx on public.rate_sets(trip_id) where active;

create table if not exists public.expenses (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null references public.trips(id) on delete cascade,
  amount numeric(20,2) not null check (amount > 0),
  currency public.expense_currency not null,
  expense_date date not null,
  category text not null check (length(trim(category)) between 1 and 100),
  note text,
  recorded_rate_set_id text,
  recorded_rate_label text not null,
  recorded_rate_effective_date date not null,
  recorded_kes_per_kes numeric(20,10) not null check (recorded_kes_per_kes = 1),
  recorded_kes_per_usd numeric(20,10) not null check (recorded_kes_per_usd > 0),
  recorded_kes_per_zar numeric(20,10) not null check (recorded_kes_per_zar > 0),
  itinerary_item_id text,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, id),
  foreign key (trip_id, recorded_rate_set_id) references public.rate_sets(trip_id, id) on delete restrict,
  foreign key (trip_id, itinerary_item_id) references public.itinerary_items(trip_id, id) on delete set null (itinerary_item_id)
);
create unique index if not exists expenses_one_per_itinerary_item_idx
  on public.expenses(trip_id, itinerary_item_id) where itinerary_item_id is not null;

create or replace function public.capture_expense_rate()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare rate public.rate_sets%rowtype;
begin
  if tg_op = 'UPDATE' then
    if (new.recorded_rate_set_id, new.recorded_rate_label, new.recorded_rate_effective_date,
        new.recorded_kes_per_kes, new.recorded_kes_per_usd, new.recorded_kes_per_zar)
       is distinct from
       (old.recorded_rate_set_id, old.recorded_rate_label, old.recorded_rate_effective_date,
        old.recorded_kes_per_kes, old.recorded_kes_per_usd, old.recorded_kes_per_zar)
    then raise exception 'An expense recorded-rate snapshot is immutable'; end if;
    return new;
  end if;
  if new.recorded_rate_set_id is not null then
    select * into rate from public.rate_sets
      where trip_id = new.trip_id and id = new.recorded_rate_set_id;
  else
    select * into rate from public.rate_sets
      where trip_id = new.trip_id and active order by effective_date desc limit 1;
  end if;
  if found then
    new.recorded_rate_set_id := rate.id;
    new.recorded_rate_label := rate.label;
    new.recorded_rate_effective_date := rate.effective_date;
    new.recorded_kes_per_kes := rate.kes_per_kes;
    new.recorded_kes_per_usd := rate.kes_per_usd;
    new.recorded_kes_per_zar := rate.kes_per_zar;
  elsif new.recorded_rate_label is null or new.recorded_rate_effective_date is null
     or new.recorded_kes_per_kes is null or new.recorded_kes_per_usd is null
     or new.recorded_kes_per_zar is null then
    raise exception 'An expense requires a rate set or a complete recorded-rate snapshot';
  end if;
  return new;
end $$;
create trigger expenses_rate_snapshot before insert or update on public.expenses
for each row execute function public.capture_expense_rate();

create table if not exists public.travel_stamps (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null references public.trips(id) on delete cascade,
  itinerary_item_id text,
  place_name text not null check (length(trim(place_name)) between 1 and 300),
  visit_date date not null,
  detached boolean not null default false,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, id),
  foreign key (trip_id, itinerary_item_id) references public.itinerary_items(trip_id, id) on delete set null (itinerary_item_id),
  constraint stamp_detachment_consistent check (detached = (itinerary_item_id is null))
);
create unique index if not exists travel_stamps_one_per_item_idx
  on public.travel_stamps(trip_id, itinerary_item_id) where itinerary_item_id is not null;

create or replace function public.detach_item_memories()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  update public.travel_stamps set itinerary_item_id = null, detached = true
    where trip_id = old.trip_id and itinerary_item_id = old.id;
  return old;
end $$;
create trigger itinerary_detach_memories before delete on public.itinerary_items
for each row execute function public.detach_item_memories();

create table if not exists public.photos (
  id text not null default gen_random_uuid()::text
    check (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' and id not in ('.', '..')),
  trip_id uuid not null,
  stamp_id text not null,
  caption text not null default '',
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 52428800),
  object_path text not null,
  uploaded_by uuid not null references auth.users(id),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, id),
  unique (object_path),
  foreign key (trip_id, stamp_id) references public.travel_stamps(trip_id, id) on delete cascade,
  constraint photo_private_object_path check (
    object_path = trip_id::text || '/' || id::text || '.' ||
      case mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end
  )
);

create table if not exists public.notebook_metadata (
  trip_id uuid not null references public.trips(id) on delete cascade,
  key text not null check (length(key) between 1 and 200),
  value text not null,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, key)
);

-- Apply audit protection consistently to all collaborative domain rows.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'checklist_items','itinerary_days','places','activity_templates',
    'activity_template_stops','itinerary_items','rate_sets','expenses','travel_stamps','photos',
    'notebook_metadata'
  ] loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.set_audit_fields()',
      table_name || '_audit', table_name
    );
  end loop;
end $$;

-- ============================================================================
-- Access, collaboration, bootstrap, RLS, RPC, and Storage layer
-- ============================================================================

-- Cape Town Travel Notebook: authentication, collaboration access, RPCs, and private photos.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or length(trim(display_name)) between 1 and 100),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger auth_user_profile after insert on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.trip_member_role not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index if not exists trip_members_user_id_idx on public.trip_members(user_id, trip_id);

create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.trip_members
  where trip_id = p_trip_id and user_id = auth.uid()
) $$;

create or replace function public.trip_role(p_trip_id uuid)
returns public.trip_member_role language sql stable security definer set search_path = ''
as $$ select role from public.trip_members where trip_id = p_trip_id and user_id = auth.uid() $$;

create or replace function public.can_edit_trip(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.trip_role(p_trip_id) in ('owner'::public.trip_member_role, 'editor'::public.trip_member_role)
$$;

create or replace function public.is_trip_owner(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.trip_role(p_trip_id) = 'owner'::public.trip_member_role $$;

revoke all on function public.is_trip_member(uuid) from public;
revoke all on function public.trip_role(uuid) from public;
revoke all on function public.can_edit_trip(uuid) from public;
revoke all on function public.is_trip_owner(uuid) from public;
grant execute on function public.is_trip_member(uuid), public.trip_role(uuid),
  public.can_edit_trip(uuid), public.is_trip_owner(uuid) to authenticated;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.add_trip_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.trip_members(trip_id, user_id, role, created_by)
  values (new.id, new.created_by, 'owner', new.created_by)
  on conflict (trip_id, user_id) do nothing;
  return new;
end $$;
create trigger trips_add_owner after insert on public.trips
for each row execute function public.add_trip_owner();

create or replace function public.protect_trip_members()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare owner_count integer;
begin
  if tg_op = 'UPDATE' and (new.trip_id, new.user_id) is distinct from (old.trip_id, old.user_id) then
    raise exception 'A membership identity cannot be changed';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner') then
    perform 1 from public.trips where id = old.trip_id for update;
    if not found then return case when tg_op = 'UPDATE' then new else old end; end if;
    select count(*) into owner_count from public.trip_members
      where trip_id = old.trip_id and role = 'owner' and user_id <> old.user_id;
    if owner_count = 0 then raise exception 'A trip must retain at least one owner'; end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by; new.created_at := old.created_at; new.updated_at := now();
    return new;
  end if;
  return old;
end $$;
create trigger trip_members_protect before update or delete on public.trip_members
for each row execute function public.protect_trip_members();

create unique index if not exists trip_members_one_editor_idx
  on public.trip_members(trip_id) where role = 'editor';

create table if not exists public.trip_email_access (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  email extensions.citext not null,
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint trip_email_access_claim_pair check ((claimed_at is null) = (claimed_by is null))
);

create or replace function public.set_photo_uploader()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then new.uploaded_by := auth.uid();
  else new.uploaded_by := old.uploaded_by; new.object_path := old.object_path; end if;
  return new;
end $$;
create trigger photos_uploader before insert or update on public.photos
for each row execute function public.set_photo_uploader();

create or replace function public.storage_metadata_size(p_metadata jsonb)
returns bigint language sql immutable set search_path = ''
as $$
  select coalesce(
    nullif(p_metadata ->> 'size', ''),
    nullif(p_metadata ->> 'contentLength', '')
  )::bigint
$$;

create or replace function public.storage_metadata_mime(p_metadata jsonb)
returns text language sql immutable set search_path = ''
as $$
  select coalesce(
    nullif(p_metadata ->> 'mimetype', ''),
    nullif(p_metadata ->> 'contentType', '')
  )
$$;

create or replace function public.verify_photo_storage_object()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'trip-photos'
      and o.name = new.object_path
      and o.owner_id = new.uploaded_by::text
      and public.storage_metadata_mime(o.metadata) = new.mime_type
      and public.storage_metadata_size(o.metadata) = new.byte_size
  ) then
    raise exception 'Photo metadata requires an exact owned Storage object with matching path, MIME, and size';
  end if;
  return new;
end $$;
create trigger photos_zz_verify_storage before insert or update of object_path, mime_type, byte_size, uploaded_by
on public.photos for each row execute function public.verify_photo_storage_object();

create or replace function public.protect_referenced_photo_object()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare photo public.photos%rowtype;
begin
  if old.bucket_id <> 'trip-photos' then return case when tg_op = 'UPDATE' then new else old end; end if;
  select * into photo from public.photos where object_path = old.name;
  if not found then return case when tg_op = 'UPDATE' then new else old end; end if;
  if tg_op = 'DELETE' then
    raise exception 'Delete photo metadata before deleting its Storage object';
  end if;
  if new.bucket_id is distinct from 'trip-photos'
     or new.name is distinct from photo.object_path
     or new.owner_id is distinct from photo.uploaded_by::text
     or public.storage_metadata_mime(new.metadata) is distinct from photo.mime_type
     or public.storage_metadata_size(new.metadata) is distinct from photo.byte_size then
    raise exception 'Referenced photo object path, owner, MIME, and size must match photo metadata';
  end if;
  return new;
end $$;
create trigger protect_referenced_photo_object before update or delete on storage.objects
for each row execute function public.protect_referenced_photo_object();

create or replace function public.share_trip_with_email(p_trip_id uuid, p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_email extensions.citext;
begin
  if auth.uid() is null or not public.is_trip_owner(p_trip_id) then
    raise exception 'Only a trip owner may share access';
  end if;
  if p_email is null or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid email is required';
  end if;
  v_email := lower(trim(p_email))::extensions.citext;
  perform 1 from public.trips
    where id = p_trip_id
    for update;
  if not found then raise exception 'Trip not found'; end if;
  if exists (
    select 1 from public.trip_members m
    join auth.users u on u.id = m.user_id
    where m.trip_id = p_trip_id and lower(u.email) = v_email::text
  ) then
    raise exception 'That email already belongs to a trip member';
  end if;
  if (select count(*) from public.trip_members where trip_id = p_trip_id) >= 2 then
    raise exception 'A trip may have at most two members';
  end if;
  insert into public.trip_email_access(trip_id, email, created_by)
  values (p_trip_id, v_email, auth.uid())
  on conflict (trip_id) do update set
    email = excluded.email,
    claimed_at = null,
    claimed_by = null,
    created_by = excluded.created_by,
    created_at = now();
end $$;

create or replace function public.revoke_trip_email_access(p_trip_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_trip_owner(p_trip_id) then
    raise exception 'Only a trip owner may revoke pending access';
  end if;
  delete from public.trip_email_access
    where trip_id = p_trip_id and claimed_at is null;
end $$;

create or replace function public.claim_trip_access()
returns setof uuid language plpgsql security definer set search_path = ''
as $$
declare access_row public.trip_email_access%rowtype; verified_email text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  select lower(u.email) into verified_email
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''));
  if verified_email is null then
    raise exception 'A verified authenticated email is required';
  end if;
  for access_row in
    select * from public.trip_email_access
      where email = verified_email::extensions.citext and claimed_at is null
      order by created_at
  loop
    perform 1 from public.trips
      where id = access_row.trip_id
      for update;
    if not found then continue; end if;
    select * into access_row from public.trip_email_access
      where trip_id = access_row.trip_id
        and email = verified_email::extensions.citext
        and claimed_at is null
      for update;
    if not found then continue; end if;
    if exists (
      select 1 from public.trip_members
      where trip_id = access_row.trip_id and user_id = auth.uid()
    ) then
      raise exception 'Authenticated user is already a trip member';
    end if;
    insert into public.trip_members(trip_id, user_id, role, created_by)
      values (access_row.trip_id, auth.uid(), 'editor', access_row.created_by);
    update public.trip_email_access
      set claimed_at = now(), claimed_by = auth.uid()
      where trip_id = access_row.trip_id;
    return next access_row.trip_id;
  end loop;
end $$;
revoke all on function public.share_trip_with_email(uuid, text) from public;
revoke all on function public.revoke_trip_email_access(uuid) from public;
revoke all on function public.claim_trip_access() from public;
grant execute on function public.share_trip_with_email(uuid, text),
  public.revoke_trip_email_access(uuid), public.claim_trip_access() to authenticated;

create or replace function public.create_capetown_2026_trip()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_trip_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  perform pg_advisory_xact_lock(
    hashtextextended(auth.uid()::text || ':capetown-2026-v1', 0)
  );
  select t.id into v_trip_id
    from public.trips t
    join public.trip_members m
      on m.trip_id = t.id and m.user_id = auth.uid() and m.role = 'owner'
    join public.notebook_metadata n
      on n.trip_id = t.id
      and n.key = 'system.bootstrap'
      and n.value = 'capetown-2026-v1'
    limit 1;
  if found then return v_trip_id; end if;

  insert into public.trips(
    destination, travellers, start_date, end_date, timezone, notes, created_by, updated_by
  ) values (
    'Cape Town 2026', 2, '2026-09-21', '2026-09-28',
    'Africa/Johannesburg',
    'Cape Town itinerary for 21–28 September 2026.',
    auth.uid(), auth.uid()
  ) returning id into v_trip_id;

  insert into public.notebook_metadata(trip_id, key, value, created_by, updated_by)
  values (v_trip_id, 'system.bootstrap', 'capetown-2026-v1', auth.uid(), auth.uid());

  insert into public.checklist_items(
    id, trip_id, title, category, completed, created_by, updated_by
  ) values
    ('checklist-pack-rain-layer', v_trip_id, 'Pack light rain layer', 'Planning', false, auth.uid(), auth.uid()),
    ('checklist-travel-documents', v_trip_id, 'Review travel insurance and check passport validity', 'Documents', false, auth.uid(), auth.uid()),
    ('checklist-shopping', v_trip_id, 'Sneakers / Golf stuff / Kids'' clothes', 'Shopping', false, auth.uid(), auth.uid());

  insert into public.itinerary_days(
    id, trip_id, day_date, out_of_range, created_by, updated_by
  ) values
    ('day-2026-09-21', v_trip_id, '2026-09-21', false, auth.uid(), auth.uid()),
    ('day-2026-09-22', v_trip_id, '2026-09-22', false, auth.uid(), auth.uid()),
    ('day-2026-09-23', v_trip_id, '2026-09-23', false, auth.uid(), auth.uid()),
    ('day-2026-09-24', v_trip_id, '2026-09-24', false, auth.uid(), auth.uid()),
    ('day-2026-09-25', v_trip_id, '2026-09-25', false, auth.uid(), auth.uid()),
    ('day-2026-09-26', v_trip_id, '2026-09-26', false, auth.uid(), auth.uid()),
    ('day-2026-09-27', v_trip_id, '2026-09-27', false, auth.uid(), auth.uid()),
    ('day-2026-09-28', v_trip_id, '2026-09-28', false, auth.uid(), auth.uid());

  insert into public.places(
    id, trip_id, name, notes, want_to_visit, seeded, created_by, updated_by
  ) values
    ('place-cpt-airport', v_trip_id, 'Cape Town International Airport', null, false, true, auth.uid(), auth.uid()),
    ('place-accommodation-options', v_trip_id, 'Cape Town accommodation options', 'Hyatt Regency or StayEasy; no hotel selected or booked.', false, true, auth.uid(), auth.uid()),
    ('place-hyatt-regency', v_trip_id, 'Hyatt Regency Cape Town', 'Unscheduled accommodation option; not selected or booked.', true, true, auth.uid(), auth.uid()),
    ('place-stayeasy', v_trip_id, 'StayEasy Cape Town', 'Unscheduled accommodation option; not selected or booked.', true, true, auth.uid(), auth.uid()),
    ('place-va-waterfront', v_trip_id, 'V&A Waterfront', null, false, true, auth.uid(), auth.uid()),
    ('place-waterfront-shopping', v_trip_id, 'V&A Waterfront shops', null, false, true, auth.uid(), auth.uid()),
    ('place-waterfront-dinner', v_trip_id, 'Waterfront dinner', null, false, true, auth.uid(), auth.uid()),
    ('place-red-bus', v_trip_id, 'Hop-On Hop-Off Red Bus', null, false, true, auth.uid(), auth.uid()),
    ('place-table-mountain', v_trip_id, 'Table Mountain Cableway', null, false, true, auth.uid(), auth.uid()),
    ('place-city-sights', v_trip_id, 'Bo-Kaap and Company''s Garden', null, false, true, auth.uid(), auth.uid()),
    ('place-camps-bay-clifton', v_trip_id, 'Camps Bay and Clifton', null, false, true, auth.uid(), auth.uid()),
    ('place-sunset-dinner', v_trip_id, 'Sunset dinner', null, false, true, auth.uid(), auth.uid()),
    ('place-kirstenbosch-constantia', v_trip_id, 'Kirstenbosch and Constantia', 'Flexible-day option 1: gardens plus wine tasting.', false, true, auth.uid(), auth.uid()),
    ('place-relaxed-flex-day', v_trip_id, 'Cape Town relaxed day', 'Flexible-day option 2: cafés, beach, spa, museum, or city.', false, true, auth.uid(), auth.uid()),
    ('place-sea-point-airbnb', v_trip_id, 'Sea Point Airbnb', 'Airbnb details unset.', false, true, auth.uid(), auth.uid()),
    ('place-sea-point-promenade', v_trip_id, 'Sea Point Promenade', null, false, true, auth.uid(), auth.uid()),
    ('place-sea-point-dining', v_trip_id, 'Sea Point cafés and local dining', null, false, true, auth.uid(), auth.uid()),
    ('place-hout-bay', v_trip_id, 'Hout Bay', null, false, true, auth.uid(), auth.uid()),
    ('place-chapmans-peak', v_trip_id, 'Chapman''s Peak Drive', null, false, true, auth.uid(), auth.uid()),
    ('place-cape-point-good-hope', v_trip_id, 'Cape Point and Cape of Good Hope', null, false, true, auth.uid(), auth.uid()),
    ('place-boulders-beach', v_trip_id, 'Boulders Beach penguins', null, false, true, auth.uid(), auth.uid()),
    ('place-muizenberg', v_trip_id, 'Muizenberg', null, false, true, auth.uid(), auth.uid()),
    ('place-golf-round', v_trip_id, 'Cape Town golf round', 'Morning 9 or 18 holes; course unselected.', false, true, auth.uid(), auth.uid()),
    ('place-metropolitan-golf', v_trip_id, 'Metropolitan Golf Club', 'Unscheduled golf-course option; not selected or booked.', true, true, auth.uid(), auth.uid()),
    ('place-steenberg-golf', v_trip_id, 'Steenberg Golf Club', 'Unscheduled golf-course option; not selected or booked.', true, true, auth.uid(), auth.uid()),
    ('place-king-david-mowbray', v_trip_id, 'King David Mowbray Golf Club', 'Unscheduled golf-course option; not selected or booked.', true, true, auth.uid(), auth.uid()),
    ('place-winelands', v_trip_id, 'Cape Winelands', 'Wine tasting in Stellenbosch or Franschhoek; destination unselected.', false, true, auth.uid(), auth.uid()),
    ('place-stellenbosch', v_trip_id, 'Stellenbosch', 'Unscheduled wine-tasting option; not selected or booked.', true, true, auth.uid(), auth.uid()),
    ('place-franschhoek', v_trip_id, 'Franschhoek', 'Unscheduled wine-tasting option; not selected or booked.', true, true, auth.uid(), auth.uid()),
    ('place-winelands-lunch', v_trip_id, 'Winelands long lunch', null, false, true, auth.uid(), auth.uid()),
    ('place-sea-point-shopping', v_trip_id, 'The Point Mall and Piazza St John', null, false, true, auth.uid(), auth.uid()),
    ('place-sunset-cruise', v_trip_id, 'Cape Town sunset cruise', null, false, true, auth.uid(), auth.uid()),
    ('place-farewell-dinner', v_trip_id, 'Farewell dinner', null, false, true, auth.uid(), auth.uid()),
    ('place-departure-breakfast', v_trip_id, 'Departure breakfast', null, false, true, auth.uid(), auth.uid());

  insert into public.itinerary_items(
    id, trip_id, day_id, place_id, notes, position, created_by, updated_by
  ) values
    ('item-day1-arrive-cpt', v_trip_id, 'day-2026-09-21', 'place-cpt-airport', 'Arrive CPT.', 10, auth.uid(), auth.uid()),
    ('item-day1-check-in-options', v_trip_id, 'day-2026-09-21', 'place-accommodation-options', 'Check in with Hyatt Regency or StayEasy; both remain explicitly unselected and unbooked.', 20, auth.uid(), auth.uid()),
    ('item-day1-explore-waterfront', v_trip_id, 'day-2026-09-21', 'place-va-waterfront', 'Explore V&A Waterfront.', 30, auth.uid(), auth.uid()),
    ('item-day1-light-shopping', v_trip_id, 'day-2026-09-21', 'place-waterfront-shopping', 'Light shopping.', 40, auth.uid(), auth.uid()),
    ('item-day1-dinner-waterfront', v_trip_id, 'day-2026-09-21', 'place-waterfront-dinner', 'Dinner at the waterfront.', 50, auth.uid(), auth.uid()),

    ('item-day2-red-bus', v_trip_id, 'day-2026-09-22', 'place-red-bus', 'Hop-on Hop-off Red Bus.', 10, auth.uid(), auth.uid()),
    ('item-day2-table-mountain', v_trip_id, 'day-2026-09-22', 'place-table-mountain', 'Table Mountain Cableway.', 20, auth.uid(), auth.uid()),
    ('item-day2-city-sights', v_trip_id, 'day-2026-09-22', 'place-city-sights', 'City sights: Bo-Kaap and Company''s Garden.', 30, auth.uid(), auth.uid()),
    ('item-day2-camps-bay-clifton', v_trip_id, 'day-2026-09-22', 'place-camps-bay-clifton', 'Camps Bay and Clifton.', 40, auth.uid(), auth.uid()),
    ('item-day2-sunset-dinner', v_trip_id, 'day-2026-09-22', 'place-sunset-dinner', 'Sunset dinner.', 50, auth.uid(), auth.uid()),

    ('item-day3-option-kirstenbosch-wine', v_trip_id, 'day-2026-09-23', 'place-kirstenbosch-constantia', 'Option 1: Kirstenbosch plus wine tasting in Constantia.', 10, auth.uid(), auth.uid()),
    ('item-day3-option-relaxed', v_trip_id, 'day-2026-09-23', 'place-relaxed-flex-day', 'Option 2: relaxed cafés, beach, spa, museum, or city.', 20, auth.uid(), auth.uid()),

    ('item-day4-checkout-transfer', v_trip_id, 'day-2026-09-24', 'place-sea-point-airbnb', 'Check out and transfer to Sea Point Airbnb; accommodation details remain unset.', 10, auth.uid(), auth.uid()),
    ('item-day4-settle-in', v_trip_id, 'day-2026-09-24', 'place-sea-point-airbnb', 'Settle in.', 20, auth.uid(), auth.uid()),
    ('item-day4-promenade', v_trip_id, 'day-2026-09-24', 'place-sea-point-promenade', 'Explore the promenade.', 30, auth.uid(), auth.uid()),
    ('item-day4-cafes-dining', v_trip_id, 'day-2026-09-24', 'place-sea-point-dining', 'Cafés and local dining.', 40, auth.uid(), auth.uid()),

    ('item-day5-hout-bay', v_trip_id, 'day-2026-09-25', 'place-hout-bay', 'Hout Bay.', 10, auth.uid(), auth.uid()),
    ('item-day5-chapmans-peak', v_trip_id, 'day-2026-09-25', 'place-chapmans-peak', 'Chapman''s Peak Drive.', 20, auth.uid(), auth.uid()),
    ('item-day5-cape-point', v_trip_id, 'day-2026-09-25', 'place-cape-point-good-hope', 'Cape Point and Cape of Good Hope.', 30, auth.uid(), auth.uid()),
    ('item-day5-boulders', v_trip_id, 'day-2026-09-25', 'place-boulders-beach', 'Boulders Beach penguins.', 40, auth.uid(), auth.uid()),
    ('item-day5-muizenberg', v_trip_id, 'day-2026-09-25', 'place-muizenberg', 'Muizenberg.', 50, auth.uid(), auth.uid()),

    ('item-day6-morning-golf', v_trip_id, 'day-2026-09-26', 'place-golf-round', 'Morning golf: 9 or 18 holes; course remains unselected and unbooked.', 10, auth.uid(), auth.uid()),
    ('item-day6-wine-tasting', v_trip_id, 'day-2026-09-26', 'place-winelands', 'Wine tasting in Stellenbosch or Franschhoek; destination remains unselected.', 20, auth.uid(), auth.uid()),
    ('item-day6-long-lunch', v_trip_id, 'day-2026-09-26', 'place-winelands-lunch', 'Long lunch.', 30, auth.uid(), auth.uid()),
    ('item-day6-return-cape-town', v_trip_id, 'day-2026-09-26', 'place-sea-point-airbnb', 'Return to Cape Town.', 40, auth.uid(), auth.uid()),

    ('item-day7-sea-point-shopping', v_trip_id, 'day-2026-09-27', 'place-sea-point-shopping', 'Sea Point shopping: The Point Mall and Piazza St John.', 10, auth.uid(), auth.uid()),
    ('item-day7-va-final-shopping', v_trip_id, 'day-2026-09-27', 'place-va-waterfront', 'V&A Waterfront final shopping.', 20, auth.uid(), auth.uid()),
    ('item-day7-sunset-cruise', v_trip_id, 'day-2026-09-27', 'place-sunset-cruise', 'Sunset cruise.', 30, auth.uid(), auth.uid()),
    ('item-day7-farewell-dinner', v_trip_id, 'day-2026-09-27', 'place-farewell-dinner', 'Farewell dinner.', 40, auth.uid(), auth.uid()),

    ('item-day8-breakfast', v_trip_id, 'day-2026-09-28', 'place-departure-breakfast', 'Breakfast.', 10, auth.uid(), auth.uid()),
    ('item-day8-checkout', v_trip_id, 'day-2026-09-28', 'place-sea-point-airbnb', 'Check out.', 20, auth.uid(), auth.uid()),
    ('item-day8-transfer-cpt', v_trip_id, 'day-2026-09-28', 'place-cpt-airport', 'Transfer to CPT.', 30, auth.uid(), auth.uid());

  insert into public.rate_sets(
    id, trip_id, label, effective_date,
    kes_per_kes, kes_per_usd, kes_per_zar,
    active, example, created_by, updated_by
  ) values (
    'rate-exchangerate-api-2026-09-16', v_trip_id,
    'ExchangeRate-API — 2026-09-16', '2026-09-16',
    1, 129.5336787565, 8.0547724527,
    true, false, auth.uid(), auth.uid()
  );

  return v_trip_id;
end $$;
revoke all on function public.create_capetown_2026_trip() from public;
grant execute on function public.create_capetown_2026_trip() to authenticated;

-- RLS: membership grants reads; owner/editor grants ordinary domain writes.
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_email_access enable row level security;
alter table public.checklist_items enable row level security;
alter table public.itinerary_days enable row level security;
alter table public.places enable row level security;
alter table public.activity_templates enable row level security;
alter table public.activity_template_stops enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.rate_sets enable row level security;
alter table public.expenses enable row level security;
alter table public.travel_stamps enable row level security;
alter table public.photos enable row level security;
alter table public.notebook_metadata enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.trip_members mine join public.trip_members theirs using (trip_id)
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id = auth.uid());

create policy trips_select on public.trips for select to authenticated
  using (public.is_trip_member(id));
create policy trips_insert on public.trips for insert to authenticated
  with check (created_by = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));
create policy trips_delete_owner on public.trips for delete to authenticated using (public.is_trip_owner(id));

create policy trip_members_select on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
create policy trip_members_update_owner on public.trip_members for update to authenticated
  using (public.is_trip_owner(trip_id))
  with check (public.is_trip_owner(trip_id));
create policy trip_members_delete_owner on public.trip_members for delete to authenticated
  using (public.is_trip_owner(trip_id));

create policy trip_email_access_select_owner on public.trip_email_access for select to authenticated
  using (public.is_trip_owner(trip_id));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'checklist_items','itinerary_days','places','activity_templates',
    'activity_template_stops','itinerary_items','rate_sets','expenses','travel_stamps','photos',
    'notebook_metadata'
  ] loop
    execute format(
      'create policy member_select on public.%I for select to authenticated using (public.is_trip_member(trip_id))',
      table_name
    );
    execute format(
      'create policy editor_insert on public.%I for insert to authenticated with check (public.can_edit_trip(trip_id))',
      table_name
    );
    execute format(
      'create policy editor_update on public.%I for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id))',
      table_name
    );
    execute format(
      'create policy editor_delete on public.%I for delete to authenticated using (public.can_edit_trip(trip_id))',
      table_name
    );
  end loop;
end $$;

create function public.list_notebook_trips()
returns table (
  id uuid,
  destination text,
  role public.trip_member_role,
  updated_at timestamptz
) language sql stable security invoker set search_path = ''
as $$
  select t.id, t.destination, m.role, t.updated_at
  from public.trips t
  join public.trip_members m on m.trip_id = t.id and m.user_id = auth.uid()
  order by t.start_date, t.created_at
$$;

create or replace function public.load_notebook_v4(p_trip_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 4,
    'trip', jsonb_build_object(
      'id', 'current',
      'destination', t.destination,
      'travellers', t.travellers,
      'startDate', t.start_date,
      'endDate', t.end_date,
      'timezone', t.timezone,
      'notes', t.notes,
      'updatedAt', t.updated_at
    ),
    'checklist', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'title', x.title, 'category', x.category, 'dueDate', x.due_date,
      'completed', x.completed, 'note', x.note, 'createdAt', x.created_at, 'updatedAt', x.updated_at
    )) order by x.created_at), '[]'::jsonb)
      from public.checklist_items x where x.trip_id = t.id),
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'date', x.day_date, 'outOfRange', x.out_of_range
    ) order by x.day_date), '[]'::jsonb)
      from public.itinerary_days x where x.trip_id = t.id),
    'items', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'dayId', x.day_id, 'placeId', x.place_id, 'parentId', x.parent_id,
      'templateId', x.template_id, 'isActivityGroup', x.is_activity_group,
      'time', case when x.item_time is null then null else to_char(x.item_time, 'HH24:MI') end,
      'notes', x.notes, 'bookingStatus', x.booking_status, 'visited', x.visited,
      'position', x.position, 'createdAt', x.created_at, 'updatedAt', x.updated_at
    )) order by x.day_id, x.parent_id nulls first, x.position), '[]'::jsonb)
      from public.itinerary_items x where x.trip_id = t.id),
    'places', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'name', x.name, 'address', x.address, 'notes', x.notes,
      'googleMapsUrl', x.google_maps_url, 'wantToVisit', x.want_to_visit, 'seeded', x.seeded,
      'createdAt', x.created_at, 'updatedAt', x.updated_at
    )) order by x.created_at), '[]'::jsonb)
      from public.places x where x.trip_id = t.id),
    'activityTemplates', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'name', x.name, 'description', x.description,
      'stops', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', s.id, 'placeName', s.place_name, 'placeId', s.place_id, 'notes', s.notes,
        'approximateMinutes', s.approximate_minutes, 'optional', s.optional
      )) order by s.position), '[]'::jsonb)
        from public.activity_template_stops s
        where s.trip_id = x.trip_id and s.template_id = x.id),
      'seeded', x.seeded, 'createdAt', x.created_at, 'updatedAt', x.updated_at
    ) order by x.created_at), '[]'::jsonb)
      from public.activity_templates x where x.trip_id = t.id),
    'expenses', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'amount', x.amount, 'currency', x.currency, 'date', x.expense_date,
      'category', x.category, 'note', x.note, 'rateSetId', x.recorded_rate_set_id,
      'itineraryItemId', x.itinerary_item_id, 'createdAt', x.created_at, 'updatedAt', x.updated_at
    )) order by x.expense_date), '[]'::jsonb)
      from public.expenses x where x.trip_id = t.id),
    'stamps', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.id, 'itineraryItemId', x.itinerary_item_id, 'placeName', x.place_name,
      'visitDate', x.visit_date, 'detached', x.detached, 'createdAt', x.created_at
    )) order by x.visit_date), '[]'::jsonb)
      from public.travel_stamps x where x.trip_id = t.id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'stampId', x.stamp_id, 'caption', x.caption, 'mimeType', x.mime_type,
      'width', x.width, 'height', x.height, 'size', x.byte_size,
      'createdAt', x.created_at, 'updatedAt', x.updated_at
    ) order by x.created_at), '[]'::jsonb)
      from public.photos x where x.trip_id = t.id),
    'rateSets', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'label', x.label, 'effectiveDate', x.effective_date,
      'kesPerKes', x.kes_per_kes, 'kesPerUsd', x.kes_per_usd, 'kesPerZar', x.kes_per_zar,
      'active', x.active, 'example', x.example, 'createdAt', x.created_at
    ) order by x.effective_date), '[]'::jsonb)
      from public.rate_sets x where x.trip_id = t.id),
    'metadata', (select coalesce(jsonb_agg(jsonb_build_object(
      'key', x.key, 'value', x.value
    ) order by x.key), '[]'::jsonb)
      from public.notebook_metadata x where x.trip_id = t.id)
  )
  from public.trips t
  where t.id = p_trip_id and public.is_trip_member(t.id)
$$;
revoke all on function public.list_notebook_trips() from public;
revoke all on function public.load_notebook_v4(uuid) from public;
grant execute on function public.list_notebook_trips(), public.load_notebook_v4(uuid) to authenticated;

-- Private Storage bucket for member-owned trip photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-photos', 'trip-photos', false, 52428800, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_photo_object(p_name text, p_require_uploader boolean default false)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(jpg|png|webp)$'
      then public.is_trip_member(split_part(p_name, '/', 1)::uuid)
    else false
  end
$$;
create or replace function public.can_delete_photo_object(p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.can_access_photo_object(p_name)
    and not exists (select 1 from public.photos where object_path = p_name)
$$;
revoke all on function public.can_access_photo_object(text, boolean) from public;
revoke all on function public.can_delete_photo_object(text) from public;
grant execute on function public.can_access_photo_object(text, boolean),
  public.can_delete_photo_object(text) to authenticated;

create policy trip_photos_select on storage.objects for select to authenticated
using (bucket_id = 'trip-photos' and public.can_access_photo_object(name));
create policy trip_photos_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'trip-photos'
  and owner_id = auth.uid()::text
  and public.can_access_photo_object(name, true)
);
create policy trip_photos_update on storage.objects for update to authenticated
using (
  bucket_id = 'trip-photos'
  and owner_id = auth.uid()::text
  and public.can_access_photo_object(name, true)
)
with check (
  bucket_id = 'trip-photos'
  and owner_id = auth.uid()::text
  and public.can_access_photo_object(name, true)
);
create policy trip_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'trip-photos' and public.can_delete_photo_object(name));

-- Table grants still pass through RLS. Sensitive inserts are RPC-only.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.trips, public.trip_members,
  public.checklist_items, public.itinerary_days, public.places, public.activity_templates,
  public.activity_template_stops, public.itinerary_items, public.rate_sets, public.expenses,
  public.travel_stamps, public.photos, public.notebook_metadata to authenticated;
grant select on public.trip_email_access to authenticated;
grant usage, select on all sequences in schema public to authenticated;
