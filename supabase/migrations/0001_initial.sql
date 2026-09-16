-- Cape Town Travel Notebook: initial multi-user Supabase schema.
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
do $$ begin
  create type public.import_status as enum ('processing', 'completed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.trip_status as enum ('pending_import', 'complete');
exception when duplicate_object then null; end $$;

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
drop trigger if exists auth_user_profile on auth.users;
create trigger auth_user_profile after insert on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  destination text not null check (length(trim(destination)) between 1 and 200),
  travellers integer not null default 1 check (travellers between 1 and 100),
  start_date date not null,
  end_date date not null,
  timezone text not null default 'UTC' check (length(timezone) between 1 and 100),
  notes text not null default '',
  status public.trip_status not null default 'complete',
  import_batch_id uuid,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_date_order check (end_date >= start_date),
  unique (created_by, import_batch_id)
);

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
  and exists (select 1 from public.trips where id = p_trip_id and status = 'complete') $$;

create or replace function public.is_trip_owner(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.trip_role(p_trip_id) = 'owner'::public.trip_member_role $$;

revoke all on function public.is_trip_member(uuid) from public;
revoke all on function public.trip_role(uuid) from public;
revoke all on function public.can_edit_trip(uuid) from public;
revoke all on function public.is_trip_owner(uuid) from public;
grant execute on function public.is_trip_member(uuid), public.trip_role(uuid),
  public.can_edit_trip(uuid), public.is_trip_owner(uuid) to authenticated;

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

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists trips_audit on public.trips;
create trigger trips_audit before insert or update on public.trips
for each row execute function public.set_audit_fields();

create or replace function public.protect_trip_system_fields()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare table_owner name;
begin
  if (new.status, new.import_batch_id) is distinct from (old.status, old.import_batch_id) then
    select pg_get_userbyid(c.relowner) into table_owner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = tg_table_schema and c.relname = tg_table_name;
    if current_user <> table_owner then
      raise exception 'Trip status and import batch are server-managed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trips_protect_system_fields on public.trips;
create trigger trips_protect_system_fields before update on public.trips
for each row execute function public.protect_trip_system_fields();

create or replace function public.add_trip_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.trip_members(trip_id, user_id, role, created_by)
  values (new.id, new.created_by, 'owner', new.created_by)
  on conflict (trip_id, user_id) do nothing;
  return new;
end $$;
drop trigger if exists trips_add_owner on public.trips;
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
drop trigger if exists trip_members_protect on public.trip_members;
create trigger trip_members_protect before update or delete on public.trip_members
for each row execute function public.protect_trip_members();

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  email extensions.citext not null,
  role public.trip_member_role not null default 'editor',
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint invitations_expiry check (expires_at > created_at),
  constraint invitations_acceptance_pair check ((accepted_at is null) = (accepted_by is null)),
  constraint invitations_terminal_state check (not (accepted_at is not null and revoked_at is not null))
);
create unique index if not exists invitations_one_open_email_idx
  on public.invitations(trip_id, lower(email::text))
  where accepted_at is null and revoked_at is null;

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
drop trigger if exists itinerary_parent_guard on public.itinerary_items;
create constraint trigger itinerary_parent_guard
after insert or update of trip_id, day_id, parent_id on public.itinerary_items
deferrable initially immediate for each row execute function public.check_itinerary_parent();

