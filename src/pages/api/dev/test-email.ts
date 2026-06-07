import type { APIRoute } from "astro";
import { createAdminClient } from "@/lib/supabase-admin";
import { getEmailConfig } from "@/lib/email/config";
import { renderEmailLayout, sendTransactionalEmail, type DrainResult } from "@/lib/email";

export const prerender = false;

// Guarded smoke endpoint for the transactional email channel (F-02): enqueues
// a real email through the full production path (outbox → immediate drain →
// Brevo). Self-limiting: requires a signed-in user and sends ONLY to that
// user's own address — no recipient input. Accepted risk (documented in
// CLAUDE.md.scaffold): auth-only but un-rate-limited; revisit if abuse
// appears against the 300/day Brevo free-tier quota.

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Zaloguj się, aby wysłać testowy e-mail" }, 401);
  }
  if (!user.email) {
    return json({ error: "Zalogowany użytkownik nie ma adresu e-mail" }, 400);
  }

  // Timestamp in subject + body so inbox arrival time is comparable against
  // the send time (<5 min NFR evidence).
  const sentAt = new Date().toISOString();

  // Capture the immediate-drain promise instead of fire-and-forget so the
  // drain outcome lands in the response — this endpoint exists to produce
  // smoke evidence (see plan Phase 3: "await the drain directly").
  let drainPromise: Promise<unknown> | undefined;
  const { enqueued, id } = await sendTransactionalEmail(
    {
      admin: createAdminClient(),
      config: getEmailConfig(),
      waitUntil: (promise) => {
        drainPromise = promise;
      },
    },
    {
      to: user.email,
      subject: `Test kanału e-mail — ${sentAt}`,
      html: renderEmailLayout({
        title: "Test kanału e-mail",
        bodyHtml: `<p>To jest testowa wiadomość kanału transakcyjnego Zagroda Hub.</p><p>Czas wysłania: <strong>${sentAt}</strong></p>`,
      }),
    },
  );

  const result: DrainResult = drainPromise ? ((await drainPromise) as DrainResult) : { claimed: 0, sent: 0, failed: 0 };

  return json({ enqueued, id, result });
};
