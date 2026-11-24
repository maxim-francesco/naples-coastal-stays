import { describe, expect, test } from "bun:test";
import {
  addDaysToDateOnly,
  blockedDateSet,
  blockingRanges,
  dateOnlyToLocalDate,
  daysBetweenDateOnly,
  eachDateOnly,
  findAvailabilityConflict,
  isValidDateOnly,
  localDateToDateOnly,
  normalizeAvailabilityRange,
  rangesOverlap,
  todayInTimeZone,
  unavailableDateObjects,
  validateStayRequest,
  type AvailabilityRange,
} from "../src/lib/availability";

// Pure engine tests: no database, no browser, no network.

const range = (start: string, end: string): AvailabilityRange => ({ start, end });

const baseInput = {
  checkIn: "2026-12-10",
  checkOut: "2026-12-15",
  guests: 2,
  maxGuests: 4,
  minNights: 3,
  today: "2026-11-23",
  unavailable: [] as AvailabilityRange[],
};

describe("date-only primitives", () => {
  test("accepts real calendar dates and rejects impossible ones", () => {
    expect(isValidDateOnly("2026-11-23")).toBe(true);
    expect(isValidDateOnly("2028-02-29")).toBe(true);
    expect(isValidDateOnly("2026-02-29")).toBe(false);
    expect(isValidDateOnly("2026-13-01")).toBe(false);
    expect(isValidDateOnly("2026-11-31")).toBe(false);
    expect(isValidDateOnly("23/11/2026")).toBe(false);
    expect(isValidDateOnly("")).toBe(false);
  });

  test("adds days across month and DST boundaries", () => {
    expect(addDaysToDateOnly("2026-12-30", 2)).toBe("2027-01-01");
    expect(addDaysToDateOnly("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDaysToDateOnly("2026-11-01", -1)).toBe("2026-10-31");
  });

  test("counts nights as a half-open difference", () => {
    expect(daysBetweenDateOnly("2026-12-10", "2026-12-15")).toBe(5);
    expect(daysBetweenDateOnly("2026-12-15", "2026-12-10")).toBe(-5);
    expect(daysBetweenDateOnly("2026-12-10", "2026-12-10")).toBe(0);
  });

  test("enumerates every occupied night, never the checkout day", () => {
    expect(eachDateOnly("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
    expect(eachDateOnly("2026-12-10", "2026-12-10")).toEqual([]);
    expect(eachDateOnly("2026-12-11", "2026-12-10")).toEqual([]);
  });

  test("resolves today in America/New_York, not UTC", () => {
    expect(todayInTimeZone(new Date("2026-11-23T03:30:00Z"))).toBe("2026-11-22");
    expect(todayInTimeZone(new Date("2026-11-23T05:30:00Z"))).toBe("2026-11-23");
    // During daylight saving time New York is UTC-4.
    expect(todayInTimeZone(new Date("2026-07-01T03:30:00Z"))).toBe("2026-06-30");
  });

  test("round-trips through local Date objects without shifting the day", () => {
    expect(localDateToDateOnly(dateOnlyToLocalDate("2026-12-31"))).toBe("2026-12-31");
    expect(localDateToDateOnly(dateOnlyToLocalDate("2028-02-29"))).toBe("2028-02-29");
  });
});

describe("half-open range semantics", () => {
  test("adjacent stays do not overlap (same-day turnover)", () => {
    expect(
      rangesOverlap(range("2026-12-01", "2026-12-05"), range("2026-12-05", "2026-12-09")),
    ).toBe(false);
    expect(
      rangesOverlap(range("2026-12-05", "2026-12-09"), range("2026-12-01", "2026-12-05")),
    ).toBe(false);
  });

  test("sharing any night overlaps", () => {
    expect(
      rangesOverlap(range("2026-12-01", "2026-12-05"), range("2026-12-04", "2026-12-09")),
    ).toBe(true);
    expect(
      rangesOverlap(range("2026-12-01", "2026-12-05"), range("2026-12-02", "2026-12-03")),
    ).toBe(true);
  });

  test("normalizes invalid ranges away", () => {
    expect(normalizeAvailabilityRange(range("2026-12-05", "2026-12-05"))).toBeNull();
    expect(normalizeAvailabilityRange(range("2026-12-06", "2026-12-05"))).toBeNull();
    expect(normalizeAvailabilityRange({ start: "2026-12-01", end: "not-a-date" })).toBeNull();
  });
});

describe("blocking sources", () => {
  test("confirmed bookings block; pending and declined requests do not", () => {
    const unavailable = blockingRanges({
      bookings: [
        { checkIn: "2026-12-01", checkOut: "2026-12-05", status: "confirmed" },
        { checkIn: "2026-12-06", checkOut: "2026-12-09", status: "new" },
        { checkIn: "2026-12-10", checkOut: "2026-12-12", status: "declined" },
      ],
    });
    expect(unavailable).toEqual([range("2026-12-01", "2026-12-05")]);
  });

  test("manual blackouts block independently of bookings", () => {
    const unavailable = blockingRanges({
      blackouts: [range("2026-11-28", "2026-12-01")],
      bookings: [],
    });
    expect(unavailable).toEqual([range("2026-11-28", "2026-12-01")]);
  });

  test("blocked date set excludes checkout days", () => {
    const days = blockedDateSet([range("2026-12-01", "2026-12-04")]);
    expect([...days].sort()).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
    expect(
      unavailableDateObjects([range("2026-12-01", "2026-12-02")]).map(localDateToDateOnly),
    ).toEqual(["2026-12-01"]);
  });

  test("finds the first conflicting range", () => {
    expect(
      findAvailabilityConflict(range("2026-12-04", "2026-12-07"), [
        range("2026-12-01", "2026-12-05"),
        range("2026-12-06", "2026-12-10"),
      ]),
    ).toEqual(range("2026-12-01", "2026-12-05"));
    expect(
      findAvailabilityConflict(range("2026-12-05", "2026-12-06"), [
        range("2026-12-01", "2026-12-05"),
      ]),
    ).toBeNull();
  });
});

describe("stay validation", () => {
  test("accepts a valid available stay", () => {
    expect(validateStayRequest(baseInput)).toEqual({ ok: true });
  });

  test("rejects an inverted or invalid range", () => {
    expect(validateStayRequest({ ...baseInput, checkOut: "2026-12-10" })).toMatchObject({
      ok: false,
      code: "invalid_range",
    });
    expect(validateStayRequest({ ...baseInput, checkIn: "2026-02-30" })).toMatchObject({
      ok: false,
      code: "invalid_range",
    });
  });

  test("rejects a check-in before today in New York", () => {
    expect(
      validateStayRequest({ ...baseInput, checkIn: "2026-11-22", checkOut: "2026-11-25" }),
    ).toMatchObject({ ok: false, code: "past_check_in" });
  });

  test("rejects a stay below the property minimum", () => {
    expect(
      validateStayRequest({ ...baseInput, checkIn: "2026-12-10", checkOut: "2026-12-12" }),
    ).toMatchObject({ ok: false, code: "min_nights" });
  });

  test("rejects more guests than the property allows", () => {
    expect(validateStayRequest({ ...baseInput, guests: 5 })).toMatchObject({
      ok: false,
      code: "max_guests",
    });
  });

  test("rejects any range that touches a confirmed booking or blackout", () => {
    expect(
      validateStayRequest({
        ...baseInput,
        unavailable: [range("2026-12-14", "2026-12-20")],
      }),
    ).toMatchObject({ ok: false, code: "unavailable" });
  });

  test("allows checkout on the next guest's arrival day", () => {
    expect(
      validateStayRequest({
        ...baseInput,
        checkIn: "2026-12-05",
        checkOut: "2026-12-10",
        unavailable: [range("2026-12-01", "2026-12-05"), range("2026-12-10", "2026-12-14")],
      }),
    ).toEqual({ ok: true });
  });
});
