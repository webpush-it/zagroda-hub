# Owner OAuth (Google + Facebook) & Password Reset — Implementation Plan

## Overview

Add the two remaining owner-authentication flows to the existing Supabase + Astro 6 SSR app:

1. **Password reset by email** (FR-008) — owner requests a reset, receives a recovery link, sets a new password.
2. **OAuth registration/login via Google and Facebook** (FR-017) — with automatic account merge when the provider reports `email_verified=true` (FR-018), and a hard block (anti-account-takeover) when an OAuth login arrives on an existing email+password account with `email_verified=false`.

Email+password auth (signup, signin, email verification, resend, signout) is already fully built. This change reuses its patterns (`@supabase/ssr` cookie sessions, OTP verification, always-success-no-enumeration, fixed error strings) rather than introducing new ones.

## Current State Analysis

- **SSR session**: `src/lib/supabase.ts` builds a `createServerClient` (`@supabase/ssr`) bound to Astro cookies; `src/lib/supabase-admin.ts` provides a service-role client (`persistSession:false`). `src/middleware.ts` resolves `locals.user` via `getUser()` and gates only `PROTECTED_ROUTES = ["/dashboard"]`.
- **Existing auth routes** (`src/pages/api/auth/`): `signin.ts`, `signup.ts`, `confirm.ts` (`verifyOtp({token_hash,type})` — already lists `recovery` among `OTP_TYPES` and redirects every success to `/dashboard`), `resend.ts` (always-success, no enumeration), `signout.ts`.
- **Existing auth pages** (`src/pages/auth/`): `signin.astro`, `signup.astro`, `confirm-email.astro` — cosmic-themed cards reading `?error=` / `?sent=` / `?email=` query params.
- **Existing React components** (`src/components/auth/`): `SignInForm`, `SignUpForm`, `FormField`, `PasswordToggle`, `SubmitButton` (uses `useFormStatus`), `ServerError`.
- **Supabase config** (`supabase/config.toml`): `[auth.external.google|facebook|apple]` blocks present but `enabled = false`; `enable_manual_linking = false`; `[auth.email.template.confirmation]` → `supabase/templates/confirmation.html`; `additional_redirect_urls` lists localhost only; `minimum_password_length = 6`.
- **Env**: `astro.config.mjs` declares `SUPABASE_URL/KEY/SERVICE_ROLE_KEY`, `BREVO_*` (all `optional, secret, server`). No new env var is required for OAuth — `redirectTo` is derived from `context.url.origin`.
- **Production**: Cloudflare Workers (`infrastructure.md`), hosted Supabase project. `npm run deploy` = `build && db:push && wrangler deploy`. OAuth provider credentials and the redirect/site-URL allow-list are configured in the **hosted Supabase dashboard** — `config.toml` governs only local dev.
- **Tests**: `vitest run` wired (`npm test`); no auth tests exist yet.

### Key Discoveries:

- **OTP recovery mechanism already exists** — `src/pages/api/auth/confirm.ts:22` calls `verifyOtp` and accepts `recovery`. Password reset reuses it; only the post-verification destination must branch (`recovery` → set-password form instead of `/dashboard`).
- **Supabase default linking is expected to implement most of FR-018** — with `enable_manual_linking=false`, Supabase auto-links a new identity to an existing user **only when the email is verified**; for `email_verified=false` its default is a *separate* user (split-brain), **not** a takeover. Our chosen behavior (block + "zaloguj się hasłem") means the OAuth callback must actively detect the collision and convert that default split-brain into a clean block. **Caveat:** this link-vs-separate decision is GoTrue *backend* behavior — it is **not** encoded in `@supabase/auth-js` (which exposes only manual `linkIdentity`; `email_verified` is never a client-side decision input). Likewise, whether `resetPasswordForEmail` reaches an OAuth-only user and whether `updateUser({password})` then yields a working email+password login are backend decisions. **All three must be confirmed empirically in the Phase 2.0 spike before the block logic is written.**
- **Auth emails are Supabase's emails, not the Brevo outbox** — the existing confirmation email and the new recovery email are sent by Supabase. Locally → Inbucket; in production → must be Brevo SMTP configured on the hosted project (the Brevo outbox in `src/lib/email/` is only for app-generated FR-005/011/016 emails).
- **`SubmitButton` relies on `useFormStatus`** — it must stay inside a `<form>`. OAuth buttons that navigate via a link/GET endpoint won't share that pending state; they get their own styling.

