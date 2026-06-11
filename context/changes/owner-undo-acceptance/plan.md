# Owner Undo Acceptance (S-05) Implementation Plan

## Overview

Implement FR-016: the owner can withdraw a previously accepted booking request (e.g., the teacher cancelled by phone). The transition `accepted → withdrawn_by_owner` immediately frees the day's capacity for subsequent acceptances, and the teacher receives a final-notice email about the withdrawal.

## Current State Analysis

- The `request_status` enum already contains `withdrawn_by_owner` (placeholder since F-01): `supabase/migrations/20260605090307_domain_schema.sql:9-15`. No schema change is needed — only a new transition function.
- Capacity counting in `accept_booking_request` sums only `status='accepted'` rows on `(zagroda_id, trip_date)` (`supabase/migrations/20260605094725_accept_booking_request.sql:76-81`, backed by partial index `booking_requests_accepted_per_day_idx`). The status transition alone releases capacity — no occupancy math in the withdraw path.
- `booking_requests` has **no UPDATE RLS policies**; all state transitions go through SECURITY DEFINER functions. The owner-driven template is `reject_booking_request` (`supabase/migrations/20260611100000_reject_booking_request.sql:19-75`): ownership check before any state-dependent outcome, request-row lock only, soft outcomes for non-eligible states, EXECUTE granted to `authenticated` only.
- The API template is `src/pages/api/booking-request/reject.ts` (guard chain → RLS context pre-fetch → RPC → error mapping → email enqueue). Decision emails go through `enqueueDecisionEmail` (`src/lib/booking-decision.ts:14-22`) into the F-02 outbox (durable, <5 min, max 5 retries).
- UI: `src/pages/dashboard/zapytania/[id].astro` mounts the `RequestDecision.tsx` island **only when `status='pending'`** — withdrawal needs the island mounted for `accepted` too. `StatusBadge.tsx` currently renders `withdrawn_by_owner` identically to `cancelled_by_guest` ("Anulowane", gray). `RequestsList.tsx` already groups both statuses under the "Anulowane" filter tab.

## Desired End State

An owner viewing an accepted request at `/dashboard/zapytania/[id]` sees a "Cofnij akceptację" action with an inline two-tap confirm. Confirming transitions the request to `withdrawn_by_owner`, the day's occupancy drops immediately (a previously over-limit request can now be accepted), and the teacher receives a Polish final-notice email within 5 minutes. Withdrawn requests show a distinct "Wycofane" badge and remain in the "Anulowane" filter tab.

**Verify by**: the US-01 proof — accept A (fills limit), attempt accept B (blocked with FR-014 message), withdraw A, accept B again (succeeds).

### Key Discoveries:

- Enum value `withdrawn_by_owner` already exists — migration adds only a function (`supabase/migrations/20260605090307_domain_schema.sql:9-15`).
- `reject_booking_request` is the exact pattern to mirror: ownership-before-state-check, single request-row lock, soft outcomes (`supabase/migrations/20260611100000_reject_booking_request.sql`).
- Withdrawal only *releases* capacity, so it does not need the zagroda lock that accept takes — a single request-row lock cannot deadlock with accept's zagroda→request order (lessons.md lock-order contract).
- `[id].astro` conditionally mounts the decision island on `status='pending'` — this gate must widen to `accepted`.
- `updated_at` is maintained by trigger (`20260605123000`); the function must touch only `status` (zagroda_id/turnus_id/trip_date are load-bearing immutables per lessons.md).

## What We're NOT Doing

- No reason field — the withdrawal is a bare transition; the email is a fixed template (decided in planning).
- No date guard — withdrawal is allowed for past trip dates too (history correction; capacity for past dates is irrelevant).
- No reply-to or rebooking links in the email — plain final notice mirroring the rejection email.
- No withdraw action on list cards — detail page only.
- No new filter tab — "Wycofane" badge lives inside the existing "Anulowane" filter group.
- No re-acceptance of withdrawn requests — `withdrawn_by_owner` is terminal (PRD workflow).
- No new guest-side UI surface — the teacher is notified by email only (no guest account in MVP). Exception: the existing `/anuluj` cancel page gets corrected copy for withdrawn requests (Phase 2), because S-05 makes that state reachable.

