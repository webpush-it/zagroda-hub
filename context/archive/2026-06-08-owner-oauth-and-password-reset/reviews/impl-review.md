<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Owner OAuth (Google + Facebook) & Password Reset

- **Plan**: context/changes/owner-oauth-and-password-reset/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-06-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence summary

Two parallel reviewers (plan-drift + safety/quality/pattern) independently confirmed full plan adherence across all Phase 1 & 2 items. All five emphasized critical details hold: callback ordering (exchange → inspect email_verified → RPC only-if-false → dashboard); no `deleteUser` on the block path (FK cascade safety); reset-password uses the cookie-bound SSR client not the admin client; forgot-password passes no `redirectTo`; `password_account_exists` REVOKE anon/authenticated + GRANT service_role only (verified empirically by the DB test returning 42501). No MISSING items. Extras justified: DB lockdown test (fulfils criterion 2.2), documented eslint fix (note 2.4), defensive server-side session guard on reset-password.astro. Build `astro check` exit 0; lint exit 0; unit + DB tests verified green at 351c9ae (require the local Supabase stack, not running in this review env). Phase 3 Facebook is an accepted, documented Meta App-Review gate, not a code defect.

## Findings

### F1 — eslint.config.js rule disabled for *.astro

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:75-81
- **Detail**: Disables `@typescript-eslint/no-misused-promises` for `**/*.astro` — an EXTRA change not in the plan. Works around a pre-existing repo-wide eslint crash (rule throws on a top-level `return` in .astro frontmatter, hit by the new reset-password.astro guard and pre-existing katalog.astro). Documented + justified in change.md note 2.4 with the eslint-plugin-astro remedy. Not a regression.
- **Fix**: None needed — accepted, documented scope addition. Optionally revisit when typescript-eslint ships the upstream fix.
- **Decision**: SKIPPED — accepted as-is (documented, justified workaround).

### F2 — OAuth block message reveals a password account exists

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth/oauth-guard.ts:6-11
- **Detail**: The block message ("To konto loguje się hasłem…") discloses that a password account exists for the email — a mild enumeration vector, inconsistent with the no-enumeration stance on forgot-password. Explicit documented trade-off (plan "What We're NOT Doing" #6): reachable only after a real OAuth handshake where the caller controls an identity reporting that exact email as email_verified=false (Google never does), so bulk enumeration isn't practical.
- **Fix**: None — accepted by design. On record for future audits.
- **Decision**: SKIPPED — accepted by design (documented trade-off, plan "What We're NOT Doing" #6).

### F3 — password_account_exists fails open if admin client is absent

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/callback.ts:31-38
- **Detail**: If the service-role admin client is null (missing SERVICE_ROLE_KEY), `passwordAccountExists` defaults to false → the unverified-collision block does NOT fire and login is allowed. Defensible: the block is a hardening guard, not the primary authz boundary, and Supabase's default for the unverified case is split-brain (separate user), not takeover. Worth knowing if the worker ever loses its service-role key.
- **Fix**: None required. Optionally log a warning when admin is null on the unverified path, so a missing key is observable.
- **Decision**: FIXED — added a `console.warn` in the `else` branch (callback.ts:37-46) so a missing service-role key surfaces in `wrangler tail` instead of silently skipping the guardrail. Lint + build clean.
