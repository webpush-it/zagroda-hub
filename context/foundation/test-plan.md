# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-14

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`, `tests/`.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (see §1
principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                      | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Owner double-books a day: two concurrent acceptances both succeed, or undo fails to free seats — angry teachers arrive at a full zagroda                                                                                     | High   | Medium     | PRD Success Criteria #1 + US-01; interview Q1; hot-spot dir `supabase/migrations/` (13 commits/30d — schema churn around the guard)                                              |
| 2   | Transactional email silently stops (provider error, quota exhaustion, outbox/cron bug) — teacher never learns of acceptance/withdrawal, owner never sees new requests; nobody notices for days                               | High   | Medium     | Interview Q3 (lowest-confidence area); hot-spot dir `src/lib/email/` (11 commits/30d); CLAUDE.md.scaffold accepted-risk note (Brevo 300/day cap, un-rate-limited smoke endpoint) |
| 3   | A critical mobile flow (teacher request → owner acceptance) breaks in UI/middleware/handler wiring and ships to prod while CI stays green — nothing above the DB layer is exercised                                          | High   | Medium     | Interview Q4; test-base profile (16 test files, all at DB/unit layer); hot-spot dir `src/pages/api/` (32 commits/30d)                                                            |
| 4   | Teacher contact data (email + phone) leaks to another owner or an anonymous user through an HTTP surface — privacy NFR broken (IDOR)                                                                                         | High   | Medium     | PRD NFR (contact visible only to that zagroda's owner); abuse lens: authorization/ownership; hot-spot dir `src/pages/api/` (32 commits/30d)                                      |
| 5   | Guest-input abuse: a forged or missing cancellation token cancels someone else's request; the server accepts what only the client validates; un-rate-limited endpoints drain the daily email quota and starve booking emails | Medium | Medium     | PRD FR-015 + US-02 acceptance criteria; abuse lens: untrusted input + resource abuse; CLAUDE.md.scaffold accepted-risk note                                                      |
| 6   | Auth-gating regression: an unverified owner publishes to the catalog (spam gate), or the OAuth merge guard regresses into an account-takeover path                                                                           | High   | Low        | PRD FR-006/FR-010/FR-018 + anti-takeover NFR; roadmap S-07; existing db+unit guard tests reduce likelihood                                                                       |

Likelihood note: interview Q2 surfaced no past incidents ("so far so
good"), so all likelihood ratings rest on churn and structure signal, not
on incident history.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                 | Must challenge                                                                                                              | Context `/10x-research` must ground                                                                                                        | Likely cheapest layer                                        | Anti-pattern to avoid                                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | Through the same HTTP surface the owner's phone hits: two parallel accepts on conflicting requests → exactly one succeeds and the loser sees the "X z Y zajęte" refusal; after undo, freed seats are immediately acceptable | "The RPC-level test already proves this" — the handler above it can miscall the RPC, swallow its error, or skip it entirely | How the accept/undo handlers invoke the atomic primitive; error translation to the user-facing message; auth/session shape on those routes | integration (HTTP handler vs local Supabase)                 | Re-testing the RPC and calling it handler coverage; lifting the expected message from handler code (oracle problem — take "X z Y zajęte" from PRD US-01) |
| #2   | A provider failure or quota error leaves the row claimable for retry, never double-sends, hard-fails after the attempt budget; null config is a logged no-op consuming no retries; a stuck outbox is observable             | "Final status 200 means the mail went out"; "the cron sweep runs, therefore it works"                                       | Outbox state machine (claim/lease/attempt budget); cron trigger shape on Workers; what is mockable at the Brevo HTTP edge                  | integration (outbox vs local Supabase, mocked provider edge) | Mocking outbox internals instead of the network edge; happy-path-only dispatch test                                                                      |
| #3   | A scripted phone-viewport browser walks teacher request → owner accept → overbooking block against a built app; CI fails when the flow breaks                                                                               | "DB tests green = product works"; "it works in `astro dev`, so the built Worker output is fine"                             | Real route/page entry points of the critical flow; owner auth/session bootstrapping in a browser context; seed-data strategy               | e2e (1–2 flows only)                                         | E2e-everything; asserting pixel details instead of flow outcomes                                                                                         |
| #4   | An authenticated _other_ owner and an anonymous client both receive refusals (not data) when requesting a foreign zagroda's request details, at the HTTP layer                                                              | "RLS at the DB proves the API can't leak" — any service-role/admin client in a handler bypasses RLS                         | Which handlers/pages serve request details; where service-role clients are used; where the ownership check lives                           | integration (HTTP, two identities)                           | Re-testing the DB policy only; happy-path-only (owner sees own data) without the negative case                                                           |
| #5   | Cancellation with a wrong or missing token is refused; the server rejects past dates / zero participants / malformed email even when the client is bypassed; a documented decision exists on quota-draining endpoints       | "Client-side zod means it's validated"; "nobody will guess a token"                                                         | Token issuance/verification shape; which validation actually runs server-side; which endpoints can trigger emails without auth             | integration (HTTP, hostile inputs)                           | Mirroring the client schema as the server-test oracle; meaningless snapshot of the validation error body                                                 |
| #6   | An unverified email+password owner cannot publish (request-level), and an OAuth login with `email_verified=false` onto an existing email is refused — both at the HTTP/middleware layer                                     | "The unit-tested guard function is wired everywhere it must be"                                                             | Where the publication gate and merge guard are enforced per route; middleware vs handler responsibility split                              | integration (HTTP, crafted identities)                       | Re-unit-testing guard logic that is already covered at the unit/db layer                                                                                 |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                        | Goal (one line)                                                                                                                               | Risks covered  | Test types                           | Status       | Change folder                                            |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------ | ------------ | -------------------------------------------------------- |
| 1   | HTTP-surface integration on the booking lifecycle | Prove the API/handler layer enforces what the DB layer already proves — concurrency outcome, ownership, tokens, server-side validation parity | #1, #4, #5, #6 | integration                          | complete     | context/archive/2026-06-12-testing-http-surface-booking/ |
| 2   | E2E critical flow on mobile viewport              | One scripted phone-size browser run of the core promise (request → accept → overbooking block), wired to fail CI                              | #3             | e2e                                  | complete     | context/archive/2026-06-14-testing-e2e-critical-flow-mobile/ |
| 3   | Email outbox reliability                          | Prove outbox failure modes (provider error, retry budget, no double-send, no-op config) and make a stuck outbox observable                    | #2             | integration + manual smoke criterion | complete     | context/archive/2026-06-13-testing-email-outbox-reliability/ |
| 4   | Multimodal review of owner mobile screens         | Selective vision-model review of 1–3 owner mobile screens for one-handed-portrait usability (PRD guardrail) where no deterministic oracle exists; record the already-shipped post-edit hook (`f72d8d7`) | cross-cutting (PRD mobile-usability guardrail) | vision review (MCP), post-edit hook (record) | change opened | context/changes/testing-multimodal-mobile-review/ |
| 5   | CI quality gates (e2e + typecheck)                | Wire the blocking e2e critical-flow gate (deferred from Phase 2) and the `astro check` typecheck gate as required CI jobs                      | cross-cutting (#3 — regression ships while CI stays green) | gates (CI YAML)                      | not started  | —                                                        |

> **Rollout-order note (2026-06-13):** Phase 3 (integration) was opened
> ahead of Phase 2 by decision. Phase 2 (e2e/Playwright) and Phase 4
> (hooks/MCP/multimodal) are **deferred, not skipped** — they fall outside
> the current lesson's scope (e2e + MCP = Module 3 Lesson 4; hooks = Lesson 3) and stay `not started` until those lessons. When resuming, route to the
> first `not started` row whose test types are in the active lesson's scope.
>
> **Phase 4 split (2026-06-14):** The original Phase 4 ("Quality gates +
> selective AI-native layer") bundled four deliverables across lessons. By
> decision it is split: the **post-edit hook** already shipped standalone
> (`f72d8d7`, local opt-in); the **multimodal mobile-screen review** (MCP =
> Module 3 Lesson 4) becomes Phase 4 and is now in active-lesson scope; the
> **e2e + typecheck CI gates** are carved out into a new deferred **Phase 5**
> (CI-YAML wiring, its own lesson). Phase 4 reaching `complete` no longer
> implies the CI gates are wired — that is Phase 5's job.

## 4. Stack

The classic test base for this project. AI-native tools carry a `checked:`
date so future readers can see which lines need re-verification.

| Layer                | Tool                                                             | Version                   | Notes                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration   | Vitest                                                           | 4.1.8                     | node env, runs vs local Supabase stack; `fileParallelism: false` (shared DB); 12 db-integration + 4 unit files exist                                                                                                                  |
| DB harness           | supabase CLI + pg                                                | 2.23.4 / 8.21             | `npx supabase start` (Docker); global setup in `tests/helpers/`                                                                                                                                                                       |
| API mocking          | selective fetch mock (`tests/helpers/brevo-mock.ts`)             | n/a — checked: 2026-06-13 | intercepts only `api.brevo.com`, delegates all else to real fetch; restore in `afterEach`. Never `vi.stubGlobal("fetch")` against the real supabase-js client (§6.5)                                                                  |
| e2e                  | none yet — see §3 Phase 2                                        | —                         | Playwright is the default candidate (mobile viewport emulation, CI-friendly); phase 2 decides                                                                                                                                         |
| accessibility        | eslint-plugin-jsx-a11y                                           | 6.10.2                    | static lint only; no runtime a11y assertions planned (mobile usability handled selectively in §3 Phase 4)                                                                                                                             |
| (optional) AI-native | multimodal visual review — checked: 2026-06-12                   | n/a                       | When NOT to use: any regression a deterministic assertion or diff can catch; static/marketing pages (§7). Reserved for the 1–3 owner mobile screens where "usable one-handed in portrait" (PRD guardrail) has no deterministic oracle |
| (optional) AI-native | post-edit hook (run related tests on edit) — checked: 2026-06-12 | n/a                       | When NOT to use: as a CI substitute. Recommended local only; configuration is owned by a later lesson, §3 Phase 4 only names it                                                                                                       |

**Stack grounding tools (current session):**

- Docs: none — no Context7/docs MCP exposed in this session; stack facts grounded in local manifests (`package.json`, `vitest.config.ts`, CI workflow); checked: 2026-06-12
- Search: built-in web search available — not used for this write-up (no stale-tool question arose); checked: 2026-06-12
- Runtime/browser: none — no Playwright/browser MCP in session; e2e tooling decision deferred to §3 Phase 2 research; checked: 2026-06-12
- Provider/platform: GitHub via `gh` CLI — relevant for wiring the §5 CI gates in §3 Phase 4; Supabase via local CLI; checked: 2026-06-12

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                                | Where                          | Required?                                               | Catches                                                        |
| --------------------------------------------------- | ------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------- |
| lint (type-checked ESLint)                          | local (husky/lint-staged) + CI | required (wired)                                        | syntactic / type drift                                         |
| typecheck (`astro check`)                           | CI                             | required after §3 Phase 4                               | type errors `astro build` does not surface                     |
| unit + integration (vitest vs local Supabase)       | CI                             | required (wired)                                        | logic and DB-contract regressions                              |
| e2e on critical flow                                | CI on PR                       | required after §3 Phase 2 (wired into CI by §3 Phase 4) | broken critical user paths                                     |
| post-edit hook                                      | local (agent loop)             | recommended after §3 Phase 4                            | regressions at edit time                                       |
| multimodal visual review (1–3 owner mobile screens) | CI on PR, selective            | optional after §3 Phase 4                               | one-handed-usability issues with no deterministic oracle       |
| pre-prod smoke (email deliverability criterion)     | manual, after deploy           | optional after §3 Phase 3                               | environment-specific email failures (quota, sender reputation) |

### Pre-prod smoke criterion (email deliverability)

The integration suite mocks the Brevo edge, so it can never catch an
environment failure: a corrupted runtime secret, an exhausted daily quota, or a
sender-reputation block. This manual check is the only artifact that exercises
the _real_ edge after a deploy. Run it once per deploy that touches
`src/lib/email/`, secrets, or the deploy path:

1. As a signed-in owner, `POST /api/dev/test-email` against the deployed
   environment.
2. Assert the JSON response is
   `{enqueued: true, id: "<uuid>", result: {claimed: 1, sent: 1, failed: 0}}`
   — note `DrainResult` is **nested under `result`**, with `enqueued`/`id` as
   its siblings (`src/pages/api/dev/test-email.ts`); the F-02 prod-smoke oracle
   is `enqueued: true` + `result.sent: 1`. Confirm the test message lands in the
   destination inbox.
3. **Verify the secret values were read correctly at runtime — not merely that
   `wrangler secret list` names them.** Per lessons.md "Set wrangler secrets
   from a newline-free source on Windows", a secret with a trailing `\n` is
   non-empty (so it passes null-guards and shows in the list) but corrupt.
4. **Triage**: if `enqueued: false`, suspect a corrupted
   `SUPABASE_SERVICE_ROLE_KEY` (the admin-client JWT is invalid → enqueue 401),
   not outbox logic. If a Brevo **401 "Key not found"**, suspect a corrupted
   `BREVO_API_KEY`. Re-set the secret from a newline-free source before
   touching application code.

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

- **Location**: `tests/api/`, one file per surface (auto-included by
  `vitest.config.ts` `include: ["tests/**/*.test.ts"]`).
- **Naming**: `<surface>.test.ts` (e.g. `booking-decision.test.ts`,
  `authz.test.ts`, `guest-input.test.ts`).
- **What this layer tests**: the handler + real middleware wiring above the
  DB — error translation, auth/RLS gates, soft-outcome mapping. It does NOT
  re-test RPC internals (those live in `tests/db/`).
- **Harness facts** (all in `tests/helpers/`):
  - Two vitest aliases unlock the Astro virtual modules:
    `"astro:middleware"` → `astro/virtual-modules/middleware.js` (real
    `defineMiddleware`) and `"astro:env/server"` →
    `./tests/helpers/astro-env.ts` (env stub; keep its 7-name schema in sync
    with `astro.config.mjs`).
  - `tests/helpers/api.ts` provides the cookie jar, `createApiContext`,
    `runRoute(handler, ctx)`, `signInOwnerHttp(jar, email, password)`, and
    `assertNoContactData(body, { guest_email, guest_phone })`.
  - **Auth is real**: `signInOwnerHttp` invokes the actual
    `POST /api/auth/signin` handler so `@supabase/ssr` writes genuine
    session cookies into the jar — no cookie forgery. It throws unless the
    redirect `Location` is `/dashboard`.
  - Env stub keeps `SUPABASE_SERVICE_ROLE_KEY` set (outbox rows observable)
    but `BREVO_API_KEY`/`EMAIL_FROM` unset (drain no-ops → zero network
    egress). A test that hangs on an external call is a harness regression.
- **The load-bearing rule**: compose `onRequest` — call
  `runRoute(handler, ctx)`, never the bare handler. API routes self-guard on
  `locals.user`; a direct handler call without the middleware tests an
  anonymous world and silently passes the wrong assertion.
- **Reference tests**: `tests/api/booking-decision.test.ts` (parallel-accept
  race + PRD-derived capacity-message oracle) and `tests/api/authz.test.ts`
  (two-identity negative: foreign authenticated owner → 404, anonymous →
  401).
- **Run locally**: `npx supabase start`, then `npm test` (or
  `npx vitest run tests/api`).

### 6.4 Adding an e2e test

- **Location**: `e2e/` at repo root (specs) + `e2e/helpers/` (seed). Kept
  separate from the vitest `tests/` tree on purpose; even colocated they never
  collide — vitest globs `tests/**/*.test.ts`, Playwright runs `*.spec.ts`.
- **Naming**: `<flow>.spec.ts` (e.g. `critical-flow.spec.ts`,
  `idor-contact-data.spec.ts`, `smoke.spec.ts`).
- **Serve target — the BUILT Worker, not `astro dev`.** Under the
  `@astrojs/cloudflare` adapter only `wrangler dev` (workerd, :8787) faithfully
  serves the artifact. `npm run build` is a **hard prerequisite**: the
  Playwright `webServer` runs `npx wrangler dev`, which serves whatever sits in
  `dist/` — a stale build silently tests old code. The `webServer` does NOT
  build; always go through `npm run test:e2e` (`build && playwright test`) or
  build first. (`playwright.config.ts`.)
- **Credential resolution + `.dev.vars`** (`e2e/global-setup.ts`): a
  default-exported `globalSetup` resolves the local stack from
  `npx supabase status -o json` (with a `SUPABASE_*` env fallback) and enforces
  the `isLocal()` + `ALLOW_REMOTE_TEST_DB` guard — same shape as
  `tests/helpers/global-setup.ts`, ported out of vitest's `inject()`. It then:
  - writes `.dev.vars` with `SUPABASE_URL` + `SUPABASE_KEY` (the **anon** key —
    the app's server env name is `SUPABASE_KEY`, NOT `SUPABASE_ANON_KEY`, per
    `astro.config.mjs`). `wrangler dev` reads runtime secrets from `.dev.vars`,
    not arbitrary process env. `BREVO_API_KEY` is left unset so the email drain
    no-ops (zero network egress); `SUPABASE_SERVICE_ROLE_KEY` is omitted — the
    Worker does not need it for these flows.
  - exports `E2E_SUPABASE_URL` + `E2E_SUPABASE_SERVICE_ROLE_KEY` into the
    test-process env (Playwright forks workers _after_ globalSetup, so they
    inherit it) for the seed helper.
  - `.dev.vars`, `test-results/`, `playwright-report/`, `.playwright/`,
    `blob-report/` are all gitignored.
- **Seeding** (`e2e/helpers/seed.ts`): a Node-context port of
  `tests/helpers/supabase.ts` — `createAdminClient()` builds a service-role
  client from the `E2E_*` env, then `createConfirmedOwner`
  (`admin.auth.admin.createUser({ email_confirm: true })`), `seedZagroda`
  (`published: true` service-role insert bypasses the publication trigger),
  `seedBookingRequest`, and `uniqueEmail(prefix)`. **Isolation is by unique
  data, not teardown** — unique owner email, unique future `trip_date`, unique
  guest emails per run; no truncation, no `seed.sql`. Specs re-run green without
  a DB reset. The clean baseline comes from `npm run db:reset`.
- **Auth = drive the real form, per test.** No `storageState` sharing — each
  test signs in fresh: navigate `/auth/signin`, `getByLabel("Email")` /
  `getByLabel("Password")`, `getByRole("button", { name: "Sign in" })`, then
  `await page.waitForURL("**/dashboard")`. Filling the form lets `@supabase/ssr`
  write genuine session cookies into the browser context (no forgery). For the
  anonymous case use a fresh context / `test.use({ storageState: undefined })`.
- **Locator policy**: `getByRole` / `getByLabel` / `getByText` only — there are
  **no `data-testid` attributes** in the flow. Disambiguate repeated rows (e.g.
  two booking requests) by their unique seeded guest names. Never CSS/XPath.
  **Never `page.waitForTimeout`** — wait on state (`toBeVisible`, `waitForURL`,
  `waitForResponse`).
- **Oracles come from the PRD, not handler code.** The overbooking refusal is a
  domain outcome (RPC `accepted=false`, status stays `pending`, surfaced as HTTP
  409 + red panel); assert the PRD-derived message
  "Limit dzienny przekroczony (1 z 1 zajęte, 1 wymaga miejsca)" (FR-014,
  `prd-v1.md:57,131`), matching the stable substring. The foreign-owner IDOR case
  is **404, not 403** — the cookie-scoped RLS pre-SELECT hides the row before any
  owner re-check ("Nie znaleziono zapytania"); the anonymous case redirects to
  `/auth/signin` via middleware.
- **Viewport**: single Pixel-5 Chromium project, `fullyParallel: false`
  (shared local DB, mirrors vitest's `fileParallelism: false`).
- **Reference tests**: `e2e/critical-flow.spec.ts` (request → accept →
  overbooking block) and `e2e/idor-contact-data.spec.ts` (foreign owner 404 +
  anonymous redirect); `e2e/smoke.spec.ts` proves the built Worker serves before
  any domain assertion.
- **Run locally**: `npm run db:start` (or `npm run db:reset` for a clean
  baseline), then `npm run test:e2e` (= `npm run build && playwright test`).
  Browser binaries: `npx playwright install chromium` once.

### 6.5 Adding an email/outbox failure-mode test

The drain loop (`drainDueEmails`, `src/lib/email/outbox.ts`) is non-atomic by
design: claim (write #1) and mark-sent/error (write #2) bracket the Brevo
network call with no enclosing transaction. Split the test by which failure you
are pinning:

- **Location split**:
  - **Integration** (`tests/db/`) — failure modes that depend on real DB
    state: provider failure leaves the row claimable, retry-budget exhaustion
    flips to terminal `failed`, an already-sent row is never re-claimed, null
    config is a logged no-op. These need the real `claim_due_emails` RPC, real
    lease/attempt writes, real cascades — a mock would lie about them. Reference:
    `tests/db/email-outbox-drain.test.ts`.
  - **Hermetic** (`tests/unit/`) — partial-failure branches real infra cannot
    trigger on command: mark-sent write fails after a Brevo 2xx (row stays
    `pending`), mark-error write itself fails (swallowed, no throw), claim RPC
    errors (logged no-op). Stub the admin client (`createMockAdmin`) so the
    second write returns `{ error }`. Reference: the extended
    `tests/unit/email.test.ts`.
- **Mock only the provider edge, never the client.** Use
  `installBrevoMock()` (`tests/helpers/brevo-mock.ts`) — it intercepts only
  `https://api.brevo.com/...` and delegates every other request to the real
  `globalThis.fetch`, so supabase-js keeps reaching the local DB. **Never
  `vi.stubGlobal("fetch")`** against the integration layer: the real
  supabase-js admin client uses `fetch` internally and a global stub breaks it.
  Always `restore()` in `afterEach` — `fileParallelism: false` shares one
  process, so a leaked stub silently breaks later files.
