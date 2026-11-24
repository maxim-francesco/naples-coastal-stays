#!/usr/bin/env bash
# Runs the STEP 06A PostgreSQL acceptance tests against a throwaway container.
#
# This is the only script that starts a database. It uses a unique container
# name and port and removes only that container on exit. It never touches the
# user's existing Supabase or project containers.

set -euo pipefail

CONTAINER="stay-naples-availability-test"
PORT="${AVAILABILITY_TEST_PORT:-55433}"
PASSWORD="local-availability-test"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Removing the previous disposable test container..."
  docker rm -f "$CONTAINER" >/dev/null
fi

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

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
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$ROOT/scripts/availability-test-schema.sql" >/dev/null

echo "Applying the availability migration..."
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$ROOT/supabase/migrations/202611230001_booking_availability.sql" >/dev/null

echo "Exercising the migration against real PostgreSQL..."
export AVAILABILITY_TEST_DATABASE_URL="postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres"
export AVAILABILITY_TEST_ANON_URL="postgres://anon:anon-local-test@127.0.0.1:${PORT}/postgres"
export AVAILABILITY_TEST_AUTHENTICATED_URL="postgres://authenticated:authenticated-local-test@127.0.0.1:${PORT}/postgres"
export AVAILABILITY_TEST_SERVICE_URL="postgres://service_role:service-role-local-test@127.0.0.1:${PORT}/postgres"

# Run the files one after another: both truncate the same tables.
bun test "$ROOT/tests/availability.postgres.test.ts"
bun test "$ROOT/tests/availability.privileges.postgres.test.ts"

echo "Disposable database tests finished; container removed."
