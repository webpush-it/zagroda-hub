# Catalog Browse and Zagroda Page (S-02) Implementation Plan

## Overview

Build the guest-facing read side of Zagroda Hub: a public catalog page (`/katalog`) where an unauthenticated teacher browses published zagrody, filters by województwo + miasto (AND) and optionally by trip date + participant count (availability marking), and a public zagroda detail page (`/zagrody/[id]`) showing the full public profile. Covers FR-001, FR-002, FR-003 and the browse half of US-02. The booking form is S-03 and stays out of scope.

## Current State Analysis

- **No guest-facing pages exist.** `src/pages/` has only `index.astro` (hero), `dashboard.astro` (owner panel, protected), and `auth/*`. S-01 deliberately delivered only the data layer for the catalog.
- **RLS already lets anon read published zagrody + their turnusy** (`supabase/migrations/20260605200000_zagroda_profile_publication.sql:191-219`): `zagrody` SELECT for anon `using (is_published)`; `turnusy` via EXISTS on published parent. Authenticated users additionally see their **own** (incl. draft) rows — relevant gotcha below.
- **Anon has NO SELECT policy on `booking_requests`** (`20260605090307_domain_schema.sql:137-152` — insert-pending only; owner-scoped read). The availability filter's occupancy read (sum of accepted participants per zagroda per day) is therefore impossible via plain anon queries — it needs a new SECURITY DEFINER surface that exposes aggregates only.
- **Occupancy semantics are already defined** by `accept_booking_request` (`20260605094725_accept_booking_request.sql:73-81`): `coalesce(sum(participants_count),0)` over rows with `status = 'accepted'` for the given `zagroda_id` + `trip_date`, across all turnusy. The partial index `booking_requests_accepted_per_day_idx (zagroda_id, trip_date) WHERE status='accepted'` exists for exactly this read.
- **Conventions established by F-01/S-01:** SSR data fetch in Astro frontmatter (`src/pages/dashboard.astro:13-43`), Zod schemas + `fieldErrorsFromZod` in `src/lib/zagroda.ts`, `VOIVODESHIPS` constant (`src/lib/zagroda.ts:4-5`), Polish UX copy, photo public URLs via `storage.getPublicUrl` on the public `zagroda-photos` bucket, tests in `tests/db/*.test.ts` against local Supabase using `tests/helpers/supabase.ts` fixtures (`seedZagroda`, `seedBookingRequest`, `createAnonClient`, `createAdminClient`).
- **`zagrody.city` is free text** (no canonical list) — owner spellings may vary in case.
- **Deploy rule (lessons.md):** every schema-touching deploy runs `supabase db push` before `wrangler deploy` — `npm run deploy` and the CI deploy job already encode this.

## Desired End State

A teacher on a phone opens `/` → taps "Katalog" → sees all published zagrody (newest first). She filters by województwo (select), miasto (select narrowed to cities that actually have published zagrody in that województwo), and optionally a date + participant count — zagrody without enough free spots on that day stay in the list but are visually marked "Brak wolnych miejsc" and not clickable, sorted below available ones. Tapping an available card opens `/zagrody/[id]` with the full public profile: photo, name, description, lokalizacja, dzienny limit, and the turnusy list. Unknown or unpublished zagroda → HTTP 404 with a Polish message. Filter state lives in the URL (shareable). Everything ships to production with migrations applied before the worker.

### Key Discoveries:

- Anon occupancy read requires a SECURITY DEFINER RPC; no guest data fields ever — occupancy exposed only as a derived `is_available` boolean (the underlying count is inferable by repeated queries varying `p_participants` — accepted by design, inherent to FR-002) (`20260605090307_domain_schema.sql:137-152`).
- Occupancy math must mirror `accept_booking_request` exactly: only `status='accepted'` rows count (`20260605094725:73-81`).
- Authenticated-owner RLS leaks own drafts into plain selects (`20260605200000:195-197`) — catalog/detail/city queries must add explicit `is_published = true` predicates so an owner browsing the catalog sees the same thing as anon.
- `Constants.public.Enums.voivodeship` already drives the voivodeship select (`src/lib/zagroda.ts:4-5`, `src/db/database.types.ts:188-204`).
- `vitest.config.ts` runs `tests/**/*.test.ts` single-threaded against local Supabase with `tests/helpers/global-setup.ts` — new DB tests slot in with zero harness work.

