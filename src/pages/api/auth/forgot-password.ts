import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const forgotSchema = z.object({
  email: z.email(),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const parsed = forgotSchema.safeParse({ email: form.get("email") });

  if (!parsed.success) {
    return context.redirect(`/auth/forgot-password?error=${encodeURIComponent("Podaj poprawny adres e-mail")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/forgot-password?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // Always report success — no user enumeration through the reset path.
  // The recovery link is built by the template via {{ .SiteURL }}; no redirectTo.
  await supabase.auth.resetPasswordForEmail(parsed.data.email);

  return context.redirect(`/auth/forgot-password?sent=1`);
};
