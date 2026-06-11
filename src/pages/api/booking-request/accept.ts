import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";
import { getEmailConfig } from "@/lib/email/config";
import { sendTransactionalEmail, type EmailMessage } from "@/lib/email";
import { buildAcceptanceEmail } from "@/lib/booking";
import { getWaitUntil } from "@/lib/cf";

export const prerender = false;

const acceptSchema = z.object({ id: z.uuid() });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase nie jest skonfigurowane" }, 503);
  }
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Zaloguj się, aby zarządzać rezerwacjami" }, 401);
  }
  // FR-006: only a verified owner may decide. Middleware sets locals.user via
  // supabase.auth.getUser(), so email_confirmed_at is server truth, not a
  // stale JWT claim.
  if (!user.email_confirmed_at) {
    return json({ error: "Zweryfikuj adres e-mail, aby zarządzać rezerwacjami" }, 409);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Nieprawidłowe dane żądania" }, 422);
  }
  const requestId = parsed.data.id;

  // Email context BEFORE the RPC — the RPC's return row carries only the limit
  // math. RLS scopes this read to the owner's own requests, so a null row
  // covers both unknown and foreign ids: respond 404 without calling the RPC.
  const { data: request, error: selectError } = await supabase
    .from("booking_requests")
    .select("id, guest_name, guest_email, trip_date, participants_count, zagroda_id, turnusy(label)")
    .eq("id", requestId)
    .maybeSingle();
  if (selectError) {
    return json({ error: "Nie udało się odczytać zapytania" }, 500);
  }
  if (!request) {
    return json({ error: "Zapytanie nie istnieje" }, 404);
  }
  const { data: zagroda } = await supabase.from("zagrody").select("name").eq("id", request.zagroda_id).maybeSingle();

  const { data, error: rpcError } = await supabase.rpc("accept_booking_request", { request_id: requestId });
  if (rpcError) {
    switch (rpcError.code) {
      case "P0002":
        return json({ error: "Zapytanie nie istnieje" }, 404);
      case "42501":
        return json({ error: "Brak uprawnień do tego zapytania" }, 403);
      case "55000":
        return json({ error: "To zapytanie nie jest już oczekujące — odśwież stronę" }, 409);
      default:
        return json({ error: "Nie udało się zaakceptować zapytania" }, 500);
    }
  }

  const row = data[0];
  if (!row.accepted) {
    // FR-014 blocked outcome — the request stays pending; exact PRD copy.
    return json(
      {
        error: `Limit dzienny przekroczony (${row.occupied} z ${row.daily_limit} zajęte, ${row.requested} wymaga miejsca)`,
        occupied: row.occupied,
        daily_limit: row.daily_limit,
        requested: row.requested,
      },
      409,
    );
  }

  await enqueueDecisionEmail(
    context,
    buildAcceptanceEmail({
      guest_name: request.guest_name,
      guest_email: request.guest_email,
      zagroda_name: zagroda?.name ?? "zagroda",
      trip_date: request.trip_date,
      turnus_label: request.turnusy.label,
      participants_count: request.participants_count,
    }),
  );

  return json({ ok: true, status: "accepted" });
};

/** Best-effort enqueue — an email failure must never fail the decision response. */
async function enqueueDecisionEmail(context: Parameters<APIRoute>[0], msg: EmailMessage): Promise<void> {
  try {
    const deps = { admin: createAdminClient(), config: getEmailConfig(), waitUntil: getWaitUntil(context.locals) };
    await sendTransactionalEmail(deps, msg);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[booking-accept] email enqueue failed:", error);
  }
}
