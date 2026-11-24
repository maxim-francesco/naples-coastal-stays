import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminErrorMessage, requireAdmin } from "./authGuard.server";
import { isValidDateOnly, normalizeAvailabilityRange, todayInTimeZone } from "./availability";

export interface AdminCalendarProperty {
  id: string;
  name: string;
  minNights: number;
  maxGuests: number;
  isActive: boolean;
}

export interface AdminCalendarBooking {
  id: string;
  propertyId: string;
  guestName: string;
  email: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  message: string;
  status: "new" | "confirmed" | "declined" | string;
  createdAt: string | null;
}

export interface AdminCalendarBlackout {
  id: string;
  propertyId: string;
  start: string;
  end: string;
  note: string;
  createdAt: string | null;
}

export interface AdminAvailability {
  property: AdminCalendarProperty;
  bookings: AdminCalendarBooking[];
  blackouts: AdminCalendarBlackout[];
  from: string;
  to: string;
  today: string;
}

const dateOnly = z.string().refine(isValidDateOnly, "Expected a yyyy-MM-dd date.");

export const adminAvailabilitySchema = z.object({
  propertyId: z.string().uuid(),
  from: dateOnly,
  to: dateOnly,
  accessToken: z.string().optional(),
});

export const getAdminAvailability = createServerFn({ method: "POST" })
  .validator((data: unknown) => adminAvailabilitySchema.parse(data))
  .handler(async ({ data: { propertyId, from, to, accessToken } }): Promise<AdminAvailability> => {
    await requireAdmin(accessToken);

    if (from >= to) {
      throw new Error("The availability range is invalid.");
    }

    const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

    const { data: property, error: propertyError } = await supabaseAdmin
      .from("properties")
      .select("id, name, min_nights, max_guests, is_active")
      .eq("id", propertyId)
      .maybeSingle();

    if (propertyError) {
      console.error("Error loading property for the admin calendar:", propertyError);
      throw new Error("Could not load the calendar.");
    }
    if (!property) {
      throw new Error("Property not found.");
    }

    const [bookingsResult, blackoutsResult] = await Promise.all([
      supabaseAdmin
        .from("booking_requests")
        .select(
          "id, property_id, guest_name, email, check_in, check_out, guests, message, status, created_at",
        )
        .eq("property_id", propertyId)
        .lt("check_in", to)
        .gt("check_out", from)
        .order("check_in", { ascending: true }),
      supabaseAdmin
        .from("blackout_dates")
        .select("id, property_id, start_date, end_date, note, created_at")
        .eq("property_id", propertyId)
        .lt("start_date", to)
        .gt("end_date", from)
        .order("start_date", { ascending: true }),
    ]);

    if (bookingsResult.error || blackoutsResult.error) {
      console.error("Error loading admin availability:", {
        bookings: bookingsResult.error,
        blackouts: blackoutsResult.error,
      });
      throw new Error("Could not load the calendar.");
    }

    const bookings: AdminCalendarBooking[] = (bookingsResult.data ?? []).map((row) => ({
      id: row.id,
      propertyId: row.property_id ?? propertyId,
      guestName: row.guest_name,
      email: row.email,
      checkIn: row.check_in,
      checkOut: row.check_out,
      guests: row.guests,
      message: row.message,
      status: row.status,
      createdAt: row.created_at ?? null,
    }));

    const blackouts: AdminCalendarBlackout[] = (blackoutsResult.data ?? [])
      .map((row) => {
        const range = normalizeAvailabilityRange({ start: row.start_date, end: row.end_date });
        if (!range) return null;
        return {
          id: row.id,
          propertyId: row.property_id,
          start: range.start,
          end: range.end,
          note: row.note,
          createdAt: row.created_at ?? null,
        };
      })
      .filter((row): row is AdminCalendarBlackout => row !== null);

    return {
      property: {
        id: property.id,
        name: property.name,
        minNights: property.min_nights,
        maxGuests: property.max_guests,
        isActive: property.is_active,
      },
      bookings,
      blackouts,
      from,
      to,
      today: todayInTimeZone(),
    };
  });

export const createBlackoutSchema = z.object({
  propertyId: z.string().uuid(),
  start: dateOnly,
  end: dateOnly,
  note: z.string().trim().max(280).optional().default(""),
  accessToken: z.string().optional(),
});

