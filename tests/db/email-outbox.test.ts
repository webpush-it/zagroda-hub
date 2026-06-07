import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminClient,
  createAnonClient,
  createOwnerClient,
  uniqueEmail,
  type TypedClient,
} from "../helpers/supabase";

// Proof of the F-02 outbox primitive before anything builds on it:
// deny-all RLS (the table holds guest/owner addresses and message bodies),
// lease semantics of claim_due_emails (claim once per ~5 min window),
// concurrent-claim disjointness (FOR UPDATE SKIP LOCKED), the attempts cap,
// and targeted p_id claiming. Only service_role may touch the table.

const PASSWORD = "test-password-123";
const FAR_FUTURE = "2099-01-01T00:00:00Z";

let admin: TypedClient;
let anon: TypedClient;
let authed: TypedClient;

interface OutboxInsertOptions {
  nextAttemptAt?: string;
  attempts?: number;
}

/** Inserts an outbox row via service_role; due immediately unless overridden. */
async function insertOutboxRow(opts: OutboxInsertOptions = {}): Promise<string> {
  const { data, error } = await admin
    .from("email_outbox")
    .insert({
      to_email: `outbox-${randomUUID()}@test.local`,
      subject: "Test subject",
      html: "<p>Test body</p>",
      ...(opts.nextAttemptAt ? { next_attempt_at: opts.nextAttemptAt } : {}),
      ...(opts.attempts !== undefined ? { attempts: opts.attempts } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertOutboxRow failed: ${error.message}`);
  return data.id;
}

beforeAll(async () => {
  admin = createAdminClient();
  anon = createAnonClient();
  const created = await createOwnerClient(uniqueEmail("outbox-owner"), PASSWORD);
  authed = created.client;

  // Wipe leftovers from previous runs: their ~5 min leases have expired, and
  // claim_due_emails orders by created_at, so stale rows would steal claims
  // from test (c)'s fixtures. Within a single run the other fixtures are
  // leased, capped, or far-future — never due — so a fresh table keeps every
  // test deterministic. (Service-role only; the table is isolated infra.)
  const { error } = await admin.from("email_outbox").delete().gte("created_at", "1970-01-01");
  if (error) throw new Error(`email_outbox cleanup failed: ${error.message}`);
});

describe("email_outbox — RLS deny-all", () => {
  it("(a) anon and authenticated can neither SELECT nor INSERT email_outbox", async () => {
    // A row must exist for the SELECT checks to be meaningful. Far-future
    // next_attempt_at keeps it out of every claim in the other tests.
    await insertOutboxRow({ nextAttemptAt: FAR_FUTURE });

    // No SELECT policy → RLS silently matches 0 rows; no error, no data.
    for (const client of [anon, authed]) {
      const { data, error } = await client.from("email_outbox").select("*");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    }

    // No INSERT policy → RLS WITH CHECK violation.
    for (const client of [anon, authed]) {
      const { error } = await client.from("email_outbox").insert({
        to_email: "intruder@test.local",
        subject: "nope",
        html: "<p>nope</p>",
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    }
  });

  it("(a2) anon and authenticated can not execute claim_due_emails (no EXECUTE privilege)", async () => {
    for (const client of [anon, authed]) {
      const { error } = await client.rpc("claim_due_emails", {});
      expect(error?.code).toBe("42501"); // permission denied for function
    }
  });
});

describe("claim_due_emails — lease semantics", () => {
  it("(b) returns a due pending row exactly once; the lease blocks an immediate re-claim", async () => {
    const id = await insertOutboxRow();

    const first = await admin.rpc("claim_due_emails", { p_id: id });
    expect(first.error).toBeNull();
    expect(first.data).toHaveLength(1);
    expect(first.data?.[0].id).toBe(id);
    expect(first.data?.[0].attempts).toBe(1); // claim bumped the counter
    expect(first.data?.[0].status).toBe("pending"); // no 'sending' state

    // Lease moved next_attempt_at ~5 minutes out → not due anymore.
    const second = await admin.rpc("claim_due_emails", { p_id: id });
    expect(second.error).toBeNull();
    expect(second.data).toHaveLength(0);
  });

  it("(c) two concurrent claims over the same due set return disjoint rows", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => insertOutboxRow()));
    const ours = new Set(ids);

    const [resA, resB] = await Promise.all([
      admin.rpc("claim_due_emails", { p_limit: 5 }),
      admin.rpc("claim_due_emails", { p_limit: 5 }),
    ]);
    expect(resA.error).toBeNull();
    expect(resB.error).toBeNull();

    const claimedA = (resA.data ?? []).map((r) => r.id).filter((id) => ours.has(id));
    const claimedB = (resB.data ?? []).map((r) => r.id).filter((id) => ours.has(id));

    // Disjoint (FOR UPDATE SKIP LOCKED) and jointly complete: 5 + 5 = all 10.
    const overlap = claimedA.filter((id) => claimedB.includes(id));
    expect(overlap).toHaveLength(0);
    expect(claimedA.length + claimedB.length).toBe(10);
  });

  it("(d) a row at the attempts cap (5) is never claimed", async () => {
    const cappedId = await insertOutboxRow({ attempts: 5 });

    const targeted = await admin.rpc("claim_due_emails", { p_id: cappedId });
    expect(targeted.error).toBeNull();
    expect(targeted.data).toHaveLength(0);

    const broad = await admin.rpc("claim_due_emails", { p_limit: 50 });
    expect(broad.error).toBeNull();
    expect(broad.data?.map((r) => r.id)).not.toContain(cappedId);
  });

  it("(e) p_id claims only the targeted row, leaving other due rows claimable", async () => {
    const idA = await insertOutboxRow();
    const idB = await insertOutboxRow();

    const claimA = await admin.rpc("claim_due_emails", { p_id: idA });
    expect(claimA.error).toBeNull();
    expect(claimA.data?.map((r) => r.id)).toEqual([idA]);

    // B was untouched by A's targeted claim and is still due.
    const claimB = await admin.rpc("claim_due_emails", { p_id: idB });
    expect(claimB.error).toBeNull();
    expect(claimB.data?.map((r) => r.id)).toEqual([idB]);
  });
});
