import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

// Real PostgreSQL acceptance tests for the availability migration.
//
// Skipped unless AVAILABILITY_TEST_DATABASE_URL points at a disposable
// database with scripts/availability-test-schema.sql and the migration already
// applied. scripts/run-availability-db-tests.sh prepares exactly that.
//
// Nothing here touches production: the URL is a local container.

const databaseUrl = process.env["AVAILABILITY_TEST_DATABASE_URL"];
const sql = databaseUrl ? new Bun.SQL(databaseUrl) : null;

const parseJson = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new Error(`Unexpected RPC result: ${String(value)}`);
};

const rejectionCode = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error: unknown) {
    const details = error as {
      code?: string;
      errno?: string;
      message?: string;
      constraint?: string;
    };
    return [details.code, details.errno, details.message, details.constraint]
      .filter(Boolean)
      .join(" | ");
  }
  throw new Error("Expected the statement to be rejected, but it succeeded");
};

const describeIfDatabase = databaseUrl ? describe : describe.skip;

let propertyId = "";
let otherPropertyId = "";

async function createProperty(slug: string): Promise<string> {
  const rows = await sql!`
    insert into public.properties
      (slug, name, area, short_description, long_description, max_guests,
       bedrooms, bathrooms, min_nights, base_rate, cleaning_fee, amenities,
       sort_order, is_active)
    values
      (${slug}, ${slug}, 'Naples', 'Test home', '{}', 4,
       2, 2, 3, 250, 100, '{}',
       10, true)
    returning id
  `;
  return String((rows[0] as { id: string }).id);
}

async function createBooking(input: {
  property?: string;
  status?: "new" | "confirmed" | "declined";
  checkIn: string;
  checkOut: string;
}): Promise<string> {
  const rows = await sql!`
    insert into public.booking_requests
      (property_id, guest_name, email, check_in, check_out, guests, message, status)
    values
      (${input.property ?? propertyId}, 'Guest', 'guest@example.test',
       ${input.checkIn}::date, ${input.checkOut}::date, 2, '', ${input.status ?? "new"})
    returning id
  `;
  return String((rows[0] as { id: string }).id);
}

async function confirm(bookingId: string): Promise<Record<string, unknown>> {
  const rows = await sql!`
    select public.confirm_booking_request(${bookingId}::uuid) as result
  `;
  return parseJson((rows[0] as { result: unknown }).result);
}

async function createBlackout(
  start: string,
  end: string,
  property: string = propertyId,
): Promise<Record<string, unknown>> {
  const rows = await sql!`
    select public.create_blackout(
      ${property}::uuid, ${start}::date, ${end}::date, 'test'
    ) as result
  `;
  return parseJson((rows[0] as { result: unknown }).result);
}

beforeAll(async () => {
  if (!sql) return;
  const rows = await sql`
    select exists (
      select 1 from pg_constraint where conname = 'booking_requests_no_overlap_confirmed'
    ) as installed
  `;
  if (!(rows[0] as { installed: boolean }).installed) {
    throw new Error(
      "The availability migration is not installed in AVAILABILITY_TEST_DATABASE_URL.",
    );
  }
});

beforeEach(async () => {
  if (!sql) return;
  await sql`truncate table public.booking_requests, public.blackout_dates, public.properties cascade`;
  propertyId = await createProperty(`home-${crypto.randomUUID()}`);
  otherPropertyId = await createProperty(`home-${crypto.randomUUID()}`);
});

afterAll(async () => {
  await sql?.close();
});

