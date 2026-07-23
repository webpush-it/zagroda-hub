# Oferty zagrody z cenami (S-12) Implementation Plan

## Overview

Add a new, strictly additive, owner-owned `oferty` entity to each zagroda: name,
description, duration, multi-select topic + audience taxonomy, and an optional
price (integer grosze + a per-offer `za_osobe`/`za_grupe` unit). The owner CRUDs
offers on a dedicated dashboard page (add / edit / soft-delete / reorder); a guest
sees the offer list **display-only** on the public zagroda page, with each price
shown as an amount or „cena ustalana indywidualnie". The guest booking flow
(FR-029) is untouched — no FK from `booking_requests` to `oferty`. Zagrody with no
offers stay fully functional (empty section, not an error). PRD: FR-024, FR-025,
FR-031, US-04.

## Current State Analysis

There is **no** offers/price code anywhere (schema, `src/`, API) — greenfield.
The codebase already carries every convention this feature needs:

- **Owner-owned child table + RLS**: `turnusy` and `day_blocks` hang off
  `zagroda_id`; owner scope is `exists (select 1 from public.zagrody z where
  z.id = <fk> and z.owner_id = (select auth.uid()))` (turnusy policies
  `20260605090307_domain_schema.sql:101-132`; `day_blocks`
  `20260719100000_manual_bookings_and_day_blocks.sql:68-75`). `zagrody.owner_id`
  is `not null unique` — one zagroda per owner (`:19-20`).
- **Public read gated on publication**: anon/auth SELECT `using (is_published)`
  on `zagrody` and `exists(... z.is_published)` on child `turnusy`
  (`20260605200000_zagroda_profile_publication.sql:191-219`). The public detail
  page re-asserts `.eq("is_published", true)` (`src/pages/zagrody/[id].astro:32-39`).
- **Plain authenticated CRUD (no RPC)** is the right tool for owner data with no
  cross-row invariant — the turnusy reconcile in `src/pages/api/zagroda/index.ts:58-111`
  relies purely on RLS. SECURITY DEFINER RPCs are reserved for the anti-overbooking
  sum / privileged column writes (not needed here).
- **Enum convention**: ASCII tokens in Postgres, all values declared up front;
  a TS `*_VALUES` tuple + `*_LABELS` record for display (`GROUP_TYPE_VALUES/LABELS`
  `src/lib/booking.ts:17-27`, SQL `20260723130000_group_type.sql:14`).
- **updated_at trigger**: `20260605123000_updated_at_trigger.sql` defines a reusable
  `set_updated_at()` trigger applied per table.
- **Owner form island**: `dashboard.astro` hosts `ZagrodaProfileForm`, which
  delegates repeatable turnus rows to `TurnusyEditor.tsx` (state `TurnusRow[]`,
  add/remove/patch-by-key, per-row errors keyed `turnusy.<i>.<field>`) — the
  closest UI precedent for an offers editor.
- **Owner-auth API gate**: `createClient` → 503; `context.locals.user` → 401;
  `!user.email_confirmed_at` → 409; then RLS-scoped write. Cleanest multi-method
  example: `src/pages/api/day-block/index.ts:24-100` (shared `gate()` helper,
  POST + DELETE). Shared `json()` from `@/lib/booking-decision`.
- **Dashboard sub-page pattern**: `src/pages/dashboard/zapytania/index.astro`
  SSR-loads the owner's zagroda and hosts action islands (`ManualBookingForm`,
  `DayBlocks`) that reload on success. Topbar nav array `Topbar.astro:15-20`.

## Desired End State

- An owner with a zagroda opens `/dashboard/oferty`, adds offers (name required,
  ≥1 topic + ≥1 audience required, optional description/duration/price), edits and
  soft-deletes them, and drags them into a custom order.
- A guest on `zagrody/[id]` sees the active offers in the owner's chosen order,
  each with its topic/audience labels and either a formatted price (`25,00 zł /
  os.` or `/ grupa`) or „cena ustalana indywidualnie".
- A zagroda with no offers (or all soft-deleted) shows nothing broken — an empty
  section is simply omitted.