## Implementation Approach

Mirror the proven S-04 three-layer pattern exactly: (1) a SECURITY DEFINER transition primitive modeled on `reject_booking_request`, proven by DB tests including the US-01 capacity-release proof and a concurrency race; (2) an API route modeled on `reject.ts` plus a `buildWithdrawalEmail` builder modeled on `buildRejectionEmail`; (3) UI extension of the existing decision island and badge component, then deploy with migrations-before-worker.

## Critical Implementation Details

- **Lock scope**: `withdraw_booking_request` locks ONLY the request row (`FOR UPDATE OF br`), like reject — NOT the zagroda row. Rationale: withdrawal strictly decreases occupancy, so it can never cause overbooking; a concurrent accept that read occupancy before the withdraw commits is merely conservative (may block an acceptance that would now fit — the owner retries). Taking the zagroda lock here would add contention for zero correctness gain. A single-lock function cannot form a deadlock cycle with accept's zagroda→request order.
- **Island mount gate**: the withdraw button only renders if `[id].astro` mounts `RequestDecision` for `status='accepted'`. Today the island is mounted only for `pending` and has no extension point: `Props` is `{ id }` only, the initial state is hardcoded (`useState<RequestStatus>("pending")`), and the action union `"accept" | "reject"` appears in three places (`submitting` state, `decide()`, button gate). Phase 3 names the exact refactor. Bonus: `TERMINAL_COPY` in `[id].astro:65` already contains withdrawn copy ("Akceptacja tego zapytania została wycofana.") — reuse it, don't re-invent.

## Phase 1: DB primitive + proofs

### Overview

Add the `withdraw_booking_request` SECURITY DEFINER function and prove its semantics, the capacity-release behavior (US-01), and concurrency safety with DB tests.

### Changes Required:

#### 1. Withdraw transition function

**File**: `supabase/migrations/20260611150000_withdraw_booking_request.sql`

**Intent**: Atomic owner-driven transition `accepted → withdrawn_by_owner`, mirroring `reject_booking_request`'s structure (ownership check before state-dependent outcomes, request-row lock only, soft outcomes).

