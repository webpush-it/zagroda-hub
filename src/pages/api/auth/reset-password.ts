import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { resolveResetRedirect } from "@/lib/auth/reset-redirect";

const resetSchema = z.object({
  password: z.string().min(6),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const parsed = resetSchema.safeParse({ password: form.get("password") });

  if (!parsed.success) {
    return context.redirect(`/auth/reset-password?error=${encodeURIComponent("Hasło musi mieć min. 6 znaków")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/reset-password?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // The recovery link (confirm.ts verifyOtp) established a session; updateUser
  // is authorized by it. No session means the link expired/was reused/opened cold.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return context.redirect(resolveResetRedirect({ hasSession: false }));
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  return context.redirect(resolveResetRedirect({ hasSession: true, errorCode: error?.code ?? null }));
};
