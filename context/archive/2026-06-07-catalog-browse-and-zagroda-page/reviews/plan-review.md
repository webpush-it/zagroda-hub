<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Catalog Browse and Zagroda Page (S-02)

- **Plan**: context/changes/catalog-browse-and-zagroda-page/plan.md
- **Mode**: Deep
- **Date**: 2026-06-07
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS (2 observations) |
| Plan Completeness | PASS (1 observation) |

## Grounding

14/14 paths ✓, 7/7 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓

Deep verification confirmed all load-bearing claims:
- RLS policies exactly as described — anon `using (is_published)`; owner-draft leak real (`20260605200000:195-197`), explicit `is_published = true` predicates necessary.
- Occupancy semantics match `accept_booking_request` (`20260605094725:76-85`); `request_status` enum values match the planned test cases exactly.
- Middleware protects only `/dashboard` (`src/middleware.ts:4`) — `/katalog` and `/zagrody/[id]` are anon-reachable with zero middleware changes.
- House style supports the RPC shape (`email_verified()` = sql/stable/definer/search_path=''; `accept_booking_request` = returns-table definer). One deviation correctly flagged by the plan: grant EXECUTE to `anon`, which no existing function does.
- CI deploy job runs `supabase db push` before `wrangler deploy` (`.github/workflows/ci.yml:54-67`) — lessons.md deploy rule honored.
- Test case (b) feasible — `createSignedInClient` / `createOwnerClient` fixtures exist (`tests/helpers/supabase.ts:27,40`).
- Blast radius clean: no existing `/katalog` / `/zagrody` references; `getPublicUrl`/`zagroda-photos` conventions match `dashboard.astro` and `api/zagroda/photo.ts`.
- Publish gate requires name/description/voivodeship/city + ≥1 turnus; photo optional — plan's placeholder handling correct.

Nit (no finding): `VOIVODESHIPS` is at `src/lib/zagroda.ts:5-6`, not `:4-5` — corrected in plan during triage.

## Findings

### F1 — "No occupancy numbers reachable" is unprovable: the boolean is an oracle

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Key Discoveries / brief Success Criteria / test case (i)
- **Detail**: `is_available` with caller-controlled `p_participants` is a binary-search oracle — ~10 anon RPC calls recover exact remaining capacity for any zagroda/date. Inherent to FR-002 and leaks no guest data, but the brief claimed "no occupancy numbers reachable — proven by tests", which tests cannot prove.
- **Fix**: Reword the privacy claim in plan + brief to "no guest data fields; occupancy exposed only as a derived boolean (count inferable by repeated queries — accepted by design)".
- **Decision**: FIXED — plan.md Key Discoveries + What We're NOT Doing, plan-brief.md Success Criteria reworded.

### F2 — Past dates pass `data` validation

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Filter param parsing / Critical Implementation Details
- **Detail**: Validation only required `data` to parse as a real YYYY-MM-DD; the date input's `min` = today is client-side only. A shared/crafted URL with a past date was "valid" and silently computed availability for a past day — implementer would have to guess whether to honor or drop it.
- **Fix**: Classify `data` < today as invalid → silently dropped, consistent with the existing invalid-param policy.
- **Decision**: FIXED — Critical Implementation Details + Phase 2 validation contract updated (also corrected `zagroda.ts:4` → `:5`).

### F3 — Publish gate runs only at publish time; published rows can degrade to null fields

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — cities dropdown / card markup
- **Detail**: `set_zagroda_published` enforces non-null description/voivodeship/city only at publish time (`20260605200000:147-171`). Owner INSERT is restricted to drafts but UPDATE on published rows isn't, and the dashboard Zod schema allows nullable fields (`src/lib/zagroda.ts:32`) — a published zagroda can later carry nulled city/description. Confidence: MEDIUM — UPDATE policy not verified end-to-end.
- **Fix**: Defensive handling in Phase 2 contract: filter null/blank cities from the dropdown; cards render missing fields as empty, never "null".
- **Decision**: FIXED — Phase 2 dropdown-source and card-markup contracts updated.

## Triage Summary

- Fixed: F1, F2, F3 (3)
- Skipped: — (0)
- Accepted: — (0)
- Dismissed: — (0)
- **Verdict after fixes**: SOUND