- **Inject a literal `EmailConfig`.** The env stub
  (`tests/helpers/astro-env.ts`) leaves `BREVO_API_KEY`/`EMAIL_FROM` unset so
  incidental drains no-op. To exercise the _real_ send branch, pass a literal
  `EmailConfig` into `drainDueEmails` — do not flip the env.
- **Wipe `email_outbox` in `beforeAll`.** `claim_due_emails` orders by
  `created_at`; stale expired-lease rows sort ahead of fresh fixtures
  (determinism trap — same as `tests/db/email-outbox.test.ts`).
- **Seed pre-claim `attempts`.** The attempts counter is bumped _by_ the claim.
  To test the at-cap terminal-`failed` path through the real claim, seed
  `attempts: 4` (the claim bumps it to 5 ≥ `MAX_ATTEMPTS`). Seeding `attempts: 5`
  makes the row un-claimable (SQL predicate is `attempts < 5`) and tests the
  wrong thing.
- **No-double-send goes through the real RPC.** To prove a sent row is never
  re-claimed, drain it (mock 2xx → `status='sent'`), then drain again and assert
  exactly one Brevo call fired. The guard is the `status='pending'` filter in
  `claim_due_emails`, _not_ the lease — don't mock around the RPC. The lease's
  own no-double-send guarantee (claimed-but-pending row unclaimable until the
  lease expires; concurrent claims disjoint) is already SQL-covered by
  `tests/db/email-outbox.test.ts` (b)/(c); don't re-prove it here.
