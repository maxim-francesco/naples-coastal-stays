#!/usr/bin/env bash
# Rehearses the STEP 06B release on a disposable PostgreSQL container:
# preflight -> migration -> verification -> rollback -> data integrity.
#
# It exists to prove two things before production:
#   1. the secured migration applies cleanly to a schema that already holds
#      legacy booking rows (all declined, as production is today);
#   2. the rollback is complete: no function, trigger, constraint or index
#      survives, and every row is byte-identical afterwards.
#
# It uses a unique container name and port and removes only that container.
# It never touches the user's Supabase project or existing containers.

set -euo pipefail

CONTAINER="stay-naples-release-check"
PORT="${AVAILABILITY_TEST_PORT:-55442}"
PASSWORD="local-release-check"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MIGRATION="$ROOT/supabase/migrations/202611230001_booking_availability.sql"
ROLLBACK="$ROOT/supabase/migrations/rollback/202611230001_booking_availability.rollback.sql"
PREFLIGHT="$ROOT/supabase/release/01-preflight.sql"
VERIFY="$ROOT/supabase/release/02-verify-after-migration.sql"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Removing the previous release-check container..."
  docker rm -f "$CONTAINER" >/dev/null
fi

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql_file() {
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres
}

query() {
  docker exec "$CONTAINER" psql -tA -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"
}

echo "Starting disposable PostgreSQL on 127.0.0.1:${PORT}..."
docker run -d \
  --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  -p "127.0.0.1:${PORT}:5432" \
  postgres:17-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
  echo "PostgreSQL did not become ready." >&2
  exit 1
fi

echo "Applying the base test schema..."
psql_file < "$ROOT/scripts/availability-test-schema.sql" >/dev/null

echo "Seeding legacy rows (mirrors the production shape: declined requests only)..."
psql_file >/dev/null <<'SQL'
insert into public.properties
  (id, slug, name, area, short_description, max_guests, bedrooms, bathrooms,
   min_nights, base_rate, cleaning_fee, is_active)
values
  ('11111111-1111-4111-8111-111111111111', 'casa-marina', 'Casa Marina',
   'Chiaia', 'Fixture property one.', 6, 3, 2, 3, 250, 90, true),
  ('22222222-2222-4222-8222-222222222222', 'turtle-lake', 'Turtle Lake',
   'Vomero', 'Fixture property two.', 4, 2, 1, 2, 180, 60, true);

insert into public.booking_requests
  (id, property_id, guest_name, email, check_in, check_out, guests, message, status)
values
  ('aaaaaaaa-1111-4111-8111-000000000001',
   '11111111-1111-4111-8111-111111111111', 'Legacy One', 'one@example.test',
   '2026-09-01', '2026-09-04', 2, 'declined fixture', 'declined'),
  ('aaaaaaaa-1111-4111-8111-000000000002',
   '11111111-1111-4111-8111-111111111111', 'Legacy Two', 'two@example.test',
   '2026-09-10', '2026-09-14', 3, 'declined fixture', 'declined'),
  ('aaaaaaaa-1111-4111-8111-000000000003',
   '22222222-2222-4222-8222-222222222222', 'Legacy Three', 'three@example.test',
   '2026-10-02', '2026-10-05', 2, 'declined fixture', 'declined'),
  ('aaaaaaaa-1111-4111-8111-000000000004',
   '11111111-1111-4111-8111-111111111111', 'Pending One', 'pending@example.test',
   '2027-03-01', '2027-03-05', 2, 'pending fixture', 'new');
SQL

checksum_bookings() {
  query "select count(*)::text || ':' ||
         coalesce(sum(hashtextextended(
           id::text || '|' || coalesce(property_id::text, '') || '|' || guest_name || '|' ||
           email || '|' || check_in::text || '|' || check_out::text || '|' || guests::text ||
           '|' || coalesce(message, '') || '|' || status, 0)), 0)::text
         from public.booking_requests;"
}

checksum_blackouts() {
  query "select count(*)::text || ':' ||
         coalesce(sum(hashtextextended(
           id::text || '|' || property_id::text || '|' || start_date::text || '|' ||
           end_date::text || '|' || coalesce(note, ''), 0)), 0)::text
         from public.blackout_dates;"
}

