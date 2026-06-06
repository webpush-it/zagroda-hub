import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const signupSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const parsed = signupSchema.safeParse({ email: form.get("email"), password: form.get("password") });

  if (!parsed.success) {
    return context.redirect(
      `/auth/signup?error=${encodeURIComponent("Podaj poprawny e-mail i hasło (min. 6 znaków)")}`,
    );
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signUp(parsed.data);

  if (error) {
    if (error.code === "weak_password") {
      return context.redirect(`/auth/signup?error=${encodeURIComponent("Hasło jest zbyt słabe (min. 6 znaków)")}`);
    }
    // Fixed string — never reflect Supabase's raw message into the query.
    return context.redirect(
      `/auth/signup?error=${encodeURIComponent("Rejestracja nie powiodła się. Spróbuj ponownie.")}`,
    );
  }

  return context.redirect(`/auth/confirm-email?email=${encodeURIComponent(parsed.data.email)}`);
};
