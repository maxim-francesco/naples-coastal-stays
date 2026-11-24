-- STEP 06A — booking availability protection.
--
-- PREPARED LOCALLY. NOT APPLIED TO PRODUCTION.
--
-- Semantics: every stay and blackout is the half-open range [start, end).
-- A confirmed reservation and a manual blackout block every night from start
-- through the night before end; the end date itself stays available, which is
-- what makes a same-day turnover legal.
--
-- What this migration adds:
--   1. CHECK constraints (NOT VALID, so legacy rows cannot block the deploy).
--   2. A GiST exclusion constraint: no two confirmed bookings for the same
--      property may overlap.
--   3. A GiST exclusion constraint: manual blackout ranges may not overlap.
--   4. Triggers preventing a confirmed booking / blackout crossing each other,
--      serialized per property with an advisory transaction lock.
--   5. RPCs used by the admin server functions: confirm_booking_request and
--      create_blackout.
--
-- Rollback: supabase/migrations/rollback/202611230001_booking_availability.rollback.sql

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Validation constraints
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_requests_dates_check'
      and conrelid = 'public.booking_requests'::regclass
  ) then
    alter table public.booking_requests
      add constraint booking_requests_dates_check
      check (check_out > check_in) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_requests_confirmed_property_check'
      and conrelid = 'public.booking_requests'::regclass
  ) then
    alter table public.booking_requests
      add constraint booking_requests_confirmed_property_check
      check (status <> 'confirmed' or property_id is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'blackout_dates_range_check'
      and conrelid = 'public.blackout_dates'::regclass
  ) then
    alter table public.blackout_dates
      add constraint blackout_dates_range_check
      check (end_date > start_date) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Atomic overlap protection
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_requests_no_overlap_confirmed'
      and conrelid = 'public.booking_requests'::regclass
  ) then
    alter table public.booking_requests
      add constraint booking_requests_no_overlap_confirmed
      exclude using gist (
        property_id with =,
        daterange(check_in, check_out, '[)') with &&
      )
      where (status = 'confirmed');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'blackout_dates_no_overlap'
      and conrelid = 'public.blackout_dates'::regclass
  ) then
    alter table public.blackout_dates
      add constraint blackout_dates_no_overlap
      exclude using gist (
        property_id with =,
        daterange(start_date, end_date, '[)') with &&
      );
  end if;
end $$;

create index if not exists booking_requests_property_status_dates_idx
  on public.booking_requests (property_id, status, check_in, check_out);

