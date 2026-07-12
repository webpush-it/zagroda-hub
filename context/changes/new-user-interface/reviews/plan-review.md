<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Redesign UI „Łąka i miód"

- **Plan**: context/changes/new-user-interface/plan.md
- **Mode**: Deep
- **Date**: 2026-07-12
- **Verdict**: REVISE → SOUND (after triage fixes)
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL (fixed in triage) |

## Grounding

15/15 paths ✓, 5/5 symbols ✓, brief↔plan ✓. Deep verification: dark-idiom file inventory complete (no files missed by the plan), 6/6 English e2e locators exactly as claimed, LibBadge.astro/template.png confirmed dead, email layout hexes confirmed (#f4f4f1 / #2d5a27), zero visual/theme assertions in e2e/, adapter confirmed @astrojs/cloudflare with output:"server" behind custom src/worker.ts.

## Findings

### F1 — Progress subsection titles don't match phase headings

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress (Phase 3 and Phase 5 subsections)
- **Detail**: /10x-implement pairs phases with Progress subsections by exact title. Phase 3 body "Auth — restyle, pełna polonizacja i aktualizacja e2e" vs Progress "Auth — restyle, polonizacja, e2e"; Phase 5 body "Sprzątanie startera i spójność e-maili" vs Progress "Sprzątanie startera i e-maile". Checkbox counts/ordering otherwise consistent.
- **Fix**: Rename the two Progress subsection headings to match the body phase headings verbatim.
- **Decision**: FIXED (Progress headings renamed to match body verbatim)

### F2 — "Recoloring shadcn tokens is free" misses the body rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Current State Analysis + Phase 1 #1
- **Detail**: Plan claimed shadcn tokens are consumed "wyłącznie przez button.tsx", but `global.css:122` has `body { @apply bg-background text-foreground; }` — recoloring `--background`/`--foreground` in Phase 1 repaints the base layer of every page while phases 2–4 pages are still dark, contradicting Phase 1's "no visual change" criterion. Risk small (bg-cosmic min-h-screen wrappers cover the viewport) but unverified; same nuance for `color-scheme: light` on :root while dark-glass native inputs exist until Phase 3.
- **Fix**: Correct the Current State claim (add global.css:122 as a consumer) and extend Phase 1 verification with a visual spot-check of still-dark pages with native inputs (/katalog, /auth/forgot-password) after the :root recolor.
  - Strength: Keeps Phase 1's design intact (Phase 3's SubmitButton→Button depends on recolored --primary).
  - Tradeoff: None significant — one extra manual check.
  - Confidence: HIGH — global.css:122 verified directly.
  - Blind spot: Wrapper viewport coverage is confirmed only by the spot-check itself.
- **Decision**: FIXED (Current State corrected; manual criterion + Progress item 1.11 added)

### F3 — 404 verification checks /404 directly, not an unmatched route

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 #6 + manual criterion 2.4
- **Detail**: "Astro serves 404.astro for unmatched routes" is correct for output:"server" on @astrojs/cloudflare, but traffic goes through a custom src/worker.ts wrapping the adapter handler, and criterion 2.4 viewed "/404" directly — which renders even if fallback routing were broken by the wrapper.
- **Fix**: Verify 404 by visiting a genuinely unmatched URL (e.g. /nie-ma-takiej-strony) and asserting response status 404.
- **Decision**: FIXED (Phase 2 #6 contract + criterion 2.4 updated)