- `npm test` passes, including new RLS/DB tests for `oferty` and API tests for
  `/api/offer`.

Verify: create offers of each shape (with/without price, multiple topics) →
they render on the public page in order; soft-delete one → it vanishes publicly
but the owner can still see/restore it; a second owner cannot touch the first's
offers; an unpublished zagroda's offers are invisible to anon.

### Key Discoveries:

- Owner CRUD needs **no RPC** — RLS + authenticated writes suffice (no cross-row
  invariant), per `src/pages/api/zagroda/index.ts:58-111`.
- Public visibility must gate on **both** `zagrody.is_published` AND
  `oferty.is_active` (soft delete), mirroring the turnusy publish gate
  (`20260605200000...:202-219`).
- Multi-select taxonomy → Postgres **enum-array columns** (`oferta_temat[]`,
  `oferta_adresat[]`) with GIN indexes, so the S-13 filter slice can use array
  containment without a schema change.
- Price is **integer grosze**, nullable; `price_unit` is only meaningful with an
  amount → a CHECK ties them together.
- Additive/backwards-compatible per `lessons.md:12-17` — new table + new enums,
  no change to existing tables, old worker unaffected.

## What We're NOT Doing

- No FK or link between `oferty` and `booking_requests` — offers are display-only;
  the guest inquiry flow (FR-029) is byte-unchanged.
- No catalog-level filtering by topic/audience — that is S-13 (FR-026). This slice
  only stores the taxonomy and displays it; the GIN indexes prepare for S-13.
- No `zakres oferty` enum — covered by the free-text `opis` + `czas_trwania`.
- No price in guest-facing emails, catalog cards, or search — offers live only on
  the zagroda detail page and the owner dashboard.
- No multi-currency (PLN implied), no online payments (MVP non-goal).
- No hard delete — soft delete via `is_active` only.
- No backfill — existing zagrody simply have zero offers.

## Implementation Approach

Bottom-up in four independently-verifiable phases (data → owner API → owner UI →
public display), each independently revertible (blast radius: new table + new
dashboard page + one public section). This mirrors the S-11 slice shape the team
just shipped. Owner writes go through plain authenticated endpoints under RLS;
public reads piggyback on the existing publish-gated SELECT convention.

## Critical Implementation Details

