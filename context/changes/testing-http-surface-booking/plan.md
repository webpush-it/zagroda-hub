# HTTP-Surface Integration on the Booking Lifecycle — Implementation Plan

## Overview

Build the HTTP-surface integration test layer for the booking lifecycle — rollout Phase 1 of `context/foundation/test-plan.md` §3, covering risks #1 (concurrency through the handler), #4 (IDOR/contact-data leak), #5 (cancel token, server-side validation parity, quota-drain decision), and #6 (publication gate). The phase delivers a vitest harness that composes the **real middleware** with directly-imported API handlers, four test suites under `tests/api/`, and the cookbook §6.3 entry that makes the pattern repeatable.

No production code changes. The only `src/` knowledge consumed is via imports; the only non-test file edits are `vitest.config.ts` (aliases) and `context/foundation/test-plan.md` (documentation closeout).

## Current State Analysis

- 16 test files exist, all at DB/unit layer (`tests/db/`, `tests/unit/`). **Nothing above the DB layer is exercised** — the handler/middleware wiring (error translation, auth gates, RLS pre-SELECT, soft-outcome mapping) has zero coverage.
- `vitest.config.ts` runs node env against the local Supabase stack, `fileParallelism: false`, `include: ["tests/**/*.test.ts"]` — a new `tests/api/` directory is auto-included.
- `tests/helpers/supabase.ts` already provides every fixture the harness needs: `createOwnerClient` (confirmed user + known password), `createUnverifiedOwnerClient` (confirmed → signin → SQL-clear `email_confirmed_at`), `seedZagroda` (with `published` option), `seedBookingRequest`, `uniqueEmail`.
- The proven race pattern lives at `tests/db/concurrency.test.ts:51-54` (`Promise.all` of two accepts, exactly one succeeds).
- Full handler-contract inventory is in `context/changes/testing-http-surface-booking/research.md` — error-code translation tables, soft-outcome matrices, surface inventory, harness evaluation.

## Desired End State

`npm test` (with `npx supabase start` running) executes the existing 16 files **plus** `tests/api/` suites proving, at the HTTP layer:

