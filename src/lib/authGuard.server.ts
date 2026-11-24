import { getRequest } from "@tanstack/react-start/server";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase.server";

// Administrative access is decided here, on the server, from a source the
// signed-in user cannot edit: the ADMIN_USER_IDS allowlist (Supabase user IDs)
// plus a valid Supabase session for that same user. Authentication alone is
// not authorization — any authenticated user must still be on the list.

export type AdminAccessFailure = "not_configured" | "unauthorized" | "forbidden";

export class AdminAccessError extends Error {
  readonly failure: AdminAccessFailure;

  constructor(failure: AdminAccessFailure, message: string) {
    super(message);
    this.name = "AdminAccessError";
    this.failure = failure;
  }
}

// Comma- or whitespace-separated Supabase user IDs. Missing or empty means
// nobody is an administrator: the guard fails closed instead of granting
// access to every authenticated account.
function configuredAdminIds(): Set<string> {
  const raw = process.env["ADMIN_USER_IDS"] ?? "";
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );
}

// The bearer token comes from the explicit argument used by the existing admin
// server functions, or else from the Authorization header. It is never
// accepted from a query string.
function requestBearerToken(): string | null {
  try {
    const request = getRequest();
    const header = request?.headers.get("Authorization");
    if (!header) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    return match?.[1] ?? null;
  } catch {
    // Called outside an active HTTP request: treat as unauthenticated.
    return null;
  }
}

export async function requireAdmin(accessToken?: string): Promise<User> {
  const allowed = configuredAdminIds();
  if (allowed.size === 0) {
    console.error(
      "Admin access is not configured. Set ADMIN_USER_IDS to the comma-separated Supabase user IDs of the administrators.",
    );
    throw new AdminAccessError("not_configured", "Admin access is not configured.");
  }

  const token = accessToken?.trim() || requestBearerToken();
  if (!token) {
    throw new AdminAccessError("unauthorized", "Unauthorized");
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new AdminAccessError("unauthorized", "Unauthorized");
  }

  if (!allowed.has(user.id.toLowerCase())) {
    // Logged for the operator only; the id is the caller's own account id.
    console.error(`Admin access denied for user ${user.id}: not listed in ADMIN_USER_IDS.`);
    throw new AdminAccessError("forbidden", "Forbidden");
  }

  return user;
}

// Only the guard's own messages may reach the client. Anything else (a
// database error, a network failure) is replaced by the caller's message.
export function adminErrorMessage(error: unknown, fallback: string): string {
  return error instanceof AdminAccessError ? error.message : fallback;
}
