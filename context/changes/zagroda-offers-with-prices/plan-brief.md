# Oferty zagrody z cenami (S-12) — Plan Brief

> Full plan: `context/changes/zagroda-offers-with-prices/plan.md`
> Frame brief: `context/changes/zagroda-offers-with-prices/frame.md`
> Taxonomy candidate: `context/changes/zagroda-offers-with-prices/taxonomy-candidate.md`

## What & Why

Give each zagroda a list of owner-managed **offers** (name, description, duration,
topic + audience taxonomy, optional price) that guests see on the public zagroda
page. Directly answers the demand-side feedback „klienci chcą ceny podane na tacy"
while keeping publication frictionless (price is optional → „cena ustalana
indywidualnie"). Display-only: the guest booking flow is untouched.

## Starting Point

Greenfield — no offers/price code exists. But every needed convention already
lives in the repo: owner-owned child tables with per-owner RLS (`turnusy`,
`day_blocks`), publish-gated public reads, plain authenticated CRUD under RLS,
the ASCII-token+label enum pattern, an `updated_at` trigger, and the
`dashboard/zapytania` island-hosting page pattern.

## Desired End State

An owner opens `/dashboard/oferty`, adds/edits/soft-deletes offers and drags them
into order. A guest on the zagroda page sees those active offers in that order,
each with topic/audience labels and a formatted price or „cena ustalana
indywidualnie". Zagrody with no offers render unchanged (no empty-state error).

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Price unit | Owner picks per offer (`za_osobe`/`za_grupe`) | Some zagrody price per group, some per head | Frame |
| Offer↔booking | Display-only, no FK | Preserve FR-029 guest flow, minimal blast radius | Frame |
| Taxonomy approach | Define full enums now | Owner wants filterable offers (feeds S-13) | Frame |
| Adresaci values | Adopt 6-value candidate now | Unblocks planning; enum cheaply revisable | Plan |
| Topic/audience cardinality | Multi-select (enum arrays + GIN) | Offers span topics/audiences; feeds S-13 filters | Plan |
| Price storage | Integer grosze, PLN implied | Money-safe, no float rounding | Plan |
| Required fields | nazwa + ≥1 temat + ≥1 adresat | Every offer stays filterable | Plan |
| Owner CRUD + delete | Dedicated `/api/offer` endpoints, soft delete (`is_active`) | Independent per-offer edits; recoverable | Plan |
| Ordering | Owner-controlled `sort_order` (reorder) | Owner controls presentation | Plan |

## Scope

**In scope:** `oferty` table + 3 enums + RLS; `/api/offer` CRUD + reorder;
`/dashboard/oferty` owner manager UI; offers section on the public zagroda page;
DB + API tests.

**Out of scope:** catalog filtering by topic/audience (S-13); any offer↔booking
link; offers in emails/catalog cards/search; multi-currency; online payments;
hard delete; backfill.

## Architecture / Approach

New owner-owned `oferty(zagroda_id, …, temat[], adresaci[], amount_grosze,
price_unit, is_active, sort_order)`. Owner writes via plain authenticated
`/api/offer` routes under RLS (`exists zagrody.owner_id = auth.uid()`); public
reads via a SELECT policy gated on `is_published AND is_active`. Owner UI is a
React island on a dedicated dashboard page; the public page embeds one extra
ordered select and renders a display-only section beside turnusy.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | Enums + `oferty` table + RLS + trigger + GIN indexes + DB tests | RLS gate must combine publish + active correctly |
| 2. Schema + API | `src/lib/offer.ts` + `/api/offer` CRUD/reorder + API tests | Price/unit coupling + reorder atomicity |
| 3. Owner UI | `/dashboard/oferty` manager island + nav | Multi-select + grosze↔zł + reorder UX |
| 4. Public display | Offers section on `zagrody/[id].astro` | Must not regress the booking flow (FR-029) |

**Prerequisites:** local Supabase stack running; owner account for manual checks.
**Estimated effort:** ~4 sessions across 4 phases (mirrors the S-11 slice size, a
touch larger for the richer owner UI).

## Open Risks & Assumptions

- `oferta_adresat` uses the candidate 6-value list; a later advisor revision is an
  additive migration (`alter type … add value`) — no data loss, but a follow-up.
- Multi-select taxonomy uses enum-array columns; the S-13 filter slice is assumed
  to use array containment (GIN) — validated as the cheaper path, not yet built.
- Reorder UX (drag vs move up/down) left to implementation; either satisfies the
  `sort_order` contract.

## Success Criteria (Summary)

- Owner CRUDs + reorders offers; guests see them, correctly priced/labeled, in
  order, only for published zagrody.
- Soft-deleted offers vanish publicly but stay recoverable by the owner; foreign
  owners are denied.
- The existing guest booking flow is byte-unchanged (FR-029); `npm test` green.