**Contract**: `public.withdraw_booking_request(request_id uuid) returns table (withdrawn boolean, status public.request_status)`, `security definer`, `set search_path = ''`. Behavior: lock the request row `FOR UPDATE OF br` while reading status + ownership (EXISTS against `zagrody.owner_id = auth.uid()`); raise `P0002` if the request doesn't exist; raise `42501` if the caller isn't the owner (checked BEFORE any state-dependent return, so foreign owners can't probe states); if `status='accepted'`, update only `status` to `'withdrawn_by_owner'` and return `(true, 'withdrawn_by_owner')`; otherwise return `(false, <current status>)` as a soft outcome. `REVOKE EXECUTE FROM public, anon; GRANT EXECUTE TO authenticated`. Never touches `zagroda_id`, `turnus_id`, `trip_date` (lessons.md immutables); `updated_at` is handled by the existing trigger. No zagroda lock (see Critical Implementation Details).

#### 2. DB test suite for withdraw

**File**: `tests/db/withdraw.test.ts`

**Intent**: Prove the primitive's semantics matrix, the US-01 capacity-release guarantee, and race safety. Follow the harness/style of `tests/db/reject.test.ts` and `tests/db/concurrency.test.ts`.

**Contract**: Covers — (a) from `accepted` → `(true, withdrawn_by_owner)`; (b) soft outcomes from `pending`, `rejected`, `cancelled_by_guest`, `withdrawn_by_owner` (idempotent re-withdraw) → `(false, <status>)` with row unchanged; (c) non-owner caller → error 42501 regardless of status; (d) unknown id → P0002; (e) anon caller → permission denied (no EXECUTE grant — copy the proven pattern from `tests/db/reject.test.ts` case (e)); (f) **race**: withdraw vs accept-of-another-request racing on the same zagroda/day over ~20 iterations — invariant: sum of accepted participants never exceeds `daily_limit`, and each withdraw-then-accept interleaving ends in a consistent state; plus withdraw racing reject on the same request — exactly one wins, the loser gets a soft outcome.

#### 3. Upgrade the existing capacity-release proof to the real function

**File**: `tests/db/acceptance-rule.test.ts`

**Intent**: The US-01 proof (accept A fills limit → accept B blocked → withdraw A → accept B succeeds) already exists as case (d) "freed seats" (`tests/db/acceptance-rule.test.ts:111-134`), but it simulates withdrawal via a direct admin UPDATE with a comment deferring to S-05. Replace the simulation with a real `withdraw_booking_request` call so the PRD-mandated proof exercises the actual primitive — no duplicate proof in `withdraw.test.ts`.

**Contract**: Case (d) calls the new RPC as the owner instead of the admin UPDATE; assertions unchanged. Remove the "simulate with a direct admin UPDATE" comment.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly from scratch: `npm run db:reset`
- New and upgraded DB tests pass: `npx vitest run tests/db/withdraw.test.ts tests/db/acceptance-rule.test.ts`
- Existing suite unaffected: `npm run test`

#### Manual Verification:

- SQL reviewed against the lessons.md lock-order rule: function touches only `status`, takes no zagroda lock, single-row lock cannot deadlock with accept.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: API route + withdrawal email

### Overview

Expose the primitive at `POST /api/booking-request/withdraw` and notify the teacher with a plain final-notice email through the F-02 outbox.

### Changes Required:

#### 1. Withdrawal email builder

**File**: `src/lib/booking.ts`

**Intent**: Add `buildWithdrawalEmail(ctx)` mirroring `buildRejectionEmail` (src/lib/booking.ts:198-212): Polish, HTML-escaped, final-state notification.

**Contract**: Same context shape as the rejection builder (guest name/email, zagroda name, trip_date, turnus label, participants). Subject: `Rezerwacja wycofana — {zagroda_name}`. Body states the owner withdrew the previously confirmed booking; no reply-to, no links.

#### 2. Withdraw API route

**File**: `src/pages/api/booking-request/withdraw.ts`

**Intent**: Owner-facing endpoint mirroring `src/pages/api/booking-request/reject.ts` end to end.

**Contract**: `POST` with body `{ id: uuid }`. Guard chain: Supabase configured (503) → `locals.user` (401) → `user.email_confirmed_at` (409, FR-006). Pre-fetch request context via RLS-scoped session client (null → 404). Call `supabase.rpc("withdraw_booking_request", { request_id })`. Error mapping: `P0002` → 404, `42501` → 403, other → 500. `withdrawn=false` → 409 `{ error: "To zapytanie nie jest już zaakceptowane — odśwież stronę", status }`. `withdrawn=true` → enqueue `buildWithdrawalEmail` via `enqueueDecisionEmail` (best-effort, never fails the response) → 200 `{ ok: true, status: "withdrawn_by_owner" }`.

#### 3. Correct guest-cancel copy for withdrawn requests

**Files**: `src/pages/api/booking-request/cancel.ts`, `src/components/booking/CancelRequest.tsx`

**Intent**: S-05 makes `withdrawn_by_owner` reachable, which exposes a copy mismatch deferred from the S-04 impl review: `cancel.ts:48` maps `withdrawn_by_owner` into the same `already_accepted` response as `accepted`, so a teacher who clicks their old cancel link after receiving the withdrawal email would see "zapytanie zaakceptowane — zadzwoń do gospodarza" — the opposite of the truth.

**Contract**: Split the switch case: `withdrawn_by_owner` → `{ status: "already_withdrawn" }`. Extend the `CancelStatus` union and copy map in `CancelRequest.tsx` with `already_withdrawn` → message that the acceptance was already withdrawn by the host and no action is needed (e.g. "Akceptacja tej rezerwacji została już wycofana przez gospodarza — nie musisz nic robić."). No SQL change — `cancel_booking_request` already treats withdrawn as a soft no-op.

#### 4. Email builder unit tests

**File**: `tests/unit/booking.test.ts`

**Intent**: Extend the existing builder tests to cover `buildWithdrawalEmail` — subject format, Polish body content, HTML escaping of guest/zagroda fields, absence of reply-to and links.

**Contract**: Same test style as the acceptance/rejection builder cases already in this file.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run tests/unit/booking.test.ts`
- Full suite passes: `npm run test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- Local end-to-end: withdraw an accepted request via `POST /api/booking-request/withdraw` and confirm an `email_outbox` row is enqueued with correct subject/recipient and the response is `200 { ok: true, status: "withdrawn_by_owner" }`.
- Repeat call returns 409 with the stale-state message.
- Guest cancel link (`/anuluj?token=…`) for a withdrawn request shows the "already withdrawn" copy, not "already accepted".

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: UI + deploy

### Overview

Surface the withdraw action on the request detail page with an inline two-tap confirm, distinguish the "Wycofane" badge, and ship to production (migrations before worker).

### Changes Required:

#### 1. Mount decision island for accepted requests

**File**: `src/pages/dashboard/zapytania/[id].astro`

**Intent**: Widen the island mount gate from `status === 'pending'` to also include `'accepted'`, passing the initial status to the island so it can branch its UI.

**Contract**: `RequestDecision` receives the request `id` and initial `status`; for terminal statuses the page keeps its current badge + explanatory card (no island).

#### 2. Withdraw action in the decision island

**File**: `src/components/booking/RequestDecision.tsx`

**Intent**: When the initial status is `accepted`, render a single "Cofnij akceptację" action with the same inline two-tap confirm pattern reject uses ("Na pewno cofnąć akceptację?"), posting to `/api/booking-request/withdraw`.

**Contract**: Concrete refactor (the component has no extension point today): extend `Props` from `{ id }` to `{ id, initialStatus }`; initialize `useState<RequestStatus>(initialStatus)` instead of the hardcoded `"pending"`; widen the action union `"accept" | "reject"` to include `"withdraw"` in its three occurrences (`submitting` state, `decide()`, and the button gate — which becomes per-status: `pending` → accept/reject buttons, `accepted` → withdraw button). UI states mirror the existing ones — submitting spinner; success green card "Wycofano — nauczyciel dostanie e-mail"; 409 stale → amber card with the server message ("…odśwież stronę"); network/500 → red error card. When initial status is `pending`, behavior is unchanged (accept/reject).

#### 3. Distinct badge label

**File**: `src/components/booking/StatusBadge.tsx`

**Intent**: Give `withdrawn_by_owner` its own label "Wycofane" (keep the gray/neutral styling), so the owner can distinguish their withdrawal from a guest cancellation.

**Contract**: Label-map change only; `RequestsList.tsx`'s "Anulowane" filter tab continues to group `cancelled_by_guest || withdrawn_by_owner` (verify no behavior change needed there).

#### 4. Production deploy + smoke

**File**: (no code — process step)

**Intent**: Ship per the lessons.md deploy rule: `npm run deploy` (build → `supabase db push` → `wrangler deploy`), never bare `wrangler deploy`. The migration is additive (new function only), so the old worker stays safe during the window.

**Contract**: Post-deploy smoke on production: accept a test request, withdraw it via the UI, confirm the withdrawal email arrives (<5 min) and the badge reads "Wycofane".

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Full suite passes: `npm run test`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Local UI flow: accepted request shows "Cofnij akceptację"; two-tap confirm withdraws; success card shown; badge/list show "Wycofane" under the "Anulowane" filter; pending requests still show accept/reject unchanged.
- Local capacity check: previously over-limit request becomes acceptable after the withdrawal (US-01, via UI).
- Production smoke after `npm run deploy`: withdrawal works end-to-end and the teacher email arrives within 5 minutes.

---

## Testing Strategy

### Unit Tests:

- `buildWithdrawalEmail`: subject, Polish body, HTML escaping, no reply-to/links (`tests/unit/booking.test.ts`).

### Integration Tests (DB):

- Semantics matrix: every from-status, non-owner (42501), unknown id (P0002), anon denied (`tests/db/withdraw.test.ts`).
- US-01 capacity-release proof: accept A → B blocked → withdraw A → B accepted — lives in `tests/db/acceptance-rule.test.ts` case (d), upgraded from the admin-UPDATE simulation to the real `withdraw_booking_request` call.
- Races: withdraw vs accept on same zagroda/day (~20 iterations, occupancy invariant holds); withdraw vs reject on same request (one winner, soft outcome for the loser).

### Manual Testing Steps:

1. Accept a request that fills the daily limit; verify a second request is blocked with the FR-014 message.
2. Withdraw the first request via the detail page (two-tap confirm); verify success card and "Wycofane" badge.
3. Accept the second request — it must now succeed.
4. Verify the teacher received the withdrawal email (local outbox; production: real inbox <5 min).
5. Verify a withdrawn request shows no actions on the detail page and sits under the "Anulowane" filter.

## Performance Considerations

None beyond existing patterns — the function takes a single row lock and does no aggregate reads; the partial occupancy index already excludes withdrawn rows from accept's capacity scan.

## Migration Notes

Additive only: one new function, no table/enum changes (enum value pre-exists). Old worker remains compatible during the deploy window; `wrangler rollback` stays safe. Deploy must run `supabase db push` before `wrangler deploy` (`npm run deploy` — lessons.md rule).

## References

- PRD: FR-016, US-01 (`context/foundation/prd.md`)
- Roadmap slice S-05 (`context/foundation/roadmap.md:143-153`)
- Pattern source — reject primitive: `supabase/migrations/20260611100000_reject_booking_request.sql`
- Pattern source — accept primitive & capacity scan: `supabase/migrations/20260605094725_accept_booking_request.sql:48-93`
- Pattern source — API route: `src/pages/api/booking-request/reject.ts`
- Pattern source — email builders: `src/lib/booking.ts:178-212`
- Lock-order & deploy rules: `context/foundation/lessons.md`
- S-04 archived plan: `context/archive/2026-06-11-gated-acceptance-with-overbooking-guard/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB primitive + proofs

#### Automated

- [x] 1.1 Migrations apply cleanly from scratch: `npm run db:reset`
- [x] 1.2 New and upgraded DB tests pass: `npx vitest run tests/db/withdraw.test.ts tests/db/acceptance-rule.test.ts`
- [x] 1.3 Existing suite unaffected: `npm run test`

#### Manual

- [x] 1.4 SQL reviewed against lessons.md lock-order rule (status-only update, no zagroda lock)

### Phase 2: API route + withdrawal email

#### Automated

- [ ] 2.1 Unit tests pass: `npx vitest run tests/unit/booking.test.ts`
- [ ] 2.2 Full suite passes: `npm run test`
- [ ] 2.3 Lint passes: `npm run lint`
- [ ] 2.4 Type check passes: `npx astro check`

#### Manual

- [ ] 2.5 Local withdraw via API enqueues outbox email and returns 200 with withdrawn status
- [ ] 2.6 Repeat call returns 409 stale-state message
- [ ] 2.7 Guest cancel link for a withdrawn request shows "already withdrawn" copy

### Phase 3: UI + deploy

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Type check passes: `npx astro check`
- [ ] 3.3 Full suite passes: `npm run test`
- [ ] 3.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.5 Local UI flow: two-tap withdraw, success card, "Wycofane" badge, pending flow unchanged
- [ ] 3.6 Local capacity check: over-limit request acceptable after withdrawal (US-01 via UI)
- [ ] 3.7 Production smoke after `npm run deploy`: end-to-end withdraw + teacher email <5 min
