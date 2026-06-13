import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installBrevoMock, type BrevoMock } from "../helpers/brevo-mock";
import { createAdminClient, type TypedClient } from "../helpers/supabase";
import type { EmailConfig } from "../../src/lib/email/config";
import { drainDueEmails } from "../../src/lib/email/outbox";

// The integration seam nobody else runs (test-plan §3 Phase 3, risk #2): the
// real drainDueEmails claim->send->mark loop against the local Supabase stack,
// with ONLY the Brevo HTTP edge mocked (tests/helpers/brevo-mock.ts), so the
// real supabase-js client still reaches the DB. tests/db/email-outbox.test.ts
// proves the SQL primitive; tests/unit/email.test.ts mocks the admin client.
// Neither drives the full loop against real Postgres — this file does.
//
// Oracle: research.md state diagram + the archived F-02 verification log +
// test-plan §2 Risk Response Guidance — never the implementation's output.
//
// The env stub leaves BREVO_API_KEY/EMAIL_FROM unset (getEmailConfig() -> null),
// so the real send branch is reached only by injecting a literal EmailConfig.

const CONFIG: EmailConfig = {
  apiKey: "test-api-key",
  fromEmail: "sender@zagroda.test",
  fromName: "Zagroda Hub",
};

let admin: TypedClient;
let brevo: BrevoMock | undefined;

interface OutboxInsertOptions {
  /** Pre-claim attempts value: the claim bumps it by 1 (seed 4 to test the at-cap path). */
  attempts?: number;
  nextAttemptAt?: string;
}

/** Inserts an outbox row via service_role; due immediately unless overridden. */
async function insertOutboxRow(opts: OutboxInsertOptions = {}): Promise<string> {
  const { data, error } = await admin
    .from("email_outbox")
    .insert({
      to_email: `drain-${randomUUID()}@test.local`,
      subject: "Test subject",
      html: "<p>Test body</p>",
      ...(opts.attempts !== undefined ? { attempts: opts.attempts } : {}),
      ...(opts.nextAttemptAt ? { next_attempt_at: opts.nextAttemptAt } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertOutboxRow failed: ${error.message}`);
  return data.id;
}

/** Re-reads a single outbox row by id via service_role (RLS deny-all). */
async function readRow(id: string) {
  const { data, error } = await admin.from("email_outbox").select("*").eq("id", id).single();
  if (error) throw new Error(`readRow failed: ${error.message}`);
  return data;
}

beforeAll(async () => {
  admin = createAdminClient();
  // Determinism trap: claim_due_emails orders by created_at and stale
  // expired-lease rows sort ahead of fresh fixtures, stealing their claims.
  // Wipe the table (service-role only; the table is isolated infra).
  const { error } = await admin.from("email_outbox").delete().gte("created_at", "1970-01-01");
  if (error) throw new Error(`email_outbox cleanup failed: ${error.message}`);
});

afterEach(() => {
  // A leaked fetch stub silently breaks later files (fileParallelism: false).
  brevo?.restore();
  brevo = undefined;
  vi.restoreAllMocks();
});

describe("drainDueEmails — real Supabase, mocked Brevo edge", () => {
  it("(a) a successful send marks the row sent with the provider message id", async () => {
    const id = await insertOutboxRow();
    brevo = installBrevoMock().mockSuccess("<brevo-msg-int>");

    const result = await drainDueEmails(admin, CONFIG, { id });

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(brevo.count).toBe(1);

    const row = await readRow(id);
    expect(row.status).toBe("sent");
    expect(row.provider_message_id).toBe("<brevo-msg-int>");
    expect(row.sent_at).not.toBeNull();
  });

  it("(b) a 2xx without a messageId still sends but stores an empty id and warns", async () => {
    const id = await insertOutboxRow();
    brevo = installBrevoMock().mockSuccessNoMessageId();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await drainDueEmails(admin, CONFIG, { id });

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    const row = await readRow(id);
    expect(row.status).toBe("sent");
    // Empty-id oracle (brevo.ts:45-47): the mail went out, the audit trail is
    // lost, and the gap is surfaced via console.warn — accepted, not fixed.
    expect(row.provider_message_id).toBe("");
    expect(warn).toHaveBeenCalledWith("[email] Brevo returned a 2xx response without a messageId");
  });

  it("(c) a failed send below the attempts cap leaves the row claimable for retry", async () => {
    const id = await insertOutboxRow();
    const before = await readRow(id);
    brevo = installBrevoMock().mockFailure(500, "transient");

    const result = await drainDueEmails(admin, CONFIG, { id });

    // Provider failure must not consume the row: it stays pending for the next
    // sweep (test-plan §2 Risk Response — a stuck provider retries, never drops).
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 0 });
    const row = await readRow(id);
    expect(row.status).toBe("pending");
    expect(row.last_error).not.toBeNull();
    expect(row.attempts).toBe(1); // claim bumped 0 -> 1, still below cap
    // The lease doubles as backoff: the claim pushed next_attempt_at ~5 min out.
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(new Date(before.next_attempt_at).getTime());
  });

  it("(d) a failed send at the attempts cap marks the row failed and it is never re-claimed", async () => {
    // Pre-claim attempts = 4; the claim bumps it to 5 (= MAX_ATTEMPTS), so this
    // is the final try. Seeding 5 would make the row un-claimable (attempts < 5).
    const id = await insertOutboxRow({ attempts: 4 });
    brevo = installBrevoMock().mockFailure(500, "still broken");

    const result = await drainDueEmails(admin, CONFIG, { id });

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    const row = await readRow(id);
    expect(row.status).toBe("failed");
    expect(row.last_error).not.toBeNull();

    // A terminal row drops out of the claim set for good.
    const reclaim = await admin.rpc("claim_due_emails", { p_id: id });
    expect(reclaim.error).toBeNull();
    expect(reclaim.data).toHaveLength(0);
  });

  it("(e) a sent row is not re-claimed by a subsequent drain (no double-send through the real loop)", async () => {
    const id = await insertOutboxRow();
    brevo = installBrevoMock().mockSuccess("<brevo-msg-once>");

    const first = await drainDueEmails(admin, CONFIG, { id });
    expect(first).toEqual({ claimed: 1, sent: 1, failed: 0 });

    // Second drain over the same id: claim_due_emails filters status='pending',
    // so a sent row is excluded regardless of lease — zero rows, zero sends.
    // (The lease's own no-double-send guarantee is SQL-covered by
    // tests/db/email-outbox.test.ts (b)/(c); this asserts the full loop.)
    const second = await drainDueEmails(admin, CONFIG, { id });
    expect(second).toEqual({ claimed: 0, sent: 0, failed: 0 });

    // Exactly one Brevo request fired across both drains.
    expect(brevo.count).toBe(1);
  });

  it("(f) null config is a logged no-op that consumes zero attempts", async () => {
    const id = await insertOutboxRow();
    const before = await readRow(id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // No edge mock: a no-op drain must never reach the provider.
    const result = await drainDueEmails(admin, null);

    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(warn).toHaveBeenCalledWith("[email] channel unconfigured — drain skipped, rows stay pending");

    // The claim RPC was NOT called: a no-op must not bump attempts or move the
    // lease, so the row stays genuinely pending and fully claimable once
    // configured (outbox.ts:46-52 — claiming would consume the retry budget).
    const row = await readRow(id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(before.attempts);
    expect(row.next_attempt_at).toBe(before.next_attempt_at);
  });
});
