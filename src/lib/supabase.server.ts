import { createClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

if (typeof window !== "undefined") {
  throw new Error("supabase.server.ts must only be imported on the server side")
}

const url = process.env['SUPABASE_URL']
const anonKey = process.env['SUPABASE_ANON_KEY']

if (!url) {
  throw new Error("Missing environment variable SUPABASE_URL")
}
if (!anonKey) {
  throw new Error("Missing environment variable SUPABASE_ANON_KEY")
}

export const supabase = createClient<Database>(url, anonKey)
