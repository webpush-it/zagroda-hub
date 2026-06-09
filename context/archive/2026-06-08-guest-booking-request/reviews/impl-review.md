<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Guest Booking Request (S-03)

- **Plan**: context/changes/guest-booking-request/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-06-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

Automated criteria re-run during review: `npm run lint` clean · `npm test` 81/81 passed · `npm run build` complete. All manual items (4.4–4.6 and prior phases) verified.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — cancel.ts returns 200 not_found on malformed token (plan said 422)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/booking-request/cancel.ts:25-28
- **Detail**: The plan's Phase 4 contract said "reading {token} (zod uuid → 422 on bad shape)". The implementation returns `200 {status:"not_found"}` on a malformed token instead. Behaviorally sound and arguably better — a malformed token is indistinguishable from an unknown one (both = "no such request"), and folding it into the existing not_found path gives coherent guest UX with no data leak. Contradicts only the written contract.
- **Fix A ⭐ Recommended**: Reconcile the plan to match the code (keep the unified not_found UX).
  - Strength: Keeps the cleaner one-path UX; updates source of truth so future reviews don't re-flag.
  - Tradeoff: Plan's stated 422 contract changes after the fact.
  - Confidence: HIGH — not_found copy is exactly right for a bad token; verified manually + by tests.
  - Blind spot: None significant.
- **Fix B**: Change cancel.ts to return 422 on bad shape.
  - Strength: Honors the plan verbatim.
  - Tradeoff: Worse guest UX; island would need a new branch for zero practical gain.
  - Confidence: MED — minor code + island change, needs re-test.
  - Blind spot: CancelRequest.tsx maps non-ok-without-status to a generic server error.
- **Decision**: FIXED via Fix A — plan.md Phase 4 cancel-route contract updated to document `200 {status:"not_found"}` on malformed token.

### F2 — withdrawn_by_owner / rejected map to imprecise cancel copy

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/booking-request/cancel.ts:47-52
- **Detail**: Both `accepted` and `withdrawn_by_owner` map to `{status:"already_accepted"}` ("Zapytanie zaakceptowane — zadzwoń do gospodarza"); for a withdrawn request "accepted" is slightly misleading. `rejected` falls through to default → not_found ("Nieprawidłowy link"). Defensible MVP simplifications — owner withdrawal (S-05) and rejection UX aren't live in this slice — but worth a deliberate call. No security/data impact.
- **Fix**: Leave as-is for S-03 (out of scope); revisit copy when S-05 (withdrawal) and rejection UX land.
- **Decision**: SKIPPED — intentionally deferred to S-05.

## Verified clean (no action)

- Cancel token never leaks — bare `.insert()` (index.ts:64); token travels only via the email link; submit response is `{ok:true}`.
- All guest data escaped before email HTML (booking.ts:93-101), proven by tests/unit/booking.test.ts.
- `/anuluj` GET is side-effect-free (anuluj.astro:11-13) — no DB call.
- Email path is best-effort/non-blocking (index.ts:77-124, single try/catch + waitUntil).
- Migration is additive (`NOT NULL DEFAULT gen_random_uuid()`), backwards-compatible, regression-tested.
- Lock-order lesson honored — cancel RPC locks only the request row, never touches zagroda_id/turnus_id/trip_date (test (e)).
- `booking_requests_set_updated_at` trigger confirmed present & BEFORE UPDATE — cancel RPC's reliance on it is correct.
- `vitest.config.ts` change is the necessary `@/*` alias for Phase 2 unit tests — not scope creep.
