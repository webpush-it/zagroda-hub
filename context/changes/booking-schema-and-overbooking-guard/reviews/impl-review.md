<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Booking Schema & Overbooking Guard (F-01)

- **Plan**: context/changes/booking-schema-and-overbooking-guard/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-06-05
- **Verdict**: NEEDS ATTENTION (borderline APPROVED — 3 minor warnings, none blocking)
- **Findings**: 0 critical, 3 warnings, 4 observations
- **Triage** (2026-06-05): F1 fixed, F2 accepted-as-rule, F3 fixed, F4 skipped, F5 skipped (deferred to S-03), F6 fixed, F7 fixed — all warnings resolved

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria verification (live, 2026-06-05)

- `npm run lint` — PASS
- `npm run build` — PASS
- `npm test` — PASS (3 files, 18/18 tests, 16.3s, against running local stack)
- Anon privilege check: `has_function_privilege('anon','public.accept_booking_request(uuid)','execute')` → `f` — PASS
- CI on master: both `ci` + `test` jobs green on runs 27006169415 (p4) and 27006937932 (epilogue) — PASS
- `supabase db reset` not re-run locally (would wipe dev stack); evidenced by CI `test` job applying both migrations on a fresh stack — PASS by evidence
- Manual items 1.5–4.4 all checked `[x]` with commit SHAs in plan Progress; concurrency-collision review (3.5) consistent with test design (loser asserts winner's `occupied`)

## Notably good

Entire security surface verified: lock ordering as contracted (zagroda → request), `search_path = ''` pinned with fully-qualified names, ownership check inside the locked SELECT, double-accept blocked by `status='pending'` re-check under lock, clean ERRCODEs (P0002/42501/55000), no contact-data leakage in errors, EXECUTE revoked from PUBLIC+anon, zero UPDATE/DELETE policies on `booking_requests`. All 30+ planned items MATCH — no drift, no missing items.

## Findings

### F1 — Committed Studio scratch file (unplanned)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/snippets/Untitled query 574.sql
- **Detail**: Tracked file not in the plan (commit 6ef4c5e). Manual begin…rollback smoke test of accept_booking_request that inserts directly into auth.users with encrypted_password='' and forges JWT claims via set_config. Harmless as written (rolls back), but: placeholder name, hardcoded UUIDs, no CI coverage so it will silently rot, and the auth.users insert pattern breaks across Supabase versions. concurrency.test.ts already proves the same rule automatically.
- **Fix**: Delete the file — its purpose (Phase 2 manual smoke, item 2.4) is done, and the vitest suite covers it permanently.
- **Decision**: FIXED — file deleted (`git rm`)

### F2 — Lock-order contract rests on unenforced zagroda_id immutability

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605094725_accept_booking_request.sql:35-43
- **Detail**: The function pre-reads booking_requests.zagroda_id WITHOUT a lock to know which zagroda row to lock first. Correct today — no UPDATE policy exists and the function is the only mutator — and the comment documents the invariant. But nothing in the schema ENFORCES it: a future SECURITY DEFINER function (S-03 guest-cancel, S-05 withdrawal) or any service-role path that changes zagroda_id would silently break per-zagroda serialization — the exact guarantee F-01 exists to prove.
- **Fix A ⭐ Recommended**: Record as recurring rule in lessons.md
  - Strength: The invariant threatens future slices (S-03/S-05 add exactly the kind of mutator that could violate it); a lesson puts it in front of every future /10x-plan and /10x-impl-review. Zero schema churn.
  - Tradeoff: Enforcement stays human — a rule can be missed.
  - Confidence: HIGH — lessons.md is re-read by the planning chain.
  - Blind spot: Direct service-role/SQL access bypasses any process-level rule.
- **Fix B**: Enforce in schema — BEFORE UPDATE trigger raising on zagroda_id (or turnus_id/trip_date) change
  - Strength: Mechanical enforcement; impossible to violate even from service role.
  - Tradeoff: New migration now; a legitimate future "move request" feature would have to drop it.
  - Confidence: MED — trigger is simple, but it constrains design space slices haven't explored yet.
  - Blind spot: Haven't checked whether any planned slice intends to re-point a request at another turnus.
- **Decision**: ACCEPTED-AS-RULE: "Lock-order: booking_requests.zagroda_id is a load-bearing immutable" (Fix A — lesson recorded in context/foundation/lessons.md; trigger enforcement consciously declined)

### F3 — No upper bound on participants_count / daily_limit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605090307_domain_schema.sql:48 (and :22)
- **Detail**: Both columns only CHECK (… > 0). Anon can INSERT a pending request for 2,000,000,000 participants — it can't overbook (the rule blocks it) but it's junk an owner wades through, and in theory the v_occupied + v_participants fit check (accept fn :85) can overflow int4 → error 22003 instead of a clean accepted=false. One bound closes both.
- **Fix**: New migration adding CHECK (participants_count BETWEEN 1 AND 1000) and a similar sane cap on daily_limit (exact cap is a domain decision — school-trip scale suggests low hundreds).
- **Decision**: FIXED — migration 20260605121500_count_upper_bounds.sql (caps 1000/1000); applied via `supabase migration up`, 18/18 tests green

### F4 — CI test job has no explicit DB-readiness gate

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:35-36
- **Detail**: `npx supabase start` → `npm test` with no readiness check. `supabase start` does block until healthy and CI is green twice, so this is speculative — but the trimmed `-x` service list changes startup timing.
- **Fix**: None now; add a `pg_isready` loop only if a flake appears.
- **Decision**: SKIPPED — accept as-is; act only if a CI flake appears

### F5 — trip_date can be in the past

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605090307_domain_schema.sql:47
- **Detail**: No constraint prevents booking yesterday. A CHECK against now() isn't portable in migrations anyway — this belongs at the form/API boundary in S-03. Flagged so it's a conscious deferral, not an oversight.
- **Fix**: Defer — validate at the S-03 public form boundary.
- **Decision**: SKIPPED — conscious deferral; past-date validation belongs at the S-03 public-form boundary

### F6 — updated_at maintained manually, no trigger

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260605090307_domain_schema.sql:54
- **Detail**: accept_booking_request sets updated_at by hand (:88) — fine while it's the only mutator, but S-03/S-05 add more write paths that must each remember to do the same.
- **Fix**: Add a BEFORE UPDATE trigger when S-03 lands its mutator (or now, in the same migration as F3 if doing one).
- **Decision**: FIXED — migration 20260605123000_updated_at_trigger.sql (set_updated_at trigger on booking_requests); applied, lint + 18/18 tests green, generated types unchanged

### F7 — Unguarded JSON.parse in test global setup

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/helpers/global-setup.ts:34
- **Detail**: execSync is wrapped in try/catch but JSON.parse of the CLI output isn't — malformed output throws an opaque SyntaxError instead of reaching the friendly "could not resolve credentials" message. Test-infra ergonomics only.
- **Fix**: Wrap the parse in try/catch returning null so the existing fallback path is reached.
- **Decision**: FIXED — JSON.parse wrapped in try/catch returning null (tests/helpers/global-setup.ts)
