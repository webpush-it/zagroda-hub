# Landing klient-first (S-09) — Plan Brief

> Full plan: `context/changes/client-first-landing/plan.md`

## What & Why

Flip the public home page (`/`) from owner-first to **client-first** (FR-019). Today the landing speaks to the zagroda owner ("Rezerwacje wycieczek do **Twojej** zagrody", primary CTA „Załóż konto zagrody") and the seeker — the demand side the whole catalog depends on — gets only a faint text link. The owner's own feedback asked for the inversion, almost verbatim: *"logo, powitanie, na środku 'Znajdź zagrodę', logowanie na dole"*.

## Starting Point

`src/pages/index.astro` is a hand-rolled, owner-heavy page: owner-voice hero, „Jak to działa" steps, an anti-overbooking guarantee section, a 2-col persona grid, and a repeated owner CTA. The catalog it should point to already exists at `/katalog` (anonymous browse + inquiry). The topbar already shows Katalog / Zaloguj się / Zarejestruj się to guests as plain text links.

## Desired End State

A guest on `/` sees, top-down: brand + a seeker greeting, a centered **„Znajdź zagrodę"** button → `/katalog`, a short "browse without an account" blurb, then ONE consolidated **„Prowadzisz zagrodę?"** owner section with its CTA, then a login/register prompt, then the footer. The guest topbar shows „Znajdź zagrodę" as an emphasized CTA button (desktop + mobile drawer). Logged-in owners see the same client-first page with a reachable „Przejdź do panelu", and their topbar is unchanged. Purely presentational — no backend behavior changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Overall layout | Greeting + centered „Znajdź zagrodę" + owner section lower + login at bottom | Specified 1:1 by owner feedback | Frame/shape-notes |
| Owner-education content | Consolidate the 3 owner blocks into one „Prowadzisz zagrodę?" section | Client-first page; supply comes via direct channels, not the landing | Plan |
| Client hero depth | CTA + short value blurb (optional compact 3-point strip) | Clear next step + reassurance without clutter | Plan |
| Logged-in owner on `/` | Client-first for all; owner gets „Przejdź do panelu" in the owner section (no redirect) | One consistent page; panel still one tap away | Plan |
| Topbar | Promote guest „Katalog" → „Znajdź zagrodę" CTA button (owner payload unchanged) | Reinforce the client-first CTA everywhere | Plan |
| Geolocation / distance sort | Out — that's S-10 | FR-019 is the landing flip only | Roadmap |

## Scope

**In scope:** rewrite `src/pages/index.astro` to client-first; promote the guest topbar CTA in `Topbar.astro` + `TopbarMobileMenu.tsx`.

**Out of scope:** catalog/detail/inquiry pages, any API/route/DB, auth flows & middleware (no owner redirect), geolocation/nearest-sort (S-10), new design-system components, logged-in owner topbar payload.

## Architecture / Approach

Two independent presentational phases. Phase 1 rewrites the home page in place, keeping the existing `Astro.locals.user` branching so logged-in owners keep panel CTAs. Phase 2 adds a lightweight per-link `cta` flag to the shared topbar `links` payload that both the desktop nav and the mobile drawer render as a button. Reuses existing `btn-primary`/`btn-secondary`/`card-surface`/`tap-target` utilities and `PageShell`; no new components.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Client-first landing | `index.astro` rewritten: seeker hero + „Znajdź zagrodę" CTA, consolidated owner section, bottom login/register | Copy/layout balance — keeping it client-first without losing owner value prop |
| 2. Topbar CTA | Guest „Znajdź zagrodę" button on desktop + mobile drawer | Shared nav touches every page — regression surface across the app |

**Prerequisites:** none (`/katalog` already exists; S-09 is parallel with S-08/S-10/S-11/S-12).
**Estimated effort:** ~1 short session across 2 phases.

## Open Risks & Assumptions

- Assumes the catalog (`/katalog`) is the correct „Znajdź zagrodę" destination for now; geolocation entry arrives in S-10 without changing this CTA.
- Consolidating owner content trims some sales copy — accepted per PRD (supply via direct channels, not the landing).
- Topbar edit is shared across all pages; Phase 2 manual check must confirm no layout/nav regression elsewhere.

## Success Criteria (Summary)

- A guest reaches the catalog in one tap from the top of `/` via a centered „Znajdź zagrodę" CTA (page + topbar).
- Owners still find their value prop and panel access; logged-in owner topbar is unchanged.
- `npx astro check`, `npm run lint`, `npm run build`, and `npm test` all pass; no regressions on other pages.
