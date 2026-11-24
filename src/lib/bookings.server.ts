import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { adminErrorMessage, requireAdmin } from "./authGuard.server";
import { createHash } from "crypto";
import {
  blockingRanges,
  isValidDateOnly,
  normalizeAvailabilityRange,
  todayInTimeZone,
  validateStayRequest,
  type AvailabilityRange,
} from "./availability";

export interface DBBookingRequest {
  id: string;
  property_id: string | null;
  guest_name: string;
  email: string;
  check_in: string;
  check_out: string;
  guests: number;
  message: string;
  status: "new" | "confirmed" | "declined";
  ip_hash: string | null;
  created_at?: string;
}

export const submitBookingRequestSchema = z.object({
  property_id: z.string().uuid(),
  guest_name: z.string().min(1).max(120),
  email: z.string().min(1).max(200).email(),
  check_in: z.string().refine(isValidDateOnly, "Check-in must be a calendar date."),
  check_out: z.string().refine(isValidDateOnly, "Check-out must be a calendar date."),
  guests: z.number().int().min(1).max(50),
  message: z.string().max(2000).optional().default(""),
  website: z.string().nullable().optional(), // honeypot
});

export const submitBookingRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => submitBookingRequestSchema.parse(data))
  .handler(
    async ({
      data: { property_id, guest_name, email, check_in, check_out, guests, message, website },
    }): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        // 1. Honeypot check
        if (website && website.trim() !== "") {
          console.log("Honeypot triggered, fake success returned");
          return { ok: true };
        }

        // 2. Rate limit check
        let ip = "127.0.0.1";
        try {
          const request = getRequest();
          if (request) {
            const xForwardedFor = request.headers.get("x-forwarded-for");
            if (xForwardedFor) {
              ip = (xForwardedFor.split(",")[0] || "").trim() || "127.0.0.1";
            }
          }
        } catch (e) {
          // Fallback to default IP if getRequest() fails or is called outside active request
        }

        const hash = createHash("sha256");
        hash.update(`naples-coastal-salt-2026-${ip}`);
        const ipHash = hash.digest("hex");

        const { supabaseAdmin } = await import("@/lib/supabase.admin.server");
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        const { count, error: countError } = await supabaseAdmin
          .from("booking_submits")
          .select("*", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .gte("created_at", tenMinutesAgo);

        if (countError) {
          console.error("Error checking rate limits:", countError);
        }

        if (count !== null && count >= 3) {
          return {
            ok: false,
            error:
              "You've sent a few requests already — please try again later or contact us directly.",
          };
        }

        // 4. Re-check the real calendar server-side. The dialog can only see the
        // availability it loaded earlier, so this is the authoritative check.
        const { data: property, error: propertyError } = await supabaseAdmin
          .from("properties")
          .select("id, max_guests, min_nights, is_active")
          .eq("id", property_id)
          .eq("is_active", true)
          .maybeSingle();

        if (propertyError) {
          console.error("Error loading property for booking validation:", propertyError);
          return { ok: false, error: "Could not check availability. Please try again." };
        }
        if (!property) {
          return { ok: false, error: "This home is not accepting requests right now." };
        }

        const [blackoutsResult, reservationsResult] = await Promise.all([
          supabaseAdmin
            .from("blackout_dates")
            .select("start_date, end_date")
            .eq("property_id", property_id),
          supabaseAdmin
            .from("booking_requests")
            .select("check_in, check_out, status")
            .eq("property_id", property_id)
            .eq("status", "confirmed"),
        ]);

        if (blackoutsResult.error || reservationsResult.error) {
          console.error("Error loading availability for booking validation:", {
            blackouts: blackoutsResult.error,
            reservations: reservationsResult.error,
          });
          return { ok: false, error: "Could not check availability. Please try again." };
        }

        const blackouts = (blackoutsResult.data ?? [])
          .map((row) => normalizeAvailabilityRange({ start: row.start_date, end: row.end_date }))
          .filter((range): range is AvailabilityRange => range !== null);
        const reservations = (reservationsResult.data ?? []).map((row) => ({
          checkIn: row.check_in,
          checkOut: row.check_out,
          status: row.status,
        }));
        const unavailable = blockingRanges({ blackouts, bookings: reservations });

        const validation = validateStayRequest({
          checkIn: check_in,
          checkOut: check_out,
          guests,
          maxGuests: property.max_guests,
          minNights: property.min_nights,
          today: todayInTimeZone(),
          unavailable,
        });

        if (!validation.ok) {
          return { ok: false, error: validation.message };
        }

        // 5. Insert into booking_requests via supabaseAdmin
        const { error: insertError } = await supabaseAdmin.from("booking_requests").insert({
          property_id,
          guest_name,
          email,
          check_in,
          check_out,
          guests,
          message: message || "",
          status: "new",
          ip_hash: ipHash,
        });

        if (insertError) {
          console.error("Error inserting booking request:", insertError);
          return { ok: false, error: "Could not send your request. Please try again." };
        }

        // 5. Insert into booking_submits
        const { error: submitError } = await supabaseAdmin.from("booking_submits").insert({
          ip_hash: ipHash,
        });

        if (submitError) {
          console.error("Error inserting rate limit log:", submitError);
        }

        // 6. Best-effort cleanup (async)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        (async () => {
          try {
            const { error } = await supabaseAdmin
              .from("booking_submits")
              .delete()
              .lt("created_at", twentyFourHoursAgo);
            if (error) {
              console.error("Best-effort booking_submits cleanup failed:", error);
            }
          } catch (err) {
            console.error("Best-effort booking_submits cleanup failed with error:", err);
          }
        })();

        return { ok: true };
      } catch (e) {
        console.error("Unhandled error in submitBookingRequest:", e);
        return { ok: false, error: "Could not send your request. Please try again." };
      }
    },
  );

