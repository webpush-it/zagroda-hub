<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Phone Bookings & Day Blocks (S-08)

- **Plan**: context/changes/phone-bookings-and-day-blocks/plan.md
- **Scope**: Full plan (all 3 phases)
- **Date**: 2026-07-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Context: zero plan drift across all 13 Phase-2/3 changes; auth-gate parity, pgcode mapping, null-safe e-mail guards (incl. withdraw's outside-try/catch builder) and XSS-safe `note` rendering verified. Automated gates green at review time: lint clean, astro check 0 errors, build complete, 210/210 tests (one earlier run flaked 4 tests on JWT clock skew — F5, environmental). Phase-1 F1 (astro check) confirmed RESOLVED; F2 (deploy-window) stays closed — master 7 ahead of origin, nothing deployed.

## Findings

### F1 — Date time-bombs in the 3 new DB test suites

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/db/manual-bookings.test.ts (2026-10-01..07), tests/db/day-blocks.test.ts (2026-11-01..14), tests/db/concurrency.test.ts:106 (2026-12-01)
- **Detail**: New RPCs hard-reject past dates (55000). New suites use hardcoded future dates that pass today but rot into past-date failures on 2026-10-01 / 2026-11-01 / 2026-12-01. Flagged as F3 in the Phase-1 review, left PENDING, never fixed.
- **Fix**: Compute dates as today+N (shared helper) in the three new suites. lessons.md candidate (first date-sensitive RPCs).
- **Decision**: FIXED — added `isoDate(offsetDays)` helper to tests/helpers/supabase.ts; replaced hardcoded future dates with distinct today+N offsets in manual-bookings/day-blocks/concurrency suites (past-date negative tests → isoDate(-30)). 21/21 affected tests pass.

### F2 — Guest INSERT policies don't pin `note is null`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260719100000_manual_bookings_and_day_blocks.sql (§3, guest INSERT policies)
- **Detail**: Both guest INSERT policies pin `status='pending' and source='app'` but not `note`. Anon/authenticated can attach a ≤500-char note via raw PostgREST. Inert today (notes render only on phone rows); plan never required the pin (Phase-1 review F4, not incorporated).
- **Fix**: Add `and note is null` to both guest INSERT policies (migration not deployed — safe to amend in place + db:reset).
- **Decision**: FIXED — added `and note is null` to both guest INSERT policies in the migration (comment updated); db:reset + full suite 210/210 pass.

### F3 — Unbounded SSR requests query on the panel page (pre-existing)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/zapytania/index.astro:38-42
- **Detail**: booking_requests SSR select has no `.limit()` / pagination — ships all requests (all statuses, full history) into RequestsList for client-side filtering; sibling catalog_zagrody caps at 100. Unboundedness predates S-08 (parent commit equally unbounded); S-08 only added `source`. Feature accumulates more rows over time (phone + soft-deleted entries).
- **Fix**: Add a `.limit()` (and/or server-side status scoping) mirroring the catalog. Out of S-08 scope — queue as a separate follow-up.
- **Decision**: FIXED — added `.limit(200)` to the SSR booking_requests query (most-recent bound; not status-scoped so the cancelled/withdrawn history chip stays intact), with a comment referencing catalog_zagrody's limit posture.

### F4 — Invalid turnus_id yields 500 instead of a 4xx

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — informational
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/manual-booking/index.ts:52-56
- **Detail**: A turnus_id not on this zagroda fails on the composite FK and falls to `default → 500` rather than 422. Not exploitable (owner only affects own zagroda), explicitly documented in the plan ("the UI select prevents it").
- **Fix**: None required — awareness note. Could map FK violation (23503) → 422 if hardening later.
- **Decision**: FIXED — added a `case "23503"` → 422 arm in manual-booking/index.ts so a crafted foreign-turnus payload returns a client error instead of 500.

### F5 — Test suite flakes on "JWT issued at future" (environmental)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — informational
- **Dimension**: Success Criteria
- **Location**: tests/db/withdraw.test.ts (and one sibling) — existing suites
- **Detail**: First `npm test` run failed 4/210 with PGRST303 "JWT issued at future" in pre-existing suites; clean re-run passed 210/210. Clock skew between JWT `iat` and the auth container, not a code defect and not S-08-specific.
- **Fix**: None for S-08. If it recurs in CI, add small `iat` backdate/leeway in the test JWT helper — separate infra concern.
- **Decision**: ACCEPTED-AS-RULE — recorded in context/foundation/lessons.md ("PGRST303 'JWT issued at future' in DB tests is an environmental clock-skew flake"). No code change (root cause is GoTrue-minted `iat` + container clock skew, outside our source).
