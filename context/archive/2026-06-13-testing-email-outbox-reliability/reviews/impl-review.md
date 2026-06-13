<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Email Outbox Reliability — Test Rollout

- **Plan**: context/changes/testing-email-outbox-reliability/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-06-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria

- Full suite: `npm test` → **163 passed (21 files)**.
- Lint: `npm run lint` → exit 0, no errors.
- §6.5 TBD stub removed; §3 Phase 3 row = `complete` (`git grep` confirmed).
- Manual 4.4 (§6.5 self-sufficient) and 4.5 (§5 names secrets-newline mode) verified against source.

## Findings

### F1 — installBrevoMock is not re-entrant (latent footgun)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/helpers/brevo-mock.ts:71-72, 117-119
- **Detail**: `installBrevoMock()` captured `realFetch = globalThis.fetch` at install and `restore()` wrote it back. Two stacked installs without an intervening restore would capture the prior wrapper as "real" and leak a stub across files (`fileParallelism:false` shares the process). Not triggerable by any current caller (one install + `afterEach` restore per test).
- **Fix**: Added a module-level `installed` flag — a second install while one is active now throws a clear error; `restore()` clears the flag. Turns the latent footgun into a loud failure at the call site.
- **Decision**: FIXED (Fix now). Verified: `tests/db/email-outbox-drain.test.ts` 6/6 still pass.

## Notes

Both review sub-agents independently rated all three test files CLEAN and all four phases MATCH. No mirror-implementation tests (failure paths assert non-null `last_error` and `expect.stringContaining` on documented log markers; `next_attempt_at` advance compared against a captured `before` snapshot). Layer boundary correct (unit = mocked admin client + stubbed fetch; db = real Supabase + Brevo-edge-only mock). The pre-claim `attempts: 4` (integration) vs post-claim `attempts: 5` (unit) seeds are each correct for their layer. The §5 nested-`DrainResult` shape authored in Phase 4 was flagged as more accurate than the plan's flattened sketch.
