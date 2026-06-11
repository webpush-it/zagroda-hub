import type { APIRoute } from "astro";
import { SITE_URL } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";
import { getEmailConfig } from "@/lib/email/config";
import { sendTransactionalEmail } from "@/lib/email";
import { bookingRequestSchema, buildBookingEmails, fieldErrorsFromZod, type BookingRequestInput } from "@/lib/booking";
import { getWaitUntil } from "@/lib/cf";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase nie jest skonfigurowane" }, 503);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane żądania" }, 400);
  }

  const parsed = bookingRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Sprawdź poprawność formularza", fieldErrors: fieldErrorsFromZod(parsed.error) }, 422);
  }
  const data = parsed.data;

  // The anon INSERT policy only checks status='pending', NOT is_published — a
  // crafted POST could otherwise create a request against a draft zagroda.
  // Anon can read published zagrody (same query as zagrody/[id].astro); the
  // turnus label is harvested here for the owner-notification email.
  const { data: zagroda, error: lookupError } = await supabase
    .from("zagrody")
    .select("id, turnusy(id, label)")
    .eq("id", data.zagroda_id)
    .eq("is_published", true)
    .maybeSingle();
  if (lookupError) {
    return json({ error: "Nie udało się zweryfikować zagrody" }, 500);
  }
  if (!zagroda) {
    return json({ error: "Zagroda niedostępna" }, 422);
  }
  const turnusLabel = zagroda.turnusy.find((t) => t.id === data.turnus_id)?.label ?? null;

  // Id + token generated here so no read-back is needed (anon has no SELECT
  // policy); bare .insert() — a chained .select() would surface a false RLS
  // error. The id feeds the owner email's deep link to the detail page.
  const id = crypto.randomUUID();
  const cancel_token = crypto.randomUUID();
  const { error: insertError } = await supabase.from("booking_requests").insert({ ...data, id, cancel_token });
  if (insertError) {
    // FK mismatch (turnus not on this zagroda) or RLS rejection — never leak.
    return json({ error: "Nie udało się utworzyć zapytania. Sprawdź wybrany turnus i spróbuj ponownie." }, 422);
  }

  // Best-effort emails — must never fail the response. Owner contact lives in
  // auth (not anon-readable), so resolve it with the service-role client.
  await enqueueBookingEmails(context, data, id, cancel_token, turnusLabel);

  return json({ ok: true });
};

async function enqueueBookingEmails(
  context: Parameters<APIRoute>[0],
  data: BookingRequestInput,
  requestId: string,
  cancelToken: string,
  turnusLabel: string | null,
): Promise<void> {
  try {
    const admin = createAdminClient();
    let zagrodaName = "zagroda";
    let ownerEmail: string | null = null;

    if (admin) {
      const { data: row } = await admin
        .from("zagrody")
        .select("name, owner_id")
        .eq("id", data.zagroda_id)
        .maybeSingle();
      if (row) {
        zagrodaName = row.name;
        // auth schema is not exposed over PostgREST — use the GoTrue admin API.
        const { data: userRes } = await admin.auth.admin.getUserById(row.owner_id);
        ownerEmail = userRes.user?.email ?? null;
      }
    }

    const { guest, owner } = buildBookingEmails({
      // Configured origin wins — the request URL is Host-header influenced
      // and these links land in e-mails (owner deep link, guest cancel).
      origin: SITE_URL ?? new URL(context.request.url).origin,
      requestId,
      cancelToken,
      zagrodaName,
      ownerEmail,
      turnusLabel,
      guest_name: data.guest_name,
      guest_email: data.guest_email,
      guest_phone: data.guest_phone,
      trip_date: data.trip_date,
      participants_count: data.participants_count,
    });

    const deps = { admin, config: getEmailConfig(), waitUntil: getWaitUntil(context.locals) };
    await sendTransactionalEmail(deps, guest);
    if (owner) {
      await sendTransactionalEmail(deps, owner);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[booking-request] email enqueue failed:", error);
  }
}