- **Run locally**: `npx supabase start`, then `npm test` (or
  `npx vitest run tests/db/email-outbox-drain.test.ts tests/unit/email.test.ts`).

### 6.6 Per-rollout-phase notes

(After each phase lands, `/10x-implement` appends a 2–3 line note here
capturing anything surprising the rollout phase taught.)

- **Phase 1 — HTTP-surface integration (2026-06-13)**: The whole layer is
  unlocked by two vitest aliases — no Astro dev server, no cookie forgery.
  The non-obvious traps: middleware composition is mandatory (a bare handler
  call tests an anonymous world); the unverified-owner gate must sign in via
  HTTP _before_ SQL-clearing `email_confirmed_at` (GoTrue blocks unconfirmed
  signins); and the foreign owner gets **404, not 403** because the RLS
  pre-SELECT hides the row before the RPC's ownership re-check can fire.

- **Phase 3 — Email outbox reliability (2026-06-13)**: The integration seam
  runs the real claim→send→mark drain against local Supabase with **only the
  Brevo edge mocked** — a _selective_ fetch mock (`tests/helpers/brevo-mock.ts`),
  never a global stub, because the real supabase-js client uses `fetch`
  internally and a global stub breaks it. Non-obvious traps: the `attempts`
  counter is bumped _by the claim_, so a fixture must seed the **pre-claim**
  value (seed `4` to land at the `5`-attempt cap); null config is a logged no-op
  that consumes **zero** budget by design (the claim RPC is never called); and
  the env stub leaves the channel unconfigured, so the real send branch needs a
  **literal `EmailConfig`** injected, not an env flip. The two partial-failure
  branches (mark-sent-fails-after-2xx, mark-error-write-fails) are non-atomic by
  design and accepted — pinned hermetically in `tests/unit/email.test.ts`, not
  fixed.

