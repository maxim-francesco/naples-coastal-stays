import { getRequest } from "@tanstack/react-start/server";
import { supabase } from "@/lib/supabase.server";

export async function requireAdmin(accessToken?: string) {
  let token = accessToken;

  if (!token) {
    try {
      const request = getRequest();
      if (request) {
        const authHeader = request.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
          token = authHeader.substring(7);
        }
      }
    } catch (e) {
      // Handle cases where getRequest() might be called outside of an active HTTP request
    }
  }

  if (!token) {
    throw new Error("Unauthorized");
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error("Unauthorized");
  }

  return user;
}
