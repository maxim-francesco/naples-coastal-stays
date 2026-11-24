-- Minimal local schema for the STEP 06A PostgreSQL acceptance tests.
-- It mirrors the columns the availability code reads and writes; it is NOT a
-- copy of production, and it is created only inside a disposable container.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

-- The privilege tests connect as each role, exactly like PostgREST does. These
-- passwords exist only inside the disposable container created by
-- scripts/run-availability-db-tests.sh.
alter role anon login password 'anon-local-test';
alter role authenticated login password 'authenticated-local-test';
alter role service_role login password 'service-role-local-test';
alter role service_role bypassrls;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase gives anon and authenticated explicit grants on every new object in
-- the public schema. Reproducing that here is what makes the revoke assertions
-- meaningful: revoking PUBLIC alone would not remove these grants.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  area text not null,
  short_description text not null,
  long_description text[] not null default '{}',
  max_guests integer not null,
  bedrooms integer not null,
  bathrooms integer not null,
  min_nights integer not null default 1,
  base_rate numeric not null,
  cleaning_fee numeric not null default 0,
  amenities text[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  guest_name text not null,
  email text not null,
  check_in date not null,
  check_out date not null,
  guests integer not null,
  message text not null default '',
  status text not null default 'new',
  ip_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.blackout_dates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

-- Production serves every table through PostgREST with RLS enabled and no
-- anonymous policies: the public site reads through the server, never the
-- browser. Mirroring that here lets the tests prove direct client access is
-- denied instead of merely assuming it.
alter table public.properties enable row level security;
alter table public.booking_requests enable row level security;
alter table public.blackout_dates enable row level security;
