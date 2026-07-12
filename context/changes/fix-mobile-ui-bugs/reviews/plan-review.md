<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Poprawa błędów UI na mobile od 320px

- **Plan**: context/changes/fix-mobile-ui-bugs/plan.md
- **Mode**: Deep
- **Date**: 2026-07-12
- **Verdict**: REVISE → SOUND (all findings fixed)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

14/14 paths ✓, symbols (lint/test:e2e/build) ✓, brief↔plan ✓, no contract-surfaces.md (skipped), Progress↔Phase consistent. Existing e2e (`critical-flow`, `idor-contact-data`) navigate via `page.goto()` not Topbar links → hamburger change does not regress them (Phase 2 e2e claim verified).

## Findings

### F1 — Automated @320 gate only guards horizontal overflow

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 6 — Bramka regresji @320
- **Detail**: The plan's thesis is a durable 320px floor, but the only automated guard asserted `scrollWidth <= innerWidth` on 4 public pages. Tap-targets, native-control clipping, and password padding — the bulk of the fixes (classes D3–D5) — had no automated guard and could silently regress while CI stays green.
- **Fix**: Extend the public-page spec with tap-target height (hamburger + sample link) and password padding-right assertions; native date/time clipping stays manual (Chrome + Firefox).
- **Decision**: FIXED (Fix in plan — Phase 6 spec #1 Contract + criteria 6.2)

### F2 — Uniform tap-target forced onto inline prose links

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 — item 6 (inline text-sm links)
- **Detail**: tap-target is `min-height:2.75rem; inline-flex`. Item 6 applied it to links inside sentences ("Nie pamiętam hasła" SignInForm.tsx:81, auth footer signin.astro:17 in a `text-sm <p>`). WCAG 2.5.5/2.5.8 exempt in-sentence targets; forcing 44px + inline-flex mid-paragraph breaks the baseline and injects a tall box.
- **Fix**: Split item 6 — tap-target only on standalone links; inline-in-sentence links left (WCAG-exempt) or padded vertically only (no min-height/inline-flex). Each link classified at implementation.
- **Decision**: FIXED (Fix in plan — Phase 5 item 6 rewritten + criteria 5.5)

### F3 — Phase 3 item 3 (reservation date stack) is a no-op

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3 — item 3 (formularz rezerwacji)
- **Detail**: Item 3 inherited research's "reservation date BREAKS", but `BookingRequestForm.tsx` date (lines 142-163) already sits in a `space-y-4` full-width single-column form. Nothing to un-stack; at 320px it renders ~240px (research's SAFE case). File was also left as "confirm at implementation".
- **Fix**: Converted to verify-only ("confirm date renders clean @320 Chrome+Firefox — already full-width"); filename pinned to `BookingRequestForm.tsx`.
- **Decision**: FIXED (Fix in plan — Phase 3 item 3 rewritten)

### F4 — Drawer island hydrates eagerly on every page

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — TopbarMobileMenu (client:load)
- **Detail**: TopbarMobileMenu was specified `client:load`; Topbar renders on 8 pages so the idle drawer JS hydrates immediately everywhere. `client:idle` defers it without losing function.
- **Fix**: Prefer `client:idle` for the drawer island (Phase 2 intent + contract + Performance Considerations + brief updated).
- **Decision**: FIXED (Fix in plan)
