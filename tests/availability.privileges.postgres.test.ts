import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

// Real PostgreSQL privilege tests for the availability migration.
//
// These tests connect as the roles PostgREST actually uses (anon, authenticated,
// service_role) instead of inspecting SQL strings. They are skipped unless the
// four URLs below are set, which scripts/run-availability-db-tests.sh does
// against a disposable container. Nothing here reaches production.

const adminUrl = process.env["AVAILABILITY_TEST_DATABASE_URL"];
const anonUrl = process.env["AVAILABILITY_TEST_ANON_URL"];
const authenticatedUrl = process.env["AVAILABILITY_TEST_AUTHENTICATED_URL"];
const serviceUrl = process.env["AVAILABILITY_TEST_SERVICE_URL"];

const enabled = Boolean(adminUrl && anonUrl && authenticatedUrl && serviceUrl);

const admin = enabled ? new Bun.SQL(adminUrl!) : null;
const anon = enabled ? new Bun.SQL(anonUrl!) : null;
const authenticated = enabled ? new Bun.SQL(authenticatedUrl!) : null;
const service = enabled ? new Bun.SQL(serviceUrl!) : null;

const describeIfDatabase = enabled ? describe : describe.skip;

type Row = Record<string, unknown>;

const rejection = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error: unknown) {
    const details = error as { code?: string; errno?: string; message?: string };
    return [details.code, details.errno, details.message].filter(Boolean).join(" | ");
  }
  throw new Error("Expected the statement to be rejected, but it succeeded");
};

// jsonb arrives as a parsed object through Bun.SQL and as text through some
// drivers; accept both so the assertion talks about the payload only.
const parseJson = (value: unknown): Row => {
  if (typeof value === "string") return JSON.parse(value) as Row;
  if (value && typeof value === "object") return value as Row;
  throw new Error(`Unexpected RPC result: ${String(value)}`);
};

let propertyId = "";
let otherPropertyId = "";

async function createProperty(slug: string): Promise<string> {
  const rows = (await admin!`
    insert into public.properties
      (slug, name, area, short_description, long_description, max_guests,
       bedrooms, bathrooms, min_nights, base_rate, cleaning_fee, amenities,
       sort_order, is_active)
    values
      (${slug}, ${slug}, 'Naples', 'Test home', '{}', 4,
       2, 2, 3, 250, 100, '{}',
       10, true)
    returning id
  `) as Row[];
  return String(rows[0]!["id"]);
}

async function createBooking(status: string, checkIn: string, checkOut: string): Promise<string> {
  const rows = (await admin!`
    insert into public.booking_requests
      (property_id, guest_name, email, check_in, check_out, guests, message, status)
    values
      (${propertyId}, 'Guest', 'guest@example.test',
       ${checkIn}::date, ${checkOut}::date, 2, '', ${status})
    returning id
  `) as Row[];
  return String(rows[0]!["id"]);
}

const statusOf = async (bookingId: string): Promise<string> => {
  const rows = (await admin!`
    select status from public.booking_requests where id = ${bookingId}::uuid
  `) as Row[];
  return String(rows[0]!["status"]);
};

const blackoutCount = async (): Promise<number> => {
  const rows = (await admin!`select count(*)::int as n from public.blackout_dates`) as Row[];
  return Number(rows[0]!["n"]);
};

beforeAll(async () => {
  if (!enabled) return;
  const rows = (await admin!`
    select exists (
      select 1 from pg_constraint where conname = 'booking_requests_no_overlap_confirmed'
    ) as installed
  `) as Row[];
  if (!rows[0]!["installed"]) {
    throw new Error(
      "The availability migration is not installed in AVAILABILITY_TEST_DATABASE_URL.",
    );
  }
});

beforeEach(async () => {
  if (!enabled) return;
  await admin!`truncate table public.booking_requests, public.blackout_dates, public.properties cascade`;
  propertyId = await createProperty(`home-${crypto.randomUUID()}`);
  otherPropertyId = await createProperty(`home-${crypto.randomUUID()}`);
});

afterAll(async () => {
  await Promise.all([admin?.close(), anon?.close(), authenticated?.close(), service?.close()]);
});

