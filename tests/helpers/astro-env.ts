import { inject } from "vitest";

// Stand-in for `astro:env/server` (aliased in vitest.config.ts) so src modules
// import cleanly under node. Mirrors the 7-name server schema in
// astro.config.mjs:17-27 — when that schema changes, this stub must follow.
//
// The split below is load-bearing: SUPABASE_SERVICE_ROLE_KEY is set, so
// createAdminClient() works and email_outbox rows are observable in tests;
// BREVO_API_KEY/EMAIL_FROM stay unset, so getEmailConfig() returns null and
// the immediate outbox drain is a logged no-op — no network calls from tests.

export const SUPABASE_URL: string | undefined = inject("supabaseUrl");
export const SUPABASE_KEY: string | undefined = inject("supabaseAnonKey");
export const SUPABASE_SERVICE_ROLE_KEY: string | undefined = inject("supabaseServiceRoleKey");
export const SITE_URL: string | undefined = "http://localhost:4321";
export const BREVO_API_KEY: string | undefined = undefined;
export const EMAIL_FROM: string | undefined = undefined;
export const EMAIL_FROM_NAME: string | undefined = undefined;
