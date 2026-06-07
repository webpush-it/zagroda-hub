import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { sendViaBrevo, type EmailMessage } from "./brevo";
import type { EmailConfig } from "./config";

// Enqueue + drain logic shared by the request path and the cron sweep — the
// single place where claim/send/mark happens. Lease-based retry model: the
// claim RPC atomically bumps `attempts` and pushes `next_attempt_at` ~5 min
// out, so the immediate (waitUntil) path and the cron sweep can never
// double-send (see supabase/migrations/20260607120000_email_outbox.sql).

type AdminClient = SupabaseClient<Database>;

// Mirrors `attempts < 5` in claim_due_emails: a claimed row carries the
// post-bump counter, so `attempts >= 5` means this was its final try.
const MAX_ATTEMPTS = 5;

export async function enqueueEmail(admin: AdminClient, msg: EmailMessage): Promise<{ id: string } | { error: string }> {
  const { data, error } = await admin
    .from("email_outbox")
    .insert({
      to_email: msg.to,
      subject: msg.subject,
      html: msg.html,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    })
    .select("id")
    .single();
  if (error) {
    return { error: error.message };
  }
  return { id: data.id };
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
}

export async function drainDueEmails(
  admin: AdminClient,
  config: EmailConfig | null,
  opts: { limit?: number; id?: string } = {},
): Promise<DrainResult> {
  if (!config) {
    // No-op mode must NOT call the claim RPC — claiming bumps `attempts`,
    // which would consume the retry budget. Rows stay genuinely pending and
    // fully claimable once env is configured.
    // eslint-disable-next-line no-console
    console.warn("[email] channel unconfigured — drain skipped, rows stay pending");
    return { claimed: 0, sent: 0, failed: 0 };
  }

  const { data: rows, error } = await admin.rpc("claim_due_emails", {
    ...(opts.limit !== undefined ? { p_limit: opts.limit } : {}),
    ...(opts.id !== undefined ? { p_id: opts.id } : {}),
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[email] claim_due_emails failed: ${error.message}`);
    return { claimed: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await sendViaBrevo(config, {
      to: row.to_email,
      subject: row.subject,
      html: row.html,
      ...(row.reply_to ? { replyTo: row.reply_to } : {}),
    });
    if (result.ok) {
      const { error: updateError } = await admin
        .from("email_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: result.messageId })
        .eq("id", row.id);
      if (updateError) {
        // The email went out but the mark failed — the lease prevents an
        // immediate re-send; the next claim after lease expiry may resend.
        // eslint-disable-next-line no-console
        console.error(`[email] failed to mark ${row.id} sent: ${updateError.message}`);
      }
      sent += 1;
    } else {
      const exhausted = row.attempts >= MAX_ATTEMPTS;
      const { error: updateError } = await admin
        .from("email_outbox")
        .update({ last_error: result.error, ...(exhausted ? { status: "failed" } : {}) })
        .eq("id", row.id);
      if (updateError) {
        // eslint-disable-next-line no-console
        console.error(`[email] failed to record error for ${row.id}: ${updateError.message}`);
      }
      // Non-exhausted rows stay `pending`; the lease expiry doubles as backoff.
      if (exhausted) {
        failed += 1;
      }
    }
  }
  return { claimed: rows.length, sent, failed };
}
