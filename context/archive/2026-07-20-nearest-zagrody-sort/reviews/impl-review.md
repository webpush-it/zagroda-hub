<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Najbliższe zagrody — sortowanie katalogu po odległości (S-10)

- **Plan**: context/changes/nearest-zagrody-sort/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-07-21
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — catalog_zagrody recreate re-widens EXECUTE to PUBLIC

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (also Pattern Consistency)
- **Location**: supabase/migrations/20260720120000_zagroda_coordinates.sql:240
- **Detail**: DROP + CREATE of catalog_zagrody re-grants EXECUTE to anon, authenticated but never re-revokes from PUBLIC. Postgres grants EXECUTE to PUBLIC by default on a fresh function, and DROP discarded the original migration's revoke. Sibling 20260607090000_catalog_zagrody.sql:71 does the revoke first. Functional exposure nil (SECURITY DEFINER, published rows only, already anon data) but regresses least-privilege and breaks convention. Not yet deployed.
- **Fix**: Add `revoke execute on function public.catalog_zagrody(public.voivodeship, text, date, integer) from public;` before line 240, then re-run `npm run db:reset`.
- **Decision**: FIXED

### F2 — Dataset licence is CC BY 4.0, not "public domain" as planned

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Scope Discipline
- **Location**: scripts/data/README.md; context/changes/nearest-zagrody-sort/change.md:26
- **Detail**: Plan assumed "domena publiczna". Actual source (GUGiK PRNG) is CC BY 4.0 / PZGiK — free with attribution. Documented in README.md and change.md, but the attribution obligation is not surfaced user-facing. Catalog ships derived distances, not the raw dataset.
- **Fix**: Add a PZGiK/GUGiK attribution line to a footer or /o-danych page (follow-up, not a blocker).
- **Decision**: FIXED

### F3 — Sort comparator produces NaN for two coord-less cards

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/katalog.astro:245
- **Detail**: `a.distance - b.distance` is `Infinity - Infinity = NaN` when both cards lack coords. V8 tolerates a NaN comparator (treats as 0), so no-coord cards still sink to the end; only their relative order is undefined. Harmless.
- **Fix (optional)**: short-circuit equal-Infinity pairs to 0, or sort on a finite sentinel.
- **Decision**: FIXED

### F4 — locate() doesn't guard navigator.geolocation on the click path

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/katalog.astro:257,265
- **Detail**: In a non-secure context `navigator.geolocation` is undefined; the button-click path would throw uncaught (auto-locate path is inside .then/.catch so safe). Production is HTTPS so always present — very low risk.
- **Fix (optional)**: `if (!navigator.geolocation) return;` at the top of locate().
- **Decision**: FIXED
