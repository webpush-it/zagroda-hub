---
change_id: owner-oauth-and-password-reset
title: Owner oauth and password reset
status: impl_reviewed
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

**Environment specifics (both resolved — substituted inline throughout this runbook):**
- **Production origin** = `https://zagroda-hub.webpushit.workers.dev` (confirmed live in `context/deployment/deploy-plan.md` §1.4/§5.4; already set as the Supabase Site URL in §6.5).
- **Supabase project ref** = `viuusqzijkwykfoohulo` (so `SUPABASE_URL` = `https://viuusqzijkwykfoohulo.supabase.co`, dashboard = `https://supabase.com/dashboard/project/viuusqzijkwykfoohulo`). Provided by the owner 2026-06-09; not otherwise committed (the value lives only in the `SUPABASE_URL` worker secret).

#### Prereq — create PRODUCTION OAuth apps (separate from any local-dev creds)

These are distinct from the local `.env` creds (local redirects to `http://127.0.0.1:54321/auth/v1/callback`). Production OAuth apps must authorize the **hosted Supabase** callback. The redirect URI is the same for both providers:

> **Authorized redirect URI (both providers)**: `https://viuusqzijkwykfoohulo.supabase.co/auth/v1/callback`
> (the only spot where you need `viuusqzijkwykfoohulo`)

