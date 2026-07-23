<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Typ grupy i neutralny język formularza (S-11)

- **Plan**: context/changes/group-type-neutral-language/plan.md
- **Scope**: All 4 phases (complete)
- **Date**: 2026-07-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- All 13 planned changes verified MATCH — no DRIFT / MISSING / EXTRA.
- "What we're NOT doing" boundaries all held: no free-text "inna"; no group_type in guest confirmation/decision emails (unit test asserts guest HTML has no "Typ grupy:"); no group_type in decision-endpoint selects; static "osoba kontaktowa" wording only; no RLS insert-policy change; no backfill.
- Only residual "nauczyciel" in repo is marketing copy at src/pages/index.astro:441 — explicitly excluded by the plan (What We're NOT Doing).
- Migration is a clean DROP+CREATE of create_manual_booking: exactly one overload, EXECUTE grant re-stated for the new 6-arg signature, `search_path=''` and SECURITY DEFINER hygiene preserved. Additive/backwards-compatible per the deploy lesson (nullable column, defaulted RPC param).
- Success criteria: `astro check` 0 errors, `npm run lint` exit 0, `npm test` 245/245 passing. Manual-booking DB suite 9/9 against live local DB (cases a/a2 cover typed + defaulted-null; g proves authenticated-only grant).

## Findings

### O1 — group_type "required" is app-layer only

- **Severity**: 🟢 OBSERVATION
- **Impact**: 🏃 LOW — no action; by-design and documented
- **Dimension**: Safety & Quality
- **Location**: src/lib/booking.ts:70; supabase/migrations/20260723130000_group_type.sql
- **Detail**: The guest "required" constraint lives only in the zod schema (client + server). The DB column is nullable and the anon INSERT RLS policy pins status/source/note but not group_type, so a crafted direct PostgREST anon INSERT could create a source='app' row with NULL group_type. This is exactly what plan.md:22 prescribes (additive/backwards-compat, enum type as the only value constraint, no RLS WITH CHECK edit) and renders gracefully everywhere (chip omitted, detail „—"). Consistent with app-only validation of phone/email format elsewhere.
- **Fix**: None — accepted by design.
- **Decision**: ACCEPTED (by design)

### O2 — Pre-existing "Wysłano {created_at}" label on phone rows

- **Severity**: 🟢 OBSERVATION
- **Impact**: 🏃 LOW — outside this change's scope
- **Dimension**: Pattern Consistency
- **Location**: src/components/booking/RequestsList.tsx:103
- **Detail**: The request-list row labels the date "Wysłano" for phone entries too, which weren't "sent" by a guest. Pre-existing, untouched by this change, not in the plan. Noted for completeness only.
- **Fix**: None — out of scope.
- **Decision**: SKIPPED (out of scope)