- **Price/unit coupling**: `amount_grosze` and `price_unit` must be consistent —
  a CHECK constraint enforces `amount_grosze IS NULL OR price_unit IS NOT NULL`
  (an amount always has a unit; no-amount means „cena ustalana indywidualnie").
- **Taxonomy arrays are required-non-empty**: `temat` and `adresaci` are
  `NOT NULL` with a CHECK `array_length(col, 1) >= 1`; zod mirrors this with
  `.min(1)`. This is the "nazwa + temat + adresaci required" decision.
- **Reorder is index-based**: the reorder endpoint takes an ordered id list and
  assigns `sort_order = array index`, all under the owner's RLS scope in one
  request, so partial reorders can't interleave with another writer.

## Phase 1: Data layer (migration, types, tests)

### Overview

Introduce the three enums and the `oferty` table with owner-CRUD + publish/active-
gated public-read RLS, the `updated_at` trigger, and GIN indexes. Regenerate DB
types and prove the RLS contract with tests.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<timestamp>_oferty.sql` (new; timestamp after `20260723130000`)

**Intent**: Create the offers entity and its taxonomy/price value domains as a
strictly additive change, with per-owner write isolation and publish+active-gated
public read.

**Contract**:
- Enums (ASCII tokens, all values up front):
  - `create type public.price_unit as enum ('za_osobe', 'za_grupe');`
  - `create type public.oferta_temat as enum ('edukacja_regionalna','ekologia','ginace_zawody','kuchnia_domowa','przyroda','rekodzielo_artystyczne','rolnictwo','tradycyjna_zywnosc','zajecia_rekreacyjne','zajecia_sportowe','zwyczaje_obrzedy');` (11 values, from OSZE catalog)
  - `create type public.oferta_adresat as enum ('przedszkola','szkoly_podstawowe','szkoly_ponadpodstawowe','rodziny','dorosli','seniorzy');` (6 values, candidate taxonomy)
- Table `public.oferty`: `id uuid pk default gen_random_uuid()`; `zagroda_id uuid not null references public.zagrody(id) on delete cascade`; `nazwa text not null`; `opis text`; `czas_trwania text`; `temat public.oferta_temat[] not null`; `adresaci public.oferta_adresat[] not null`; `amount_grosze integer`; `price_unit public.price_unit`; `is_active boolean not null default true`; `sort_order integer not null default 0`; `created_at timestamptz not null default now()`; `updated_at timestamptz not null default now()`.
- CHECKs: `array_length(temat, 1) >= 1`; `array_length(adresaci, 1) >= 1`; `amount_grosze is null or amount_grosze > 0`; `amount_grosze is null or price_unit is not null`.
- `set_updated_at` trigger on `oferty` (reuse `20260605123000_updated_at_trigger.sql` pattern).
- RLS enabled. Policies mirroring turnusy/day_blocks:
  - Owner ALL (select/insert/update/delete) `using`/`with check` `exists (select 1 from public.zagrody z where z.id = oferty.zagroda_id and z.owner_id = (select auth.uid()))`.
  - Public SELECT (anon + authenticated) `using (is_active and exists (select 1 from public.zagrody z where z.id = oferty.zagroda_id and z.is_published))`.
- Indexes: `oferty_zagroda_id_idx` on `(zagroda_id)`; GIN on `temat` and `adresaci` (prep for S-13 containment filters).

#### 2. Regenerated DB types

**File**: `src/db/database.types.ts`

**Intent**: Surface the new table + enums to TypeScript.

**Contract**: `oferty` Row/Insert/Update and the three new `Enums` entries appear.
Regenerate via `npm run db:types` — do not hand-edit.

#### 3. RLS / DB tests

**File**: `tests/db/oferty.test.ts` (new)

**Intent**: Prove owner isolation, publish+active-gated public read, and the CHECK
constraints against the live local DB.

**Contract**: Cases — (a) owner inserts an offer with multiple temat/adresaci and
reads it back; (b) anon/other-user reads an offer only when the zagroda
`is_published` and the offer `is_active`; (c) a second owner cannot update/delete
the first owner's offer (RLS denies); (d) soft-deleted (`is_active=false`) offer
is invisible to anon but visible to its owner; (e) CHECK violations rejected
(empty `temat`, `amount_grosze` set with null `price_unit`). Reuse
`tests/helpers/supabase.ts` (`createOwnerClient`, `createAnonClient`, `seedZagroda`).

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly against a fresh DB (`npm run db:reset`)
- [ ] Type generation produces `oferty` + 3 enums with no diff drift (`npm run db:types` then `npx astro check`)
- [ ] DB test suite passes (`npm test`, `oferty.test.ts` green)

#### Manual Verification:

- [ ] In the DB, an offer on an unpublished zagroda is invisible to the anon role; publishing reveals it; soft-deleting hides it again

**Implementation Note**: Pause for human confirmation after automated verification passes.

---

## Phase 2: Shared schema + owner API

### Overview

Add the offers domain module (enums, labels, zod schema, price helpers) and the
owner-authenticated `/api/offer` endpoints (create / update / soft-delete /
reorder), mirroring the day-block gate pattern.

### Changes Required:

#### 1. Offers domain module

**File**: `src/lib/offer.ts` (new)

**Intent**: Single source of truth for offer validation and presentation, shared
by the owner form (client) and the API (server) — same contract as
`bookingRequestSchema`.

**Contract**: Export `PRICE_UNIT_VALUES`/`PRICE_UNIT_LABELS`
(`za_osobe`→„za osobę", `za_grupe`→„za grupę"), `OFERTA_TEMAT_VALUES`/`_LABELS`
(11), `OFERTA_ADRESAT_VALUES`/`_LABELS` (6), and matching `GroupType`-style types.
`offerSchema` (zod): `nazwa` non-empty ≤120; `opis` optional ≤2000; `czas_trwania`
optional ≤120; `temat` `z.array(z.enum(...)).min(1)`; `adresaci`
`z.array(z.enum(...)).min(1)`; `amount_grosze` optional positive int; `price_unit`
optional enum, refined so it is present iff `amount_grosze` is present. `reorderSchema`:
`{ ids: z.array(z.uuid()).min(1) }`. Export `OfferInput`. Price helpers
`groszeToZloty`/`zlotyToGrosze` + a `formatOfferPrice(amount_grosze, unit)` →
„25,00 zł / os." | „cena ustalana indywidualnie". Re-export `fieldErrorsFromZod`.

#### 2. Owner offer endpoints

**File**: `src/pages/api/offer/index.ts` (new)

**Intent**: Owner creates/updates/soft-deletes an offer under RLS.

**Contract**: `export const prerender = false`. Reuse the day-block gate
(`createClient`→503, `user`→401, `email_confirmed_at`→409). POST: validate with
`offerSchema`, insert into `oferty` with `zagroda_id` resolved from the caller's
owned zagroda (single owner→zagroda; look it up server-side, do not trust a
client-supplied zagroda_id beyond RLS). PATCH: validate `{ id, ...offerFields,
sort_order? }`, update by id (RLS scopes to owner). DELETE: `{ id }` → set
`is_active=false` (soft delete). Map RLS denial (no row updated) → 404/403 with
the shared `json()` helper.

#### 3. Reorder endpoint

**File**: `src/pages/api/offer/reorder.ts` (new)

**Intent**: Persist owner-controlled ordering in one request.

**Contract**: POST `{ ids: uuid[] }` (validated by `reorderSchema`); assign
`sort_order = index` for each id, scoped to the owner's zagroda under RLS
(update each; ids not owned are silently no-ops via RLS). Same auth gate.

#### 4. API tests

**File**: `tests/api/offer.test.ts` (new)

**Intent**: Cover validation + auth + soft-delete + reorder at the route layer.

**Contract**: Cases — unauthenticated → 401; unverified → 409; invalid payload
(empty `temat`, price without unit) → 422 with `fieldErrors`; valid create → row
persisted; PATCH edits fields; DELETE soft-deletes; reorder assigns `sort_order`
by index. Mirror the existing API test harness (e.g. `tests/api/guest-input.test.ts`).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes (`npx astro check`)
- [ ] Linting passes (`npm run lint`)
- [ ] Offer API + schema tests pass (`npm test`)

#### Manual Verification:

- [ ] Creating, editing, soft-deleting, and reordering offers via direct API calls behaves as specified; a foreign owner is denied

**Implementation Note**: Pause for human confirmation after automated verification passes.

---

## Phase 3: Owner UI (dashboard page + manager island)

### Overview

Add the `/dashboard/oferty` page and the `OffersManager` React island for
per-offer CRUD, multi-select taxonomy, grosze↔zł price input with unit, and drag
reordering. Add the "Oferty" topbar entry.

### Changes Required:

#### 1. Dashboard offers page

**File**: `src/pages/dashboard/oferty/index.astro` (new)

**Intent**: SSR-load the owner's zagroda + its offers and host the manager island;
prompt to create a profile first if no zagroda exists.

**Contract**: Mirror `dashboard/zapytania/index.astro` — resolve the logged-in
owner's zagroda; if none, render the "create your profile first" prompt (link to
`/dashboard`); otherwise SSR-select the zagroda's offers (all, incl. inactive, for
the owner) ordered by `sort_order` and pass to `<OffersManager client:load ... />`.

#### 2. Offers manager island

**File**: `src/components/offer/OffersManager.tsx` (new)

**Intent**: Owner-facing CRUD + reorder UI following the form-island conventions.

**Contract**: State = list of offers (`{ key, id?, nazwa, opis, czas_trwania,
temat[], adresaci[], amount_zloty?, price_unit?, is_active }`). Reuse `FormField`,
`fieldClass`, `ServerError`, `fieldErrorsFromZod`, `input-field`/`btn-primary`
classes. Per-offer edit form with: text inputs (nazwa/opis/czas_trwania),
multi-select controls for temat + adresaci (checkboxes/chips over
`OFERTA_TEMAT_VALUES`/`OFERTA_ADRESAT_VALUES` labels), a price input in złoty that
converts to grosze on submit + a unit select (`PRICE_UNIT_VALUES`), an
add/edit/soft-delete affordance, and reordering (move up/down or drag) that POSTs
to `/api/offer/reorder`. Each mutation calls the matching `/api/offer` route;
on success reload (`window.location.reload()`) like `ManualBookingForm`/`DayBlocks`.
Client-side validate with `offerSchema` before submit; merge server 422
`fieldErrors`. Per-offer errors keyed by index as in `TurnusyEditor`.

#### 3. Topbar nav entry

**File**: `src/components/Topbar.astro`

**Intent**: Make offers reachable.

**Contract**: Add `{ href: "/dashboard/oferty", label: "Oferty" }` to the
logged-in link array (`:15-20`); it feeds both desktop and mobile nav automatically.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes (`npx astro check`)
- [ ] Linting passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

#### Manual Verification:

- [ ] Owner can add an offer (required nazwa + ≥1 temat + ≥1 adresat enforced), edit it, soft-delete it, and reorder offers; blank price yields „cena ustalana indywidualnie"
- [ ] Price entered in złoty is stored/redisplayed correctly (grosze round-trip)
- [ ] An owner with no zagroda sees the create-profile prompt, not an error
- [ ] Mobile: the manager is usable one-handed (consistent with the panel NFR)

**Implementation Note**: Pause for human confirmation after automated verification passes.

---

## Phase 4: Public display on the zagroda page

### Overview

Render the active offers as a display-only section on the public zagroda page,
with formatted prices/labels and a graceful empty state.

### Changes Required:

#### 1. Offers section on the public detail page

**File**: `src/pages/zagrody/[id].astro`

**Intent**: Show the zagroda's active offers to guests, ordered by the owner's
`sort_order`, without touching the booking flow.

**Contract**: Extend the existing single query (`:32-39`) to also select active
offers for this zagroda ordered by `sort_order` (relying on the public-read RLS —
only active offers on the published zagroda return). Render an „Oferty" `<section>`
beside the turnusy section (`:106-118`): per offer show `nazwa`, `opis`,
`czas_trwania`, topic + audience labels (via `OFERTA_TEMAT_LABELS`/
`OFERTA_ADRESAT_LABELS`), and `formatOfferPrice(...)`. If the offer list is empty,
omit the section entirely (no empty-state error). All guest-supplied nothing here;
owner text is escaped per the page's existing rendering.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes (`npx astro check`)
- [ ] Linting passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`); existing zagroda-page tests (if any) pass (`npm test`)

