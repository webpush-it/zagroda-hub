<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Owner Undo Acceptance (S-05)

- **Plan**: context/changes/owner-undo-acceptance/plan.md
- **Scope**: Full plan (3 of 3 phases)
- **Date**: 2026-06-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Drift sweep: 10/10 planned items MATCH, 0 DRIFT, 0 MISSING, 0 EXTRA. Off-plan diff file `src/db/database.types.ts` is a clean type regeneration (only the `withdraw_booking_request` signature). All "What We're NOT Doing" guardrails respected. Automated criteria green this session (lint, astro check, vitest 120/120, build); manual 3.5–3.7 evidenced (local Playwright run + user-confirmed production smoke).

## Findings

### F1 — Success copy "dostanie e-mail" shown even if outbox enqueue fails

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/booking-request/withdraw.ts:72
- **Detail**: After a successful RPC, `enqueueDecisionEmail` is best-effort (failure → console.error only, response stays 200) and the UI unconditionally shows "Wycofano — nauczyciel dostanie e-mail". The F-02 outbox retry (max 5, cron */5) covers everything *after* enqueue — the risk window is solely a failed outbox INSERT. Plan-compliant ("best-effort, never fails the response") and identical to accept/reject, but the consequence is heavier for withdrawal (teacher may travel to a cancelled stay).
- **Fix**: Return an `email_enqueued` flag from the API and, when false, show "skontaktuj się z nauczycielem telefonicznie" instead of the email promise (apply consistently to accept/reject/withdraw).
- **Decision**: SKIPPED — risk accepted for MVP (withdrawal typically follows the teacher's own phone call; the realistic trigger — broken worker secret — breaks all emails loudly and is already covered by a lesson).

### F2 — `data.at(0)` assumes non-null data when rpcError is null

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/booking-request/withdraw.ts:63
- **Detail**: A null `data` with null `rpcError` would throw an unhandled 500. Inherited 1:1 from reject.ts:63 and cancel.ts:39 — not a regression of this change.
- **Fix**: `data?.at(0)` with an explicit 500 mapping across the three routes (one follow-up commit).
- **Decision**: FIXED — cancel.ts upgraded from unguarded `data[0]` to `data.at(0)` + `if (!row) → 500`. withdraw.ts/reject.ts already had the empty-array guard; the `?.` variant was rejected by `@typescript-eslint/no-unnecessary-condition` (Supabase types guarantee non-null data when error is null), so they stay as-is. Lint, astro check, and full suite (120/120) green after the fix.

### F3 — Withdraw button requires page reload after an in-session accept

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency (UX)
- **Location**: src/components/booking/RequestDecision.tsx:75
- **Detail**: The `initialStatus === "accepted"` gate means that right after accepting in the same session, "Cofnij akceptację" does not appear until reload. Deliberate and commented, matching the plan's "initial status" contract and keeping the pending flow unchanged — but a mis-click accept is most likely to need undoing in exactly that session.
- **Fix**: Also show the withdraw button after a successful in-session accept (gate on `status === "accepted"` alone).
- **Decision**: FIXED — gate simplified to `status === "accepted"`; the withdraw button now appears immediately after an in-session accept (alongside the green success card). `initialStatus` prop retained for state initialization. Lint and astro check green.

### F4 — Detail-page SELECT error renders as 404

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/zapytania/[id].astro:33
- **Detail**: Destructuring only `{ data }` discards `error`; a transient DB failure shows "Zapytanie nie istnieje" instead of an error state. Pre-existing pattern; phase 3 only widened the island mount gate.
- **Fix**: Distinguish select error from not-found (separate copy/500) — follow-up outside S-05 scope.
- **Decision**: SKIPPED — pre-S-05 debt, low cost of failure (misleading copy during a transient DB outage); to be picked up with a broader error-handling pass.

## Strengths

- Migration is a faithful mirror of `reject_booking_request` with a correct added rationale for taking no zagroda lock (occupancy strictly decreases; single lock cannot deadlock with accept's zagroda→request order).
- Race suites (withdraw vs accept over 20 iterations with occupancy invariant; withdraw vs reject same-row serialization) exceed the sibling test's coverage.
- US-01 proof in acceptance-rule.test.ts now exercises the real primitive instead of an admin UPDATE simulation.
