<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Wzbogacenie landing page (klient-first)

- **Plan**: context/changes/landing-enrichment/plan.md
- **Mode**: Deep
- **Date**: 2026-07-20
- **Verdict**: SOUND (both findings fixed during triage)
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓ (index.astro, Layout.astro, ZagrodaPlaceholder.astro, global.css, e2e/desktop-width.spec.ts), 6/6 symbols ✓ (accent-100 token, canonicalUrl, og:url, clientSteps, ZagrodaPlaceholder import, no existing twitter/canonical), brief↔plan ✓. contract-surfaces.md absent (check skipped). Internal-consistency: contradiction/promise-gap/Progress↔Phase mechanical all pass. mobile-320.spec.ts covers "/"; no e2e asserts landing body copy beyond H1.

## Findings

### F1 — FAQPage JSON-LD placed in shared Layout would emit site-wide

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Change #3 (SEO / JSON-LD)
- **Detail**: The contract placed "Organization/WebSite (optionally FAQPage)" JSON-LD in src/layouts/Layout.astro. Layout is shared by every page and exposes only title/description props + a single <body> <slot/> — no <head> slot (Layout.astro:6-14,25-38; PageShell.astro passes only title/description). Organization/WebSite are site-wide (correct in Layout); FAQPage is landing-specific and would attach to /katalog, /dashboard, /auth/* etc. — invalid structured data. No plumbing exists to scope it to the landing.
- **Fix A ⭐ Recommended**: Keep only Organization/WebSite in Layout; drop FAQPage
  - Strength: Correct + simplest; site-wide schema in the shared layout, no new plumbing; FAQPage was already optional.
  - Tradeoff: Forgoes FAQ rich-result eligibility for now.
  - Confidence: HIGH — Organization/WebSite are genuinely site-wide; no head-slot exists to scope FAQPage cleanly.
  - Blind spot: None significant.
- **Fix B**: Add a named head slot to Layout + PageShell; emit FAQPage from index.astro
  - Strength: Keeps FAQ rich-result eligibility, scoped correctly to /.
  - Tradeoff: Touches shared Layout.astro + PageShell.astro for one page's benefit.
  - Confidence: MED — straightforward Astro slot, but expands Phase 3 scope.
  - Blind spot: Other pages wanting head injection not surveyed.
- **Decision**: FIXED via Fix A — Phase 3 contract now emits only Organization/WebSite (site-wide) in Layout, explicitly drops FAQPage with rationale; FAQ change note and manual criterion 3.9 updated accordingly.

### F2 — mobile-320 e2e is the automated guard for "no horizontal scroll" but wasn't listed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 (and 1/3) — Automated Verification
- **Detail**: The two-column hero + benefit/step card grids risk 320px horizontal overflow. e2e/mobile-320.spec.ts already asserts no-overflow on "/" (PUBLIC_PAGES includes "/", line 19) — the automated guard — but the plan listed "no horizontal scroll at 320–414px" only as a manual criterion and named only desktop-width in the automated e2e line.
- **Fix**: Add `npx playwright test mobile-320` (if run locally) to Automated Verification of Phase 1 & 2 alongside desktop-width (Phase 3 runs the full suite).
- **Decision**: FIXED — Phase 1 & 2 automated e2e criterion + Progress rows 1.6/2.6 now run `desktop-width mobile-320`.
