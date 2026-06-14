---
date: 2026-06-14T00:11:48+0200
researcher: Konrad Beśka
git_commit: 134d56f829a98eeccd1bcc7494fa5ffccce28ff3
branch: master
repository: zagroda-hub
topic: "E2E critical flow on mobile viewport (request → accept → overbooking block) + delegated IDOR contact-data SSR page"
tags: [research, codebase, e2e, playwright, booking-flow, mobile, idor, cloudflare-workers]
status: complete
last_updated: 2026-06-14
last_updated_by: Konrad Beśka
---

# Research: E2E critical flow on mobile viewport + delegated IDOR SSR page

**Date**: 2026-06-14T00:11:48+0200
**Researcher**: Konrad Beśka
**Git Commit**: 134d56f829a98eeccd1bcc7494fa5ffccce28ff3
**Branch**: master
**Repository**: zagroda-hub

## Research Question

Ground the E2E phase (test-plan §3 Phase 2, Risk #3) on the real codebase: the
route/page entry points of the critical booking flow (teacher request → owner
accept → overbooking block) on a mobile viewport, owner auth/session
bootstrapping in a browser, the seed-data strategy, **and** the build/serve
target so the e2e exercises the real built artifact — not `astro dev`. Scope
also folds in the IDOR contact-data SSR page (`/dashboard/zapytania/[id].astro`,
Risk #4) that test-plan §7 explicitly delegated to this phase.

## Summary

- **The whole flow has no `data-testid` attributes.** Every assertion must use
  roles / labels / visible text. The UI strings are stable literals and the
  capacity-refusal message has a PRD oracle, so text-based locators are reliable.
- **Build/deploy target is Cloudflare Workers, NOT Vercel.** `tech-stack.md` is
  stale on this point; `astro.config.mjs` uses `@astrojs/cloudflare`, there is a
  real `wrangler.jsonc`, and CI deploys with `wrangler deploy`. The e2e must run
  against the built worker served by **`npx wrangler dev`** (port 8787), not
  `astro dev`/`astro preview` — exactly the "it works in dev ≠ built Worker is
  fine" challenge from the test plan (risk #3 "must challenge" column).
- **Playwright is not installed.** No `@playwright/test`, no `playwright.config.ts`,
  no `e2e/`/`tests/e2e/` dir. This phase builds the harness from scratch — and
  `/10x-e2e` will NOT do it (it assumes Playwright is present and stops if absent).
- **Owner auth in the browser = drive the real `/auth/signin` form.** The
  existing `signInOwnerHttp` helper is an in-process HTTP-handler harness and
  cannot be reused in a browser. Filling the real form lets `@supabase/ssr`
  write genuine session cookies into the browser context — no cookie forgery,
  and it exercises the real page+middleware wiring risk #3 targets.
- **Seeding = service-role admin inserts, mirroring `tests/helpers/supabase.ts`.**
  No `seed.sql` exists; every precondition is created at test time. A confirmed
  owner (`email_confirm: true`) + a `published: true` zagroda with a turnus +
  two pending requests on the same `trip_date` reproduces the overbooking arena.
  Capacity lives in `zagrody.daily_limit` (per-day, summed across turnusy), not
  on the turnus.
- **IDOR is enforced by middleware + Postgres RLS, no explicit owner check in
  the page.** Anonymous → 302 to `/auth/signin`; foreign authenticated owner →
  404 "Nie znaleziono zapytania" with no contact data. No service-role client on
  that page, so no RLS bypass.

## Detailed Findings

### Build / serve / deploy target — the discrepancy, resolved

**Ground truth: Cloudflare Workers.** `tech-stack.md:8` (`deployment_target: vercel`)
and its "swaps `@astrojs/cloudflare` for `@astrojs/vercel`" claim are **stale**.
Evidence from live config:

- `astro.config.mjs:7,16` — `import cloudflare from "@astrojs/cloudflare"`, `adapter: cloudflare()`, `output: "server"`.
- `wrangler.jsonc` (repo root) — `name: "zagroda-hub"`, `main: "./src/worker.ts"`, cron `*/5 * * * *`, `vars.SITE_URL = "https://zagroda-hub.webpushit.workers.dev"`.
- `src/worker.ts` — composes the Astro fetch handler (`@astrojs/cloudflare/handler`) with a `scheduled` handler for the email-outbox cron sweep. The deploy unit is a Worker.
- `package.json` `deploy` script: `npm run build && npm run db:push && wrangler deploy`.
- **No `vercel.json`, no `@astrojs/vercel` dependency.** `lessons.md` and `test-plan.md` (wrangler/Cloudflare) match reality; `tech-stack.md` does not.

**To serve the built app for Playwright:**
```
npm run db:start          # local Supabase (Docker)
npm run build             # astro build → dist/ + dist/server/wrangler.json
npx wrangler dev          # serves the built worker on http://127.0.0.1:8787 (workerd)
```
`wrangler dev` reads root `wrangler.jsonc` (`main: ./src/worker.ts`) and runs the
real built worker in `workerd`. There is **no `start`/`wrangler dev` npm script** —
invoke `npx wrangler dev` directly. Do **not** use `astro preview` (not faithful
under the Cloudflare adapter).

**Env at runtime:** all server env (`SUPABASE_URL`, `SUPABASE_KEY` (anon),
`SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `BREVO_API_KEY`, `EMAIL_FROM`,
`EMAIL_FROM_NAME`) is declared `context:"server", access:"secret", optional:true`
(`astro.config.mjs:17-26`). For e2e against real data you need the local Supabase
stack plus `SUPABASE_URL`/`SUPABASE_KEY` fed to the `wrangler dev` process; reuse
the `supabase status -o json` pattern from `tests/helpers/global-setup.ts:25-49`.
With `BREVO_API_KEY` unset the email drain is a logged no-op (zero network egress),
the right default for e2e.

### Scenario 1 — Teacher (guest) request

- **Route:** `/zagrody/{uuid}` (public, not gated) — `src/pages/zagrody/[id].astro`. SSR-loads only published zagrody (`is_published = true`, ~line 32); unknown/unpublished → 404. Mounts the form island at lines ~113-119.
- **Form:** `src/components/booking/BookingRequestForm.tsx` (`client:load`). Fields (schema `bookingRequestSchema`, `src/lib/booking.ts:41-65`): `turnus_id` (select, label "Turnus"), `trip_date` (date, "Data pobytu", today-or-future), `participants_count` (1–1000, "Liczba uczestników"), `guest_name` ("Imię i nazwisko"), `guest_email` ("E-mail"), `guest_phone` (PL phone, "Telefon"). `zagroda_id` hidden.
- **Submit:** `button[type=submit]` text **"Wyślij zapytanie"** (→ "Wysyłanie…").
- **API:** `POST /api/booking-request` → `src/pages/api/booking-request/index.ts:16` (anonymous). Re-validates published zagroda server-side, inserts with server-generated `id` + `cancel_token`, best-effort enqueues guest+owner emails (2 emails/call — un-rate-limited, accepted risk).
- **Success assertion target:** form swaps in place (no navigation, stays on `/zagrody/{uuid}`) to a green panel: **"Zapytanie wysłane — sprawdź e-mail, znajdziesz tam link do anulowania."** (`BookingRequestForm.tsx:109-115`).

### Scenario 2 — Owner acceptance

- **List route:** `/dashboard/zapytania` → `src/pages/dashboard/zapytania/index.astro`, renders `RequestsList.tsx`. Filter tabs `role="tab"`: "Oczekujące / Zaakceptowane / Odrzucone / Anulowane" (default "pending"). Each row is `a[href="/dashboard/zapytania/{id}"]`.
- **Detail route:** `/dashboard/zapytania/{uuid}` → `src/pages/dashboard/zapytania/[id].astro`, renders `RequestDecision.tsx` for `pending`/`accepted`.
- **Accept:** `button` text **"Akceptuj"** (→ "Akceptowanie…"), `RequestDecision.tsx:120-128`. Calls `POST /api/booking-request/accept` → `src/pages/api/booking-request/accept.ts:11`. Guards: 401 if no `locals.user`, 409 if `email_confirmed_at` unset. RLS-scoped select (404 if foreign), then RPC `accept_booking_request`. Returns `{ ok:true, status:"accepted" }`.
- **Success assertion target:** green panel **"Zaakceptowano — nauczyciel dostanie e-mail"** (`RequestDecision.tsx:81-86`); status badge → `accepted`.

### Scenario 3 — Overbooking block

- RPC `accept_booking_request` returns `accepted=false` (a **domain outcome, not an error** — status stays `pending`); handler maps to **HTTP 409** with templated message (`accept.ts:72-83`).
- **Canonical UI oracle (use PRD, not handler internals):** `prd.md:57` (US-01 acceptance) and `prd.md:131` (FR-014):
  > **"Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)"**
  Pattern: `Limit dzienny przekroczony ({occupied} z {daily_limit} zajęte, {requested} wymaga miejsca)`. Seed known capacity so the rendered numbers are deterministic (e.g. `daily_limit: 1`, two `participants:1` requests → "Limit dzienny przekroczony (1 z 1 zajęte, 1 wymaga miejsca)").
- Client renders the server message verbatim in a red `blocked` panel (`RequestDecision.tsx:99-104`); request stays pending, buttons stay active.
- **Assertion target:** red panel text containing "Limit dzienny przekroczony" and "zajęte".

### Scenario 4 — Undo acceptance (capacity release)

- **UI:** `RequestDecision.tsx:171-211`, shown when `status==="accepted"`. Button **"Cofnij akceptację"** → confirm panel → **"Tak, cofnij"** → `POST /api/booking-request/withdraw` (`src/pages/api/booking-request/withdraw.ts:11`). Returns `{ ok:true, status:"withdrawn_by_owner" }`; soft-fail "To zapytanie nie jest już zaakceptowane — odśwież stronę" if not accepted.
- **Success:** "Wycofano — nauczyciel dostanie e-mail" (`RequestDecision.tsx:93-98`).
- **Capacity release** frees seats immediately (occupancy counts only `status='accepted'`). This unlocks the US-01 full sequence: accept A (fills limit) → accept B (blocked) → withdraw A → accept B (now succeeds).
- Reject (`/api/booking-request/reject`) is **not** undoable.

### Scenario 5 — IDOR contact-data SSR page (Risk #4, delegated here)

- **Route:** `/dashboard/zapytania/{uuid}` → `src/pages/dashboard/zapytania/[id].astro`. Renders teacher contact (`[id].astro:106-136`, section "Kontakt do nauczyciela"): `guest_name`, `guest_email` (mailto link), `guest_phone` (tel link).
- **Authorization is two-layer, no explicit owner check in the page:**
  1. **Middleware** (`src/middleware.ts:18-21`): `/dashboard/*` protected; anonymous → **302 redirect to `/auth/signin`**.
  2. **RLS-scoped read** (`[id].astro:30-39`, cookie-scoped client): a foreign owner gets `data = null` → `Astro.response.status = 404` + "Nie znaleziono zapytania" panel, no contact data. No service-role client on this page → no RLS bypass.
- **Assertion targets:** foreign owner → text "Nie znaleziono zapytania" present, mailto/tel links absent; anonymous → redirected to `/auth/signin`.

### Owner auth / session bootstrapping in a browser

- **Sign-in page:** `/auth/signin` → `src/pages/auth/signin.astro` → `SignInForm.tsx`. Native `<form method="POST" action="/api/auth/signin">`. Fields: `getByLabel("Email")`, `getByLabel("Password")`; submit `getByRole("button", { name: "Sign in" })` (pending "Signing in...").
- **Handler:** `src/pages/api/auth/signin.ts` — form-encoded (NOT JSON). Success → **redirect `/dashboard`**; `email_not_confirmed` → `/auth/confirm-email`; bad creds → `/auth/signin?error=...`.
- **Recommended browser bootstrap:** navigate to `/auth/signin`, fill the real form, click, `await page.waitForURL("**/dashboard")`. `@supabase/ssr` writes genuine (chunked, base64url) session cookies into the browser context automatically. Capture as Playwright `storageState` once and reuse. **Avoid hand-injecting cookies** — `tests/helpers/api.ts:14` explicitly warns "Never hand-roll cookie chunking", and direct injection skips the real page/middleware wiring risk #3 exists to exercise.
- **Existing helper is not reusable in a browser:** `signInOwnerHttp` (`tests/helpers/api.ts:87-97`) drives the handler in-process with a bespoke `CookieJar` — no server, no browser.

### Seed-data strategy

- **No `seed.sql`** (config references `./seed.sql` but the file is absent). Every precondition is created at test time via the service-role admin client. Mirror `tests/helpers/supabase.ts`:
  - `createOwnerClient(email, password)` → `admin.auth.admin.createUser({ email, password, email_confirm: true })` (confirmed owner, can publish/accept).
  - `uniqueEmail(prefix)` → `${prefix}-${randomUUID()}@test.local` (collision-free; `zagrody.owner_id` is UNIQUE so each owner = one zagroda).
  - `seedZagroda(admin, { ownerId, dailyLimit, published })` — service-role insert bypasses the publication trigger, so `published: true` works directly; auto-creates `turnusCount` (default 1) turnusy.
  - `seedBookingRequest(admin, { zagrodaId, turnusId, tripDate, participants, status })` — defaults to `pending`.
- **Schema facts:** capacity = `zagrody.daily_limit` (per-day, summed across all turnusy for a `trip_date`), **not** on the turnus. Overbooking guard = SECURITY DEFINER RPC `accept_booking_request` (`supabase/migrations/20260605094725_accept_booking_request.sql:14-100`); locks zagroda row first (lock-order contract — see lessons.md), sums `participants_count` of `accepted` rows, flips to `accepted` only if within `daily_limit`.
- **Overbooking recipe:** confirmed owner → `seedZagroda(..., { dailyLimit: 1, published: true })` → two `booking_requests` same `trip_date`, `participants: 1` each, `status: 'pending'`, unique guest emails → accept #1 (succeeds) → accept #2 (409, stays pending).
- **Isolation:** no truncation/teardown of domain tables; isolation is by **unique data** (unique owner email, unique `trip_date` arena, unique guest emails). `fileParallelism: false` (shared DB). Clean baseline comes from `supabase db reset`.

## Code References

- `astro.config.mjs:7,16` — Cloudflare adapter (ground-truth deploy target); `:17-26` — server env schema (7 names)
- `wrangler.jsonc` — Worker config, cron trigger, SITE_URL; `src/worker.ts` — fetch+scheduled handler
- `package.json` — scripts (`build`, `deploy`, `db:start`); Playwright absent
- `.github/workflows/ci.yml:26-39` — `test` job starts local Supabase (`supabase start -x studio,realtime,imgproxy,edge-runtime,mailpit`); `:41-69` — deploy via `wrangler deploy`
- `src/pages/zagrody/[id].astro` — public zagroda detail + booking form mount
- `src/components/booking/BookingRequestForm.tsx:109-115,232-239` — success panel + submit button
- `src/pages/api/booking-request/index.ts:16` — anon request handler (server-gen id + cancel_token, 2 emails)
- `src/pages/dashboard/zapytania/index.astro` + `src/components/booking/RequestsList.tsx:18-23,67-68` — list + tabs + row links
- `src/pages/dashboard/zapytania/[id].astro:30-39,57-59,106-136,152-161` — detail SSR, RLS read, contact data, 404 panel (IDOR)
- `src/components/booking/RequestDecision.tsx:52-57,81-104,120-128,171-211` — accept/block/withdraw UI + messages
- `src/pages/api/booking-request/accept.ts:11,17-25,42-52,72-83` — accept guards + 409 capacity mapping
- `src/pages/api/booking-request/withdraw.ts:11` — withdraw handler
- `src/pages/api/auth/signin.ts:11,22,38` — signin handler (form-encoded, → /dashboard)
- `src/pages/auth/signin.astro` + `src/components/auth/SignInForm.tsx:43-90` — login form (labels Email/Password, button "Sign in")
- `src/middleware.ts:4,10-16,18-21` — PROTECTED_ROUTES=["/dashboard"], locals.user from getUser(), anon→redirect
- `src/lib/supabase.ts:10-24` (SSR client), `src/lib/supabase-admin.ts:17-26` (service-role)
- `src/lib/booking.ts:41-65` — `bookingRequestSchema` (shared client+server)
- `supabase/migrations/20260605090307_domain_schema.sql:9-56` — zagrody/turnusy/booking_requests + status enum
- `supabase/migrations/20260605200000_zagroda_profile_publication.sql:100-180,191-226` — publish gate, `set_zagroda_published` RPC, catalog visibility
- `supabase/migrations/20260605094725_accept_booking_request.sql:14-100` — overbooking guard RPC
- `tests/helpers/supabase.ts:35-44,55-68,120-122,147-208` — owner/zagroda/request seeding helpers
- `tests/helpers/global-setup.ts:25-94` — `supabase status -o json` credential resolution + local-only guard
- `tests/helpers/api.ts:14,25-35,87-97` — CookieJar / signInOwnerHttp (HTTP-handler harness, not browser-reusable)
- `context/foundation/prd.md:57,131` — FR-014 capacity-message oracle

## Architecture Insights

- **No `data-testid` anywhere in the flow.** Aligns with CLAUDE.md's locator policy (roles/labels/text first) — but it is forced, not chosen. If any assertion target is ambiguous, the plan should decide between adding a minimal `data-testid` vs. relying on text; prefer accessible names where they already exist.
- **The capacity refusal is a domain outcome (RPC returns `accepted=false`), surfaced as HTTP 409 by the handler and a red panel by the client.** The oracle for the message is the PRD, not handler code — guard against the oracle-problem anti-pattern the test plan names for risk #1/#3.
- **Authorization for the contact-data page is defense-in-depth with no app-level owner check**: middleware gate + Postgres RLS. The e2e is the only layer that exercises the *rendered SSR page* end-to-end (the HTTP-handler harness in Phase 1 could not reach it — Astro Container API was evaluated and rejected, per §7).
- **Build-vs-runtime split matters for the "real artifact" requirement.** `astro build` emits a Worker; only `wrangler dev` (workerd) runs that artifact. Testing against `astro dev` would pass while the built Worker output silently breaks — precisely the failure risk #3's "must challenge" column calls out.
- **Mobile viewport is a Playwright device-emulation concern**, not an app concern — every page already wraps content in a phone-width column (`mx-auto w-full max-w-md`). Use a Playwright project with a phone descriptor (e.g. Pixel 5 / iPhone) per PRD (Chrome Android + Safari iOS, portrait, one-handed).

## Historical Context (from prior changes)

- `context/archive/2026-06-12-testing-http-surface-booking/` (Phase 1) — **explicitly deferred the SSR contact-data page to this e2e phase.** Established: foreign owner gets **404, not 403** (RLS pre-SELECT hides the row before the RPC's owner re-check); auth via the real signin handler writing genuine `@supabase/ssr` chunked cookies; capacity-message oracle taken from the PRD, never eyeballed from `accept.ts`. Noted `seedBookingRequest` should grow optional guest-contact overrides for leak assertions.
- `context/archive/2026-06-11-gated-acceptance-with-overbooking-guard/` — accept/reject routes, verified-email gate (409 "Zweryfikuj adres e-mail…"), exact FR-014 message, owner-notification deep link `{origin}/dashboard/zapytania/{id}`.
- `context/archive/2026-06-11-owner-undo-acceptance/` — withdraw route + capacity release; the full US-01 accept→block→withdraw→accept sequence; the `RequestDecision` mount gate (pending, extended to accepted).
- `context/archive/2026-06-08-guest-booking-request/` — anon `POST /api/booking-request`, shared zod schema, idempotent guest-cancel, 2 emails/call (quota-drain vector, accepted MVP risk).
- `context/archive/2026-06-07-catalog-browse-and-zagroda-page/` — teacher entry path: `/` → `/katalog` (filters) → zagroda card → `/zagrody/[id]` → booking island. Public pages anon-readable; unpublished → 404.
- `context/archive/2026-06-05-owner-publishes-zagroda/` — publish gate (verified email + complete profile + ≥1 turnus); `is_published` flips only via `set_zagroda_published` RPC (service-role seeding bypasses it).
- `context/archive/2026-06-13-testing-email-outbox-reliability/` (Phase 3) — outbox rows observable via admin client; `BREVO_API_KEY` unset → drain is a logged no-op (good default for e2e: zero network egress).

## Related Research

- `context/foundation/test-plan.md` §2 Risk #3 + #4, §3 Phase 2 row, §6.4 (e2e cookbook — TBD, this phase fills it), §7 (IDOR delegation)
- `context/archive/2026-06-12-testing-http-surface-booking/` — Phase 1 HTTP-surface change (sibling layer)

## Open Questions

1. **Stale `tech-stack.md` (Vercel claim).** `tech-stack.md:8` says `deployment_target: vercel` and describes a Vercel adapter swap that did not happen — the project runs on Cloudflare Workers. Documentation drift, not a code issue, but it mis-grounds anyone who trusts it. Worth a `/10x-lesson` ("docs say Vercel, reality is Cloudflare Workers") and/or a `tech-stack.md` correction. **Does not block this change** but the plan must target `wrangler dev`, not Vercel.
2. **Playwright is absent — `/10x-e2e` will stop.** The skill assumes Playwright is installed and the app runnable; with no `playwright.config.*` and no `*.spec.ts` it halts and redirects to setup. So the plan must include a setup phase: install `@playwright/test`, a config with a mobile project + `webServer`/`storageState`, and a single-spec run command. (Per test-plan §3, wiring the e2e gate **into CI** is formally Phase 4; Phase 2 may land config + spec and leave the CI gate to Phase 4 — the plan should decide.)
3. **CI runtime budget for e2e.** The e2e job must: start local Supabase, `npm run build`, launch `wrangler dev` in the background, `npx playwright install --with-deps`, then run. Browser install + build is the slow part — confirm acceptable CI time and whether to cache the Playwright browser download.
4. **Mobile device matrix.** PRD names Chrome Android + Safari iOS, portrait. Run both projects (Pixel + iPhone) or one representative phone for the critical flow? More devices = more CI time for marginal signal (anti-pattern: e2e-everything).
5. **`data-testid` policy for ambiguous targets.** All current assertion targets resolve via text/role today. If the plan finds an ambiguous one (e.g. distinguishing two pending rows), decide: add a minimal `data-testid` to the component, or seed unique guest names and locate by text. Prefer the latter where it stays readable.
6. **Worker env injection for `wrangler dev`.** Confirm the exact mechanism to pass local Supabase `SUPABASE_URL`/`SUPABASE_KEY` (anon) into the `wrangler dev` process (`.dev.vars` vs `--var` vs env) so the e2e server talks to the local stack, and whether `SUPABASE_SERVICE_ROLE_KEY` should be present (needed only if a test exercises the email/outbox path; otherwise leave unset for no-op drains).
