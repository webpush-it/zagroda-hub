import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";
import { isOAuthProvider, resolveOAuthVerdict, OAUTH_MESSAGES } from "@/lib/auth/oauth-guard";

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
  // Tri-state: true/false = the check ran; null = it could not run, which the
  // verdict treats as a block (fail closed). Each null cause gets its own
  // console.error so the root cause is greppable in `wrangler tail`.
  let passwordAccountExists: boolean | null = null;
  if (!emailVerified) {
    if (!data.user.email) {
      // Should not exist while providers run with email_optional=false; if it
      // ever does, there is no address to run the collision check against.
      // eslint-disable-next-line no-console -- intentional ops signal for an email-less OAuth login
      console.error(
        "[auth/callback] no email on unverified OAuth login; FR-018 collision check cannot run — blocking (fail closed)",
      );
    } else {
      const admin = createAdminClient();
      if (!admin) {
        // No service-role client (missing SERVICE_ROLE_KEY) → the FR-018
        // collision check CANNOT run → block (fail closed).
        // eslint-disable-next-line no-console -- intentional ops signal for a missing service-role key
        console.error(
          "[auth/callback] admin client unavailable on unverified-email path; FR-018 collision check cannot run — blocking (fail closed)",
        );
      } else {
        const { data: exists, error: rpcError } = await admin.rpc("password_account_exists", {
          p_email: data.user.email,
        });
        if (rpcError) {
          // RPC failure (e.g. a corrupted service-role key 401s with a non-null
          // client) → the check did not actually run → block (fail closed).
          // eslint-disable-next-line no-console -- intentional ops signal for a failing collision-check RPC
          console.error(
            `[auth/callback] password_account_exists RPC failed on unverified-email path; FR-018 collision check cannot run — blocking (fail closed): ${rpcError.message}`,
          );
        } else {
          passwordAccountExists = exists;
        }
      }
    }
  }

  // (4) FR-018 block: unverified provider email colliding with a password
  // account, or the collision check being unable to run. Sign out and bounce
  // back with the matching message. Do NOT delete the OAuth user —
  // zagrody.owner_id is ON DELETE CASCADE and a re-login reuses an existing
  // unverified account, so deletion could destroy a real zagroda. An unused
  // orphan is harmless: the block never grants access.
  const verdict = resolveOAuthVerdict({ emailVerified, passwordAccountExists });
  if (verdict !== "allow") {
    await supabase.auth.signOut();
    const message = verdict === "block_collision" ? OAUTH_MESSAGES.block : OAUTH_MESSAGES.blockUnavailable;
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }

  // (5) Verified merge (Supabase default) or clean new OAuth user → dashboard.
  return context.redirect("/dashboard");
};
