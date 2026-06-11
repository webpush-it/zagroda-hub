<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OAuth Account-Merge Guard Hardening (S-07)

- **Plan**: context/changes/oauth-account-merge-guard/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-06-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | FAIL |

Automated checks re-run at review time: `npx astro check` FAIL (2 errors, new in Phase 2 file); `npm run lint` PASS; `npx vitest run tests/unit/oauth-guard.test.ts` PASS (6/6); `npx vitest run tests/db/oauth-merge-guard.test.ts` PASS (3/3); `npm test` PASS (14 files, 99/99). Manual checks: all four checked with evidence (1.4 copy confirmed in P1; 3.2 user-confirmed; 3.3 verified headlessly; 3.4 documented blocked-on-Meta).

## Findings

### F1 — `npx astro check` fails: 2 possibly-null errors in the new DB test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/db/oauth-merge-guard.test.ts:48, :83
- **Detail**: `oauthUser.user.id` / `user.user.id` — `user` is possibly null per the Supabase types (ts18047). Phase 1's criterion "npx astro check passes" was true at eb534f6, but Phase 2 added this file and its criteria only ran vitest, which strips types without checking. The repo-wide type check is now red — any future phase or CI typecheck gate trips on it.
- **Fix**: Add an explicit null guard after each createUser call (e.g. `if (!oauthUser.user) throw new Error("createUser returned no user")`) so the type narrows; re-run `npx astro check`.
- **Decision**: FIXED — null guards added at both sites; `npx astro check` now 0 errors; DB suite re-run green (3/3)

### F2 — Block-path `signOut()` failure is silently ignored

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/callback.ts:78
- **Detail**: `exchangeCodeForSession` has already set auth cookies before the verdict runs. `await supabase.auth.signOut()` returns `{ error }` and never throws — if it fails, the user is bounced to /auth/signin with the block message but keeps a live session and can navigate straight to /dashboard. The block becomes cosmetic on that path — the same fail-open shape this change exists to close, one layer up.
- **Fix A ⭐ Recommended**: Capture the signOut error; on failure, log a fail-closed console.error AND expire the auth cookies on the response so the browser can't reuse the session.
  - Strength: Closes the hole at the enforcement point itself, matching the change's "never rely on a downstream check" principle and its console.error ops-signal pattern.
  - Tradeoff: Cookie-expiry code duplicates knowledge of the SSR cookie names (sb-*); slightly more code at the call site.
  - Confidence: MED — signOut failing while the exchange succeeded is rare, but it's exactly the degraded-Supabase scenario the unavailable verdict anticipates.
  - Blind spot: Haven't verified whether middleware independently re-validates the session before /dashboard renders — if it does, residual risk is lower than stated.
- **Fix B**: Only log the failure (console.error), keep behavior otherwise.
  - Strength: Two-line change; preserves the ops-signal pattern with zero new cookie logic.
  - Tradeoff: The session genuinely survives a failed signOut; the block remains advisory in that corner.
  - Confidence: HIGH — trivially correct as far as it goes.
  - Blind spot: Same middleware question as Fix A.
- **Decision**: FIXED via Fix A — signOut error captured; on failure console.error + expiry of all response-queued cookies (via `context.cookies.headers()`, avoiding hardcoded sb-* names); astro check + lint green

### F3 — Destructive auth.* test SQL can follow env-var fallback to a remote DB

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/helpers/global-setup.ts:51-60 (used by tests/db/oauth-merge-guard.test.ts:51,:84, tests/helpers/supabase.ts:85-97)
- **Detail**: The test DB URL resolves from `supabase status` first but falls back to SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DB_URL — the exact names production uses. If the local stack is down and a shell has prod values exported, the new tests execute `delete from auth.identities`, `update auth.users set email_confirmed_at = null` and forged-identity inserts against that database. Statements are scoped to just-created test users ($1 = user_id), limiting blast radius, but nothing verifies the target is local. Pre-existing pattern — this change is the first to run raw destructive SQL against auth.*, raising the stakes.
- **Fix**: In global-setup.ts, assert the resolved DB host is 127.0.0.1/localhost and require an explicit ALLOW_REMOTE_TEST_DB=1 override otherwise.
- **Decision**: FIXED — isLocal() guard over both API and DB URLs in global-setup.ts with ALLOW_REMOTE_TEST_DB=1 override; full suite green (99/99)

### F4 — Comment says "the authenticating identity"; code picks the first one

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/callback.ts:25-27
- **Detail**: `identities?.find(isOAuthProvider)` reads the first OAuth identity, which for a multi-OAuth-identity user may not be the one that just signed in. This is the plan's explicitly deferred gap #2 ("imprecise but not unsafe") — not drift — but the comment above the line claims the authenticating identity, which the code doesn't guarantee.
- **Fix**: Amend the comment to state the single-OAuth-identity assumption and reference the deferred gap; no behavior change this slice.
- **Decision**: FIXED — comment rewritten to name the first-identity read, the deferred gap #2 and the errs-toward-blocking property; no behavior change

### F5 — supabase-admin.ts forbids exactly the import the callback makes

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/supabase-admin.ts:6-7
- **Detail**: The module doc says "NEVER import this module from any user-facing data path"; the callback (a user-facing route, importing since S-06) is a deliberate, safe exception (service-role-only boolean RPC), but the rule as written is no longer enforceable by reading it.
- **Fix**: Amend the module comment to name the sanctioned FR-018 callback exception and why it's safe.
- **Decision**: FIXED — module comment names the FR-018 callback exception and its safety rationale

## Triage outcome (2026-06-11)

All 5 findings FIXED (F1 fix, F2 via Fix A, F3 fix, F4 doc-only, F5 doc-only). Post-triage verification: `npx astro check` 0 errors; `npm run lint` clean; unit + DB suites 9/9; full suite 99/99 (after F3). Verdict after triage: all dimensions effectively PASS.
