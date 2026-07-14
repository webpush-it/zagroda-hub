# Menu konta w Topbarze — Implementation Plan

## Overview

Replace the desktop (`≥sm`) inline user-email display and its separate logout `<form>` in the Topbar with a new self-contained React island, `AccountMenu`. The island renders a fixed-width trigger (lucide `User` icon + rotating `ChevronDown`) that opens a lightweight disclosure popover containing the full e-mail address and the "Wyloguj" action. Because the trigger is fixed-width, it never competes for header space with the logo + 3 nav links and never truncates the e-mail. The `<sm` mobile hamburger drawer (`TopbarMobileMenu`) already surfaces e-mail + logout and is **not** touched.

## Current State Analysis

- **Desktop surface (to replace)** — `src/components/Topbar.astro:33-57`. Inside a `hidden min-w-0 items-center gap-4 sm:flex` cluster: the nav links (`links.map`), then a truncated e-mail `<span class="text-ink-muted max-w-[12rem] min-w-0 shrink truncate" title={user.email}>` (lines 42-46), then a logout `<form method="POST" action={signOutAction}>` with a submit button (lines 49-55).
- **Data source** — `Topbar.astro:5` reads `const { user } = Astro.locals;` (populated in `src/middleware.ts` via `supabase.auth.getUser()`; type `App.Locals.user: User | null` in `src/env.d.ts:3`). `user.email` is optional (`email?: string`) — some OAuth accounts have no e-mail. `signOutAction = user ? "/api/auth/signout" : undefined` (`Topbar.astro:23`).
- **Mobile surface (untouched)** — `src/components/TopbarMobileMenu.tsx`, a `client:idle` island rendered at `Topbar.astro:59`, visible only `<sm` (`sm:hidden`). It already shows `userEmail` + a logout form in its drawer header.
- **Interaction primitives** — none are extracted. `TopbarMobileMenu.tsx` implements Escape-to-close, Tab focus-trap (`'a[href], button:not([tabindex="-1"])'`), body-scroll-lock, click-outside via a full-screen backdrop `<button>`, and focus-restoration inline (lines 24-75, 97-103). There is no `hooks/` directory. This is the reference pattern to adapt — not a shared dependency.
- **Logout endpoint** — `src/pages/api/auth/signout.ts`: `POST` `APIRoute` that builds the Supabase client, calls `supabase.auth.signOut()`, then `redirect("/")`.
- **Styling** — Tailwind 4 with custom tokens in `src/styles/global.css`: `text-ink-muted`, `border-edge`, `hover:text-link-hover`, `hover:bg-brand-50`, and the `tap-target` utility (`min-height: 2.75rem` one-handed guardrail). lucide-react is imported named: `import { User, ChevronDown, LogOut } from "lucide-react";` with `size-*` classes + `aria-hidden="true"`.
- **Testing** — E2E-only for UI. No jsdom/component harness (Vitest is `environment: "node"`, `tests/**/*.test.ts`, domain/DB/API only). Playwright specs live in `e2e/`, single "Pixel 5" project (default ~393px, `<sm`), `workers: 1`, serves the built Cloudflare Worker via `wrangler dev`. Desktop specs override viewport with `test.use({ viewport: { width: 1280, height: 800 } })`. Seed via `e2e/helpers/seed.ts` (`createConfirmedOwner`, `uniqueEmail`). Locators via role/label/text; **never** `waitForTimeout`; gate hydration on `astro-island[ssr]` count → 0.

### Key Discoveries

- The archived `topbar-user-email` change explicitly listed "no account menu/dropdown — e-mail is static text" as out-of-scope (`context/archive/2026-07-14-topbar-user-email/plan.md:39`). This change is the **deliberate reversal** of that decision, not a contradiction.
- `min-w-0` on flex children is load-bearing for truncation (`context/foundation/lessons.md:26-31`) — but this change **removes** the variable-width e-mail from the inline row entirely, so the header's tightest-packing overflow risk at `sm`=640px is designed out.
- `user.email` can be `undefined`; the current desktop code simply omits the node. The new trigger must still render (a person can be logged in without an e-mail) and degrade gracefully.
- Islands hydrate on `client:idle`; any interaction attempted before hydration is lost. E2E must wait for hydration (`astro-island[ssr]` → 0), never a timer.