describeIfDatabase("PostgreSQL availability constraints", () => {
  test("rejects overlapping confirmed stays but accepts adjacent stays", async () => {
    await createBooking({ status: "confirmed", checkIn: "2027-01-10", checkOut: "2027-01-15" });

    const overlapCode = await rejectionCode(
      createBooking({ status: "confirmed", checkIn: "2027-01-14", checkOut: "2027-01-18" }),
    );
    expect(overlapCode).toContain("23P01");

    const adjacent = await createBooking({
      status: "confirmed",
      checkIn: "2027-01-15",
      checkOut: "2027-01-18",
    });
    expect(adjacent).toBeTruthy();

    const before = await createBooking({
      status: "confirmed",
      checkIn: "2027-01-07",
      checkOut: "2027-01-10",
    });
    expect(before).toBeTruthy();
  });

  test("pending requests may overlap confirmed stays until they are confirmed", async () => {
    const confirmed = await createBooking({
      status: "confirmed",
      checkIn: "2027-02-01",
      checkOut: "2027-02-05",
    });
    const pending = await createBooking({
      status: "new",
      checkIn: "2027-02-02",
      checkOut: "2027-02-04",
    });
    expect(confirmed).toBeTruthy();
    expect(pending).toBeTruthy();

    const result = await confirm(pending);
    expect(result).toEqual({ ok: false, code: "conflict" });
  });

  test("refuses to confirm a request that overlaps a manual blackout", async () => {
    const pending = await createBooking({
      status: "new",
      checkIn: "2027-03-10",
      checkOut: "2027-03-14",
    });
    const blackout = await createBlackout("2027-03-12", "2027-03-16");
    expect(blackout.ok).toBe(true);

    expect(await confirm(pending)).toEqual({ ok: false, code: "conflict" });
  });

  test("refuses to create a blackout over a confirmed booking and allows adjacent ones", async () => {
    await createBooking({ status: "confirmed", checkIn: "2027-04-01", checkOut: "2027-04-05" });

    expect(await createBlackout("2027-04-04", "2027-04-08")).toEqual({
      ok: false,
      code: "booking_conflict",
    });
    expect(await createBlackout("2027-04-05", "2027-04-08")).toEqual({
      ok: true,
      id: expect.any(String),
    });
  });

  test("refuses overlapping manual blackouts", async () => {
    expect((await createBlackout("2027-05-01", "2027-05-05")).ok).toBe(true);
    expect(await createBlackout("2027-05-04", "2027-05-08")).toEqual({
      ok: false,
      code: "overlap",
    });
    expect((await createBlackout("2027-05-05", "2027-05-08")).ok).toBe(true);
  });

  test("a direct status update cannot bypass the blackout trigger", async () => {
    const pending = await createBooking({
      status: "new",
      checkIn: "2027-06-10",
      checkOut: "2027-06-14",
    });
    await createBlackout("2027-06-11", "2027-06-13");

    const code = await rejectionCode(
      sql!`update public.booking_requests set status = 'confirmed' where id = ${pending}::uuid`,
    );
    expect(code).toContain("23P01");
  });

  test("declining a confirmed reservation releases the dates", async () => {
    const first = await createBooking({ checkIn: "2027-07-01", checkOut: "2027-07-05" });
    expect(await confirm(first)).toEqual({ ok: true });

    await sql!`update public.booking_requests set status = 'declined' where id = ${first}::uuid`;

    const second = await createBooking({ checkIn: "2027-07-03", checkOut: "2027-07-07" });
    expect(await confirm(second)).toEqual({ ok: true });
  });

  test("properties are isolated from each other", async () => {
    const first = await createBooking({
      property: propertyId,
      checkIn: "2027-08-01",
      checkOut: "2027-08-05",
    });
    expect(await confirm(first)).toEqual({ ok: true });

    const second = await createBooking({
      property: otherPropertyId,
      checkIn: "2027-08-01",
      checkOut: "2027-08-05",
    });
    expect(await confirm(second)).toEqual({ ok: true });
  });

  test("concurrent confirmations produce at most one booking", async () => {
    const first = await createBooking({ checkIn: "2027-09-01", checkOut: "2027-09-05" });
    const second = await createBooking({ checkIn: "2027-09-03", checkOut: "2027-09-07" });

    const [a, b] = await Promise.all([confirm(first), confirm(second)]);
    const payloads = [a, b];
    const successes = payloads.filter((payload) => payload["ok"] === true);
    const conflicts = payloads.filter((payload) => payload["code"] === "conflict");

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const countRows = await sql!`
      select count(*)::int as count
      from public.booking_requests
      where status = 'confirmed'
    `;
    expect((countRows[0] as { count: number }).count).toBe(1);
  });

  test("confirming twice is idempotent", async () => {
    const booking = await createBooking({ checkIn: "2027-10-01", checkOut: "2027-10-05" });
    expect(await confirm(booking)).toEqual({ ok: true });
    expect(await confirm(booking)).toEqual({ ok: true, already: true });
  });
});
