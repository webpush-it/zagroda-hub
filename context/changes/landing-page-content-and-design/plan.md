# Landing Page — Content & Design Implementation Plan

## Overview

Owner-primary copy + light-layout revision of the landing page (`src/pages/index.astro`).
The current hero opens with a whimsical, two-vignette first paragraph that reads as "śmieszny"
and buries the product's load-bearing promise (anti-overbooking) in a subordinate clause. This
plan rewrites the hero to name the audience + concrete outcome (Variant C — "maksymalna
jasność"), brings the whole page to one owner-first voice, and adds a guarantee/benefits section
as the social-proof substitute a no-testimonials MVP needs. All changes stay inside the "Łąka i
miód" token system and the `PageShell width="wide"` shell — this is copy/framing on the existing
structure, not a visual rebuild.

## Current State Analysis

- **Landing lives entirely in `src/pages/index.astro`** (120 lines). Structure today: PageShell
  wrapper (`:27-31`) → hero (`:33-65`) → "Jak to działa" 3-step grid (`:67-83`) → two persona
  cards (`:85-113`) → footer (`:116-118`). CTAs are state-aware via `Astro.locals.user` (`:4`).
- **The "śmieszny" hero** (`src/pages/index.astro:34-41`): `h1` is the bare brand "Zagroda Hub";
  lead `p` = "Telefon dzwoni, gdy karmisz zwierzęta. Nauczyciel obdzwania pół województwa…";
  sub `p` = "Zagroda Hub przenosi rezerwacje… do sieci — mobilnie… z gwarancją, że ten sam termin
  nie zostanie zarezerwowany dwa razy." Research diagnosed why it fails (`research.md:202-220`):
  narrowed pain, hyperbole ("pół województwa"), two disconnected vignettes with no thesis, the
  guarantee buried, tone mismatch.
- **Persona cards are teacher-first** (`:86` teacher card, `:95` owner card) — contradicts the
  owner-primary decision.
- **"Jak to działa" steps** (`:11-24`) describe the teacher→owner booking flow ("Znajdź zagrodę"
  / "Wyślij zapytanie" / "Właściciel akceptuje") — mixed POV, not owner-first.
- **Design system is fixed and sufficient** (`research.md:104-145`): tokens `brand-*`, `accent-*`,
  `ink`/`ink-muted`, `surface`, `edge`; utilities `bg-meadow`, `card-surface`, `btn-primary`,
  `btn-secondary`, `tap-target`. No landing-section utilities — sections are composed inline. No
  hero imagery; illustration is `ZagrodaPlaceholder` SVG only.
- **E2E locator coupling (load-bearing constraint):** `e2e/desktop-width.spec.ts:26,54` asserts
  a **level-1 heading named exactly "Zagroda Hub"** is visible on `/`. Moving the brand out of the
  H1 (our decision) breaks this assertion. `e2e/topbar-account-menu.spec.ts:69` uses a
  name-agnostic `getByRole("heading", { level: 1 }).first()` — unaffected. CI does **not** run
  e2e (`research.md:271-273`), so a broken locator fails silently until someone runs `test:e2e`
  locally — it must be updated as a deliberate plan step, not left to drift.
- **Verification commands** (package.json): `astro build` (`npm run build`), `eslint .`
  (`npm run lint`), `prettier --write .` (`npm run format`), `vitest run` (`npm test`),
  `playwright test` (`npm run test:e2e`, builds first).

## Desired End State

Visiting `/` (logged out), the owner reads a single-voice, owner-primary page:

1. An H1 that states the outcome ("Rezerwacje wycieczek do Twojej zagrody — w jednym miejscu,
   prosto z telefonu.") with the brand now carried by the Topbar logo, not the H1.
2. A subhead whose second sentence lands the anti-overbooking guarantee in plain Polish.
3. A primary CTA aimed at the owner ("Załóż konto zagrody") and a visually subordinate teacher
   link ("Szukasz zagrody na wycieczkę? →").
4. A guarantee/benefits section that makes the promise concrete and repeats the owner CTA.
5. "Jak to działa" and the persona cards speaking in the owner's voice, owner card first.

Verification: `npm run build`, `npm run lint`, `npm test` pass; grep-gates clean; the updated
`desktop-width.spec.ts` passes under `npm run test:e2e`; manual mobile-portrait eyeball shows the
new hero and section order with correct state-aware CTAs.

### Key Discoveries:

- Hero + all copy lives in one file: `src/pages/index.astro` (`research.md:222-236`).
- The single e2e coupling to update: `e2e/desktop-width.spec.ts:26` (`heading: "Zagroda Hub"`).
- Locked copy direction & wording (working): `research.md:276-297` (`## Decisions`).
- Grep-gate forbids starter/cosmic/purple idioms in `src/` (`research.md:266-268`).
- `PageShell width="wide"` must stay; `grep "min-h-screen" src/pages` must be 0 (`research.md:269`).
- CTA hrefs `/katalog` and `/auth/signup` must stay stable (booking/auth entry points).

## What We're NOT Doing

- No hero graphic / illustration / phone screenshot (typographic hero — decision).
- No sticky mobile bottom CTA (parked — decision).
- No icons at the steps/benefits; numbered chips stay (decision).
- No new React islands — landing stays SSR-only.
- No new design tokens, no visual rebuild, no theme changes.
- No changes to `/katalog`, `/auth/*`, or any route other than `/`.
- No claims that leak Non-Goals (no maps, payments, reviews, SMS, multi-zagroda, guest account) —
  `research.md:98-102`.
- No copy that relies on PL-market specifics (dotacje/sezonowość) as the core promise.

## Implementation Approach

Edit `src/pages/index.astro` in three cohesive passes, each independently verifiable and each
leaving the page shippable. Phase 1 resolves the actual complaint (the hero) and is releasable on
its own; it also carries the one deliberate e2e-locator update because the H1 rename happens here.
Phases 2–3 bring the rest of the page into the same owner-first voice and add the best-practice
guarantee/benefits anatomy. All copy is Polish, in the source's practical/rural register
(`research.md:92-96`), and every benefit ladders back to the two hero promises (control from the
field + no double-booking).

## Critical Implementation Details

- **E2E heading contract (Phase 1).** `desktop-width.spec.ts` anchors the `/` width test on a
  level-1 heading whose name it hard-codes as "Zagroda Hub". When the H1 becomes the value-prop,
  update the `VARIANTS` entry for `/` (`desktop-width.spec.ts:26`) to the new H1 string **in the
  same phase** so the width contract keeps passing. The test only needs *a* stable level-1
  heading to anchor — the geometry assertions are unaffected. Keep exactly one `<h1>` on the page.
- **State-aware CTAs (all phases).** The hero, the persona owner-card, and the new repeated CTA
  all branch on `Astro.locals.user`: logged-in owners see "Przejdź do panelu" / "Zobacz
  zapytania" (existing labels, `:46-51`), logged-out see the signup/catalog CTAs. Preserve this
  branching in every CTA touched — don't render an owner-signup CTA to an already-logged-in owner.

## Phase 1: Hero rewrite + metadata + e2e locator

### Overview

Replace the hero copy and hierarchy so the page states what it is and for whom, lead the
guarantee, and set owner-primary CTAs. Update page metadata to match, and update the single e2e
heading locator the H1 rename affects.

### Changes Required:

#### 1. Hero section

**File**: `src/pages/index.astro`

**Intent**: Make the value proposition the H1 (Variant C), drop the bare brand from the H1
(Topbar carries the brand), lead the subhead's second sentence with the anti-overbooking
guarantee, and set the CTA pair to owner-primary + subordinate teacher link. Preserve the
state-aware `Astro.locals.user` branching.

**Contract**: `<h1>` text → "Rezerwacje wycieczek do Twojej zagrody — w jednym miejscu, prosto z
telefonu." (working wording, final subject to product-owner approval). Lead/sub `<p>` → the
Variant C subhead (`research.md:288-290`). Logged-out CTA row: primary `btn-primary` "Załóż konto
zagrody" → `/auth/signup`; secondary a subordinate text link "Szukasz zagrody na wycieczkę? →" →
`/katalog` (may drop `btn-secondary` box for a lighter link treatment, still `tap-target`).
Logged-in branch unchanged ("Przejdź do panelu" → `/dashboard`, "Zobacz zapytania" →
`/dashboard/zapytania`). Keep exactly one `<h1>`; reuse existing hero classes
(`text-brand-700 … text-4xl sm:text-5xl lg:text-6xl font-extrabold`).

#### 2. Page metadata

**File**: `src/pages/index.astro`

**Intent**: Align the `PageShell` `title`/`description` with the owner-primary essence so the tab
title and OG/meta description match the new hero (they currently describe both personas evenly).

**Contract**: `PageShell` `title` and `description` props (`:28-29`) updated to owner-primary
copy naming the outcome + guarantee; keep `width="wide"`.

#### 3. Desktop width e2e locator

**File**: `e2e/desktop-width.spec.ts`

**Intent**: Keep the `/` width-contract test anchored after the H1 rename — deliberate locator
update routed through this PR (healer rule: changed heading → update locator, don't silently
break).

**Contract**: `VARIANTS` entry `{ path: "/", heading: "Zagroda Hub", cap: 1152 }` (`:26`) →
`heading` set to the new H1 string. No other line changes; `cap` and geometry assertions stay.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Lint passes: `npm run lint`
- Format check clean: `npx prettier --check src/pages/index.astro e2e/desktop-width.spec.ts`
- Grep-gate clean: `grep -rnE "bg-cosmic|backdrop-blur|from-blue-200|bg-clip-text|text-blue-100|bg-white/(5|10)|purple-" src/pages/index.astro` returns nothing
- Single H1 invariant: `grep -c "<h1" src/pages/index.astro` returns 1
- No `min-h-screen` in pages: `grep -rn "min-h-screen" src/pages` returns nothing
- Desktop width e2e passes: `npm run test:e2e -- desktop-width.spec.ts`

#### Manual Verification:

- On a mobile-portrait viewport (logged out), the hero reads as one owner-primary thesis: H1
  states the outcome, subhead's second sentence lands the guarantee, primary CTA is "Załóż konto
  zagrody", teacher link is clearly subordinate.
- Logged-in owner sees the panel CTAs, not the signup CTA.
- Tab title and link-preview description reflect the new positioning.

**Implementation Note**: After automated verification passes, pause for human confirmation of the
manual testing before proceeding to Phase 2.

---

## Phase 2: Owner-first supporting copy

### Overview

Bring the two existing lower sections into the owner's voice and owner-first order so the whole
page is consistent with the new hero.

### Changes Required:

#### 1. "Jak to działa" steps

**File**: `src/pages/index.astro`

**Intent**: Reframe the 3-step `steps` array from the mixed teacher→owner flow to the owner's
flow, so the section explains the product from the primary persona's side while still making the
teacher's role legible.

**Contract**: `steps` array (`:11-24`) — three `{ title, body }` entries rewritten to the owner
journey (publish → receive requests → accept without overbooking risk), plain-Polish register.
Section markup, numbered `bg-brand-600` chips, and grid classes unchanged.

#### 2. Persona cards — owner first

**File**: `src/pages/index.astro`

**Intent**: Reorder the two persona cards so the owner card comes first (owner-primary) and
refresh both blurbs to the new voice; keep the teacher card as a clear secondary path.

**Contract**: Swap the order of the two `card-surface` blocks in the persona `<section>`
(`:86-113`) so "Prowadzisz zagrodę?" precedes "Szukasz zagrody na wycieczkę?"; refresh body copy;
preserve the owner card's state-aware CTA branch (`:101-111`) and the teacher card's `/katalog`
CTA. Grid stays `md:grid-cols-2`.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Lint passes: `npm run lint`
- Format check clean: `npx prettier --check src/pages/index.astro`
- Full e2e still green: `npm run test:e2e`

#### Manual Verification:

- "Jak to działa" reads from the owner's side and matches the hero voice.
- Owner persona card appears first on both mobile (stacked) and desktop (2-col); teacher card is
  present and its "Przeglądaj zagrody" CTA still reaches `/katalog`.

**Implementation Note**: After automated verification passes, pause for human confirmation of the
manual testing before proceeding to Phase 3.

---

## Phase 3: Guarantee/benefits section + repeated CTA

### Overview

Add the best-practice anatomy piece a no-testimonials MVP needs: a section that makes the
anti-overbooking guarantee concrete alongside 2–3 owner benefits, plus a repeated primary owner
CTA before the footer.

### Changes Required:

#### 1. Guarantee / benefits section

**File**: `src/pages/index.astro`

**Intent**: Introduce a new section (placed after the hero, before or after "Jak to działa") that
states the guarantee in plain language and lists 2–3 concrete owner benefits (control from the
field / one calendar, no paper / no double-booking / one-tap accept), acting as the social-proof
substitute. Numbered/plain layout — no icons, no new tokens.

**Contract**: New `<section>` composed from existing utilities (`card-surface` or `bg-surface`
insets, `text-ink`/`text-ink-muted`, `py-12` rhythm, `grid gap-6`). Benefit copy ladders back to
the two hero promises; guarantee phrased per `research.md:84-90` (per-day limit, "ten sam dzień
nie zostanie zarezerwowany ponad Twój limit"). No claims from the Non-Goals list.

#### 2. Repeated owner CTA

**File**: `src/pages/index.astro`

**Intent**: Repeat the primary owner CTA near the end of the page (before the footer) so the
owner action is reachable after scrolling — state-aware like the hero.

**Contract**: A CTA block reusing `btn-primary` "Załóż konto zagrody" → `/auth/signup` (logged
out) / "Przejdź do panelu" → `/dashboard` (logged in), placed before the footer (`:116`). Keeps
`tap-target` sizing.

### Success Criteria:

#### Automated Verification:

- Build passes: `npm run build`
- Lint passes: `npm run lint`
- Format check clean: `npx prettier --check src/pages/index.astro`
- Single H1 invariant still holds: `grep -c "<h1" src/pages/index.astro` returns 1
- Grep-gate clean on the file (same pattern as Phase 1)
- Full e2e still green: `npm run test:e2e`

#### Manual Verification:

- The guarantee section reads as concrete and credible (not vague), no Non-Goal claims leak in.
- The repeated CTA is state-aware and reachable on a phone without excessive scrolling; no visual
  overlap with the footer.
- Whole page (top to bottom) reads in one owner-first voice on mobile portrait, one-handed.

**Implementation Note**: After automated verification passes, pause for final human confirmation.

---

## Testing Strategy

### Unit Tests:

- None required — this is static SSR copy/markup with no logic branch beyond the pre-existing
  `Astro.locals.user` conditional (already covered by rendering).

### Integration / E2E Tests:

- `e2e/desktop-width.spec.ts` — the `/` width contract must keep passing after the H1 rename
  (locator updated in Phase 1).
- `npm run test:e2e` full suite green after each phase — the landing has no other dedicated
  locators, so the risk surface is the desktop-width heading only, but run the full suite to catch
  any incidental coupling (e.g. topbar heading `.first()` still resolves).

### Manual Testing Steps:

1. `npm run dev`, open `/` logged out on a 320–390px portrait viewport; read the hero — confirm
   it states audience + outcome and the guarantee, no hyperbole, one voice.
2. Log in as an owner; reload `/`; confirm all CTAs switch to the panel variants.
3. Scroll the full page; confirm section order, owner-first persona card, guarantee section, and
   repeated CTA; confirm no horizontal overflow and no footer overlap.
4. Check the browser tab title and (if testing OG) the link-preview description reflect the new
   positioning.

## Performance Considerations

Typographic hero, no new images, no React islands — LCP is unaffected (protects the rural-mobile
budget). The added section is static markup with negligible cost.

## Migration Notes

None — no data, schema, or route changes. Pure SSR copy/markup edit plus one test-locator update.

## References

- Research: `context/changes/landing-page-content-and-design/research.md` (see `## Decisions`,
  `research.md:276-297`)
- Current landing: `src/pages/index.astro:1-120`
- E2E coupling: `e2e/desktop-width.spec.ts:26,54`
- Design tokens/utilities: `src/styles/global.css:16-48`, `:160-227`
- PageShell contract: `src/components/PageShell.astro:7-21`
- Prior landing work: `context/archive/2026-06-15-landing-page-redesign/plan.md`
- Rebrand tokens & grep-gates: `context/archive/2026-07-12-new-user-interface/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Hero rewrite + metadata + e2e locator

#### Automated

- [x] 1.1 Build passes: `npm run build` — f3f67a3
- [x] 1.2 Lint passes: `npm run lint` — f3f67a3
- [x] 1.3 Format check clean on index.astro + desktop-width.spec.ts — f3f67a3
- [x] 1.4 Grep-gate clean on index.astro — f3f67a3
- [x] 1.5 Single H1 invariant (`grep -c "<h1"` = 1) — f3f67a3
- [x] 1.6 No `min-h-screen` in `src/pages` — f3f67a3
- [x] 1.7 Desktop width e2e passes — f3f67a3

#### Manual

- [x] 1.8 Hero reads as one owner-primary thesis on mobile portrait — f3f67a3
- [x] 1.9 Logged-in owner sees panel CTAs, not signup CTA — f3f67a3
- [x] 1.10 Tab title + preview description reflect new positioning — f3f67a3

### Phase 2: Owner-first supporting copy

#### Automated

- [x] 2.1 Build passes: `npm run build` — 57abf8e
- [x] 2.2 Lint passes: `npm run lint` — 57abf8e
- [x] 2.3 Format check clean on index.astro — 57abf8e
- [x] 2.4 Full e2e suite green — 57abf8e

#### Manual

- [x] 2.5 "Jak to działa" reads owner-first and matches hero voice — 57abf8e
- [x] 2.6 Owner card first on mobile + desktop; teacher CTA still reaches `/katalog` — 57abf8e

### Phase 3: Guarantee/benefits section + repeated CTA

#### Automated

- [x] 3.1 Build passes: `npm run build`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 Format check clean on index.astro
- [x] 3.4 Single H1 invariant still holds
- [x] 3.5 Grep-gate clean on index.astro
- [x] 3.6 Full e2e suite green

#### Manual

- [x] 3.7 Guarantee section concrete/credible, no Non-Goal claims leak
- [x] 3.8 Repeated CTA state-aware, reachable on phone, no footer overlap
- [x] 3.9 Whole page reads in one owner-first voice, one-handed on mobile
