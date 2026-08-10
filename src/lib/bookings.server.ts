import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireAdmin } from "./authGuard.server";
import { createHash } from "crypto";

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
  property_id: z.string().uuid().nullable().optional(),
  guest_name: z.string().min(1).max(120),
  email: z.string().min(1).max(200).email(),
  check_in: z.string().min(1),   // ISO date string
  check_out: z.string().min(1),
  guests: z.number().int().min(1).max(50),
  message: z.string().max(2000).optional().default(""),
  website: z.string().nullable().optional(),  // honeypot
});

export const submitBookingRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => submitBookingRequestSchema.parse(data))
  .handler(async ({ data: { property_id, guest_name, email, check_in, check_out, guests, message, website } }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      // 1. Honeypot check
      if (website && website.trim() !== "") {
        console.log("Honeypot triggered, fake success returned");
        return { ok: true };
      }

      // 2. Basic sanity: check_out <= check_in
      const checkInDate = new Date(check_in);
      const checkOutDate = new Date(check_out);
      if (checkOutDate <= checkInDate) {
        return { ok: false, error: "Check-out must be after check-in." };
      }

      // 3. Rate limit check
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
          error: "You've sent a few requests already — please try again later or contact us directly.",
        };
      }

      // 4. Insert into booking_requests via supabaseAdmin
      const { error: insertError } = await supabaseAdmin
        .from("booking_requests")
        .insert({
          property_id: property_id || null,
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
        return { ok: false, error: insertError.message };
      }

      // 5. Insert into booking_submits
      const { error: submitError } = await supabaseAdmin
        .from("booking_submits")
        .insert({
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
    } catch (e: any) {
      console.error("Unhandled error in submitBookingRequest:", e);
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });

export const listBookingRequestsSchema = z.object({
  statusFilter: z.string().nullable().optional(),
  accessToken: z.string().optional(),
});

export const listBookingRequests = createServerFn({ method: "GET" })
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
      throw new Error(`Failed to fetch booking requests: ${error.message}`);
    }

    return (data as DBBookingRequest[]) || [];
  });

export const updateBookingStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "confirmed", "declined"]),
  accessToken: z.string().optional(),
});

export const updateBookingStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateBookingStatusSchema.parse(data))
  .handler(async ({ data: { id, status, accessToken } }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      await requireAdmin(accessToken);

      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

      const { error } = await supabaseAdmin
        .from("booking_requests")
        .update({ status })
        .eq("id", id);

      if (error) {
        console.error("Error updating booking status:", error);
        return { ok: false, error: error.message };
      }

      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });

export const deleteBookingRequestSchema = z.object({
  id: z.string().uuid(),
  accessToken: z.string().optional(),
});

export const deleteBookingRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteBookingRequestSchema.parse(data))
  .handler(async ({ data: { id, accessToken } }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      await requireAdmin(accessToken);

      const { supabaseAdmin } = await import("@/lib/supabase.admin.server");

      const { error } = await supabaseAdmin
        .from("booking_requests")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Error deleting booking request:", error);
        return { ok: false, error: error.message };
      }

      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || "An unexpected error occurred." };
    }
  });
