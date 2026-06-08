// Pure redirect-decision logic for the password-reset (set-new-password) flow.
// Extracted from the API route so it can be unit-tested without a Supabase
// session or the Astro request context.

export const RESET_MESSAGES = {
  expired: "Link wygasł lub został już użyty. Poproś o nowy link do resetu hasła.",
  weak: "Hasło jest zbyt słabe (min. 6 znaków).",
  generic: "Nie udało się ustawić nowego hasła. Spróbuj ponownie.",
} as const;

/**
 * Maps the outcome of the set-new-password step to a redirect target.
 *
 * - no recovery session (expired/reused/cold link) → back to request a fresh link
 * - weak_password → stay on the form with the weak-password message
 * - any other update error → stay on the form with a generic message
 * - success → dashboard
 */
export function resolveResetRedirect(input: { hasSession: boolean; errorCode?: string | null }): string {
  if (!input.hasSession) {
    return `/auth/forgot-password?error=${encodeURIComponent(RESET_MESSAGES.expired)}`;
  }
  if (input.errorCode === "weak_password") {
    return `/auth/reset-password?error=${encodeURIComponent(RESET_MESSAGES.weak)}`;
  }
  if (input.errorCode) {
    return `/auth/reset-password?error=${encodeURIComponent(RESET_MESSAGES.generic)}`;
  }
  return "/dashboard";
}
