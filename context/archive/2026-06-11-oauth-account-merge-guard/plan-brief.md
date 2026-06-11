# OAuth Account-Merge Guard Hardening (S-07) — Plan Brief

> Full plan: `context/changes/oauth-account-merge-guard/plan.md`
> Research: `context/changes/oauth-account-merge-guard/research.md`

## What & Why

S-06 shipped the FR-018 OAuth merge guard (unverified provider email + existing password account → block). Research found the guard **fails open** in two branches: when the service-role client is missing, and — worse, with no log at all — when the collision RPC errors (the exact failure a newline-corrupted `SUPABASE_SERVICE_ROLE_KEY` produces, a real incident recorded in lessons.md). This change makes the guard fail closed and pins its behavior with tests, fulfilling roadmap slice S-07.

## Starting Point

The guard exists and works: pure decision in `src/lib/auth/oauth-guard.ts`, enforcement in `src/pages/api/auth/callback.ts`, service-role-only SQL detector `password_account_exists`. PRD Open Question #1 is resolved (option a — reject unverified-collision logins), so S-07's scope shrank to hardening + verification. The live `email_verified=false` path has never executed (Meta App Review blocks producing one).

## Desired End State

An unverified-email OAuth login can never slip through because the collision check silently failed. The code expresses three explicit outcomes: allow, block-collision (existing message), block-unavailable (new generic message + `console.error` visible in `wrangler tail`). Unit and DB tests pin the full decision space and the detector's behavior across identity configurations.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope of hardening | Fail-closed guard only (gap #1) | The one branch where the guard disables itself, with a proven real-world trigger; other gaps are imprecise-but-safe or v2. | Plan |
| Fail mode UX | Block with a generic "temporarily unavailable" message | Secure default that doesn't falsely claim a password account exists; clearly an ops signal. | Plan |
| Identity selection fix (gap #2) | Out of scope | `find()` imprecision errs toward blocking — not unsafe. | Plan |
| OAuth-vs-OAuth detection (gap #3) | Out of scope (v2) | Widens beyond FR-018's letter; split-brain, not takeover. | Research |
| Live `email_verified=false` verification | Unit truth table + DB simulation tests; live Facebook smoke stays best-effort | Meta App Review blocks the real path; deterministic CI coverage beats waiting. | Plan |
| Scenario B (pre-registration attack) | Probe test + documented GoTrue assumption | We can prove locally that an unconfirmed password account still trips the detector; GoTrue's linking decision itself only runs in a real handshake. | Plan |
| Decision-function shape | Tri-state input, verdict enum output | Two block reasons need two messages without the callback growing logic; callback is the sole consumer. | Plan |

## Scope

**In scope:**
- `resolveOAuthVerdict` (allow / block_collision / block_unavailable) replacing `shouldBlockOAuth`; new `blockUnavailable` message
- Callback treats admin-client-null, RPC-error, AND missing-user-email (unverified path) as "check unavailable" → block + `console.error`
- Extended unit truth table; new `tests/db/oauth-merge-guard.test.ts` (collision post-state, OAuth-only boundary, scenario-B probe)
- Deploy + prod Google regression smoke; documented assumption + Facebook smoke outcome in `change.md`

**Out of scope:**
- Sign-in-specific identity selection; OAuth-vs-OAuth collision detection; hosted-dashboard parity audit
- Manual merge flow (OQ#1 option c); changing the existing block message; deleting orphan users; GoTrue handshake-level tests

## Architecture / Approach

Keep the S-06 split: pure, unit-testable decision logic in `oauth-guard.ts`; thin mechanical enforcement in the callback. The collision-check result becomes tri-state (`true`/`false`/`null` = could not run) and the decision returns a verdict enum. No schema migration — the existing SQL detector is untouched; new DB tests use the established direct-SQL `pg` fixture pattern (note: `auth.identities.email` is a generated column).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fail-closed guard semantics | Verdict refactor + callback rewire + unit truth table | Getting the tri-state mapping wrong (RPC error must be `null`, never `false`) |
| 2. DB simulation + probe tests | `tests/db/oauth-merge-guard.test.ts` + documented assumption | SQL fixture fragility against the `auth` schema (generated column, NOT NULLs) |
| 3. Deploy + manual verification | Prod deploy, Google regression smoke, recorded Facebook outcome | None significant — code-only deploy, rollback-safe |

**Prerequisites:** `npm install` in this worktree; local Supabase running for ALL test runs (`npm run db:start` — the vitest globalSetup requires it even for unit tests); prod dashboard/wrangler access for Phase 3.
**Estimated effort:** ~1-2 sessions across 3 phases — a deliberately small slice.

## Open Risks & Assumptions

- **Accepted assumption**: GoTrue auto-links OAuth identities only for verified emails (S-06 spike + Supabase docs); this repo never tests GoTrue's handshake-time decision.
- A real ops failure (broken service-role key) now blocks legitimate unverified-email OAuth logins until fixed — intended behavior, but it's a user-visible consequence of an ops problem.
- The live unverified-Facebook path will likely remain unexecuted (Meta App Review); the slice closes with that documented, not proven live.

## Success Criteria (Summary)

- No code path allows an unverified-email OAuth login without the collision check having run — proven by the six-case unit truth table.
- DB tests pin the detector across identity configurations, including the unconfirmed-password-account (pre-registration) probe.
- Production Google sign-in (verified auto-merge path) still works after deploy.
