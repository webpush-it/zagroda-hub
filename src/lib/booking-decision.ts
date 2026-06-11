import type { APIRoute } from "astro";
import { createAdminClient } from "@/lib/supabase-admin";
import { getEmailConfig } from "@/lib/email/config";
import { sendTransactionalEmail, type EmailMessage } from "@/lib/email";
import { getWaitUntil } from "@/lib/cf";

// Shared plumbing for the owner decision routes (accept/reject).

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** Best-effort enqueue — an email failure must never fail the decision response. */
export async function enqueueDecisionEmail(context: Parameters<APIRoute>[0], msg: EmailMessage): Promise<void> {
  try {
    const deps = { admin: createAdminClient(), config: getEmailConfig(), waitUntil: getWaitUntil(context.locals) };
    await sendTransactionalEmail(deps, msg);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[booking-decision] email enqueue failed:", error);
  }
}
