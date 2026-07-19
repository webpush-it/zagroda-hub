# Phone Bookings & Day Blocks (S-08) — Plan Brief

> Full plan: `context/changes/phone-bookings-and-day-blocks/plan.md`

## What & Why

Owners take real bookings by phone, but the anti-overbooking guarantee only sees app requests — so today the system will happily accept a colliding app request over a phone booking it can't see. This slice lets the owner enter phone bookings and block whole days, folding both into the same "exactly one success" acceptance rule, and marks every booking's source (app/phone). It's the north star of the owner-feedback package: it carries success criterion #1 ("guarantee covers 100% of accepted demand").

## Starting Point

The MVP is live: guests send requests, owners accept from their phone through a single SECURITY DEFINER Postgres function with a proven lock-order contract, and the catalog computes availability with a mirror of the same sum. There is no source/note on bookings, no day-block concept, and guest-contact columns are NOT NULL — phone demand simply doesn't exist in the data model.

## Desired End State

From `/dashboard/zapytania` the owner taps "Dodaj rezerwację telefoniczną", enters date + turnus + participants (+ note) one-handed in under 15 s, and the entry appears in the same list with a "Telefon" badge. A colliding acceptance is then refused with the familiar "X z Y zajęte" message. A blocked day stops new guest requests, blocks acceptances, and vanishes from the catalog's availability filter; removing an entry or block frees capacity instantly.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Storage for phone entries | Extend `booking_requests` (`source`, `note`, relaxed guest columns) | Occupancy stays a single-table sum on the existing partial index; list/withdraw machinery reused | Plan |
| Day blocks | Separate `day_blocks` table | "Day off" ≠ "day full" — a fake full booking would falsify stats and source data | PRD |
| Pending requests on a blocked day | Stay pending, acceptance blocked | No surprise bulk rejection e-mails from a toggle; owner rejects manually if desired | Plan |
| Blocking a day with accepted bookings | Allowed — block stops new demand only | Matches the accept function's grandfathering philosophy; existing guests unaffected | Plan |
| Deleting a phone entry | Soft delete (flip to `withdrawn_by_owner`) | Reuses the proven capacity-release path and preserves channel-adoption history (FR-023) | Plan |
| Panel placement | Everything on `/dashboard/zapytania` | One hub for all demand; shortest path to the < 15 s one-handed NFR | Plan |
| Locking posture | Demand-increasing ops take the zagroda lock first; decreasing ops don't | Inherits the repo's documented lock-order contract that the concurrency proof depends on | Research |

## Scope

**In scope:** `source`/`note` on bookings; `day_blocks` table; `create_manual_booking` / `block_day` / `unblock_day` RPCs; blocked-day check in `accept_booking_request` and `catalog_zagrody`; guest-insert guard trigger; API routes; panel UI (entry form, block control, badges, detail source/note); guest-form blocked-day message; extended concurrency test + new DB/API suites.

**Out of scope:** calendar views, availability templates, new e-mail types, auto-rejecting pending requests on block, per-turnus blocks, editing entries, any change to guest flow/catalog filters/role model.

## Architecture / Approach

One additive migration carries the whole data model and rule extension. Manual entries are `booking_requests` rows born `accepted` with `source='phone'`; blocks are point-read rows consulted under the same zagroda lock that serializes acceptances. Both availability surfaces (accept function, catalog RPC) learn about blocks; the occupancy sum itself needs no change. API routes follow the existing skeleton (auth gates → zod → RPC → pgcode mapping → soft 409s); UI follows the existing island idiom (shared zod, inline confirm, no modals, full-reload after mutation).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + core rule (DB) | Migration + RPCs + extended concurrency proof — guarantee holds at SQL layer | Weakening "exactly one success"; return-type change needs DROP FUNCTION |
| 2. API routes + types | New routes, blocked-day handling in existing routes, regenerated types | Contract drift in accept/withdraw responses consumed by existing UI |
| 3. Panel + guest UI | Entry form, block control, source badges, guest-form message | Cluttering the one-handed mobile list page (< 15 s NFR) |

**Prerequisites:** local Supabase stack (`npm run db:start`) for tests/typegen; nothing upstream — S-08 has no slice prerequisites.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- Deploy window: old worker briefly runs on new schema — safe because the new return column is ignored and no blocks can exist before Phase 3 ships; do not reorder phases.
- Assumes `withdraw_booking_request` truly needs no SQL change for phone rows (verified: it only checks status + ownership and flips status); only the route's e-mail step becomes conditional.
- Soft-deleted phone entries appear under the existing "Anulowane" filter — accepted as-is; revisit only if the owner-ambassador finds it confusing.

## Success Criteria (Summary)

- A manual entry that exhausts a day's limit makes a colliding app acceptance fail with the exact FR-014 message — proven under concurrency (extended test, 20 iterations).
- A blocked day accepts no guest requests and no acceptances, and disappears from the catalog availability filter; unblock and entry-removal restore capacity instantly.
- Owner adds an entry one-handed in < 15 s and sees the source (app/phone) on every booking; existing guest flow untouched (FR-029).
