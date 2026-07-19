<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Phone Bookings & Day Blocks (S-08)

- **Plan**: context/changes/phone-bookings-and-day-blocks/plan.md
- **Scope**: Phase 1 of 3 (commit 54b5983)
- **Date**: 2026-07-19
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Context: drift agent found zero drift across all 10 migration steps, the concurrency-test extension, both new suites, and the (correctly) untouched existing tests; types regeneration confirmed pure. Safety agent verified lock ordering, RLS, grants, constraints, index usage, and cross-suite state hygiene as sound. Automated criteria re-verified at review time: db:reset clean, 183/183 tests, lint 0 problems. Manual 1.4 has SQL evidence (rolled-back owner-impersonation scenario). master is 4 commits ahead of origin — nothing deployed.

## Findings

### F1 — HEAD fails `npx astro check` (6 TS errors) after types pull-forward

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/booking-request/{accept,reject,withdraw}.ts (errors at accept.ts:88-89, reject.ts:75-76, withdraw.ts:75-76)
- **Detail**: guest_name/guest_email are now `string | null` (types regen pulled forward from Phase 2 for the Phase 1 test suites), but the e-mail builders (`DecisionEmailContext`, src/lib/booking.ts:81-82) require `string`. All existing gates (CI: lint → build → vitest) stay green; astro check is a new gate established in Phase 2 per the plan.
- **Fix**: Proceed to Phase 2 promptly — its §6 lands the null-safe e-mail guards and the astro-check gate together, as planned. No separate hotfix.
- **Decision**: PENDING

### F2 — Deploy-window claim in plan is wrong; phase gap exposes live RPCs

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: plan.md ("Critical Implementation Details" → deploy-window note; "Migration Notes")
- **Detail**: The plan claims "no day_blocks rows can exist before Phase 3 ships" — false: once deployed, `block_day`/`create_manual_booking` are live PostgREST surfaces for any authenticated owner (no UI needed). A phone entry could then hit the OLD worker's withdraw route, which evaluates the e-mail builder on null guest fields outside the try/catch → 500 after the DB commit; old accept.ts would report a `day_blocked` refusal with the misleading FR-014 copy (occupied=0). No data-integrity risk; requires deliberate raw RPC calls. Currently theoretical: master is 4 ahead of origin, nothing deployed.
- **Fix ⭐ Recommended**: Don't push master until Phase 2 lands (closes the gap entirely) and correct the plan's deploy-window note as a review addendum.
  - Strength: Zero production exposure; one-paragraph plan edit.
  - Tradeoff: master stays unpushed for one more session.
  - Confidence: HIGH — Phase 2 §6 is precisely the missing guard.
  - Blind spot: None significant.
- **Decision**: PENDING

### F3 — Hardcoded fixture dates are time bombs against the past-date checks

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/db/manual-bookings.test.ts (2026-10-01..07), tests/db/day-blocks.test.ts (2026-11-01..14), tests/db/concurrency.test.ts:106 (2026-12-01)
- **Detail**: The new RPCs hard-reject past dates (55000) — a NEW failure class older suites never had (their stale 2026-07 dates keep working because accept/withdraw don't check dates). The new suites start failing in real time: manual-bookings on 2026-10-01, day-blocks on 2026-11-01, cross-channel race on 2026-12-01.
- **Fix**: Compute dates as today+N in the three new suites. Candidate for a lessons.md entry (first date-sensitive RPCs in the repo).
- **Decision**: PENDING

### F4 — Guests can attach `note` via direct INSERT

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260719100000_manual_bookings_and_day_blocks.sql §3 (guest INSERT policies)
- **Detail**: Policies pin status and source but not note — anon can attach a ≤500-char note to a pending request via raw PostgREST. Phase 3 plans to render notes only on phone rows, so today it's inert; pinning is cheap defense-in-depth against a future render path treating note as owner-authored.
- **Fix**: Add `and note is null` to both guest INSERT policies (migration not deployed anywhere — safe to amend in place + db:reset).
- **Decision**: PENDING

### F5 — Trigger reads day_blocks without the zagroda lock (accepted race)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: migration §5 (enforce_day_not_blocked)
- **Detail**: Under READ COMMITTED, a guest pending INSERT racing block_day can land on a just-blocked day. Benign — acceptance re-checks under the zagroda lock, so blocked demand can never become accepted. Taking the lock in the trigger would be worse (serializes all guest inserts against acceptances). Correct design; the header comment should name the race as accepted.
- **Fix**: Add a one-line "accepted race" note to the trigger header comment.
- **Decision**: PENDING

### F6 — Contact CHECK is one-directional (phone rows MAY carry contact)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — informational
- **Dimension**: Safety & Quality
- **Location**: migration §2 (booking_requests_guest_contact_presence)
- **Detail**: `source='phone' OR (all three NOT NULL)` permits a phone row carrying contact fields; only service_role could produce one (create_manual_booking never writes contact; no UPDATE policies; no mutator touches guest fields — an app row can never lose contact either). Acceptable as-is.
- **Fix**: None required — awareness note.
- **Decision**: PENDING

### F7 — Migration comment cites the wrong SECURITY DEFINER "precedent"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: migration §5 header comment (plan.md Key Discoveries carries the same claim)
- **Detail**: `zagrody_guard_is_published` is invoker-rights with a `current_user` check, not SECURITY DEFINER. The definer choice in the new trigger is correct and required — only the attribution is off.
- **Fix**: Reword the comment (drop or correct the precedent reference).
- **Decision**: PENDING
