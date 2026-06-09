# Owner OAuth & Password Reset — Plan Brief

> Full plan: `context/changes/owner-oauth-and-password-reset/plan.md`

## What & Why

Add the last two owner-auth flows the PRD marks must-have: **password reset by email** (FR-008) and **OAuth login/registration via Google + Facebook** (FR-017) with verified-email account merge and an anti-takeover guardrail (FR-018). Email+password auth is already live; without these, owners who forget a password are stuck on manual support and the promised social-login path doesn't exist.

## Starting Point

`@supabase/ssr` cookie sessions, middleware gating `/dashboard`, and a full email+password suite (`signin/signup/confirm/resend/signout`) already exist. `confirm.ts` already runs `verifyOtp` and accepts the `recovery` type; `config.toml` has Google/Facebook blocks present but disabled. Production is Cloudflare Workers + hosted Supabase; `npm run deploy` pushes migrations before the worker.

## Desired End State

Owners can reset a forgotten password via an emailed link, and can register/sign in with Google or Facebook. Google merges silently with an existing same-email account; a Facebook login with an unverified email that collides with a password account is cleanly blocked ("zaloguj się hasłem") — no merge, no duplicate account. An OAuth-only owner can also set a password via the reset flow.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| `email_verified=false` + existing password account | Block OAuth, "zaloguj się hasłem" | Honors FR-018 anti-takeover with least code; user already has a working login | Plan (resolves PRD OQ#1) |
| Provider scope | Google + Facebook, code-complete together | Shared plumbing makes the 2nd provider cheap; meets FR-017 fully | Plan |
| OAuth-only owner clicks "forgot password" | Allow — they set a password | No dead-end, standard Supabase behavior, zero detection code | Plan |
| OAuth credentials | You provide creds; plan treats as prerequisite | Clean handoff, unblocks coding immediately | Plan |
| Test depth | Manual + lightweight unit tests | External providers/emails make full E2E brittle; unit-test the pure decision logic | Plan |
| Forgot-password enumeration | Always "jeśli konto istnieje…" | Zero enumeration, consistent with existing `resend.ts` | Plan |
| Production auth email delivery | Brevo SMTP on hosted Supabase | Meets NFR <5 min; one email provider | Plan |
| Production config + smoke | Final phase of this change | Matches "ship config with the change, prove it in prod" discipline | Plan |

## Scope

**In scope:** password reset (request + set-new-password); Google + Facebook OAuth initiate + PKCE callback; FR-018 auto-merge (verified) + block (unverified collision); OAuth buttons on signin/signup; one `SECURITY DEFINER` migration; production cutover + smoke.

**Out of scope:** email-link manual merge flow; split-brain accounts; Apple OAuth; Playwright/mocked-OAuth tests; account-management/link-provider UI; any booking/overbooking change.

## Architecture / Approach

Reuse, don't reinvent. Password reset rides the existing `verifyOtp` recovery path — only the post-verification destination branches to a set-password form. OAuth uses a provider-agnostic server-side initiate (`signInWithOAuth` + `skipBrowserRedirect`) and a PKCE callback (`exchangeCodeForSession`). FR-018's verified-merge is Supabase's default; the unverified-collision **block** is the only custom logic — detected in the callback via a locked-down `SECURITY DEFINER` boolean function over `auth.identities`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Password reset | Request + set-new-password flow, recovery template | Recovery session edge cases (expired/cold link) |
| 2. OAuth + merge (local) | Google+Facebook login, merge + block guardrail, migration | Getting the unverified-collision block ordering right; Supabase default = split-brain |
| 3. Production + smoke | Hosted provider/redirect/SMTP config, deploy, smoke | Depends on real OAuth apps + dashboard access; Facebook app-review gate |

**Prerequisites:** You create Google + Facebook OAuth apps and provide client id/secret; hosted-Supabase dashboard access; Brevo SMTP credentials for the hosted project.
**Estimated effort:** ~2–3 after-hours sessions across 3 phases (Phase 2 is the heaviest).

## Open Risks & Assumptions

- Facebook's email-permission **app review** can delay Facebook go-live independently of the code — Phase 3 documents status if not approved.
- Supabase's default for an unverified-email collision is split-brain, not takeover; the plan actively converts that to a block — relies on reading `identity_data.email_verified` correctly per provider. The verified-merge, unverified-separate, and reset-for-OAuth-only behaviors are GoTrue **backend** decisions (not in the client lib) and are confirmed by a **Phase 2.0 empirical spike** before the block is coded.
- The OAuth-block path must **not** delete the OAuth user (FK `ON DELETE CASCADE` on `zagrody.owner_id` would destroy a real zagroda) — it signs out and blocks only.
- Auth emails depend on Brevo SMTP being configured on the hosted project; until then production reset/verification emails won't deliver reliably.

## Success Criteria (Summary)

- An owner resets a forgotten password end-to-end (email link → new password → login).
- An owner registers/signs in with Google (and Facebook, subject to review); verified same-email accounts merge into one.
- An unverified-email OAuth collision is blocked with a clear message and creates no duplicate account.
