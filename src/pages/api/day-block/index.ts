import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { dayBlockSchema, fieldErrorsFromZod } from "@/lib/booking";
import { json } from "@/lib/booking-decision";

export const prerender = false;

// S-08 FR-022/FR-023: block ("dzień wolny") and unblock a whole day.
// block_day is demand-increasing (takes the zagroda lock, idempotent);
// unblock_day is demand-decreasing (no lock — availability only grows).
// Multi-method file precedent: zagroda/index.ts exports PUT.

interface Gate {
  supabase: NonNullable<ReturnType<typeof createClient>>;
  input: { zagroda_id: string; blocked_date: string };
}

/** Shared auth gates + body parse for both methods; a Response means "refused". */
async function gate(context: Parameters<APIRoute>[0]): Promise<Gate | Response> {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase nie jest skonfigurowane" }, 503);
  }
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Zaloguj się, aby zarządzać dostępnością" }, 401);
  }
  // FR-006: same verification gate as the decision routes — owner actions only.
  if (!user.email_confirmed_at) {
    return json({ error: "Zweryfikuj adres e-mail, aby zarządzać dostępnością" }, 409);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }
  const parsed = dayBlockSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Sprawdź poprawność formularza", fieldErrors: fieldErrorsFromZod(parsed.error) }, 422);
  }
  return { supabase, input: parsed.data };
}

export const POST: APIRoute = async (context) => {
  const gated = await gate(context);
  if (gated instanceof Response) {
    return gated;
  }

  const { data, error: rpcError } = await gated.supabase.rpc("block_day", {
    p_zagroda_id: gated.input.zagroda_id,
    p_blocked_date: gated.input.blocked_date,
  });
  if (rpcError) {
    switch (rpcError.code) {
      case "42501":
        return json({ error: "Brak uprawnień do tej zagrody" }, 403);
      case "55000":
        return json({ error: "Data nie może być w przeszłości" }, 409);
      default:
        return json({ error: "Nie udało się zablokować dnia" }, 500);
    }
  }

  // Idempotent success — already_blocked is not an error for the owner.
  const row = data.at(0);
  if (!row?.blocked) {
    return json({ error: "Nie udało się zablokować dnia" }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async (context) => {
  const gated = await gate(context);
  if (gated instanceof Response) {
    return gated;
  }

  const { data, error: rpcError } = await gated.supabase.rpc("unblock_day", {
    p_zagroda_id: gated.input.zagroda_id,
    p_blocked_date: gated.input.blocked_date,
  });
  if (rpcError) {
    switch (rpcError.code) {
      case "42501":
        return json({ error: "Brak uprawnień do tej zagrody" }, 403);
      default:
        return json({ error: "Nie udało się odblokować dnia" }, 500);
    }
  }

  const row = data.at(0);
  if (!row?.unblocked) {
    // Soft outcome — no such block (e.g. already removed in another tab).
    return json({ error: "Ten dzień nie jest zablokowany" }, 404);
  }
  return json({ ok: true });
};
