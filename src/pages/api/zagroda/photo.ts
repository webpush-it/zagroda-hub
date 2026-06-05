import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

const BUCKET = "zagroda-photos";
const MAX_SIZE = 5 * 1024 * 1024; // mirrors the bucket's file_size_limit
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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
    return json({ error: "Zaloguj się, aby dodać zdjęcie" }, 401);
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return json({ error: "Wybierz plik ze zdjęciem" }, 422);
  }
  const ext = ALLOWED_TYPES[photo.type];
  if (!ext) {
    return json({ error: "Dozwolone formaty: JPEG, PNG, WebP" }, 422);
  }
  if (photo.size > MAX_SIZE) {
    return json({ error: "Zdjęcie może mieć maksymalnie 5 MB" }, 422);
  }

  // The zagroda row must exist first — without it the photo_path UPDATE below
  // would be a silent no-op under RLS.
  const { data: zagroda, error: selectError } = await supabase
    .from("zagrody")
    .select("id, photo_path")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (selectError) {
    return json({ error: "Nie udało się odczytać profilu" }, 500);
  }
  if (!zagroda) {
    return json({ error: "Najpierw zapisz profil zagrody" }, 409);
  }

  // Owner-scoped path: storage RLS allows writes only under <auth.uid()>/.
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, photo, { contentType: photo.type });
  if (uploadError) {
    return json({ error: "Nie udało się przesłać zdjęcia" }, 500);
  }

  const { error: updateError } = await supabase.from("zagrody").update({ photo_path: path }).eq("id", zagroda.id);
  if (updateError) {
    // Roll back the orphaned upload best-effort, then report.
    await supabase.storage.from(BUCKET).remove([path]);
    return json({ error: "Nie udało się zapisać zdjęcia w profilu" }, 500);
  }

  // Best-effort cleanup of the previously referenced object.
  if (zagroda.photo_path && zagroda.photo_path !== path) {
    await supabase.storage.from(BUCKET).remove([zagroda.photo_path]);
  }

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return json({ ok: true, photo_path: path, url: publicUrl.publicUrl });
};
