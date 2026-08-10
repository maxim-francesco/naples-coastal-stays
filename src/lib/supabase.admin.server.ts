import { createClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

if (typeof window !== "undefined") {
  throw new Error("supabase.admin.server.ts must only be imported on the server side")
}

const url = process.env['SUPABASE_URL']
const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

if (!url) {
  throw new Error("Missing environment variable SUPABASE_URL")
}
if (!serviceRoleKey) {
  throw new Error("Missing environment variable SUPABASE_SERVICE_ROLE_KEY")
}

// Bypasses RLS — MUST remain server-side only
export const supabaseAdmin = createClient<Database>(url, serviceRoleKey)
