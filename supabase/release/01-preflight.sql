-- STEP 06B release preflight.
--
-- READ-ONLY. Run this in the Supabase SQL editor against production BEFORE
-- applying supabase/migrations/202611230001_booking_availability.sql.
--
-- The first result set is the gate: every row must read PASS. The second
-- result set is inventory only (status counts, row totals, date span). Neither
-- result set contains guest names, emails, phone numbers or messages.

with checks as (
  select
    'booking_requests.confirmed_overlap_pairs'::text as check_name,
    '0'::text as expected,
    count(*)::text as actual
  from public.booking_requests a
  join public.booking_requests b
    on b.property_id = a.property_id
   and b.id > a.id
   and b.status = 'confirmed'
  where a.status = 'confirmed'
    and daterange(a.check_in, a.check_out, '[)')
        && daterange(b.check_in, b.check_out, '[)')

  union all
  select 'booking_requests.invalid_ranges', '0', count(*)::text
  from public.booking_requests
  where check_in is null or check_out is null or check_out <= check_in

  union all
  select 'booking_requests.confirmed_without_property', '0', count(*)::text
  from public.booking_requests
  where status = 'confirmed' and property_id is null

  union all
  select 'booking_requests.orphan_property', '0', count(*)::text
  from public.booking_requests b
  where b.property_id is not null
    and not exists (select 1 from public.properties p where p.id = b.property_id)

  union all
  select 'booking_requests.unknown_status', '0', count(*)::text
  from public.booking_requests
  where status not in ('new', 'confirmed', 'declined')

  union all
  select 'blackout_dates.invalid_ranges', '0', count(*)::text
  from public.blackout_dates
  where start_date is null or end_date is null or end_date <= start_date

  union all
  select 'blackout_dates.overlap_pairs', '0', count(*)::text
  from public.blackout_dates a
  join public.blackout_dates b
    on b.property_id = a.property_id
   and b.id > a.id
  where daterange(a.start_date, a.end_date, '[)')
        && daterange(b.start_date, b.end_date, '[)')

  union all
  select 'blackout_dates.confirmed_overlap_pairs', '0', count(*)::text
  from public.blackout_dates d
  join public.booking_requests b
    on b.property_id = d.property_id
   and b.status = 'confirmed'
  where daterange(d.start_date, d.end_date, '[)')
        && daterange(b.check_in, b.check_out, '[)')

  union all
  select 'booking_requests.rls_enabled', 'true', c.relrowsecurity::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'booking_requests'

  union all
  select 'blackout_dates.rls_enabled', 'true', c.relrowsecurity::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'blackout_dates'

  union all
  select 'availability_objects_not_yet_installed', '0', count(*)::text
  from (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'confirm_booking_request',
        'create_blackout',
        'stay_naples_property_lock',
        'enforce_confirmed_booking_availability',
        'enforce_blackout_availability'
      )
    union all
    select 1
    from pg_trigger
    where tgname in (
      'booking_requests_availability_guard',
      'blackout_dates_availability_guard'
    )
    union all
    select 1
    from pg_constraint
    where conname in (
      'booking_requests_no_overlap_confirmed',
      'blackout_dates_no_overlap',
      'booking_requests_dates_check',
      'booking_requests_confirmed_property_check',
      'blackout_dates_range_check'
    )
  ) existing_objects
)
select
  check_name,
  expected,
  actual,
  case when actual = expected then 'PASS' else 'FAIL' end as status
from checks
order by check_name;

-- Inventory only. No guest data.
select
  'booking_requests' as table_name,
  status as bucket,
  count(*) as rows,
  min(check_in) as earliest,
  max(check_out) as latest
from public.booking_requests
group by status

union all

select
  'blackout_dates',
  'all',
  count(*),
  min(start_date),
  max(end_date)
from public.blackout_dates

union all

select
  'properties',
  case when is_active then 'active' else 'inactive' end,
  count(*),
  null,
  null
from public.properties
group by is_active

order by table_name, bucket;
