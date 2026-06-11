# Owner Undo Acceptance (S-05) — Plan Brief

> Full plan: `context/changes/owner-undo-acceptance/plan.md`

## What & Why

The owner can withdraw a previously accepted booking request (teachers often cancel by phone), which immediately frees the day's capacity for other acceptances and emails the teacher a withdrawal notice. This closes the booking-request state machine (FR-016) — without it, a phone cancellation leaves seats locked forever and information out of sync.

## Starting Point

S-04 shipped the full accept/reject flow: atomic `accept_booking_request` with the overbooking guard, `reject_booking_request`, decision emails through the F-02 outbox, and the owner dashboard (`/dashboard/zapytania`). The `withdrawn_by_owner` enum value already exists as a placeholder; nothing can reach it yet. Capacity counting sums only `accepted` rows, so the status transition alone releases seats.

## Desired End State

On an accepted request's detail page, the owner taps "Cofnij akceptację", confirms inline, and the request flips to a distinct "Wycofane" badge. A previously over-limit request can be accepted immediately afterwards. The teacher receives a Polish final-notice email within 5 minutes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Lock scope of withdraw function | Request-row lock only (no zagroda lock) | Withdrawal only releases capacity, so it can't cause overbooking; single lock can't deadlock with accept's zagroda→request order. |
| Badge presentation | Distinct "Wycofane" label, kept in the "Anulowane" filter tab | Owner can distinguish their withdrawal from a guest cancellation without crowding the mobile filter bar. |
| Past-date withdrawals | Allowed anytime, no date guard | Simplest SQL, lets owners correct history; capacity for past dates is irrelevant. |
| Email content | Plain final notice mirroring the rejection email (no reply-to, no links) | Consistent with the S-04 decision-email pattern; the phone conversation already happened. |
| Confirmation UX | Inline two-tap confirm, like reject | Reuses the proven RequestDecision pattern; protects an irreversible action. |
| Reason field | None | FR-016 doesn't require it; keeps schema untouched and the flow fast. |
| Action placement | Detail page only | Mirrors accept/reject — owner sees full context before a consequential action. |
| Test depth | Full: semantics matrix + US-01 capacity-release proof + concurrency races | US-01 explicitly demands the release proof; this is the first mutator exercising the `accepted` state. |

## Scope

**In scope:** `withdraw_booking_request` SECURITY DEFINER function; DB tests (matrix, US-01 proof, races); `POST /api/booking-request/withdraw`; `buildWithdrawalEmail` + unit tests; corrected guest-cancel copy for withdrawn requests (`cancel.ts` + `CancelRequest.tsx` — deferred from S-04 impl review); decision-island extension for accepted requests; "Wycofane" badge; production deploy + smoke.

**Out of scope:** reason field, date guards, reply-to/rebooking links, list-card actions, new filter tab, re-accepting withdrawn requests, any new guest-side UI surface.

## Architecture / Approach

Mirror the proven S-04 three-layer pattern: a SECURITY DEFINER transition primitive modeled on `reject_booking_request` (ownership check before soft outcomes, single row lock), an API route modeled on `reject.ts` that enqueues the email via the F-02 outbox (durable, best-effort, never fails the response), and a UI extension of the existing `RequestDecision` island — the detail page's island mount gate widens from `pending` to also `accepted`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DB primitive + proofs | `withdraw_booking_request` + semantics/US-01/race tests | Race-test flakiness; lock-order subtleties |
| 2. API route + email | `/api/booking-request/withdraw` + `buildWithdrawalEmail` | Error-mapping drift from the reject template |
| 3. UI + deploy | Withdraw action, "Wycofane" badge, prod deploy + smoke | Island mount-gate change regressing the pending flow |

**Prerequisites:** S-04 and F-02 are deployed (both done); local Supabase for DB tests.
**Estimated effort:** ~2-3 sessions across 3 phases — each layer is a close mirror of an existing, tested pattern.

## Open Risks & Assumptions

- A concurrent accept that read occupancy just before a withdraw commits will conservatively block — accepted as correct-but-conservative behavior (owner retries).
- ~~Assumes `RequestDecision.tsx` can branch cleanly on initial status~~ Resolved by plan review: the island needs an `initialStatus` prop and a widened action union — the exact refactor is named in Phase 3 of the full plan.

## Success Criteria (Summary)

- US-01 proof passes: accept A → B blocked → withdraw A → B accepted (automated DB test + manual UI check).
- Teacher receives the withdrawal email within 5 minutes in production.
- Withdrawn requests show "Wycofane" and offer no further actions; the pending accept/reject flow is unchanged.
