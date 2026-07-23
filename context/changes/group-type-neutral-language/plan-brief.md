# Typ grupy i neutralny język formularza (S-11) — Plan Brief

> Full plan: `context/changes/group-type-neutral-language/plan.md`

## What & Why

Let a guest submitting a booking request pick a **group type** (szkoła / przedszkole / grupa indywidualna / inna) and shift the residual school-only wording ("nauczyciel") to the neutral "osoba kontaktowa". This opens the individual-client persona the owner-ambassador flagged in feedback ("kupa zagród robi też zajęcia indywidualne") at minimal cost — a small edit to the existing form, not a separate product path.

## Starting Point

The product is already half-neutral — `participants_count` / "Liczba uczestników" is used everywhere and there is no `group_type` column at all. The zod schema in `src/lib/booking.ts:41-65` is shared by both the guest form and the API. School wording survives in three owner-facing sites only: the owner notification email (`booking.ts:173,180`), the request detail view (`zapytania/[id].astro:70,131`), and the decision UI (`RequestDecision.tsx:94,100,106`).

## Desired End State

A guest must choose one of four types before submitting; the owner sees the type in the request list, detail, and the "new request" email, with untyped rows (legacy + phone) rendering „—". The owner can optionally set a type when logging a phone booking. Every "nauczyciel" in the request flow reads "osoba kontaktowa". All guest-facing emails and the whole cancel/accept/reject/withdraw flow are unchanged (FR-029).

## Key Decisions Made

| Decision                        | Choice                                              | Why (1 sentence)                                                        | Source |
| ------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| Group type required?            | Required on guest form, no preselection             | Every new request carries an intentional, trustworthy type             | Plan   |
| Legacy / phone rows             | Nullable column, render „—", no backfill            | Purely additive, no fabricated history — mirrors nullable guest contact | Plan   |
| „inna" detail                   | Enum value only, no free text                       | Matches the PRD's four-value list; owner asks specifics in follow-up   | Plan   |
| Propagation                     | Owner panel + owner notification email              | Owner sees it where they decide; guest emails stay unchanged (FR-029)  | Plan   |
| Manual (phone) booking          | Optional group-type selector on owner form          | User asked for cross-channel parity; optional keeps phone entry fast   | Plan   |
| Neutral wording                 | Static "osoba kontaktowa" everywhere                | Exactly the FR-027 mandate; no branching or NULL edge case             | Plan   |
| Enum tokens                     | `szkola` / `przedszkole` / `grupa_indywidualna` / `inna` | ASCII, consistent with `booking_source` / `request_status` style  | Plan   |

## Scope

**In scope:** `group_type` enum + nullable column; extend `create_manual_booking` RPC; required select on guest form; optional select on manual form; surface type in owner list/detail/notification email; swap "nauczyciel" → "osoba kontaktowa"; extend manual-booking DB test.

**Out of scope:** free-text "inna"; group type in guest-facing/decision emails; dynamic per-type wording; RLS-policy changes; catalog/marketing copy; backfill of historical rows; any public-contract change.

## Architecture / Approach

Bottom-up, four independently-verifiable phases. **Phase 1** data layer (migration: enum + nullable column + RPC param; regen types; DB test). **Phase 2** guest write path (shared schema field → form select → API insert passthrough). **Phase 3** owner surfacing + neutral wording (list/detail/owner-email + the three "nauczyciel" swaps). **Phase 4** optional manual-booking selector wired to the RPC param. The shared zod schema means guest validation is added once for client + server; the guest INSERT RLS policy does not gate the new column, so no policy edit is needed.

## Phases at a Glance

| Phase                              | What it delivers                                       | Key risk                                                           |
| ---------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| 1. Data layer                      | enum + nullable column, RPC param, types, DB test      | RPC must be dropped+recreated with re-issued grant (signature change) |
| 2. Guest form + API                | required group-type select, persisted on submit        | Regression of the busiest form / FR-029 validation flow           |
| 3. Owner surfacing + wording       | type in panel + owner email; "osoba kontaktowa"        | Touching the owner email builder without altering guest emails    |
| 4. Manual booking group type       | optional selector for phone entries                    | Expands into S-08's owner RPC path — keep phone entry fast         |

**Prerequisites:** none (S-11 has no blockers per roadmap). Phase 1's migration must ship with the worker (`lessons.md:12-17`).
**Estimated effort:** ~1 session across 4 phases — mechanical, additive, well-mapped.

## Open Risks & Assumptions

- Adding `p_group_type` changes `create_manual_booking`'s signature identity → drop+recreate + re-grant, not `create or replace` (would leave a stale overload).
- Nullable column means every display/email site must handle NULL (render „—"); the plan enumerates each site.
- Assumes the project type-gen command reproduces `database.types.ts` cleanly — verify no diff drift beyond the new enum/column.

## Success Criteria (Summary)

- A guest can label their request by group type; submitting untyped is blocked.
- The owner sees the type where they decide (list, detail, notification email); untyped/phone/legacy rows render „—" without errors.
- No "nauczyciel" remains in the request flow, and every existing guest email + the cancel/accept/reject/withdraw flow behaves exactly as before.
