import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Unverified user — route to the resend hub instead of a raw error string.
    if (error.code === "email_not_confirmed") {
      return context.redirect(`/auth/confirm-email?email=${encodeURIComponent(email)}`);
    }
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/dashboard");
};
