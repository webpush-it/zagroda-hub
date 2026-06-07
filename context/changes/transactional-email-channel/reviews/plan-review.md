<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Transactional Email Channel (F-02)

- **Plan**: context/changes/transactional-email-channel/plan.md
- **Mode**: Deep
- **Date**: 2026-06-07
- **Verdict**: REVISE → SOUND after triage (all findings fixed in plan)
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL → fixed |
| Plan Completeness | WARNING → fixed |

## Grounding

12/12 paths ✓, symbols ✓ (`SUPABASE_URL`/`SUPABASE_KEY` astro.config.mjs:19-20, null-guard supabase.ts:7-9, zod signup.ts:5-8, deploy order package.json:18), brief↔plan ✓, Progress↔Phase contract ✓. `docs/reference/contract-surfaces.md` absent — check skipped. Lessons priors: deploy lesson complied with; lock-order lesson correctly declared inapplicable.

Sub-agent verification: custom-entry API shape confirmed for adapter v13 (`@astrojs/cloudflare/handler` export exists, `workerEntryPoint` removed); `locals.user` populated by middleware (src/middleware.ts:13, src/env.d.ts:3); astro:env request-scoping mitigation confirmed correct; CI blast radius low (bare `wrangler deploy` reads generated config, ci.yml:67 — no CI change needed); globalSetup throws without local stack (global-setup.ts:63-70). Caveat: node_modules not installed in this checkout, so installed-adapter merge behavior was corroborated from docs/GitHub source, not byte-verified.

## Findings

### F1 — Phase 3 sets `main` in wrangler.jsonc; the repo's own config documents that this breaks `npm run build`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 3.1 — Custom Worker entry
- **Detail**: wrangler.jsonc:2-6 explicitly warns "Do NOT add `main` here … breaks `npm run build`" (Cloudflare Vite plugin validating against not-yet-built dist/), yet Phase 3.1 prescribed exactly that. Official v13 docs support `main: ./src/worker.ts` + `@astrojs/cloudflare/handler`, so the comment may be stale — but it is first-hand local evidence, the cited issue withastro/astro#13838 is an unresolved feature request, and the `triggers` merge into `dist/server/wrangler.json` is unverified. The plan deferred the blocker to mid-Phase-3 instead of retiring it first.
- **Fix A ⭐ Recommended**: Front-load a build spike as Phase 3.1's first step (stub entry + `main` + crons → `npm run build` + `wrangler deploy --dry-run` → confirm cron in generated config; update stale comment if green, STOP and fall back if not).
  - Strength: Retires the highest-risk unknown in ~30 min before dependent work; docs support the exact pattern.
  - Tradeoff: If the spike fails, a plan-B decision is still needed mid-phase.
  - Confidence: MED — docs support it; comment is local empirical evidence.
  - Blind spot: Installed adapter merge behavior not byte-verified (node_modules absent).
- **Fix B**: Second minimal cron Worker calling a shared-secret drain endpoint; no custom entry.
  - Strength: The documented break structurally cannot occur.
  - Tradeoff: Second deployment artifact + new HTTP surface; contradicts "same Worker, no second deployment".
  - Confidence: HIGH it works, LOW it's worth the surface if the spike passes.
  - Blind spot: Free-plan multi-worker limits unchecked.
- **Decision**: FIXED via Fix A — Step 0 build spike added to Phase 3.1 contract; hazard + fallback recorded in Critical Implementation Details.

### F2 — No-op drain burns the attempts budget: 5 unconfigured drains permanently strand a row

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2.4 — Outbox orchestration
- **Detail**: Original contract claimed rows first, then checked `config === null` per row — but claiming bumps `attempts`, so each no-op drain consumed retry budget; after 5 the row is excluded by `attempts < 5` forever (never sent, never `failed`).
- **Fix**: Check `config === null` before calling the claim RPC; return `{ claimed: 0, sent: 0, failed: 0 }` without touching rows.
- **Decision**: FIXED — Phase 2.4 contract reordered; unit-test contract (2.6c) tightened to lock "no claim RPC call, no attempts consumed".

### F3 — Phase 2.6's vitest hedge solves the wrong problem; the real constraint is unconditional globalSetup

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2.6 — Unit tests
- **Detail**: The "extend the include glob" conditional was moot (vitest.config.ts:9 already includes `tests/**/*.test.ts`); the actual constraint is vitest.config.ts:10's unconditional globalSetup, which throws without the local Supabase stack (global-setup.ts:63-70) — so "pure" unit tests still require the stack.
- **Fix**: Replace the conditional with the real note: unit tests run with the stack up, accepted as least machinery; vitest-project split out of scope.
- **Decision**: FIXED — Phase 2.6 note corrected.

### F4 — `locals.user.email` is `string | undefined`; endpoint contract didn't name the missing-email behavior

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3.2 — Guarded test endpoint
- **Detail**: supabase-js types `User.email` as `email?: string`; the contract sent "only to locals.user.email" without specifying the undefined case.
- **Fix**: Respond 400 when `locals.user.email` is undefined.
- **Decision**: FIXED — added to Phase 3.2 contract.

### F5 — Any authenticated user can drain the 300/day Brevo quota through the test endpoint

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3.2 — Guarded test endpoint
- **Detail**: Auth-only + self-addressed, but un-rate-limited and permanent; a looping authenticated user could exhaust the free-tier quota and starve S-03/S-04/S-05 booking emails.
- **Fix**: Record the accepted risk in Phase 3.4's documentation contract (cap/remove if abuse appears).
- **Decision**: FIXED — accepted risk recorded in Phase 3.4 contract.

## What checked out cleanly

Claim-function SQL (lease semantics, `FOR UPDATE SKIP LOCKED`, attempts cap) sound; explicit-config-injection for `scheduled` is the correct pattern; CI deploy invocation unaffected by custom entry; Brevo payload contract matches docs; Progress section parses against the format contract; scope boundaries respected (no "NOT doing" leakage into phases).
