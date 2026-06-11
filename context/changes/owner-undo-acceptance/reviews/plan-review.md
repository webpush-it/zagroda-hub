<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Owner Undo Acceptance (S-05)

- **Plan**: context/changes/owner-undo-acceptance/plan.md
- **Mode**: Deep
- **Date**: 2026-06-11
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

10/10 paths ✓, 4/4 symbols ✓, brief↔plan ✓, Progress↔Phase ✓, migration `20260611150000` sorts last among 12 existing migrations ✓. `docs/reference/contract-surfaces.md` does not exist — check skipped.

Verified without findings:
- `reject_booking_request` matches the plan's claimed pattern exactly (ownership-first, request-row-only lock, P0002/42501, soft outcomes, authenticated-only grant).
- DB test harness ready 1:1 — `tests/db/reject.test.ts` case (e) already proves the anon-EXECUTE pattern; `tests/db/concurrency.test.ts` has the race pattern; `npm run test` runs `tests/db/` (requires local Supabase, enforced by global-setup).
- All capacity-counting queries filter `status='accepted'` (occupancy sum, S-02 catalog availability, partial index) — a newly reachable `withdrawn_by_owner` breaks nothing.
- `STATUS_META` comment in `StatusBadge.tsx` explicitly anticipates S-05; `database.types.ts` already contains the enum value (no type regen).

## Findings

### F1 — Guest-cancel returns "already_accepted" for a withdrawn request

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: outside the plan (Phase 2 is the natural home)
- **Detail**: `src/pages/api/booking-request/cancel.ts:48` maps `case "accepted": case "withdrawn_by_owner"` → `{ status: "already_accepted" }`. Dead branch today; S-05 makes it reachable. A teacher who received the withdrawal email and clicks their old cancel link would see "zapytanie zaakceptowane — zadzwoń do gospodarza" — the opposite of the truth. The S-04 impl review explicitly deferred this to S-05; the plan didn't pick it up.
- **Fix**: Add to Phase 2: split the switch case (`withdrawn_by_owner` → `already_withdrawn`), extend the `CancelStatus` union and copy map in `src/components/booking/CancelRequest.tsx`. No SQL change (`cancel_booking_request` already treats withdrawn as soft no-op).
- **Decision**: FIXED — Phase 2 change #3 added; manual criterion 2.7 added to Success Criteria and Progress; "What We're NOT Doing" amended; brief scope updated.

### F2 — Phase 3 contract didn't name the required RequestDecision refactor

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Changes 1-2
- **Detail**: Verification resolved the brief's "open risk": the island has no extension point — `Props` is `{ id }` only, initial state hardcoded `useState("pending")`, action union `"accept" | "reject"` in three places (`submitting`, `decide()`, button gate). Bonus: `TERMINAL_COPY` in `[id].astro:65` already contains withdrawn copy.
- **Fix**: Name the exact refactor in the Phase 3 contract (`initialStatus` prop, widened action union, per-status button gate); update Critical Implementation Details; resolve the open risk in the brief.
- **Decision**: FIXED — Phase 3 contract and Critical Implementation Details updated; brief risk marked resolved.

### F3 — US-01 proof already exists as a simulation in acceptance-rule.test.ts

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 — Change 2
- **Detail**: `tests/db/acceptance-rule.test.ts:111-134` case (d) "freed seats" already proves capacity release by simulating withdrawal via direct admin UPDATE ("Withdrawal functions are S-05 — simulate with a direct admin UPDATE"). The plan rewrote that proof in `withdraw.test.ts`, leaving the simulation as debt.
- **Fix**: Upgrade case (d) to call the real `withdraw_booking_request`; `withdraw.test.ts` keeps the semantics matrix + races only.
- **Decision**: FIXED — Phase 1 change #3 added (upgrade acceptance-rule case (d)); US-01 proof removed from withdraw.test.ts contract; success criterion 1.2 and Testing Strategy updated.

## Triage summary

- Fixed: F1, F2, F3 (3)
- Skipped / Accepted / Dismissed: none

**Verdict after fixes: SOUND** — all findings resolved in the plan.
