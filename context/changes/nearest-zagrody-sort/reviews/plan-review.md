<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Najbliższe zagrody — sortowanie po odległości (S-10)

- **Plan**: context/changes/nearest-zagrody-sort/plan.md
- **Mode**: Deep
- **Date**: 2026-07-20
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 1 critical, 3 warnings, 1 observation (all triaged & fixed)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL → addressed (F1, F2, F3, F5) |
| Plan Completeness | WARNING → addressed (F4) |

## Grounding

5/5 paths ✓, symbols ✓ (`catalog_zagrody` present; no existing geolocation/unaccent), brief↔plan ✓, Progress↔Phase ✓. Blast radius: `catalog_zagrody` called by `katalog.astro` + `catalog.test.ts` + `day-blocks.test.ts` (add-columns backwards-compatible). `rls.test.ts` does not enumerate all tables. No prior `create extension` in migrations.

## Findings

### F1 — `unaccent` unqualified under `search_path=''` will fail at runtime

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (Normalizacja / Critical Implementation Details)
- **Detail**: `locality_coords` uses `set search_path = ''` but normalized with bare `unaccent(...)`. On Supabase `unaccent` lives in the `extensions` schema; unqualified it errors "function unaccent(text) does not exist". No repo precedent for extensions.
- **Fix**: `create extension if not exists unaccent with schema extensions;` + call `extensions.unaccent(...)`; note all extension calls must be schema-qualified.
- **Decision**: FIXED (Fix in plan)

### F2 — Dual normalization (TS asset vs SQL resolver) can silently diverge

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 (asset) + Phase 1 §1 (`locality_coords`)
- **Detail**: `name_normalized` computed both in Node (asset) and SQL (lookup); must be byte-identical or every lookup misses and falls to centroid. JS vs Postgres `unaccent` differ on edge chars.
- **Fix A ⭐ (chosen)**: Single source of truth — seed inserts RAW `name`; DB computes `name_normalized` via the same SQL expression as lookup. Divergence impossible by design.
- **Fix B**: Keep dual normalization + conformance test (narrows but doesn't eliminate risk).
- **Decision**: FIXED (Fix A)

### F3 — Auto-locate relies on Permissions API unsupported on iOS Safari

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §4
- **Detail**: "auto-sort when already granted" calls `navigator.permissions.query({name:'geolocation'})`; iOS Safari (primary mobile persona, US-04) may not support it → undefined or reject, could throw and kill the feature.
- **Fix**: Feature-detect (`navigator.permissions?.query`) in try/catch; when unavailable, show the button and skip auto-locate. Button (gesture) path must work with zero Permissions-API dependence. Added manual item 3.10.
- **Decision**: FIXED (Fix in plan)

### F4 — Match-rate measured but no threshold or remediation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 (Success Criteria / §2)
- **Detail**: Match-rate logged but no pass bar / no action if low; silent degradation to centroids passes all automated checks (regression vs FR-020).
- **Fix**: Target ≥90% published zagrody `location_precise`; below → remediation (dump unmatched cities, inspect normalization/dedup/voivodeship mapping) before Phase 3. Updated success criteria + Progress 2.4.
- **Decision**: FIXED (Fix in plan)

### F5 — Coords trigger fires on every `seedZagroda` in the whole test suite

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (trigger) + regression surface
- **Detail**: `zagrody_set_coords` fires for every `seedZagroda` across all DB suites; RPC drop+recreate touches the same surface as `catalog.test.ts`/`day-blocks.test.ts`. Broad blast radius; NULL `location_precise` (NOT NULL) or a slow/erroring resolver breaks unrelated suites.
- **Fix**: Zero-row-safety (coalesce `location_precise`→false, lat/lng null when unresolved); added Phase 1 regression item (catalog/day-blocks stay green). Added Progress 1.8.
- **Decision**: FIXED (Fix in plan)
