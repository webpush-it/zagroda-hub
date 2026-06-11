<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Gated Acceptance with Overbooking Guard (S-04)

- **Plan**: `context/changes/gated-acceptance-with-overbooking-guard/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-11
- **Verdict**: REVISE → SOUND after triage (all 5 findings fixed in plan)
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL (fixed) |

## Grounding

8/8 paths ✓, 4/4 symbols ✓, brief↔plan ✓. `docs/reference/contract-surfaces.md` absent — check skipped. Deep verification: 7 claims checked by sub-agent against code (all confirmed or refined; see findings).

## Findings

### F1 — Phase 1 "(none)" bullet breaks the Progress contract

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Success Criteria / Manual Verification
- **Detail**: "#### Manual Verification:" held only a "- (none — DB-only phase)" placeholder bullet with no matching `- [ ] N.M` Progress entry — malformed for /10x-implement's mechanical parser.
- **Fix**: Delete the heading + placeholder; Implementation Note already covers the no-gate intent.
- **Decision**: FIXED

### F2 — Owner-email deep link dies on every auth redirect

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 #4 + manual criterion 3.7
- **Detail**: Verified: `middleware.ts:18-21` drops the requested path; `signin.ts:38`, `callback.ts:60`, and `confirm.ts` all hardcode `/dashboard` post-auth. Logged-out owners tapping "Zobacz zapytanie" land on the dashboard; criterion 3.7 as originally written was unachievable.
- **Fix A ⭐ Recommended**: Accept degraded logged-out path; reword 3.7 to "with an active session"; record returnTo as future work in "What We're NOT Doing".
  - Strength: Zero scope creep on the north-star slice; persistent mobile sessions make the active-session case dominant.
  - Tradeoff: Cold-session owners need one extra tap via the list.
  - Confidence: HIGH — session persistence is Supabase default.
  - Blind spot: Real session-expiry frequency on target devices unmeasured.
- **Fix B**: returnTo support across middleware + signin + OAuth callback.
  - Strength: Deep link works in all cases.
  - Tradeoff: Touches 3 shipped S-06 auth files inside S-04; open-redirect validation needed.
  - Confidence: MEDIUM.
  - Blind spot: Interaction with oauth-guard block path unverified.
- **Decision**: FIXED (Fix A)

### F3 — Decision endpoints: pre-fetch-null path unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 #2 (accept) and #3 (reject)
- **Detail**: RLS returns null for foreign/unknown ids on the email-context pre-fetch; neither contract said what happens then, and reject didn't state it needs the fetch at all.
- **Fix**: Both contracts now specify: pre-fetch null → 404, skip the RPC; reject performs the same fetch.
- **Decision**: FIXED

### F4 — App-layer verification gate is a novel pattern; test helper exists

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 #2/#3 — FR-006 gate
- **Detail**: Nothing in src/ reads `email_confirmed_at` (convention is DB-side `email_verified()`); gate is sound (`getUser()` = server truth) but novel. `createUnverifiedOwnerClient` (tests/helpers/supabase.ts:55-68) exists for testing; the reachable unverified-OAuth-no-collision state is blocked correctly (such users can't publish → can't have requests).
- **Fix**: Notes added to Critical Implementation Details.
- **Decision**: FIXED

### F5 — getWaitUntil helper is private to the S-03 route

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 #2/#3 — email enqueue
- **Detail**: waitUntil lives at `locals.cfContext` (not `locals.runtime`) via a private `getWaitUntil()` at index.ts:14-22 — outside the plan's cited range; copying means three private copies.
- **Fix**: Plan now instructs extracting the helper to a shared module (e.g. `src/lib/cf.ts`) imported by all three routes.
- **Decision**: FIXED