## Desired End State

On any screen `≥sm`, a logged-in user sees a compact person-icon + chevron trigger where the inline e-mail used to be. Nav links remain inline to its left. Clicking (or Enter/Space on) the trigger opens a popover anchored below it showing the full e-mail (never truncated) and a "Wyloguj" button. The popover closes on Escape, on a click outside it, and after selecting "Wyloguj" (which POSTs to `/api/auth/signout` and redirects to `/`); on close, focus returns to the trigger. Below `sm`, the existing hamburger drawer is unchanged. Guests (no `user`) see no trigger.

Verify: `npm run build` succeeds (SSR type/contract check); the new Playwright spec passes; manual check at ≥sm shows the trigger, popover behavior, and sign-out; manual check at <sm shows the unchanged drawer.

## What We're NOT Doing

- Not touching `TopbarMobileMenu.tsx` or the `<sm` drawer behavior.
- Not extracting a shared interaction hook or refactoring the drawer's inline primitives (self-contained island by decision).
- Not implementing a full WAI-ARIA `role=menu`/`menuitem` with arrow-key roving tabindex — using the disclosure pattern (`aria-haspopup` + `aria-expanded`, Tab navigation).
- Not adding a modal treatment (no backdrop element, no body-scroll-lock, no focus-trap) — lightweight dropdown only.
- Not moving nav links into the popover — they stay inline on desktop.
- Not adding an automated overflow gate at exactly 640px (the fixed-width trigger removes the variable-width failure mode).
- Not adding an at-a-glance e-mail preview in the bar (icon + chevron only; e-mail lives inside the popover).
- Not changing the logout endpoint, middleware, or auth.

## Implementation Approach

Build a new `AccountMenu.tsx` island modeled on `TopbarMobileMenu`'s inline interaction style but as a **lightweight, non-modal dropdown**: local `open` state, a trigger button carrying `aria-haspopup="menu"` (or `"true"`), `aria-expanded`, and `aria-controls`, and a popover panel positioned relative to the trigger. Implement Escape-to-close and click-outside (document `pointerdown`/`mousedown` listener checking `contains`, or an `onBlur`/focusout strategy — implementer's call following the drawer's spirit but without the full-screen backdrop) and focus-return-to-trigger on close. Then edit `Topbar.astro` to drop the inline e-mail span and inline logout form on desktop and mount `<AccountMenu client:idle .../>` in the `sm:flex` cluster, passing the e-mail and `signOutAction`. Guest state: mount nothing (mirror `signOutAction` being `undefined`). Finally add a Playwright spec covering open/close/dismiss/logout at a desktop viewport.

## Phase 1: AccountMenu island + Topbar wiring

### Overview

Create the `AccountMenu` island and wire it into the desktop cluster of `Topbar.astro`, removing the inline e-mail span and inline logout form.

### Changes Required

#### 1. New account-menu island

**File**: `src/components/AccountMenu.tsx` (new)

**Intent**: A self-contained desktop account menu island: fixed-width disclosure trigger (person icon + chevron) opening a popover with the full e-mail and a "Wyloguj" logout form. Never truncates; closes on Escape, click-outside, and logout; returns focus to the trigger on close. Not shown `<sm` (the drawer owns that width).

