import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const cancelSchema = z.object({ token: z.uuid() });

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
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) {
    return json({ status: "not_found" });
  }

  // anon is granted EXECUTE on cancel_booking_request; the SECURITY DEFINER
  // function locks the request row and re-checks status under the lock.
  const { data, error } = await supabase.rpc("cancel_booking_request", { p_token: parsed.data.token });
  if (error) {
    return json({ error: "Nie udało się anulować zapytania" }, 500);
  }

  // The RPC always returns exactly one row: { cancelled, status }, where an
  // unknown token yields { cancelled: false, status: null }.
  const row = data[0];
  if (row.cancelled) {
    return json({ status: "cancelled" });
  }
  // cancelled=false → the row exists but stayed put; branch on its current status.
  switch (row.status) {
    case "cancelled_by_guest":
      return json({ status: "already_cancelled" });
    case "accepted":
      return json({ status: "already_accepted" });
    case "withdrawn_by_owner":
      return json({ status: "already_withdrawn" });
    default:
      // status is null (no row matched) or an unexpected value.
      return json({ status: "not_found" });
  }
};