## Desired End State

- An owner who forgot their password clicks "Nie pamiętam hasła", submits their email, receives a recovery email (Inbucket locally, Brevo in prod), follows the link, lands on a set-new-password form, and signs in with the new password.
- An owner can register/sign in with Google or Facebook from both `/auth/signin` and `/auth/signup`. Google (always `email_verified=true`) merges silently with any existing same-email account. Facebook with an unverified email colliding with an existing password account is blocked with a clear "zaloguj się hasłem" message — no merge, no takeover, no split-brain.
- An OAuth-only owner who clicks "forgot password" can set a password and thereafter also sign in with email+password (Supabase adds the email identity).
- Verification: `npm run build`, `npm run lint`, typecheck, and `npm test` pass; the manual test script in this plan completes end-to-end against local Supabase + Inbucket; production smoke confirms Google OAuth + password reset work and emails deliver via Brevo.

## What We're NOT Doing

- **No email-link manual merge flow** for the `email_verified=false` case (PRD Open Question #1 option c) — blocked with a message instead; full merge-by-verification-link is deferred to v2.
- **No separate OAuth account / split-brain** (option b) — actively prevented.
- **No Playwright/E2E harness** and **no mocked-OAuth integration tests** — coverage is unit tests for pure logic + a documented manual script (per the testing decision).
- **No Apple OAuth** — only Google + Facebook (FR-017).
- **No account-management / "link a provider from settings" UI** — out of MVP scope.
- **No changes to the booking / overbooking domain** — auth only.
- **No suppression of the OAuth-block message's account-existence signal** — the block message ("To konto loguje się hasłem…") does reveal that a password account exists for that email, which is a mild enumeration vector inconsistent with the no-enumeration stance used for forgot-password. We accept it deliberately: reaching this branch already requires the caller to control an OAuth identity reporting that exact email as `email_verified=false` (Google never does; Facebook rarely), so the marginal leak is acceptable in exchange for a clear, actionable message.

## Implementation Approach

Phase 1 ships the lowest-risk, fully-locally-testable flow (password reset) by reusing the existing OTP machinery. Phase 2 adds the OAuth plumbing once (provider-agnostic initiate + callback) and wires both providers plus the FR-018 guardrail, all against local Supabase. Phase 3 is the production cutover: hosted-dashboard provider/redirect/SMTP config, deploy with the new migration, and a prod smoke. The merge guardrail's collision detection lives in a `SECURITY DEFINER` SQL function (the only reliable way to read `auth.users`/`auth.identities` from the app), shipped as a migration so it travels with the code per the project's deploy discipline.

## Critical Implementation Details

- **OAuth callback ordering & the FR-018 block.** Supabase's default for an unverified-email collision is split-brain, not takeover, so the security property is *almost* free — but the chosen UX (block) requires explicit detection. In `GET /api/auth/callback` the order is: (1) `exchangeCodeForSession(code)`; (2) inspect the authenticating identity's `identity_data.email_verified`; (3) **only if false**, call the service-role RPC `password_account_exists(email)` — if it returns true, sign out and redirect to `/auth/signin` with the "zaloguj się hasłem" message; (4) otherwise redirect to `/dashboard`. **Do NOT delete the OAuth user in the block path**: GoTrue re-logs into an *existing* unverified-OAuth account on re-login, so the user may be a pre-existing account that owns a zagroda — and `zagrody.owner_id` is FK `ON DELETE CASCADE`, so deleting would destroy the zagroda/turnusy/booking_requests. An unused orphan account is harmless because the block never grants it access. Google returns `email_verified=true`, so step 3 never fires for it — the cost falls only on the rare Facebook-unverified path.
- **Collision detection must not enable enumeration.** `password_account_exists` is `SECURITY DEFINER`, returns a bare boolean, and is `REVOKE`d from `anon`/`authenticated` (granted to `service_role` only). It is reachable only from the server callback after a real OAuth handshake, never from a public route.
- **Recovery session is real.** `verifyOtp({type:"recovery"})` establishes a logged-in session, which is what authorizes `updateUser({password})` on the set-password form. The set-password API route must therefore use the request-bound SSR client (cookies), not the admin client.

---

## Phase 1: Password Reset (email + password)

### Overview

Owner can request a password-reset email and set a new password via a recovery link. Reuses the existing `verifyOtp` recovery path; adds a request form, a set-password form, the recovery email template, and a destination branch.

### Changes Required:

#### 1. Forgot-password request page

**File**: `src/pages/auth/forgot-password.astro`

**Intent**: A cosmic-card page (mirror `signin.astro`) with a single email field that POSTs to `/api/auth/forgot-password`, plus a link back to signin. Reads `?error=` and `?sent=` to show the always-success confirmation.

**Contract**: Reads `Astro.url.searchParams` `error` / `sent`; renders a small React form component (or inline form like `confirm-email.astro`). On `sent=1` shows "Jeśli konto z tym adresem istnieje, wysłaliśmy link do resetu hasła."

#### 2. Forgot-password API route

**File**: `src/pages/api/auth/forgot-password.ts`

**Intent**: Validate email (Zod), call `resetPasswordForEmail`, always redirect to the success state regardless of whether the account exists (no enumeration — mirror `resend.ts`).

**Contract**: `POST`. `supabase.auth.resetPasswordForEmail(email)` — **no `redirectTo`**; the recovery link is built entirely by the template via `{{ .SiteURL }}` (parity with the working signup/confirmation flow, which passes no `redirectTo`). Passing a `redirectTo` not in the allow-list would be rejected by Supabase. Always `redirect("/auth/forgot-password?sent=1")` on completion (and on Supabase error). Null-client guard → fixed error string, as in sibling routes.

#### 3. Recovery email template + config registration

**File**: `supabase/templates/recovery.html`, `supabase/config.toml`

**Intent**: Polish recovery email mirroring `confirmation.html`, linking through our callback so the user lands logged-in on the set-password form. Register it under `[auth.email.template.recovery]`.

**Contract**: Link target `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. Add to `config.toml`:
```toml
[auth.email.template.recovery]
subject = "Reset hasła — ZagrodaHub"
content_path = "./supabase/templates/recovery.html"
```

#### 4. Branch recovery to the set-password form

**File**: `src/pages/api/auth/confirm.ts`

**Intent**: After a successful `verifyOtp`, send `recovery` to the set-password form (where a session now exists) instead of `/dashboard`. Other types keep landing on `/dashboard`.

**Contract**: On success, `type === "recovery" ? redirect("/auth/reset-password") : redirect("/dashboard")`. No change to the error branches.

#### 5. Set-new-password page + form

**File**: `src/pages/auth/reset-password.astro`, `src/components/auth/ResetPasswordForm.tsx`

**Intent**: Page renders the form (mirror `SignUpForm`'s password + confirm fields, `MIN_PASSWORD_LENGTH = 6`, match validation). Form POSTs to `/api/auth/reset-password`. Reads `?error=` for server errors.

**Contract**: `ResetPasswordForm` reuses `FormField`, `PasswordToggle`, `SubmitButton`, `ServerError`. Fields `password` + `confirmPassword`; client-side match + min-length checks before submit (no email field — the recovery session identifies the user).

#### 6. Set-new-password API route

**File**: `src/pages/api/auth/reset-password.ts`

**Intent**: Using the recovery session (request-bound SSR client), set the new password and redirect to the dashboard. If there is no valid session (link expired/reused/opened cold), send the user back to request a fresh link.

**Contract**: `POST`. Validate password (Zod, min 6). `supabase.auth.getUser()` guard → if no user, `redirect("/auth/forgot-password?error=...link wygasł...")`. Else `updateUser({ password })`; on `weak_password` → fixed message back to `/auth/reset-password?error=`; on success → `redirect("/dashboard")`.

#### 7. Forgot-password entry link on signin

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Add a "Nie pamiętam hasła" link to `/auth/forgot-password` beneath the password field.

**Contract**: Static `<a>`; no logic change to the form submit.

#### 8. Unit test for reset error mapping

**File**: `src/pages/api/auth/__tests__/reset-password.test.ts` (or co-located per repo convention once Phase 1 establishes it)

**Intent**: Cover the pure decision logic — no-session → forgot redirect, `weak_password` → reset error, success → dashboard — by extracting the redirect-decision into a small pure helper if needed.

**Contract**: `vitest`. Assert the mapping from `(hasSession, updateError)` to redirect target.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (runs `astro check` via `@astrojs/check`)
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- Recovery template registered: `supabase/config.toml` contains `[auth.email.template.recovery]`

#### Manual Verification:

- From `/auth/signin` → "Nie pamiętam hasła" → submit a known email → success message shown (and identical message for an unknown email — no enumeration)
- Recovery email appears in Inbucket; its link lands on `/auth/reset-password` with an active session
- Setting a new password redirects to `/dashboard`; signing out and back in with the new password works
- Opening `/auth/reset-password` directly (no recovery session) redirects to the request page with an "expired link" message

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: OAuth Google + Facebook with merge guardrail (local)

### Overview

Add a provider-agnostic OAuth initiate + PKCE callback, OAuth buttons on signin/signup, enable both providers locally, and implement the FR-018 guardrail (auto-merge on verified email via Supabase default; explicit block on unverified-email collision).

### Changes Required:

#### 0. Verification spike — confirm GoTrue behavior FIRST (no production code)

**File**: (throwaway probe against local Supabase; record findings in this plan's References / change.md notes)

**Intent**: Empirically confirm the three GoTrue backend behaviors the guardrail and the OAuth-only-reset promise depend on, before writing the block logic. If any differs from the assumption, adapt the design here.

**Contract**: Against local Supabase, verify: (1) OAuth login on an email with an existing **verified** password account → one merged account (not a duplicate); (2) OAuth login with provider email **unverified** colliding with a password account → a *separate* user is created (so the block has something to detect); (3) `resetPasswordForEmail` sends to a user with **only** an OAuth identity, and `updateUser({password})` afterwards enables email+password login. Record the observed behavior (and the exact location of `email_verified` in the identity payload) before proceeding.

#### 1. Enable providers + env + redirect allow-list (local)

**File**: `supabase/config.toml`, `astro.config.mjs`, `.env.example`

**Intent**: Turn on Google and Facebook locally with env-substituted secrets, declare the new env vars, and allow the callback URL.

**Contract**: In `config.toml` set `[auth.external.google] enabled = true`, `client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"`, `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`, `skip_nonce_check = true` (required for local Google sign-in per the existing comment); same shape for Facebook. Add `http://localhost:4321/api/auth/callback` to `additional_redirect_urls`. The new env vars feed Supabase CLI (local), not the Astro worker — so they go in `.env`/`.env.example`, not necessarily `astro.config.mjs` `env.schema` (only add to the schema if the app reads them; it does not — `redirectTo` uses `context.url.origin`).

#### 2. OAuth initiate endpoint

**File**: `src/pages/api/auth/oauth/[provider].ts`

**Intent**: For `google`/`facebook`, start the PKCE flow server-side and redirect the browser to the provider's consent URL. The SSR client persists the PKCE verifier in a cookie via its `setAll` handler.

**Contract**: `GET`. Validate `provider ∈ {google, facebook}` (else redirect signin with error). `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: \`${context.url.origin}/api/auth/callback\`, skipBrowserRedirect: true } })` → `redirect(data.url)`.
```ts
// skipBrowserRedirect:true returns the URL instead of a 3xx so the SSR
// cookie (PKCE verifier) is committed on OUR redirect, not lost on Supabase's.
const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: {...} });
if (error || !data.url) return context.redirect(`/auth/signin?error=...`);
return context.redirect(data.url);
```

#### 3. OAuth callback endpoint + FR-018 guardrail

**File**: `src/pages/api/auth/callback.ts`

**Intent**: Exchange the `code` for a session; on an unverified-email collision with an existing password account, block (sign out, delete the orphan OAuth user, redirect with message); otherwise land on the dashboard.

**Contract**: `GET`. Read `code`; `exchangeCodeForSession(code)` → user/session. Find the OAuth identity (`user.identities` where provider ∈ {google,facebook}); read `identity.identity_data.email_verified`. If falsy: call admin RPC `password_account_exists(user.email)`; if true → `signOut()`, `redirect("/auth/signin?error="+ "To konto loguje się hasłem — zaloguj się hasłem (możesz też zresetować hasło).")` (no `deleteUser` — see Critical Implementation Details for why the cascade makes deletion unsafe). Else `redirect("/dashboard")`. Exchange error → `redirect("/auth/signin?error=...nie powiodło się...")`. See Critical Implementation Details for ordering.

#### 4. Collision-detection SQL function (migration)

**File**: `supabase/migrations/<ts>_password_account_exists.sql`

**Intent**: A locked-down `SECURITY DEFINER` function returning whether an email-identity account exists for a given email, used only by the callback's block path.

**Contract**:
```sql
create or replace function public.password_account_exists(p_email text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from auth.identities i
    where i.provider = 'email' and lower(i.identity_data->>'email') = lower(p_email)
  );
$$;
revoke all on function public.password_account_exists(text) from public, anon, authenticated;
grant execute on function public.password_account_exists(text) to service_role;
```
Regenerate `src/db/database.types.ts` via `npm run db:types` after the migration applies.

#### 5. OAuth buttons component

**File**: `src/components/auth/OAuthButtons.tsx`

**Intent**: Two buttons ("Kontynuuj z Google", "Kontynuuj z Facebook") that navigate (GET) to `/api/auth/oauth/google` and `/api/auth/oauth/facebook`, with a divider ("lub"). Styled to match the cosmic theme; not dependent on `useFormStatus`.

**Contract**: Plain anchors/buttons performing a full-page GET navigation; provider icons (lucide or inline SVG). No form state.

#### 6. Mount OAuth buttons on signin + signup

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: Render `OAuthButtons` above or below the existing form on both pages.

**Contract**: `<OAuthButtons client:load />` placed alongside `SignInForm` / `SignUpForm`; surfaces the same `?error=` already read by these pages (callback redirects reuse that channel).

#### 7. Unit test for the guardrail decision

**File**: `src/pages/api/auth/__tests__/oauth-callback.test.ts`

**Intent**: Extract the block decision into a pure helper `shouldBlockOAuth({ emailVerified, passwordAccountExists })` and test the truth table (verified → never block; unverified + existing password account → block; unverified + no collision → allow).

**Contract**: `vitest`. Cover all four input combinations.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset` (or `supabase db reset`)
- Function is service-role-only: a query as `anon`/`authenticated` is denied (assert in migration test or manual `psql`)
- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test` (includes `shouldBlockOAuth` truth table)
- Generated types updated: `src/db/database.types.ts` includes `password_account_exists`

#### Manual Verification:

- Phase 2.0 spike completed: verified→merge, unverified→separate-user, and reset-for-OAuth-only behaviors confirmed against local Supabase and recorded
- (Requires a real Google OAuth app — see Phase 3 prereq, usable locally) "Kontynuuj z Google" completes the consent flow and lands a new owner on `/dashboard`
- Signing in with Google on an email that already has a verified password account lands on the **same** account (no duplicate) — FR-018 merge
- The unverified-collision block path returns the "zaloguj się hasłem" message and creates no orphan account (verify `auth.users` has no duplicate)
- An OAuth-only owner can run the Phase 1 reset flow and afterwards sign in with email+password

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Production rollout + smoke

### Overview

Configure the hosted Supabase project (providers, redirect allow-list, email templates, Brevo SMTP for auth emails), deploy with the new migration, and smoke-test OAuth + password reset in production.

### Changes Required:

#### 1. Hosted Supabase provider + redirect configuration

**File**: (hosted dashboard — no repo file; documented here and in `change.md` notes)

**Intent**: Enable Google + Facebook with the production OAuth app credentials; set Site URL and the redirect allow-list to the production origin.

**Contract**: Dashboard → Auth → Providers: Google + Facebook client id/secret (provider consoles' authorized redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback`). Auth → URL Configuration: Site URL = production worker URL/custom domain; add `<origin>/api/auth/callback` to redirect allow-list. **Keep the nonce check enabled in production** — the local `skip_nonce_check = true` (Phase 2 #1) is a dev-only relaxation and must NOT be replicated on the hosted project.

#### 2. Brevo SMTP for auth emails (hosted)

**File**: (hosted dashboard)

**Intent**: Route Supabase auth emails (confirmation + recovery) through Brevo SMTP so they deliver reliably in production (NFR <5 min).

**Contract**: Dashboard → Auth → SMTP Settings: Brevo SMTP host/port/user/pass, sender = `EMAIL_FROM`. Upload/sync the `confirmation.html` and `recovery.html` templates (kept in sync with the repo per the existing `confirmation` comment in `config.toml`).

#### 3. Deploy with migration

**File**: CI / `npm run deploy`

**Intent**: Ship the `password_account_exists` migration ahead of the worker, per the project's deploy discipline (schema ships with, never behind, the worker).

**Contract**: `npm run deploy` = `build && db:push && wrangler deploy`. Migration is additive (new function) so a rollback window is safe.

#### 4. Production smoke

**File**: (runbook — record outcome in `change.md`)

**Intent**: Prove the flows work against production before closing the change.

**Contract**: On the production URL: complete Google OAuth login; complete a full password reset (email arrives via Brevo, link sets a new password); confirm a Facebook login or document its app-review status if not yet approved.

### Success Criteria:

#### Automated Verification:

- Deploy pipeline succeeds: `npm run deploy` (migration pushed before worker)
- `password_account_exists` exists in the hosted DB (visible in `supabase_migrations.schema_migrations` / dashboard)

#### Manual Verification:

- Production Google OAuth login lands on `/dashboard`
- Production password-reset email is delivered via Brevo within 5 minutes and completes end-to-end
- The unverified-collision block message appears in production for the colliding case (or is reasoned-through if not reproducible without a Facebook unverified account)
- Facebook login works in production, or its app-review status is documented as the remaining gate

**Implementation Note**: This is the final phase. After smoke passes, the change is ready for `/10x-impl-review` and archival.

---

## Testing Strategy

### Unit Tests:

- `shouldBlockOAuth({ emailVerified, passwordAccountExists })` truth table (Phase 2)
- Reset-password redirect decision: `(hasSession, updateError) → target` (Phase 1)

### Integration Tests:

- None automated (external providers + Supabase email make them brittle — explicit decision). The migration's grant/revoke is verified via `db reset` + a denied-access check.

### Manual Testing Steps:

1. Password reset happy path (Phase 1 manual criteria) against local Supabase + Inbucket
2. Google OAuth new-owner registration → `/dashboard` (local, real Google app)
3. Google OAuth on an existing verified password email → same account (merge)
4. Unverified-collision → block message + no orphan account
5. OAuth-only owner runs reset → can then sign in with password
6. Production smoke (Phase 3 manual criteria)

## Performance Considerations

Negligible. The only added DB call is `password_account_exists`, which runs **only** on the rare unverified-email OAuth path (never for Google). It is an indexed existence check on `auth.identities`.

## Migration Notes

- One additive migration (`password_account_exists`), shipped before the worker via `npm run deploy` (lessons.md: "schema changes ship with the worker, never behind it"). Backwards-compatible — old worker survives the rollback window.
- No data migration; no changes to existing tables.

## References

- PRD: `context/foundation/prd.md` — FR-006/007/008 (auth), FR-017/018 (OAuth + merge), Open Question #1 (resolved here: block + "zaloguj się hasłem")
- Infra: `context/foundation/infrastructure.md` — Cloudflare Workers + hosted Supabase
- Lessons: `context/foundation/lessons.md` — deploy discipline; Windows wrangler-secret newline trap (relevant if any worker secret is set, though OAuth secrets live in the Supabase dashboard, not the worker)
- Existing OTP pattern: `src/pages/api/auth/confirm.ts:22`
- Always-success-no-enumeration pattern: `src/pages/api/auth/resend.ts:22`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Password Reset (email + password)

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 9be0be5
- [x] 1.2 Linting passes: `npm run lint` — 9be0be5
- [x] 1.3 Unit tests pass: `npm test` — 9be0be5
- [x] 1.4 Recovery template registered in `supabase/config.toml` — 9be0be5

#### Manual

- [x] 1.5 Forgot-password flow shows identical success for known and unknown email (no enumeration) — 9be0be5
- [x] 1.6 Recovery email in Inbucket; link lands on `/auth/reset-password` with active session — 9be0be5
- [x] 1.7 New password set → `/dashboard`; re-login with new password works — 9be0be5
- [x] 1.8 Direct `/auth/reset-password` with no session → expired-link redirect — 9be0be5

### Phase 2: OAuth Google + Facebook with merge guardrail (local)

#### Automated

- [x] 2.1 Migration applies cleanly: `npm run db:reset` — 351c9ae
- [x] 2.2 `password_account_exists` denied to anon/authenticated, allowed to service_role — 351c9ae
- [x] 2.3 Type checking passes: `npm run build` — 351c9ae
- [x] 2.4 Linting passes: `npm run lint` — 351c9ae
- [x] 2.5 Unit tests pass incl. `shouldBlockOAuth` truth table: `npm test` — 351c9ae
- [x] 2.6 `src/db/database.types.ts` regenerated with the new function — 351c9ae

#### Manual

- [x] 2.0 Phase 2.0 spike confirms GoTrue merge/separate/reset-OAuth-only behavior (recorded)
- [x] 2.7 Google OAuth registers a new owner → `/dashboard`
- [x] 2.8 Google OAuth on existing verified password email → same account (merge, no duplicate)
- [x] 2.9 Unverified-collision → "zaloguj się hasłem" message, no orphan account
- [x] 2.10 OAuth-only owner completes reset → can sign in with email+password

### Phase 3: Production rollout + smoke

#### Automated

- [x] 3.1 Deploy pipeline succeeds (`npm run deploy`, migration pushed before worker)
- [x] 3.2 `password_account_exists` present in hosted DB migrations

#### Manual

- [x] 3.3 Production Google OAuth login lands on `/dashboard`
- [x] 3.4 Production reset email delivered via Brevo <5 min and completes end-to-end
- [x] 3.5 Unverified-collision block verified or reasoned in production
- [x] 3.6 Facebook login works in production, or app-review status documented
