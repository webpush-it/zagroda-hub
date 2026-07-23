# Typ grupy i neutralny język formularza (S-11) Implementation Plan

## Overview

Add a group-type dimension to the guest booking request (szkoła / przedszkole / grupa indywidualna / inna) and shift the request-flow wording from school-only ("nauczyciel") to the neutral "osoba kontaktowa". The change is strictly additive: a new nullable enum column on `booking_requests`, a required select on the guest form, an optional one on the owner's manual-booking form, and surfacing of the type in the owner panel + owner notification email. Every guest-facing email body and the entire existing request flow (validation, confirmation + cancel token, cancel-before-accept, accept/reject/withdraw) stay byte-for-byte unchanged (FR-029).

## Current State Analysis

The product is already half-neutral: `participants_count` / "Liczba uczestników" is used everywhere; there is **no** `group_type` column anywhere. School-specific wording survives in exactly three request-flow sites:

- Owner notification email — `src/lib/booking.ts:173` ("Dane kontaktowe nauczyciela:") and `:180` ("...wiadomość trafi bezpośrednio do nauczyciela.").
- Owner request detail — `src/pages/dashboard/zapytania/[id].astro:70` ("...anulowane przez nauczyciela.") and `:131` ("Kontakt do nauczyciela" section heading).
- Owner decision UI — `src/components/booking/RequestDecision.tsx:94,100,106` ("...nauczyciel dostanie e-mail").

The guest form (`src/components/booking/BookingRequestForm.tsx`) and the shared zod schema (`src/lib/booking.ts:41-65`, used by both client and API) already speak neutrally. The API (`src/pages/api/booking-request/index.ts:58`) inserts the 7 validated fields plus server-generated `id` + `cancel_token`; `source` defaults to `'app'`.

The owner manual (phone) path writes through the SECURITY DEFINER RPC `create_manual_booking` (`supabase/migrations/20260719100000_manual_bookings_and_day_blocks.sql:231-307`), called by `src/pages/api/manual-booking/index.ts:39-45` with named params; the RPC hard-codes `status='accepted'`, `source='phone'`.

### Key Discoveries:

- **Single schema source of truth** — `bookingRequestSchema` at `src/lib/booking.ts:41-65` is shared by the client form and the API. Adding the field once covers both validation paths.
- **Guest INSERT RLS pins `status`/`source`/`note` only** (`20260719100000...sql:46-52`), not arbitrary columns. A guest-supplied `group_type` passes through as-is; the enum type is the only value constraint needed. No RLS `WITH CHECK` edit required.
- **RPC signature identity changes when a param is added** — `create_manual_booking` must be dropped and recreated (not `create or replace`, which would leave a second overload) and its EXECUTE grant re-stated (`20260719100000...sql:391-392`). `p_group_type` gets a trailing `default null`; callers use named params so ordering is safe.
- **Decision emails go to the guest, not the owner** — accept/reject/withdraw builders (`src/lib/booking.ts:211-266`) and their endpoint selects need **no** `group_type`. Only the owner notification email (built in `buildBookingEmails`, owner branch `:165-182`) surfaces the type.
- **Lesson — migrations ship additive & backwards-compatible with the worker** (`context/foundation/lessons.md:12-17`): the new column is nullable, the RPC change keeps a defaulted param, so the old worker survives the deploy window.
- **Lesson — `booking_requests.zagroda_id`/`turnus_id` immutability** (`lessons.md:5-10`): this change adds no write path that re-points a request, so the lock-order contract is untouched.

## Desired End State

- A guest on a zagroda page must pick one of four group types before submitting; the rest of the form validates exactly as today.
- The owner sees the group type in the request list, the request detail, and the "new request" email; requests with no type (legacy, phone) render „—".
- The owner may optionally set a group type when logging a phone booking.
- Every occurrence of "nauczyciel" in the request flow reads "osoba kontaktowa"; guest-facing email bodies are unchanged apart from nothing (the "nauczyciel" strings live only in owner-facing surfaces).
- `npm test` passes, including an extended manual-booking DB assertion for `group_type`.

