<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Phone Bookings & Day Blocks (S-08)

- **Plan**: `context/changes/phone-bookings-and-day-blocks/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-19
- **Verdict**: REVISE → SOUND (all findings fixed in plan during triage)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (fixed) |
| Plan Completeness | WARNING (fixed) |

## Grounding

9/9 paths ✓, 3/3 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓. Deep verification (1 sub-agent, 7 claims): `withdraw_booking_request` confirmed safe on null-guest phone rows; existing DB/API tests use `toMatchObject`/property access — new `day_blocked` return column is non-breaking; `seedBookingRequest` uses service role (RLS bypassed, triggers NOT); `catalog_zagrody` C-O-R viable if return type unchanged; no other guest-column consumers beyond those the plan now lists (anuluj.astro/CancelRequest clean).

## Findings

### F1 — Nullable guest columns break typecheck in files the plan doesn't touch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1/§6
- **Detail**: After `npm run db:types`, guest_* become `string | null`. E-mail builders call `escapeHtml(ctx.guest_name)` unguarded (src/lib/booking.ts:96-98, 180, 200, 221); accept.ts/reject.ts pass them straight in — Phase 2's typecheck criterion fails, and reject.ts wasn't in the plan. In withdraw.ts the builder is evaluated as an argument outside `enqueueDecisionEmail`'s try/catch (src/lib/booking-decision.ts:20-30) — null guest_name would throw AFTER the DB withdraw committed (500 post-mutation).
- **Fix**: Extend Phase 2 §6 to all three decision routes; guard the entire e-mail block (builder + enqueue) behind `guest_email !== null`.
- **Decision**: FIXED (plan Phase 2 §6 rewritten: covers accept/reject/withdraw, documents the try/catch boundary)

### F2 — "The INSERT policy" is actually TWO policies

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1, item 3
- **Detail**: domain_schema.sql:137-143 defines separate anon and authenticated INSERT policies; singular wording risked recreating only one, leaving the other role able to forge `source='phone'` rows.
- **Fix**: Name both policies explicitly in the migration contract.
- **Decision**: FIXED (both policy names now spelled out in Phase 1 item 3)

### F3 — New trigger fires on service-role test seeds — seeding order matters

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §3 (day-blocks tests)
- **Detail**: Service-role seeder (tests/helpers/supabase.ts:191-208) bypasses RLS but NOT triggers. Day-block tests need a pending request on a blocked day; seeding after blocking fails on the new trigger.
- **Fix**: Seed the pending request BEFORE `block_day`; assert trigger rejection separately via direct pending insert on an already-blocked day.
- **Decision**: FIXED (seeding-order note added to Phase 1 §3 contract)

### F4 — `npx astro check` is a brand-new gate, not an existing one

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2/3 success criteria
- **Detail**: @astrojs/check is installed but nothing invokes it today (ci.yml: lint → build → vitest). Pre-existing type errors would surface for the first time inside this change.
- **Fix**: Keep the criterion; run once at Phase 2 start to establish the baseline.
- **Decision**: FIXED (baseline note added to Phase 2 §1 contract)

### F5 — catalog_zagrody day-block check must live inside the existing CASE

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1, item 10
- **Detail**: `is_available` must stay NULL when `p_trip_date` is null (`order by is_available desc nulls first` depends on it); an output column would change the return type and forfeit CREATE OR REPLACE.
- **Fix**: Keep the null arm first; fold the day-block EXISTS into the else branch as `false`.
- **Decision**: FIXED (CASE-placement clarification added to Phase 1 item 10)
