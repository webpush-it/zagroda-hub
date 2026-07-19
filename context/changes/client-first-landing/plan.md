# Landing klient-first (S-09) Implementation Plan

## Overview

Flip the public home page (`/`) from owner-first to **client-first** per FR-019: a greeting plus a centered **„Znajdź zagrodę"** CTA that links to the existing catalog (`/katalog`), a short client-value blurb, the owner marketing consolidated into a single **„Prowadzisz zagrodę?"** section lower on the page with its own CTA, and login/register at the bottom. Additionally, promote the guest topbar's plain „Katalog" link into an emphasized **„Znajdź zagrodę"** CTA button (desktop + mobile drawer). This is a purely presentational change — no data, API, route, or auth-flow changes. Roadmap S-09; PRD FR-019, US-04.

## Current State Analysis

- **Home `/` is owner-first today** (`src/pages/index.astro`). Hero speaks in owner voice ("Rezerwacje wycieczek do **Twojej** zagrody", `index.astro:36-38`), the primary CTA is „Załóż konto zagrody" → `/auth/signup` (`:59`), and the client path is only a muted text link „Szukasz zagrody na wycieczkę? →" → `/katalog` (`:62-64`, class `teacherLink`). Owner-education dominates: „Jak to działa" 3 steps (`:71-87`, data `:13-26`), „Bez podwójnych rezerwacji — gwarantowane" guarantee + 3 benefit cards (`:89-119`), a 2-col persona grid (`:121-149`), and a repeated owner-only CTA (`:151-167`), then footer (`:169-172`).
- **The „Znajdź zagrodę" destination already exists**: `/katalog` (`src/pages/katalog.astro`). Guests browse and send inquiries without an account. So the new main CTA simply links to `/katalog`.
- **Topbar** (`src/components/Topbar.astro`) already carries login/register for guests: link payload switches on `Astro.locals.user` (`:13-23`) — logged-out guests see „Katalog" (`/katalog`), „Zaloguj się" (`/auth/signin`), „Zarejestruj się" (`/auth/signup`), all as plain `navLink` text links (`:9`). Logged-in owners see „Katalog", „Panel", „Zapytania". The same `links` payload feeds the desktop inline nav and the `TopbarMobileMenu` drawer island (`:45`; drawer renders links at `TopbarMobileMenu.tsx:129-133`, `drawerLink` class `:77`).
- **Auth state**: both `index.astro` and `Topbar.astro` branch on `Astro.locals.user` (populated by `src/middleware.ts:6-25`). `/` and `/katalog` are public; only `/dashboard*` is protected.
- **Shared building blocks**: `PageShell` (`src/components/PageShell.astro`, props `title/description/width/align/showTopbar/brand`); CSS utilities `btn-primary`/`btn-secondary`/`card-surface`/`tap-target` (`src/styles/global.css`). No hero/section component — sections are hand-rolled with utility classes. `src/components/brand/Logo.astro` exists (used by PageShell `brand` prop).

### Key Discoveries:

- The catalog CTA target `/katalog` already accepts anonymous browse + inquiry — no new route or backend needed (`src/pages/katalog.astro:109`, `src/pages/zagrody/[id].astro:3`).
- The owner's requested layout is specified almost verbatim in shape-notes: *"logo, powitanie, na środku 'Znajdź zagrodę', logowanie na dole"* (`context/foundation/shape-notes.md:56`) and *"hero i główne CTA dla szukającego + mocna sekcja „Prowadzisz zagrodę?" niżej"* (`:30`).
- Topbar and its mobile drawer share ONE `links` array (`Topbar.astro:13-23` → drawer `:45`); to promote a CTA cleanly, the guest entry needs a per-link style flag both surfaces honor, rather than duplicating markup.
- Geolocation / nearest-sorting is explicitly a separate slice (S-10, `nearest-zagrody-sort`); FR-019 for S-09 is the landing flip only — the CTA lands on the catalog as-is.

