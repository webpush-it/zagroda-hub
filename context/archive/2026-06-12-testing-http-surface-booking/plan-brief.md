# HTTP-Surface Integration on the Booking Lifecycle — Plan Brief

> Full plan: `context/changes/testing-http-surface-booking/plan.md`
> Research: `context/changes/testing-http-surface-booking/research.md`

## What & Why

Rollout Phase 1 of the quality contract (`test-plan.md` §3): integration tests at the HTTP handler+middleware layer for the booking lifecycle. The DB layer already proves atomicity, RLS, and token semantics — but nothing above it is tested, and the handler can miscall the RPC, swallow its error, leak contact data, or skip validation entirely while CI stays green. This phase closes that gap for risks #1 (concurrent acceptance), #4 (IDOR), #5 (hostile guest input), and #6 (publication gate).

## Starting Point

16 test files exist, all at DB/unit layer. The research doc mapped the complete handler-contract surface (5 API routes + middleware), evaluated three harness options, and recommended direct handler import composed with the real middleware — no dev server, no new processes, runs inside the existing `npm test` against the local Supabase stack.

## Desired End State

`tests/api/` holds four suites proving at the HTTP layer: two parallel accepts → exactly one wins and the loser sees the PRD-specified refusal; foreign owners and anonymous clients get refusals (404/401), never data; forged cancel tokens and client-bypassing payloads are rejected server-side; unverified owners can't publish. Cookbook §6.3 tells the next contributor how to add such a test; §7 records what we deliberately didn't cover and why.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Harness | Direct handler import + real middleware via 2 vitest aliases, auth through the real signin handler | Full session/RLS fidelity at near-zero runtime cost; dev-server and Container API options evaluated and rejected | Research |
| Capacity-message oracle | Full-string assertion built from the PRD FR-014 template + fixture numbers | Strongest regression net with no oracle-from-handler-code anti-pattern — the PRD makes the message an acceptance criterion | Plan |
| IDOR scope | API routes now; the contact-data SSR page (`[id].astro`) delegated to Phase 2 e2e | Stays inside the proven harness; the page needs rendering machinery that was rejected for one test | Plan |
| Merge guard | Publication gate tested; OAuth callback HTTP path documented as a deliberate gap in §7 | Guard logic + RPC already covered at unit/db layers; faking OAuth against GoTrue is high-cost/low-signal | Plan |
| Quota drain | Risk accepted for MVP; Cloudflare-level rate limiting named as remediation path, documented in §7 | Zero implementation cost in a testing phase; platform layer is the right place for an anonymous endpoint | Plan |
| Outbox assertions | Light only — row appears on accept/withdraw, none on refusal | Near-free with the admin client and pins "refusal must not email"; deep contracts belong to Phase 3 | Plan |
| Foreign-owner expectation | 404, not 403 | RLS pre-SELECT hides the row before the RPC; a 403 would mean RLS was bypassed | Research |

## Scope

**In scope:** vitest aliases + env stub; `tests/helpers/api.ts` (cookie jar, APIContext, middleware composition, HTTP signin); four `tests/api/` suites (harness smoke, decision lifecycle, authz, guest input); `seedBookingRequest` guest-field overrides; test-plan §6.3/§6.6/§7 updates.

**Out of scope:** SSR page tests, OAuth merge-guard HTTP test, rate limiting implementation, deep outbox contracts, e2e, CI YAML, any production code change.

## Architecture / Approach

`onRequest(ctx, () => handler(ctx))` — the real middleware resolves the session from genuine `@supabase/ssr` cookies (written by invoking the real signin handler), then the directly-imported route handler runs against the local Supabase stack with RLS live. Two vitest aliases (`astro:middleware` → Astro's virtual-module file, `astro:env/server` → a 7-name stub) make the imports resolve. The stub's split is deliberate: service-role key present (outbox rows observable), Brevo config absent (no network from tests).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness | Aliases, env stub, api helpers, smoke test (anon 401 / owner 200) | Virtual-module aliasing or module-scope `inject()` misbehaving — contingency documented |
| 2. Decision lifecycle | Race, PRD-oracle capacity refusal, withdraw-frees-seats, error translation, light outbox | Race-test flakiness; mitigated by reusing the proven DB-layer pattern |
| 3. Authorization | Foreign-owner 404 / anon 401 matrix, contact non-exposure, publication gate | Unverified-owner fixture sequencing (signin before SQL-clear) |
| 4. Guest input | Server-side validation parity, full cancel-token matrix | Low — contracts pinned during planning |
| 5. Docs closeout | §6.3 cookbook, §7 documented decisions, §6.6 note | None |

**Prerequisites:** Docker + `npx supabase start`; no schema changes; no new dependencies.
**Estimated effort:** ~2–3 implementation sessions across 5 phases (Phase 1 is the riskiest; 2–4 are mechanical once it lands).

## Open Risks & Assumptions

- `astro/virtual-modules/middleware.js` export shape and module-scope `inject()` behavior were verified by research on astro 6.3.1 / vitest 4.1.8 — version bumps could shift either; the smoke test fails loudly if so.
- Phase-1 outbox assertions couple lightly to the `email_outbox` schema; §3 Phase 3 may touch them.
- The contact-data SSR page stays untested until Phase 2 e2e — accepted and documented, not forgotten.

## Success Criteria (Summary)

- `npm test` proves, through the same HTTP surface the owner's phone hits, that exactly one of two concurrent accepts wins and the loser sees the exact PRD refusal message.
- Both negative identities (foreign owner, anonymous) receive refusals — never data, never contact fields — on every decision route.
- A contributor can add the next HTTP-surface test from §6.3 alone.