describeIfDatabase("privileged RPC execution privileges", () => {
  test("anonymous visitors cannot execute any privileged function", async () => {
    const booking = await createBooking("new", "2027-01-10", "2027-01-14");

    const calls = [
      anon!`select public.confirm_booking_request(${booking}::uuid)`,
      anon!`select public.create_blackout(${propertyId}::uuid, '2027-02-01'::date, '2027-02-03'::date, 'x')`,
      anon!`select public.stay_naples_property_lock(${propertyId}::uuid)`,
      anon!`select public.enforce_confirmed_booking_availability()`,
      anon!`select public.enforce_blackout_availability()`,
    ];

    for (const call of calls) {
      expect(await rejection(call)).toContain("42501");
    }

    expect(await statusOf(booking)).toBe("new");
    expect(await blackoutCount()).toBe(0);
  });

  test("ordinary authenticated users cannot execute any privileged function", async () => {
    const booking = await createBooking("new", "2027-01-20", "2027-01-24");

    const calls = [
      authenticated!`select public.confirm_booking_request(${booking}::uuid)`,
      authenticated!`select public.create_blackout(${propertyId}::uuid, '2027-03-01'::date, '2027-03-03'::date, 'x')`,
      authenticated!`select public.stay_naples_property_lock(${propertyId}::uuid)`,
      authenticated!`select public.enforce_confirmed_booking_availability()`,
      authenticated!`select public.enforce_blackout_availability()`,
    ];

    for (const call of calls) {
      expect(await rejection(call)).toContain("42501");
    }

    expect(await statusOf(booking)).toBe("new");
    expect(await blackoutCount()).toBe(0);
  });

  test("no browser role keeps EXECUTE on any SECURITY DEFINER function", async () => {
    const rows = (await admin!`
      select p.proname as function_name, r.rolname as role_name
      from pg_proc p
      join pg_roles r on r.rolname in ('anon', 'authenticated')
      where p.pronamespace = 'public'::regnamespace
        and p.prosecdef
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
    `) as Row[];

    expect(rows).toEqual([]);
  });

  test("the backend service role can execute the privileged functions", async () => {
    const booking = await createBooking("new", "2027-04-01", "2027-04-05");

    const confirmed = (await service!`
      select public.confirm_booking_request(${booking}::uuid) as result
    `) as Row[];
    expect(parseJson(confirmed[0]!["result"])).toEqual({ ok: true });

    const blocked = (await service!`
      select public.create_blackout(
        ${otherPropertyId}::uuid, '2027-05-01'::date, '2027-05-04'::date, 'Service'
      ) as result
    `) as Row[];
    expect(parseJson(blocked[0]!["result"])).toMatchObject({ ok: true });
  });

  test("the ACL is explicit: service_role yes, browser roles no", async () => {
    const rows = (await admin!`
      select
        has_function_privilege('service_role', 'public.confirm_booking_request(uuid)', 'EXECUTE') as confirm_service,
        has_function_privilege('authenticated', 'public.confirm_booking_request(uuid)', 'EXECUTE') as confirm_authenticated,
        has_function_privilege('anon', 'public.confirm_booking_request(uuid)', 'EXECUTE') as confirm_anon,
        has_function_privilege('service_role', 'public.create_blackout(uuid, date, date, text)', 'EXECUTE') as blackout_service,
        has_function_privilege('authenticated', 'public.create_blackout(uuid, date, date, text)', 'EXECUTE') as blackout_authenticated,
        has_function_privilege('anon', 'public.create_blackout(uuid, date, date, text)', 'EXECUTE') as blackout_anon
    `) as Row[];

    expect(rows[0]).toEqual({
      confirm_service: true,
      confirm_authenticated: false,
      confirm_anon: false,
      blackout_service: true,
      blackout_authenticated: false,
      blackout_anon: false,
    });
  });

  test("an undefined function fails with 42883 and changes nothing", async () => {
    const booking = await createBooking("new", "2027-06-01", "2027-06-04");

    expect(
      await rejection(service!`select public.confirm_booking_request_absent(${booking}::uuid)`),
    ).toContain("42883");

    expect(await statusOf(booking)).toBe("new");
  });
});

describeIfDatabase("direct client access to booking data", () => {
  test("anonymous and authenticated roles cannot read guest records", async () => {
    await createBooking("new", "2027-07-01", "2027-07-04");

    const anonRows = (await anon!`select id from public.booking_requests`) as Row[];
    const authRows = (await authenticated!`select id from public.booking_requests`) as Row[];
    expect(anonRows).toEqual([]);
    expect(authRows).toEqual([]);

    const anonBlackouts = (await anon!`select id from public.blackout_dates`) as Row[];
    expect(anonBlackouts).toEqual([]);
  });

  test("anonymous and authenticated roles cannot change a booking status", async () => {
    const booking = await createBooking("new", "2027-07-10", "2027-07-14");

    const anonUpdated = (await anon!`
      update public.booking_requests set status = 'confirmed'
      where id = ${booking}::uuid returning id
    `) as Row[];
    const authUpdated = (await authenticated!`
      update public.booking_requests set status = 'confirmed'
      where id = ${booking}::uuid returning id
    `) as Row[];

    expect(anonUpdated).toEqual([]);
    expect(authUpdated).toEqual([]);
    expect(await statusOf(booking)).toBe("new");
  });

  test("anonymous and authenticated roles cannot insert blackout dates", async () => {
    const anonInsert = anon!`
      insert into public.blackout_dates (property_id, start_date, end_date, note)
      values (${propertyId}::uuid, '2027-08-01'::date, '2027-08-03'::date, 'x')
      returning id
    `;
    const authInsert = authenticated!`
      insert into public.blackout_dates (property_id, start_date, end_date, note)
      values (${propertyId}::uuid, '2027-09-01'::date, '2027-09-03'::date, 'x')
      returning id
    `;

    expect(await rejection(anonInsert)).toContain("42501");
    expect(await rejection(authInsert)).toContain("42501");
    expect(await blackoutCount()).toBe(0);
  });

  test("the public calendar data stays readable through the backend", async () => {
    const booking = await createBooking("new", "2027-10-01", "2027-10-05");
    await service!`select public.confirm_booking_request(${booking}::uuid)`;
    await service!`
      insert into public.blackout_dates (property_id, start_date, end_date, note)
      values (${propertyId}::uuid, '2027-10-10'::date, '2027-10-12'::date, 'Owner')
    `;

    const rows = (await service!`
      select check_in, check_out, status
      from public.booking_requests
      where property_id = ${propertyId}::uuid and status = 'confirmed'
    `) as Row[];
    expect(rows).toHaveLength(1);

    const blackouts = (await service!`
      select start_date, end_date from public.blackout_dates where property_id = ${propertyId}::uuid
    `) as Row[];
    expect(blackouts).toHaveLength(1);
  });
});

