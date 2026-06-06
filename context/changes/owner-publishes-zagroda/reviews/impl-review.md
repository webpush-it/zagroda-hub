<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Owner Publishes Zagroda (S-01)

- **Plan**: context/changes/owner-publishes-zagroda/plan.md
- **Scope**: Full plan (3 phases)
- **Date**: 2026-06-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria re-run during review: `npm run lint` PASS; `npm test` 34/34 PASS (incl. F-01 regression); `npm run build` PASS (deploy build 2288b94b post-dates all code); `db reset` + `db:types` drift-free after 20260606010000. Manual items 1.5, 2.4–2.6, 3.4–3.8 evidenced in-session (browser-driven verification at 390×844, production smoke with real signup → confirm → publish, anon REST proof against prod).

Review positives: 0 DRIFT / 0 MISSING across all planned changes; lessons.md lock-order rule respected (turnusy reconcile updates only label/start/end — never id/zagroda_id); storage paths owner-scoped with no traversal; resend enumeration-safe; "What We're NOT Doing" boundaries all held.

## Findings

### F1 — Extra migration not back-referenced in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260606010000_zagroda_photos_select_policy.sql
- **Detail**: Added during Phase 3 verification (photo replace silently orphaned old objects — Storage's remove() SELECTs under caller RLS first; with no SELECT policy it no-ops). The migration header and the p3 commit message document the why, but plan.md (Changes Required / Migration Notes) says nothing. Future readers diffing plan vs. migrations see an unexplained file.
- **Fix**: Add a one-line addendum to the plan's "Migration Notes" section referencing the migration and the verification finding that motivated it.
- **Decision**: PENDING

### F2 — Turnusy reconcile is non-atomic (no transaction)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/zagroda/index.ts:74-112
- **Detail**: Upsert + delete/update/insert turnusy run as independent REST calls. A mid-loop failure (e.g. 23503 on delete after an insert committed) leaves a partially reconciled state with a 409/500. Retry converges (reconcile is keyed by id, deletes-missing), so it self-heals — but one failed save can show a confusing intermediate state. Low blast radius at MVP scale (one owner, ≤20 rows, button disabled while saving).
- **Fix A ⭐ Recommended**: Add a code comment documenting the non-atomicity + retry-convergence now; move reconcile into a SECURITY DEFINER function (single transaction) when S-03 touches booking/turnusy write paths.
  - Strength: Zero risk now; S-03 must revisit these paths anyway (plan's accepted-risk note already assigns the turnus-edit guard to S-03).
  - Tradeoff: Window of non-atomicity stays open through S-02.
  - Confidence: HIGH — failure modes enumerated; retry convergence verified by reading the reconcile logic.
  - Blind spot: None significant.
- **Fix B**: Write the SECURITY DEFINER reconcile function now.
  - Strength: Closes the gap immediately; centralizes the 23503→domain-error mapping in the DB layer.
  - Tradeoff: New migration + function + test coverage right after the change closed; expands S-01 scope post-implementation.
  - Confidence: MED — pattern exists (accept_booking_request), but untested scope growth after sign-off.
  - Blind spot: Interaction with S-03's planned guard design — might get reworked twice.
- **Decision**: PENDING

### F3 — Prod DB had no migration path (process gap)

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: N/A (deploy pipeline)
- **Detail**: Deploy = wrangler only. Neither the plan, CI, nor any runbook pushed migrations to the hosted DB — F-01 and S-01 schemas lived only locally until the production smoke failed. Fixed ad-hoc this session (6 migrations applied via Management API, bookkeeping recorded in supabase_migrations.schema_migrations), but the class of failure will recur on every future slice unless captured.
- **Fix**: Record as a recurring rule via /10x-lesson (deploy checklist: schema changes require `supabase db push` / CI step before or with the worker deploy).
- **Decision**: PENDING

### F4 — signin/signup: unvalidated casts + raw error reflection

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signin.ts:6,20 / signup.ts:6
- **Detail**: `form.get("email") as string` without zod (pre-existing starter pattern; plan only scoped error-mapping here). Non-mapped errors reflect Supabase's raw message into the redirect query. resend.ts now sets the better precedent (zod + fixed Polish strings).
- **Fix**: Align signin/signup with the resend.ts pattern when next touching auth (S-06 password reset is the natural moment).
- **Decision**: PENDING

### F5 — Select-then-insert upsert races owner_id UNIQUE

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/zagroda/index.ts:46-72
- **Detail**: Two concurrent first-saves could both miss `existing` and one insert dies on the UNIQUE constraint as a generic 500. Practically unreachable (one owner, one session, button disabled while saving); DB integrity holds either way.
- **Fix**: Switch to `.upsert(..., { onConflict: "owner_id" })` if ever hardening this path.
- **Decision**: PENDING
