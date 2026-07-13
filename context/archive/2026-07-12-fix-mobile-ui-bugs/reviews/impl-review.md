<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Poprawa błędów UI na mobile od 320px

- **Plan**: context/changes/fix-mobile-ui-bugs/plan.md
- **Scope**: All 6 phases (complete)
- **Date**: 2026-07-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria evidence: `npm run build` ✓, `npm run lint` ✓ (exit 0), `npx playwright test` 10/10 ✓ (incl. 6 new @320). Manual @320 verified in Chromium + Firefox (public + authed surfaces, via screenshots) and Topbar-revert sanity confirmed the gate catches the regression.

## Findings

### F1 — Drawer presents a modal backdrop but lacks modal affordances

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (a11y)
- **Location**: src/components/TopbarMobileMenu.tsx:64-100
- **Detail**: Open drawer renders a dimming backdrop (bg-black/30, fixed inset-0) so it reads as modal, but keyboard focus can Tab out into the obscured page (no focus trap), the background still scrolls (no body-scroll-lock), and the background is not inert/aria-hidden. Within contract (plan required only Escape + focus-return, both present) and NOT a regression (no drawer existed before), but the backdrop sets an unmet modal expectation. Background scroll-through is the most user-visible gap at 320px.
- **Fix A ⭐ Recommended**: Add body-scroll-lock on open + focus trap + background inert while open.
  - Strength: Delivers the modal semantics the backdrop implies; scroll-lock is the highest-value piece for a phone.
  - Tradeoff: ~15-25 lines in the island (scroll-lock effect + Tab cycling).
  - Confidence: HIGH — standard disclosure/dialog pattern.
  - Blind spot: iOS Safari overscroll interaction not verified.
- **Fix B**: Drop the dimming backdrop; treat as a plain disclosure menu.
  - Strength: Smallest change; honest about what it is.
  - Tradeoff: Loses the "background inactive" visual cue.
  - Confidence: MED — depends on desired UX feel.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — body-scroll-lock + Tab focus-trap added (TopbarMobileMenu.tsx). Background pointer already blocked by backdrop; true `inert` deferred (not cleanly reachable from an island — focus-trap covers keyboard).

### F2 — Link tap-target classification deviates from the plan's literal list

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/auth/forgot-password.astro:42, src/pages/auth/confirm-email.astro:41, src/pages/zagrody/[id].astro:125
- **Detail**: Three spots deviate from the plan's literal standalone/inline list, all in the WCAG-correct direction per actual render context: forgot-password:42 & confirm-email:41 "Wróć do logowania" GOT tap-target (render as standalone CTAs in a <p> with only the link); zagrody:125 "Przejdź do katalogu" did NOT (inline in 404 sentence). No tap-target leaked onto a genuinely inline-in-sentence link.
- **Fix**: Accept as-is (code applies WCAG 2.5.5/2.5.8 more precisely than the plan text); no code change needed.
- **Decision**: ACCEPTED — code more correct than plan; no change.

### F3 — "← Wróć do zapytań" missing tap-target vs its sibling CTA

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard/zapytania/[id].astro:74-79
- **Detail**: "← Wróć do zapytań" is a standalone top-of-page back CTA analogous to "← Wróć do katalogu" (which got tap-target in Phase 5), but here it's only inline-block text-sm. Not in the plan's explicit link list, so not required — but inconsistent with the sibling page.
- **Fix**: Add `tap-target` to the "← Wróć do zapytań" link.
- **Decision**: FIXED — swapped `inline-block` for `tap-target`, matching the sibling "← Wróć do katalogu".

### F4 — Drawer lacks dialog/landmark semantics; e2e reaches it via CSS id

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/TopbarMobileMenu.tsx:73-77, e2e/mobile-320.spec.ts:58
- **Detail**: Drawer container is a bare <div> with an id but no role="dialog"+aria-modal (nor <nav aria-label>) — not announced as a region; aria-controls dangles when closed. Separately, the e2e spec's one rule-deviating locator is page.locator("#topbar-mobile-drawer") (CSS id vs repo's role/label-first rule). Both dissolve together: role="dialog" aria-label lets the spec use getByRole("dialog").
- **Fix**: Add role="dialog" aria-modal="true" aria-label="Menu nawigacji" to the drawer, then switch the e2e locator to getByRole. Pairs with F1's focus-trap work.
- **Decision**: FIXED — drawer now `role="dialog" aria-modal="true" aria-label="Menu nawigacji"`; e2e locator switched to `getByRole("dialog", { name: "Menu nawigacji" })` (CSS id locator removed).
