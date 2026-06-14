import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { buildWithdrawalEmail } from "@/lib/booking";
import { enqueueDecisionEmail, json } from "@/lib/booking-decision";

export const prerender = false;

const withdrawSchema = z.object({ id: z.uuid() });

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase nie jest skonfigurowane" }, 503);
  }
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Zaloguj się, aby zarządzać rezerwacjami" }, 401);
  }
  // FR-006: same verification gate as accept/reject — decisions are owner actions.
  if (!user.email_confirmed_at) {
    return json({ error: "Zweryfikuj adres e-mail, aby zarządzać rezerwacjami" }, 409);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }
  const parsed = withdrawSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Nieprawidłowe dane żądania" }, 422);
  }
  const requestId = parsed.data.id;

  // Email context BEFORE the RPC; RLS scopes the read to the owner's own
  // requests — null covers unknown and foreign ids, skip the RPC.
  const { data: request, error: selectError } = await supabase
    .from("booking_requests")
    .select("id, guest_name, guest_email, trip_date, participants_count, turnusy(label, zagrody(name))")
    .eq("id", requestId)
    .maybeSingle();
  if (selectError) {
    return json({ error: "Nie udało się odczytać zapytania" }, 500);
  }
  if (!request) {
    return json({ error: "Zapytanie nie istnieje" }, 404);
  }

  const { data, error: rpcError } = await supabase.rpc("withdraw_booking_request", { request_id: requestId });
  if (rpcError) {
    switch (rpcError.code) {
      case "P0002":
        return json({ error: "Zapytanie nie istnieje" }, 404);
      case "42501":
        return json({ error: "Brak uprawnień do tego zapytania" }, 403);
      default:
        return json({ error: "Nie udało się wycofać akceptacji" }, 500);
    }
  }

  const row = data.at(0);
  if (!row) {
    return json({ error: "Nie udało się wycofać akceptacji" }, 500);
  }
  if (!row.withdrawn) {
    // Soft outcome — the request is not in `accepted` (e.g. guest cancelled meanwhile).
    return json({ error: "To zapytanie nie jest już zaakceptowane — odśwież stronę", status: row.status }, 409);
  }

  const notified = await enqueueDecisionEmail(
    context,
    buildWithdrawalEmail({
      guest_name: request.guest_name,
      guest_email: request.guest_email,
      zagroda_name: request.turnusy.zagrody.name,
      trip_date: request.trip_date,
      turnus_label: request.turnusy.label,
      participants_count: request.participants_count,
    }),
  );

  return json({ ok: true, status: "withdrawn_by_owner", notified });
};
