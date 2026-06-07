import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { EmailMessage } from "./brevo";
import type { EmailConfig } from "./config";
import { drainDueEmails, enqueueEmail } from "./outbox";

// The one function future slices (S-03/S-04/S-05) call. Hides outbox +
// provider behind a single contract: durably enqueue, then attempt immediate
// delivery post-response (waitUntil) — the 5-minute cron sweep (Phase 3)
// retries anything the immediate attempt missed.
//
// Dependencies are explicit (no astro:env import here) so the same code is
// callable from API routes AND the Worker `scheduled` handler. Request-path
// callers build them via createAdminClient() + getEmailConfig().

export type { EmailConfig } from "./config";
export type { EmailMessage } from "./brevo";
export { renderEmailLayout } from "./layout";
export { drainDueEmails } from "./outbox";

export interface SendTransactionalEmailDeps {
  admin: SupabaseClient<Database> | null;
  config: EmailConfig | null;
  /** Cloudflare `ctx.waitUntil` when reachable — keeps the send off the response path. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export async function sendTransactionalEmail(
  deps: SendTransactionalEmailDeps,
  msg: EmailMessage,
): Promise<{ enqueued: boolean; id?: string }> {
  if (!deps.admin) {
    // No service-role client (local dev / CI without env) — logged no-op so
    // callers never break.
    // eslint-disable-next-line no-console
    console.warn(`[email] admin client unavailable — dropping "${msg.subject}" to ${msg.to}`);
    return { enqueued: false };
  }

  const result = await enqueueEmail(deps.admin, msg);
  if ("error" in result) {
    // eslint-disable-next-line no-console
    console.error(`[email] enqueue failed for "${msg.subject}" to ${msg.to}: ${result.error}`);
    return { enqueued: false };
  }

  // Immediate attempt, targeted at the just-enqueued row. The row is durable
  // either way — the cron sweep picks up anything this attempt misses.
  const drain = drainDueEmails(deps.admin, deps.config, { id: result.id });
  if (deps.waitUntil) {
    deps.waitUntil(drain);
  } else {
    void drain.catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`[email] immediate drain failed for ${result.id}:`, error);
    });
  }
  return { enqueued: true, id: result.id };
}
