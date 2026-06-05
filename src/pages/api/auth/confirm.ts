import type { APIRoute } from "astro";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

export const GET: APIRoute = async (context) => {
  const tokenHash = context.url.searchParams.get("token_hash");
  const type = context.url.searchParams.get("type");

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  if (!tokenHash || !type || !OTP_TYPES.includes(type)) {
    return context.redirect(
      `/auth/signin?error=${encodeURIComponent("Link potwierdzający jest nieprawidłowy. Zaloguj się lub wyślij link ponownie.")}`,
    );
  }

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    return context.redirect(
      `/auth/signin?error=${encodeURIComponent("Link potwierdzający wygasł lub został już użyty. Zaloguj się, aby otrzymać nowy.")}`,
    );
  }

  return context.redirect("/dashboard");
};
