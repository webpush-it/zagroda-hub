<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: HTTP-Surface Integration on the Booking Lifecycle

- **Plan**: context/changes/testing-http-surface-booking/plan.md
- **Scope**: All 5 phases (full plan)
- **Date**: 2026-06-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verification run during review

- `npm run lint` — PASS (no errors; `astro-eslint-parser` projectService warnings only)
- `npx vitest run tests/api` — 4 files / 34 tests PASS (~15s, race stable)
- `src/` changes — ZERO (test-only change, as planned)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Notable strengths

- **Oracle independence holds.** The capacity-refusal message is reconstructed in-test from the PRD FR-014 template (`booking-decision.test.ts:39-41`), never imported from `accept.ts` — a genuine cross-check, not a mirror. Hostile payloads in `guest-input.test.ts` are hand-written, not derived from `bookingRequestSchema`.
- **Network egress is provably impossible**: the Brevo env trio stays `undefined` → `getEmailConfig()` returns null → `drainDueEmails` returns before any send.
- **Race deviation is justified and correctly scoped** — zagroda reused across iterations partitioned by `trip_date`, with end-state assertions filtered by both `zagroda_id` and `trip_date`.
- **Zero `src/` changes** — scope discipline fully respected.

## Findings

### F1 — Random phone number weakens the contact-leak probe

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Test Reliability)
- **Location**: tests/api/booking-decision.test.ts:54, tests/api/authz.test.ts:51, tests/api/guest-input.test.ts:48
- **Detail**: `guest_phone` was built from `Math.floor(Math.random()*1e8)`, which can collide across guests. As one of two leak probes in `assertNoContactData`, a phone collision would silently weaken (not falsely fail) the phone check. Email is UUID-backed and stays unique, so no false green for the suite as a whole.
- **Fix**: Derive the phone digits from `randomUUID()` so both leak probes are collision-free, keeping each file's distinct prefix digit (6/7/5).
- **Decision**: FIXED — replaced `Math.random()*1e8` with `randomUUID().replace(/\D/g, "").padEnd(8,"0").slice(0,8)` in all three suites; added `randomUUID` import to `authz.test.ts`. Re-verified: lint clean, `tests/api` 34/34 green.

### F2 — Duplicated per-file test helpers

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `uniqueGuest` / `readBody` / `postDecision` across the three api suites
- **Detail**: Near-identical helpers are duplicated across `booking-decision`/`authz`/`guest-input`, differing only in a phone-prefix digit. Not a defect — the per-file prefix is intentional for attribution; could be hoisted into `tests/helpers/api.ts` next to `assertNoContactData` if this grows.
- **Fix**: Optional — hoist shared helpers into `tests/helpers/api.ts` later (parameterize the phone prefix).
- **Decision**: SKIPPED — intentional per-file prefix, no defect.

### F3 — Supabase clients are never explicitly closed

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Resource)
- **Location**: tests/helpers/supabase.ts (client factories)
- **Detail**: The api suites create many more `supabase-js` clients than the db suites (one signin per fixture, plus `jarB` in the race). None are disposed, but `clientOptions` disables session persistence/refresh timers, so there are no lingering intervals — and `pg` clients are properly closed in `finally`. Matches existing `tests/db/` convention.
- **Fix**: None required.
- **Decision**: ACCEPTED — safe as-is; matches existing convention.
