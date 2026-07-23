<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Map-picker lokalizacji zagrody (Leaflet/OSM)

- **Plan**: context/changes/zagroda-map-location/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-07-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

All 13 planned changes MATCH. The one intentional deviation (server-safe lazy
wrapper `ZagrodaMapEmbed` instead of literal `client:only`) is a faithful,
better-justified implementation of the plan's SSR-safety intent. Scope
boundaries fully respected. Automated criteria verified this session: build ✅,
astro check (0 errors) ✅, lint ✅, npm test (240 passed) ✅.

## Findings

### F1 — Detail map shows imprecise (centroid) coords as an exact pin

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data-accuracy)
- **Location**: src/pages/zagrody/[id].astro:89 (map render block)
- **Detail**: The detail page renders a precise marker whenever latitude/longitude are present, but never selects or checks `location_precise`. For an `auto` row whose city missed the PRNG dictionary, the stored coords are a voivodeship centroid (location_precise=false, potentially 50–100 km off) — yet they display as an exact pinpoint. The catalog gates its "~X km" badge on location_precise; the detail map is inconsistent with that discipline. Matches the plan's Phase 3 contract ("render map when coords present"), so an accepted design decision surfaced for a conscious keep-or-fix, not drift.
- **Fix A ⭐ Recommended**: Gate the map on location_precise — select it and only render the island when true.
  - Strength: Restores consistency with the catalog's precise-gating; never shows a misleading exact pin.
  - Tradeoff: City-known auto rows still show a town-centered pin, but that matches the existing catalog contract.
  - Confidence: HIGH — location_precise already exists on the row.
  - Blind spot: None significant.
- **Fix B**: Keep the map, add an "orientacyjna lokalizacja" caption + wider zoom when imprecise.
  - Strength: Still gives geographic context for imprecise rows.
  - Tradeoff: More UI; a wide-zoom pin can still read as exact.
  - Confidence: MED — depends on copy/zoom tuning.
  - Blind spot: Not manually tested.
- **Decision**: FIXED via Fix A — detail map now gated on location_precise; verified in-browser (precise row shows map, imprecise row hides it).

### F2 — Manual pin trusted at any planetary coordinate (no region bound)

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Safety & Quality (reliability/abuse)
- **Location**: src/lib/zagroda.ts:~43 (range ±90/±180) + src/pages/api/zagroda/index.ts
- **Detail**: A manual pin is accepted as location_precise=true with only full planetary range validation. An owner can drop a pin anywhere — including a different region than the voivodeship used for catalog filtering. Low real risk (vetted owners), but the "pin is roughly where the farm is" invariant is unenforced.
- **Fix**: Optionally bound accepted manual coords to a Poland bounding box (or the selected voivodeship's rough bbox) before setting 'manual'.
- **Decision**: FIXED — zagrodaProfileSchema coords bounded to a padded Poland bbox (POLAND_BBOX); unit tests updated.

### F3 — Picker recenters the map on every drag/click, not just on clear

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Safety & Quality (UX)
- **Location**: src/components/zagroda/MapPicker.tsx:98-105 (sync effect)
- **Detail**: The sync effect calls map.setView(pos) on every latitude/longitude/fallback change. After a drag or click, props update and the map re-centers on the pin — dragging to the edge snaps the view back to center. setLatLng is a no-op on that path but setView is not. Mild disorientation; passed manual test in Phase 2, so not blocking.
- **Fix**: Only setView when the pin is cleared externally (transition to fallback/no-pin) — skip it when incoming props match the last coords the marker emitted (track via a ref).
- **Decision**: FIXED — added lastEmittedRef; sync effect skips setView when the change originated from the marker itself. Verified via build/lint/tests + code review (drag is behind auth; not live-driven).