## Desired End State

A guest opening `/` sees, top to bottom: the brand, a welcoming greeting aimed at someone looking for a zagroda, a centered primary **„Znajdź zagrodę"** button → `/katalog`, and a short reassurance line (browse without an account, send an inquiry). Below that, a single consolidated **„Prowadzisz zagrodę?"** owner section carrying the essential owner value prop and its CTA (guests → „Załóż konto zagrody"; logged-in owners → „Przejdź do panelu"). At the bottom, a clear login/register prompt for owners, then the footer. The topbar shows an emphasized **„Znajdź zagrodę"** CTA for guests (desktop + mobile drawer) in place of the plain „Katalog" link; the logged-in owner topbar is unchanged. Everything is Polish, mobile-first, 44 px tap targets, single column on phones. No backend behavior changes.

## What We're NOT Doing

- No geolocation, „najbliższe zagrody", or distance sorting — that is S-10 (`nearest-zagrody-sort`). The CTA links to `/katalog` unchanged.
- No changes to the catalog page, zagroda detail page, inquiry form, or any API/route.
- No changes to auth flows, middleware, or protected-route behavior (a logged-in owner still sees `/` — no redirect to `/dashboard`).
- No new hero/section component or design-system additions — reuse existing utilities.
- No changes to the logged-in owner topbar payload (Katalog/Panel/Zapytania stay as-is).
- No new copy for the catalog or owner onboarding beyond what fits the consolidated section.

## Implementation Approach

Two independent presentational phases, each verifiable on its own. Phase 1 rewrites `src/pages/index.astro` in place: reorder sections to client-first, rewrite hero copy to the seeker's voice, consolidate the three owner-education blocks into one „Prowadzisz zagrodę?" section, and add a bottom login/register prompt — keeping the existing `Astro.locals.user` branching so logged-in owners still get panel CTAs. Phase 2 promotes the guest topbar CTA by adding a lightweight per-link `cta` flag to the shared `links` payload that both the desktop nav and the mobile drawer render as a button-styled „Znajdź zagrodę"; the owner payload is untouched. Copy stays Polish and reuses `btn-primary`/`btn-secondary`/`card-surface`/`tap-target`.

## Phase 1: Client-first landing page

### Overview

Rewrite `src/pages/index.astro` so the seeker is the primary audience: greeting + centered „Znajdź zagrodę" CTA + short client blurb on top, one consolidated owner section lower, login/register at the bottom. Auth-aware CTAs preserved for logged-in owners.

### Changes Required:

#### 1. Home page rewrite

**File**: `src/pages/index.astro`

**Intent**: Invert the page hierarchy to client-first per FR-019 while consolidating the owner marketing into a single section and preserving owner CTAs for logged-in users.

**Contract**:

