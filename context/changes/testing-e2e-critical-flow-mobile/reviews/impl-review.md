<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: E2E Critical Flow on Mobile Viewport

- **Plan**: context/changes/testing-e2e-critical-flow-mobile/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-06-14
- **Verdict**: NEEDS ATTENTION (at review time) → RESOLVED after triage
- **Findings**: 0 critical, 2 warnings, 3 observations
- **Triage outcome**: F1–F4 fixed (lint + tsc clean), F5 acknowledged. Fixes uncommitted as of triage.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — IDOR leak-probe phone has a weak uniqueness space

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: e2e/idor-contact-data.spec.ts:23-26
- **Detail**: The foreign-owner leak assertion proves A's contact data is absent by asserting the exact guest phone string has zero DOM occurrences. The guest email is a full randomUUID (safe), but the phone is only 6 random digits (~900k values). The suite never tears down rows (isolation-by-unique-data), so phone strings accumulate across runs; a birthday-bound collision becomes plausible over time, letting the absence assertion pass against a different test's leaked phone — a false negative in a security test. `seedForeignRequest` already receives a UUID `suffix` (line 53) the phone ignores.
- **Fix**: Derive the phone from the same unique `suffix` instead of a fresh 6-digit random, so the probe string is as unique as the email/name. One-function change, no new dependency.
- **Decision**: FIXED — uniquePhone(suffix) now derives 9 digits from the UUID suffix (tsc clean).

### F2 — Unhandled .dev.vars write at an external boundary

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: e2e/global-setup.ts:95
- **Detail**: Every other external boundary in this file (execSync, JSON.parse) is wrapped with a descriptive throw, but writeFileSync(".dev.vars") is bare. A write failure (read-only cwd, permissions) surfaces a raw fs error with no hint that the harness needs .dev.vars for `wrangler dev`. Low blast radius, inconsistent with the file's own standard.
- **Fix**: Wrap the write in try/catch and rethrow with context ("failed to write .dev.vars for wrangler dev: …").
- **Decision**: FIXED — writeFileSync wrapped in try/catch, rethrows with descriptive cause.

### F3 — webServer reuse / workerd orphan on Windows

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture (Reliability)
- **Location**: playwright.config.ts:37,39
- **Detail**: reuseExistingServer:!CI reuses any local `wrangler dev` already on :8787 — if started against a different build or .dev.vars, tests silently run stale (header documents the stale-build risk for the build step, not a reused server). Separately, workerd has a history of orphaning on win32; a leaked process shows up as port-8787-in-use on re-run. Acceptable for local DX as-is.
- **Fix**: Add a one-line note to the config header about the reuse caveat; if orphans appear, set reuseExistingServer:false locally.
- **Decision**: FIXED — added a comment at reuseExistingServer documenting the stale-build/orphan caveat and the remedy.

### F4 — Loose "Oczekujące" assertion not bound to guest2's row

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/critical-flow.spec.ts:123
- **Detail**: After the block, the test asserts a "Oczekujące" (pending) badge is visible somewhere on the page rather than on guest2's specific request. If the page ever lists any pending item, this could pass spuriously. The capacity/leak assertions above it are tight; this one is looser.
- **Fix**: Scope the badge assertion to guest2's request row/panel.
- **Decision**: FIXED — exact "Oczekujące" match + assert akceptuj2 button still visible (decision buttons render only while status==="pending"), binding pending-state to this request.

### F5 — One CSS selector: astro-island[ssr] (justified)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: critical-flow.spec.ts:34, idor-contact-data.spec.ts:35
- **Detail**: waitForIslandHydrated uses .locator("astro-island[ssr]") — the only CSS selector in the suite, nominally against the role/label/text rule. But it targets an Astro framework hydration attribute (no accessible-name equivalent for "is this island hydrated"), is well-commented, and is a real-state wait (not a timer). Justified exception.
- **Fix**: None — documented framework exception.
- **Decision**: ACKNOWLEDGED — accepted as-is, no code change.
