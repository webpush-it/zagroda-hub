import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { offerSchema, offerUpdateSchema, offerIdSchema, fieldErrorsFromZod } from "@/lib/offer";
import { json } from "@/lib/booking-decision";

export const prerender = false;

// S-12 (FR-024/FR-025/FR-031): owner creates / edits / soft-deletes an offer.
// No RPC — there is no cross-row invariant, so RLS + plain authenticated writes
// suffice (precedent: turnusy reconcile in zagroda/index.ts, day_blocks). The
// owner ALL policy on public.oferty scopes every write to the caller's zagroda;
// a foreign owner's write simply matches 0 rows (→ 404), never another's data.

interface Gate {
  supabase: NonNullable<ReturnType<typeof createClient>>;
  user: NonNullable<App.Locals["user"]>;
}

/** Shared auth gate for every method; a Response means "refused". */
export function gate(context: Parameters<APIRoute>[0]): Gate | Response {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase nie jest skonfigurowane" }, 503);
  }
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Zaloguj się, aby zarządzać ofertami" }, 401);
  }
  // FR-006: same verification gate as the other owner routes.
  if (!user.email_confirmed_at) {
    return json({ error: "Zweryfikuj adres e-mail, aby zarządzać ofertami" }, 409);
  }
  return { supabase, user };
}

/** Parse the JSON body; a Response means the body was malformed (400). */
async function parseBody(context: Parameters<APIRoute>[0]): Promise<unknown> {
  try {
    return await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }
}

export const POST: APIRoute = async (context) => {
  const gated = gate(context);
  if (gated instanceof Response) return gated;

  const body = await parseBody(context);
  if (body instanceof Response) return body;

  const parsed = offerSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Sprawdź poprawność formularza", fieldErrors: fieldErrorsFromZod(parsed.error) }, 422);
  }
  const input = parsed.data;

  // Resolve the zagroda server-side from the caller (owner_id is UNIQUE — one
  // zagroda per owner). We never trust a client-supplied zagroda_id: RLS would
  // reject a foreign one anyway, but resolving it here also gives the correct
  // "create a profile first" error instead of a confusing RLS denial.
  const { data: zagroda, error: zagrodaError } = await gated.supabase
    .from("zagrody")
    .select("id")
    .eq("owner_id", gated.user.id)
    .maybeSingle();
  if (zagrodaError) {
    return json({ error: "Nie udało się odczytać profilu zagrody" }, 500);
  }
  if (!zagroda) {
    return json({ error: "Najpierw utwórz profil zagrody, aby dodać oferty" }, 409);
  }

  // Append at the end of the owner's current ordering (reorder can move it).
  const { count } = await gated.supabase
    .from("oferty")
    .select("id", { count: "exact", head: true })
    .eq("zagroda_id", zagroda.id);

  const { data: created, error: insertError } = await gated.supabase
    .from("oferty")
    .insert({
      zagroda_id: zagroda.id,
      nazwa: input.nazwa,
      opis: input.opis ?? null,
      czas_trwania: input.czas_trwania ?? null,
      temat: input.temat,
      adresaci: input.adresaci,
      amount_grosze: input.amount_grosze ?? null,
      price_unit: input.price_unit ?? null,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();
  if (insertError) {
    return json({ error: "Nie udało się zapisać oferty" }, 500);
  }
  return json({ ok: true, id: created.id });
};

export const PATCH: APIRoute = async (context) => {
  const gated = gate(context);
  if (gated instanceof Response) return gated;

  const body = await parseBody(context);
  if (body instanceof Response) return body;

  const parsed = offerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Sprawdź poprawność formularza", fieldErrors: fieldErrorsFromZod(parsed.error) }, 422);
  }
  const { id, sort_order, ...fields } = parsed.data;

  // RLS scopes the update to the owner; a foreign/absent id matches 0 rows.
  const { data: updated, error: updateError } = await gated.supabase
    .from("oferty")
    .update({
      nazwa: fields.nazwa,
      opis: fields.opis ?? null,
      czas_trwania: fields.czas_trwania ?? null,
      temat: fields.temat,
      adresaci: fields.adresaci,
      amount_grosze: fields.amount_grosze ?? null,
      price_unit: fields.price_unit ?? null,
      ...(sort_order !== undefined ? { sort_order } : {}),
    })
    .eq("id", id)
    .select("id");
  if (updateError) {
    return json({ error: "Nie udało się zapisać oferty" }, 500);
  }
  if (updated.length === 0) {
    return json({ error: "Nie znaleziono oferty" }, 404);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async (context) => {
  const gated = gate(context);
  if (gated instanceof Response) return gated;

  const body = await parseBody(context);
  if (body instanceof Response) return body;

  const parsed = offerIdSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Sprawdź poprawność formularza", fieldErrors: fieldErrorsFromZod(parsed.error) }, 422);
  }

  // Soft delete — set is_active=false. RLS scopes to the owner (0 rows → 404).
  const { data: deleted, error: deleteError } = await gated.supabase
    .from("oferty")
    .update({ is_active: false })
    .eq("id", parsed.data.id)
    .select("id");
  if (deleteError) {
    return json({ error: "Nie udało się usunąć oferty" }, 500);
  }
  if (deleted.length === 0) {
    return json({ error: "Nie znaleziono oferty" }, 404);
  }
  return json({ ok: true });
};
