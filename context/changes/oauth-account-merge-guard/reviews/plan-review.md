<!-- PLAN-REVIEW-REPORT -->
# Plan Review: OAuth Account-Merge Guard Hardening (S-07)

- **Plan**: context/changes/oauth-account-merge-guard/plan.md
- **Mode**: Deep
- **Date**: 2026-06-11
- **Verdict**: SOUND (REVISE before triage; all findings fixed)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (fixed in triage) |
| Plan Completeness | WARNING (fixed in triage) |

## Grounding

7/7 paths ✓, 4/4 symbols ✓, brief↔plan ✓, `docs/reference/contract-surfaces.md` absent (check skipped). Blast radius confirmed: `shouldBlockOAuth` consumers are exactly the callback and the unit tests; `OAUTH_MESSAGES` is also imported by `src/pages/api/auth/oauth/[provider].ts` but only for keys the plan doesn't touch.

Live verification (sub-agent, local Supabase stack running):
- `auth.identities` schema CONFIRMED: `email` is `GENERATED ALWAYS AS lower(identity_data->>'email')` (note the `lower()`), `provider_id` NOT NULL, `UNIQUE (provider_id, provider)`; the plan's 8-column fixture insert is valid.
- Scenario-B probe CONFIRMED empirically: `admin.auth.admin.createUser({..., email_confirm: false})` creates a `provider='email'` identity for the unconfirmed user, and `password_account_exists` returns true (case-insensitive). Probe user cleaned up.
- `signin.astro` ?error= rendering CONFIRMED (`signin.astro:6` → `SignInForm.serverError` → `ServerError.tsx` alert).
- `createAdminClient()` null contract CONFIRMED (`src/lib/supabase-admin.ts:14-23`): null exactly when resolved url or serviceKey is falsy; `override` param used by `src/worker.ts`.
- Test topology: unit-standalone claim CONTRADICTED (see F2).

## Findings

### F1 — Missing user email on the unverified path stays fail-open

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Callback rewire
- **Detail**: The current guard runs only `if (!emailVerified && data.user.email)` (`callback.ts:32`) — an unverified identity with NO email skips the check entirely and is allowed. The plan's verdict rewire never specified how a missing `data.user.email` maps into the tri-state, so a third silent fail-open branch would have survived the hardening, contradicting the Desired End State ("never allowed through without the collision check having actually run"). Local `email_optional = false` should prevent the case, but hosted-dashboard parity is explicitly out of scope.
- **Fix A ⭐ Recommended**: Map unverified + missing email → `block_unavailable` (callback maps it to `passwordAccountExists = null` with its own `console.error`; verdict signature and six-case truth table unchanged).
  - Strength: Closes the branch with machinery Phase 1 already builds; zero legit-user cost while `email_optional=false` holds.
  - Tradeoff: If hosted config drifts, email-less users see a generic message.
  - Confidence: HIGH — one mapping case in the callback.
  - Blind spot: None significant.
- **Fix B**: Document allow-as-is (no email → no possible collision).
  - Strength: Logically sound; zero behavior change.
  - Tradeoff: Keeps a reasoning-dependent fail-open branch in the exact function this slice makes fail-closed.
  - Confidence: MED — fragile against future detector extensions.
  - Blind spot: Hosted `email_optional` parity unverified (out of scope by decision).
- **Decision**: FIXED via Fix A — plan.md Phase 1 callback Intent/Contract updated; plan-brief.md in-scope bullet updated.

### F2 — "Unit tests run standalone" is false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details + Phase 1 Success Criteria
- **Detail**: `vitest.config.ts` wires a single `globalSetup` (`tests/helpers/global-setup.ts`) that runs `supabase status` on EVERY vitest invocation — including unit-only runs — and throws (`global-setup.ts:62-70`) when neither a running stack nor `SUPABASE_*` env vars resolve. The plan's claim "unit tests run standalone" would fail Phase 1 verification on a cold environment. Side finding: this worktree has no `node_modules` yet.
- **Fix**: Correct the Critical Implementation Details bullet (all vitest runs need `npm run db:start` or the env vars) and add `npm install` as a Phase 1 prerequisite.
- **Decision**: FIXED — plan.md Critical Implementation Details bullet rewritten; plan-brief.md Prerequisites updated.

### F3 — Progress titles drift from Phase bullets

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress vs Phase 1/2 Success Criteria
- **Detail**: Structure and counts were correct, but two titles weren't verbatim matches: Progress 2.1 dropped "against local Supabase"; 1.3 dropped a parenthetical.
- **Fix**: Align the Phase-block bullets to the Progress wording (the dropped detail lives in Testing Strategy / Critical Implementation Details).
- **Decision**: FIXED — both Phase bullets trimmed to match Progress entries verbatim.
