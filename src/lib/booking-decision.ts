import type { APIRoute } from "astro";
import { createAdminClient } from "@/lib/supabase-admin";
import { getEmailConfig } from "@/lib/email/config";
import { sendTransactionalEmail, type EmailMessage } from "@/lib/email";
import { getWaitUntil } from "@/lib/cf";

// Shared plumbing for the owner decision routes (accept/reject).

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Best-effort enqueue — an email failure must never fail the decision response,
 * which already committed via the RPC. But the failure must not be invisible
 * either: returns whether the message reached the durable outbox so the caller
 * can surface it (`notified`). A `false` enqueue means no cron retry will ever
 * fire — the mail is lost — so swallowing it silently would hide real data loss.
 */
export async function enqueueDecisionEmail(context: Parameters<APIRoute>[0], msg: EmailMessage): Promise<boolean> {
  try {
    const deps = { admin: createAdminClient(), config: getEmailConfig(), waitUntil: getWaitUntil(context.locals) };
    const { enqueued } = await sendTransactionalEmail(deps, msg);
    return enqueued;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[booking-decision] email enqueue failed:", error);
    return false;
  }
}
