-- ===========================================================================
-- STEP 10B — production catalog inventory for the availability migration.
--
-- STRICTLY READ-ONLY.
--   * Every statement below is a SELECT over pg_catalog / information_schema.
--   * The block runs inside `begin read only`, so even an accidental write
--     added later would abort instead of touching production.
--   * It prints no guest data: only object definitions, counts, status
--     distribution and the min/max stay dates.
--
-- Purpose: cover what 01-preflight.sql does not — PostgreSQL version,
-- extensions, constraint/trigger/policy/grant/function/index collisions and
-- exact column types — and re-check data integrity in the same pass so one
-- paste gives the full gate.
--
-- How to read the result: exactly one grid.
--   PASS = matches the expected value for a not-yet-migrated database.
--   FAIL = stop, do not apply the migration.
--   INFO = recorded evidence, no pass/fail meaning.
-- Expected on 2026-11-24 (migration not yet applied): no FAIL rows; every
-- availability object count is 0. If the four 'already present' rows and the
-- readiness rows are non-zero instead, the migration was already applied:
-- run 02-verify-after-migration.sql, do not re-apply.
-- ===========================================================================

-- How to run: attach/paste the whole file as one query, with no text selected.
-- If the runner does not accept transaction control, delete the two lines
-- `begin read only;` and `commit;`; the remaining text is a single SELECT and
-- is still strictly read-only (every statement is a catalog/data SELECT).

begin read only;