create table if not exists public.rate_sets (
  id text not null default gen_random_uuid()::text check (length(id) between 1 and 500),
  trip_id uuid not null references public.trips(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 200),
  effective_date date not null,
  kes_per_kes numeric(20,8) not null default 1 check (kes_per_kes = 1),
  kes_per_usd numeric(20,8) not null check (kes_per_usd > 0),
  kes_per_zar numeric(20,8) not null check (kes_per_zar > 0),
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
  recorded_kes_per_kes numeric(20,8) not null check (recorded_kes_per_kes = 1),
  recorded_kes_per_usd numeric(20,8) not null check (recorded_kes_per_usd > 0),
  recorded_kes_per_zar numeric(20,8) not null check (recorded_kes_per_zar > 0),
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
drop trigger if exists expenses_rate_snapshot on public.expenses;
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
drop trigger if exists itinerary_detach_memories on public.itinerary_items;
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

create or replace function public.set_photo_uploader()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then new.uploaded_by := auth.uid();
  else new.uploaded_by := old.uploaded_by; new.object_path := old.object_path; end if;
  return new;
end $$;
drop trigger if exists photos_uploader on public.photos;
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
drop trigger if exists photos_zz_verify_storage on public.photos;
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
drop trigger if exists protect_referenced_photo_object on storage.objects;
create trigger protect_referenced_photo_object before update or delete on storage.objects
for each row execute function public.protect_referenced_photo_object();

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

create table if not exists public.import_batches (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  destination text not null check (length(trim(destination)) between 1 and 200),
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  status public.import_status not null default 'processing',
  completed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (trip_id, idempotency_key),
  unique (trip_id, id),
  constraint import_completion_consistent check (
    (status = 'completed') = (completed_at is not null)
    and (status <> 'completed' or payload_sha256 is not null)
  )
);

create or replace function public.begin_notebook_import(import_batch_id uuid, destination text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_trip_id uuid; v_owner uuid; v_destination text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if import_batch_id is null or length(trim(coalesce(destination, ''))) not between 1 and 200 then
    raise exception 'A batch id and destination are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || import_batch_id::text, 0));
  select b.trip_id, b.created_by, b.destination into v_trip_id, v_owner, v_destination
    from public.import_batches b where b.id = import_batch_id;
  if found then
    if v_owner <> auth.uid() then raise exception 'Import batch belongs to another user'; end if;
    if v_destination <> trim(destination) then raise exception 'Batch destination does not match'; end if;
    return v_trip_id;
  end if;
  insert into public.trips(
    destination, travellers, start_date, end_date, timezone, notes,
    status, import_batch_id, created_by, updated_by
  ) values (
    trim(destination), 1, current_date, current_date, 'UTC', '',
    'pending_import', import_batch_id, auth.uid(), auth.uid()
  ) returning id into v_trip_id;
  insert into public.import_batches(
    id, trip_id, idempotency_key, destination, status, created_by
  ) values (
    import_batch_id, v_trip_id, import_batch_id::text, trim(destination), 'processing', auth.uid()
  );
  return v_trip_id;
end $$;

create or replace function public.import_notebook_v4(import_batch_id uuid, notebook jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_batch public.import_batches%rowtype;
  v_trip_id uuid;
  v_hash text := encode(extensions.digest(convert_to(notebook::text, 'UTF8'), 'sha256'), 'hex');
  v_trip jsonb;
  v_trip_status public.trip_status;
  r jsonb;
  s jsonb;
  v_id text;
  v_mime text;
  v_path text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  select * into v_batch from public.import_batches where id = import_batch_id for update;
  if not found or v_batch.created_by <> auth.uid() then
    raise exception 'Import batch not found or permission denied';
  end if;
  v_trip_id := v_batch.trip_id;
  if not public.is_trip_owner(v_trip_id) then raise exception 'Only the pending trip owner may import'; end if;
  if v_batch.status = 'completed' then
    if v_batch.payload_sha256 <> v_hash then
      raise exception 'Completed batch cannot be reused for different notebook data';
    end if;
    return v_trip_id;
  end if;
  if jsonb_typeof(notebook) <> 'object'
     or coalesce((notebook ->> 'schema_version')::integer, 0) <> 4
     or coalesce(notebook ->> 'trip_id', '') <> v_trip_id::text then
    raise exception 'Expected a v4 notebook whose trip_id matches the pending import';
  end if;
  select status into strict v_trip_status from public.trips where id = v_trip_id for update;
  if v_trip_status <> 'pending_import' then raise exception 'Trip is not pending import'; end if;
  v_trip := notebook -> 'trip';
  if jsonb_typeof(v_trip) <> 'object' then raise exception 'Notebook trip is required'; end if;
  if trim(coalesce(v_trip ->> 'destination', '')) <> v_batch.destination then
    raise exception 'Notebook destination does not match the pending import';
  end if;

  update public.trips set
    destination = v_batch.destination,
    travellers = coalesce((v_trip ->> 'travellers')::integer, 1),
    start_date = (v_trip ->> 'startDate')::date,
    end_date = (v_trip ->> 'endDate')::date,
    timezone = coalesce(nullif(v_trip ->> 'timezone', ''), 'UTC'),
    notes = coalesce(v_trip ->> 'notes', '')
  where id = v_trip_id;

  for r in select value from jsonb_array_elements(coalesce(notebook -> 'checklist', '[]'::jsonb)) loop
    insert into public.checklist_items(
      id, trip_id, title, category, due_date, completed, note, created_by, updated_by, created_at
    ) values (
      r ->> 'id', v_trip_id,
      r ->> 'title', r ->> 'category', nullif(r ->> 'dueDate', '')::date,
      coalesce((r ->> 'completed')::boolean, false), nullif(r ->> 'note', ''),
      auth.uid(), auth.uid(), coalesce((r ->> 'createdAt')::timestamptz, now())
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(notebook -> 'days', '[]'::jsonb)) loop
    insert into public.itinerary_days(id, trip_id, day_date, out_of_range, created_by, updated_by)
    values (
      r ->> 'id', v_trip_id,
      (r ->> 'date')::date, coalesce((r ->> 'outOfRange')::boolean, false), auth.uid(), auth.uid()
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(notebook -> 'places', '[]'::jsonb)) loop
    insert into public.places(
      id, trip_id, name, address, notes, google_maps_url, want_to_visit, seeded,
      created_by, updated_by, created_at
    ) values (
      r ->> 'id', v_trip_id, r ->> 'name',
      nullif(r ->> 'address', ''), nullif(r ->> 'notes', ''), nullif(r ->> 'googleMapsUrl', ''),
      coalesce((r ->> 'wantToVisit')::boolean, false), coalesce((r ->> 'seeded')::boolean, false),
      auth.uid(), auth.uid(), coalesce((r ->> 'createdAt')::timestamptz, now())
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(notebook -> 'activity_templates', '[]'::jsonb)) loop
    v_id := r ->> 'id';
    insert into public.activity_templates(
      id, trip_id, name, description, seeded, created_by, updated_by, created_at
    ) values (
      v_id, v_trip_id, r ->> 'name', coalesce(r ->> 'description', ''),
      coalesce((r ->> 'seeded')::boolean, false), auth.uid(), auth.uid(),
      coalesce((r ->> 'createdAt')::timestamptz, now())
    );
    for s in select value from jsonb_array_elements(coalesce(r -> 'stops', '[]'::jsonb)) loop
      insert into public.activity_template_stops(
        id, trip_id, template_id, place_id, place_name, notes, approximate_minutes,
        optional, position, created_by, updated_by
      ) values (
        s ->> 'id',
        v_trip_id, v_id,
        case when nullif(s ->> 'placeId', '') is null then null
          else s ->> 'placeId' end,
        s ->> 'placeName',
        array(select jsonb_array_elements_text(coalesce(s -> 'notes', '[]'::jsonb))),
        nullif(s ->> 'approximateMinutes', '')::integer,
        coalesce((s ->> 'optional')::boolean, false),
        coalesce((s ->> 'position')::integer,
          (select count(*)::integer from public.activity_template_stops where template_id = v_id)),
        auth.uid(), auth.uid()
      );
    end loop;
  end loop;

  for r in
    select value from jsonb_array_elements(coalesce(notebook -> 'itinerary_items', '[]'::jsonb))
    order by nullif(value ->> 'parentId', '') is not null
  loop
    insert into public.itinerary_items(
      id, trip_id, day_id, place_id, parent_id, template_id, is_activity_group,
      item_time, notes, booking_status, visited, position, created_by, updated_by, created_at
    ) values (
      r ->> 'id', v_trip_id, r ->> 'dayId', r ->> 'placeId',
      case when nullif(r ->> 'parentId', '') is null then null
        else r ->> 'parentId' end,
      case when nullif(r ->> 'templateId', '') is null then null
        else r ->> 'templateId' end,
      coalesce((r ->> 'isActivityGroup')::boolean, false), nullif(r ->> 'time', '')::time,
      nullif(r ->> 'notes', ''), nullif(r ->> 'bookingStatus', '')::public.booking_status,
      coalesce((r ->> 'visited')::boolean, false), coalesce((r ->> 'position')::bigint, 0),
      auth.uid(), auth.uid(), coalesce((r ->> 'createdAt')::timestamptz, now())
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(notebook -> 'rate_sets', '[]'::jsonb)) loop
    insert into public.rate_sets(
      id, trip_id, label, effective_date, kes_per_kes, kes_per_usd, kes_per_zar,
      active, example, created_by, updated_by, created_at
    ) values (
      r ->> 'id', v_trip_id,
      r ->> 'label', (r ->> 'effectiveDate')::date, coalesce((r ->> 'kesPerKes')::numeric, 1),
      (r ->> 'kesPerUsd')::numeric, (r ->> 'kesPerZar')::numeric,
      coalesce((r ->> 'active')::boolean, false), coalesce((r ->> 'example')::boolean, false),
      auth.uid(), auth.uid(), coalesce((r ->> 'createdAt')::timestamptz, now())
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(notebook -> 'expenses', '[]'::jsonb)) loop
    insert into public.expenses(
      id, trip_id, amount, currency, expense_date, category, note, recorded_rate_set_id,
      recorded_rate_label, recorded_rate_effective_date, recorded_kes_per_kes,
      recorded_kes_per_usd, recorded_kes_per_zar, itinerary_item_id,
      created_by, updated_by, created_at
    ) values (
      r ->> 'id', v_trip_id,
      (r ->> 'amount')::numeric, (r ->> 'currency')::public.expense_currency,
      (r ->> 'date')::date, r ->> 'category', nullif(r ->> 'note', ''),
      case when nullif(r ->> 'rateSetId', '') is null then null
        else r ->> 'rateSetId' end,
      coalesce(nullif(r ->> 'recordedRateLabel', ''), 'Imported: no recorded rate'),
      coalesce(nullif(r ->> 'recordedRateEffectiveDate', '')::date, (r ->> 'date')::date),
      coalesce((r ->> 'recordedKesPerKes')::numeric, 1),
      coalesce((r ->> 'recordedKesPerUsd')::numeric, 1),
      coalesce((r ->> 'recordedKesPerZar')::numeric, 1),
      case when nullif(r ->> 'itineraryItemId', '') is null then null
        else r ->> 'itineraryItemId' end,
      auth.uid(), auth.uid(), coalesce((r ->> 'createdAt')::timestamptz, now())
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(notebook -> 'stamps', '[]'::jsonb)) loop
    insert into public.travel_stamps(
      id, trip_id, itinerary_item_id, place_name, visit_date, detached,
      created_by, updated_by, created_at
    ) values (
      r ->> 'id', v_trip_id,
      case when nullif(r ->> 'itineraryItemId', '') is null then null
        else r ->> 'itineraryItemId' end,
      r ->> 'placeName', (r ->> 'visitDate')::date,
      nullif(r ->> 'itineraryItemId', '') is null,
      auth.uid(), auth.uid(), coalesce((r ->> 'createdAt')::timestamptz, now())
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(notebook -> 'photos', '[]'::jsonb)) loop
    v_id := r ->> 'id';
    v_mime := r ->> 'mimeType';
    if v_mime not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'Unsupported photo MIME type';
    end if;
    v_path := v_trip_id::text || '/' || v_id || '.' ||
      case v_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
    if coalesce(r ->> 'storagePath', '') <> v_path then
      raise exception 'Photo storage path does not match its trip, id, and MIME type';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'trip-photos'
        and name = v_path
        and owner_id = auth.uid()::text
        and public.storage_metadata_mime(metadata) = v_mime
        and public.storage_metadata_size(metadata) = (r ->> 'size')::bigint
    ) then
      raise exception 'Expected an owned Storage object with matching path, MIME, and size for photo %', v_id;
    end if;
    insert into public.photos(
      id, trip_id, stamp_id, caption, mime_type, width, height, byte_size, object_path,
      uploaded_by, created_by, updated_by, created_at
    ) values (
      v_id, v_trip_id, r ->> 'stampId',
      coalesce(r ->> 'caption', ''), v_mime, (r ->> 'width')::integer,
      (r ->> 'height')::integer, (r ->> 'size')::bigint,
      v_path,
      auth.uid(), auth.uid(), auth.uid(), coalesce((r ->> 'createdAt')::timestamptz, now())
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(notebook -> 'metadata', '[]'::jsonb)) loop
    insert into public.notebook_metadata(
      trip_id, key, value, created_by, updated_by
    ) values (
      v_trip_id, r ->> 'key', r ->> 'value', auth.uid(), auth.uid()
    );
  end loop;

  update public.trips set status = 'complete' where id = v_trip_id;
  update public.import_batches
    set status = 'completed', completed_at = now(), payload_sha256 = v_hash
    where id = import_batch_id;
  return v_trip_id;
end $$;

revoke all on function public.begin_notebook_import(uuid, text) from public;
revoke all on function public.import_notebook_v4(uuid, jsonb) from public;
grant execute on function public.begin_notebook_import(uuid, text),
  public.import_notebook_v4(uuid, jsonb) to authenticated;

create or replace function public.create_trip_invitation(
  p_trip_id uuid, p_email text, p_role public.trip_member_role default 'editor',
  p_expires_at timestamptz default (now() + interval '7 days')
) returns table(invitation_id uuid, token text)
language plpgsql security definer set search_path = ''
as $$
declare raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null or not public.is_trip_owner(p_trip_id) then
    raise exception 'Only a trip owner may invite members';
  end if;
  if not exists (select 1 from public.trips where id = p_trip_id and status = 'complete') then
    raise exception 'Invitations require a completed trip';
  end if;
  if p_email is null or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid email is required';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'Invitation expiry must be within 30 days';
  end if;
  if exists (
    select 1 from public.trip_members m
    join auth.users u on u.id = m.user_id
    where m.trip_id = p_trip_id and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'That user is already a trip member';
  end if;
  update public.invitations set revoked_at = now()
    where trip_id = p_trip_id and lower(email::text) = lower(trim(p_email))
      and accepted_at is null and revoked_at is null and expires_at <= now();
  insert into public.invitations(trip_id, email, role, token_hash, expires_at, created_by)
  values (p_trip_id, lower(trim(p_email))::extensions.citext, p_role,
          extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), p_expires_at, auth.uid())
  returning id into invitation_id;
  token := raw_token;
  return next;
end $$;

create or replace function public.revoke_trip_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.invitations where id = p_invitation_id for update;
  if not found or auth.uid() is null or not public.is_trip_owner(v_trip_id) then
    raise exception 'Invitation not found or permission denied';
  end if;
  update public.invitations set revoked_at = now()
    where id = p_invitation_id and accepted_at is null and revoked_at is null;
end $$;

create or replace function public.accept_trip_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare inv public.invitations%rowtype; jwt_email text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  jwt_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select * into inv from public.invitations
    where token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    for update;
  if not found or inv.accepted_at is not null or inv.revoked_at is not null
     or inv.expires_at <= now() then raise exception 'Invitation is invalid or expired'; end if;
  if jwt_email = '' or jwt_email <> lower(inv.email::text) then
    raise exception 'Invitation email does not match the authenticated user';
  end if;
  if exists (
    select 1 from public.trip_members where trip_id = inv.trip_id and user_id = auth.uid()
  ) then
    raise exception 'Authenticated user is already a trip member';
  end if;
  insert into public.trip_members(trip_id, user_id, role, created_by)
    values (inv.trip_id, auth.uid(), inv.role, inv.created_by);
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.trip_id;
end $$;
revoke all on function public.create_trip_invitation(uuid, text, public.trip_member_role, timestamptz) from public;
revoke all on function public.revoke_trip_invitation(uuid) from public;
revoke all on function public.accept_trip_invitation(text) from public;
grant execute on function public.create_trip_invitation(uuid, text, public.trip_member_role, timestamptz),
  public.revoke_trip_invitation(uuid), public.accept_trip_invitation(text) to authenticated;

-- Apply audit protection consistently to all collaborative domain rows.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'checklist_items','itinerary_days','places','activity_templates',
    'activity_template_stops','itinerary_items','rate_sets','expenses','travel_stamps','photos',
    'notebook_metadata'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_audit', table_name);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.set_audit_fields()',
      table_name || '_audit', table_name
    );
  end loop;
end $$;

-- RLS: membership grants reads; owner/editor grants ordinary domain writes.
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.invitations enable row level security;
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
alter table public.import_batches enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.trip_members mine join public.trip_members theirs using (trip_id)
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id = auth.uid());

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (status = 'complete' and public.is_trip_member(id));
drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (created_by = auth.uid() and status = 'complete' and import_batch_id is null);
drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));
drop policy if exists trips_delete_owner on public.trips;
create policy trips_delete_owner on public.trips for delete to authenticated using (public.is_trip_owner(id));