#### Manual Verification:

- [ ] A published zagroda with offers shows them in the owner's order with correct prices/labels or „cena ustalana indywidualnie"
- [ ] A zagroda with zero (or all-inactive) offers renders with no offers section and no error
- [ ] Offers of an unpublished zagroda are not visible to a logged-out guest
- [ ] The existing booking request form + flow on the page are unchanged (FR-029)

**Implementation Note**: Pause for human confirmation after automated verification passes.

---

## Testing Strategy

### Unit / DB Tests:

- `tests/db/oferty.test.ts` — owner isolation, publish+active-gated public read,
  soft-delete visibility, CHECK constraints (Phase 1).
- `tests/api/offer.test.ts` — auth gate, validation (empty taxonomy, price without
  unit), create/edit/soft-delete/reorder (Phase 2).
- `src/lib/offer.ts` price-helper unit tests (grosze↔zł, `formatOfferPrice`).

### Integration Tests:

- End-to-end: owner creates offers of each shape → they render on the public page
  in order with correct price labels.
- Regression: the guest booking flow on `zagrody/[id]` is unchanged (FR-029).

### Manual Testing Steps:

1. As an owner, open `/dashboard/oferty`, add an offer with multiple topics +
   audiences and a per-person price; add a second with no price; reorder them.
