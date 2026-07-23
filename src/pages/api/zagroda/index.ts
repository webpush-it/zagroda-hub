import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { zagrodaProfileSchema, fieldErrorsFromZod } from "@/lib/zagroda";

// JSON API (deliberate divergence from the form-POST+redirect auth routes):
// the React island consumes responses via fetch, so errors are JSON, not redirects.
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export const PUT: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase nie jest skonfigurowane" }, 503);
  }
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Zaloguj się, aby zapisać profil" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }

  const parsed = zagrodaProfileSchema.safeParse(body);
  if (!parsed.success) {
    return json({ fieldErrors: fieldErrorsFromZod(parsed.error) }, 422);
  }
  const input = parsed.data;

  // Draft model: empty optional fields are stored as NULL (= draft-incomplete);
  // completeness is enforced by set_zagroda_published(), not here.
  //
  // Coordinate precedence (zagroda-map-location): both coords present means the
  // owner dropped a pin -> location_source='manual' (the trigger keeps it, marks
  // precise). Otherwise 'auto' -> the trigger re-derives lat/lng from city/
  // voivodeship, so the coords we send here are irrelevant on the auto branch.
  const manualPin = input.latitude != null && input.longitude != null;
  const profile = {
    name: input.name,
    description: input.description || null,
    voivodeship: input.voivodeship,
    city: input.city || null,
    daily_limit: input.daily_limit,
    latitude: input.latitude,
    longitude: input.longitude,
    location_source: manualPin ? "manual" : "auto",
  };

  // Upsert the caller's zagroda (owner_id UNIQUE — one zagroda per owner). RLS
  // enforces ownership on both paths; the INSERT policy also forces is_published = false.
  // onConflict: "owner_id" — concurrent first-saves converge on one row instead of
  // the loser dying on the UNIQUE constraint as a generic 500. is_published is not
  // in the payload, so DO UPDATE never touches it (published stays published).
  const { data: upserted, error: upsertError } = await supabase
    .from("zagrody")
    .upsert({ ...profile, owner_id: user.id }, { onConflict: "owner_id" })
    .select("id")
    .single();
  if (upsertError) {
    return json({ error: "Nie udało się zapisać profilu" }, 500);
  }
  const zagrodaId = upserted.id;

  // Reconcile turnusy: update rows with id, insert rows without, delete missing ones.
  // NON-ATOMIC: each step is an independent REST call — a mid-loop failure (e.g. 23503
  // on delete) leaves a partially reconciled state behind a 409/500. Retry converges:
  // reconcile is keyed by id and deletes-missing, so a second save self-heals.
  // TODO(S-03): move into a SECURITY DEFINER function (single transaction) when the
  // booking/turnusy write paths get the turnus-edit guard.
  const { data: current, error: turnusyError } = await supabase
    .from("turnusy")
    .select("id")
    .eq("zagroda_id", zagrodaId);
  if (turnusyError) {
    return json({ error: "Nie udało się odczytać turnusów" }, 500);
  }

  const currentIds = new Set(current.map((t) => t.id));
  const incomingIds = new Set(input.turnusy.flatMap((t) => (t.id ? [t.id] : [])));
  const toDelete = current.filter((t) => !incomingIds.has(t.id)).map((t) => t.id);

  if (toDelete.length > 0) {
    const { error } = await supabase.from("turnusy").delete().in("id", toDelete).eq("zagroda_id", zagrodaId);
    if (error) {
      // FK RESTRICT (booking history protection) — domain error, not a 500.
      if (error.code === "23503") {
        return json({ error: "Turnus ma już zapytania — nie można go usunąć" }, 409);
      }
      return json({ error: "Nie udało się usunąć turnusu" }, 500);
    }
  }

  for (const turnus of input.turnusy) {
    const values = { label: turnus.label, start_time: turnus.start_time, end_time: turnus.end_time };
    if (turnus.id && currentIds.has(turnus.id)) {
      const { error } = await supabase.from("turnusy").update(values).eq("id", turnus.id).eq("zagroda_id", zagrodaId);
      if (error) {
        return json({ error: "Nie udało się zapisać turnusu" }, 500);
      }
    } else {
      // Unknown/stale ids fall through to insert-as-new (id is never client-authoritative).
      const { error } = await supabase.from("turnusy").insert({ ...values, zagroda_id: zagrodaId });
      if (error) {
        return json({ error: "Nie udało się dodać turnusu" }, 500);
      }
    }
  }

  // Return the saved state so the island can adopt DB-generated turnus ids —
  // without this, a second save would re-insert rows it just created.
  const { data: saved, error: savedError } = await supabase
    .from("zagrody")
    .select("id, is_published, photo_path, turnusy(id, label, start_time, end_time)")
    .eq("id", zagrodaId)
    .single();
  if (savedError) {
    return json({ error: "Zapisano, ale nie udało się odczytać profilu" }, 500);
  }

  return json({
    ok: true,
    zagroda: { id: saved.id, is_published: saved.is_published, photo_path: saved.photo_path },
    turnusy: saved.turnusy
      .map((t) => ({ ...t, start_time: t.start_time.slice(0, 5), end_time: t.end_time.slice(0, 5) }))
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
  });
};