export const listBookingRequestsSchema = z.object({
  statusFilter: z.string().nullable().optional(),
  accessToken: z.string().optional(),
});

// POST: guest contact details are only returned to an authenticated admin, and
// the call must never be cacheable or carry credentials in a query string.
export const listBookingRequests = createServerFn({ method: "POST" })
  .validator((data: unknown) => listBookingRequestsSchema.parse(data))
  .handler(async ({ data: { statusFilter, accessToken } }): Promise<DBBookingRequest[]> => {
    // Require admin privileges (PII protection)
    await requireAdmin(accessToken);

    const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

    let query = supabaseAdmin
      .from("booking_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching booking requests:", error);
      throw new Error("Could not load booking requests.");
    }

    return (data as DBBookingRequest[]) || [];
  });

export const updateBookingStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "confirmed", "declined"]),
  accessToken: z.string().optional(),
});

const BOOKING_CONFLICT_MESSAGE =
  "Those dates conflict with another confirmed booking or a blocked period. Decline or adjust the other reservation first.";
// Confirmation must be atomic. If the database has not been migrated yet there
// is no reliable way to serialize two admins confirming overlapping requests,
// so the operation is refused instead of falling back to a read-then-write
// sequence that could double-book a property.
const BOOKING_UNAVAILABLE_MESSAGE =
  "Booking confirmation is unavailable because the availability protection is not installed in the database. Nothing was changed.";

type PostgrestLikeError = { code?: string; message?: string } | null | undefined;

function isMissingRpcFunction(error: PostgrestLikeError): boolean {
  if (!error) return false;
  if (["PGRST202", "42883", "404"].includes(error.code ?? "")) return true;
  const message = (error["message"] ?? "").toLowerCase();
  return (
    message.includes("could not find the function") ||
    message.includes("function public.confirm_booking_request") ||
    message.includes("function public.create_blackout")
  );
}

function isBookingConflict(error: PostgrestLikeError): boolean {
  if (!error) return false;
  if (error.code === "23P01") return true;
  return /conflict|overlap|exclusion/i.test(error["message"] ?? "");
}

function asRpcPayload(data: unknown): { ok?: boolean; code?: string } | null {
  if (!data || typeof data !== "object") return null;
  return data as { ok?: boolean; code?: string };
}

async function confirmBooking(
  id: string,
  supabaseAdmin: Awaited<typeof import("@/lib/supabase.admin.server")>["supabaseAdmin"],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("confirm_booking_request", {
    p_booking_id: id,
  });

  if (rpcError) {
    if (isMissingRpcFunction(rpcError)) {
      console.error(
        "confirm_booking_request is missing: the availability migration has not been applied.",
      );
      return { ok: false, error: BOOKING_UNAVAILABLE_MESSAGE };
    }
    if (isBookingConflict(rpcError)) {
      return { ok: false, error: BOOKING_CONFLICT_MESSAGE };
    }
    console.error("Error confirming booking request:", rpcError);
    return { ok: false, error: "Could not update the booking request. Please try again." };
  }

  const payload = asRpcPayload(rpcData);
  if (payload?.ok === true) return { ok: true };
  if (payload?.code === "conflict") {
    return { ok: false, error: BOOKING_CONFLICT_MESSAGE };
  }
  if (payload?.code === "missing_property") {
    return { ok: false, error: "This request is not linked to a property." };
  }
  if (payload?.code === "not_found") {
    return { ok: false, error: "This booking request no longer exists." };
  }

  console.error("Unexpected confirm_booking_request result:", rpcData);
  return { ok: false, error: "Could not update the booking request. Please try again." };
}

export const updateBookingStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateBookingStatusSchema.parse(data))
  .handler(
    async ({
      data: { id, status, accessToken },
    }): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        await requireAdmin(accessToken);

        const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

        if (status === "confirmed") {
          // Confirmation always goes through the atomic database function. There
          // is deliberately no client or read-then-write fallback.
          return await confirmBooking(id, supabaseAdmin);
        }

        const { error } = await supabaseAdmin
          .from("booking_requests")
          .update({ status })
          .eq("id", id);

        if (error) {
          console.error("Error updating booking status:", error);
          return { ok: false, error: "Could not update the booking request. Please try again." };
        }

        return { ok: true };
      } catch (e) {
        console.error("Unexpected error in updateBookingStatus:", e);
        return { ok: false, error: adminErrorMessage(e, "Could not update the booking request.") };
      }
    },
  );

export const deleteBookingRequestSchema = z.object({
  id: z.string().uuid(),
  accessToken: z.string().optional(),
});

export const deleteBookingRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteBookingRequestSchema.parse(data))
  .handler(
    async ({ data: { id, accessToken } }): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        await requireAdmin(accessToken);

        const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

        const { error } = await supabaseAdmin.from("booking_requests").delete().eq("id", id);

        if (error) {
          console.error("Error deleting booking request:", error);
          return { ok: false, error: "Could not delete the booking request. Please try again." };
        }

        return { ok: true };
      } catch (e) {
        console.error("Unexpected error in deleteBookingRequest:", e);
        return { ok: false, error: adminErrorMessage(e, "Could not delete the booking request.") };
      }
    },
  );