2. Visit the public zagroda page → offers appear in the chosen order with
   „25,00 zł / os." and „cena ustalana indywidualnie".
3. Soft-delete an offer → it disappears publicly; confirm the owner still sees it.
4. Log in as a different owner → confirm you cannot see/edit the first owner's offers.
5. Unpublish the zagroda → offers vanish for a logged-out guest.
6. Confirm the booking request form still works exactly as before.

## Performance Considerations

Offers are a small per-zagroda list read on an already-SSR'd detail page — one
extra embedded select, no new round trip. GIN indexes on `temat`/`adresaci` add
negligible write cost and prepare S-13 filters. No pagination needed at MVP scale.

## Migration Notes

- New table + new enums; strictly additive, no change to existing tables — old
  worker unaffected (`lessons.md:12-17`). Ship with the worker via `npm run deploy`
  (`db:push` before `wrangler deploy`).
- No backfill — existing zagrody have zero offers and render unchanged.
- The `oferta_adresat` enum uses the candidate 6-value taxonomy (frame decision);
  if the właściciel-doradca revises it later, that is an additive follow-up
  migration (`alter type ... add value`) or a value rename — no data loss.

## References

- Frame brief: `context/changes/zagroda-offers-with-prices/frame.md`
- Taxonomy candidate: `context/changes/zagroda-offers-with-prices/taxonomy-candidate.md`
- PRD: `context/foundation/prd-v2.md` — FR-024 (`:129`), FR-025 (`:131`), FR-031 (`:147`), Open Qs (`:194-195`)
- Roadmap: `context/foundation/roadmap.md` — S-12 (`:107-119`)
- Convention refs: `supabase/migrations/20260605090307_domain_schema.sql:101-132`; `20260605200000_zagroda_profile_publication.sql:191-219`; `20260719100000_manual_bookings_and_day_blocks.sql:68-75`; `20260605123000_updated_at_trigger.sql`; `src/lib/booking.ts:17-27`; `src/pages/api/day-block/index.ts:24-100`; `src/pages/api/zagroda/index.ts:58-111`; `src/pages/zagrody/[id].astro:32-118`; `src/components/zagroda/TurnusyEditor.tsx`; `src/components/Topbar.astro:15-20`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer (migration, types, tests)