**Contract**:
- Props: `{ userEmail?: string; signOutAction: string }`. (Mounted only for logged-in users, so `signOutAction` is required here — the guest case is handled by not mounting the island in `Topbar.astro`.)
- Root wrapper hidden below `sm` and shown at/above it — the desktop counterpart of the drawer's `sm:hidden` (i.e. `hidden sm:block`/`sm:flex`), so exactly one of {inline cluster items, this island} governs each width. The island sits inside the existing `sm:flex` cluster after the nav links.
- Trigger `<button>`: `type="button"`, `aria-haspopup="menu"`, `aria-expanded={open}`, `aria-controls="account-menu-popover"`, and an `aria-label` naming the account (e.g. the e-mail when present, else a generic "Konto"/"Menu konta"). Uses the `tap-target` utility + existing `text-ink-muted hover:text-link-hover` tokens. Renders `<User className="size-…" aria-hidden="true" />` + `<ChevronDown aria-hidden="true" />`; the chevron rotates when `open` (Tailwind `rotate-180 transition-transform`).
- Popover panel: `id="account-menu-popover"`, positioned relative to the trigger (wrapper `relative`, panel `absolute right-0` below the trigger, `z-*` above header content, `border-edge border bg-white rounded-… shadow-…`). Contains the full e-mail (non-truncated; `break-all`/`whitespace-normal` so long addresses wrap rather than clip) and the logout form `<form method="POST" action={signOutAction}><button type="submit">Wyloguj</button></form>` (reuse the `LogOut` lucide icon optionally). When `userEmail` is falsy, omit the e-mail node but still render the logout action.
- Interaction (inline, no shared hook, no backdrop, no scroll-lock, no focus-trap): `useState` for `open`; `close()` sets `open=false` and refocuses the trigger; a keydown listener (gated on `open`) closes on `Escape`; a document `pointerdown`/`mousedown` listener (gated on `open`) closes when the target is outside the wrapper ref. Clean up listeners on close/unmount. Selecting "Wyloguj" submits the form (native POST → redirect), so no explicit close needed.

#### 2. Topbar desktop wiring

**File**: `src/components/Topbar.astro`

**Intent**: Remove the inline e-mail `<span>` and the inline logout `<form>` from the desktop cluster; mount the new island in their place for logged-in users. Keep nav links inline and the mobile drawer mount unchanged.

**Contract**:
- Delete `Topbar.astro:42-46` (e-mail span) and `Topbar.astro:49-55` (logout form).
- Import the island: `import AccountMenu from "@/components/AccountMenu";`.
- After the `links.map(...)` block inside the `sm:flex` cluster, render `{signOutAction && <AccountMenu client:idle userEmail={user?.email} signOutAction={signOutAction} />}` (gating on `signOutAction` matches the existing logged-in condition so guests get nothing).
- Leave `Topbar.astro:59` (`<TopbarMobileMenu ... />`) and the `links`/`signOutAction` computation intact. The cluster keeps `min-w-0`; the island is fixed-width so the row no longer needs the e-mail's shrink/truncate treatment.

### Success Criteria

#### Automated Verification

- Type/contract check passes: `npm run build` (Astro + Cloudflare SSR build; also exercises the island props contract)
- Lint passes: `npm run lint`
- Existing E2E suite still passes: `npm run test:e2e`

#### Manual Verification

- At ≥sm: person-icon + chevron trigger appears where the e-mail used to be; nav links remain inline; no inline e-mail text or standalone "Wyloguj" button in the bar.
- Clicking the trigger opens a popover showing the full e-mail (long addresses wrap, never clipped) and "Wyloguj"; chevron rotates.
- Escape closes the popover and returns focus to the trigger; clicking outside closes it; "Wyloguj" signs the user out and lands on `/`.
- Keyboard: trigger reachable and operable with Enter/Space; Tab moves through popover contents.
- At <sm: the hamburger drawer is unchanged (still shows e-mail + logout inside).
- A logged-in account without an e-mail still shows the trigger and can log out; a guest sees no trigger.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: E2E coverage

### Overview

Add a Playwright spec verifying the account-menu contract at a desktop viewport, following the archived `topbar-user-email.spec.ts` as the template.

### Changes Required

#### 1. Account-menu E2E spec

**File**: `e2e/topbar-account-menu.spec.ts` (new)

**Intent**: Verify the user-visible account-menu behavior on desktop: trigger present, popover reveals the e-mail, dismissal works, and logout signs out.

**Contract**:
- `test.use({ viewport: { width: 1280, height: 800 } })` (default project is Pixel 5 / `<sm`, which would show the drawer instead).
- Seed + sign in with the real form: `createConfirmedOwner(uniqueEmail("account"), PASSWORD)` → `/auth/signin` → `getByLabel("E-mail", { exact: true })` / `getByLabel("Hasło", { exact: true })` → `getByRole("button", { name: "Zaloguj się" })` → `waitForURL("**/dashboard")`. Wait for island hydration (`astro-island[ssr]` count → 0), never a timer.
- Assertions:
  - The e-mail is **not** visible inline before opening (the bar shows only the trigger), and the trigger (`getByRole("button", { name: /konto|menu/i })` or its aria-label) is visible.
  - Clicking the trigger opens the popover and `getByText(email)` becomes visible.
  - Escape closes the popover (`getByText(email)` hidden); re-open, then click outside → closes.
  - With the popover open, activating "Wyloguj" (`getByRole("button", { name: "Wyloguj" })`) signs out → `waitForURL` back to `/` (guest state).