**Which redirect URI goes where (the #1 confusion):** the flow is server-side via Supabase. Google/Facebook only ever talk to Supabase, never to the worker.

| URL | Where to enter it | Purpose |
| --- | --- | --- |
| `https://viuusqzijkwykfoohulo.supabase.co/auth/v1/callback` | **in Google / Facebook** (Authorized/Valid redirect URI) | the provider redirects here after consent — this is the **Supabase** endpoint, not the app |
| `https://zagroda-hub.webpushit.workers.dev/api/auth/callback` | **in Supabase** (URL Configuration allow-list, step 3.1.2) | Supabase redirects here after exchanging the code for a session |

Never put the worker URL into the provider's redirect field — that yields `redirect_uri_mismatch`.

---

**Google** — [console.cloud.google.com](https://console.cloud.google.com):

1. **Project** — top-left project picker → New Project → name `ZagrodaHub` → Create → switch to it.
2. **Consent screen** — menu **Google Auth Platform** (formerly *APIs & Services → OAuth consent screen*); first time → **Get started**:
   - **Branding**: App name `ZagrodaHub`, user support email = your email.
     - ⚠️ **Authorized domains — LEAVE EMPTY.** Do **not** try to add `workers.dev` or `supabase.co`: Google rejects them with *"Nieprawidłowa domena: musi to być prywatna domena najwyższego poziomu / must be a private top-level domain"* because both are on the public-suffix list (not registrable domains you can verify in Search Console). This field is **not required** for a server-side OAuth flow with non-sensitive scopes (Testing or published-basic). It only becomes relevant if you later publish with homepage/privacy links on a domain you own — which `*.workers.dev` isn't. Skip it.
   - **Audience**: **External**.
   - **Contact information**: your developer email.
3. **Scopes** — Data Access → Add scopes → select only the non-sensitive trio: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. These need **no Google verification** even after publishing. (Supabase derives `email` + `email_verified` from them; Google always returns `email_verified=true`.)
4. **Publishing / test users** — app starts in **Testing**: only emails listed under **Audience → Test users** can log in. Add your own email now (this covers test 3.3). **Publish app** lifts the restriction and needs **no review** for these basic scopes.
5. **Create the client** — Google Auth Platform → **Clients** (formerly *Credentials*) → **Create client** → Application type **Web application**, name `zagroda-hub-web`:
   - *Authorized JavaScript origins*: **not required** for this flow — leave empty (or, if you prefer to fill it, `https://viuusqzijkwykfoohulo.supabase.co`). Do **not** put the worker URL here.
   - *Authorized redirect URIs* → Add URI → `https://viuusqzijkwykfoohulo.supabase.co/auth/v1/callback` (exact, no trailing slash).
   - Create.
6. **Copy creds** — copy **Client ID** + **Client secret** → they go into Supabase dashboard, step 3.1.1.

Google always reports `email_verified=true`, so the FR-018 block path (3.5) never fires for Google — its merge-on-existing-password-email case is test 2.8.

---

**Facebook** — [developers.facebook.com](https://developers.facebook.com):

1. **Create app** — My Apps → **Create App** → name it → use case **Authenticate and request data from users with Facebook Login** (older UI: app type **Consumer**) → Create. (May require completing Meta developer-account / business verification first.)
2. **Add Facebook Login** — left nav: add the **Facebook Login** product → **Facebook Login → Settings**:
   - *Client OAuth Login* = **Yes**, *Web OAuth Login* = **Yes**.
   - *Valid OAuth Redirect URIs*: `https://viuusqzijkwykfoohulo.supabase.co/auth/v1/callback` → **Save changes**. ← this is the load-bearing field for the flow.
3. **Basic settings** — **App settings → Basic**:
   - Copy **App ID** + **App secret** (Show) → Supabase dashboard, step 3.1.1.
   - *App Domains*: optional for this redirect-based flow (the Valid OAuth Redirect URI above is authoritative). If you fill it, use `supabase.co`. Facebook does **not** enforce Google's "private TLD" rule here, so you won't hit that error — but it's also not needed.
   - *Privacy Policy URL* + *Category*: **required before the app can go Live** (not needed while in Development).
4. **Permissions** — the app requests `public_profile` + `email`. In **Development** mode, people with an **app role** (Admin/Developer/Tester) get `email` automatically. For the general public, `email` needs **Advanced Access** via Meta **App Review**.
5. **App mode & testers** — toggle at the top is **Development** vs **Live**:
   - **Development**: only users added under **App roles → Roles** (or **Test Users**) can log in. Add your Facebook account as a Tester to run a login.
   - **Live**: needs the privacy policy (step 3) + App Review for `email`. Until approved, that's the documented gate for **test 3.6** — record the review status instead of expecting a pass.
6. **Copy creds → Supabase** (step 3.1.1). Note: Facebook is the **only** provider that can return `email_verified=false`, so it's the sole trigger for the FR-018 collision block (test 3.5). Some FB accounts (phone-only signups) return no email at all.

#### 3.1 / 3.2 — Hosted Supabase config + deploy with migration

1. **Providers** — Dashboard → Authentication → Providers:
   - Enable **Google**, paste the production Client ID + secret.
   - Enable **Facebook**, paste the production App ID + secret.
   - **Do NOT replicate the local `skip_nonce_check = true`** — leave the nonce check ON in production (it's a dev-only relaxation from `config.toml`, Phase 2 #1).
2. **URL configuration** — Dashboard → Authentication → URL Configuration:
   - **Site URL** = `https://zagroda-hub.webpushit.workers.dev` (this is what the `recovery.html` / `confirmation.html` templates' `{{ .SiteURL }}` resolves to — the reset/confirm links are built entirely from it, so getting this right is what makes 3.4 work).
   - **Redirect allow-list**: add `https://zagroda-hub.webpushit.workers.dev/api/auth/callback` (the OAuth `redirectTo`) and `https://zagroda-hub.webpushit.workers.dev/**`.
3. **Email templates** — Dashboard → Authentication → Email Templates: sync **Confirm signup** ← `supabase/templates/confirmation.html` and **Reset password** ← `supabase/templates/recovery.html`. Confirm the recovery template's link target is `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
4. **SMTP (Brevo)** — Dashboard → Authentication → SMTP Settings → enable custom SMTP. Get the values from [app.brevo.com](https://app.brevo.com) → account menu (top-right) → **SMTP & API → SMTP** tab:
   - **Host** = `smtp-relay.brevo.com`; **Port** = `587` (STARTTLS).
   - **Username** = the login shown on that page (your Brevo account email, or a `…@smtp-brevo.com` login).
   - **Password** = the Brevo **SMTP key / "Master password"** from that same SMTP tab (use *Generate a new SMTP key* if none). ⚠️ This is **NOT** the account login password and **NOT** `BREVO_API_KEY` — that `xkeysib-…` value is the REST **API key** the app's outbox (FR-005/011/016) uses, a different credential. Pasting the API key here will fail SMTP auth.
   - **Sender email** = the Brevo-**verified** sender (same as the app's `EMAIL_FROM`; verify under Brevo → Senders, Domains & Dedicated IPs → Senders). Sender name = `EMAIL_FROM_NAME` (defaults "Zagroda Hub"). An unverified sender → mail silently dropped or spam-foldered → 3.4 fails.
   - Gotcha: some Brevo accounts have the SMTP relay disabled until the account is confirmed / transactional sending is activated — if auth fails, check the relay is active in Brevo.
   - Without custom SMTP, auth emails fall back to Supabase's low-rate built-in sender and will miss the <5 min NFR (3.4).
5. **Link the CLI to the hosted project** (once per machine), then deploy:
   ```bash
   npx supabase link --project-ref viuusqzijkwykfoohulo
   npm run deploy        # = npm run build && npm run db:push && wrangler deploy
   ```
   - `db:push` ships `supabase/migrations/20260609000000_password_account_exists.sql` BEFORE the worker (lessons.md deploy discipline — migration is additive, so the old worker survives the rollback window).
   - **No new worker secret is required** — the app reads no OAuth env var (`redirectTo` derives from request origin); OAuth creds live only in the dashboard. The existing `SUPABASE_*` / `BREVO_*` worker secrets are untouched. (If you ever *do* set a worker secret on Windows, heed lessons.md: pipe from a newline-free source — `printf '%s' 'value' | npx wrangler secret put NAME` via bash — never PowerShell `"value" | ...`, which appends `\n` and silently corrupts the value.)
6. **Confirm 3.2** — the function landed: Dashboard → Database → Functions shows `password_account_exists`, or check `supabase_migrations.schema_migrations` for `20260609000000`. Optionally verify lockdown holds in prod (denied to anon/authenticated, allowed to service_role).

#### 3.3–3.6 — Production smoke (browser)

- **3.3** — On `https://zagroda-hub.webpushit.workers.dev/auth/signin`, click **Kontynuuj z Google**, complete consent → lands on `/dashboard`.
- **3.4** — `https://zagroda-hub.webpushit.workers.dev/auth/forgot-password` → submit your email → recovery email arrives **via Brevo within 5 min** → link lands on `/auth/reset-password` with an active session → set a new password → `/dashboard` → sign out and re-login with the new password.
- **3.5** — Unverified-collision block: only reproducible with a Facebook account whose email is unverified *and* already has a password account on the site. If you can stage it, expect the redirect to `/auth/signin` with "To konto loguje się hasłem…" and **no** duplicate/orphan in `auth.users`. If you can't stage an unverified Facebook email, record the reasoning (the `shouldBlockOAuth` decision + the `password_account_exists` function are already proven in Phase 2; only the live `email_verified=false` GoTrue path is unverifiable without such an account).
- **3.6** — Complete a Facebook login in production. If the Meta app is still in *Development* mode / pending app review, that's the documented remaining gate — note the review status here instead of a pass.

**Report format**: for each row, reply with the row number + PASS/observation (e.g. "3.4 PASS — Brevo email in ~40s, reset completed" or "3.6 — Facebook app in review, blocked on `email` permission"). The agent will stamp `change.md` and flip the `## Progress` rows accordingly.

### Phase 3 execution (2026-06-09, deploy by agent at user request)

**Deploy ordering adapted** — the literal `npm run deploy` could not run from this machine (the `supabase` CLI is not installed here, so its `db:push` middle step fails; `wrangler` *is* authenticated — OAuth token, account `WebPushIT`/`778c2104…`, `workers:write`). So the two halves were split while preserving the deploy discipline (schema before worker):
- **3.1 migration (D-1)** — applied by the user via the **Supabase dashboard SQL Editor** (idempotent `create or replace` + `revoke`/`grant`), confirmed "migracja wgrana" before the worker deploy. NB: applied outside `supabase db push`, so `supabase_migrations.schema_migrations` has no `20260609000000` row — a future `db push` will re-run the file harmlessly (idempotent). 3.2's "present in hosted DB migrations" is satisfied by the function existing; the migration-table bookkeeping is the only nuance.
- **3.1 worker (D-2)** — `npm run build && npx wrangler deploy` → **deployed clean**. Version ID `ac33ee54-e74d-458a-9d5d-d4421c70ffff` at `https://zagroda-hub.webpushit.workers.dev`. Upload included the new Phase 1/2 bundles (`OAuthButtons`, `ResetPasswordForm`, `SignInForm`).

**Production HTTP smoke (read-only, no accounts created) — confirms 3.1 plumbing end-to-end up to the consent screen:**
- `GET /` → HTTP 200; `/auth/signin` renders both "Kontynuuj z Google/Facebook" + "Nie pamiętam hasła"; `/auth/forgot-password` → 200.
- `GET /api/auth/oauth/google` → 302 → Supabase `authorize` (PKCE `code_challenge`, s256) → 302 → `accounts.google.com/o/oauth2/v2/auth` with **real** `client_id=695849093777-…apps.googleusercontent.com`, `redirect_uri=https://viuusqzijkwykfoohulo.supabase.co/auth/v1/callback`, `scope=email profile`. **Proves the Google provider is enabled + wired in the hosted dashboard.**
- `GET /api/auth/oauth/facebook` → 302 → Supabase `authorize` → 302 → `www.facebook.com/dialog/oauth` with `client_id=2159807081507410`, same Supabase `redirect_uri`, `scope=email`. **Proves Facebook is enabled + wired.**

→ **3.1 and 3.2 marked done** (deploy succeeded, migration landed first, both providers verified reachable). **Still PENDING (browser/email/review — only the user can drive):** 3.3 (Google consent → /dashboard), 3.4 (Brevo recovery email <5 min end-to-end), 3.5 (unverified-FB collision block or reasoned), 3.6 (Facebook live login or app-review status). These also clear the carried-over Phase 2 live rows 2.0/2.7–2.10.

**Smoke results (reported by user 2026-06-09):**
- **3.3 PASS** — production Google OAuth consent → lands on `/dashboard`.
- **3.4 PASS** — recovery email delivered via Brevo in ~30s, full reset completed end-to-end.
- **2.7 PASS** — user confirmed the 3.3 Google account was new (first-time login = new-owner registration → `/dashboard`).
- **2.10 PASS** — user logged in Google-only, then set a password via the reset flow, then could sign in with **both** email+password and Google (one account, no split-brain). Also confirms the 2.0 spike's "reset reaches an OAuth-only user + `updateUser({password})` enables email+password login" behavior.
- **2.8 PASS** — password account created first (signup), then Google login on the same email merged into the **same** account, no duplicate in `auth.users`. Confirms FR-018 verified-email auto-merge in the password-first direction (the reverse of 2.10).
- **2.8 PASS** also confirms the 2.0 spike's verified→merge behavior in the password-first direction.

**Facebook rows closed as documented / reasoned (user decision 2026-06-09).** Live Facebook login hit Meta's **App Review** gate: a real consent attempt (FB account behind `konrad.beska@interia.pl`) returned to `/auth/signin?error=…#error_description=Error+getting+user+email+from+external+provider`, and the FB consent screen showed *"Prześlij do weryfikacji … niektóre uprawnienia nie zostały zaakceptowane"*. Meta requires App Review + business verification for the `email` permission for non–app-role users; adding a Tester role did not lift it. Per plan criterion 3.6 ("Facebook login works in production **or** its app-review status is documented as the remaining gate"), the Facebook rows are closed as follows:
- **3.6 — documented gate.** Facebook OAuth is wired and reaches the provider consent screen (verified by the HTTP smoke: 302 → `www.facebook.com/dialog/oauth`, `client_id=2159807081507410`, `scope=email`). Completing a live login is **blocked on Meta App Review** for the `email` permission (Advanced Access). The app handles the no-email case **gracefully** — it redirects to `/auth/signin` with the fixed error string instead of crashing. Remaining gate: submit the Meta App Review (privacy policy + business verification + screencast) to enable public Facebook login.
- **3.5 / 2.9 — reasoned, not live-reproduced.** The unverified-email collision block (FR-018) cannot be exercised live without a Facebook account reporting `email_verified=false` on a colliding email — which the App Review gate also blocks. The block is nonetheless proven at the unit level in Phase 2: `shouldBlockOAuth({emailVerified, passwordAccountExists})` truth table (2.5) + the locked-down `password_account_exists` SECURITY DEFINER function (2.2). Only the live GoTrue `email_verified=false` path is unverified; the decision and the SQL guard are covered.
- **2.0 — spike closed.** Of its three behaviors: verified→merge (confirmed via 2.7 + 2.8 live) and reset-for-OAuth-only (confirmed via 2.10 live) are PASS; unverified→separate-user is the same Facebook-unverified path, closed by the Phase 2 unit-level reasoning above.

**Phase 3 outcome:** Google OAuth + password reset fully verified in production; Facebook wired and reaching consent, blocked only on Meta App Review (documented gate); FR-018 guardrail proven by unit tests + live merge in both directions. Change → `implemented`.
  - **Note on 2.8 vs 2.10**: 2.10 is OAuth-first-then-add-password (done). 2.8 is the *reverse* — a password account exists FIRST, then a Google login on the same email must merge into it (one account, no duplicate). Different GoTrue link direction; still to verify by: signup with email+password → then Google login on that same email → confirm single account in `auth.users`.
