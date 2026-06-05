import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const resendSchema = z.object({
  email: z.email(),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const parsed = resendSchema.safeParse({ email: form.get("email") });

  if (!parsed.success) {
    return context.redirect(`/auth/confirm-email?error=${encodeURIComponent("Podaj poprawny adres e-mail")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/confirm-email?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // Always report success — no user enumeration through the resend path.
  await supabase.auth.resend({ type: "signup", email: parsed.data.email });

  return context.redirect(`/auth/confirm-email?sent=1&email=${encodeURIComponent(parsed.data.email)}`);
};
