import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/db/database.types";
import { sendViaBrevo } from "../../src/lib/email/brevo";
import type { EmailConfig } from "../../src/lib/email/config";
import { renderEmailLayout } from "../../src/lib/email/layout";
import { drainDueEmails } from "../../src/lib/email/outbox";
import { sendTransactionalEmail } from "../../src/lib/email";

// Locks the Brevo payload contract and the no-op/failure behavior without any
// network: fetch is stubbed, the admin client is mocked (stubbing global
// fetch would break a real supabase-js client, which also uses fetch).
// Note: these run with the local Supabase stack up anyway — vitest's
// globalSetup is unconditional (accepted, least machinery).

const CONFIG: EmailConfig = {
  apiKey: "test-api-key",
  fromEmail: "sender@zagroda.test",
  fromName: "Zagroda Hub",
};

interface ClaimedRow {
  id: string;
  attempts: number;
  to_email: string;
  subject: string;
  html: string;
  reply_to: string | null;
}

function claimedRow(overrides: Partial<ClaimedRow> = {}): ClaimedRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    attempts: 1,
    to_email: "guest@test.local",
    subject: "Temat",
    html: "<p>Treść</p>",
    reply_to: null,
    ...overrides,
  };
}

/** Mock admin client recording rpc calls and update payloads. */
function createMockAdmin(rows: ClaimedRow[] = []) {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const updates: { values: Record<string, unknown>; id: string }[] = [];
  const inserted: Record<string, unknown>[] = [];
  const mock = {
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: rows, error: null });
    },
    from() {
      return {
        update(values: Record<string, unknown>) {
          return {
            eq(_column: string, id: string) {
              updates.push({ values, id });
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(values: Record<string, unknown>) {
          inserted.push(values);
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({ data: { id: "enqueued-id" }, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { admin: mock as unknown as SupabaseClient<Database>, rpcCalls, updates, inserted };
}

function stubFetchResponse(status: number, body: string) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendViaBrevo — payload contract", () => {
  it("(a) sends the documented Brevo shape, including replyTo passthrough", async () => {
    const fetchMock = stubFetchResponse(201, JSON.stringify({ messageId: "<brevo-msg-1>" }));

    const result = await sendViaBrevo(CONFIG, {
      to: "guest@test.local",
      subject: "Temat",
      html: "<p>Treść</p>",
      replyTo: "owner@test.local",
    });

    expect(result).toEqual({ ok: true, messageId: "<brevo-msg-1>" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "api-key": "test-api-key",
      "content-type": "application/json",
      accept: "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: "Zagroda Hub", email: "sender@zagroda.test" },
      to: [{ email: "guest@test.local" }],
      subject: "Temat",
      htmlContent: "<p>Treść</p>",
      replyTo: { email: "owner@test.local" },
    });
  });

  it("(a2) omits the replyTo key entirely when not provided", async () => {
    const fetchMock = stubFetchResponse(201, JSON.stringify({ messageId: "x" }));

    await sendViaBrevo(CONFIG, { to: "guest@test.local", subject: "Temat", html: "<p>Treść</p>" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("replyTo");
  });

  it("(b) maps non-2xx to { ok: false } with the status in the error", async () => {
    stubFetchResponse(401, JSON.stringify({ message: "Key not found" }));

    const result = await sendViaBrevo(CONFIG, { to: "a@b.c", subject: "s", html: "<p>h</p>" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("401");
      expect(result.error).toContain("Key not found");
    }
  });

  it("(b2) maps a thrown fetch error to { ok: false } instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await sendViaBrevo(CONFIG, { to: "a@b.c", subject: "s", html: "<p>h</p>" });

    expect(result).toEqual({ ok: false, error: "network down" });
  });
});

describe("drainDueEmails — no-op and failure paths", () => {
  it("(c) null config sends nothing and never calls the claim RPC (no attempts consumed)", async () => {
    const fetchMock = stubFetchResponse(201, "{}");
    const { admin, rpcCalls, updates } = createMockAdmin([claimedRow()]);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await drainDueEmails(admin, null);

    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(rpcCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(d) a failed send below the attempts cap records last_error but keeps the row pending", async () => {
    stubFetchResponse(500, "transient");
    const { admin, updates } = createMockAdmin([claimedRow({ attempts: 2 })]);

    const result = await drainDueEmails(admin, CONFIG);

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toHaveProperty("last_error");
    expect(updates[0].values).not.toHaveProperty("status"); // stays pending
  });

  it("(d2) a failed send at the attempts cap (5) marks the row failed", async () => {
    stubFetchResponse(500, "still broken");
    const { admin, updates } = createMockAdmin([claimedRow({ attempts: 5 })]);

    const result = await drainDueEmails(admin, CONFIG);

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({ status: "failed" });
    expect(updates[0].values).toHaveProperty("last_error");
  });

  it("(d3) a successful send marks the row sent with the provider message id", async () => {
    stubFetchResponse(201, JSON.stringify({ messageId: "<brevo-msg-2>" }));
    const { admin, updates } = createMockAdmin([claimedRow()]);

    const result = await drainDueEmails(admin, CONFIG);

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({ status: "sent", provider_message_id: "<brevo-msg-2>" });
    expect(updates[0].values).toHaveProperty("sent_at");
  });
});

describe("sendTransactionalEmail — entry point", () => {
  it("null admin is a logged no-op that never breaks the caller", async () => {
    const fetchMock = stubFetchResponse(201, "{}");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await sendTransactionalEmail(
      { admin: null, config: CONFIG },
      { to: "guest@test.local", subject: "Temat", html: "<p>Treść</p>" },
    );

    expect(result).toEqual({ enqueued: false });
    expect(warn).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enqueues, then drains the just-enqueued row targeted by id", async () => {
    stubFetchResponse(201, JSON.stringify({ messageId: "x" }));
    const { admin, rpcCalls, inserted } = createMockAdmin([]);
    const scheduled: Promise<unknown>[] = [];

    const result = await sendTransactionalEmail(
      { admin, config: CONFIG, waitUntil: (p) => scheduled.push(p) },
      { to: "guest@test.local", subject: "Temat", html: "<p>Treść</p>", replyTo: "owner@test.local" },
    );

    expect(result).toEqual({ enqueued: true, id: "enqueued-id" });
    expect(inserted[0]).toMatchObject({
      to_email: "guest@test.local",
      subject: "Temat",
      html: "<p>Treść</p>",
      reply_to: "owner@test.local",
    });
    expect(scheduled).toHaveLength(1);
    await Promise.all(scheduled);
    expect(rpcCalls).toEqual([{ fn: "claim_due_emails", args: { p_id: "enqueued-id" } }]);
  });
});

describe("renderEmailLayout", () => {
  it("renders title and body with no external resources", () => {
    const html = renderEmailLayout({ title: "Nowa rezerwacja", bodyHtml: "<p>Szczegóły wizyty</p>" });

    expect(html).toContain("Nowa rezerwacja");
    expect(html).toContain("<p>Szczegóły wizyty</p>");
    expect(html).toContain("Zagroda Hub");
    // Email-client-safe: no external images, fonts, stylesheets or links.
    expect(html).not.toMatch(/src=|href=|url\(|@import|https?:\/\//);
  });

  it("escapes HTML in the title", () => {
    const html = renderEmailLayout({ title: '<script>"x"</script>', bodyHtml: "<p>ok</p>" });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  });
});