type BlackoutResult = { ok: true } | { ok: false; error: string };

const BLACKOUT_BOOKING_CONFLICT =
  "These dates conflict with a confirmed booking. Decline or move that reservation first.";
const BLACKOUT_OVERLAP = "Part of this range is already blocked. Unblock it first.";
// Blocking dates must be atomic too: two overlapping blackouts created from two
// browsers would otherwise both pass a read-then-insert check.
const BLACKOUT_UNAVAILABLE_MESSAGE =
  "Blocking dates is unavailable because the availability protection is not installed in the database. Nothing was changed.";

function missingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (["PGRST202", "42883", "404"].includes(error.code ?? "")) return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("could not find the function") || message.includes("does not exist");
}

function overlapError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23P01") return true;
  return /conflict|overlap|exclusion/i.test(error.message ?? "");
}

export const createBlackout = createServerFn({ method: "POST" })
  .validator((data: unknown) => createBlackoutSchema.parse(data))
  .handler(
    async ({ data: { propertyId, start, end, note, accessToken } }): Promise<BlackoutResult> => {
      try {
        await requireAdmin(accessToken);

        if (start >= end) {
          return { ok: false, error: "The blocked range must end after it starts." };
        }
        if (start < todayInTimeZone()) {
          return { ok: false, error: "Blocked dates must start today or later." };
        }

        const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

        const { data: property, error: propertyError } = await supabaseAdmin
          .from("properties")
          .select("id")
          .eq("id", propertyId)
          .maybeSingle();

        if (propertyError) {
          console.error("Error loading property for blackout:", propertyError);
          return { ok: false, error: "Could not block those dates. Please try again." };
        }
        if (!property) {
          return { ok: false, error: "Property not found." };
        }

        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("create_blackout", {
          p_property_id: propertyId,
          p_start: start,
          p_end: end,
          p_note: note ?? "",
        });

        if (!rpcError) {
          const payload =
            rpcData && typeof rpcData === "object"
              ? (rpcData as { ok?: boolean; code?: string })
              : null;
          if (payload?.ok === true) return { ok: true };
          if (payload?.code === "booking_conflict") {
            return { ok: false, error: BLACKOUT_BOOKING_CONFLICT };
          }
          if (payload?.code === "overlap") {
            return { ok: false, error: BLACKOUT_OVERLAP };
          }
          if (payload?.code === "not_found") {
            return { ok: false, error: "Property not found." };
          }
          console.error("Unexpected create_blackout result:", rpcData);
          return { ok: false, error: "Could not block those dates. Please try again." };
        }

        if (!missingRpc(rpcError)) {
          console.error("Error creating blackout:", rpcError);
          if (overlapError(rpcError)) {
            return { ok: false, error: BLACKOUT_OVERLAP };
          }
          return { ok: false, error: "Could not block those dates. Please try again." };
        }

        // No non-atomic fallback: refusing is safer than inserting a range that
        // might race a confirmed booking or a second blackout.
        console.error(
          "create_blackout is missing: the availability migration has not been applied.",
        );
        return { ok: false, error: BLACKOUT_UNAVAILABLE_MESSAGE };
      } catch (error) {
        console.error("Unexpected error in createBlackout:", error);
        return { ok: false, error: adminErrorMessage(error, "Could not block those dates.") };
      }
    },
  );

export const deleteBlackoutSchema = z.object({
  id: z.string().uuid(),
  accessToken: z.string().optional(),
});

export const deleteBlackout = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteBlackoutSchema.parse(data))
  .handler(async ({ data: { id, accessToken } }): Promise<BlackoutResult> => {
    try {
      await requireAdmin(accessToken);

      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
      const { data: removed, error } = await supabaseAdmin
        .from("blackout_dates")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) {
        console.error("Error deleting blackout:", error);
        return { ok: false, error: "Could not unblock those dates. Please try again." };
      }
      if (!removed || removed.length === 0) {
        return { ok: false, error: "This blocked period no longer exists." };
      }

      return { ok: true };
    } catch (error) {
      console.error("Unexpected error in deleteBlackout:", error);
      return { ok: false, error: adminErrorMessage(error, "Could not unblock those dates.") };
    }
  });
