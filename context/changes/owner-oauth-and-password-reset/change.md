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

### Phase 3 runbook (production rollout + smoke) — agent-authored 2026-06-09, human-executed

Phase 3 is a supervised production cutover. There is **no repository code** to change — every step is hosted-dashboard config, a credentialed deploy, and browser-driven smoke. The agent cannot run any of it (no `supabase` CLI on PATH per the Phase 1/2 notes, no prod Cloudflare/Supabase creds, no browser). Execute the steps below, then report each outcome back so the agent flips the matching `## Progress` rows in `plan.md`.

**Find your two environment specifics first** (the runbook refers to them as placeholders):
- `<project-ref>` — the hosted Supabase project ref (dashboard URL `https://supabase.com/dashboard/project/<project-ref>`, or the subdomain of `SUPABASE_URL` = `https://<project-ref>.supabase.co`).
- `<production-origin>` — the deployed worker origin: the custom domain if configured, else the `https://zagroda-hub.<account>.workers.dev` URL from the last `wrangler deploy` output.

#### Prereq — create PRODUCTION OAuth apps (separate from any local-dev creds)

These are distinct from the local `.env` creds (local redirects to `http://127.0.0.1:54321/auth/v1/callback`). Production OAuth apps must authorize the **hosted Supabase** callback:

- **Authorized redirect URI (both providers)**: `https://<project-ref>.supabase.co/auth/v1/callback`
- **Google** ([console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth client ID, type *Web application*): copy Client ID + Client secret. Add `<production-origin>` to *Authorized JavaScript origins*. Google always reports `email_verified=true`, so the FR-018 block path (3.5) never fires for it.
- **Facebook** ([developers.facebook.com](https://developers.facebook.com) → My Apps → Facebook Login product): copy App ID + App secret. Facebook is the only path that can produce `email_verified=false`. A *Live*-mode app requires Meta app review for the `email` permission — if review isn't done, the app stays in *Development* mode and only listed test users can log in (this is the documented gate for 3.6).

#### 3.1 / 3.2 — Hosted Supabase config + deploy with migration

1. **Providers** — Dashboard → Authentication → Providers:
   - Enable **Google**, paste the production Client ID + secret.
   - Enable **Facebook**, paste the production App ID + secret.
   - **Do NOT replicate the local `skip_nonce_check = true`** — leave the nonce check ON in production (it's a dev-only relaxation from `config.toml`, Phase 2 #1).
2. **URL configuration** — Dashboard → Authentication → URL Configuration:
   - **Site URL** = `<production-origin>` (this is what the `recovery.html` / `confirmation.html` templates' `{{ .SiteURL }}` resolves to — the reset/confirm links are built entirely from it, so getting this right is what makes 3.4 work).
   - **Redirect allow-list**: add `<production-origin>/api/auth/callback` (the OAuth `redirectTo`) and `<production-origin>/**`.
3. **Email templates** — Dashboard → Authentication → Email Templates: sync **Confirm signup** ← `supabase/templates/confirmation.html` and **Reset password** ← `supabase/templates/recovery.html`. Confirm the recovery template's link target is `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
4. **SMTP (Brevo)** — Dashboard → Authentication → SMTP Settings → enable custom SMTP:
   - Host/port/user/pass from the Brevo account; **Sender email** = the Brevo-verified `EMAIL_FROM`; sender name = `EMAIL_FROM_NAME` (defaults "Zagroda Hub").
   - Without this, auth emails fall back to Supabase's low-rate built-in sender and will miss the <5 min NFR (3.4).
5. **Link the CLI to the hosted project** (once per machine), then deploy:
   ```bash
   npx supabase link --project-ref <project-ref>
   npm run deploy        # = npm run build && npm run db:push && wrangler deploy
   ```
   - `db:push` ships `supabase/migrations/20260609000000_password_account_exists.sql` BEFORE the worker (lessons.md deploy discipline — migration is additive, so the old worker survives the rollback window).
   - **No new worker secret is required** — the app reads no OAuth env var (`redirectTo` derives from request origin); OAuth creds live only in the dashboard. The existing `SUPABASE_*` / `BREVO_*` worker secrets are untouched. (If you ever *do* set a worker secret on Windows, heed lessons.md: pipe from a newline-free source — `printf '%s' 'value' | npx wrangler secret put NAME` via bash — never PowerShell `"value" | ...`, which appends `\n` and silently corrupts the value.)
6. **Confirm 3.2** — the function landed: Dashboard → Database → Functions shows `password_account_exists`, or check `supabase_migrations.schema_migrations` for `20260609000000`. Optionally verify lockdown holds in prod (denied to anon/authenticated, allowed to service_role).

#### 3.3–3.6 — Production smoke (browser)

- **3.3** — On `<production-origin>/auth/signin`, click **Kontynuuj z Google**, complete consent → lands on `/dashboard`.
- **3.4** — `<production-origin>/auth/forgot-password` → submit your email → recovery email arrives **via Brevo within 5 min** → link lands on `/auth/reset-password` with an active session → set a new password → `/dashboard` → sign out and re-login with the new password.
- **3.5** — Unverified-collision block: only reproducible with a Facebook account whose email is unverified *and* already has a password account on the site. If you can stage it, expect the redirect to `/auth/signin` with "To konto loguje się hasłem…" and **no** duplicate/orphan in `auth.users`. If you can't stage an unverified Facebook email, record the reasoning (the `shouldBlockOAuth` decision + the `password_account_exists` function are already proven in Phase 2; only the live `email_verified=false` GoTrue path is unverifiable without such an account).
- **3.6** — Complete a Facebook login in production. If the Meta app is still in *Development* mode / pending app review, that's the documented remaining gate — note the review status here instead of a pass.

**Report format**: for each row, reply with the row number + PASS/observation (e.g. "3.4 PASS — Brevo email in ~40s, reset completed" or "3.6 — Facebook app in review, blocked on `email` permission"). The agent will stamp `change.md` and flip the `## Progress` rows accordingly.
