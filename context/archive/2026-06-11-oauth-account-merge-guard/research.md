---
date: 2026-06-11T00:29:35+02:00
researcher: Konrad Beśka
git_commit: b78e765646413380183b8eb76694907a56076bbe
branch: change/oauth-account-merge-guard
repository: zagroda-hub
topic: "How does the current OAuth flow (Google + Facebook) handle the case where an OAuth sign-in matches an existing email/password account? Is there any guard against unintended account merging or takeover, and where would one be added?"
tags: [research, codebase, auth, oauth, supabase, account-merge, fr-018, s-07]
status: complete
last_updated: 2026-06-11
last_updated_by: Konrad Beśka
---

# Research: OAuth account-merge guard — current state and gaps

**Date**: 2026-06-11T00:29:35+02:00
**Researcher**: Konrad Beśka
**Git Commit**: b78e765646413380183b8eb76694907a56076bbe
**Branch**: change/oauth-account-merge-guard
**Repository**: zagroda-hub

## Research Question

How does the current OAuth flow (Google + Facebook) handle the case where an OAuth sign-in matches an existing email/password account? Is there any guard against unintended account merging or account takeover, and where would one be added?

## Summary

**The guard already exists.** S-06 (PR #14, commit c5cb55b, archived as `context/archive/2026-06-08-owner-oauth-and-password-reset/`) shipped the FR-018 collision guard: a pure decision helper `shouldBlockOAuth()` (`src/lib/auth/oauth-guard.ts:32-34`), enforcement in the OAuth callback (`src/pages/api/auth/callback.ts:25-57`), and a service-role-only SQL detector `password_account_exists()` (`supabase/migrations/20260609000000_password_account_exists.sql`). PRD Open Question #1 was resolved 2026-06-11 as **option (a)** — reject unverified-email OAuth logins that collide with a password account (commit b78e765), which is exactly what S-06 implemented.

Per the roadmap (`context/foundation/roadmap.md:168-178`), **S-07's scope therefore shrinks** to: live-verifying the `email_verified=false` block path against a real provider (never exercised live — Meta App Review gates it), plus hardening. Research surfaced **five concrete residual weaknesses** worth considering for S-07 scope (see "Gap Analysis" below), the most actionable being: the guard **fails open** when the service-role key is missing, and the callback inspects the **first** OAuth identity via `find()` rather than the identity used for the current sign-in.

The takeover-relevant behavior matrix as currently built:

| Scenario | Supabase (GoTrue) behavior | App-layer guard | Outcome |
|---|---|---|---|
| Verified OAuth email (Google always) + existing confirmed password account | Auto-link into existing user | None (by design) | Silent merge → `/dashboard` — explicit product decision (OQ#1 option a happy path) |
| Unverified OAuth email (Facebook sometimes) + existing password account | Creates a *separate* user (no merge) | **Blocked**: signOut + "zaloguj się hasłem" redirect | No split-brain, no takeover |
| Unverified OAuth email, no collision | Separate new user | Allowed | Clean OAuth-only account |
| Attacker pre-registers victim's email with password (unconfirmed), victim later uses Google | Unverified email identity is outside GoTrue's linking domain → victim gets a separate user | n/a | No takeover (relies on `enable_confirmations=true`); **untested in this repo** |
| Existing OAuth-only user, then password signup with same email | GoTrue obfuscates the signup (no second account, no session) | None needed | Sanctioned path to add a password is the recovery flow (mailbox-gated) |

## Detailed Findings

### 1. OAuth flow end-to-end (live code)

- **Initiation**: `src/components/auth/OAuthButtons.tsx:43-57` renders plain `<a>` links to `GET /api/auth/oauth/google|facebook`, shown on `/auth/signin` and `/auth/signup` (both at line 19 of their `.astro` pages).
- **Initiate endpoint**: `src/pages/api/auth/oauth/[provider].ts:5-34` — validates the provider with `isOAuthProvider()`, calls `signInWithOAuth()` with `redirectTo: ${origin}/api/auth/callback` and `skipBrowserRedirect: true` (so the PKCE verifier is committed to cookies on our own 3xx), then redirects to the provider consent URL.
- **Callback**: `src/pages/api/auth/callback.ts:6-61` — `exchangeCodeForSession(code)` (line 20), then the FR-018 decision tree:
  - line 26: `data.user.identities?.find((i) => isOAuthProvider(i.provider))` → picks an OAuth identity
  - line 27: `emailVerified = Boolean(oauthIdentity?.identity_data?.email_verified)`
  - lines 29-47: **only when unverified**, call `password_account_exists(p_email)` via the admin (service-role) client; if the admin client is unavailable, log `console.warn` and leave `passwordAccountExists = false` (**fail-open**)
  - lines 49-57: `shouldBlockOAuth()` → on block: `signOut()` + redirect to `/auth/signin?error=To konto loguje się hasłem…`. Deliberately **no `deleteUser`** — `zagrody.owner_id` is `ON DELETE CASCADE`, so deleting a linked user could destroy a real zagroda (comment at lines 51-53).
  - line 60: success → `/dashboard`.
- **Decision logic**: `src/lib/auth/oauth-guard.ts` — `OAUTH_MESSAGES` (line 5), `OAUTH_PROVIDERS = ["google","facebook"]` (line 16), `isOAuthProvider()` (line 19), `shouldBlockOAuth()` (lines 32-34): `return !emailVerified && passwordAccountExists`. Truth table unit-tested in `tests/unit/oauth-guard.test.ts:5-16`.

### 2. The SQL detector

`supabase/migrations/20260609000000_password_account_exists.sql:12-27` — `public.password_account_exists(p_email text)`: `SECURITY DEFINER`, `set search_path = ''`, checks `auth.identities` for `provider = 'email'` with case-insensitive email match. `REVOKE ... FROM public, anon, authenticated; GRANT EXECUTE ... TO service_role` — not usable for enumeration from public routes; only callable server-side after a real OAuth handshake. DB-level grant behavior tested in `tests/db/password-account-exists.test.ts` (42501 for anon/authenticated).

### 3. Supabase config relevant to collisions (`supabase/config.toml`)

- `enable_signup = true` (line 169) — precondition for the pre-registration vector exists.
- `enable_manual_linking = false` (line 173) — `linkIdentity()` is off; only GoTrue's *automatic* verified-email linking applies. Manual merge flow (OQ#1 option c) deferred to v2.
- `[auth.email].enable_confirmations = true` (line 209) — password accounts can't sign in unconfirmed; this is the key mitigation for the pre-registration takeover vector.
- `double_confirm_changes = true` (line 207) — blocks email-change-based takeover of a linked account.
- `[auth.external.google]` (lines 339-347) / `[auth.external.facebook]` (lines 352-360): both `enabled = true`, `email_optional = false` (provider login with no email is rejected by GoTrue), `skip_nonce_check = true` — **dev-only**; config comments (336-338, 349-351) state Google always reports `email_verified=true` (block never fires for Google) and that `skip_nonce_check` must NOT be replicated on the hosted project.
- `[auth.hook.before_user_created]` commented out (lines 275-278) — the only GoTrue-side place a rejection could happen *before* a user/identity row is created; currently unused (all guarding is app-layer).
- Note: `config.toml` governs local dev only; hosted settings live in the Supabase dashboard (drift risk acknowledged in comments).

### 4. What a merge means downstream (blast radius)

- **No `handle_new_user` trigger, no `profiles` table, no trigger on `auth.users` at all** (verified across all 11 migrations). The only domain link to auth: `zagrody.owner_id uuid not null unique references auth.users(id) on delete cascade` (`supabase/migrations/20260605090307_domain_schema.sql:20`). Everything is keyed by user id via RLS `auth.uid()` policies (same file, lines 79-130, 145-150); nothing is keyed by email.
- **Middleware trusts the uid unconditionally**: `src/middleware.ts:6-25` sets `locals.user` from `getUser()` and gates `/dashboard` on user *presence* only. API routes (`src/pages/api/zagroda/index.ts:16`, `photo.ts:21`, `publish.ts:43`) rely on RLS. **An identity linked into an existing user id silently gains full owner access to that user's zagroda, turnusy, and booking requests** — the link-time decision is the entire defense.
- An unlinked duplicate user (same email, different uid) owns nothing → split-brain confusion, not takeover.
- `public.email_verified()` (`supabase/migrations/20260605200000_zagroda_profile_publication.sql:61-77`) gates *publishing* on `email_confirmed_at`; OAuth users with verified provider emails pass.

### 5. GoTrue auto-linking semantics (empirically confirmed for this project)

S-06 ran a Phase 2.0 spike against local Supabase (archived plan lines 162-171, 260) confirming: (1) OAuth on existing **verified** password account → one merged account; (2) **unverified** provider email colliding with a password account → a **separate** user is created (so the block has something to detect, and Supabase itself never auto-links unverified emails); (3) `resetPasswordForEmail` reaches an OAuth-only user and `updateUser({password})` adds password login (mailbox-gated, safe by construction).

### 6. Gap Analysis — residual weaknesses (candidate S-07 scope)

1. **Fail-open on missing service-role key** — `src/pages/api/auth/callback.ts:37-46`: if `SUPABASE_SERVICE_ROLE_KEY` is absent, the collision check is skipped and the login allowed (only a `console.warn`). Impl-review F3 deemed it defensible (the underlying Supabase outcome is split-brain, not takeover), but fail-closed would be the natural hardening — especially given the lessons.md precedent of a corrupted secret silently disabling the admin client (newline-in-secret incident, F-02).
2. **Identity selection by `find()`** — `callback.ts:26` picks the *first* google/facebook identity on the user, not necessarily the identity used for *this* sign-in. A user holding both a verified Google and an unverified Facebook identity could have the wrong identity's flag evaluated. Low severity (`Boolean(undefined)` errs toward blocking), but imprecise.
3. **Guard only detects `provider='email'` collisions** — an unverified Facebook email colliding with an existing *OAuth-only* (Google) account passes through as a duplicate user (split-brain), since `password_account_exists` filters `provider = 'email'` (`20260609000000:21`).
4. **Live `email_verified=false` path never exercised** — proven only at unit level (truth table) and DB level (grants). Meta App Review blocks creating a real unverified-email Facebook login (S-06 change.md 3.5/3.6). The roadmap names this verification as S-07's core.
5. **Scenario B untested** — attacker pre-registers victim's email with a password (unconfirmed), victim signs in with Google. Expected: GoTrue keeps the unverified email identity out of the linking domain → no takeover. The S-06 spike tested provider-side verification, not this direction; no integration test exists (natural home: `tests/db/` next to `password-account-exists.test.ts`).

Accepted-by-design (documented, not gaps): block message reveals a password account exists (enumeration accepted — plan-review F3; reachable only via a real OAuth handshake with a controlled unverified identity); blocked logins leave a harmless orphan `auth.users` row (block never grants it access; deletion is unsafe due to the cascade).

## Code References

- `src/lib/auth/oauth-guard.ts:32-34` — `shouldBlockOAuth()` pure decision (`!emailVerified && passwordAccountExists`)
- `src/lib/auth/oauth-guard.ts:5-16` — block message (Polish), `OAUTH_PROVIDERS`, `isOAuthProvider()`
- `src/pages/api/auth/callback.ts:25-57` — FR-018 enforcement: identity inspection, RPC call, fail-open branch, signOut+redirect block
- `src/pages/api/auth/oauth/[provider].ts:5-34` — OAuth initiation (PKCE, `skipBrowserRedirect`)
- `src/components/auth/OAuthButtons.tsx:43-57` — provider buttons
- `supabase/migrations/20260609000000_password_account_exists.sql:12-27` — SECURITY DEFINER detector, service-role-only grants
- `supabase/migrations/20260605090307_domain_schema.sql:20` — `zagrody.owner_id ... on delete cascade` (why block path never deletes)
- `supabase/config.toml:169,173,207,209,275-278,339-360` — signup/linking/confirmation settings, unused `before_user_created` hook, provider blocks
- `src/middleware.ts:4-25` — presence-only auth gate; uid trusted downstream
- `tests/unit/oauth-guard.test.ts:5-16` — truth-table tests
- `tests/db/password-account-exists.test.ts` — RPC grant tests
- `src/pages/api/auth/signin.ts:26-27` — `email_not_confirmed` routing (mitigation for pre-registration vector)

## Architecture Insights

- **Pure-decision + thin-enforcement pattern**: the block decision is an exported pure function with a unit-tested truth table; the callback is a thin orchestrator. Extensions to the guard should follow the same split (extend `shouldBlockOAuth`/add inputs, keep callback mechanical).
- **All identity-trust decisions happen at link time** (GoTrue verified-only auto-linking + callback guard). Nothing downstream re-validates provider/verification — middleware and RLS trust `auth.uid()` unconditionally. Any hardening must land at the callback or earlier (the unused `before_user_created` GoTrue hook is the only pre-creation interception point).
- **Service-role surface is deliberately minimal**: one boolean RPC, revoked from all public roles, callable only server-side post-handshake — preserves the project's no-enumeration posture on public endpoints (`forgot-password`/`resend` are always-success).
- **Deletion is never a remediation** in auth paths: `zagrody.owner_id ON DELETE CASCADE` makes `deleteUser` destructive (plan-review F1, CRITICAL, fixed); sign-out + block is the pattern.
- **Config drift risk**: `config.toml` is local-only; `skip_nonce_check=true` and provider settings must be independently verified on the hosted dashboard.

## Historical Context (from prior changes)

- `context/archive/2026-06-08-owner-oauth-and-password-reset/plan-brief.md:19-28` — decision table: unverified + existing password account → block with "zaloguj się hasłem" (resolves PRD OQ#1)
- `context/archive/2026-06-08-owner-oauth-and-password-reset/plan.md:37-43` — out of scope: manual merge flow (option c), split-brain repair, link-provider UI → deferred to v2
- `context/archive/2026-06-08-owner-oauth-and-password-reset/plan.md:162-171` — Phase 2.0 empirical spike confirming GoTrue merge/separate/reset behavior
- `context/archive/2026-06-08-owner-oauth-and-password-reset/reviews/plan-review.md` — F1 deleteUser-cascade (CRITICAL, fixed), F2 unverified GoTrue behavior (fixed via spike), F3 enumeration in block message (accepted), F5 `skip_nonce_check` prod warning
- `context/archive/2026-06-08-owner-oauth-and-password-reset/reviews/impl-review.md` — F3: fail-open when admin client absent (observation; `console.warn` added)
- `context/archive/2026-06-08-owner-oauth-and-password-reset/change.md:152-166` — manual verification: Google merge paths PASS (2.8, 2.10); unverified-collision block (3.5/2.9) **reasoned, not live-reproduced** (Meta App Review gate)
- `context/foundation/prd.md:191-195` — Open Question #1 text + resolution 2026-06-11: **option (a)**; block is temporary per provider state (auto-merge resumes when provider reports verified)
- `context/foundation/roadmap.md:168-178` — S-07 slice definition: hard `email_verified=true` gate; scope shrinks to live verification of the unverified path + message/test polish; prerequisite S-06 done
- `context/foundation/lessons.md:19-24` — Windows wrangler-secret newline corruption: a corrupted `SUPABASE_SERVICE_ROLE_KEY` is a *realistic* trigger for the fail-open branch in gap #1

## Related Research

None — this is the first research artifact under `context/changes/`. The closest prior artifact is the archived S-06 plan (above).

## Open Questions

1. **Should the guard fail closed?** When the admin client is unavailable (missing/corrupted service-role key), block unverified-email OAuth logins instead of allowing them? (Gap #1 — recommendation: yes; cheap, and the lessons.md secret-corruption incident shows the trigger is realistic.)
2. **Should identity selection be sign-in-specific?** Replace `find(isOAuthProvider)` with selection of the identity actually used in this exchange (e.g., newest `last_sign_in_at`, or match `app_metadata.provider`)? (Gap #2)
3. **Extend collision detection beyond `provider='email'`?** Blocking unverified-OAuth vs existing-OAuth-account collisions would prevent the remaining split-brain case but widens scope beyond FR-018's letter. (Gap #3 — likely v2 unless cheap)
4. **How to live-verify the `email_verified=false` path** given Meta App Review blocks it — options: a GoTrue test double, a local Supabase integration test simulating an unverified identity insert, or waiting on Meta review. (Gap #4 — roadmap names this as S-07's core)
5. **Scenario B integration test** — does the hosted GoTrue version keep unconfirmed email identities out of the linking domain? Needs a `tests/db/` integration test. (Gap #5)
6. **Hosted-dashboard parity check** — is `skip_nonce_check` off in production, and are provider settings consistent with `config.toml` intent? (Operational verification, fits S-07's live-verification scope.)
