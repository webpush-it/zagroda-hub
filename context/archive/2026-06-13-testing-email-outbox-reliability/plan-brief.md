# Email Outbox Reliability (Test Rollout Phase 3) — Plan Brief

> Full plan: `context/changes/testing-email-outbox-reliability/plan.md`
> Research: `context/changes/testing-email-outbox-reliability/research.md`

## What & Why

Phase 3 of the project's phased test rollout closes the coverage gap for **risk
#2** — *transactional email silently stops (provider error, retry-budget
exhaustion, outbox/cron bug) and nobody notices for days*. Today two test layers
flank the drain loop but neither runs it honestly: the DB suite proves the SQL
primitive but never drives `drainDueEmails`, and the unit suite drives the drain
only by **mocking the admin client** — the exact anti-pattern §2 warns against.

## Starting Point

The outbox is a lease-based retry queue (`pending → sent | failed`, no `sending`
state); the claim RPC *is* the lease. The drain loop (`src/lib/email/outbox.ts`)
is **non-atomic by design** — claim, then Brevo call, then mark, as separate
writes. `tests/db/email-outbox.test.ts` covers the RPC; `tests/unit/email.test.ts`
covers the drain with a mocked client. No layer runs the real claim→send→mark
loop against real Supabase with only the provider edge mocked.

## Desired End State

A reusable Brevo-edge mock lets the real drain run against local Supabase while
only `api.brevo.com` is intercepted. New integration tests prove every risk-#2
failure mode (retry-claimable, no double-send, hard-fail after budget, null-config
no-op); hermetic tests pin the three branches real infra can't trigger; the
cookbook documents the pattern; and a manual pre-prod smoke criterion captures the
one failure mode no integration test can — corrupted secrets.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Brevo 429 / quota oracle | Don't test this phase | Quota remediation is delegated to Cloudflare WAF, not app code (§7); no automated 429 coverage. | Plan |
| Mark-error-write-failure | Pin current best-effort | Matches archived F3 accepted-risk posture: swallowed, no throw, logged; the budget leak is documented, not fixed. | Research + Plan |
| Empty `provider_message_id` on 2xx | Acceptable (sent + empty id + warn) | Delivery succeeded; only the audit id is missing — re-sending risks a duplicate Brevo isn't idempotent on. | Research + Plan |
| "Make outbox observable" scope | Test-only + manual smoke | Assert existing `console.*` signals; no new runtime/observability code — keeps Phase 3 a testing phase. | Plan |
| Brevo edge mock mechanism | Reusable URL-routing helper | `vi.stubGlobal("fetch")` would break the real supabase-js client; route only `api.brevo.com`, delegate the rest. | Research + Plan |
| Test file layout | New `tests/db/` file + extend `tests/unit/` | Integration lands at the real-DB layer; hermetic reuses the existing mock-admin factory. | Plan |
| Manual pre-prod smoke | Author it now | Only artifact that catches the secrets-newline corruption (lessons.md) an integration test can't see. | Plan |

## Scope

**In scope:** selective Brevo-edge mock helper; integration drain suite (real
Supabase); hermetic partial-failure + claim-error tests; cookbook §6.5/§6.6;
manual pre-prod smoke criterion (§5); rollout status sync (§3, change.md).

**Out of scope:** 429/quota assertions; any `src/lib/email/` code change; new
observability/health-endpoint code; re-testing the SQL primitive or the Brevo
payload contract; e2e; Worker `scheduled` HTTP harness; CI gate wiring.

## Architecture / Approach

Bottom-up, mirroring the test-plan chain: **(1)** build the edge-mock capability
the integration tests depend on → **(2)** the integration drain suite (the unique
signal, real RPC + real DB writes, literal injected `EmailConfig`, table wiped in
`beforeAll`) → **(3)** the hermetic branches (stub the second write / the RPC) →
**(4)** docs + status sync. Phases 2–3 are TDD'able; 1 and 4 route to
`/10x-implement`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Edge-mock helper | `tests/helpers/brevo-mock.ts` (selective fetch routing) | A leaked global-fetch stub breaks later files (shared process) |
| 2. Integration drain | `tests/db/email-outbox-drain.test.ts` vs real Supabase | Determinism trap: stale rows steal claims unless table wiped; pre-claim attempts seeding |
| 3. Hermetic branches | Extended `tests/unit/email.test.ts` | Asserting the wrong branch (row must stay `pending`, not `failed`) |
| 4. Docs & sync | Cookbook §6.5/6.6, §5 smoke, §3 status `complete` | Smoke criterion omitting the secrets-newline failure mode |

**Prerequisites:** local Supabase stack (`npx supabase start`); research doc
(present); existing `tests/helpers/` harness.
**Estimated effort:** ~1–2 sessions across 4 phases (mostly test authoring).

## Open Risks & Assumptions

- The edge mock must restore the original `fetch` in teardown or it silently
  corrupts later files (`fileParallelism: false` → shared process).
- Seeding `attempts: 5` makes a row un-claimable (`attempts < 5`); the at-cap
  path must seed `attempts: 4` and let the claim bump it.
- The injected literal `EmailConfig` is the only way to reach the real send
  branch — the env stub deliberately keeps `getEmailConfig()` null.

## Success Criteria (Summary)

- The real drain loop is proven against real Supabase with only the Brevo edge
  mocked — every risk-#2 failure mode asserted from the oracle, not the code.
- The three branches real infra can't trigger are pinned hermetically.
- A newcomer can author a new provider-edge test from cookbook §6.5 alone, and
  the §5 smoke criterion names the secrets-corruption failure mode explicitly.
