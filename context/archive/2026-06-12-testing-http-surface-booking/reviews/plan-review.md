<!-- PLAN-REVIEW-REPORT -->
# Plan Review: HTTP-Surface Integration on the Booking Lifecycle

- **Plan**: `context/changes/testing-http-surface-booking/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-13
- **Verdict**: REVISE → SOUND after triage (all findings fixed in plan)
- **Findings**: 1 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS (1 observation, fixed) |
| Lean Execution | PASS (1 observation, fixed) |
| Architectural Fitness | PASS |
| Blind Spots | FAIL → PASS (critical fixed) |
| Plan Completeness | PASS (1 observation, fixed) |

## Grounding

11/11 paths ✓, symbols ✓, brief↔plan ✓. Deep verification (1 sub-agent + direct checks) confirmed: `astro/virtual-modules/*` resolves via the package exports map (`./dist/virtual-modules/*`); global-setup `provide` keys match the plan's `inject()` names; withdraw enqueues a decision email (`withdraw.ts:72`) so the FR-016 outbox assertion is valid; outbox recipient column is `to_email`; null email config → no network call, row stays `pending`; reject success shape `{ ok: true, status: "rejected" }`; no existing test transitively imports `astro:env/server` at runtime (aliases non-breaking); `@supabase/ssr` exports `createChunks`; Progress↔Phase consistency holds (5/5 phases).

## Findings

### F1 — Race-test fixture violates zagrody.owner_id UNIQUE

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Parallel-accept race
- **Detail**: Plan specified "~10 iterations with fresh zagroda + requests per iteration (jars reused)". Jars reused = same owner, but `zagrody.owner_id` is NOT NULL UNIQUE (`supabase/migrations/20260605090307_domain_schema.sql:20`) — the second `seedZagroda` for the same owner fails. The DB-layer test the plan cites knows this (`tests/db/concurrency.test.ts:30`: "Fresh zagroda needs a fresh owner: owner_id is UNIQUE on zagrody") and creates a fresh owner per iteration.
- **Fix A ⭐ Recommended**: One owner, one zagroda, fresh `trip_date` per iteration
  - Strength: Capacity is computed per (zagroda, trip_date) — each date is an independent arena; jars stay reused, no extra signins, no constraint issue.
  - Tradeoff: Diverges cosmetically from the DB test's fresh-owner shape (commented in plan).
  - Confidence: HIGH — accept RPC scopes occupancy to the request's trip_date.
  - Blind spot: None significant.
- **Fix B**: Fresh owner + zagroda + two HTTP signins per iteration
  - Strength: Mirrors the proven DB-layer pattern 1:1.
  - Tradeoff: 20 extra signin round-trips; 30s timeout pressure.
  - Confidence: HIGH.
  - Blind spot: Signin latency unmeasured.
- **Decision**: FIXED via Fix A

### F2 — Vague oracle: "4xx per handler zod parse"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Error translation
- **Detail**: "malformed body (non-UUID id) → 4xx per handler" invites lifting the expected status from handler code. Verified gate order: non-JSON → 400, schema failure → 422.
- **Fix**: Pin in plan — non-UUID `id` → 422, non-JSON body → 400.
- **Decision**: FIXED

### F3 — CookieJar contract over-specified

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 — tests/helpers/api.ts
- **Detail**: The `@supabase/ssr` adapter only calls `cookies.set()`; reads parse the request `Cookie` header (`src/lib/supabase.ts:12-22`). `get`/`delete` are never called by in-scope routes; `headers()` is callback.ts-only (out of scope).
- **Fix**: Trim jar contract to `set()` + `toCookieHeader()`; grow only on need.
- **Decision**: FIXED

### F4 — End state overstates non-exposure assertion's reach

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State #3 vs Phase 3
- **Detail**: End state said "no API response ever echoes guest_email/guest_phone" but only the authz suite asserted it; Phase 2/4 responses were unchecked.
- **Fix**: Shared `assertNoContactData(responseBody, fixture)` helper in `tests/helpers/api.ts`, applied across the Phase 2, 3, and 4 suites.
- **Decision**: FIXED
