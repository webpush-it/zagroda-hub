import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const signinSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const parsed = signinSchema.safeParse({ email: form.get("email"), password: form.get("password") });

  if (!parsed.success) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Podaj poprawny adres e-mail i hasło")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Unverified user — route to the resend hub instead of a raw error string.
    if (error.code === "email_not_confirmed") {
      return context.redirect(`/auth/confirm-email?email=${encodeURIComponent(parsed.data.email)}`);
    }
    if (error.code === "invalid_credentials") {
      return context.redirect(`/auth/signin?error=${encodeURIComponent("Nieprawidłowy e-mail lub hasło")}`);
    }
    // Fixed string — never reflect Supabase's raw message into the query.
    return context.redirect(
      `/auth/signin?error=${encodeURIComponent("Logowanie nie powiodło się. Spróbuj ponownie.")}`,
    );
  }

  return context.redirect("/dashboard");
};