drop policy if exists trip_members_select on public.trip_members;
create policy trip_members_select on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id) and exists (
    select 1 from public.trips where id = trip_id and status = 'complete'
  ));
drop policy if exists trip_members_update_owner on public.trip_members;
create policy trip_members_update_owner on public.trip_members for update to authenticated
  using (public.is_trip_owner(trip_id) and exists (
    select 1 from public.trips where id = trip_id and status = 'complete'
  )) with check (public.is_trip_owner(trip_id) and exists (
    select 1 from public.trips where id = trip_id and status = 'complete'
  ));
drop policy if exists trip_members_delete_owner on public.trip_members;
create policy trip_members_delete_owner on public.trip_members for delete to authenticated
  using (public.is_trip_owner(trip_id) and exists (
    select 1 from public.trips where id = trip_id and status = 'complete'
  ));

drop policy if exists invitations_select_owner on public.invitations;
create policy invitations_select_owner on public.invitations for select to authenticated
  using (public.is_trip_owner(trip_id));
drop policy if exists invitations_delete_owner on public.invitations;
create policy invitations_delete_owner on public.invitations for delete to authenticated
  using (public.is_trip_owner(trip_id));

drop policy if exists import_batches_select_owner on public.import_batches;
create policy import_batches_select_owner on public.import_batches for select to authenticated
  using (public.is_trip_owner(trip_id));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'checklist_items','itinerary_days','places','activity_templates',
    'activity_template_stops','itinerary_items','rate_sets','expenses','travel_stamps','photos',
    'notebook_metadata'
  ] loop
    execute format('drop policy if exists member_select on public.%I', table_name);
    execute format(
      'create policy member_select on public.%I for select to authenticated using (public.is_trip_member(trip_id))',
      table_name
    );
    execute format('drop policy if exists editor_insert on public.%I', table_name);
    execute format(
      'create policy editor_insert on public.%I for insert to authenticated with check (public.can_edit_trip(trip_id))',
      table_name
    );
    execute format('drop policy if exists editor_update on public.%I', table_name);
    execute format(
      'create policy editor_update on public.%I for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id))',
      table_name
    );
    execute format('drop policy if exists editor_delete on public.%I', table_name);
    execute format(
      'create policy editor_delete on public.%I for delete to authenticated using (public.can_edit_trip(trip_id))',
      table_name
    );
  end loop;
