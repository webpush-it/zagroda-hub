# Menu konta w Topbarze — Plan Brief

> Full plan: `context/changes/topbar-account-menu/plan.md`

## What & Why

Replace the desktop inline user-email + separate logout button in the Topbar with a compact **account menu** — a fixed-width person-icon + chevron trigger opening a popover with the full e-mail and "Wyloguj". The inline e-mail competes for header space with the logo + 3 nav links and, at ~640–1024px, truncates to a useless `"bar…"`. A fixed-width trigger never truncates and works at every width.

## Starting Point

Today `Topbar.astro` (desktop `≥sm`) renders the nav links, then a truncated e-mail `<span>`, then a standalone logout `<form>`. The `<sm` view uses the `TopbarMobileMenu` React island (hamburger drawer) which already shows e-mail + logout. There are no shared interaction hooks — the drawer implements Escape/click-outside/focus-management inline.

## Desired End State

At `≥sm`, a logged-in user sees an icon+chevron trigger where the e-mail was; nav links stay inline. Clicking it opens a popover with the full (non-truncating) e-mail and "Wyloguj". It closes on Escape, click-outside, and logout, returning focus to the trigger. The `<sm` drawer is unchanged; guests see no trigger.

## Key Decisions Made

| Decision                     | Choice                                              | Why (1 sentence)                                                                 | Source |
| ---------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Scope / breakpoint           | `≥sm` replaces inline e-mail; `<sm` drawer untouched | The drawer already solves the mobile case; `sm`=640px is the single pivot.        | Change |
| Trigger content              | Person icon + rotating chevron                       | Fixed-width affordance that never truncates — the whole point of the change.      | Plan   |
| Dismissal / focus model      | Lightweight dropdown (no modal/backdrop/scroll-lock) | Standard desktop menu UX; the drawer's modal treatment is too heavy here.         | Plan   |
| A11y pattern                 | Disclosure (`aria-haspopup`/`aria-expanded`, Tab)    | 1–2 items don't need `role=menu` arrow-key semantics; matches drawer's ARIA.      | Plan   |
| Code reuse                   | Self-contained new island, no hook extraction        | The two components need different models; extracting now would be a leaky abstraction and risk the shipped drawer. | Plan |
| Logout placement             | Moves inside the popover (POST form kept)            | Frees the bar; nav links stay inline.                                            | Change |
| E2E coverage                 | Open/close + dismiss + logout                        | Covers the a11y dismissal behaviors most likely to regress silently.             | Plan   |
| 640px overflow gate          | Not added                                            | Fixed-width trigger removes the variable-width overflow risk the gate would guard.| Plan   |

## Scope

**In scope:**
- New `AccountMenu.tsx` island (disclosure popover: trigger, e-mail, logout; Escape/click-outside/focus-return).
- Edit `Topbar.astro`: remove inline e-mail span + inline logout form; mount the island for logged-in users.
- New Playwright E2E spec.

**Out of scope:**
- Any change to `TopbarMobileMenu`/the `<sm` drawer.
- Extracting a shared interaction hook or refactoring the drawer.
- Full WAI-ARIA `role=menu` with arrow-key navigation.
- Modal backdrop / body-scroll-lock / focus-trap.
- Moving nav links into the popover; e-mail preview in the bar.
- A 640px overflow gate; any auth/endpoint/schema change.

## Architecture / Approach

New `client:idle` React island mounted inside the existing `sm:flex` cluster in `Topbar.astro`. Local `open` state; trigger button with `aria-haspopup`/`aria-expanded`/`aria-controls`; popover panel positioned `absolute right-0` below the trigger. Escape + document-pointerdown-outside close it; focus returns to the trigger. Logout is the existing POST `<form>` → `/api/auth/signout` → redirect `/`. Guest state: island simply isn't mounted (gated on `signOutAction`).

## Phases at a Glance

| Phase                            | What it delivers                                        | Key risk                                                            |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. AccountMenu island + wiring   | Working trigger + popover; inline e-mail/logout removed | Getting click-outside/Escape/focus-return right without a shared hook |
| 2. E2E coverage                  | Playwright spec: open/close/dismiss/logout at ≥sm       | Hydration timing — must gate on `astro-island[ssr]`, not timers      |

**Prerequisites:** none (self-contained UI change; logout endpoint + seed helpers already exist).
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Click-outside + Escape + focus-return are re-implemented inline (no shared hook); the drawer is the reference but the models differ, so correctness rests on this phase's manual + E2E checks.
- Assumes a logged-in account may have no e-mail (OAuth); the trigger must still render and logout must still work.
- Popover positioning (`absolute right-0`) assumes it fits within the header bar at ≥sm without clipping; verify manually.

## Success Criteria (Summary)

- At ≥sm, the icon+chevron trigger replaces the inline e-mail and opens a popover with the full, non-truncating e-mail + working "Wyloguj".
- Popover dismisses correctly (Escape, click-outside, logout) with focus returning to the trigger.
- The `<sm` drawer and guest experience are unchanged; `npm run build`, lint, and the E2E suite (incl. the new spec) pass.