- **Phase 2 — E2E critical flow on mobile viewport (2026-06-14)**: The harness
  serves the **built** Worker via `wrangler dev` (:8787), never `astro dev` —
  under the `@astrojs/cloudflare` adapter only the built artifact is faithful,
  so `npm run build` is a hard prerequisite (the `webServer` doesn't build).
  Non-obvious traps: `wrangler dev` reads secrets from `.dev.vars`, and the
  app's anon-key env name is **`SUPABASE_KEY`**, not `SUPABASE_ANON_KEY`; the
  service-role key belongs in the _test-process_ env (in-process seeding), not
  `.dev.vars`; the overbooking message oracle is the **PRD**, not handler code;
  the foreign-owner IDOR is **404, not 403** (RLS pre-SELECT). The blocking CI
  gate is **deferred to §3 Phase 4** (per §5) — this change landed config +
  specs + a documented run command only, no CI job. Stale-doc finding:
  `tech-stack.md:8` claims `deployment_target: vercel`, but reality is
  Cloudflare Workers — flagged as a `/10x-lesson` candidate, not fixed here.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI snapshot tests and static/marketing pages** — break constantly,
  catch nothing domain-relevant. Re-evaluate if a static page starts
  carrying domain logic (e.g. availability badges). (Source: interview Q5.)
- **Supabase Auth internals** — password hashing, session cookies, token
  refresh are vendor-owned. Test only our gating logic _around_ them
  (publication gate, merge guard, route protection). Re-evaluate on a major
  `@supabase/ssr` version jump. (Source: interview Q5.)
- **High-impact × low-likelihood platform outages** (Supabase/Cloudflare/
  Brevo down) — belong to observability/alerting, not tests; the §3 Phase 3
  smoke criterion covers the email edge of this.
- **OAuth merge-guard HTTP wiring** (risk #6, account-takeover path) — the
  guard logic and its RPC are covered at the unit/db layers; the
  `src/pages/api/auth/callback.ts` HTTP path is deliberately left untested.
  A full OAuth code-exchange simulation against local GoTrue is
  high-cost/low-marginal-signal. (Decision: 2026-06-13, §3 Phase 1.)
  Re-evaluate if the callback flow changes shape.
- **Quota-drain on `POST /api/booking-request`** (risk #5, resource abuse) —
  the un-rate-limited create endpoint can drain the daily email quota. This
  is **accepted for MVP traffic**; the remediation path is Cloudflare-level
  rate limiting (WAF rules), not application code. (Decision: 2026-06-13,
  §3 Phase 1.) Re-evaluate once real traffic exists.
- **IDOR on `/dashboard/zapytania/[id].astro`** (the contact-data SSR page,
  risk #4) is **not dropped — it is delegated to §3 Phase 2 e2e**. Phase 1
  covers the API-route side of risk #4 (`tests/api/authz.test.ts`); the
  SSR-page render is out of the HTTP-handler harness's reach (Astro
  Container API was evaluated and rejected) and belongs in the browser-level
  phase.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-12
- Stack versions last verified: 2026-06-12
- AI-native tool references last verified: 2026-06-12

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