end $$;

drop function if exists public.list_notebook_trips();
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
  where t.status = 'complete'
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
  where t.id = p_trip_id and t.status = 'complete' and public.is_trip_member(t.id)
$$;
revoke all on function public.list_notebook_trips() from public;
revoke all on function public.load_notebook_v4(uuid) from public;
grant execute on function public.list_notebook_trips(), public.load_notebook_v4(uuid) to authenticated;

-- Private Storage bucket. Pending-import membership permits uploads before metadata finalization.
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

drop policy if exists trip_photos_select on storage.objects;
create policy trip_photos_select on storage.objects for select to authenticated
using (bucket_id = 'trip-photos' and public.can_access_photo_object(name));
drop policy if exists trip_photos_insert on storage.objects;
create policy trip_photos_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'trip-photos'
  and owner_id = auth.uid()::text
  and public.can_access_photo_object(name, true)
);
drop policy if exists trip_photos_update on storage.objects;
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
drop policy if exists trip_photos_delete on storage.objects;
create policy trip_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'trip-photos' and public.can_delete_photo_object(name));

-- Table grants still pass through RLS. Sensitive inserts are RPC-only.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.trips, public.trip_members,
  public.checklist_items, public.itinerary_days, public.places, public.activity_templates,
  public.activity_template_stops, public.itinerary_items, public.rate_sets, public.expenses,
  public.travel_stamps, public.photos, public.notebook_metadata to authenticated;
grant select, delete on public.invitations to authenticated;
grant select on public.import_batches to authenticated;
grant usage, select on all sequences in schema public to authenticated;
