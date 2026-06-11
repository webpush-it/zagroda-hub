# OAuth Account-Merge Guard Hardening (S-07) Implementation Plan

## Overview

Harden the FR-018 OAuth merge guard shipped in S-06 so it **fails closed**: when the unverified-email collision check cannot run (missing service-role client *or* a failing RPC), the OAuth login is blocked with a generic "temporarily unavailable" message instead of being silently allowed. Back it with an extended unit truth table and new DB-level simulation tests, since Meta App Review prevents exercising the real unverified-Facebook path live.

## Current State Analysis

S-06 (PR #14) delivered the guard; PRD Open Question #1 was resolved 2026-06-11 as option (a), and roadmap S-07 (`context/foundation/roadmap.md:168-178`) explicitly shrinks this slice to verification + hardening. Full analysis: `context/changes/oauth-account-merge-guard/research.md`.

- **Decision logic**: `src/lib/auth/oauth-guard.ts:32-34` — `shouldBlockOAuth({emailVerified, passwordAccountExists})` returns `!emailVerified && passwordAccountExists`. Truth table unit-tested in `tests/unit/oauth-guard.test.ts`.
- **Enforcement**: `src/pages/api/auth/callback.ts:25-57` — on an unverified provider email, calls `password_account_exists` via the admin client; on block: `signOut()` + redirect with `OAUTH_MESSAGES.block`. Never deletes the user (`zagrody.owner_id ON DELETE CASCADE`).
- **The fail-open hole (gap #1)**: two branches silently disable the guard —
  1. `callback.ts:33-46`: admin client `null` (missing `SUPABASE_SERVICE_ROLE_KEY`) → `console.warn`, login allowed.
  2. `callback.ts:35`: the RPC result destructures only `data` — an RPC **error** (e.g. 401 from a newline-corrupted key, the exact incident in `context/foundation/lessons.md:19-24`) yields `data = null` → `passwordAccountExists = false` → login allowed with **no log at all**.
- **Detector**: `supabase/migrations/20260609000000_password_account_exists.sql` — SECURITY DEFINER over `auth.identities` (`provider = 'email'`, case-insensitive), service-role-only. Grant/detection behavior tested in `tests/db/password-account-exists.test.ts`.
- **Test infra**: `tests/helpers/supabase.ts` — admin/anon/owner client factories, `uniqueEmail()`, and an established direct-SQL `pg` pattern (`createUnverifiedOwnerClient`, lines 55-68) for manipulating `auth.*` rows that GoTrue's API won't.

## Desired End State

An unverified-email OAuth login is **never allowed through without the collision check having actually run**. The three-way outcome is explicit in code: allow / block-collision (existing Polish message) / block-unavailable (new generic message + `console.error`). The unit truth table covers all input combinations including the unavailable state, and DB tests prove the detector's behavior across identity configurations (password+facebook, OAuth-only, unconfirmed password account).

Verify by: running the extended unit suite, the new `tests/db/oauth-merge-guard.test.ts` against local Supabase, and a production Google-path regression smoke after deploy.

### Key Discoveries:

- The RPC-error fail-open (`callback.ts:35`) is the realistic trigger — lessons.md documents a corrupted `SUPABASE_SERVICE_ROLE_KEY` producing exactly this failure mode (client exists, every request 401s).
- `auth.identities.email` is a **generated column** (from `identity_data->>'email'`) — SQL fixtures must not insert it; `provider_id` is NOT NULL and part of the `(provider, provider_id)` unique key.
- `password_account_exists` checks identity **existence**, not confirmation — an *unconfirmed* password account already trips it, so the unverified-provider direction of the pre-registration attack is blocked today; this just needs a probe test to pin it.
- The callback is the sole consumer of `shouldBlockOAuth`, so the decision function can be reshaped freely (verdict enum) without ripple.

## What We're NOT Doing

- **Sign-in-specific identity selection** (research gap #2): `identities.find()` keeps picking the first OAuth identity. Wrong-identity evaluation errs toward blocking (`Boolean(undefined)` = false), so it is imprecise but not unsafe.
- **OAuth-vs-OAuth collision detection** (gap #3): unverified Facebook vs existing Google-only account still passes as a separate user (split-brain). The detector stays `provider = 'email'` only. v2 candidate.
- **Hosted-dashboard parity check** (gap #6): `skip_nonce_check` / provider-settings drift on the hosted project is not verified by this change — do ad-hoc when touching the dashboard.
- **Manual merge flow** (PRD OQ#1 option c) — deferred to v2 since S-06.
- **Changing the existing collision block message** or its accepted enumeration tradeoff.
- **Deleting orphan `auth.users` rows** left by blocked logins (cascade risk; unchanged S-06 invariant).
- **GoTrue handshake-level integration tests or pursuing Meta App Review** — the live unverified-Facebook smoke stays a documented best-effort item; GoTrue's verified-only auto-linking remains a documented, accepted assumption (S-06 spike + Supabase docs).

## Implementation Approach

Keep the S-06 pattern: pure decision logic in `oauth-guard.ts` (unit-testable truth table), thin mechanical enforcement in the callback. Model the collision-check result as a tri-state (`true` / `false` / `null` = check could not run) and return an explicit verdict instead of a boolean, so the two block reasons map to two messages without the callback growing its own logic. Tests extend the two existing suites' styles; no schema migration.

## Critical Implementation Details

- **RPC error must become `null`, not `false`**: the callback currently destructures only `data` from the RPC call. The fail-closed change must capture `error` and map it (and the admin-client-null case) to the "unknown" state, each with its own `console.error` — a corrupted key manifests as an RPC error with an existing client, not as a null client.
- **`auth.identities` SQL fixture shape**: `email` is generated — insert only `(id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)` with `identity_data` carrying `sub`, `email`, `email_verified`. Violating this fails the insert, not silently.
- **ALL vitest runs need the local stack (or env vars)**: `vitest.config.ts` wires a single `globalSetup` (`tests/helpers/global-setup.ts`) that runs `supabase status` on every invocation — including unit-only runs — and throws when neither a running stack nor the `SUPABASE_*` env vars resolve. Run `npm run db:start` before any test command. This worktree also has no `node_modules` yet — `npm install` precedes Phase 1.

## Phase 1: Fail-Closed Guard Semantics

### Overview

Reshape the pure decision into a three-way verdict, add the generic unavailable message, and rewire the callback so both unavailable branches (null client, RPC error) block with `console.error`.

### Changes Required:

#### 1. Verdict function and new message

**File**: `src/lib/auth/oauth-guard.ts`

**Intent**: Replace the boolean `shouldBlockOAuth` with a verdict function that distinguishes *why* a login is blocked, and add the generic block message for the unavailable case. Keep `OAUTH_PROVIDERS` / `isOAuthProvider` / existing messages unchanged.

**Contract**: Other phases and the callback depend on this signature:

```ts
export type OAuthVerdict = "allow" | "block_collision" | "block_unavailable";
// passwordAccountExists: true/false = check ran; null = check could not run
export function resolveOAuthVerdict(input: {
  emailVerified: boolean;
  passwordAccountExists: boolean | null;
}): OAuthVerdict;
```

Rules: verified → always `allow` (auto-merge path untouched); unverified + `true` → `block_collision`; unverified + `null` → `block_unavailable`; unverified + `false` → `allow`. New message key `OAUTH_MESSAGES.blockUnavailable` — generic Polish "provider sign-in temporarily unavailable, try again later" wording that does **not** claim a password account exists. `shouldBlockOAuth` is removed (callback + unit tests are the only consumers).

#### 2. Callback rewire

**File**: `src/pages/api/auth/callback.ts`

**Intent**: Compute `passwordAccountExists: boolean | null` — `null` when the admin client is unavailable, **or** the RPC returns an error, **or** `data.user.email` is missing on the unverified path (the check has no address to run against; today this third case silently allows — see review F1) — logging a distinct `console.error` for each (greppable in `wrangler tail`). Branch on the verdict: `block_collision` → existing message; `block_unavailable` → new message; both sign out first. Preserve the no-deleteUser comment/invariant and the verified-path short-circuit (the RPC is still only called when unverified).

**Contract**: Redirect targets unchanged (`/auth/signin?error=...`, `/dashboard`). The RPC call must destructure `{ data, error }` and treat `error` as the unavailable state — not as `false`. Missing email never maps to `false`; legitimate email-less logins shouldn't exist while `email_optional = false` holds, so blocking them generically is pure defense-in-depth.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npx astro check`
- Linting passes: `npm run lint`
- Extended unit truth table passes: `npx vitest run tests/unit/oauth-guard.test.ts`

#### Manual Verification:

- The `blockUnavailable` Polish copy reads naturally and does not imply an account exists

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation of the copy before proceeding.

---

## Phase 2: DB-Level Simulation and Probe Tests

### Overview

Pin the detector's behavior across identity configurations the unit layer can't reach, using the established `tests/db/` + direct-SQL `pg` pattern. This is the CI-runnable stand-in for the live unverified-Facebook path Meta App Review blocks.

### Changes Required:

#### 1. New DB test suite

**File**: `tests/db/oauth-merge-guard.test.ts`

**Intent**: Three test groups against local Supabase, following the style of `tests/db/password-account-exists.test.ts` and reusing `tests/helpers/supabase.ts`:

1. **Collision post-state simulation**: password owner (via `createOwnerClient`) + a second user given a `facebook` identity with `email_verified=false` for the *same* email via direct SQL. Assert `password_account_exists(email)` is still `true` (the facebook identity doesn't mask the email identity) and the two `auth.users` rows remain distinct — the exact split-brain state whose login the callback blocks.
2. **OAuth-only user**: a user whose only identity is `facebook` (create user, delete its `email` identity row via SQL, insert the facebook one). Assert `password_account_exists` → `false` — documents the gap-#3 boundary (OAuth-only accounts are not "password accounts").
3. **Scenario-B probe**: an **unconfirmed** password account (`admin.auth.admin.createUser({..., email_confirm: false})`, no sign-in needed). Assert `password_account_exists` → `true` — proves the unverified-provider direction of the pre-registration attack is blocked even before the attacker confirms.

**Contract**: The identity fixture SQL (non-obvious — `auth` schema, generated column):

```sql
insert into auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), $1, 'facebook', $2,
        jsonb_build_object('sub', $2, 'email', $3, 'email_verified', false),
        now(), now(), now());
-- do NOT insert the `email` column: it is GENERATED from identity_data->>'email'
```

A small helper for this insert may live in `tests/helpers/supabase.ts` next to the existing `pg` usage.

#### 2. Documented assumption

**File**: `context/changes/oauth-account-merge-guard/change.md` (Notes section)

**Intent**: Record the accepted assumption in one short note: GoTrue links an OAuth identity into an existing user only when the involved emails are verified (S-06 Phase 2.0 spike + Supabase auth docs); this repo does not test GoTrue's handshake-time linking decision itself.

**Contract**: Prose note under `## Notes`; no code.

### Success Criteria:

#### Automated Verification:

- New DB suite passes: `npx vitest run tests/db/oauth-merge-guard.test.ts`
- Full suite passes: `npm test`

---

## Phase 3: Deploy and Manual Verification

### Overview

Ship the hardened guard and regression-smoke the verified path in production; record the live-Facebook outcome.

### Changes Required:

#### 1. Production deploy

**File**: n/a (process)

**Intent**: Deploy via the sanctioned path `npm run deploy` (lessons.md rule — even though this change has no migration, the path stays uniform). No wrangler secrets change.

**Contract**: `npm run deploy` = build → `db:push` (no-op) → `wrangler deploy`.

### Success Criteria:

#### Automated Verification:

- Deploy completes cleanly: `npm run deploy`

#### Manual Verification:

- Production Google sign-in regression: existing Google-linked owner lands on `/dashboard` (verified auto-merge path unaffected)
- `/auth/signin` renders the new generic message correctly when visited with the crafted `?error=` param (cosmetic check of the copy in situ)
- Live unverified-Facebook smoke attempted; outcome recorded in `change.md` Notes — either PASS or "still blocked on Meta App Review" (best-effort, expected blocked)

**Implementation Note**: After deploy and the Google regression smoke pass, this slice is done; the Facebook line item closes as *documented*, not necessarily *executed*.

---

## Testing Strategy

### Unit Tests:

- `resolveOAuthVerdict` full truth table: emailVerified × passwordAccountExists ∈ {true, false, null} — six cases; verified inputs must always `allow` regardless of the tri-state.
- `isOAuthProvider` cases unchanged.

### Integration Tests:

- `tests/db/oauth-merge-guard.test.ts` as specified in Phase 2 (collision post-state, OAuth-only boundary, scenario-B probe).
- Existing `tests/db/password-account-exists.test.ts` continues to cover grants + case-insensitivity (no duplication).

### Manual Testing Steps:

1. Prod: sign in with a Google-linked owner → `/dashboard`.
2. Visit `/auth/signin?error=<urlencoded blockUnavailable message>` → message renders correctly.
3. Best-effort: Facebook login with an unverified-email test account (if Meta App Review ever clears) → expect the collision block message when a password account exists for that email.

## Performance Considerations

None. The RPC remains gated behind the unverified-email branch (Google logins never pay it); the verdict refactor is pure CPU.

## Migration Notes

No schema changes. Code-only deploy; `wrangler rollback` remains safe.

## References

- Related research: `context/changes/oauth-account-merge-guard/research.md`
- S-06 implementation + reviews: `context/archive/2026-06-08-owner-oauth-and-password-reset/`
- Roadmap slice: `context/foundation/roadmap.md:168-178` (S-07)
- PRD OQ#1 resolution: `context/foundation/prd.md:191-195`
- Fail-open incident prior: `context/foundation/lessons.md:19-24`
- Guard code: `src/lib/auth/oauth-guard.ts`, `src/pages/api/auth/callback.ts`
- Detector + tests: `supabase/migrations/20260609000000_password_account_exists.sql`, `tests/db/password-account-exists.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fail-Closed Guard Semantics

#### Automated

- [x] 1.1 Type check passes: `npx astro check` — eb534f6
- [x] 1.2 Linting passes: `npm run lint` — eb534f6
- [x] 1.3 Extended unit truth table passes: `npx vitest run tests/unit/oauth-guard.test.ts` — eb534f6

#### Manual

- [x] 1.4 `blockUnavailable` Polish copy reads naturally and does not imply an account exists — eb534f6

### Phase 2: DB-Level Simulation and Probe Tests

#### Automated

- [x] 2.1 New DB suite passes: `npx vitest run tests/db/oauth-merge-guard.test.ts`
- [x] 2.2 Full suite passes: `npm test`

### Phase 3: Deploy and Manual Verification

#### Automated

- [ ] 3.1 Deploy completes cleanly: `npm run deploy`

#### Manual

- [ ] 3.2 Production Google sign-in regression lands on `/dashboard`
- [ ] 3.3 `/auth/signin` renders the generic unavailable message via crafted `?error=` param
- [ ] 3.4 Live unverified-Facebook smoke outcome recorded in `change.md` Notes (PASS or blocked-on-Meta)
