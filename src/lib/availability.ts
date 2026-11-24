// Shared availability engine.
//
// Every date is a `yyyy-MM-dd` calendar date, never a timestamp. The properties
// are in Naples, Florida, so "today" is always resolved in America/New_York
// regardless of where the browser or the server happens to run.
//
// A stay is a half-open interval: [check_in, check_out). The check-in night is
// occupied, the check-out day is free, so a same-day turnover (one guest
// leaving and the next arriving) is allowed.

export const PROPERTY_TIME_ZONE = "America/New_York";

export interface AvailabilityRange {
  /** First unavailable day, inclusive. */
  start: string;
  /** First available day again, exclusive. */
  end: string;
}

export interface StayRange {
  checkIn: string;
  checkOut: string;
}

export interface BlockingBooking {
  checkIn: string;
  checkOut: string;
  status: string;
}

export type AvailabilityErrorCode =
  "invalid_range" | "past_check_in" | "min_nights" | "max_guests" | "unavailable";

export type StayValidation =
  { ok: true } | { ok: false; code: AvailabilityErrorCode; message: string };

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function dateParts(value: string): [number, number, number] {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match || !isValidDateOnly(value)) {
    throw new Error(`Invalid date-only value: ${value}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Days since 1970-01-01, used for timezone-proof arithmetic. */
export function dateOnlyToEpochDay(value: string): number {
  const [year, month, day] = dateParts(value);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function dateOnlyFromEpochDay(epochDay: number): string {
  const date = new Date(epochDay * MS_PER_DAY);
  return date.toISOString().slice(0, 10);
}

export function addDaysToDateOnly(value: string, days: number): string {
  return dateOnlyFromEpochDay(dateOnlyToEpochDay(value) + days);
}

/** Number of nights between two dates; negative when end is before start. */
export function daysBetweenDateOnly(start: string, end: string): number {
  return dateOnlyToEpochDay(end) - dateOnlyToEpochDay(start);
}

/** Every day in [start, endExclusive). */
export function eachDateOnly(start: string, endExclusive: string): string[] {
  const first = dateOnlyToEpochDay(start);
  const last = dateOnlyToEpochDay(endExclusive);
  if (last <= first) return [];
  const dates: string[] = [];
  for (let day = first; day < last; day += 1) {
    dates.push(dateOnlyFromEpochDay(day));
  }
  return dates;
}

/** Current calendar date in the property timezone. */
export function todayInTimeZone(
  now: Date = new Date(),
  timeZone: string = PROPERTY_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Converts a date-only value to a local `Date` at midnight. This is only for
 * UI widgets (react-day-picker, date-fns formatting); arithmetic stays on the
 * string helpers above so DST transitions never shift a night.
 */
export function dateOnlyToLocalDate(value: string): Date {
  const [year, month, day] = dateParts(value);
  return new Date(year, month - 1, day);
}

export function localDateToDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeAvailabilityRange(
  range: { start?: string | null; end?: string | null } | null | undefined,
): AvailabilityRange | null {
  if (!range) return null;
  const { start, end } = range;
  if (!isValidDateOnly(start) || !isValidDateOnly(end)) return null;
  if (start >= end) return null;
  return { start, end };
}

export function bookingToAvailabilityRange(
  booking: { checkIn: string; checkOut: string } | null | undefined,
): AvailabilityRange | null {
  if (!booking) return null;
  return normalizeAvailabilityRange({ start: booking.checkIn, end: booking.checkOut });
}

/** True for half-open ranges that share at least one night. */
export function rangesOverlap(a: AvailabilityRange, b: AvailabilityRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Confirmed reservations and manual blackouts block dates. Pending (`new`)
 * and `declined` requests never do.
 */
export function blockingRanges(input: {
  blackouts?: AvailabilityRange[];
  bookings?: BlockingBooking[];
}): AvailabilityRange[] {
  const ranges: AvailabilityRange[] = [];
  for (const blackout of input.blackouts ?? []) {
    const range = normalizeAvailabilityRange(blackout);
    if (range) ranges.push(range);
  }
  for (const booking of input.bookings ?? []) {
    if (booking.status !== "confirmed") continue;
    const range = bookingToAvailabilityRange(booking);
    if (range) ranges.push(range);
  }
  return ranges;
}

export function findAvailabilityConflict(
  candidate: AvailabilityRange | StayRange,
  unavailable: AvailabilityRange[],
): AvailabilityRange | null {
  const stay =
    "checkIn" in candidate
      ? normalizeAvailabilityRange({ start: candidate.checkIn, end: candidate.checkOut })
      : normalizeAvailabilityRange(candidate);
  if (!stay) return null;
  return unavailable.find((range) => rangesOverlap(stay, range)) ?? null;
}

/** Set of unavailable calendar days (check-out days stay free). */
export function blockedDateSet(ranges: AvailabilityRange[]): Set<string> {
  const days = new Set<string>();
  for (const range of ranges) {
    for (const day of eachDateOnly(range.start, range.end)) days.add(day);
  }
  return days;
}

export function unavailableDateObjects(ranges: AvailabilityRange[]): Date[] {
  return [...blockedDateSet(ranges)].sort().map(dateOnlyToLocalDate);
}

export function validateStayRequest(input: {
  checkIn: string;
  checkOut: string;
  guests: number;
  maxGuests: number;
  minNights: number;
  today: string;
  unavailable: AvailabilityRange[];
}): StayValidation {
  const { checkIn, checkOut, guests, maxGuests, minNights, today, unavailable } = input;

  if (!isValidDateOnly(checkIn) || !isValidDateOnly(checkOut) || checkOut <= checkIn) {
    return {
      ok: false,
      code: "invalid_range",
      message: "Choose a valid check-in date and a later check-out date.",
    };
  }

  if (checkIn < today) {
    return {
      ok: false,
      code: "past_check_in",
      message: "Check-in cannot be in the past.",
    };
  }

  const nights = daysBetweenDateOnly(checkIn, checkOut);
  if (minNights > 0 && nights < minNights) {
    return {
      ok: false,
      code: "min_nights",
      message: `Minimum stay is ${minNights} ${minNights === 1 ? "night" : "nights"}.`,
    };
  }

  if (!Number.isInteger(guests) || guests < 1 || guests > maxGuests) {
    return {
      ok: false,
      code: "max_guests",
      message: `This home sleeps up to ${maxGuests} ${maxGuests === 1 ? "guest" : "guests"}.`,
    };
  }

  if (findAvailabilityConflict({ checkIn, checkOut }, unavailable)) {
    return {
      ok: false,
      code: "unavailable",
      message: "Those dates are no longer available. Please choose a different range.",
    };
  }

  return { ok: true };
}
