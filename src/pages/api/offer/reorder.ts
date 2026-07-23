import type { APIRoute } from "astro";
import { reorderSchema, fieldErrorsFromZod } from "@/lib/offer";
import { json } from "@/lib/booking-decision";
import { gate } from "./index";

export const prerender = false;

// S-12: persist owner-controlled ordering in one request. sort_order = array
// index, each update scoped to the owner's zagroda under RLS — ids the caller
// does not own are silently no-ops (never touch another owner's rows), so a
// crafted id list cannot reorder a stranger's offers.
export const POST: APIRoute = async (context) => {
  const gated = gate(context);
  if (gated instanceof Response) return gated;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }

  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Sprawdź poprawność formularza", fieldErrors: fieldErrorsFromZod(parsed.error) }, 422);
  }

  const { ids } = parsed.data;
  for (let i = 0; i < ids.length; i++) {
    const { error } = await gated.supabase.from("oferty").update({ sort_order: i }).eq("id", ids[i]);
    if (error) {
      return json({ error: "Nie udało się zapisać kolejności" }, 500);
    }
  }
  return json({ ok: true });
};
