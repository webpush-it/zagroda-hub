<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Owner OAuth (Google + Facebook) & Password Reset

- **Plan**: `context/changes/owner-oauth-and-password-reset/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-08
- **Verdict**: REVISE → SOUND (after triage: all 5 findings fixed)
- **Findings**: 1 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL → addressed (F1, F2, F3, F5) |
| Plan Completeness | WARNING → addressed (F4) |

## Grounding

10/10 paths ✓, routes/migrations ✓, brief↔plan ✓, no contract-surfaces.md (skipped). Library claims verified against installed source (@supabase/ssr 0.10.3, @supabase/auth-js 2.105.3): PKCE-across-redirect ✓ (createServerClient forces flowType pkce; verifier flushed to cookie on signInWithOAuth via the `-code-verifier` special case; exchangeCodeForSession reads it back) ✓; verifyOtp(recovery)→updateUser({password}) ✓; no admin getUserByEmail (SQL fn justified) ✓; admin.deleteUser exists ✓. Auto-linking + reset-for-OAuth-only are GoTrue backend behavior, not in the client lib (→ F2).

## Findings

### F1 — Block-path deleteUser can cascade-delete a real zagroda

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — change #3 (callback) + Critical Implementation Details
- **Detail**: The block path did `signOut()` + `admin.deleteUser(user.id)`, assuming a fresh orphan. GoTrue re-logs into an existing unverified-OAuth account on re-login; if a password account later shares that email, deleteUser nukes the established OAuth account — and `zagrody.owner_id` is FK `ON DELETE CASCADE`, destroying the zagroda/turnusy/booking_requests. Data loss.
- **Fix A ⭐ Recommended**: Drop deleteUser — signOut + block redirect only.
  - Strength: Eliminates the cascade; leaner; inert orphan is harmless since the block never grants access.
  - Tradeoff: Unused orphan auth.users rows may accumulate.
  - Confidence: HIGH — cascade FK confirmed; removing the delete cannot lose data.
  - Blind spot: None significant.
- **Fix B**: Guard the delete (only if no zagroda owned AND fresh identity).
  - Strength: Keeps cleanup for the genuine first-time case.
  - Tradeoff: Hot-path logic + foot-gun if guard weakened.
  - Confidence: MED.
  - Blind spot: "fresh identity" heuristics are fuzzy.
- **Decision**: FIXED via Fix A — removed deleteUser from Critical Implementation Details and Phase 2 #3; added cascade rationale.

### F2 — Central FR-018 behavior is unverified GoTrue backend behavior

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Key Discoveries + Phase 2 (merge happy-path, 2.8 / 2.10)
- **Detail**: Verified-email auto-merge, unverified→separate-user, and reset-for-OAuth-only are GoTrue server decisions not encoded in @supabase/auth-js. The guardrail design and the OAuth-only-reset promise rest on them.
- **Fix**: Add a Phase 2.0 empirical spike against local Supabase before building the block; record findings in the plan.
  - Strength: De-risks the riskiest assumption for ~30 min.
  - Tradeoff: Small upfront time cost.
  - Confidence: HIGH.
  - Blind spot: Local GoTrue may differ subtly from hosted — re-confirm in P3.
- **Decision**: FIXED — added Phase 2 change #0 (verification spike), Key Discoveries caveat, manual criterion + Progress 2.0.

### F3 — OAuth block message reintroduces the enumeration the plan avoids

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — change #3, block message
- **Detail**: The block message confirms a password account exists for the email, inconsistent with the no-enumeration stance used for forgot-password. Blast radius small (reaching the branch requires controlling a matching unverified OAuth identity).
- **Fix**: Accept and document the trade-off in "What We're NOT Doing"; keep the helpful message.
- **Decision**: FIXED — added an explicit accepted-trade-off bullet to "What We're NOT Doing".

### F4 — resetPasswordForEmail redirectTo is redundant and may break the link

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — change #2
- **Detail**: forgot-password.ts passed redirectTo, but the recovery template builds the link via {{ .SiteURL }} (parity with the working confirmation flow, which passes none). A redirectTo not in the allow-list is rejected by Supabase.
- **Fix**: Drop the redirectTo param; rely on template + SiteURL.
- **Decision**: FIXED — Phase 1 #2 contract now calls `resetPasswordForEmail(email)` with no redirectTo and explains why.

### F5 — skip_nonce_check must stay false in the hosted dashboard

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — change #1 (local) vs Phase 3 — change #1 (prod)
- **Detail**: Local Google sign-in needs skip_nonce_check = true; carrying that into the hosted dashboard would weaken prod OAuth. Phase 3 didn't say to keep it off.
- **Fix**: Add a one-line note in Phase 3 to keep the nonce check enabled in production.
- **Decision**: FIXED — added the note to Phase 3 #1.
