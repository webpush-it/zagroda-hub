---
change_id: owner-oauth-and-password-reset
title: Owner oauth and password reset
status: implementing
created: 2026-06-08
updated: 2026-06-09
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

### Phase 2 verification (2026-06-09, done by agent at user request)

`supabase` CLI still not on the agent's PATH. Resolved the live stack's keys/DB-URL from the running containers via `docker inspect` (anon/service_role + `postgresql://postgres:postgres@127.0.0.1:54322/postgres`), then verified everything verifiable without a real OAuth provider.

**Automated criteria 2.1–2.6 — all PASS:**
- **2.1** Migration applied in-container (`psql -v ON_ERROR_STOP=1` ← the migration file): `CREATE FUNCTION` / `REVOKE` / `GRANT`, no errors.
- **2.2** `pg_proc` introspection: `prosecdef=t`, `proconfig={search_path=""}`, ACL `{postgres=X, service_role=X}` (anon/authenticated/public absent → denied). Application-layer db test `tests/db/password-account-exists.test.ts`: anon+authenticated `rpc` → `42501`; service_role → correct boolean; case-insensitive on the email.
- **2.3** `npm run build` — `astro check` clean.
- **2.4** `npm run lint` — exit 0. Required a fix: a **pre-existing** repo-wide crash (`@typescript-eslint/no-misused-promises` 8.59.2 throws on a top-level `return` in `.astro` frontmatter — `reset-password.astro`, `katalog.astro`). Per user decision, disabled that type-checked rule for `**/*.astro` in `eslint.config.js` (documented eslint-plugin-astro remedy).
- **2.5** `npm test` (env-injected stack creds) — 11 files / 75 tests pass, incl. the new `shouldBlockOAuth` truth table + `isOAuthProvider`.
- **2.6** Hand-added `password_account_exists` to `database.types.ts` (`{ Args: { p_email: string }; Returns: boolean }`) — matches the live DB signature. Full `npm run db:types` regen needs the CLI (run on a machine with it; no diff expected).

**OAuth plumbing — verified at HTTP level** (dev server, stack creds injected; note Win11 `localhost`→`::1`, so probe via `localhost`, not `127.0.0.1`):
- `GET /api/auth/oauth/google|facebook` → 302 to `…:54321/auth/v1/authorize?provider=…&redirect_to=…/api/auth/callback&code_challenge=…&code_challenge_method=s256`, **and** sets the PKCE verifier cookie (`sb-…-code-verifier`) on our redirect — the `skipBrowserRedirect:true` design works.
- `GET /api/auth/oauth/bogus` → 302 `/auth/signin?error=Nieobsługiwany dostawca…`.
- `GET /api/auth/callback` (no code) → 302 `/auth/signin?error=Logowanie przez dostawcę nie powiodło się…`.
- Buttons ("Kontynuuj z Google/Facebook" → `/api/auth/oauth/*`) render on both `/auth/signin` and `/auth/signup`.

**Still PENDING — require a real Google/Facebook OAuth app + browser consent (cannot be driven headlessly; the plan defers these to the Phase 3 prereq):** 2.0 spike behaviors (verified→merge, unverified→separate-user, reset-for-OAuth-only), 2.7 (Google → /dashboard), 2.8 (merge on existing verified password email), 2.9-live (unverified-collision block — the *decision* `shouldBlockOAuth` + the SQL function are proven; only the live GoTrue `email_verified=false` path is unverified), 2.10 (OAuth-only owner reset → password login). The providers also need a `supabase stop && supabase start` to pick up the new `config.toml` blocks + `.env` creds.
