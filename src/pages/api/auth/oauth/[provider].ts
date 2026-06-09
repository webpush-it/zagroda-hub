import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isOAuthProvider, OAUTH_MESSAGES } from "@/lib/auth/oauth-guard";

export const GET: APIRoute = async (context) => {
  const provider = context.params.provider;

  if (!isOAuthProvider(provider)) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(OAUTH_MESSAGES.invalidProvider)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // skipBrowserRedirect:true returns the consent URL instead of a 3xx, so the
  // SSR cookie holding the PKCE verifier is committed on OUR redirect rather
  // than lost on Supabase's. redirectTo is derived from the request origin so
  // it works unchanged across local/prod (must be in the Supabase allow-list).
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${context.url.origin}/api/auth/callback`,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(OAUTH_MESSAGES.exchangeFailed)}`);
  }

  return context.redirect(data.url);
};