describeIfDatabase("concurrency under real transactions", () => {
  test("confirm racing a blackout leaves at most one blocker", async () => {
    const booking = await createBooking("new", "2027-11-01", "2027-11-05");

    const [confirmOutcome, blackoutOutcome] = await Promise.allSettled([
      service!`select public.confirm_booking_request(${booking}::uuid) as result`,
      service!`
        select public.create_blackout(
          ${propertyId}::uuid, '2027-11-04'::date, '2027-11-08'::date, 'Race'
        ) as result
      `,
    ]);

    const payload = (outcome: PromiseSettledResult<unknown>) =>
      outcome.status === "fulfilled"
        ? parseJson((outcome.value as Row[])[0]!["result"])
        : { ok: false };

    const confirmed = payload(confirmOutcome);
    const blocked = payload(blackoutOutcome);

    expect([confirmed.ok, blocked.ok].filter(Boolean)).toHaveLength(1);

    const overlaps = (await admin!`
      select count(*)::int as n
      from public.booking_requests b
      join public.blackout_dates d
        on d.property_id = b.property_id
       and daterange(d.start_date, d.end_date, '[)')
           && daterange(b.check_in, b.check_out, '[)')
      where b.status = 'confirmed'
    `) as Row[];
    expect(Number(overlaps[0]!["n"])).toBe(0);
  });

  test("two overlapping blackouts racing produce exactly one", async () => {
    const [first, second] = await Promise.allSettled([
      service!`select public.create_blackout(${propertyId}::uuid, '2027-12-01'::date, '2027-12-05'::date, 'A') as result`,
      service!`select public.create_blackout(${propertyId}::uuid, '2027-12-03'::date, '2027-12-07'::date, 'B') as result`,
    ]);

    const payload = (outcome: PromiseSettledResult<unknown>) =>
      outcome.status === "fulfilled"
        ? parseJson((outcome.value as Row[])[0]!["result"])
        : { ok: false };

    expect([payload(first).ok, payload(second).ok].filter(Boolean)).toHaveLength(1);
    expect(await blackoutCount()).toBe(1);
  });

  test("same-day turnover stays legal for two different reservations", async () => {
    const first = await createBooking("new", "2028-01-05", "2028-01-10");
    const second = await createBooking("new", "2028-01-10", "2028-01-14");

    const one =
      (await service!`select public.confirm_booking_request(${first}::uuid) as result`) as Row[];
    const two =
      (await service!`select public.confirm_booking_request(${second}::uuid) as result`) as Row[];

    expect(parseJson(one[0]!["result"])).toEqual({ ok: true });
    expect(parseJson(two[0]!["result"])).toEqual({ ok: true });
  });

  test("declining a confirmed booking releases the dates to another request", async () => {
    const first = await createBooking("new", "2028-02-01", "2028-02-05");
    await service!`select public.confirm_booking_request(${first}::uuid)`;
    await admin!`update public.booking_requests set status = 'declined' where id = ${first}::uuid`;

    const second = await createBooking("new", "2028-02-03", "2028-02-07");
    const result = (await service!`
      select public.confirm_booking_request(${second}::uuid) as result
    `) as Row[];

    expect(parseJson(result[0]!["result"])).toEqual({ ok: true });
  });

  test("rejected attempts leave the table contents untouched", async () => {
    const booking = await createBooking("new", "2028-03-01", "2028-03-04");
    const before = (await admin!`
      select id, status, check_in, check_out from public.booking_requests order by id
    `) as Row[];

    await rejection(anon!`select public.confirm_booking_request(${booking}::uuid)`);
    await rejection(
      authenticated!`select public.create_blackout(${propertyId}::uuid, '2028-03-02'::date, '2028-03-05'::date, 'x')`,
    );

    const after = (await admin!`
      select id, status, check_in, check_out from public.booking_requests order by id
    `) as Row[];
    expect(after).toEqual(before);
    expect(await blackoutCount()).toBe(0);
  });
});
