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
  invalidProvider: "Nieobsługiwany dostawca logowania.",
  exchangeFailed: "Logowanie przez dostawcę nie powiodło się. Spróbuj ponownie.",
} as const;

export const OAUTH_PROVIDERS = ["google", "facebook"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: string | undefined): value is OAuthProvider {
  return value === "google" || value === "facebook";
}

/**
 * The FR-018 block decision.
 *
 * Block ONLY when the authenticating OAuth identity reports an unverified email
 * AND an email+password account already exists for that address (anti-account-
 * takeover). A verified provider email (always true for Google) auto-merges via
 * Supabase's default linking and is never blocked; an unverified email with no
 * existing password account is a clean new/separate OAuth user and is allowed.
 */
export function shouldBlockOAuth(input: { emailVerified: boolean; passwordAccountExists: boolean }): boolean {
  return !input.emailVerified && input.passwordAccountExists;
}
