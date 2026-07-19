import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { manualBookingSchema, fieldErrorsFromZod } from "@/lib/booking";
import { json } from "@/lib/booking-decision";

export const prerender = false;

// S-08 FR-021: the owner records a phone booking. The row is born accepted
// with source='phone' inside create_manual_booking — the SAME zagroda lock as
// acceptances, so the anti-overbooking guarantee covers both channels.
// Deliberately NO e-mail step: manual entries have no guest contact (FR
// guardrail — the e-mail channel is unchanged).
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase nie jest skonfigurowane" }, 503);
  }
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Zaloguj się, aby zarządzać rezerwacjami" }, 401);
  }
  // FR-006: same verification gate as the decision routes — owner actions only.
  if (!user.email_confirmed_at) {
    return json({ error: "Zweryfikuj adres e-mail, aby zarządzać rezerwacjami" }, 409);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }
  const parsed = manualBookingSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Sprawdź poprawność formularza", fieldErrors: fieldErrorsFromZod(parsed.error) }, 422);
  }
  const input = parsed.data;

  const { data, error: rpcError } = await supabase.rpc("create_manual_booking", {
    p_zagroda_id: input.zagroda_id,
    p_turnus_id: input.turnus_id,
    p_trip_date: input.trip_date,
    p_participants: input.participants_count,
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (rpcError) {
    switch (rpcError.code) {
      case "42501":
        return json({ error: "Brak uprawnień do tej zagrody" }, 403);
      case "55000":
        return json({ error: "Data nie może być w przeszłości" }, 409);
      default:
        // Includes the composite-FK rejection of a foreign turnus — the UI
        // select prevents it, so no dedicated copy.
        return json({ error: "Nie udało się dodać rezerwacji" }, 500);
    }
  }

  const row = data.at(0);
  if (!row) {
    return json({ error: "Nie udało się dodać rezerwacji" }, 500);
  }
  if (row.day_blocked) {
    return json({ code: "day_blocked", error: "Dzień jest zablokowany — odblokuj go, aby dodać rezerwację" }, 409);
  }
  if (!row.created) {
    // FR-014 blocked outcome — exact PRD copy, same shape as accept.ts.
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

  return json({ ok: true, id: row.request_id });
};