- Unique data per run; no teardown (matches suite convention).

### Success Criteria

#### Automated Verification

- New spec passes: `npm run test:e2e` (builds the worker, runs Playwright)
- Full E2E suite still green (no regressions in `smoke`, `critical-flow`, `mobile-320`, `desktop-width`, etc.)

#### Manual Verification

- The spec fails if the popover doesn't open, the e-mail isn't revealed, dismissal is broken, or logout doesn't redirect — confirmed by transiently breaking one behavior locally (optional sanity check).

**Implementation Note**: After this phase and automated verification, pause for human manual confirmation before considering the change complete.

---

## Testing Strategy

### Unit Tests

- None. There is no jsdom/component-render harness (Vitest is node-only for domain/DB/API). The props contract is enforced by TypeScript via `npm run build`; UI behavior is covered by E2E — matching how `topbar-user-email` was tested.

### Integration Tests

- `npm run build` (Astro + Cloudflare SSR) is the integration check for the island props contract and Topbar wiring.

### Manual Testing Steps

1. Log in; at desktop width confirm the icon+chevron trigger replaces the inline e-mail, nav links stay inline.
2. Open the popover; confirm the full e-mail shows (wrap a very long address) and "Wyloguj" is present.
3. Press Escape → closes + focus returns to trigger; re-open, click outside → closes.
4. Click "Wyloguj" → redirected to `/`, logged out.
5. Narrow to <sm → hamburger drawer unchanged (e-mail + logout inside).
6. (If feasible) log in with an e-mail-less account → trigger still shows, logout works.

## Performance Considerations

Negligible — one additional small `client:idle` island. No new network calls; logout reuses the existing endpoint.

## Migration Notes

None — no data or schema changes. Purely presentational/interaction.

## References

- Change identity: `context/changes/topbar-account-menu/change.md`
- Reference component (interaction pattern): `src/components/TopbarMobileMenu.tsx:24-75,97-103`
- Surface being replaced: `src/components/Topbar.astro:33-57`
- Logout endpoint: `src/pages/api/auth/signout.ts`
- Prior work + gotchas: `context/archive/2026-07-14-topbar-user-email/` (plan.md, reviews/impl-review.md)
- E2E template: `context/archive/2026-07-14-topbar-user-email/` → `e2e/topbar-user-email.spec.ts`
- Truncation lesson: `context/foundation/lessons.md:26-31`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: AccountMenu island + Topbar wiring

#### Automated

- [x] 1.1 Type/contract check passes: `npm run build` — 71aba37
- [x] 1.2 Lint passes: `npm run lint` — 71aba37
- [x] 1.3 Existing E2E suite still passes: `npm run test:e2e` — 71aba37

#### Manual

- [x] 1.4 Trigger (icon + chevron) replaces inline e-mail at ≥sm; nav links stay inline; no inline e-mail/standalone Wyloguj — 71aba37
- [x] 1.5 Click opens popover with full (wrapping) e-mail + "Wyloguj"; chevron rotates — 71aba37
- [x] 1.6 Escape closes + focus returns to trigger; click-outside closes; "Wyloguj" signs out to `/` — 71aba37
- [x] 1.7 Trigger keyboard-operable (Enter/Space); Tab moves through popover contents — 71aba37
- [x] 1.8 `<sm` hamburger drawer unchanged — 71aba37
- [x] 1.9 E-mail-less account still shows trigger + can log out; guest sees no trigger — 71aba37

### Phase 2: E2E coverage

#### Automated

- [x] 2.1 New spec passes: `npm run test:e2e` — 22e78de
- [x] 2.2 Full E2E suite still green (no regressions) — 22e78de

#### Manual

- [x] 2.3 Spec meaningfully fails when a behavior is broken (optional sanity check) — 22e78de
