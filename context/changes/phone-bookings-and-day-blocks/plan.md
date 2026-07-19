# Phone Bookings & Day Blocks (S-08) Implementation Plan

## Overview

Owner can add a manual phone booking (date, turnus, participant count, optional note) and block/unblock whole days — both consuming/zeroing capacity through the **same anti-overbooking rule** as app acceptances ("exactly one success" under concurrency). Deleting an entry or block releases capacity immediately. Every booking shows its source (app / phone). Roadmap S-08 — the package's north star; PRD refs FR-021, FR-022, FR-023, FR-028, FR-031, US-03.

## Current State Analysis

- **Acceptance core**: `accept_booking_request(request_id)` in `supabase/migrations/20260605094725_accept_booking_request.sql` — SECURITY DEFINER, documented lock-order contract: zagroda row `FOR UPDATE` first (serializes all acceptances per zagroda + ownership check, `42501`), request row second (`55000` if not pending). Occupancy = `SUM(participants_count) WHERE status='accepted'` for `(zagroda_id, trip_date)` across all turnusy (limit is per day). Over-limit is a **soft return** `(accepted=false, occupied, daily_limit, requested)`, not an error. Grandfathering: never assumes `sum <= limit` holds on entry.
- **Capacity release is implicit**: no ledger — `withdraw_booking_request` (`20260611150000`) just flips `accepted → withdrawn_by_owner` locking **only the request row** (decreasing demand can't overbook; header comment documents why this can't deadlock with accept's zagroda→request order).
- **Second availability surface**: `catalog_zagrody` RPC (`20260607090000_catalog_zagrody.sql:46-59`) mirrors the same sum for the catalog's `is_available`. Any new demand source must be counted in **both** places or the guarantee splits across channels.
- **Schema**: `booking_requests` has NO `source`/`note`; `guest_name/email/phone` are `NOT NULL`; no UPDATE/DELETE policies (all transitions via RPCs); anon INSERT policy checks only `status='pending'`. Partial index `booking_requests_accepted_per_day_idx (zagroda_id, trip_date) WHERE status='accepted'` is the read path. No day-block concept exists anywhere.
- **Concurrency proof**: `tests/db/concurrency.test.ts` — 20 iterations, two owner clients race `accept_booking_request` on 20+15 vs limit 30; asserts exactly one success AND that the loser observed the winner's seats (`loser.occupied === winner.requested`). Roadmap requires **extending** with a manual-entry mix, not replacing.
- **Panel**: `/dashboard/zapytania` (`src/pages/dashboard/zapytania/index.astro`) SSR-queries the owner's requests → `RequestsList.tsx` (filter chips, row cards); detail page mounts `RequestDecision.tsx` (fetch to `/api/booking-request/{accept|reject|withdraw}`, pgcode→HTTP mapping `P0002`→404 / `42501`→403 / `55000`→409, inline expand-to-confirm for destructive actions, no modals). Forms share one zod schema client+server (`src/lib/booking.ts`). All copy Polish, 44 px tap targets, single column.
- **Lessons.md constraints**: `booking_requests.zagroda_id` (and `turnus_id`, `trip_date` of accepted rows) are load-bearing immutables — new write paths must never touch them. Every deploy with a migration goes `supabase db push` → `wrangler deploy` (`npm run deploy`); migrations stay additive/backwards-compatible.

## Desired End State

Owner opens `/dashboard/zapytania` on their phone, taps "Dodaj rezerwację telefoniczną", fills date + turnus + participant count (+ optional note), and sees the entry in the same list with a "Telefon" badge — in under 15 s one-handed. A colliding acceptance of an app request is then refused with the existing "X z Y zajęte, Z wymaga miejsca" message. Owner can block a day: the day stops accepting new guest requests (form shows a clear message), blocks acceptances, and shows as unavailable in the catalog availability filter. Removing an entry (soft) or a block releases capacity instantly. The extended concurrency test proves "exactly one success" for the manual-entry + acceptance mix.

### Key Discoveries:

- Increasing demand ⇒ take zagroda `FOR UPDATE` first; decreasing demand ⇒ single-row lock only (`20260611150000_withdraw_booking_request.sql:6-13` documents the contract) — `create_manual_booking` and `block_day` are increases, entry-removal and `unblock_day` are decreases.
- `withdraw_booking_request` works **unchanged** on a manual entry (it's just an `accepted` row) — entry deletion reuses it; only the API route's email step must become conditional (phone rows have no guest e-mail).
- `CREATE OR REPLACE FUNCTION` cannot change OUT-parameters — extending `accept_booking_request`'s return table (new `day_blocked` column) requires `DROP FUNCTION` + recreate in the migration.
- The blocked-day guard for anon guest inserts must be a SECURITY DEFINER trigger function — anon has no SELECT on `day_blocks`, so an invoker-rights check would silently see zero rows. Precedent: `zagrody_guard_is_published` trigger (`20260605200000`).
- The anon/auth INSERT policy (`with check (status='pending')`, `domain_schema.sql:137-143`) must additionally pin `source='app'` so direct inserts can never forge phone entries; owner phone entries bypass RLS via the SECURITY DEFINER RPC.

## What We're NOT Doing

- No calendar / single-day view (PRD Non-Goal; list + entries suffice).
- No availability week-template ("rytm tygodnia") — parked v2.
- No new e-mail types; no e-mails for manual entries or blocks (channel unchanged, FR guardrail).
- No auto-rejection of pending requests when a day gets blocked (decision 2026-07-19: they stay pending, acceptance blocked, owner rejects manually).
- No per-turnus blocks — a block covers the whole day, consistent with the per-day limit.
- No changes to guest flow states, cancel tokens, existing mail content (FR-029), catalog filters (FR-030), or the role model.
- No editing of manual entries — remove + re-add (matches the no-UPDATE posture on `booking_requests`).

## Implementation Approach

Extend `booking_requests` with `source`/`note` (decision: no separate table — the occupancy sum stays a single-table query on the existing partial index, and list/withdraw machinery is reused). Manual entries are rows born as `status='accepted'`, `source='phone'`, null guest contact. Day blocks are a new `day_blocks` table (semantics "day off" ≠ "day full", per PRD Socrates note). All writes go through new SECURITY DEFINER functions following the repo's exact conventions (search_path='', revoke/grant, P0002/42501/55000, soft domain outcomes). Both availability surfaces (`accept_booking_request`, `catalog_zagrody`) learn about blocks; the accept sum needs no change (manual entries are already `accepted` rows). Three phases: DB core → API → UI, each independently verifiable; the DB phase carries the concurrency proof.

## Critical Implementation Details

**Lock ordering** — `create_manual_booking` and `block_day` MUST take the zagroda row `FOR UPDATE` before reading `day_blocks`/summing occupancy (same serialization point as accept). `unblock_day` and entry removal must NOT take the zagroda lock (decreasing demand; single-row/plain-delete, per the withdraw contract). Never touch `zagroda_id`/`turnus_id`/`trip_date` of existing rows (lessons.md immutability contract).

**Deploy-window compatibility** — the old worker may briefly run against the new schema (migrations push first). This is safe here: the new `accept_booking_request` return column is ignored by old code, and no `day_blocks` rows can exist before the UI (Phase 3) ships. Do not reorder: the `accept.ts` change (handling `day_blocked`) lands in Phase 2, before any UI can create blocks.

**Return-type change** — the migration must `DROP FUNCTION public.accept_booking_request(uuid)` then recreate (OUT params change). Regenerate `src/db/database.types.ts` (`npm run db:types`) in Phase 2 before touching TS callers.

**Timezone** — "today-or-future" validation for entries/blocks follows the existing convention: zod validates in the browser/worker (`src/lib/booking.ts` `todayISO` pattern); SQL functions compare against `current_date` only as defense-in-depth. `trip_date`/`blocked_date` stay bare DATEs.

## Phase 1: Schema + core rule (DB layer)

### Overview

One migration delivering the whole data model and rule extension, plus the DB test suite extension that proves the cross-channel guarantee. After this phase the guarantee already holds at the SQL layer — nothing user-visible yet.

### Changes Required:

#### 1. Migration: manual bookings + day blocks

**File**: `supabase/migrations/<timestamp>_manual_bookings_and_day_blocks.sql`

**Intent**: Add booking source + note to `booking_requests`, create `day_blocks`, extend the acceptance rule to refuse blocked days, and add the four new write paths — all in one additive migration.

**Contract** (in order):

1. `create type public.booking_source as enum ('app','phone')` (all values up front, mirroring `request_status`). Add to `booking_requests`: `source public.booking_source not null default 'app'` (backfills existing rows as 'app'), `note text` with `check (char_length(note) <= 500)`.
2. Drop NOT NULL on `guest_name`, `guest_email`, `guest_phone`; add table CHECK: `source = 'phone' OR (guest_name is not null and guest_email is not null and guest_phone is not null)` — app rows keep full contact, phone rows may be contact-free.
3. Recreate **both** INSERT policies on `booking_requests` — `"anyone can submit a pending booking request (anon)"` and `"anyone can submit a pending booking request (authenticated)"` (`domain_schema.sql:137-143`) — each with `with check (status = 'pending' and source = 'app')`. Recreating only one would leave the other role able to forge phone entries.
4. `create table public.day_blocks (id uuid pk default gen_random_uuid(), zagroda_id uuid not null references public.zagrody(id) on delete cascade, blocked_date date not null, created_at timestamptz not null default now(), unique (zagroda_id, blocked_date))`. Enable RLS; owner-only SELECT policy (mirroring the booking-requests owner SELECT); no INSERT/DELETE policies — writes via RPC only.
5. BEFORE INSERT trigger on `booking_requests` (SECURITY DEFINER trigger function, `set search_path = ''`): if `NEW.status = 'pending'` and a `day_blocks` row exists for `(NEW.zagroda_id, NEW.trip_date)` → `raise exception 'day_blocked' using errcode = '55000'`. Guards only the guest path; RPC paths do their own soft checks.
6. `DROP FUNCTION public.accept_booking_request(uuid)` and recreate with return table extended by `day_blocked boolean`: after taking the zagroda lock (step 1) and reading the request (step 2), check `exists(select 1 from public.day_blocks ...)` for the request's date — if blocked, return `(accepted=false, day_blocked=true, occupied, daily_limit, requested)` without transitioning. Everything else identical (same header comment, same grandfathering note — extend the comment with the day-block check).
7. `create function public.create_manual_booking(p_zagroda_id uuid, p_turnus_id uuid, p_trip_date date, p_participants integer, p_note text default null) returns table (created boolean, request_id uuid, day_blocked boolean, occupied integer, daily_limit integer, requested integer)` — SECURITY DEFINER, search_path=''. Steps: lock zagroda `where id = p_zagroda_id and owner_id = (select auth.uid()) for update` (none → `42501`); `p_trip_date < current_date` → `55000`; day blocked → soft `(created=false, day_blocked=true, …)`; sum accepted participants for the day; if fits → `insert … (source='phone', status='accepted', note=p_note, guest_* null)` returning id, `created=true`; else soft `(created=false, day_blocked=false, occupied, …)`. Participant/note bounds ride on existing/new CHECKs; invalid `p_turnus_id` for this zagroda fails on the composite FK `(turnus_id, zagroda_id)` — map as a hard error, the UI select prevents it.
8. `create function public.block_day(p_zagroda_id uuid, p_blocked_date date) returns table (blocked boolean, already_blocked boolean)` — lock zagroda (ownership, `42501`); `p_blocked_date < current_date` → `55000`; `insert … on conflict (zagroda_id, blocked_date) do nothing` (idempotent).
9. `create function public.unblock_day(p_zagroda_id uuid, p_blocked_date date) returns table (unblocked boolean)` — ownership check (no zagroda lock — availability only increases); delete; `unblocked=false` when no row (soft).
10. All four functions: `revoke execute from public, anon; grant execute to authenticated` (repo convention). `catalog_zagrody`: `CREATE OR REPLACE` (return type unchanged — adding an output column would forfeit C-O-R) — the day-block check goes **inside the existing `is_available` CASE's else-arm** (fold the `EXISTS` on `day_blocks` in as `false`), keeping the `when p_trip_date is null then null` arm first: `is_available` must stay NULL without a date filter because `order by is_available desc nulls first` depends on it.

#### 2. Concurrency test extension

**File**: `tests/db/concurrency.test.ts`

**Intent**: Extend (not replace) the "exactly one success" proof with the cross-channel mix required by FR-028: `create_manual_booking(20)` racing `accept_booking_request(pending 15)` on `daily_limit 30`, 20 iterations, two independent owner clients.

**Contract**: Same assertion style as the existing test — neither RPC errors; exactly one of `created`/`accepted` is true; the loser observed the winner's seats (`loser.occupied === winner.requested`); admin-client end-state check (either one accepted app row XOR one phone row + still-pending app row). The existing accept-vs-accept test keeps passing untouched.

#### 3. New DB test suites

**File**: `tests/db/manual-bookings.test.ts` (new), `tests/db/day-blocks.test.ts` (new)

**Intent**: Prove the functional surface of the new RPCs and the block semantics end-to-end at the SQL layer, following the seeding style of `tests/db/withdraw.test.ts` (service-role fixtures, per-test fresh owner+zagroda).

**Contract** — manual bookings: entry consumes capacity (subsequent over-limit accept refused with correct `occupied`); over-limit entry refused softly with correct numbers; `withdraw_booking_request` on a phone entry flips it and frees seats instantly; foreign owner gets `42501`; past date `55000`; anon cannot call (grant check) and cannot forge `source='phone'` via direct INSERT (policy check). Day blocks: blocked day → `accept_booking_request` returns `day_blocked=true` and no transition; `create_manual_booking` soft-refused; pending INSERT raises `day_blocked` (trigger); `catalog_zagrody` reports `is_available=false` for that date and recovers after `unblock_day`; block is idempotent; blocking a day with existing accepted bookings succeeds and leaves them untouched (decision: block stops new demand only); foreign owner `42501`. **Seeding-order gotcha**: the service-role seeder bypasses RLS but NOT the new trigger — tests that need a pending request on a blocked day must seed the request **before** calling `block_day`; the trigger-rejection case is asserted separately via a direct pending insert on an already-blocked day.

#### 4. Update existing DB tests for the new return shape

**File**: `tests/db/acceptance-rule.test.ts`, `tests/db/withdraw.test.ts` (touch only if they assert exact row shape)

**Intent**: The recreated `accept_booking_request` returns an extra `day_blocked` column; adjust any exact-shape assertions. Behavior assertions must pass unchanged — if a behavioral test fails, that's a regression, not a test to edit.

**Contract**: No semantic changes to existing assertions.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh local DB: `npm run db:reset`
- Full test suite passes (incl. extended concurrency + 2 new suites): `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Sanity check via local Supabase Studio: manual entry row has `source='phone'`, null guest fields; day block visible in `day_blocks`; direct SQL `accept_booking_request` on a blocked day returns `day_blocked=true`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding. Phase blocks use plain bullets — checkbox state lives in `## Progress`.

---

## Phase 2: API routes + types

### Overview

Wire the new RPCs to the worker following the exact route conventions (auth gates, zod, pgcode mapping, soft-outcome 409s), regenerate DB types, and make the two existing routes aware of blocks/phone rows.

### Changes Required:

#### 1. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Pick up `booking_source`, `day_blocks`, the three new functions and the changed `accept_booking_request` return row.

**Contract**: `npm run db:types` (local stack running). Note: `npx astro check` is a **new gate** — nothing in scripts or CI runs it today (ci.yml: lint → build → vitest). Run it once at Phase 2 start to establish the baseline before making changes, so pre-existing errors aren't mistaken for regressions.

#### 2. Zod schemas for the new payloads

**File**: `src/lib/booking.ts`

**Intent**: Shared client+server validation for manual entries and day blocks, mirroring `bookingRequestSchema` (Polish messages, strict `YYYY-MM-DD` today-or-future date, coerced int 1–1000 participants).

**Contract**: `manualBookingSchema = { zagroda_id: uuid, turnus_id: uuid, trip_date, participants_count, note?: string ≤ 500 }`; `dayBlockSchema = { zagroda_id: uuid, blocked_date: today-or-future date }`.

#### 3. Manual-booking route

**File**: `src/pages/api/manual-booking/index.ts` (new)

**Intent**: `POST` creates a manual entry for the authenticated, email-verified owner via `rpc("create_manual_booking")`.

**Contract**: Same skeleton as `accept.ts`: 401 unauthenticated → 409 unverified e-mail → 422 zod → rpc → pgcode map (`42501`→403, `55000`→409) → soft outcomes as 409: over-limit reuses the exact FR-014 copy `Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)` with `{occupied, daily_limit, requested}`; `day_blocked` → 409 `{ code: "day_blocked" }` with Polish message. Success → `{ ok: true, id }`. **No e-mail enqueue.**

#### 4. Day-block route

**File**: `src/pages/api/day-block/index.ts` (new)

**Intent**: `POST` blocks a day (`rpc("block_day")`, idempotent success even when `already_blocked`), `DELETE` unblocks (`rpc("unblock_day")`; `unblocked=false` → 404-style soft response). Precedent for multi-method files: `zagroda/index.ts` exports `PUT`.

**Contract**: Same auth gates and pgcode mapping as above; both return `{ ok: true }` on success.

#### 5. Blocked-day handling in the guest create route

**File**: `src/pages/api/booking-request/index.ts`

**Intent**: The trigger now raises `day_blocked` (55000) for pending inserts on blocked days — map it to a friendly 409 instead of a 500.

**Contract**: Catch insert error where code `55000` / message `day_blocked` → 409 `{ code: "day_blocked", error: "Ten dzień jest niedostępny — zagroda nie przyjmuje zapytań na tę datę." }`. All other behavior (publish check, bare insert, best-effort e-mails) unchanged (FR-029).

#### 6. `day_blocked` in the accept route + null-safe e-mail blocks in all three decision routes

**File**: `src/pages/api/booking-request/accept.ts`, `src/pages/api/booking-request/reject.ts`, `src/pages/api/booking-request/withdraw.ts`

**Intent**: `accept.ts` handles the new soft outcome (`day_blocked=true` → 409 `{ code: "day_blocked" }`, Polish message "Dzień jest zablokowany — odblokuj go, aby zaakceptować."). All three routes guard their e-mail step for phone entries: after types regen the guest columns are `string | null`, and the e-mail builders (`buildAcceptanceEmail`/`buildRejectionEmail`/`buildWithdrawalEmail` in `src/lib/booking.ts`) call `escapeHtml(ctx.guest_name)` unguarded — in `withdraw.ts` the builder is evaluated **as an argument, outside `enqueueDecisionEmail`'s try/catch** (`src/lib/booking-decision.ts:20-30`), so an unguarded null would throw AFTER the DB withdraw committed (500 post-mutation).

**Contract**: In each route, wrap the **entire e-mail block (builder call + enqueue)** behind a `request.guest_email !== null` (or equivalent narrow) guard; on a phone entry withdraw the route returns success with no enqueue. `accept.ts`/`reject.ts` never process phone rows at runtime (status gate), but need the same guard for the typecheck. Existing response contracts for app rows unchanged; `RequestDecision.tsx` consumes the new `code` in Phase 3.

#### 7. API tests

**File**: `tests/api/manual-booking.test.ts` (new), extend `tests/api/booking-decision.test.ts` / `tests/api/guest-input.test.ts`

**Intent**: Cover the new routes with the existing API harness (`tests/helpers/api.ts`): auth gates (401/409/403), zod 422s, soft 409 bodies (over-limit copy, `day_blocked` code), day-block POST/DELETE round-trip, guest POST on a blocked day → 409, withdraw of a phone entry → 200 with no enqueued e-mail (brevo-mock assertion).

**Contract**: Follows `tests/api/authz.test.ts` patterns; no changes to existing passing assertions.

### Success Criteria:

#### Automated Verification:

- Types regenerate cleanly and typecheck passes: `npm run db:types && npx astro check`
- Full test suite passes: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- `curl`/REST-client smoke against local dev: manual entry via API consumes capacity (subsequent accept 409s); blocked day rejects a guest POST with the Polish message

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Panel + guest-facing UI

### Overview

Everything lands on `/dashboard/zapytania` (decision: one hub for all demand): add-entry form, block-day control with active-blocks list, source badges. Detail page learns source/note. Guest form and decision UI surface the new 409s.

### Changes Required:

#### 1. Requests list page — data + layout

**File**: `src/pages/dashboard/zapytania/index.astro`

**Intent**: SSR-fetch the extra data the new islands need and mount them above the list: owner's `turnusy` (for the entry form select), active `day_blocks` (`blocked_date >= today`, ascending), and `source` in the requests select.

**Contract**: Page keeps its single-column `PageShell` layout; order top-down: action buttons ("Dodaj rezerwację telefoniczną", "Zablokuj dzień"), active-blocks strip (only when non-empty), filter chips, list. The <15 s NFR means the form is one tap away and uses native inputs.

#### 2. Manual entry form island

**File**: `src/components/booking/ManualBookingForm.tsx` (new)

**Intent**: Collapsible (expand-in-place, no modal) form: `input type="date"` (min today), native turnus `<select>` (same option format as `BookingRequestForm`: `{label} ({start–end})`), participants number input, optional note textarea. Client zod → POST `/api/manual-booking` → on success full page reload (SSR list re-renders; matches the repo's server-truth posture). 409 over-limit and `day_blocked` render the server message in the red inline-notice pattern.

**Contract**: Uses `manualBookingSchema`, `FormField`/`FieldError`/`ServerError`, `btn-primary w-full`, 44 px targets — same idiom as `BookingRequestForm.tsx`.

#### 3. Day-blocks island

**File**: `src/components/booking/DayBlocks.tsx` (new)

**Intent**: Collapsible "Zablokuj dzień" control (date input + confirm button → POST `/api/day-block`) plus the active-blocks strip: each block a compact row with date and an "Odblokuj" action using the inline expand-to-confirm pattern from `RequestDecision.tsx` (→ DELETE `/api/day-block`). Success → page reload.

**Contract**: Props `zagrodaId`, `blocks: {blocked_date: string}[]` from SSR; no client-side fetching of block state.

#### 4. Source badge + phone rows in the list

**File**: `src/components/booking/RequestsList.tsx`

**Intent**: Rows with `source='phone'` show a "Telefon" chip (Phone lucide icon) next to `StatusBadge` and display "Wpis telefoniczny" where app rows show `guest_name`. Cancelled-filter grouping already covers soft-deleted entries (`withdrawn_by_owner`) — no filter changes.

**Contract**: `RequestRow` type gains `source` (and the page mapping passes it). Visual style follows `StatusBadge`'s chip pattern.

#### 5. Detail page — source, note, phone-entry copy

**File**: `src/pages/dashboard/zapytania/[id].astro`, `src/components/booking/RequestDecision.tsx`

**Intent**: Detail `<dl>` gains "Źródło: aplikacja/telefon"; phone rows show the note (when present) instead of the guest-contact block. `RequestDecision` gets a `source` prop: for phone entries the withdraw action reads "Usuń wpis" with confirm copy that doesn't promise a guest e-mail; it also learns the accept-route `day_blocked` 409 → amber notice "Dzień jest zablokowany — odblokuj go, aby zaakceptować."

**Contract**: Existing accept/reject/withdraw behavior and copy for app rows unchanged (FR-029/FR-031); page select adds `source, note`.

#### 6. Guest form blocked-day message

**File**: `src/components/booking/BookingRequestForm.tsx`

**Intent**: Handle the create route's 409 `{ code: "day_blocked" }` with a clear inline error on the date field area ("Ten dzień jest niedostępny — wybierz inną datę."); all other validation and flow untouched.

**Contract**: Existing error rendering paths reused; no schema change on the guest side.

### Success Criteria:

#### Automated Verification:

- Full test suite passes: `npm test`
- Typecheck passes: `npx astro check`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- On a phone (or 320–414 px viewport): add a manual entry one-handed in < 15 s from opening the panel; entry appears with "Telefon" badge
- US-03 walkthrough: entry for 20/30 → accepting a pending 15-person request is refused with "Limit dzienny przekroczony (20 z 30 zajęte, 15 wymaga miejsca)"
- Block a day → guest form on that date gets the Polish refusal; catalog availability filter hides the zagroda for that date; unblock → both recover
- Remove the manual entry ("Usuń wpis") → capacity back immediately, no e-mail sent
- Existing guest flow (request → mails → accept/reject/withdraw → cancel link) spot-checked for zero regression (FR-029)

**Implementation Note**: Pause for manual confirmation; this phase completes S-08.

---

## Testing Strategy

### Unit Tests:

- Zod schemas: `manualBookingSchema` / `dayBlockSchema` happy path + boundary cases (past date, participants 0/1001, note > 500) in the style of existing `tests/unit` coverage.

### Integration Tests:

- DB (vitest vs local Supabase): extended concurrency mix, manual-booking suite, day-blocks suite (Phase 1 §2–3).
- API harness: new-route auth gates, soft 409 contracts, blocked-day guest POST, phone-entry withdraw without e-mail (Phase 2 §7).

### Manual Testing Steps:

1. US-03 end-to-end on mobile viewport (see Phase 3 manual criteria).
2. Block/unblock round-trip observed in panel + guest form + catalog.
3. Regression sweep of the untouched guest flow (FR-029) and one-handed panel usability (FR-031).
4. Browser-level E2E for the top risk (manual entry blocks colliding acceptance) can be added afterwards via `/10x-e2e` against this plan — not a blocker for S-08.

## Performance Considerations

Occupancy stays a single-table sum on the existing partial index (that's why the extend-booking_requests decision was made). `day_blocks` lookups are unique-index point reads. `catalog_zagrody` gains one `EXISTS` point-read per row only when a date filter is active — no p95 risk (< 2 s guardrail).

## Migration Notes

Single additive migration; ships via `npm run deploy` (db push **before** worker, per lessons.md). Backwards-compatible during the deploy window: old worker ignores the new `accept_booking_request` column and no `day_blocks` rows can exist before Phase 3 ships. Rollback = `wrangler rollback` (old worker runs fine on the new schema); the migration itself needs no down-path since all changes are additive and defaulted. Existing production rows backfill to `source='app'` via the column default.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-08)
- PRD: `context/foundation/prd-v2.md` (FR-021…023, FR-028, FR-031, US-03)
- Lock-order contract: `supabase/migrations/20260605094725_accept_booking_request.sql:1-12`, `supabase/migrations/20260611150000_withdraw_booking_request.sql:6-13`
- Availability mirror: `supabase/migrations/20260607090000_catalog_zagrody.sql:46-59`
- Concurrency proof style: `tests/db/concurrency.test.ts:27-88`, `tests/db/withdraw.test.ts:139-217`
- Lessons: `context/foundation/lessons.md` (zagroda_id immutability; migrations before worker)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema + core rule (DB layer)

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh local DB: `npm run db:reset`
- [x] 1.2 Full test suite passes (incl. extended concurrency + 2 new suites): `npm test`
- [x] 1.3 Lint passes: `npm run lint`

#### Manual

- [x] 1.4 Studio sanity check: phone row shape, day_blocks row, `day_blocked=true` from SQL accept on a blocked day

### Phase 2: API routes + types

#### Automated

- [ ] 2.1 Types regenerate cleanly and typecheck passes: `npm run db:types && npx astro check`
- [ ] 2.2 Full test suite passes: `npm test`
- [ ] 2.3 Lint passes: `npm run lint`

#### Manual

- [ ] 2.4 Local REST smoke: manual entry consumes capacity; blocked day rejects guest POST with Polish message

### Phase 3: Panel + guest-facing UI

#### Automated

- [ ] 3.1 Full test suite passes: `npm test`
- [ ] 3.2 Typecheck passes: `npx astro check`
- [ ] 3.3 Lint passes: `npm run lint`
- [ ] 3.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.5 Manual entry one-handed < 15 s on mobile viewport, "Telefon" badge visible
- [ ] 3.6 US-03 walkthrough: colliding acceptance refused with exact FR-014 copy
- [ ] 3.7 Block/unblock round-trip: guest form refusal, catalog availability, recovery after unblock
- [ ] 3.8 Entry removal frees capacity instantly, no e-mail sent
- [ ] 3.9 FR-029 regression spot-check of untouched guest flow
