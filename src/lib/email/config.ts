import { BREVO_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME } from "astro:env/server";

// Channel configuration resolved from astro:env/server (request-scoped).
// The EmailConfig shape is exported so non-request contexts (the Worker
// `scheduled` handler, Phase 3) can build the same object from raw env
// bindings — code reachable from `scheduled` must import ONLY the type from
// this module (`import type`), never getEmailConfig, because astro:env is
// unavailable outside the request path.

export interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

/** Null when BREVO_API_KEY or EMAIL_FROM is unset — callers degrade to no-op. */
export function getEmailConfig(): EmailConfig | null {
  if (!BREVO_API_KEY || !EMAIL_FROM) {
    return null;
  }
  return {
    apiKey: BREVO_API_KEY,
    fromEmail: EMAIL_FROM,
    fromName: EMAIL_FROM_NAME ?? "Zagroda Hub",
  };
}