BEFORE_BOOKINGS="$(checksum_bookings)"
BEFORE_BLACKOUTS="$(checksum_blackouts)"

echo "Running the production preflight against the seeded schema..."
PREFLIGHT_OUT="$(psql_file < "$PREFLIGHT")"
if grep -q 'FAIL' <<<"$PREFLIGHT_OUT"; then
  echo "$PREFLIGHT_OUT" >&2
  echo "Preflight failed; refusing to continue." >&2
  exit 1
fi
echo "Preflight: all checks PASS."

echo "Applying the migration..."
psql_file < "$MIGRATION" >/dev/null

echo "Verifying the installed objects and privileges..."
psql_file < "$VERIFY"

echo "Confirming the browser roles are locked out on the real database..."
for role in anon authenticated; do
  if docker exec -e PGPASSWORD="${role}-local-test" "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$role" -d postgres \
    -c "select public.confirm_booking_request('aaaaaaaa-1111-4111-8111-000000000004');" \
    >/dev/null 2>&1; then
    echo "ERROR: ${role} could execute confirm_booking_request." >&2
    exit 1
  fi
done
echo "anon and authenticated are denied."

echo "Confirming service_role can execute the privileged RPC..."
SERVICE_RESULT="$(docker exec -e PGPASSWORD="service-role-local-test" "$CONTAINER" \
  psql -tA -v ON_ERROR_STOP=1 -U service_role -d postgres \
  -c "select public.confirm_booking_request('aaaaaaaa-1111-4111-8111-000000000004');")"
if [[ "$SERVICE_RESULT" != *'"ok": true'* ]]; then
  echo "ERROR: service_role could not confirm the pending request (got ${SERVICE_RESULT})." >&2
  exit 1
fi
echo "service_role confirmed the pending request."

# The confirmation above is the only intentional write in this disposable
# database. This checksum becomes the baseline the rollback must preserve.
EXPECTED_BOOKINGS="$(checksum_bookings)"

echo "Applying the rollback..."
psql_file < "$ROLLBACK" >/dev/null

echo "Checking the rollback removed every object..."
REMAINING="$(query "select
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('confirm_booking_request', 'create_blackout',
                      'stay_naples_property_lock',
                      'enforce_confirmed_booking_availability',
                      'enforce_blackout_availability'))
  + (select count(*) from pg_trigger
      where tgname in ('booking_requests_availability_guard',
                       'blackout_dates_availability_guard'))
  + (select count(*) from pg_constraint
      where conname in ('booking_requests_no_overlap_confirmed',
                        'blackout_dates_no_overlap',
                        'booking_requests_dates_check',
                        'booking_requests_confirmed_property_check',
                        'blackout_dates_range_check'))
  + (select count(*) from pg_indexes
      where schemaname = 'public'
        and indexname in ('booking_requests_property_status_dates_idx',
                          'blackout_dates_property_dates_idx'));")"
if [[ "$REMAINING" != "0" ]]; then
  echo "ERROR: ${REMAINING} availability object(s) survived the rollback." >&2
  exit 1
fi
echo "Rollback removed all availability objects."

echo "Checking no row was modified..."
AFTER_BOOKINGS="$(checksum_bookings)"
AFTER_BLACKOUTS="$(checksum_blackouts)"
if [[ "$EXPECTED_BOOKINGS" != "$AFTER_BOOKINGS" ]]; then
  echo "ERROR: booking_requests changed (${EXPECTED_BOOKINGS} -> ${AFTER_BOOKINGS})." >&2
  exit 1
fi
if [[ "$BEFORE_BLACKOUTS" != "$AFTER_BLACKOUTS" ]]; then
  echo "ERROR: blackout_dates changed (${BEFORE_BLACKOUTS} -> ${AFTER_BLACKOUTS})." >&2
  exit 1
fi

echo "booking_requests checksum (seeded):            ${BEFORE_BOOKINGS}"
echo "booking_requests checksum (after RPC + rollback): ${AFTER_BOOKINGS}"
echo "blackout_dates checksum:                        ${AFTER_BLACKOUTS}"
echo
echo
echo "Release rehearsal finished: migration applies, privileges hold, rollback is clean."
