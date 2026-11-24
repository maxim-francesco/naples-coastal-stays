-- Rollback for STEP 06A booking availability protection.
--
-- Run only after the application code has been reverted: the admin UI calls
-- confirm_booking_request and create_blackout, so dropping them first would
-- break the deployed admin calendar. Existing rows are not modified.

drop trigger if exists booking_requests_availability_guard on public.booking_requests;
drop trigger if exists blackout_dates_availability_guard on public.blackout_dates;

drop function if exists public.confirm_booking_request(uuid);
drop function if exists public.create_blackout(uuid, date, date, text);
drop function if exists public.enforce_confirmed_booking_availability();
drop function if exists public.enforce_blackout_availability();
drop function if exists public.stay_naples_property_lock(uuid);

alter table public.booking_requests
  drop constraint if exists booking_requests_no_overlap_confirmed;
alter table public.booking_requests
  drop constraint if exists booking_requests_dates_check;
alter table public.booking_requests
  drop constraint if exists booking_requests_confirmed_property_check;

alter table public.blackout_dates
  drop constraint if exists blackout_dates_no_overlap;
alter table public.blackout_dates
  drop constraint if exists blackout_dates_range_check;

drop index if exists public.booking_requests_property_status_dates_idx;
drop index if exists public.blackout_dates_property_dates_idx;

-- btree_gist is intentionally left installed: other objects may depend on it.