create index if not exists blackout_dates_property_dates_idx
  on public.blackout_dates (property_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- Per-property advisory lock
-- ---------------------------------------------------------------------------

create or replace function public.stay_naples_property_lock(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('stay-naples-availability:' || p_property_id::text, 0)
  );
end;
$$;

revoke all on function public.stay_naples_property_lock(uuid) from public;

-- ---------------------------------------------------------------------------
-- Cross-table triggers
-- ---------------------------------------------------------------------------

create or replace function public.enforce_confirmed_booking_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_overlaps_blackout boolean;
begin
  if NEW.status <> 'confirmed' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE'
     and OLD.status = 'confirmed'
     and OLD.check_in = NEW.check_in
     and OLD.check_out = NEW.check_out
     and OLD.property_id is not distinct from NEW.property_id then
    return NEW;
  end if;

  if NEW.property_id is null then
    raise exception 'A confirmed booking must belong to a property.'
      using errcode = '23514';
  end if;

  perform public.stay_naples_property_lock(NEW.property_id);

  select exists (
    select 1
    from public.blackout_dates d
    where d.property_id = NEW.property_id
      and daterange(d.start_date, d.end_date, '[)')
          && daterange(NEW.check_in, NEW.check_out, '[)')
  ) into v_overlaps_blackout;

  if v_overlaps_blackout then
    raise exception 'booking_conflicts_with_blackout'
      using errcode = '23P01';
  end if;

  return NEW;
end;
$$;

create or replace function public.enforce_blackout_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_overlaps_booking boolean;
begin
  perform public.stay_naples_property_lock(NEW.property_id);

  select exists (
    select 1
    from public.booking_requests b
    where b.property_id = NEW.property_id
      and b.status = 'confirmed'
      and daterange(b.check_in, b.check_out, '[)')
          && daterange(NEW.start_date, NEW.end_date, '[)')
  ) into v_overlaps_booking;

  if v_overlaps_booking then
    raise exception 'blackout_conflicts_with_confirmed_booking'
      using errcode = '23P01';
  end if;

  return NEW;
end;
$$;

drop trigger if exists booking_requests_availability_guard on public.booking_requests;
create trigger booking_requests_availability_guard
  before insert or update of status, check_in, check_out, property_id
  on public.booking_requests
  for each row
  execute function public.enforce_confirmed_booking_availability();

drop trigger if exists blackout_dates_availability_guard on public.blackout_dates;
create trigger blackout_dates_availability_guard
  before insert or update of property_id, start_date, end_date
  on public.blackout_dates
  for each row
  execute function public.enforce_blackout_availability();

-- ---------------------------------------------------------------------------
-- Atomic RPCs used by the admin UI
-- ---------------------------------------------------------------------------

create or replace function public.confirm_booking_request(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.booking_requests%rowtype;
  v_conflict boolean;
begin
  if p_booking_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_booking
  from public.booking_requests
  where id = p_booking_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_booking.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if v_booking.property_id is null then
    return jsonb_build_object('ok', false, 'code', 'missing_property');
  end if;

  if v_booking.check_out <= v_booking.check_in then
    return jsonb_build_object('ok', false, 'code', 'invalid_range');
  end if;

  perform public.stay_naples_property_lock(v_booking.property_id);

  select exists (
    select 1
    from public.booking_requests b
    where b.property_id = v_booking.property_id
      and b.status = 'confirmed'
      and b.id <> v_booking.id
      and daterange(b.check_in, b.check_out, '[)')
          && daterange(v_booking.check_in, v_booking.check_out, '[)')
  ) or exists (
    select 1
    from public.blackout_dates d
    where d.property_id = v_booking.property_id
      and daterange(d.start_date, d.end_date, '[)')
          && daterange(v_booking.check_in, v_booking.check_out, '[)')
  ) into v_conflict;

  if v_conflict then
    return jsonb_build_object('ok', false, 'code', 'conflict');
  end if;

  begin
    update public.booking_requests
    set status = 'confirmed'
    where id = v_booking.id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'code', 'conflict');
  end;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.create_blackout(
  p_property_id uuid,
  p_start date,
  p_end date,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_conflict boolean;
begin
  if p_property_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    return jsonb_build_object('ok', false, 'code', 'invalid_range');
  end if;
  if not exists (select 1 from public.properties p where p.id = p_property_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  perform public.stay_naples_property_lock(p_property_id);

  select exists (
    select 1
    from public.booking_requests b
    where b.property_id = p_property_id
      and b.status = 'confirmed'
      and daterange(b.check_in, b.check_out, '[)')
          && daterange(p_start, p_end, '[)')
  ) into v_conflict;

  if v_conflict then
    return jsonb_build_object('ok', false, 'code', 'booking_conflict');
  end if;

  begin
    insert into public.blackout_dates (property_id, start_date, end_date, note)
    values (p_property_id, p_start, p_end, coalesce(p_note, ''))
    returning id into v_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'code', 'overlap');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- These functions write booking state and blocked dates, so they are backend
-- operations. Only service_role (the server-side key, never shipped to the
-- browser) may execute them.
--
-- "revoke ... from public" alone is NOT enough on Supabase: new objects in the
-- public schema inherit explicit EXECUTE grants for anon and authenticated from
-- the project's default privileges. Both roles must be revoked by name, and the
-- grant to service_role must be explicit so the backend keeps working.

revoke all on function public.stay_naples_property_lock(uuid) from public;
revoke all on function public.enforce_confirmed_booking_availability() from public;
revoke all on function public.enforce_blackout_availability() from public;
revoke all on function public.confirm_booking_request(uuid) from public;
revoke all on function public.create_blackout(uuid, date, date, text) from public;

do $$
declare
  v_role text;
begin
  for v_role in select unnest(array['anon', 'authenticated'])
  loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format(
        'revoke all on function public.stay_naples_property_lock(uuid) from %I', v_role
      );
      execute format(
        'revoke all on function public.enforce_confirmed_booking_availability() from %I', v_role
      );
      execute format(
        'revoke all on function public.enforce_blackout_availability() from %I', v_role
      );
      execute format(
        'revoke all on function public.confirm_booking_request(uuid) from %I', v_role
      );
      execute format(
        'revoke all on function public.create_blackout(uuid, date, date, text) from %I', v_role
      );
    end if;
  end loop;
end $$;

do $$
begin
  -- Verify no browser role kept access through an inherited grant. Failing here
  -- aborts the migration instead of publishing a privileged RPC surface.
  if exists (
    select 1
    from pg_proc p
    join pg_roles r on r.rolname in ('anon', 'authenticated')
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'confirm_booking_request',
        'create_blackout',
        'stay_naples_property_lock',
        'enforce_confirmed_booking_availability',
        'enforce_blackout_availability'
      )
      and has_function_privilege(r.oid, p.oid, 'EXECUTE')
  ) then
    raise exception 'A browser role still has EXECUTE on a privileged availability function';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.confirm_booking_request(uuid) to service_role;
    grant execute on function public.create_blackout(uuid, date, date, text) to service_role;
  end if;
end $$;