## What We're NOT Doing

- Booking form / sending an inquiry (S-03 — FR-004 lives on the detail page later).
- Pagination or load-more — defensive LIMIT 100 only; paging is v2.
- Maps / GPS (PRD Non-Goals).
- Search by name / full-text search.
- City spelling normalization migration (case-insensitive matching mitigates; canonical city list is v2).
- Owner draft preview on the public detail page (own draft → 404, same as anon).
- Exposing occupancy counts publicly (only an `is_available` boolean leaves the DB; the count remains inferable via repeated boolean queries — accepted, no guest data is involved).
- Availability widget / date-picker on the detail page (catalog filter covers FR-002).
- New JSON API routes — pages are pure SSR; the two inline scripts are progressive enhancement only.

## Implementation Approach

One new migration adds an anon-callable `catalog_zagrody` SECURITY DEFINER RPC that owns the whole catalog query: publish filter, AND location filters, per-day occupancy aggregation into an `is_available` boolean, two-tier sort, LIMIT 100. The catalog page is a plain SSR Astro page driven by URL query params (GET form, no React island); the detail page is a plain SSR page over RLS-allowed selects. DB tests lock the privacy and occupancy semantics; UI is verified manually on mobile per the PRD guardrail.

## Critical Implementation Details

**Security shape of the RPC** — `catalog_zagrody` is SECURITY DEFINER and therefore bypasses RLS: it MUST filter `is_published = true` itself and MUST NOT return any `booking_requests` columns or aggregates beyond the derived `is_available` boolean. Follow the hardening pattern of `accept_booking_request` (`set search_path = ''`, explicit grants). Grant EXECUTE to `anon` and `authenticated`; revoke from `public`.

**Owner-draft leak via authenticated RLS** — any plain `.from("zagrody")` select on the public pages (cities dropdown, detail page) runs as the *visitor's* role; for a logged-in owner that includes their own draft. Every public-page query adds `.eq("is_published", true)` explicitly.

**Filter param semantics** — `osoby` without `data` is ignored server-side (and the input is rendered disabled until a date is set, with a tiny inline script enabling it client-side); `data` without `osoby` defaults participants to 1. Invalid params (unknown voivodeship, malformed or past date, osoby outside 1–1000) are silently dropped, never an error page — the form re-renders with whatever validated. The date input's `min` = today is client-side only; the server independently drops `data` earlier than today.

## Phase 1: DB Surface — `catalog_zagrody` RPC + Tests

### Overview

Create the anon-callable catalog query function and lock its privacy + occupancy semantics with integration tests, before any UI exists.

### Changes Required:

#### 1. Migration: catalog RPC

**File**: `supabase/migrations/<timestamp>_catalog_zagrody.sql` (new)

**Intent**: One SECURITY DEFINER function owning the catalog read: publish gate, location AND filters, availability boolean derived from accepted-bookings occupancy, two-tier sort, LIMIT 100. This is the only new DB surface S-02 adds.

**Contract**:

```sql
create or replace function public.catalog_zagrody(
  p_voivodeship public.voivodeship default null,
  p_city text default null,
  p_trip_date date default null,
  p_participants integer default 1
) returns table (
  id uuid, name text, description text,
  voivodeship public.voivodeship, city text, photo_path text,
  daily_limit integer, created_at timestamptz,
  is_available boolean   -- null when p_trip_date is null
)
language sql stable security definer set search_path = ''
```

