// Pure decision logic for the FR-018 OAuth merge guardrail. Extracted from the
// callback route so the truth table can be unit-tested without a Supabase
// session or the Astro request context.

export const OAUTH_MESSAGES = {
  // The unverified-collision block. This message does reveal that a password
  // account exists for the email — a mild enumeration vector we accept
  // deliberately (see plan "What We're NOT Doing"): reaching this branch
  // requires controlling an OAuth identity that reports this exact email as
  // unverified, so the marginal leak buys a clear, actionable message.
  block: "To konto loguje się hasłem — zaloguj się hasłem (możesz też zresetować hasło).",
  // The fail-closed block: the collision check could not run, so we refuse the
  // login generically. Deliberately does NOT claim a password account exists —
  // we don't know, and saying so would be a false enumeration signal.
  blockUnavailable: "Logowanie przez dostawcę jest chwilowo niedostępne. Spróbuj ponownie później.",
  invalidProvider: "Nieobsługiwany dostawca logowania.",
  exchangeFailed: "Logowanie przez dostawcę nie powiodło się. Spróbuj ponownie.",
} as const;

export const OAUTH_PROVIDERS = ["google", "facebook"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: string | undefined): value is OAuthProvider {
  return value === "google" || value === "facebook";
}

export type OAuthVerdict = "allow" | "block_collision" | "block_unavailable";

/**
 * The FR-018 block decision, fail-closed.
 *
 * `passwordAccountExists` is tri-state: `true`/`false` mean the collision check
 * ran; `null` means it COULD NOT run (no admin client, RPC error, or no email
 * to check against).
 *
 * - Verified provider email (always true for Google) → `allow`: auto-merges via
 *   Supabase's default linking, never blocked, the check is never consulted.
 * - Unverified + existing password account → `block_collision` (anti-account-
 *   takeover; the "zaloguj się hasłem" message).
 * - Unverified + check unavailable → `block_unavailable`: we refuse to guess.
 *   Allowing here is the fail-open hole this verdict exists to close.
 * - Unverified + no password account → `allow`: clean new/separate OAuth user.
 */
export function resolveOAuthVerdict(input: {
  emailVerified: boolean;
  passwordAccountExists: boolean | null;
}): OAuthVerdict {
  if (input.emailVerified) return "allow";
  if (input.passwordAccountExists === null) return "block_unavailable";
  return input.passwordAccountExists ? "block_collision" : "allow";
}