with migration_constraint_names(name) as (
  select unnest(array[
    'booking_requests_dates_check',
    'booking_requests_confirmed_property_check',
    'blackout_dates_range_check',
    'booking_requests_no_overlap_confirmed',
    'blackout_dates_no_overlap'
  ]::text[])
),
migration_function_names(name) as (
  select unnest(array[
    'stay_naples_property_lock',
    'enforce_confirmed_booking_availability',
    'enforce_blackout_availability',
    'confirm_booking_request',
    'create_blackout'
  ]::text[])
),
migration_trigger_names(name) as (
  select unnest(array[
    'booking_requests_availability_guard',
    'blackout_dates_availability_guard'
  ]::text[])
),
migration_index_names(name) as (
  select unnest(array[
    'booking_requests_property_status_dates_idx',
    'blackout_dates_property_dates_idx'
  ]::text[])
),
checks as (
  -- ---------------------------------------------------------------- server
  select 'A. Server'::text as section, 'postgres_version'::text as check_name,
         current_setting('server_version')::text as actual, 'INFO'::text as expected
  union all
  select 'A. Server', 'postgres_version_supported (>= 15)',
         case when current_setting('server_version_num')::int >= 150000 then 'yes' else 'no' end,
         'yes'
  union all
  select 'A. Server', 'current_database',
         current_database()::text, 'postgres'
  union all
  select 'A. Server', 'current_user',
         current_user::text, 'INFO'
  union all
  select 'A. Server', 'current_user is superuser',
         current_setting('is_superuser')::text, 'INFO'
  union all
  -- Recorded, not gated: preflight only needs SELECT. The migration itself
  -- needs to install btree_gist, so this must be 'yes' on the connection that
  -- will apply it (SQL Editor as the project owner normally is).
  select 'A. Server', 'database CREATE privilege (needed by the migration)',
         case when has_database_privilege(current_database(), 'CREATE')
              then 'yes' else 'no' end,
         'INFO'

  -- ------------------------------------------------------------ extensions
  union all
  select 'B. Extensions', 'btree_gist installed',
         coalesce((select 'yes' from pg_extension where extname = 'btree_gist'), 'no'),
         'INFO'
  union all
  -- Production does not have btree_gist yet. The migration installs it, so the
  -- gate is that the extension is *available* to install, not that it exists.
  select 'B. Extensions', 'btree_gist available to install',
         coalesce((
           select case when default_version is null or default_version = ''
                       then 'no' else 'yes' end
           from pg_available_extensions
           where name = 'btree_gist'
         ), 'no'),
         'yes'
  union all
  select 'B. Extensions', 'btree_gist version',
         coalesce((select extversion from pg_extension where extname = 'btree_gist'), 'n/a'),
         'INFO'
  union all
  select 'B. Extensions', 'btree_gist schema',
         coalesce((
           select n.nspname
           from pg_extension e
           join pg_namespace n on n.oid = e.extnamespace
           where e.extname = 'btree_gist'
         ), 'n/a'),
         'INFO'
  union all
  -- The exclusion constraint uses `property_id with =`; that operator class
  -- must be resolvable through the search_path of the role applying the
  -- migration, otherwise the ALTER TABLE fails. If btree_gist is absent the
  -- migration installs it into a visible schema, so that case is fine.
  select 'B. Extensions', 'gist uuid opclass resolvable (unless btree_gist absent)',
         case
           when not exists (select 1 from pg_extension where extname = 'btree_gist')
             then 'ok'
           when exists (
             select 1 from pg_opclass oc
             where oc.opcname = 'gist_uuid_ops'
               and pg_opclass_is_visible(oc.oid)
           ) then 'ok'
           else 'blocked'
         end,
         'ok'

  -- -------------------------------------------------------- tables and RLS
  union all
  select 'C. Tables', 'booking_requests exists',
         case when to_regclass('public.booking_requests') is null then 'no' else 'yes' end,
         'yes'
  union all
  select 'C. Tables', 'blackout_dates exists',
         case when to_regclass('public.blackout_dates') is null then 'no' else 'yes' end,
         'yes'
  union all
  select 'C. Tables', 'properties exists',
         case when to_regclass('public.properties') is null then 'no' else 'yes' end,
         'yes'
  union all
  select 'C. Tables', 'booking_requests RLS enabled',
         coalesce((select case when relrowsecurity then 'yes' else 'no' end
                   from pg_class where oid = 'public.booking_requests'::regclass), 'n/a'),
         'yes'
  union all
  select 'C. Tables', 'blackout_dates RLS enabled',
         coalesce((select case when relrowsecurity then 'yes' else 'no' end
                   from pg_class where oid = 'public.blackout_dates'::regclass), 'n/a'),
         'yes'
  union all
  select 'C. Tables', 'properties RLS enabled',
         coalesce((select case when relrowsecurity then 'yes' else 'no' end
                   from pg_class where oid = 'public.properties'::regclass), 'n/a'),
         'INFO'
  union all
  select 'C. Tables', 'booking_requests RLS forced',
         coalesce((select case when relforcerowsecurity then 'yes' else 'no' end
                   from pg_class where oid = 'public.booking_requests'::regclass), 'n/a'),
         'INFO'
  union all
  select 'C. Tables', 'blackout_dates RLS forced',
         coalesce((select case when relforcerowsecurity then 'yes' else 'no' end
                   from pg_class where oid = 'public.blackout_dates'::regclass), 'n/a'),
         'INFO'

  -- --------------------------------------------------------------- columns
  union all
  select 'D. Columns', 'booking_requests column count',
         (select count(*)::text from information_schema.columns
          where table_schema = 'public' and table_name = 'booking_requests'),
         '11'
  union all
  select 'D. Columns', 'booking_requests key column types',
         (select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
          from information_schema.columns
          where table_schema = 'public' and table_name = 'booking_requests'
            and column_name in ('property_id', 'check_in', 'check_out', 'status')),
         'property_id uuid, check_in date, check_out date, status text'
  union all
  select 'D. Columns', 'blackout_dates column count',
         (select count(*)::text from information_schema.columns
          where table_schema = 'public' and table_name = 'blackout_dates'),
         '6'
  union all
  select 'D. Columns', 'blackout_dates key column types',
         (select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
          from information_schema.columns
          where table_schema = 'public' and table_name = 'blackout_dates'
            and column_name in ('property_id', 'start_date', 'end_date')),
         'property_id uuid, start_date date, end_date date'
  union all
  select 'D. Columns', 'booking_requests.property_id nullable',
         (select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'booking_requests'
            and column_name = 'property_id'),
         'INFO'
  union all
  select 'D. Columns', 'blackout_dates.property_id nullable',
         (select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'blackout_dates'
            and column_name = 'property_id'),
         'INFO'

  -- ----------------------------------------------------------- constraints
  union all
  select 'E. Constraints', 'booking_requests existing constraints',
         coalesce((
           select string_agg(c.conname || ' :: ' || pg_get_constraintdef(c.oid), ' | '
                             order by c.conname)
           from pg_constraint c
           where c.conrelid = 'public.booking_requests'::regclass
         ), 'none'),
         'INFO'
  union all
  select 'E. Constraints', 'blackout_dates existing constraints',
         coalesce((
           select string_agg(c.conname || ' :: ' || pg_get_constraintdef(c.oid), ' | '
                             order by c.conname)
           from pg_constraint c
           where c.conrelid = 'public.blackout_dates'::regclass
         ), 'none'),
         'INFO'
  union all
  -- The migration skips an object when a same-named constraint already exists
  -- on the same table. A same-named constraint with a different definition
  -- would therefore be silently kept: it must not exist.
  select 'E. Constraints', 'migration constraint names already present on target tables',
         (select count(*)::text
          from pg_constraint c
          where c.conrelid in ('public.booking_requests'::regclass,
                               'public.blackout_dates'::regclass)
            and c.conname in (select name from migration_constraint_names)),
         '0'

  -- -------------------------------------------------------------- triggers
  union all
  select 'F. Triggers', 'booking_requests user triggers',
         coalesce((
           select string_agg(t.tgname || ' :: ' || pg_get_triggerdef(t.oid), ' | '
                             order by t.tgname)
           from pg_trigger t
           where t.tgrelid = 'public.booking_requests'::regclass
             and not t.tgisinternal
         ), 'none'),
         'INFO'
  union all
  select 'F. Triggers', 'blackout_dates user triggers',
         coalesce((
           select string_agg(t.tgname || ' :: ' || pg_get_triggerdef(t.oid), ' | '
                             order by t.tgname)
           from pg_trigger t
           where t.tgrelid = 'public.blackout_dates'::regclass
             and not t.tgisinternal
         ), 'none'),
         'INFO'
  union all
  select 'F. Triggers', 'migration trigger names already present',
         (select count(*)::text from pg_trigger
          where tgname in (select name from migration_trigger_names)),
         '0'

  -- ------------------------------------------------------------- functions
  union all
  select 'G. Functions', 'migration function names already present in public',
         (select count(*)::text
          from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in (select name from migration_function_names)),
         '0'
  union all
  select 'G. Functions', 'same-named functions in any schema',
         coalesce((
           select string_agg(n.nspname || '.' || p.proname || '('
                             || pg_get_function_identity_arguments(p.oid) || ')', ', '
                             order by n.nspname, p.proname)
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where p.proname in (select name from migration_function_names)
         ), 'none'),
         'INFO'

  -- -------------------------------------------------------------- policies
  union all
  select 'H. Policies', 'booking_requests policies',
         coalesce((
           select string_agg(policyname || ' [' || cmd || '] roles='
                             || array_to_string(roles, ','), ' | ' order by policyname)
           from pg_policies
           where schemaname = 'public' and tablename = 'booking_requests'
         ), 'none'),
         'INFO'
  union all
  select 'H. Policies', 'blackout_dates policies',
         coalesce((
           select string_agg(policyname || ' [' || cmd || '] roles='
                             || array_to_string(roles, ','), ' | ' order by policyname)
           from pg_policies
           where schemaname = 'public' and tablename = 'blackout_dates'
         ), 'none'),
         'INFO'
  union all
  select 'H. Policies', 'properties policies',
         coalesce((
           select string_agg(policyname || ' [' || cmd || '] roles='
                             || array_to_string(roles, ','), ' | ' order by policyname)
           from pg_policies
           where schemaname = 'public' and tablename = 'properties'
         ), 'none'),
         'INFO'

  -- ---------------------------------------------------------------- grants
  union all
  -- Supabase grants broad table privileges to anon/authenticated by default;
  -- RLS is what confines them. This row is evidence, not a gate.
  select 'I. Grants', 'table grants for anon/authenticated/service_role',
         coalesce((
           select string_agg(tp.table_name || ':' || tp.grantee || ':' || tp.privilege_type,
                             ', ' order by tp.table_name, tp.grantee, tp.privilege_type)
           from information_schema.table_privileges tp
           where tp.table_schema = 'public'
             and tp.table_name in ('booking_requests', 'blackout_dates', 'properties')
             and tp.grantee in ('anon', 'authenticated', 'service_role')
         ), 'none'),
         'INFO'
  union all
  select 'I. Grants', 'browser role EXECUTE on availability functions',
         (select count(*)::text
          from pg_proc p
          join pg_roles r on r.rolname in ('anon', 'authenticated')
          where p.pronamespace = 'public'::regnamespace
            and p.proname in (select name from migration_function_names)
            and has_function_privilege(r.oid, p.oid, 'EXECUTE')),
         '0'
  union all
  select 'I. Grants', 'service_role EXECUTE on availability functions',
         (select count(*)::text
          from pg_proc p
          join pg_roles r on r.rolname = 'service_role'
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('confirm_booking_request', 'create_blackout')
            and has_function_privilege(r.oid, p.oid, 'EXECUTE')),
         'INFO'

  -- --------------------------------------------------------------- indexes
  union all
  select 'J. Indexes', 'booking_requests indexes',
         coalesce((
           select string_agg(i.indexname || ' :: ' || i.indexdef, ' | ' order by i.indexname)
           from pg_indexes i
           where i.schemaname = 'public' and i.tablename = 'booking_requests'
         ), 'none'),
         'INFO'
  union all
  select 'J. Indexes', 'blackout_dates indexes',
         coalesce((
           select string_agg(i.indexname || ' :: ' || i.indexdef, ' | ' order by i.indexname)
           from pg_indexes i
           where i.schemaname = 'public' and i.tablename = 'blackout_dates'
         ), 'none'),
         'INFO'
  union all
  select 'J. Indexes', 'migration index names already present',
         (select count(*)::text from pg_indexes
          where schemaname = 'public'
            and indexname in (select name from migration_index_names)),
         '0'

  -- ---------------------------------------------------------- data integrity
  union all
  select 'K. Data', 'confirmed_overlap_pairs',
         (select count(*)::text
          from public.booking_requests a
          join public.booking_requests b
            on a.id < b.id
           and a.property_id = b.property_id
           and a.status = 'confirmed'
           and b.status = 'confirmed'
           and daterange(a.check_in, a.check_out, '[)')
               && daterange(b.check_in, b.check_out, '[)')),
         '0'
  union all
  select 'K. Data', 'invalid_booking_ranges',
         (select count(*)::text from public.booking_requests
          where check_out <= check_in),
         '0'
  union all
  select 'K. Data', 'confirmed_without_property',
         (select count(*)::text from public.booking_requests
          where status = 'confirmed' and property_id is null),
         '0'
  union all
  select 'K. Data', 'bookings_with_unknown_property',
         (select count(*)::text
          from public.booking_requests b
          where b.property_id is not null
            and not exists (select 1 from public.properties p where p.id = b.property_id)),
         '0'
  union all
  select 'K. Data', 'unknown_booking_status',
         (select count(*)::text from public.booking_requests
          where status not in ('new', 'confirmed', 'declined')),
         '0'
  union all
  select 'K. Data', 'blackout_invalid_ranges',
         (select count(*)::text from public.blackout_dates
          where end_date <= start_date),
         '0'
  union all
  select 'K. Data', 'blackout_overlap_pairs',
         (select count(*)::text
          from public.blackout_dates a
          join public.blackout_dates b
            on a.id < b.id
           and a.property_id = b.property_id
           and daterange(a.start_date, a.end_date, '[)')
               && daterange(b.start_date, b.end_date, '[)')),
         '0'
  union all
  select 'K. Data', 'confirmed_booking_blackout_overlap_pairs',
         (select count(*)::text
          from public.booking_requests b
          join public.blackout_dates d
            on b.property_id = d.property_id
           and b.status = 'confirmed'
           and daterange(b.check_in, b.check_out, '[)')
               && daterange(d.start_date, d.end_date, '[)')),
         '0'
  union all
  select 'K. Data', 'row_counts booking_requests/blackout_dates/properties',
         (select (select count(*) from public.booking_requests)::text || ' / '
                 || (select count(*) from public.blackout_dates)::text || ' / '
                 || (select count(*) from public.properties)::text),
         'INFO'
  union all
  select 'K. Data', 'booking_status_distribution',
         coalesce((
           select string_agg(status || '=' || cnt, ', ' order by status)
           from (select status, count(*)::text as cnt
                 from public.booking_requests group by status) s
         ), 'none'),
         'INFO'
  union all
  select 'K. Data', 'stay_date_span booking_requests',
         coalesce((
           select min(check_in)::text || ' .. ' || max(check_out)::text
           from public.booking_requests
         ), 'none'),
         'INFO'

  -- -------------------------------------------------------------- readiness
  union all
  -- 0 = migration not applied yet (expected). 5 = already applied: run
  -- 02-verify-after-migration.sql instead of applying it again.
  select 'L. Readiness', 'availability functions installed',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (select name from migration_function_names)),
         '0'
  union all
  select 'L. Readiness', 'availability triggers installed',
         (select count(*)::text from pg_trigger
          where tgname in (select name from migration_trigger_names)),
         '0'
  union all
  select 'L. Readiness', 'availability constraints installed',
         (select count(*)::text from pg_constraint
          where conname in (select name from migration_constraint_names)),
         '0'
)
select section,
       check_name,
       actual,
       expected,
       case
         when expected = 'INFO' then 'INFO'
         when actual is not distinct from expected then 'PASS'
         else 'FAIL'
       end as status
from checks
order by section, check_name;

commit;
