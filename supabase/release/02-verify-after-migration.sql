-- STEP 06B post-migration verification.
--
-- READ-ONLY. Run after applying the availability migration. Every failure
-- raises an exception, so a caller using psql -v ON_ERROR_STOP=1 gets a
-- non-zero exit status; in the Supabase SQL editor the error identifies the
-- exact broken invariant.

do $$
declare
  v_missing text;
begin
  select string_agg(name, ', ' order by name)
  into v_missing
  from unnest(array[
    'confirm_booking_request(uuid)',
    'create_blackout(uuid,date,date,text)',
    'stay_naples_property_lock(uuid)',
    'enforce_confirmed_booking_availability()',
    'enforce_blackout_availability()'
  ]) as name
  where to_regprocedure('public.' || name) is null;

  if v_missing is not null then
    raise exception 'Missing availability functions: %', v_missing;
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'confirm_booking_request',
        'create_blackout',
        'stay_naples_property_lock',
        'enforce_confirmed_booking_availability',
        'enforce_blackout_availability'
      )
      and (
        not p.prosecdef
        or not exists (
          select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
          where cfg in ('search_path=', 'search_path=""')
        )
      )
  ) then
    raise exception 'A privileged function is not SECURITY DEFINER with an empty search_path.';
  end if;

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
    raise exception 'A browser role can execute a privileged availability function.';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role')
     and not (
       has_function_privilege(
         'service_role', 'public.confirm_booking_request(uuid)', 'EXECUTE'
       )
       and has_function_privilege(
         'service_role', 'public.create_blackout(uuid,date,date,text)', 'EXECUTE'
       )
     ) then
    raise exception 'service_role cannot execute one of the privileged availability functions.';
  end if;

  if (
    select count(*)
    from pg_trigger
    where tgname in (
        'booking_requests_availability_guard',
        'blackout_dates_availability_guard'
      )
      and tgenabled = 'O'
  ) <> 2 then
    raise exception 'The availability triggers are missing or disabled.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.booking_requests'::regclass
      and conname = 'booking_requests_no_overlap_confirmed'
      and contype = 'x'
      and convalidated
  ) then
    raise exception 'booking_requests_no_overlap_confirmed is missing or not validated.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.blackout_dates'::regclass
      and conname = 'blackout_dates_no_overlap'
      and contype = 'x'
      and convalidated
  ) then
    raise exception 'blackout_dates_no_overlap is missing or not validated.';
  end if;

  if to_regclass('public.booking_requests_property_status_dates_idx') is null then
    raise exception 'booking_requests_property_status_dates_idx is missing.';
  end if;

  if to_regclass('public.blackout_dates_property_dates_idx') is null then
    raise exception 'blackout_dates_property_dates_idx is missing.';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname in (
        'booking_requests_dates_check',
        'booking_requests_confirmed_property_check',
        'blackout_dates_range_check'
      )
      and not convalidated
  ) then
    raise notice 'Legacy CHECK constraints are still NOT VALID by design; no new row can violate them.';
  end if;
end $$;

-- Summary. Every number must match the expected comment.
select
  (
    select count(*)
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'confirm_booking_request',
        'create_blackout',
        'stay_naples_property_lock',
        'enforce_confirmed_booking_availability',
        'enforce_blackout_availability'
      )
  ) as privileged_functions,          -- 5
  (
    select count(*)
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
  ) as browser_role_grants,           -- 0
  (
    select count(*)
    from pg_trigger
    where tgname in (
        'booking_requests_availability_guard',
        'blackout_dates_availability_guard'
      )
      and tgenabled = 'O'
  ) as availability_triggers,         -- 2
  (
    select count(*)
    from pg_constraint
    where conname in (
        'booking_requests_no_overlap_confirmed',
        'blackout_dates_no_overlap'
      )
      and contype = 'x'
      and convalidated
  ) as exclusion_constraints,        -- 2
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'booking_requests_property_status_dates_idx',
        'blackout_dates_property_dates_idx'
      )
  ) as supporting_indexes;           -- 2