- **PageShell props** (`:29-33`): change `title` and `description` to the seeker's voice (e.g. title "Zagroda Hub — znajdź zagrodę edukacyjną na wycieczkę"; description about browsing zagrody and sending an inquiry without an account). Keep `width="wide"`. Optionally set `brand` so the logo appears above the greeting (matches shape-notes "logo, powitanie…").
- **Hero (client-first)**: replace the owner hero (`:34-69`) with a seeker greeting (H1 in the „znajdź zagrodę na wycieczkę" voice), a centered **primary** CTA „Znajdź zagrodę" → `/katalog` (class `btn-primary px-6 py-3 text-base`), and a short value blurb (1–2 lines: browse without an account, send an inquiry). This is the visual center of the page. For a logged-in owner, additionally surface a secondary „Przejdź do panelu" → `/dashboard` link here (small/secondary — the client CTA stays primary for everyone per the "client-first for all" decision).
- **Consolidated owner section „Prowadzisz zagrodę?"**: collapse the three owner-education blocks (`:71-87` steps, `:89-119` guarantee+benefits, `:121-140` owner persona card) into ONE section lower on the page. Keep the strongest owner value prop (anti-overbooking guarantee, phone-first management) in compact form and its CTA: guest → „Załóż konto zagrody" (`/auth/signup`, `btn-primary`); logged-in owner → „Przejdź do panelu" (`/dashboard`). The existing `steps` array and benefit cards may be trimmed or dropped to keep this to one focused section.
- **Client "how it works" (optional, compact)**: per the "CTA + short value blurb" decision, a compact 3-point strip for the seeker is allowed but must stay lighter than the owner section — do not mirror the full owner steps.
- **Bottom login/register prompt**: add a small section before the footer with a login/register prompt for owners — links „Zaloguj się" (`/auth/signin`) and „Zarejestruj się" (`/auth/signup`). Render for guests only (a logged-in user already has the AccountMenu); hide when `user` is set.
- **Footer** (`:169-172`): unchanged.
- Remove the now-unused `teacherLink`/`secondaryBtn` aliases if they no longer appear; keep whatever classes the new markup uses.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx astro check`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- Full test suite passes: `npm test`

#### Manual Verification:

- On a 320–414 px viewport, `/` as a guest shows: brand/greeting, a centered „Znajdź zagrodę" button as the visual focus, a short client blurb, then the „Prowadzisz zagrodę?" section, then a login/register prompt — reaching the catalog is one tap from the top.
- „Znajdź zagrodę" navigates to `/katalog`; owner CTA („Załóż konto zagrody") navigates to `/auth/signup`.
- As a logged-in owner, `/` shows the same client-first hero plus a „Przejdź do panelu" path; the bottom login/register prompt is hidden.
- Copy is Polish throughout; no owner-voice hero („Twojej zagrody") remains at the top.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before Phase 2. Phase blocks use plain bullets — checkbox state lives in `## Progress`.

---

## Phase 2: Topbar „Znajdź zagrodę" CTA

### Overview

Promote the guest topbar's plain „Katalog" link into an emphasized „Znajdź zagrodę" CTA button, on both the desktop inline nav and the mobile drawer, without touching the logged-in owner payload.

### Changes Required:

#### 1. Guest link payload + shared CTA styling

**File**: `src/components/Topbar.astro`

**Intent**: Relabel/emphasize the guest catalog entry as the client-first CTA, driven by a per-link flag so both nav surfaces render it consistently.

**Contract**:

- In the guest branch of the `links` payload (`:19-23`), change the catalog entry's label to „Znajdź zagrodę" (target stays `/katalog`) and add a flag marking it as the CTA (e.g. `cta: true`). Leave „Zaloguj się"/„Zarejestruj się" as plain links. The logged-in owner payload (`:14-18`) is unchanged — „Katalog" stays a plain link.
- In the desktop inline nav render (`:34-43`), render a `cta`-flagged link with a button style (`btn-primary` sizing consistent with the topbar height, or `btn-secondary` if primary is too heavy against the header) instead of the `navLink` text style; non-CTA links keep `navLink`.
- Keep the type of the `links` array items consistent so the mobile drawer (which receives the same payload) can read the `cta` flag.

#### 2. Mobile drawer honors the CTA flag

**File**: `src/components/TopbarMobileMenu.tsx`

**Intent**: Render the same „Znajdź zagrodę" CTA as an emphasized button inside the mobile drawer.

**Contract**: Where the drawer maps `links` (`:129-133`), branch on the new `cta` flag: render the flagged link with a button style (reuse `btn-primary`/`btn-secondary` + full-width, 44 px) instead of the `drawerLink` text class (`:77`); other links unchanged. Update the `links` prop type to include the optional `cta` flag (mirror the `Topbar.astro` item shape).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx astro check`
- Lint passes: `npm run lint`
- Production build succeeds: `npm run build`
- Full test suite passes: `npm test`

#### Manual Verification:

- As a guest, the topbar shows „Znajdź zagrodę" as an emphasized button (desktop) and as a full-width button in the mobile drawer, linking to `/katalog`; „Zaloguj się"/„Zarejestruj się" remain plain links.
- As a logged-in owner, the topbar is unchanged (Katalog/Panel/Zapytania as before).
- The CTA is a 44 px tap target and does not break the topbar layout at 320–414 px or on desktop.

**Implementation Note**: Pause for manual confirmation; this phase completes S-09.

---

## Testing Strategy

### Unit Tests:

- No new unit tests required — the change is presentational Astro/TSX with no logic branches beyond existing `user` gating. Existing suites must stay green.

### Integration Tests:

- None specific to this slice. `npm test` (vitest: db + api + unit) must pass unchanged — this change touches no API/DB.

### Manual Testing Steps:

1. Guest `/` on a 320–414 px viewport: confirm client-first order (greeting → centered „Znajdź zagrodę" → blurb → „Prowadzisz zagrodę?" → login/register → footer) and that the catalog is one tap from the top.
2. Click „Znajdź zagrodę" (page + topbar) → lands on `/katalog`.
3. Logged-in owner `/`: client-first hero + reachable „Przejdź do panelu"; bottom login/register prompt hidden; owner topbar unchanged.
4. Owner CTA „Załóż konto zagrody" → `/auth/signup`; „Zaloguj się" → `/auth/signin`.
5. Topbar CTA renders as a button on desktop and full-width in the mobile drawer without layout breakage.
6. Spot-check other pages (catalog, dashboard) still render the topbar correctly after the shared-nav change (FR: no regression).

## Performance Considerations

None. Static presentational markup; no new queries, islands, or client JS beyond the existing `TopbarMobileMenu` island (already hydrated).

## Migration Notes

No schema or data changes. Ships via the standard worker deploy (`npm run deploy` / CI on master). No migration, no rollback path needed beyond reverting the two files. Backwards-compatible: no contract changes for any consumer.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-09)
- PRD: `context/foundation/prd-v2.md` (FR-019, US-04)
- Shape-notes layout intent: `context/foundation/shape-notes.md:30,56,97,107`
- Current home page: `src/pages/index.astro:34-172`
- Catalog destination: `src/pages/katalog.astro:109`
- Topbar + mobile drawer: `src/components/Topbar.astro:13-45`, `src/components/TopbarMobileMenu.tsx:129-133`
- UI utilities: `src/styles/global.css` (`btn-primary` :180, `btn-secondary` :207, `card-surface` :167, `tap-target` :232)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Client-first landing page

#### Automated

- [x] 1.1 Typecheck passes: `npx astro check` — dbf5563
- [x] 1.2 Lint passes: `npm run lint` — dbf5563
- [x] 1.3 Production build succeeds: `npm run build` — dbf5563
- [x] 1.4 Full test suite passes: `npm test` — dbf5563

#### Manual

- [x] 1.5 Guest `/` on mobile: client-first order, catalog one tap from top — dbf5563
- [x] 1.6 „Znajdź zagrodę" → `/katalog`; „Załóż konto zagrody" → `/auth/signup` — dbf5563
- [x] 1.7 Logged-in owner: client-first hero + panel path; bottom login/register hidden — dbf5563
- [x] 1.8 Polish copy throughout; no owner-voice hero at the top — dbf5563

### Phase 2: Topbar „Znajdź zagrodę" CTA

#### Automated

- [x] 2.1 Typecheck passes: `npx astro check`
- [x] 2.2 Lint passes: `npm run lint`
- [x] 2.3 Production build succeeds: `npm run build`
- [x] 2.4 Full test suite passes: `npm test`

#### Manual

- [x] 2.5 Guest topbar: „Znajdź zagrodę" button (desktop + full-width mobile drawer) → `/katalog`; login/register plain links
- [x] 2.6 Logged-in owner topbar unchanged
- [x] 2.7 CTA is a 44 px tap target; no layout breakage at 320–414 px or desktop