Semantics the implementation must satisfy (tests in change #3 assert these):

- Only `is_published = true` rows ever returned.
- `p_voivodeship` / `p_city` filter with AND when non-null; city compares case-insensitively on trimmed values (`lower(trim(...))`).
- `p_participants` is coalesced/clamped to ≥ 1 (null or < 1 → 1).
- `is_available` = `occupied + p_participants <= daily_limit`, where `occupied` = `coalesce(sum(participants_count), 0)` over `booking_requests` with matching `zagroda_id`, `trip_date = p_trip_date`, `status = 'accepted'` — identical semantics to `accept_booking_request` (`20260605094725:73-81`); `null` when `p_trip_date` is null.
- Order: `is_available desc nulls first` (so date-filtered results put available first; unfiltered results are unaffected), then `created_at desc`; `limit 100`.
- `revoke execute … from public; grant execute … to anon, authenticated;`

#### 2. Regenerated DB types

**File**: `src/db/database.types.ts`

**Intent**: Pick up the new RPC so page code gets a typed `supabase.rpc("catalog_zagrody", …)` call.

**Contract**: `npm run db:types` after local migration apply; commit the diff (new function under `Functions`).

#### 3. Catalog DB tests

**File**: `tests/db/catalog.test.ts` (new)

**Intent**: Lock the security- and domain-critical behavior of the RPC in code, mirroring the style of `tests/db/visibility-rls.test.ts` and `acceptance-rule.test.ts` (lettered cases, fixtures from `tests/helpers/supabase.ts`).

**Contract**: Cases to cover (anon client unless noted):

- (a) anon RPC call returns published zagrody, never drafts;
- (b) drafts stay hidden from the RPC even for their owner (signed-in client);
- (c) voivodeship + city filter as AND; city matches case-insensitively;
- (d) no `p_trip_date` → `is_available` is null for all rows;
- (e) only `accepted` bookings count toward occupancy — `pending`, `rejected`, `cancelled_by_guest`, `withdrawn_by_owner` rows on the same day do not;
- (f) boundary: occupied + requested = limit → available; one more → unavailable;
- (g) date alone (participants defaulted to 1): a fully-booked zagroda is unavailable, one with a single free spot is available;
- (h) with a date filter, unavailable rows sort after available ones; within a tier, newest first;
- (i) result rows expose no guest data fields (shape check) and anon still cannot select `booking_requests` directly (regression assert alongside `rls.test.ts`).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly from scratch: `npx supabase db reset`
- Types regenerated and committed: `npm run db:types` produces no further diff
- All tests pass (new catalog suite + F-01/S-01 regressions): `npm test`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Supabase Studio spot-check: function exists, EXECUTE granted to anon/authenticated only, `search_path` pinned

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Catalog Page `/katalog`

### Overview

The SSR catalog page: URL-param-driven filters, result cards with availability badge, empty state, and entry links from the homepage.

### Changes Required:

#### 1. Filter param parsing + page query

**File**: `src/pages/katalog.astro` (new)

**Intent**: Parse and validate query params (`wojewodztwo`, `miasto`, `data`, `osoby`) in frontmatter, call `catalog_zagrody` via the locals/middleware-created client, and fetch the distinct city list for the dropdown. Invalid params are dropped silently (form re-renders with validated state); `osoby` without `data` is ignored.

**Contract**: URL shape `/katalog?wojewodztwo=<enum>&miasto=<string>&data=<YYYY-MM-DD>&osoby=<1-1000>`, all optional. Validation: `wojewodztwo` ∈ `VOIVODESHIPS` (`src/lib/zagroda.ts:5`), `data` parses as a real `YYYY-MM-DD` date and is not earlier than today (past dates silently dropped like any invalid param), `osoby` integer 1–1000. Cities dropdown source: `.from("zagrody").select("city, voivodeship").eq("is_published", true)` (explicit publish predicate — owner-draft gotcha), null/blank cities filtered out, deduplicated case-insensitively server-side, narrowed to the selected voivodeship when present. (The publish gate enforces non-null city/description only at publish time — a published row edited afterwards can carry nulls, so the page never trusts these fields.)

#### 2. Filter form + results list markup

**File**: `src/pages/katalog.astro` (same file), reusing `Layout.astro`, `Topbar.astro`, `cn()`; optionally a small `src/components/katalog/ZagrodaCard.astro`

**Intent**: Mobile-first (portrait, one-handed) GET form with Polish labels — voivodeship select, city select, date input (`min` = today), osoby number input (rendered `disabled` when no valid `data` param) — and the results list. Available zagroda → card linking to `/zagrody/[id]` with photo thumbnail (via `getPublicUrl` on `photo_path`, placeholder when null), name, miasto + województwo, short description excerpt. Missing city/description/voivodeship render as empty strings, never "null" (publish-time gate doesn't guarantee them post-edit). Unavailable (`is_available === false`) → same card visually muted, "Brak wolnych miejsc" badge, **not** wrapped in a link. Empty result set → "Brak wyników" message with a hint to broaden filters.

**Contract**: Pure SSR — no React island. Form method GET, action `/katalog`, fields named exactly as the URL params. Cards render `is_available === null || true` as clickable; `false` as badged + non-clickable.

#### 3. Progressive-enhancement inline scripts

**File**: `src/pages/katalog.astro` (same file, `<script>` blocks)

**Intent**: Two tiny vanilla scripts: (1) auto-submit the form on voivodeship change so the city dropdown re-narrows server-side; (2) enable/disable the osoby input when the date input gets/loses a value. No-JS fallback is fully functional (city list shows all published cities; server ignores osoby without data).

**Contract**: No framework code; behavior degrades gracefully without JS.

#### 4. Entry links to the catalog

**File**: `src/components/Welcome.astro`, `src/components/Topbar.astro`

**Intent**: US-02 starts "otwiera stronę główną → katalog" — add a prominent "Przeglądaj katalog" CTA in the hero and a "Katalog" link in the topbar so guests can reach `/katalog` from `/`.

**Contract**: Plain anchors to `/katalog`; follow existing styling of hero buttons / topbar links.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Test suite stays green: `npm test`

#### Manual Verification:

- Mobile (portrait, one-handed) walkthrough on local dev: `/` → catalog link → list of published zagrody, newest first
- Województwo + miasto filter works as AND; changing województwo narrows the city dropdown (auto-submit)
- Date + osoby filter: a zagroda with insufficient free spots shows muted with "Brak wolnych miejsc" badge, sorted below available ones, not clickable
- Date alone works (osoby treated as 1); osoby input disabled until a date is set
- Empty results show "Brak wyników"; filter state survives reload via URL (shareable link)
- No-JS check: form still filters end-to-end with scripts disabled

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Zagroda Detail Page `/zagrody/[id]` + Production Ship

### Overview

The public single-zagroda page with the full profile, proper 404 behavior, and the production deploy + smoke that closes the slice.

### Changes Required:

#### 1. Detail page

**File**: `src/pages/zagrody/[id].astro` (new)

**Intent**: SSR page fetching one published zagroda with nested turnusy and rendering the full public profile: photo (full-width, placeholder when null), name, description, lokalizacja (miasto, województwo), dzienny limit, and the turnusy list (label + HH:MM–HH:MM, sorted by `start_time`). Back link to `/katalog`. This page is where the S-03 booking form will later mount — keep the layout with that in mind, but build nothing for it.

**Contract**: Param `id` must parse as UUID, else 404. Query: `.from("zagrody").select("…, turnusy(id, label, start_time, end_time)").eq("id", id).eq("is_published", true).maybeSingle()` (explicit publish predicate — own drafts 404 too). Not found → `Astro.response.status = 404` + Polish "Nie znaleziono zagrody" state (link back to catalog). Time formatting follows the HH:MM transform used in `dashboard.astro` frontmatter.

#### 2. Production deploy

**File**: no code change — process step

**Intent**: Ship the slice per lessons.md: migrations reach the hosted DB before the worker.

**Contract**: `npm run deploy` (build → `supabase db push` → `wrangler deploy`) or merge to master with the CI deploy job. Bare `wrangler deploy` is a process violation for this schema-touching change.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Test suite stays green: `npm test`

#### Manual Verification:

- Mobile: catalog card → detail page shows photo, name, description, lokalizacja, dzienny limit, turnusy with time ranges
- Unknown UUID, non-UUID param, and unpublished/draft zagroda (incl. as its logged-in owner) → 404 page with Polish message
- Production smoke after deploy: `/katalog` lists real published zagrody, filters work, detail page opens, draft zagrody invisible

---

## Testing Strategy

### Unit Tests:

- None — no pure-function logic warrants isolated units; validation is exercised through the DB suite and manual page checks.

### Integration Tests:

- `tests/db/catalog.test.ts` (Phase 1, cases a–i): publish gate, owner-draft exclusion, AND filters, case-insensitive city, occupancy math per status, availability boundary, default participants, sort order, no-guest-data shape, anon `booking_requests` regression.
- Existing suites (`acceptance-rule`, `concurrency`, `rls`, `visibility-rls`, `publication-gate`) must stay green — the migration touches no existing objects, so any failure is a red flag.

### Manual Testing Steps:

1. Seed two published zagrody (different województwa/miasta) + one draft via the dashboard; verify catalog shows exactly the published two, newest first.
2. Filter by województwo, then miasto — verify AND narrowing and the auto-narrowed city dropdown.
3. Accept a booking filling a zagroda's daily limit for date D (via existing owner flow or SQL); filter by D + osoby — verify the badge, muting, non-clickability, and sort position.
4. Open a detail page; verify full profile incl. turnusy times; verify 404 for draft/unknown ids.
5. Disable JS; repeat steps 2–3 (minus auto-submit) — form must still work.
6. Post-deploy production smoke (step 1–4 condensed against the live site).

## Performance Considerations

- The catalog NFR (<2 s p95) is served by a single RPC round-trip; the occupancy aggregate rides the existing partial index `booking_requests_accepted_per_day_idx`. LIMIT 100 caps the payload.
- No client-side JS framework on either page — SSR HTML only, which is the cheapest path on mobile.

## Migration Notes

- One additive migration (new function only) — backwards-compatible; the old worker is unaffected during the deploy window, `wrangler rollback` stays safe.
- Deploy order per lessons.md: `supabase db push` before `wrangler deploy` (`npm run deploy` / CI deploy job).

## References

- Roadmap slice: `context/foundation/roadmap.md` S-02 (lines 106–117)
- PRD: FR-001/002/003, US-02, NFR catalog <2 s — `context/foundation/prd.md`
- Occupancy semantics: `supabase/migrations/20260605094725_accept_booking_request.sql:73-81`
- RLS baseline: `supabase/migrations/20260605200000_zagroda_profile_publication.sql:186-226`
- SSR fetch pattern: `src/pages/dashboard.astro:13-43`
- Constants/validation: `src/lib/zagroda.ts`
- Test fixtures: `tests/helpers/supabase.ts`
- Lessons honored: `context/foundation/lessons.md` (deploy ordering; lock-order rule not triggered — read-only slice)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB Surface — `catalog_zagrody` RPC + Tests

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 0c80143
- [x] 1.2 Types regenerated and committed: `npm run db:types` produces no further diff — 0c80143
- [x] 1.3 All tests pass (new catalog suite + regressions): `npm test` — 0c80143
- [x] 1.4 Linting passes: `npm run lint` — 0c80143
- [x] 1.5 Build passes: `npm run build` — 0c80143

#### Manual

- [x] 1.6 Studio spot-check: function exists, grants anon/authenticated only, search_path pinned — 0c80143

### Phase 2: Catalog Page `/katalog`

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 6cc6228
- [x] 2.2 Build passes: `npm run build` — 6cc6228
- [x] 2.3 Test suite stays green: `npm test` — 6cc6228

#### Manual

- [x] 2.4 Mobile walkthrough: `/` → catalog → published zagrody, newest first — 6cc6228
- [x] 2.5 Województwo + miasto AND filter; auto-narrowed city dropdown — 6cc6228
- [x] 2.6 Availability badge: muted, "Brak wolnych miejsc", below available, not clickable — 6cc6228
- [x] 2.7 Date alone works; osoby disabled until date set — 6cc6228
- [x] 2.8 Empty state "Brak wyników"; URL shareable — 6cc6228
- [x] 2.9 No-JS fallback filters end-to-end — 6cc6228

### Phase 3: Zagroda Detail Page `/zagrody/[id]` + Production Ship

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Build passes: `npm run build`
- [x] 3.3 Test suite stays green: `npm test`

#### Manual

- [x] 3.4 Mobile: detail page shows full profile incl. turnusy times
- [x] 3.5 404 for unknown UUID, non-UUID, and draft (incl. as owner)
- [ ] 3.6 Production deploy via `npm run deploy` / CI (migrations before worker) + live smoke