Verify: submit a guest request as each type → owner email + panel show it; submit with no type selected → blocked with a field error; existing accepted/phone rows still render (as „—"); cancel-before-accept and all decision emails behave identically to before.

## What We're NOT Doing

- No free-text "inna" description field (enum value only).
- No `group_type` in guest-facing emails (confirmation, acceptance, rejection, withdrawal) — those bodies stay unchanged.
- No `group_type` in the decision-endpoint selects (accept/reject/withdraw).
- No dynamic per-type wording ("opiekun"/"organizator") — static "osoba kontaktowa" only.
- No change to catalog, marketing copy on `src/pages/index.astro`, RLS insert policies, the accept/day-block functions, or any public contract (URLs, cancel tokens).
- No backfill of historical rows (they stay NULL by design).

## Implementation Approach

Bottom-up in four independently-verifiable phases: data layer first (column + RPC param + types + DB test), then the guest write path (schema + form + API), then owner-facing display + wording, then the optional manual-booking selector. Each phase is independently revertible (blast radius: panel + form + owner email), consistent with the roadmap's per-slice reversibility constraint.

## Critical Implementation Details

- **RPC recreate, not replace** — adding `p_group_type` changes `create_manual_booking`'s signature identity. Drop the old function and create the new one in the same migration, then re-issue the `revoke ... from public, anon` / `grant execute ... to authenticated` statements with the new argument-type list. A bare `create or replace` would create a second overload and leave the old grant dangling.
- **Enum values are ASCII tokens** — `szkola`, `przedszkole`, `grupa_indywidualna`, `inna` (mirroring `booking_source`/`request_status` style, avoiding diacritics in enum labels). Human labels ("Szkoła", "Przedszkole", "Grupa indywidualna", "Inna") live in the presentation layer, mapped from these tokens.

## Phase 1: Data layer (migration, types, DB test)

### Overview

Introduce the `group_type` enum + nullable column and teach the manual-booking RPC to accept it. Regenerate DB types and extend the manual-booking DB test.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<timestamp>_group_type.sql` (new; timestamp after `20260719100000`)

**Intent**: Add the group-type enum and a nullable column so any row (guest, phone, legacy) is valid without backfill, and extend the owner manual-booking RPC to optionally record it.

**Contract**:
- `create type public.group_type as enum ('szkola', 'przedszkole', 'grupa_indywidualna', 'inna');`
- `alter table public.booking_requests add column group_type public.group_type;` (nullable, no default — legacy/phone/untyped rows stay NULL).
- Drop and recreate `public.create_manual_booking` with an added trailing parameter `p_group_type public.group_type default null`, adding `group_type` to the INSERT column/values lists (currently `20260719100000...sql:292-296`); all other behavior (lock-order, owner check, day-block, occupancy sum, `status='accepted'`, `source='phone'`) identical.
- Re-issue the EXECUTE grants for the new signature (`revoke ... from public, anon; grant execute ... to authenticated`), mirroring `20260719100000...sql:391-392`.
- Additive & backwards-compatible per `lessons.md:12-17` (old worker keeps calling the RPC with the old named params; the defaulted param absorbs the difference).

#### 2. Regenerated DB types

**File**: `src/db/database.types.ts`

**Intent**: Reflect the new enum and column so downstream TypeScript sees `group_type`.

**Contract**: `booking_requests` Row/Insert/Update gain `group_type: Database["public"]["Enums"]["group_type"] | null`; a `group_type` entry appears under `Enums`. Regenerate via the project's type-gen command rather than hand-editing.

#### 3. Extended manual-booking DB test

**File**: `tests/db/manual-bookings.test.ts`

**Intent**: Prove the RPC stores a passed group type and still works when it is omitted.

**Contract**: Thread an optional `p_group_type` through the `createManual` helper (`:39-51`); extend case (a)'s `toMatchObject` (`:76-84`) to assert the stored `group_type`; keep an existing call that omits it (asserts NULL) so the defaulted-param path is covered.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly against a fresh DB (project migration command)
- [ ] Type generation produces a `group_type` enum + column with no diff drift: `npm run typecheck`
- [ ] DB test suite passes: `npm test` (manual-bookings.test.ts green)

#### Manual Verification:

- [ ] `create_manual_booking` shows exactly one overload in the DB (old signature gone), with the authenticated-only grant intact

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation before proceeding.

---

## Phase 2: Guest form + API

### Overview

Make group type a required field on the guest request path — in the shared schema, the form, and the insert.

### Changes Required:

#### 1. Shared zod schema

**File**: `src/lib/booking.ts` (`bookingRequestSchema`, `:41-65`)

**Intent**: Require the guest to pick a valid group type; reuse the same schema for client and server validation.

**Contract**: Add `group_type: z.enum(['szkola','przedszkole','grupa_indywidualna','inna'])` with a Polish "wybierz typ grupy"-style message on empty/invalid, so an unset select fails validation. `BookingRequestInput` (`:67`) gains the field automatically.

#### 2. Guest form select

**File**: `src/components/booking/BookingRequestForm.tsx`

**Intent**: Render a required, no-preselection group-type select and include it in the submitted payload.

**Contract**: Add `group_type` to form state (`:47-52`, initial empty), render a `<select>` with an empty disabled default option + the four labeled options (follow the existing "Turnus" select pattern at `:124`), wire `fieldErrors.group_type`, and add `group_type` to the POST payload (`:65-73`). Neutral label "Typ grupy".

#### 3. API insert passthrough

**File**: `src/pages/api/booking-request/index.ts`

**Intent**: Persist the validated group type on the new row.

**Contract**: Include `group_type` in the insert object (`:58`) — it is already part of the validated `data`, so this is a passthrough. No RLS change (guest INSERT policy does not gate `group_type`).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: project lint command
- [ ] API tests for booking-request pass: `npm test`

#### Manual Verification:

- [ ] Submitting without choosing a type shows a field error and blocks submit
- [ ] Submitting each of the four types stores the correct enum value
- [ ] Confirmation email + cancel-token flow behave exactly as before (FR-029)

**Implementation Note**: Pause for human confirmation after automated verification passes.

---

## Phase 3: Owner surfacing + neutral wording

### Overview

Show the group type where the owner decides, and replace the residual "nauczyciel" wording with static "osoba kontaktowa". Guest-facing emails untouched.

### Changes Required:

#### 1. Owner notification email

**File**: `src/lib/booking.ts` (`BookingEmailContext` `:102-119`; owner branch of `buildBookingEmails` `:165-182`)

**Intent**: Carry the group type into the owner "new request" email and neutralize the contact wording.

**Contract**: Add `group_type: Database enum | null` to `BookingEmailContext`; render a group-type row in the owner email (human label or „—" when null); replace `:173` "Dane kontaktowe nauczyciela:" → "Dane kontaktowe osoby kontaktowej:" (or "Dane kontaktowe:") and `:180` "...trafi bezpośrednio do nauczyciela." → "...trafi bezpośrednio do osoby kontaktowej.". Guest branch (`:146-156`) unchanged. Update the `buildBookingEmails` call site in `api/booking-request/index.ts` (`:88-143`) to pass `group_type`.

#### 2. Owner request detail

**File**: `src/pages/dashboard/zapytania/[id].astro`

**Intent**: Show group type in the detail `<dl>` and neutralize wording.

**Contract**: Add `group_type` to the query select (`:37-43`); add a "Typ grupy" row to the `<dl>` (near `:111`, rendering „—" when null); replace `:70` "...anulowane przez nauczyciela." and `:131` "Kontakt do nauczyciela" with "osoba kontaktowa"-based copy.

#### 3. Owner request list

**File**: `src/pages/dashboard/zapytania/index.astro` + `src/components/booking/RequestsList.tsx`

**Intent**: Surface group type in the list.

**Contract**: Add `group_type` to the list query select (`index.astro:39`) and the row mapping (`:55-65`); add `group_type` to the `RequestRow` interface (`RequestsList.tsx:8-17`) and render a small type chip (near the badges at `:85-91`), „—"/omitted when null.

#### 4. Decision UI wording

**File**: `src/components/booking/RequestDecision.tsx`

**Intent**: Neutralize the success-notice copy.

**Contract**: Replace "nauczyciel dostanie e-mail" at `:94`, `:100`, `:106` with "osoba kontaktowa dostanie e-mail". No data/flow change.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: project lint command
- [ ] Existing email + decision tests pass unchanged: `npm test`

#### Manual Verification:

- [ ] Owner notification email shows the group type (and „—" for a phone/legacy row)
- [ ] Owner detail + list render the type; a legacy accepted row (no type) renders „—" without error
- [ ] No "nauczyciel" remains in the request flow; guest-facing email bodies are unchanged

**Implementation Note**: Pause for human confirmation after automated verification passes.

---

## Phase 4: Manual (phone) booking group type

### Overview

Let the owner optionally record a group type when logging a phone booking, wiring it to the RPC param added in Phase 1.

### Changes Required:

#### 1. Manual-booking schema

**File**: `src/lib/booking.ts` (`manualBookingSchema` `:73-87`)

**Intent**: Accept an optional group type on the owner manual path.

**Contract**: Add `group_type: z.enum([...]).optional()` (same four tokens). `ManualBookingInput` (`:89`) gains the optional field.

#### 2. Manual-booking form select

**File**: `src/components/booking/ManualBookingForm.tsx`

**Intent**: Render an optional group-type select and include it in the payload.

**Contract**: Add `group_type` to form state, render an optional `<select>` (empty option allowed, follow the "Turnus" select at `:164-179`), add it to the submit payload (`:66-72`, omit when blank — same pattern as `note`).

#### 3. Manual-booking API passthrough to RPC

**File**: `src/pages/api/manual-booking/index.ts`

**Intent**: Pass the optional type to the RPC.

**Contract**: Add `p_group_type: input.group_type` to the `create_manual_booking` RPC call (`:39-45`), spread only when present (mirroring `p_note`).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: project lint command
- [ ] Manual-booking API + DB tests pass: `npm test`

#### Manual Verification:

- [ ] Logging a phone booking with a group type stores it; the panel/detail show it
- [ ] Logging a phone booking without a type stores NULL and renders „—"
- [ ] Manual-booking flow otherwise unchanged (capacity consumption, day-block, over-limit)

**Implementation Note**: Pause for human confirmation after automated verification passes.

---

## Testing Strategy

### Unit / DB Tests:

- Extend `tests/db/manual-bookings.test.ts`: assert `create_manual_booking` stores a passed `p_group_type` and defaults to NULL when omitted (Phase 1).
- Guest-request API validation: a request missing `group_type` returns 422 with a field error; a valid type persists (Phase 2, in the existing booking-request API test).

### Integration Tests:

- End-to-end guest submission for each of the four types → row persisted with the right enum → owner email + panel show it.
- Regression: cancel-before-accept and accept/reject/withdraw email flows unchanged (FR-029).

### Manual Testing Steps:

1. On a zagroda page, submit a request without selecting a type → blocked with a field error.
2. Submit as each type; confirm the owner email + `dashboard/zapytania` list + detail show the correct label.
3. Open a legacy/accepted request (or a phone entry) with no type → renders „—", no error.
4. Log a phone booking via the manual form with and without a type; confirm storage + display.
5. Cancel a pending request via the emailed token; confirm identical behavior to before.

## Migration Notes

- Column is nullable with no backfill — existing production rows and all phone entries remain valid and render „—". No data migration.
- Ship the migration with the worker per `lessons.md:12-17` (`supabase db push` before `wrangler deploy` via `npm run deploy` / CI deploy job). The nullable column + defaulted RPC param keep the old worker functional during the deploy window; `wrangler rollback` stays safe.
- RPC change is a drop+recreate with a re-issued grant — verify the authenticated-only EXECUTE grant post-deploy.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-11, lines 95-105)
- PRD: `context/foundation/prd-v2.md` — FR-027 (`:138`), FR-029 (`:145`), US-04 (`:88`)
- Lessons: `context/foundation/lessons.md` (deploy carries migrations `:12-17`; `booking_requests` immutability `:5-10`)
- Manual-booking RPC: `supabase/migrations/20260719100000_manual_bookings_and_day_blocks.sql:231-307`
- Shared schema + email builders: `src/lib/booking.ts:41-266`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer (migration, types, DB test)

#### Automated

- [x] 1.1 Migration applies cleanly against a fresh DB — 9a38d0d
- [x] 1.2 Type generation produces a `group_type` enum + column with no diff drift (`npm run typecheck`) — 9a38d0d
- [x] 1.3 DB test suite passes (`npm test`, manual-bookings.test.ts green) — 9a38d0d

#### Manual

- [x] 1.4 `create_manual_booking` shows exactly one overload with the authenticated-only grant intact — 9a38d0d

### Phase 2: Guest form + API

#### Automated

- [x] 2.1 Type checking passes (`npm run typecheck`) — 5e5a71b
- [x] 2.2 Linting passes — 5e5a71b
- [x] 2.3 API tests for booking-request pass (`npm test`) — 5e5a71b

#### Manual

- [x] 2.4 Submitting without a type shows a field error and blocks submit — 5e5a71b
- [x] 2.5 Submitting each of the four types stores the correct enum value — 5e5a71b
- [x] 2.6 Confirmation email + cancel-token flow behave exactly as before (FR-029) — 5e5a71b

### Phase 3: Owner surfacing + neutral wording

#### Automated

- [x] 3.1 Type checking passes (`npm run typecheck`)
- [x] 3.2 Linting passes
- [x] 3.3 Existing email + decision tests pass unchanged (`npm test`)

#### Manual

- [x] 3.4 Owner notification email shows the group type (and „—" for a phone/legacy row)
- [x] 3.5 Owner detail + list render the type; a legacy no-type row renders „—" without error
- [x] 3.6 No "nauczyciel" remains in the request flow; guest-facing email bodies unchanged

### Phase 4: Manual (phone) booking group type

#### Automated

- [ ] 4.1 Type checking passes (`npm run typecheck`)
- [ ] 4.2 Linting passes
- [ ] 4.3 Manual-booking API + DB tests pass (`npm test`)

#### Manual

- [ ] 4.4 Logging a phone booking with a group type stores it; panel/detail show it
- [ ] 4.5 Logging a phone booking without a type stores NULL and renders „—"
- [ ] 4.6 Manual-booking flow otherwise unchanged (capacity, day-block, over-limit)