#### Automated

- [x] 1.1 Migration applies cleanly against a fresh DB (`npm run db:reset`) — 37bf73e
- [x] 1.2 Type generation produces `oferty` + 3 enums with no diff drift (`npm run db:types` + `npx astro check`) — 37bf73e
- [x] 1.3 DB test suite passes (`npm test`, `oferty.test.ts` green) — 37bf73e

#### Manual

- [x] 1.4 Unpublished-zagroda offer invisible to anon; publish reveals; soft-delete hides — 37bf73e

### Phase 2: Shared schema + owner API

#### Automated

- [x] 2.1 Type checking passes (`npx astro check`) — 4a2bf6b
- [x] 2.2 Linting passes (`npm run lint`) — 4a2bf6b
- [x] 2.3 Offer API + schema tests pass (`npm test`) — 4a2bf6b

#### Manual

- [x] 2.4 Create/edit/soft-delete/reorder via direct API behaves as specified; foreign owner denied — 4a2bf6b

### Phase 3: Owner UI (dashboard page + manager island)

#### Automated

- [x] 3.1 Type checking passes (`npx astro check`)
- [x] 3.2 Linting passes (`npm run lint`)
- [x] 3.3 Build succeeds (`npm run build`)

#### Manual

- [x] 3.4 Owner can add (required nazwa + ≥1 temat + ≥1 adresat), edit, soft-delete, reorder; blank price → „cena ustalana indywidualnie"
- [x] 3.5 Złoty↔grosze round-trip correct
- [x] 3.6 Owner with no zagroda sees create-profile prompt, not an error
- [x] 3.7 Manager usable one-handed on mobile

### Phase 4: Public display on the zagroda page

#### Automated

- [ ] 4.1 Type checking passes (`npx astro check`)
- [ ] 4.2 Linting passes (`npm run lint`)
- [ ] 4.3 Build succeeds + existing tests pass (`npm run build`, `npm test`)

#### Manual

- [ ] 4.4 Published zagroda shows offers in order with correct prices/labels
- [ ] 4.5 Zero/all-inactive offers → no section, no error
- [ ] 4.6 Unpublished zagroda's offers invisible to logged-out guest
- [ ] 4.7 Booking request form + flow unchanged (FR-029)
