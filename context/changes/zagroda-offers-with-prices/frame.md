# Frame Brief: Oferty zagrody z cenami (S-12)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Owner can add, edit, and delete offers for their own zagroda (name, description,
duration, audience, workshop topic, optional price; absent price shown as
„cena ustalana indywidualnie"). A guest sees the offer list with prices (or the
individual-pricing fallback) on the zagroda page. The change is strictly
additive — zagrody with no offers stay fully functional (empty section, not an
error). PRD refs: FR-024, FR-025, FR-031, US-04.

## Initial Framing (preserved)

- **User's stated cause or approach**: Roadmap slice S-12 as decomposed in the
  PRD — one new owner-owned entity, one owner form, one public display section.
- **User's proposed direction**: Build the offers feature (the /10x-plan target).
- **Pre-dispatch narrowing**: user resolved all three gating questions in one
  round — price unit = **owner picks per offer**; taxonomy = **define the full
  value list now**; offer↔booking = **display-only catalog**.

## Dimension Map

The scope/design could originate at any of these dimensions:

1. **Price unit & optionality** — per-person vs per-group vs both. ← PRD Open
   Q#2, marked *Block: yes, resolve before planning*. The hard gate.
2. **Topic/audience taxonomy** — free-text-now vs full-value-list-now. Open Q#1;
   blocks the filter slice (S-13/FR-026), *not* inherently the offers slice.
3. **Offer↔booking boundary** — display-only vs offer feeds the inquiry flow
   (FR-025 says "sees"; FR-029 keeps the guest flow unchanged).
4. **Data model / RLS / catalog no-regress** — new owner-owned `offers` table,
   owner-only CRUD, public read gated on `is_published`, empty-not-error for
   offer-less zagrody. Mechanical: the codebase already has the pattern.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| D1 price unit — owner picks per offer needs a unit enum + optional amount | User decision; mirrors PRD Socrates note „część zagród ma stawki negocjowane per grupa" (prd-v2.md:130). Enum pattern exists (`GROUP_TYPE_VALUES/LABELS`, src/lib/booking.ts:17-27; SQL enum group_type migration :14). | STRONG (decided) |
| D2 taxonomy — user chose full value list now | Pulls Open Q#1 (prd-v2.md:194) into S-12's critical path; the value list requires the właściciel-doradca (OSZE catalog) and does NOT yet exist. | STRONG as decision, but introduces an unresolved DATA prerequisite |
| D3 offer↔booking — display-only | FR-025 "gość widzi" is display; FR-029 preserved (guest flow byte-unchanged); no FK from booking_requests to offers needed. Public detail page has a clear section slot (zagrody/[id].astro:106-118). | STRONG |
| D4 data model / RLS convention | Full convention exists: child-table owner RLS via `exists(... zagrody z where z.owner_id = (select auth.uid()))` (domain_schema.sql:101-132; day_blocks 20260719100000:68-75); public read gated on `is_published` (20260605200000:191-219); plain authenticated INSERT under RLS is correct for owner CRUD with no cross-row invariant (zagroda/index.ts:58-111); additive/no-backfill precedent = group_type (20260723130000:1-8). | STRONG |

## Narrowing Signals

- Price unit resolved to **owner-picks-per-offer** → data model carries a
  `price_unit` enum (`za_osobe`/`za_grupe`) + a nullable amount. Removes the
  PRD's hard planning gate (Open Q#2).
- Offers are **display-only** → zero blast radius on the booking flow; no
  `booking_requests` change, FR-029 trivially preserved. Confirmed by grep:
  no existing offer/price coupling anywhere in schema or src.
- Taxonomy chosen as **full-value-list-now** → the offer form's topic/audience
  fields become enum/reference-backed, but the value list itself is an
  unresolved external input (OSZE catalog + owner-advisor), not a code question.

## Cross-System Convention

A new owner-owned, publicly-displayed entity is well-trodden here: turnusy and
day_blocks both hang off `zagroda_id` with `exists(... zagrody.owner_id =
auth.uid())` RLS; public visibility is gated on `zagrody.is_published`; owner
CRUD without a cross-row invariant uses a plain authenticated INSERT under RLS
(not a SECURITY DEFINER RPC — that's reserved for the anti-overbooking sum and
privileged column writes). Enums follow the ASCII-token + presentation-label
split. The offers feature fits every one of these conventions with no new
mechanism — the leading approach matches convention exactly.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: a new additive, owner-owned `offers`
> entity (name, description, duration, audience-taxonomy, topic-taxonomy,
> optional amount + `price_unit` enum) with owner-only RLS CRUD and a
> display-only public section on the zagroda page — where the only real
> unknown left is a *data* input (the topic/audience value list), not a
> design ambiguity.

The initial framing held up — no reframe. What the framing step changed is that
the two PRD open questions are now resolved as *decisions* (price unit = owner
picks; offers = display-only), and one of them (taxonomy = define-now) converted
an "optional later" question into a concrete pre-plan data prerequisite.

## Confidence

- **MEDIUM** — the structural framing is HIGH (conventions and scope are
  unambiguous and evidence-backed), but the user's choice to define the full
  taxonomy now introduces an unresolved external dependency that /10x-plan needs
  before it can fully specify the offer form's topic/audience fields.

  **Verify-before-plan step**: obtain the topic (temat warsztatów) and audience
  (adresaci) value lists — modeled on the Ogólnopolska Sieć Zagród Edukacyjnych
  catalog, confirmed with the właściciel-doradca (PRD Open Q#1). With that list
  in hand, confidence rises to HIGH and the slice is fully plannable. Without
  it, /10x-plan can still design the entity + price + display, but must leave the
  taxonomy field values as a TODO.

## What Changes for /10x-plan

Plan a new `offers` (oferty) table on `zagroda_id`: owner-only RLS CRUD via the
existing `exists(... zagrody.owner_id = auth.uid())` pattern, a plain
authenticated INSERT/UPDATE/DELETE path (no RPC), a public SELECT policy gated on
`is_published`, an optional amount + `price_unit` enum (`za_osobe`/`za_grupe`),
and enum-backed topic/audience fields. Render offers as a display-only `<section>`
on `zagrody/[id].astro` beside turnusy; the guest booking flow is untouched.
Resolve the taxonomy value list first (or plan around it as an explicit TODO).

## References

- Source files: `context/foundation/prd-v2.md:129-134,151,194-195`;
  `context/foundation/roadmap.md:107-119`;
  `supabase/migrations/20260605090307_domain_schema.sql:18-56,79-132,145-152`;
  `supabase/migrations/20260605200000_zagroda_profile_publication.sql:191-219`;
  `supabase/migrations/20260719100000_manual_bookings_and_day_blocks.sql:68-75`;
  `supabase/migrations/20260723130000_group_type.sql:1-14`;
  `src/lib/booking.ts:17-27`; `src/pages/api/zagroda/index.ts:58-111`;
  `src/pages/zagrody/[id].astro:32-118`.
- Related research: none (`research.md` not present).
- Investigation tasks: convention-check (owner-owned additive entity).
