# Catalog Browse and Zagroda Page (S-02) — Plan Brief

> Full plan: `context/changes/catalog-browse-and-zagroda-page/plan.md`

## What & Why

The guest-facing read side of Zagroda Hub: a public catalog where a teacher browses published zagrody, filters by województwo + miasto (AND) and optionally by trip date + group size, and opens a single zagroda's profile page. This is the teacher's answer to "where is it even worth calling?" — the browse half of US-02 (FR-001/002/003). The booking form itself is the next slice (S-03).

## Starting Point

S-01 delivered the data layer only: published zagrody + turnusy are anon-readable via RLS, but no guest page exists. Crucially, anon has **no** read access to `booking_requests`, so the "free spots on date X" computation needs a new aggregate-only DB surface; the occupancy math and its supporting index already exist inside `accept_booking_request` (F-01).

## Desired End State

A teacher on a phone goes `/` → Katalog → filters the list; zagrody without enough free spots on her date stay visible but muted with a "Brak wolnych miejsc" badge (not clickable), sorted below available ones. Tapping a card opens `/zagrody/[id]` with photo, description, lokalizacja, dzienny limit, and turnusy. Filter state lives in the URL. All of it live in production.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Unavailable zagrody in results | Show, marked "Brak wolnych miejsc" (not hidden) | Teacher sees the full landscape and can try another date. |
| Filter architecture | Pure SSR + URL query params, GET form, no React island | Shareable URLs, works without JS, matches established SSR pattern, easiest <2 s p95. |
| City filter input | Select of distinct cities from published zagrody, narrowed by województwo | Exact-match AND semantics, zero typo dead-ends despite free-text source data. |
| Detail page scope | Full public profile incl. turnusy + dzienny limit | S-03's form needs turnusy on this page anyway — build the layout once. |
| Partial availability input | Date alone works (osoby defaults to 1); osoby without date ignored/disabled | Every input state has a sensible meaning — no validation dead-ends on mobile. |
| Sort order | Available first, then newest | Actionable results surface first; freshness boosts new zagrody. |
| Pagination | None — defensive LIMIT 100 | Catalog stays ≤~50 zagrody until v2 moderation kicks in. |
| Availability read mechanism | New SECURITY DEFINER RPC `catalog_zagrody`, anon-callable, returns only an `is_available` boolean | Anon can't read `booking_requests`; aggregates-only exposure keeps guest data private. |
| Test coverage | DB integration tests + manual mobile walkthrough | Locks the security/domain layer in code; SSR markup is low-risk. |

## Scope

**In scope:** `catalog_zagrody` RPC migration + types + `tests/db/catalog.test.ts`; `/katalog` page (filters, cards, badge, empty state, two inline enhancement scripts); homepage/topbar links; `/zagrody/[id]` detail page with 404 handling; production deploy.

**Out of scope:** booking form (S-03), pagination, maps, name search, city normalization, occupancy numbers exposure, owner draft preview, availability widget on detail page.

## Architecture / Approach

One additive migration adds the SECURITY DEFINER catalog RPC (publish gate + AND filters + per-day occupancy boolean + two-tier sort + LIMIT 100, riding the existing partial index). Both pages are pure SSR Astro: frontmatter queries (RPC for the list, RLS selects with explicit `is_published = true` for cities/detail — guarding against the authenticated-owner-sees-own-draft RLS quirk), Polish copy, mobile-first markup, no React islands.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DB surface | `catalog_zagrody` RPC + tests locking privacy & occupancy semantics | SECURITY DEFINER bypasses RLS — must self-enforce publish filter and leak nothing |
| 2. Catalog page | `/katalog` with filters, badges, empty state, entry links | Filter param edge cases (partial input, invalid values) degrading UX |
| 3. Detail page + ship | `/zagrody/[id]` full profile, 404s, production deploy + smoke | Deploy ordering — migrations must reach prod DB before the worker (lessons.md) |

**Prerequisites:** F-01 + S-01 archived (done); local Supabase stack for tests.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- City spellings are owner-entered free text; case-insensitive dedup mitigates, but true duplicates ("Płock" vs "Plock") would appear as separate dropdown entries — accepted for MVP.
- The roadmap's open unknown ("is the availability filter the same read as F-01's rule?") is resolved: yes — same accepted-sum-per-day semantics, same index, reimplemented read-only in the RPC.

## Success Criteria (Summary)

- A guest (and a logged-in owner) sees exactly the published zagrody, filterable by location AND availability, in <2 s, on a phone held one-handed.
- No guest data fields are reachable from any anon-accessible surface — proven by `tests/db/catalog.test.ts`. Occupancy is exposed only as a derived `is_available` boolean (the count is inferable by repeated queries — accepted by design).
- Detail page renders the full public profile; drafts and unknown ids 404; the slice is live in production.
