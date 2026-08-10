import { createClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

const isBrowser = typeof window !== "undefined"

const url = isBrowser ? import.meta.env['VITE_SUPABASE_URL'] : ""
const anonKey = isBrowser ? import.meta.env['VITE_SUPABASE_ANON_KEY'] : ""

if (isBrowser) {
  if (!url) {
    throw new Error("Missing environment variable VITE_SUPABASE_URL")
  }
  if (!anonKey) {
    throw new Error("Missing environment variable VITE_SUPABASE_ANON_KEY")
  }
}

export const supabase = isBrowser
  ? createClient<Database>(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : (null as any)
