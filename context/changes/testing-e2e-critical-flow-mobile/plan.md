# E2E Critical Flow on Mobile Viewport Implementation Plan

## Overview

Stand up the project's first browser-level (e2e) test harness with Playwright and use it to drive the built Cloudflare Worker through the core promise of the product on a phone-sized viewport: **teacher request → owner accept → overbooking block**. The same harness also exercises the **IDOR contact-data SSR page** (`/dashboard/zapytania/[id].astro`) that test-plan §7 explicitly delegated to this phase.

This is test-plan §3 **Phase 2**, covering **Risk #3** (a critical mobile flow breaks in UI/middleware/handler wiring while CI stays green) and the SSR-render half of **Risk #4** (teacher contact-data IDOR). The blocking CI gate is deliberately deferred to test-plan Phase 4 per the decision below; this phase lands config + specs + a documented run command and a CI job is **not** added here.

## Execution Routing (which skill drives which phase)

These plan phases are driven by two different skills. `/10x-e2e` assumes Playwright is already installed and the app runnable — it **halts and redirects to setup if Playwright is absent** (`research.md` Open Question #2). So the harness bootstrap is `/10x-implement`'s job; only once Playwright exists do the browser specs route to `/10x-e2e`, which shares this same `plan.md` and Progress and adds the e2e-specific loop (generate → review against the five anti-patterns → re-prompt → verify against the running app).

| Phase | Driver | Why |
| --- | --- | --- |
| 1 — Harness + serve/env + smoke | `/10x-implement` | Bootstraps Playwright/config/seed helper; `/10x-e2e` can't run with Playwright absent |
| 2 — Critical-flow spec | **`/10x-e2e`** | Real browser spec against the running built Worker; needs the e2e review/verify loop |
| 3 — IDOR contact-data spec | **`/10x-e2e`** | Same — browser-level SSR render the HTTP-handler harness couldn't reach |
| 4 — Cookbook docs + handoff | `/10x-implement` (or manual) | Documentation only; no browser involved |

## Current State Analysis

- **No browser-test layer exists.** `@playwright/test` is not installed; there is no `playwright.config.*`, no `e2e/`/`tests/e2e/` dir. The 16 existing test files are all vitest at the DB/unit/API layer (`tests/db/`, `tests/unit/`, `tests/api/`), run via `npm test` against a local Supabase stack. `/10x-e2e` cannot bootstrap this — it halts when Playwright is absent.
- **The deploy/serve target is Cloudflare Workers, not Vercel.** `astro.config.mjs:7,16` uses `@astrojs/cloudflare` with `output:"server"`; root `wrangler.jsonc` sets `main:"./src/worker.ts"`; `package.json` `deploy` = `build && db:push && wrangler deploy`. There is **no `vercel.json` and no `@astrojs/vercel` dependency**. `tech-stack.md:8`'s `deployment_target: vercel` is stale documentation drift. The faithful way to serve the built artifact for a browser is `npm run build` then `npx wrangler dev` (workerd, port 8787) — `astro dev`/`astro preview` are not faithful under the Cloudflare adapter.
- **No `data-testid` attributes anywhere in the flow.** Every assertion must use role/label/visible-text. The UI strings are stable Polish literals and the capacity-refusal message has a PRD oracle, so text/role locators are reliable.
- **Server env is declared as secrets** in `astro.config.mjs:17-26` (`SUPABASE_URL`, `SUPABASE_KEY` anon, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, all `context:"server", access:"secret", optional:true`). Under `wrangler dev` these come from `.dev.vars` / bindings, not arbitrary process env.
- **Credential resolution already has a canonical pattern**: `tests/helpers/global-setup.ts:25-49` resolves the local stack from `supabase status -o json` (API_URL / ANON_KEY / SERVICE_ROLE_KEY / DB_URL), with a `fromEnv()` fallback and a local-only guard (`ALLOW_REMOTE_TEST_DB`).
- **Seeding helpers exist but are vitest-coupled**: `tests/helpers/supabase.ts` reads creds via vitest's `inject()`, which is unavailable in a Playwright/Node context. The seed *shapes* (`createOwnerClient` via `admin.auth.admin.createUser({ email_confirm:true })`, `seedZagroda({ published:true })`, `seedBookingRequest`, `uniqueEmail`) are the proven template to mirror.
- **Owner browser auth = drive the real form.** `signInOwnerHttp` (`tests/helpers/api.ts:87-97`) is an in-process HTTP-handler harness with a bespoke CookieJar — not reusable in a browser. Filling `/auth/signin` lets `@supabase/ssr` write genuine session cookies into the browser context.

### Key Discoveries (from research, verified against code)

- **Critical-flow route/UI oracles** (`research.md` §Scenario 1–3):
  - Guest request: public `/zagrody/{uuid}` (`src/pages/zagrody/[id].astro`), form island `BookingRequestForm.tsx`. Fields by label: "Turnus", "Data pobytu", "Liczba uczestników", "Imię i nazwisko", "E-mail", "Telefon". Submit button "Wyślij zapytanie". Success swaps in-place to green panel "Zapytanie wysłane — sprawdź e-mail, znajdziesz tam link do anulowania." (`BookingRequestForm.tsx:109-115`).
  - Owner accept: list `/dashboard/zapytania` (tabs "Oczekujące/…", rows `a[href="/dashboard/zapytania/{id}"]`); detail `/dashboard/zapytania/{uuid}` renders `RequestDecision.tsx`. Accept button "Akceptuj" → green panel "Zaakceptowano — nauczyciel dostanie e-mail" (`RequestDecision.tsx:81-86`).
  - Overbooking block: a **domain outcome** (RPC returns `accepted=false`, status stays `pending`), surfaced as HTTP 409 and a red `blocked` panel rendering the server message verbatim (`RequestDecision.tsx:99-104`). **Oracle is the PRD, not handler code** (`prd.md:57,131`, FR-014): `Limit dzienny przekroczony ({occupied} z {daily_limit} zajęte, {requested} wymaga miejsca)`. With `daily_limit:1` + two `participants:1` requests → "Limit dzienny przekroczony (1 z 1 zajęte, 1 wymaga miejsca)".
- **Overbooking seed recipe** (`research.md` §Seed-data strategy): confirmed owner → `seedZagroda({ dailyLimit:1, published:true })` (service-role insert bypasses the publication trigger) → two `booking_requests`, same `trip_date`, `participants:1`, `status:'pending'`, unique guest emails. Capacity = `zagrody.daily_limit` (per-day, summed across turnusy), enforced by SECURITY DEFINER RPC `accept_booking_request`.
- **IDOR authorization is two-layer, no app-level owner check** (`research.md` §Scenario 5): middleware (`src/middleware.ts:18-21`) sends anonymous `/dashboard/*` → **302 `/auth/signin`**; the cookie-scoped RLS read (`[id].astro:30-39`) returns `null` for a foreign owner → `Astro.response.status=404` + "Nie znaleziono zapytania" panel, contact section absent. No service-role client on that page → no RLS bypass. The foreign owner gets **404, not 403** (RLS pre-SELECT hides the row).
- **Sign-in form** (`research.md` §Owner auth): `/auth/signin` → `SignInForm.tsx`, native `<form method="POST" action="/api/auth/signin">`. Locators: `getByLabel("Email")`, `getByLabel("Password")`, `getByRole("button", { name: "Sign in" })`. Success → redirect `/dashboard`.
- **`BREVO_API_KEY` unset → email drain is a logged no-op** (zero network egress) — the correct default for e2e (`research.md` §Build/serve, Historical Context).
- **Isolation is by unique data, not teardown** (`research.md` §Seed-data strategy): existing suites do not truncate domain tables; `fileParallelism:false`; clean baseline comes from `supabase db reset`. The e2e follows the same convention.

## Desired End State

Running `npm run build` then `npx playwright test` (with the local Supabase stack up) launches `wrangler dev` against the built Worker, runs on a Pixel-5 viewport, and:

1. **Critical flow passes**: a scripted phone browser submits a guest booking request, signs in as the owner, accepts the first request (sees the success panel), and is blocked on the second with the exact PRD capacity message.
2. **IDOR is enforced**: a foreign authenticated owner gets the 404 "Nie znaleziono zapytania" page with no contact data; an anonymous visitor is redirected to `/auth/signin`.
3. **The harness is reproducible and self-contained**: credentials resolve automatically from `supabase status -o json`, `.dev.vars` is generated (and gitignored), and a smoke spec proves the built Worker serves before any domain assertion runs.
4. **The test-plan stays a living document**: §6.4 cookbook is filled, and the deferred CI-gate boundary is recorded.

Verification: `npx playwright test` is green locally against a freshly reset DB; `git status` shows `.dev.vars` and `test-results/` ignored; test-plan §6.4 no longer reads "TBD".

## What We're NOT Doing

- **No blocking CI job in this change.** Wiring the e2e gate into CI (Supabase + build + `wrangler dev` + `playwright install` + run, as a required check) is formally test-plan §3 **Phase 4**. This phase lands config, specs, and a documented local run command only. (Decision below.)
- **No second device/browser.** Single Pixel-5 Chromium project. No WebKit/iPhone project (PRD names it, but the layout is a single `max-w-md` column; cross-device delta is low and the e2e-everything anti-pattern is explicitly named in test-plan §1).
- **No undo→re-accept release sequence in the browser.** Capacity release is already proven at the DB layer (`tests/db/withdraw.test.ts`) and API layer; the browser proves the *block*, not the release.
- **No `data-testid` additions.** All assertion targets resolve via role/label/text today; we keep accessible-name locators and disambiguate multiple rows by unique seeded guest names.
- **No teardown of domain tables.** Isolation is by unique data, matching the existing suites. No `seed.sql`, no truncation.
- **No fix to `tech-stack.md`.** We flag the stale Vercel claim as a `/10x-lesson` candidate (Phase 4) but do not edit foundation docs here.
- **No re-test of RPC internals or RLS policies.** Those live in `tests/db/`. The browser asserts flow *outcomes*, not the atomic primitive.

## Implementation Approach

Build the harness bottom-up so the riskiest, most novel piece — serving the *built Worker* with live local-Supabase env — is proven in isolation (Phase 1 smoke spec) before any domain flow depends on it. The harness has two env consumers: the `wrangler dev` child (needs `SUPABASE_URL` + `SUPABASE_KEY` anon, fed via generated `.dev.vars`) and the Playwright Node test process (needs `SUPABASE_URL` + service-role key for seeding, resolved in-process). A single global-setup resolves both from `supabase status -o json` (mirroring `tests/helpers/global-setup.ts`), writes `.dev.vars`, and exposes creds to the seeding helper via env. Playwright's `webServer` then auto-launches `wrangler dev`, waits for readiness, and tears it down.

Specs use per-test fresh sign-in and per-test unique seed data (unique owner email, unique `trip_date` arena, unique guest emails) so each test is standalone and re-runnable, honoring CLAUDE.md's test-independence rule. The seeding helper is a Playwright-context port of `tests/helpers/supabase.ts` — same shapes, creds from env instead of vitest `inject()`.

## Critical Implementation Details

- **Build is a hard prerequisite of the serve step.** `webServer` runs `npx wrangler dev`, which serves whatever is in `dist/` — a stale build silently tests old code. The documented run command and Phase 1 success criteria must `npm run build` first; do not let `wrangler dev` run against a missing/old `dist/`.
- **`wrangler dev` reads runtime secrets from `.dev.vars`, not arbitrary process env.** Under the `@astrojs/cloudflare` adapter the server env declared `access:"secret"` arrives as Worker bindings. The global-setup must write `SUPABASE_URL` and `SUPABASE_KEY` (the anon key — note the app's env name is `SUPABASE_KEY`, per `astro.config.mjs`, not `SUPABASE_ANON_KEY`) into `.dev.vars` before `wrangler dev` starts. Leave `BREVO_API_KEY`/`EMAIL_FROM` unset so the email drain no-ops (zero network egress). `SUPABASE_SERVICE_ROLE_KEY` is **not** needed by the Worker for these flows — omit it from `.dev.vars`.
- **Seeding runs in the Node test process, not the Worker.** The seed helper builds its own service-role `@supabase/supabase-js` client from env the global-setup exported — it never goes through `wrangler dev`. This is why service-role belongs in the test-process env, not `.dev.vars`.
- **Foreign owner = 404, not 403.** The IDOR assertion must expect "Nie znaleziono zapytania" (404), because the RLS pre-SELECT hides the row before any owner re-check — confirmed in `tests/api/authz.test.ts` and Phase 1's cookbook note.
- **Local-only guard.** The seed path issues admin writes; reuse the `isLocal()` / `ALLOW_REMOTE_TEST_DB` guard so the e2e can never run its seeding against a remote stack.

---

## Phase 1: Playwright harness + serve/env scaffolding

> **Driver: `/10x-implement`** (bootstrap — `/10x-e2e` cannot run until Playwright exists).

### Overview

Install Playwright, create the config (Pixel-5 project + auto-launched `wrangler dev` webServer), a global-setup that resolves credentials and writes `.dev.vars`, a Node-context seeding helper, gitignore updates, and a smoke spec that proves the built Worker serves with live env. No domain-flow assertions yet.

### Changes Required:

#### 1. Playwright dependency

**File**: `package.json`

**Intent**: Add `@playwright/test` as a devDependency so the harness exists; do not yet add a CI job. Optionally add a convenience script (e.g. `test:e2e`) that documents the build+test sequence.

**Contract**: `devDependencies["@playwright/test"]` present; lockfile updated via `npm install`. Any new script must make the `npm run build` prerequisite explicit (e.g. `"test:e2e": "npm run build && playwright test"`). Browser binaries installed locally via `npx playwright install chromium`.

#### 2. Playwright config

**File**: `playwright.config.ts` (repo root)

**Intent**: Define a single Pixel-5 mobile project pointed at `http://127.0.0.1:8787`, auto-launch the built Worker via `webServer`, and run the global-setup that prepares credentials/`.dev.vars` before the server starts.

**Contract**: `defineConfig` with: `testDir` (e2e dir, see #5); `use.baseURL = "http://127.0.0.1:8787"`; one `projects` entry using `devices["Pixel 5"]`; `globalSetup` pointing at the setup module (#3); `webServer = { command: "npx wrangler dev", url: "http://127.0.0.1:8787", reuseExistingServer: !process.env.CI, timeout: <generous, build excluded> }`. `fullyParallel:false` (shared DB, mirrors `fileParallelism:false`). The `webServer` does not build — build is the documented prerequisite. Confirm `wrangler dev`'s ready URL matches `webServer.url` (research verified port 8787).

#### 3. e2e global-setup (credentials + `.dev.vars`)

**File**: `e2e/global-setup.ts` (or `tests/e2e/global-setup.ts` per #5 decision)

**Intent**: Resolve the local Supabase stack once, write `.dev.vars` for `wrangler dev`, and export service-role creds into the test-process env for the seeding helper. Port the proven resolution + local-only guard from `tests/helpers/global-setup.ts` into a non-vitest (plain async function) form.

**Contract**: Default-exported `async function globalSetup()`. Resolves `{ url, anonKey, serviceRoleKey }` from `supabase status -o json` (reuse the JSON-slice parsing in `global-setup.ts:32-41`), with `fromEnv()` fallback. Enforce the `isLocal()` + `ALLOW_REMOTE_TEST_DB` guard. Write `.dev.vars` containing `SUPABASE_URL=<url>` and `SUPABASE_KEY=<anonKey>` (app env name is `SUPABASE_KEY`). Set `process.env.E2E_SUPABASE_URL` / `E2E_SUPABASE_SERVICE_ROLE_KEY` (or reuse `SUPABASE_*` names) for the seed helper. Throw the same descriptive error as the existing setup if creds can't be resolved.

#### 4. Node-context seeding helper

**File**: `e2e/helpers/seed.ts`

**Intent**: A Playwright-usable port of `tests/helpers/supabase.ts` seed shapes — create a confirmed owner, seed a published zagroda with turnusy, seed booking requests, unique-email generator — building its service-role client from env (not vitest `inject()`).

**Contract**: Exports `createAdminClient()`, `createConfirmedOwner(email, password)` (wraps `admin.auth.admin.createUser({ email_confirm:true })`), `seedZagroda(admin, { ownerId, dailyLimit, published, turnusCount })`, `seedBookingRequest(admin, { zagrodaId, turnusId, tripDate, participants, status, guestName, guestEmail, guestPhone })`, and `uniqueEmail(prefix)` — same signatures/defaults as `tests/helpers/supabase.ts:120-208`, reading creds from the env set in #3. No DB teardown.

#### 5. e2e directory + gitignore

**Files**: `e2e/` (new dir; specs land here in Phases 2–3), `.gitignore`

**Intent**: Establish the e2e home and stop generated artifacts from being committed.

**Contract**: Append to `.gitignore`: `.dev.vars`, `test-results/`, `playwright-report/`, `.playwright/` (and `/blob-report/` if used). Directory layout decision: `e2e/` at repo root with `e2e/helpers/` — keeps browser specs visibly separate from the vitest `tests/` tree (which `vitest.config.ts` globs as `tests/**/*.test.ts`; Playwright specs use `*.spec.ts` so the two runners never collide even if colocated, but a separate dir is clearer).

#### 6. Smoke spec

**File**: `e2e/smoke.spec.ts`

**Intent**: Prove the built Worker serves under `wrangler dev` with live env, independent of any domain flow — the de-risking checkpoint for the whole harness.

**Contract**: One test on the Pixel-5 project that navigates to a public, env-dependent page (e.g. `/katalog` or `/`) and asserts a stable visible element renders (role/text), confirming SSR + Supabase env reached the Worker. No seeding required.

### Success Criteria:

#### Automated Verification:

- Playwright installed and discoverable: `npx playwright --version`
- Chromium browser available: `npx playwright install chromium` exits 0
- Lint passes on new TS: `npm run lint`
- With local Supabase up and a fresh build, the smoke spec passes: `npm run build && npx playwright test e2e/smoke.spec.ts`
- `.dev.vars`, `test-results/`, `playwright-report/` are git-ignored: `git status --porcelain` shows none of them as untracked

#### Manual Verification:

- `wrangler dev` is launched and torn down by the run (no orphaned process on :8787 afterward)
- `.dev.vars` is generated with the correct local `SUPABASE_URL`/`SUPABASE_KEY` and is NOT committed
- The smoke page renders real catalog content (proving Supabase env reached the built Worker, not a blank/500)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the harness serves the built Worker correctly before building domain specs on top of it.

---

## Phase 2: Critical-flow spec (request → accept → overbooking block)

> **Driver: `/10x-e2e`** (requires Phase 1's Playwright harness to be in place first).

### Overview

The core promise, end-to-end on a phone viewport: a guest submits a booking request through the public form, the owner signs in and accepts the first request, and the second request is blocked with the exact PRD capacity message. Per-test seeding and fresh sign-in.

### Changes Required:

#### 1. Critical-flow spec

**File**: `e2e/critical-flow.spec.ts`

**Intent**: Script the full request→accept→block sequence with role/label/text locators, seeding the overbooking arena per-test and signing the owner in via the real form.

**Contract**: One test (or a small describe) that:
1. **Seeds** (via `e2e/helpers/seed.ts`): a confirmed owner (`uniqueEmail`), a published zagroda `dailyLimit:1` with ≥1 turnus, and a unique future `trip_date`. (The guest's *own* request is created through the UI in step 2; a *second* pending request on the same date+turnus, `participants:1`, unique guest email, is seeded directly so the arena is full after one accept.)
2. **Guest request (UI)**: navigate to `/zagrody/{zagrodaId}`, fill the form by label ("Turnus" select, "Data pobytu", "Liczba uczestników"=1, "Imię i nazwisko", "E-mail", "Telefon" with a valid PL number), click "Wyślij zapytanie", assert the green success panel "Zapytanie wysłane — sprawdź e-mail…" appears in-place (no navigation).
3. **Owner sign-in**: navigate `/auth/signin`, `getByLabel("Email")`/`getByLabel("Password")`, click `getByRole("button",{name:"Sign in"})`, `await page.waitForURL("**/dashboard")`.
4. **Accept #1**: go to `/dashboard/zapytania`, open the seeded (or the UI-created) request by its unique guest name, click "Akceptuj", assert green panel "Zaakceptowano — nauczyciel dostanie e-mail" and `accepted` status.
5. **Block #2**: open the other pending request, click "Akceptuj", assert the red blocked panel contains the PRD-derived message — match on the stable substring "Limit dzienny przekroczony" + "zajęte" (full oracle: "Limit dzienny przekroczony (1 z 1 zajęte, 1 wymaga miejsca)"), and that the request stays `pending`.

Locator policy: `getByRole`/`getByLabel`/`getByText` only; disambiguate the two requests by unique seeded/entered guest names. No `page.waitForTimeout` — wait on `toBeVisible`/`waitForURL`. Unique `trip_date` + emails per run for re-runnability.

### Success Criteria:

#### Automated Verification:

- Critical-flow spec passes against a fresh build: `npm run build && npx playwright test e2e/critical-flow.spec.ts`
- Spec re-runs green without a DB reset (proves unique-data isolation): run it twice in a row
- Lint passes: `npm run lint`

#### Manual Verification:

- The block panel shows the exact capacity numbers "(1 z 1 zajęte, 1 wymaga miejsca)" — confirming the PRD oracle, not an eyeballed/handler string
- The flow is legible on the Pixel-5 viewport (form, list, decision panel usable one-handed)
- No email egress occurs (Brevo unset → drain no-op); the run does not hang on a network call

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before adding the IDOR spec.

---

## Phase 3: IDOR contact-data SSR page spec

> **Driver: `/10x-e2e`** (requires Phase 1's Playwright harness to be in place first).

### Overview

Prove the delegated Risk #4 SSR-render: a foreign authenticated owner cannot see another owner's teacher contact data, and an anonymous visitor is redirected to sign-in.

### Changes Required:

#### 1. IDOR spec

**File**: `e2e/idor-contact-data.spec.ts`

**Intent**: Assert the two negative authorization outcomes on `/dashboard/zapytania/{id}` against the rendered SSR page — the layer the Phase 1 HTTP-handler harness could not reach.

**Contract**: 
1. **Foreign owner → 404**: seed owner A + published zagroda + one booking request (unique guest name/email/phone). Seed owner B (`uniqueEmail`), sign B in via the form, navigate to `/dashboard/zapytania/{A's requestId}`. Assert text "Nie znaleziono zapytania" is visible and the contact section is absent — no `mailto:`/`tel:` links for A's guest email/phone (assert by `getByRole("link")` / text absence of the seeded unique email + phone).
2. **Anonymous → redirect**: in a fresh unauthenticated context, navigate to `/dashboard/zapytania/{A's requestId}` and assert redirect to `/auth/signin` (`await page.waitForURL("**/auth/signin**")`), with no contact data rendered.

Use a fresh browser context (or `test.use({ storageState: undefined })`) for the anonymous case so it carries no cookies.

### Success Criteria:

#### Automated Verification:

- IDOR spec passes against a fresh build: `npm run build && npx playwright test e2e/idor-contact-data.spec.ts`
- Full e2e suite passes together: `npm run build && npx playwright test`
- Lint passes: `npm run lint`

#### Manual Verification:

- The foreign-owner page shows "Nie znaleziono zapytania" (404) and the seeded guest's email/phone appear nowhere in the DOM
- The anonymous navigation lands on `/auth/signin` with no flash of contact data

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before the docs/handoff phase.

---

## Phase 4: Cookbook docs + handoff

> **Driver: `/10x-implement`** (or manual) — documentation only, no browser.

### Overview

Make the test-plan a living document for the new layer and record the deferred-CI boundary and the stale-doc finding.

### Changes Required:

#### 1. Fill the e2e cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace §6.4's "TBD" with the concrete pattern this phase established, and append a §6.6 per-phase note capturing the non-obvious traps (built-Worker serve target, `.dev.vars` env name `SUPABASE_KEY`, foreign-owner 404).

**Contract**: §6.4 documents: location (`e2e/`), naming (`*.spec.ts`), serve target (`npm run build` → Playwright `webServer` runs `npx wrangler dev` on :8787), credential resolution (`supabase status -o json` → generated `.dev.vars`), seeding (Node-context `e2e/helpers/seed.ts`, unique-data isolation, no teardown), auth (per-test fresh sign-in via the real form), locator policy (role/label/text, no `data-testid`), and the run command. §6.6 gets a 2–3 line Phase 2 note. Do not alter §1–§5 strategy.

#### 2. Record the deferred CI gate

**File**: `context/foundation/test-plan.md` (§3 / §5 are already consistent — verify only)

**Intent**: Confirm §3 Phase 2 status and §5's "e2e gate … wired into CI by §3 Phase 4" line still read correctly given this change landed specs but no CI job; update Phase 2 status if the orchestrator convention calls for it.

**Contract**: §3 Phase 2 Status reflects "specs landed, CI gate deferred to Phase 4"; no new CI job in `.github/workflows/ci.yml`. (Leave the actual status-string update to the test-plan orchestrator's convention; this plan only ensures the docs are not contradicted.)

#### 3. Flag stale tech-stack.md + close the change

**Files**: `context/changes/testing-e2e-critical-flow-mobile/change.md`; (recommend, do not require) a `/10x-lesson` entry

**Intent**: Record that `tech-stack.md:8` claims Vercel while reality is Cloudflare Workers, as a `/10x-lesson` candidate, and stamp the change as planned/implemented.

**Contract**: `change.md` `status` and `updated` advanced per workflow; a note in `## Notes` pointing at the stale `tech-stack.md` Vercel claim with the `/10x-lesson` suggestion. No edit to `tech-stack.md` itself in this change.

### Success Criteria:

#### Automated Verification:

- test-plan §6.4 no longer contains "TBD": `grep -n "TBD" context/foundation/test-plan.md` shows §6.4 resolved
- Markdown lints/formats clean: `npx prettier --check context/foundation/test-plan.md`

#### Manual Verification:

- A new contributor can follow §6.4 to add an e2e test without reading this plan
- The deferred-CI decision and the stale-doc finding are discoverable from the change folder

---

## Testing Strategy

This change *is* tests; the "tests" are the specs themselves. Verification is therefore meta:

### Spec-level (the deliverables)

- **Smoke** (Phase 1): built Worker serves with live env.
- **Critical flow** (Phase 2): request → accept → overbooking block, with the PRD capacity oracle.
- **IDOR** (Phase 3): foreign owner 404 (no contact data), anonymous redirect.

### Harness self-checks

- Re-run each spec twice without a DB reset to confirm unique-data isolation.
- Confirm `wrangler dev` is the serve target (not `astro dev`) by verifying the run reads `.dev.vars` and serves on :8787.
- Confirm no network egress (Brevo unset) — a hung run signals a harness/env regression.

### Manual Testing Steps

1. `npm run db:start` (or `npm run db:reset` for a clean baseline).
2. `npm run build`.
3. `npx playwright test` — all specs green.
4. Inspect the block-panel screenshot/trace: capacity numbers match "(1 z 1 zajęte, 1 wymaga miejsca)".
5. Confirm `.dev.vars` exists locally and is untracked; no orphan `wrangler dev` process remains.

## Performance Considerations

- Each test pays one form sign-in (~1–2s) by design (per-test independence chosen over shared `storageState`). With a single Pixel-5 project and `fullyParallel:false`, total wall-clock for ~3 specs is small.
- Build + browser install dominate any future CI job (Phase 4 concern, out of scope here): cache the Playwright browser download and the `dist/` build there.

## Migration Notes

None — additive. No schema changes, no `seed.sql`, no edits to existing tests or the app. New files only, plus a `.gitignore` and test-plan doc update.

## References

- Research: `context/changes/testing-e2e-critical-flow-mobile/research.md`
- Test plan: `context/foundation/test-plan.md` §2 Risk #3/#4, §3 Phase 2, §6.4 (this phase fills it), §7 (IDOR delegation)
- Seed shapes to mirror: `tests/helpers/supabase.ts:120-208`
- Credential-resolution pattern: `tests/helpers/global-setup.ts:25-94`
- Capacity-message oracle: `context/foundation/prd.md:57,131` (FR-014)
- Serve target evidence: `astro.config.mjs:7,16-26`, `wrangler.jsonc`, `package.json` (`deploy`), `.github/workflows/ci.yml`
- Prior sibling phase: `context/archive/2026-06-12-testing-http-surface-booking/` (foreign owner 404, real-cookie auth)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Playwright harness + serve/env scaffolding

#### Automated

- [x] 1.1 Playwright installed and discoverable (`npx playwright --version`) — 5333b77
- [x] 1.2 Chromium browser installs cleanly (`npx playwright install chromium`) — 5333b77
- [x] 1.3 Lint passes on new TS (`npm run lint`) — 5333b77
- [x] 1.4 Smoke spec passes against a fresh build (`npm run build && npx playwright test e2e/smoke.spec.ts`) — 5333b77
- [x] 1.5 `.dev.vars`, `test-results/`, `playwright-report/` are git-ignored — 5333b77

#### Manual

- [x] 1.6 `wrangler dev` launched and torn down (no orphan on :8787) — 5333b77
- [x] 1.7 `.dev.vars` generated with correct local creds and not committed — 5333b77
- [x] 1.8 Smoke page renders real catalog content (Supabase env reached the built Worker) — 5333b77

### Phase 2: Critical-flow spec (request → accept → overbooking block)

#### Automated

- [x] 2.1 Critical-flow spec passes against a fresh build
- [x] 2.2 Spec re-runs green without a DB reset (unique-data isolation)
- [x] 2.3 Lint passes

#### Manual

- [x] 2.4 Block panel shows exact capacity numbers "(1 z 1 zajęte, 1 wymaga miejsca)"
- [x] 2.5 Flow is legible/usable on the Pixel-5 viewport
- [x] 2.6 No email egress; run does not hang on a network call

### Phase 3: IDOR contact-data SSR page spec

#### Automated

- [ ] 3.1 IDOR spec passes against a fresh build
- [ ] 3.2 Full e2e suite passes together (`npm run build && npx playwright test`)
- [ ] 3.3 Lint passes

#### Manual

- [ ] 3.4 Foreign-owner page shows 404 "Nie znaleziono zapytania"; seeded guest email/phone appear nowhere in the DOM
- [ ] 3.5 Anonymous navigation lands on `/auth/signin` with no flash of contact data

### Phase 4: Cookbook docs + handoff

#### Automated

- [ ] 4.1 test-plan §6.4 no longer contains "TBD"
- [ ] 4.2 test-plan markdown formats clean (`npx prettier --check`)

#### Manual

- [ ] 4.3 A new contributor can follow §6.4 to add an e2e test without this plan
- [ ] 4.4 Deferred-CI decision and stale-doc finding are discoverable from the change folder