1. Two parallel accepts through the real handler+middleware → exactly one 200, one 409 (risk #1).
2. The capacity refusal carries the exact PRD FR-014/US-01 message and structured fields; withdraw frees seats that are immediately acceptable (risk #1).
3. A foreign authenticated owner gets 404 (not data, not 403) and an anonymous client gets 401 on every decision route; no API response ever echoes `guest_email`/`guest_phone` (risk #4).
4. The server alone rejects hostile guest input (past date, zero participants, malformed email, unpublished zagroda, forged/malformed cancel tokens) with the client bypassed (risk #5).
5. An unverified owner cannot publish — 409 with the exact verification message (risk #6).
6. `test-plan.md` §6.3 documents how to add the next HTTP-surface test; §7 records the merge-guard HTTP gap and the quota-drain accepted-risk decision.

### Key Discoveries:

- **Middleware is mandatory in the harness**: API routes self-guard on `locals.user`; a direct handler call without `onRequest` tests an anonymous world (`src/middleware.ts:6-16`). Composition: `onRequest(ctx, () => POST(ctx))`.
- **Two vitest aliases unlock everything**: `astro:middleware` → `astro/virtual-modules/middleware.js` (real `defineMiddleware`, an identity wrapper) and `astro:env/server` → a test stub. Only these two virtual modules appear across `src/pages/api/` (research.md, "Stack facts").
- **Auth without cookie forgery**: invoke the real `POST /api/auth/signin` handler (`src/pages/api/auth/signin.ts:10-39`, takes `FormData`) — `@supabase/ssr` writes genuine chunked session cookies (`sb-127-auth-token.0`, `.1`, …) into the jar via `context.cookies.set`. Success redirects to `/dashboard`; failure redirects to `/auth/signin?error=…` — assert the `Location` to catch silent auth failures.
- **Outbox rows appear iff the admin client exists, independent of Brevo config**: `sendTransactionalEmail` (`src/lib/email/index.ts:29-60`) enqueues whenever `deps.admin` is non-null; `config: null` only no-ops the immediate drain (no network). The env stub therefore provides `SUPABASE_SERVICE_ROLE_KEY` but leaves `BREVO_API_KEY`/`EMAIL_FROM` unset.
- **PRD-derived capacity oracle**: FR-014 template `"Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)"` (`context/foundation/prd.md:131`); US-01 concrete instance `(20 z 30 zajęte, 15 wymaga miejsca)` (`prd.md:57`). The test builds the expected string from the PRD template + its own fixture numbers — never from `accept.ts`.
- **Cancel-token parse behavior pinned** (`src/pages/api/booking-request/cancel.ts:19-28`): non-JSON body → 400; valid JSON with non-UUID token → 200 `{status:"not_found"}` (deliberately indistinguishable from an unknown token).
- **Foreign owner asserts 404, not 403**: the RLS pre-SELECT hides the row before the RPC runs (`accept.ts:42-51`); the 403 path is only reachable if RLS is bypassed.
- **`seedBookingRequest` hardcodes guest contact fields** (`tests/helpers/supabase.ts:176-178`) — must grow optional `guest_email`/`guest_phone`/`guest_name` overrides for outbox attribution and leak assertions.

## What We're NOT Doing

- **No SSR page tests** — `/dashboard/zapytania/[id].astro` (the contact-data page) is delegated to §3 Phase 2 e2e; Astro Container API was evaluated and rejected (research.md, "Rejected options"). Phase 1 covers the API-route side of risk #4 and documents the delegation.
- **No OAuth merge-guard HTTP test** — guard logic + RPC are covered at unit/db layers; faking a code exchange against local GoTrue is high-effort/low-marginal-signal. The HTTP wiring gap is documented in §7 (decision: this session).
- **No rate limiting implementation** — the quota-drain risk on `POST /api/booking-request` is accepted for MVP traffic with Cloudflare-level rate limiting named as the remediation path (decision: this session). Phase 5 documents it; no production code changes.
- **No deep outbox contract assertions** — only "row appears on success, none on refusal." Retry budgets, double-send, provider mocking belong to §3 Phase 3.
- **No e2e, no CI YAML changes, no hooks/MCP config** — Phases 2 and 4 of the rollout, and later lessons, respectively. The new tests run inside the existing `npm test` flow and existing CI test step.
- **No re-testing of RPC internals** — lock order, capacity math, token-under-lock semantics are proven in `tests/db/`. HTTP tests assert the handler faithfully wires request → RPC → response.

## Implementation Approach

Direct handler import composed with the real middleware (research.md option (a)): vitest aliases resolve the two Astro virtual modules, a small fake cookie jar implements the `AstroCookies` subset handlers actually use (`get`/`set`/`delete`/`headers`), and authentication runs through the real signin handler so session cookies are genuine. Tests run in the existing vitest pipeline against the local Supabase stack — no new processes, no Astro dev server.

Build order de-risks the harness first (Phase 1 proves middleware + auth + RLS end-to-end with a smoke test), then layers test suites by risk, then closes with documentation. Each test suite is one file under `tests/api/`, organized per surface.

## Critical Implementation Details

- **Env stub split is load-bearing**: `tests/helpers/astro-env.ts` must export `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (from vitest `inject()`), `SITE_URL` (any literal, lands in email links), and `BREVO_API_KEY`/`EMAIL_FROM`/`EMAIL_FROM_NAME` as `undefined`. Service-role present → outbox rows observable; Brevo absent → `getEmailConfig()` returns null → drain is a logged no-op → **no network calls from tests**. Cross-link the stub to `astro.config.mjs:17-27` with a comment (schema drift guard).
- **Module-scope `inject()` contingency**: if `inject()` fails at stub module-evaluation time, switch to `export let` bindings initialized from a setup hook — ES module live bindings work because every consumer reads the values at call time (`getEmailConfig`, `createClient`), not import time.
- **Unverified-owner sequencing**: create confirmed → **HTTP signin first** (jar gets cookies) → SQL-clear `email_confirmed_at` → call the route. Clearing before signin breaks because GoTrue blocks unconfirmed signins (see `tests/helpers/supabase.ts:46-54` comment). Middleware's `getUser()` reads `auth.users` fresh, so the gate sees the cleared state.
- **Never hand-roll cookie chunking**: serialize whatever the jar captured back into the `Cookie` header. If a future negative test must forge a cookie, use `@supabase/ssr`'s exported `createChunks`.
- **Floating drain promise**: `sendTransactionalEmail` fires `void drain.catch(…)` un-awaited. With null config it resolves immediately; tests must not assert on drain side effects, only on outbox row existence.
- **Shared DB**: `fileParallelism: false` stays. `tests/api/` files seed fresh fixtures per test via `uniqueEmail()`/`seedZagroda` exactly like `tests/db/` — no truncation, no shared state across files.

## Phase 1: HTTP-Surface Harness

### Overview

Make a directly-imported Astro API handler runnable under vitest with the real middleware and a genuine session, proven by a smoke test that exercises the full path (anon 401 → signin → owner 200).

### Changes Required:

#### 1. Vitest aliases for Astro virtual modules

**File**: `vitest.config.ts`

**Intent**: Resolve the only two virtual modules used by the API surface so handlers and middleware import cleanly in node.

**Contract**: `resolve.alias` gains `"astro:middleware"` → `astro/virtual-modules/middleware.js` (package export, real `defineMiddleware`) and `"astro:env/server"` → `./tests/helpers/astro-env.ts` (absolute path via `fileURLToPath`, same idiom as the existing `@` alias). Existing `@` alias and all `test` options unchanged.

#### 2. Env stub

**File**: `tests/helpers/astro-env.ts` (new)

**Intent**: Stand in for `astro:env/server` with the exact 7-name schema from `astro.config.mjs`, wired to the local Supabase credentials that `global-setup.ts` provides.

**Contract**: Named exports `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (from `inject()`), `SITE_URL` (literal, e.g. `"http://localhost:4321"`), `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` (all `undefined`). Comment cross-links `astro.config.mjs:17-27` (see Critical Implementation Details for why the Brevo trio must stay unset).

#### 3. API harness helpers

**File**: `tests/helpers/api.ts` (new)

**Intent**: One place for the cookie jar, the `APIContext` shell, middleware composition, and HTTP-level signin — the helper every `tests/api/` file imports.

**Contract**: Exports approximately:
- `CookieJar` — backs the `AstroCookies` subset actually used, which is minimal (verified): the `@supabase/ssr` adapter only ever calls `cookies.set(name, value, opts)` — reads parse the request `Cookie` header (`src/lib/supabase.ts:12-22`). So: `set()` plus `toCookieHeader()` for serializing into subsequent requests. Add `get`/`delete`/`headers()` only if a test actually needs them (none in this plan does; `headers()` is callback.ts-only, out of scope).
- `createApiContext({ jar, method, path, body?, formData? })` — builds `{ request, url, cookies, locals: {}, redirect }`; `redirect(path)` returns a 302 `Response` with `Location`; the `Cookie` header comes from the jar.
- `runRoute(handler, ctx)` — `onRequest(ctx, () => handler(ctx))` with the real `src/middleware.ts` import; returns the `Response`.
- `signInOwnerHttp(jar, email, password)` — invokes the real `POST /api/auth/signin` with `FormData`, **throws unless the redirect `Location` is `/dashboard`** (failure also redirects, to `/auth/signin?error=…`).
- `assertNoContactData(responseBody, { guest_email, guest_phone })` — asserts the serialized body contains neither value; applied to every response asserted in Phases 2–4 so the end-state claim "no API response ever echoes contact data" holds across all suites, not just the authz file.

This signature set is a contract for Phases 2–4 — keep names stable.

#### 4. Fixture helper extension

**File**: `tests/helpers/supabase.ts`

**Intent**: Allow per-test guest contact values so outbox rows can be attributed unambiguously and leak assertions are meaningful.

**Contract**: `SeedRequestOptions` gains optional `guest_name`, `guest_email`, `guest_phone` (defaults = current hardcoded values). No call-site changes needed.

#### 5. Smoke test

**File**: `tests/api/harness.test.ts` (new)

**Intent**: Prove the harness end-to-end before any risk suite depends on it.

**Contract**: Three cases: (1) anonymous `POST /api/booking-request/accept` with a random UUID → 401; (2) signed-in owner accepting a nonexistent UUID → 404 (proves the session traversed middleware — anon would get 401); (3) signed-in owner with seeded zagroda + pending request accepts it → 200 `{ ok: true, status: "accepted" }` and the DB row (admin client) is `accepted` — proves middleware, RLS pre-SELECT, and RPC all ran.

### Success Criteria:

#### Automated Verification:

- Full suite passes including the new smoke file: `npm test` (local Supabase running)
- Existing `tests/db/` + `tests/unit/` files still pass unchanged (alias additions are non-breaking)
- Lint passes: `npm run lint`

#### Manual Verification:

- Review that `tests/helpers/api.ts` stays within the documented `AstroCookies`/`APIContext` subset (no speculative surface)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding — every later phase builds on these helper signatures.

---

## Phase 2: Booking Decision Lifecycle (Risk #1)

### Overview

Prove the accept/withdraw handlers faithfully wire the atomic RPC — concurrency outcome, capacity refusal with the PRD oracle, freed-seats-after-withdraw, error translation — plus light outbox assertions.

### Changes Required:

#### 1. Decision lifecycle suite

**File**: `tests/api/booking-decision.test.ts` (new)

**Intent**: Cover the risk #1 "what would prove protection" line at the HTTP layer, using PRD US-01's own numbers (limit 30, requests of 20 and 15) so the message oracle is PRD-derived.

**Contract**: Test cases:

- **Accept happy path**: pending request → 200 `{ ok: true, status: "accepted" }`; DB row `accepted`; exactly one `email_outbox` row addressed to the request's (unique) `guest_email`.
- **Reject happy path**: pending request → 200; DB row `rejected` (completes the decision surface; one test).
- **Capacity refusal (deterministic oracle)**: zagroda limit 30; accept the 20-person request, then accept the 15-person request on the same date → 409 with `error` **exactly equal** to the string built from the PRD FR-014 template with X=20, Y=30, Z=15 (i.e. US-01's literal message), plus structured fields `occupied: 20`, `daily_limit: 30`, `requested: 15`; loser row stays `pending`; **no** outbox row for the refused request's guest_email. The expected string lives in the test with a comment citing `prd.md` FR-014/US-01 — never imported from or eyeballed against `accept.ts`.
- **Parallel-accept race**: same fixture shape, two owner sessions (two jars from two `signInOwnerHttp` calls), `Promise.all` of two `runRoute` accepts on the two conflicting requests → exactly one 200 and one 409 per iteration; the 409 carries internally-consistent structured fields. ~10 iterations on **one owner + one zagroda with a fresh `trip_date` per iteration** (capacity is computed per zagroda + trip_date, so each date is an independent arena; `zagrody.owner_id` is UNIQUE — `domain_schema.sql:20` — so per-iteration zagrody would need per-iteration owners, which is why the DB test creates fresh owners; jars are reused here instead). End-state DB assertion filters by `trip_date`. Race mechanics lifted from `tests/db/concurrency.test.ts:51-54`.
- **Withdraw frees seats**: accept 20 → withdraw it → 200 `{ ok: true, status: "withdrawn_by_owner" }` and an outbox row for the withdrawal (FR-016) → accepting the previously-refused 15 now → 200.
- **Withdraw non-accepted**: withdraw a `pending` request → 409 `{ error: "To zapytanie nie jest już zaakceptowane — odśwież stronę", status: "pending" }`.
- **Error translation**: accept nonexistent UUID → 404 "Zapytanie nie istnieje"; accept a non-pending (seeded `rejected`) request → 409 "To zapytanie nie jest już oczekujące — odśwież stronę"; non-UUID `id` → 422 (schema parse); non-JSON body → 400.
- All responses asserted in this file additionally pass through `assertNoContactData` (Phase 1 helper).

### Success Criteria:

#### Automated Verification:

- New suite green, full run passes: `npm test`
- Race test stable across the full run (no flaky exactly-one-winner violations in 10 iterations)
- Lint passes: `npm run lint`

#### Manual Verification:

- Confirm the capacity-message assertion string matches `prd.md` FR-014/US-01 verbatim (oracle independence spot-check)

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Authorization Surfaces (Risks #4 + #6)

### Overview

Two negative identities — foreign authenticated owner and anonymous client — against every decision route, the contact-data non-exposure invariant, and the publication gate.

### Changes Required:

#### 1. Authorization suite

**File**: `tests/api/authz.test.ts` (new)

**Intent**: The HTTP-layer regression net for "someone drops the RLS policy or switches a read to the admin client" (risk #4) and "the verified-email gate gets unwired" (risk #6).

**Contract**: Test cases:

- **Anonymous matrix**: `POST accept/reject/withdraw` with a valid-shape UUID, empty jar → 401 "Zaloguj się, aby zarządzać rezerwacjami" on each.
- **Foreign-owner matrix**: owner A's zagroda + pending request; owner B signs in and calls accept/reject/withdraw with A's request id → **404** "Zapytanie nie istnieje" on each (not 403 — RLS pre-SELECT hides the row; a 403 here would mean RLS was bypassed and the RPC's ownership re-check fired).
- **Unverified-owner gate**: confirmed owner → HTTP signin → SQL-clear `email_confirmed_at` (sequencing per Critical Implementation Details) → accept own pending request → 409 "Zweryfikuj adres e-mail, aby zarządzać rezerwacjami".
- **Contact-data non-exposure**: seed requests with unique `guest_email`/`guest_phone`; run `assertNoContactData` on every decision-route response asserted in this file (200s, 404s, 401s, 409s). The same helper is applied in the Phase 2 and Phase 4 suites — see Phase 1 helper contract.
- **Publication gate (risk #6)**: unverified owner with a publish-complete draft zagroda (`seedZagroda` defaults) → `POST /api/zagroda/publish` `{ publish: true }` → **409 with exactly** "Zweryfikuj adres e-mail, aby opublikować zagrodę" (exact match matters — `profile_incomplete` and `no_turnus` are also 409s, `publish.ts:20-36`). Control case: verified owner, same fixture → 200 `{ is_published: true }` (proves the gate test isn't passing for the wrong 409).

### Success Criteria:

#### Automated Verification:

- New suite green, full run passes: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Review the foreign-owner cases assert 404 (not 403) with the rationale comment present

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Hostile Guest Input (Risk #5)

### Overview

The un-authenticated surfaces under attack: server-side validation with the client bypassed, and the full cancel-token matrix.

### Changes Required:

#### 1. Guest input suite

**File**: `tests/api/guest-input.test.ts` (new)

**Intent**: Prove the server actually runs the shared zod parse (guarding against a refactor that drops it) and that the cancel token grants exactly one capability — cancelling its own pending request.

**Contract**: Test cases against `POST /api/booking-request` (anonymous, raw `fetch`-shaped JSON bodies, no client code):

- Valid payload (published zagroda + its turnus) → 200 `{ ok: true }`; DB row `pending` with a populated `cancel_token`; two outbox rows (guest confirmation + owner notification — `index.ts:66-116`).
- Past `trip_date` → 422 with `fieldErrors`; `participants_count: 0` → 422; malformed `guest_email` → 422 (assert status + `fieldErrors` key presence, not error-copy snapshots — test-plan §2 anti-pattern).
- Unpublished (draft) zagroda → 422 "Zagroda niedostępna".
- Turnus belonging to a different zagroda → 422 (FK/RLS path, `index.ts:59-62`).
- Non-JSON body → 400.

Against `POST /api/booking-request/cancel`:

- Non-JSON body → 400; valid JSON with non-UUID token → 200 `{ status: "not_found" }`; well-formed unknown UUID → 200 `{ status: "not_found" }` (no existence signal in either).
- Valid token on pending → 200 `{ status: "cancelled" }`, DB row `cancelled_by_guest`; repeat same token → 200 `{ status: "already_cancelled" }`.
- Token of a seeded `accepted` request → 200 `{ status: "already_accepted" }`, row stays `accepted`.
- (RPC semantics — lock, pending-only transition — are NOT re-tested; `tests/db/guest-cancel.test.ts` owns them.)
- All responses asserted in this file additionally pass through `assertNoContactData` (Phase 1 helper) — the create and cancel surfaces must never echo the stored contact fields.

### Success Criteria:

#### Automated Verification:

- New suite green, full run passes: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Confirm no test mirrors the client schema as its oracle (inputs are hand-written hostile payloads, not `bookingRequestSchema`-derived)

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Documentation Closeout

### Overview

Fill cookbook §6.3, record the two documented decisions (merge-guard HTTP gap, quota-drain acceptance), and append the phase note.

### Changes Required:

#### 1. Cookbook §6.3 + §6.6 + §7

**File**: `context/foundation/test-plan.md`

**Intent**: Make the HTTP-surface pattern repeatable for the next contributor and record the decisions this phase produced. Strategy sections §1–§5 stay frozen except where the rollout explicitly owns them.

**Contract**:
- **§6.3** replaces its TBD with: location `tests/api/`; naming `<surface>.test.ts`; reference tests `tests/api/booking-decision.test.ts` (race + oracle), `tests/api/authz.test.ts` (two-identity negative); harness facts (the two vitest aliases, `tests/helpers/api.ts` + `astro-env.ts`, auth via real signin handler); run command (`npx supabase start`, then `npm test`); the rule "compose `onRequest` — a bare handler call tests an anonymous world".
- **§6.6** gains the 2–3 line phase note (anything surprising the implementation taught — written at implementation time).
- **§7** gains two entries: (a) **OAuth merge-guard HTTP wiring** — covered at unit/db layers; the `callback.ts` HTTP path is deliberately untested (full OAuth simulation against local GoTrue is high-cost/low-marginal-signal); re-evaluate if the callback flow changes. (b) **Quota-drain on `POST /api/booking-request`** — accepted for MVP traffic (decision 2026-06-13); remediation path is Cloudflare-level rate limiting (WAF rules), re-evaluate when real traffic exists. Also note under (a)/(b) context that the `/dashboard/zapytania/[id].astro` IDOR check is **delegated to §3 Phase 2 e2e**, not dropped.

§3 row status updates remain the `/10x-test-plan` orchestrator's job — do not edit the rollout table.

### Success Criteria:

#### Automated Verification:

- Full suite still green: `npm test`
- Lint passes (markdown untouched by eslint, but the run guards accidental code edits): `npm run lint`

#### Manual Verification:

- Read §6.3 as an outsider: could someone add the next HTTP-surface test from it alone, without reading this plan?

---

## Testing Strategy

This plan IS the testing strategy for rollout Phase 1; meta-level notes only:

### Unit Tests:

- None added — no production logic changes. Existing `tests/unit/` untouched.

### Integration Tests:

- The four `tests/api/` suites above. All run against the local Supabase stack inside the existing `npm test` flow; CI's existing test step picks them up with zero YAML changes.

### Manual Testing Steps:

1. `npx supabase start`, then `npm test` — full suite green.
2. Run `npx vitest run tests/api` three times in a row — race test stable (no flakes).
3. Temporarily revert the `astro:middleware` alias → harness tests must fail loudly (import error), proving the suites can't silently degrade to an anonymous world.

## Performance Considerations

- The race test adds ~10 iterations × (2 HTTP-composed accepts + fixture seeding) — expect a few seconds, within the 30s `testTimeout`. If runtime grows, reduce iterations before raising the timeout (the DB-layer test already runs 20 iterations of the same race).
- No network egress from tests: Brevo config stays null (drain no-ops). Any test that hangs on an external call is a harness regression.

## Migration Notes

None — no schema or production code changes. The lessons.md lock-order rule is respected by construction: all fixtures go through the existing `seedZagroda`/`seedBookingRequest` helpers; no test mutates `zagroda_id`/`turnus_id`/`trip_date` of any row.

## References

- Research: `context/changes/testing-http-surface-booking/research.md` (harness evaluation, full contract inventory)
- Quality contract: `context/foundation/test-plan.md` §2 (risks #1/#4/#5/#6), §3 Phase 1
- Oracle source: `context/foundation/prd.md` FR-014 (line 131), US-01 (line 57)
- Race pattern: `tests/db/concurrency.test.ts:51-54`
- Fixture helpers: `tests/helpers/supabase.ts`
- Handler contracts: `src/pages/api/booking-request/{accept,withdraw,reject,index,cancel}.ts`, `src/pages/api/zagroda/publish.ts`, `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: HTTP-Surface Harness

#### Automated

- [x] 1.1 Full suite passes including the new smoke file (`npm test`) — 0a777ea
- [x] 1.2 Existing `tests/db/` + `tests/unit/` files still pass unchanged — 0a777ea
- [x] 1.3 Lint passes (`npm run lint`) — 0a777ea

#### Manual

- [x] 1.4 Helper surface review — `tests/helpers/api.ts` stays within the documented AstroCookies/APIContext subset — 0a777ea

### Phase 2: Booking Decision Lifecycle (Risk #1)

#### Automated

- [x] 2.1 New suite green, full run passes (`npm test`) — 5bd3bc3
- [x] 2.2 Race test stable across the full run (10 iterations, exactly one winner each) — 5bd3bc3
- [x] 2.3 Lint passes (`npm run lint`) — 5bd3bc3

#### Manual

- [x] 2.4 Capacity-message assertion matches `prd.md` FR-014/US-01 verbatim — 5bd3bc3

### Phase 3: Authorization Surfaces (Risks #4 + #6)

#### Automated

- [x] 3.1 New suite green, full run passes (`npm test`) — 236696c
- [x] 3.2 Lint passes (`npm run lint`) — 236696c

#### Manual

- [x] 3.3 Foreign-owner cases assert 404 (not 403) with rationale comment present — 236696c

### Phase 4: Hostile Guest Input (Risk #5)

#### Automated

- [x] 4.1 New suite green, full run passes (`npm test`) — 0b210eb
- [x] 4.2 Lint passes (`npm run lint`) — 0b210eb

#### Manual

- [x] 4.3 No test mirrors the client schema as its oracle — 0b210eb

### Phase 5: Documentation Closeout

#### Automated

- [x] 5.1 Full suite still green (`npm test`)
- [x] 5.2 Lint passes (`npm run lint`)

#### Manual

- [x] 5.3 §6.3 readable standalone — next contributor can add an HTTP-surface test from it alone
