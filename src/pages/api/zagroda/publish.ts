import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const publishSchema = z.object({ publish: z.boolean() });

// DB field identifiers (set_zagroda_published's profile_incomplete payload) → Polish labels.
const FIELD_LABELS: Record<string, string> = {
  name: "nazwa",
  description: "opis",
  voivodeship: "województwo",
  city: "miejscowość",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** Maps set_zagroda_published()'s errcode-based errors to Polish UX copy. */
function mapPublishError(message: string): { error: string; status: number } | null {
  if (message.includes("email_not_verified")) {
    return { error: "Zweryfikuj adres e-mail, aby opublikować zagrodę", status: 409 };
  }
  if (message.includes("no_turnus")) {
    return { error: "Dodaj co najmniej jeden turnus, aby opublikować zagrodę", status: 409 };
  }
  const incomplete = /profile_incomplete: (.+)/.exec(message);
  if (incomplete) {
    const fields = incomplete[1]
      .split(",")
      .map((f) => FIELD_LABELS[f.trim()] ?? f.trim())
      .join(", ");
    return { error: `Uzupełnij wymagane pola: ${fields}`, status: 409 };
  }
  return null;
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase nie jest skonfigurowane" }, 503);
  }
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Zaloguj się, aby publikować" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Nieprawidłowe dane żądania" }, 422);
  }

  const { data: zagroda, error: selectError } = await supabase
    .from("zagrody")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (selectError) {
    return json({ error: "Nie udało się odczytać profilu" }, 500);
  }
  if (!zagroda) {
    return json({ error: "Najpierw zapisz profil zagrody" }, 409);
  }

  const { data: isPublished, error: rpcError } = await supabase.rpc("set_zagroda_published", {
    target_zagroda_id: zagroda.id,
    publish: parsed.data.publish,
  });
  if (rpcError) {
    const mapped = mapPublishError(rpcError.message);
    if (mapped) {
      return json({ error: mapped.error }, mapped.status);
    }
    return json({ error: "Nie udało się zmienić statusu publikacji" }, 500);
  }

  return json({ is_published: isPublished });
};
