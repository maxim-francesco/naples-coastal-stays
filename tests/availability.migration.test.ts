import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Static guard for the prepared migration. The real behaviour is exercised by
// tests/availability.postgres.test.ts on a disposable PostgreSQL container.

const root = join(import.meta.dir, "..");
const migration = readFileSync(
  join(root, "supabase", "migrations", "202611230001_booking_availability.sql"),
  "utf8",
);
const rollback = readFileSync(
  join(
    root,
    "supabase",
    "migrations",
    "rollback",
    "202611230001_booking_availability.rollback.sql",
  ),
  "utf8",
);

describe("availability migration", () => {
  test("keeps booking-booking protection in the database", () => {
    expect(migration).toContain("create extension if not exists btree_gist");
    expect(migration).toContain("booking_requests_no_overlap_confirmed");
    expect(migration).toContain("exclude using gist");
    expect(migration).toContain("daterange(check_in, check_out, '[)') with &&");
    expect(migration).toContain("where (status = 'confirmed')");
  });

  test("keeps manual blackouts atomic and strictly non-overlapping", () => {
    expect(migration).toContain("blackout_dates_no_overlap");
    expect(migration).toContain("daterange(start_date, end_date, '[)') with &&");
    expect(migration).toContain("blackout_conflicts_with_confirmed_booking");
    expect(migration).toContain("booking_conflicts_with_blackout");
  });

  test("serializes writers per property and exposes the admin RPCs", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("stay_naples_property_lock");
    expect(migration).toContain("create or replace function public.confirm_booking_request");
    expect(migration).toContain("create or replace function public.create_blackout");
    expect(migration).toContain(
      "revoke all on function public.confirm_booking_request(uuid) from public",
    );
    expect(migration).toContain(
      "grant execute on function public.confirm_booking_request(uuid) to service_role",
    );
  });

  test("never lets a browser role execute the privileged functions", () => {
    // Supabase grants EXECUTE to anon/authenticated through default privileges,
    // so revoking PUBLIC alone is not enough: both roles must be revoked by name.
    expect(migration).toContain("revoke all on function public.confirm_booking_request(uuid)");
    expect(migration).toContain(
      "revoke all on function public.create_blackout(uuid, date, date, text)",
    );
    expect(migration).toContain("revoke all on function public.stay_naples_property_lock(uuid)");
    expect(migration).toContain("array['anon', 'authenticated']");
    expect(migration).toContain("has_function_privilege");

    const forbiddenGrants = [
      /grant\s+execute\s+on\s+function\s+[^;]*\bto\s+authenticated\b/i,
      /grant\s+execute\s+on\s+function\s+[^;]*\bto\s+anon\b/i,
      /grant\s+execute\s+on\s+function\s+[^;]*\bto\s+public\b/i,
    ];
    for (const pattern of forbiddenGrants) {
      expect(pattern.test(migration)).toBe(false);
    }
  });

  test("pins search_path on every SECURITY DEFINER function", () => {
    const definers = migration.match(/security definer/gi) ?? [];
    const pinned = migration.match(/set search_path = ''/g) ?? [];
    expect(definers.length).toBe(5);
    expect(pinned.length).toBe(definers.length);
  });

  test("does not destroy existing data", () => {
    const destructive = /drop\s+table|truncate\s+table|delete\s+from/i;
    expect(destructive.test(migration)).toBe(false);
    expect(migration).toContain("not valid");
  });

  test("rollback removes every object the migration creates", () => {
    for (const object of [
      "booking_requests_availability_guard",
      "blackout_dates_availability_guard",
      "confirm_booking_request",
      "create_blackout",
      "booking_requests_no_overlap_confirmed",
      "blackout_dates_no_overlap",
      "stay_naples_property_lock",
    ]) {
      expect(rollback).toContain(object);
    }
    expect(/drop\s+table|truncate\s+table|delete\s+from/i.test(rollback)).toBe(false);
  });
});
