import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { buildRejectionEmail } from "@/lib/booking";
import { enqueueDecisionEmail, json } from "@/lib/booking-decision";

export const prerender = false;

const rejectSchema = z.object({ id: z.uuid() });

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase nie jest skonfigurowane" }, 503);
  }
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Zaloguj się, aby zarządzać rezerwacjami" }, 401);
  }
  // FR-006: same verification gate as accept — decisions are owner actions.
  if (!user.email_confirmed_at) {
    return json({ error: "Zweryfikuj adres e-mail, aby zarządzać rezerwacjami" }, 409);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }
  const parsed = rejectSchema.safeParse(body);
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

  const { data, error: rpcError } = await supabase.rpc("reject_booking_request", { request_id: requestId });
  if (rpcError) {
    switch (rpcError.code) {
      case "P0002":
        return json({ error: "Zapytanie nie istnieje" }, 404);
      case "42501":
        return json({ error: "Brak uprawnień do tego zapytania" }, 403);
      default:
        return json({ error: "Nie udało się odrzucić zapytania" }, 500);
    }
  }

  const row = data.at(0);
  if (!row) {
    return json({ error: "Nie udało się odrzucić zapytania" }, 500);
  }
  if (!row.rejected) {
    // Soft outcome — a concurrent accept or guest cancel got there first.
    return json({ error: "To zapytanie nie jest już oczekujące — odśwież stronę", status: row.status }, 409);
  }

  // Phone entries carry no guest contact (S-08); the pending-only gate means
  // the RPC never rejects one at runtime, but the columns are `string | null`
  // now — guard the whole e-mail block so the builder never sees a null.
  const notified =
    request.guest_email !== null && request.guest_name !== null
      ? await enqueueDecisionEmail(
          context,
          buildRejectionEmail({
            guest_name: request.guest_name,
            guest_email: request.guest_email,
            zagroda_name: request.turnusy.zagrody.name,
            trip_date: request.trip_date,
            turnus_label: request.turnusy.label,
            participants_count: request.participants_count,
          }),
        )
      : false;

  return json({ ok: true, status: "rejected", notified });
};
