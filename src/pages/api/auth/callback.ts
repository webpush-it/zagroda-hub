import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";
import { isOAuthProvider, shouldBlockOAuth, OAUTH_MESSAGES } from "@/lib/auth/oauth-guard";

export const GET: APIRoute = async (context) => {
  const code = context.url.searchParams.get("code");

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  if (!code) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(OAUTH_MESSAGES.exchangeFailed)}`);
  }

  // (1) Exchange the PKCE code for a session (sets the auth cookies via setAll).
  // On success `data.user` is a non-null User (per the typed response).
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(OAUTH_MESSAGES.exchangeFailed)}`);
  }

  // (2) Inspect the authenticating OAuth identity's email_verified flag.
  const oauthIdentity = data.user.identities?.find((i) => isOAuthProvider(i.provider));
  const emailVerified = Boolean(oauthIdentity?.identity_data?.email_verified);

  // (3) Only on an UNVERIFIED provider email do we pay the existence check —
  // never for Google (always verified). The check is service-role-only.
  let passwordAccountExists = false;
  if (!emailVerified && data.user.email) {
    const admin = createAdminClient();
    if (admin) {
      const { data: exists } = await admin.rpc("password_account_exists", { p_email: data.user.email });
      passwordAccountExists = Boolean(exists);
    } else {
      // No service-role client (missing SERVICE_ROLE_KEY) → the FR-018 collision
      // block CANNOT run and this unverified-email login is allowed through.
      // Surface it so a missing key is observable in `wrangler tail` rather than
      // silently weakening the guardrail.
      // eslint-disable-next-line no-console -- intentional ops signal for a missing service-role key
      console.warn(
        "[auth/callback] admin client unavailable on unverified-email path; FR-018 collision block skipped (password_account_exists not checked)",
      );
    }
  }

  // (4) FR-018 block: unverified provider email colliding with a password
  // account. Sign out and bounce back with the "zaloguj się hasłem" message.
  // Do NOT delete the OAuth user — zagrody.owner_id is ON DELETE CASCADE and a
  // re-login reuses an existing unverified account, so deletion could destroy a
  // real zagroda. An unused orphan is harmless: the block never grants access.
  if (shouldBlockOAuth({ emailVerified, passwordAccountExists })) {
    await supabase.auth.signOut();
    return context.redirect(`/auth/signin?error=${encodeURIComponent(OAUTH_MESSAGES.block)}`);
  }

  // (5) Verified merge (Supabase default) or clean new OAuth user → dashboard.
  return context.redirect("/dashboard");
};
