# Landing Page — Content & Design — Plan Brief

> Full plan: `context/changes/landing-page-content-and-design/plan.md`
> Research: `context/changes/landing-page-content-and-design/research.md`

## What & Why

The landing hero opens with a whimsical, two-vignette first paragraph ("Telefon dzwoni, gdy
karmisz zwierzęta…") that reads as unserious and buries the product's load-bearing promise. We
rewrite the hero to name the audience + concrete outcome, lead with the anti-overbooking
guarantee, and bring the whole page to one **owner-first** voice — because the app is
supply-constrained (no farms → nothing to book), so the owner is the persona to win first.

## Starting Point

The entire landing lives in one file, `src/pages/index.astro` (hero → "Jak to działa" 3 steps →
two persona cards → footer), inside `PageShell width="wide"` and the "Łąka i miód" token system.
The H1 is currently the bare brand "Zagroda Hub"; persona cards are teacher-first; CTAs are
state-aware via `Astro.locals.user`. Research already diagnosed the copy and locked the direction.

## Desired End State

Logged out, `/` presents a single-voice owner-primary page: an H1 stating the outcome (brand moves
to the Topbar), a subhead whose second sentence lands the guarantee in plain Polish, an owner CTA
("Załóż konto zagrody") with a subordinate teacher link, a concrete guarantee/benefits section,
owner-first persona cards, and a repeated owner CTA — all state-aware, mobile-first, one-handed.

## Key Decisions Made

| Decision                    | Choice                                   | Why (1 sentence)                                            | Source   |
| --------------------------- | ---------------------------------------- | ---------------------------------------------------------- | -------- |
| Primary persona             | Owner (break the 50/50 symmetry)         | Marketplace is supply-constrained; win supply first.       | Research |
| H1 content                  | Value proposition (brand → Topbar)       | Headline must name audience + outcome, not repeat the name.| Research |
| Copy direction              | Variant C — "maksymalna jasność"         | Clearest, calmest; lowest risk of "przekombinowania".      | Research |
| Scope                       | Hero + copy pass + guarantee section     | One consistent voice + best-practice anatomy for MVP.      | Plan     |
| Hero graphic                | Typographic, no image                    | Protects rural-mobile LCP; no asset to build/maintain.     | Plan     |
| Sticky mobile CTA           | Parked                                    | Avoids a new UI pattern; keeps scope tight.                | Plan     |
| Icons                       | Keep numbered chips                       | No new deps/islands; landing stays pure SSR.               | Plan     |
| E2E heading locator         | Update `desktop-width.spec.ts` in Phase 1 | H1 rename breaks the pinned "Zagroda Hub" heading assert.  | Plan     |

## Scope

**In scope:**
- Rewrite hero (H1, subhead, CTAs) + `PageShell` title/description metadata.
- Reframe "Jak to działa" to the owner's flow; reorder persona cards owner-first + refresh copy.
- Add a guarantee/benefits section + a repeated owner CTA.
- Update the one e2e heading locator affected by the H1 rename.

**Out of scope:**
- Hero imagery, sticky CTA, icons/React islands, new tokens, visual rebuild.
- Any route other than `/`; any claim that leaks a Non-Goal (maps, payments, reviews, SMS,
  multi-zagroda, guest account).

## Architecture / Approach

Three cohesive copy/markup passes over `src/pages/index.astro`, each independently verifiable and
shippable. Phase 1 resolves the actual complaint (the hero) and carries the deliberate e2e-locator
update because the H1 rename happens there. Phases 2–3 extend the owner-first voice to the rest of
the page and add the guarantee/benefits anatomy. All copy is Polish in the source's
practical/rural register; every benefit ladders back to the two hero promises (control from the
field + no double-booking).

## Phases at a Glance

| Phase                                   | What it delivers                                          | Key risk                                        |
| --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| 1. Hero rewrite + metadata + e2e locator | The core fix — owner-primary hero, meta, updated locator | Forgetting the e2e heading update → silent break |
| 2. Owner-first supporting copy          | Reframed steps + owner-first persona cards               | Persona-card reorder / CTA state-branch slip    |
| 3. Guarantee/benefits section + CTA     | New guarantee section + repeated owner CTA               | Leaking a Non-Goal claim; footer overlap        |

**Prerequisites:** none — no schema/route/data dependencies; local dev + Playwright already set up.
**Estimated effort:** ~1 session across 3 phases (single file + one test line).

## Open Risks & Assumptions

- **Final wording needs product-owner sign-off.** The H1/subhead/CTA strings in the plan are the
  research's *working* Variant C; treat them as approved-direction, not frozen text.
- **CI does not run e2e** — the `desktop-width.spec.ts` locator update must be made in Phase 1 or
  the width contract breaks silently until someone runs `npm run test:e2e` locally.
- Assumes exactly one `<h1>` stays on the page (invariant checked in Phases 1 & 3).

## Success Criteria (Summary)

- The hero states what the product is, for whom, and leads the guarantee — no hyperbole, one voice.
- The whole page reads owner-first and consistent, top to bottom, on a phone one-handed.
- `npm run build`, `npm run lint`, `npm test`, and `npm run test:e2e` all pass; grep-gates clean.
