# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-12

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`, `tests/`.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (see §1
principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Owner double-books a day: two concurrent acceptances both succeed, or undo fails to free seats — angry teachers arrive at a full zagroda | High | Medium | PRD Success Criteria #1 + US-01; interview Q1; hot-spot dir `supabase/migrations/` (13 commits/30d — schema churn around the guard) |
| 2 | Transactional email silently stops (provider error, quota exhaustion, outbox/cron bug) — teacher never learns of acceptance/withdrawal, owner never sees new requests; nobody notices for days | High | Medium | Interview Q3 (lowest-confidence area); hot-spot dir `src/lib/email/` (11 commits/30d); CLAUDE.md.scaffold accepted-risk note (Brevo 300/day cap, un-rate-limited smoke endpoint) |
| 3 | A critical mobile flow (teacher request → owner acceptance) breaks in UI/middleware/handler wiring and ships to prod while CI stays green — nothing above the DB layer is exercised | High | Medium | Interview Q4; test-base profile (16 test files, all at DB/unit layer); hot-spot dir `src/pages/api/` (32 commits/30d) |
| 4 | Teacher contact data (email + phone) leaks to another owner or an anonymous user through an HTTP surface — privacy NFR broken (IDOR) | High | Medium | PRD NFR (contact visible only to that zagroda's owner); abuse lens: authorization/ownership; hot-spot dir `src/pages/api/` (32 commits/30d) |
| 5 | Guest-input abuse: a forged or missing cancellation token cancels someone else's request; the server accepts what only the client validates; un-rate-limited endpoints drain the daily email quota and starve booking emails | Medium | Medium | PRD FR-015 + US-02 acceptance criteria; abuse lens: untrusted input + resource abuse; CLAUDE.md.scaffold accepted-risk note |
| 6 | Auth-gating regression: an unverified owner publishes to the catalog (spam gate), or the OAuth merge guard regresses into an account-takeover path | High | Low | PRD FR-006/FR-010/FR-018 + anti-takeover NFR; roadmap S-07; existing db+unit guard tests reduce likelihood |

Likelihood note: interview Q2 surfaced no past incidents ("so far so
good"), so all likelihood ratings rest on churn and structure signal, not
on incident history.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Through the same HTTP surface the owner's phone hits: two parallel accepts on conflicting requests → exactly one succeeds and the loser sees the "X z Y zajęte" refusal; after undo, freed seats are immediately acceptable | "The RPC-level test already proves this" — the handler above it can miscall the RPC, swallow its error, or skip it entirely | How the accept/undo handlers invoke the atomic primitive; error translation to the user-facing message; auth/session shape on those routes | integration (HTTP handler vs local Supabase) | Re-testing the RPC and calling it handler coverage; lifting the expected message from handler code (oracle problem — take "X z Y zajęte" from PRD US-01) |
| #2 | A provider failure or quota error leaves the row claimable for retry, never double-sends, hard-fails after the attempt budget; null config is a logged no-op consuming no retries; a stuck outbox is observable | "Final status 200 means the mail went out"; "the cron sweep runs, therefore it works" | Outbox state machine (claim/lease/attempt budget); cron trigger shape on Workers; what is mockable at the Brevo HTTP edge | integration (outbox vs local Supabase, mocked provider edge) | Mocking outbox internals instead of the network edge; happy-path-only dispatch test |
| #3 | A scripted phone-viewport browser walks teacher request → owner accept → overbooking block against a built app; CI fails when the flow breaks | "DB tests green = product works"; "it works in `astro dev`, so the built Worker output is fine" | Real route/page entry points of the critical flow; owner auth/session bootstrapping in a browser context; seed-data strategy | e2e (1–2 flows only) | E2e-everything; asserting pixel details instead of flow outcomes |
| #4 | An authenticated *other* owner and an anonymous client both receive refusals (not data) when requesting a foreign zagroda's request details, at the HTTP layer | "RLS at the DB proves the API can't leak" — any service-role/admin client in a handler bypasses RLS | Which handlers/pages serve request details; where service-role clients are used; where the ownership check lives | integration (HTTP, two identities) | Re-testing the DB policy only; happy-path-only (owner sees own data) without the negative case |
| #5 | Cancellation with a wrong or missing token is refused; the server rejects past dates / zero participants / malformed email even when the client is bypassed; a documented decision exists on quota-draining endpoints | "Client-side zod means it's validated"; "nobody will guess a token" | Token issuance/verification shape; which validation actually runs server-side; which endpoints can trigger emails without auth | integration (HTTP, hostile inputs) | Mirroring the client schema as the server-test oracle; meaningless snapshot of the validation error body |
| #6 | An unverified email+password owner cannot publish (request-level), and an OAuth login with `email_verified=false` onto an existing email is refused — both at the HTTP/middleware layer | "The unit-tested guard function is wired everywhere it must be" | Where the publication gate and merge guard are enforced per route; middleware vs handler responsibility split | integration (HTTP, crafted identities) | Re-unit-testing guard logic that is already covered at the unit/db layer |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | HTTP-surface integration on the booking lifecycle | Prove the API/handler layer enforces what the DB layer already proves — concurrency outcome, ownership, tokens, server-side validation parity | #1, #4, #5, #6 | integration | not started | — |
| 2 | E2E critical flow on mobile viewport | One scripted phone-size browser run of the core promise (request → accept → overbooking block), wired to fail CI | #3 | e2e | not started | — |
| 3 | Email outbox reliability | Prove outbox failure modes (provider error, retry budget, no double-send, no-op config) and make a stuck outbox observable | #2 | integration + manual smoke criterion | not started | — |
| 4 | Quality gates + selective AI-native layer | Lock the floor: e2e gate in CI, typecheck gate, multimodal review of 1–3 owner mobile screens, post-edit hook recommendation | cross-cutting | gates, vision review, post-edit hook | not started | — |

## 4. Stack

The classic test base for this project. AI-native tools carry a `checked:`
date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest | 4.1.8 | node env, runs vs local Supabase stack; `fileParallelism: false` (shared DB); 12 db-integration + 4 unit files exist |
| DB harness | supabase CLI + pg | 2.23.4 / 8.21 | `npx supabase start` (Docker); global setup in `tests/helpers/` |
| API mocking | none yet — see §3 Phase 3 | — | provider (Brevo) HTTP edge needs a mock strategy for outbox failure modes |
| e2e | none yet — see §3 Phase 2 | — | Playwright is the default candidate (mobile viewport emulation, CI-friendly); phase 2 decides |
| accessibility | eslint-plugin-jsx-a11y | 6.10.2 | static lint only; no runtime a11y assertions planned (mobile usability handled selectively in §3 Phase 4) |
| (optional) AI-native | multimodal visual review — checked: 2026-06-12 | n/a | When NOT to use: any regression a deterministic assertion or diff can catch; static/marketing pages (§7). Reserved for the 1–3 owner mobile screens where "usable one-handed in portrait" (PRD guardrail) has no deterministic oracle |
| (optional) AI-native | post-edit hook (run related tests on edit) — checked: 2026-06-12 | n/a | When NOT to use: as a CI substitute. Recommended local only; configuration is owned by a later lesson, §3 Phase 4 only names it |

**Stack grounding tools (current session):**
- Docs: none — no Context7/docs MCP exposed in this session; stack facts grounded in local manifests (`package.json`, `vitest.config.ts`, CI workflow); checked: 2026-06-12
- Search: built-in web search available — not used for this write-up (no stale-tool question arose); checked: 2026-06-12
- Runtime/browser: none — no Playwright/browser MCP in session; e2e tooling decision deferred to §3 Phase 2 research; checked: 2026-06-12
- Provider/platform: GitHub via `gh` CLI — relevant for wiring the §5 CI gates in §3 Phase 4; Supabase via local CLI; checked: 2026-06-12

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint (type-checked ESLint) | local (husky/lint-staged) + CI | required (wired) | syntactic / type drift |
| typecheck (`astro check`) | CI | required after §3 Phase 4 | type errors `astro build` does not surface |
| unit + integration (vitest vs local Supabase) | CI | required (wired) | logic and DB-contract regressions |
| e2e on critical flow | CI on PR | required after §3 Phase 2 (wired into CI by §3 Phase 4) | broken critical user paths |
| post-edit hook | local (agent loop) | recommended after §3 Phase 4 | regressions at edit time |
| multimodal visual review (1–3 owner mobile screens) | CI on PR, selective | optional after §3 Phase 4 | one-handed-usability issues with no deterministic oracle |
| pre-prod smoke (email deliverability criterion) | manual, after deploy | optional after §3 Phase 3 | environment-specific email failures (quota, sender reputation) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- **Location**: `tests/unit/`.
- **Naming**: `<topic>.test.ts`.
- **Reference test**: `tests/unit/booking.test.ts`.
- **Run locally**: `npm test` (or `npx vitest run tests/unit`).

### 6.2 Adding a DB-integration test

- **Location**: `tests/db/`.
- **Mocking policy**: none — tests run against the local Supabase stack
  (`npx supabase start`); files share one database, so file-level
  parallelism stays off.
- **Reference test**: `tests/db/concurrency.test.ts` (the "exactly one
  succeeds" pattern).
- **Run locally**: `npx supabase start`, then `npm test`.

### 6.3 Adding an HTTP-surface (API handler) integration test

- TBD — see §3 Phase 1 (concurrent-acceptance-through-the-handler,
  foreign-owner refusal, hostile-input rejection patterns).

### 6.4 Adding an e2e test

- TBD — see §3 Phase 2 (mobile-viewport critical-flow pattern).

### 6.5 Adding an email/outbox failure-mode test

- TBD — see §3 Phase 3 (provider-edge mock, retry/no-double-send pattern).

### 6.6 Per-rollout-phase notes

(After each phase lands, `/10x-implement` appends a 2–3 line note here
capturing anything surprising the rollout phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI snapshot tests and static/marketing pages** — break constantly,
  catch nothing domain-relevant. Re-evaluate if a static page starts
  carrying domain logic (e.g. availability badges). (Source: interview Q5.)
- **Supabase Auth internals** — password hashing, session cookies, token
  refresh are vendor-owned. Test only our gating logic *around* them
  (publication gate, merge guard, route protection). Re-evaluate on a major
  `@supabase/ssr` version jump. (Source: interview Q5.)
- **High-impact × low-likelihood platform outages** (Supabase/Cloudflare/
  Brevo down) — belong to observability/alerting, not tests; the §3 Phase 3
  smoke criterion covers the email edge of this.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-12
- Stack versions last verified: 2026-06-12
- AI-native tool references last verified: 2026-06-12

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
