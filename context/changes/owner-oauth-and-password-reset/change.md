---
change_id: owner-oauth-and-password-reset
title: Owner oauth and password reset
status: implementing
created: 2026-06-08
updated: 2026-06-08
archived_at: null
---

## Notes

### Phase 1 manual verification (2026-06-08, done by agent at user request)

Verified at the HTTP level against the running local Supabase stack (Mailpit on :54324, API :54321) with a verified test user:
- **1.5 no-enumeration** ✓ — known and unknown emails both redirect to `/auth/forgot-password?sent=1`.
- **1.6 recovery flow** ✓ — minted a real recovery `token_hash` (admin `generate_link`, identical to the email's `{{ .TokenHash }}`); `GET /api/auth/confirm?type=recovery` set a session cookie and redirected to `/auth/reset-password`; the page guard allowed the GET (200) with the session.
- **1.7 set + re-login** ✓ — `POST /api/auth/reset-password` (with session) → `/dashboard`; re-login with the new password → `/dashboard`; the **old** password is now rejected (change persisted).
- **1.8 no-session guard** ✓ — `POST /api/auth/reset-password` and `GET /auth/reset-password` with no session both redirect to `/auth/forgot-password?error=...wygasł...`.

**Caveat — recovery email template not yet live in the running stack.** The stack predates the `config.toml` `[auth.email.template.recovery]` addition, so the live email currently uses GoTrue's default ("Reset Your Password", default link). Verified via `docker inspect`: the auth container has custom `GOTRUE_MAILER_TEMPLATES/SUBJECTS_CONFIRMATION` (so custom templates DO load on start) but **no** `..._RECOVERY` env yet. The template file + registration are correct and mirror the already-active confirmation template; they will load on the next `supabase stop && supabase start`. (The `supabase` CLI is not reachable from the agent's shell; the stack was started externally.) Phase 3 syncs templates to the hosted dashboard regardless.
