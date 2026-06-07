import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

// Server-only service-role client for internal infrastructure (the email
// outbox). Bypasses RLS — NEVER import this module from any user-facing data
// path. Mirrors the null-guard convention of src/lib/supabase.ts: returns
// null when env is missing so callers degrade gracefully.
//
// The `override` parameter exists for non-request contexts (the Worker
// `scheduled` handler), which cannot read astro:env and must construct the
// client from raw env bindings instead.

export function createAdminClient(override?: { url: string; serviceKey: string }): SupabaseClient<Database> | null {
  const url = override?.url ?? SUPABASE_URL;
  const serviceKey = override?.serviceKey ?? SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return null;
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
