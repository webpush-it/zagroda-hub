---
date: 2026-06-13T00:03:24+02:00
researcher: Claude Code (for Konrad Beśka)
git_commit: d4dcc218212d17ff3e2747efe31ccb436360053c
branch: master
repository: zagroda-hub
topic: "HTTP-surface integration on the booking lifecycle — grounding for test-plan §3 Phase 1 (risks #1, #4, #5, #6)"
tags: [research, codebase, testing, http-surface, booking, api-routes, middleware, auth, idor, cancellation-token, vitest, astro]
status: complete
last_updated: 2026-06-13
last_updated_by: Claude Code (for Konrad Beśka)
---

# Research: HTTP-surface integration on the booking lifecycle (test-plan §3 Phase 1)

**Date**: 2026-06-13T00:03:24+02:00
**Researcher**: Claude Code (for Konrad Beśka)
**Git Commit**: d4dcc218212d17ff3e2747efe31ccb436360053c
**Branch**: master
**Repository**: zagroda-hub

Permalink base for all references below:
`https://github.com/webpush-it/zagroda-hub/blob/d4dcc21/<file>#L<line>`

## Research Question

Ground the four risks assigned to rollout Phase 1 of `context/foundation/test-plan.md` (§2 "Risk Response Guidance", column "Context `/10x-research` must ground"):

- **Risk #1** — how the accept/undo handlers invoke the atomic primitive; error translation to the user-facing message; auth/session shape on those routes.
- **Risk #4** — which handlers/pages serve request details; where service-role clients are used; where the ownership check lives.
- **Risk #5** — token issuance/verification shape; which validation actually runs server-side; which endpoints can trigger emails without auth.
- **Risk #6** — where the publication gate and merge guard are enforced per route; middleware vs handler responsibility split.

Plus the harness question for cookbook §6.3: how can vitest exercise the real middleware + handler + RLS path against the local Supabase stack?

## Summary

- **The whole booking decision surface is 5 API routes** under `src/pages/api/booking-request/` (`index` create, `accept`, `reject`, `withdraw`, `cancel`) plus 2 SSR dashboard pages (`/dashboard/zapytania`, `/dashboard/zapytania/[id]`) and the anonymous `/anuluj` page.
- **Accept/withdraw call the SECURITY DEFINER RPCs through the user-session client** (RLS active) and translate Postgres error codes (`P0002`→404, `42501`→403, `55000`→409, default→500) into fixed Polish messages. The capacity refusal is **not an error**: the RPC returns `accepted=false` and the handler emits a hardcoded 409 `"Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)"` — `accept.ts:76`.
- **Ownership is defense-in-depth**: handler fast-path (401/409 for anon/unverified), an RLS-scoped pre-SELECT (foreign request → `null` → 404 *before* the RPC runs), and an ownership re-check inside the RPC (`42501`). The detail page relies on RLS alone; service-role clients are confined to email infrastructure and never serve request data.
- **All booking-form validation is one shared zod schema** (`bookingRequestSchema` in `src/lib/booking.ts:41-65`) parsed on both client and server — **no client-only rules exist**. The cancel token is an app-side `crypto.randomUUID()` (unique-indexed), verified by lookup-under-lock in the cancel RPC; wrong token → HTTP 200 with `status: "not_found"` (soft outcome, not 4xx). `POST /api/booking-request` is the un-authenticated, un-rate-limited email trigger (2 emails per call) — the documented quota-drain vector.
- **Publication gate is enforced in the DB function** (`55000 'email_not_verified'`) and mapped to 409 by `publish.ts`; the OAuth merge guard lives in `src/lib/auth/oauth-guard.ts` and is enforced (fail-closed) in `api/auth/callback.ts`. **Middleware only redirects `/dashboard*` pages** — API routes self-guard on `locals.user`, so an HTTP-layer test MUST compose the middleware to exercise the real session path.
- **Recommended harness (cookbook §6.3): direct handler import composed with the real middleware** — `onRequest(ctx, () => POST(ctx))` in vitest, with 2 vitest aliases (`astro:middleware` → `astro/virtual-modules/middleware.js`, `astro:env/server` → a test stub), a ~20-line fake cookie jar, and auth obtained by invoking the real `POST /api/auth/signin` handler so `@supabase/ssr` writes genuine session cookies. The two-parallel-accepts race uses the exact `Promise.all` pattern already proven in `tests/db/concurrency.test.ts:51-54`.

## Detailed Findings

### Risk #1 — Accept/withdraw handlers, RPC invocation, error translation, auth shape

**Routes** (both `POST`, body `{ id: z.uuid() }`):

- `POST /api/booking-request/accept` — `src/pages/api/booking-request/accept.ts:11-98`
- `POST /api/booking-request/withdraw` — `src/pages/api/booking-request/withdraw.ts:11-85`
- (`POST /api/booking-request/reject` — `reject.ts:11-85` — same skeleton; covered by risk #4 surface table)

**RPC invocation** — user-session client built per-request via `createClient(context.request.headers, context.cookies)` (`accept.ts:12`), then:

```typescript
// accept.ts:54
const { data, error: rpcError } = await supabase.rpc("accept_booking_request", { request_id: requestId });
// withdraw.ts:51
const { data, error: rpcError } = await supabase.rpc("withdraw_booking_request", { request_id: requestId });
```

RPC return shapes: accept → `{ accepted, occupied, daily_limit, requested }` (`supabase/migrations/20260605094725_accept_booking_request.sql:15-20`); withdraw → `{ withdrawn, status }` (`supabase/migrations/20260611150000_withdraw_booking_request.sql:23-26`).

**Error translation** (switch on `rpcError.code`):

| Code | HTTP | Message (accept / withdraw) | Where |
|---|---|---|---|
| `P0002` | 404 | "Zapytanie nie istnieje" | `accept.ts:58`, `withdraw.ts:55` |
| `42501` | 403 | "Brak uprawnień do tego zapytania" | `accept.ts:60`, `withdraw.ts:56` |
| `55000` | 409 | "To zapytanie nie jest już oczekujące — odśwież stronę" (accept only) | `accept.ts:62` |
| default | 500 | "Nie udało się zaakceptować zapytania" / "Nie udało się wycofać akceptacji" | `accept.ts:64`, `withdraw.ts:59` |

**Soft outcomes** (RPC succeeds, business refusal — these are the Phase-1 money shots):

- Capacity refusal (`row.accepted === false`) → **409** with handler-hardcoded message and capacity breakdown (`accept.ts:72-82`):
  ```typescript
  error: `Limit dzienny przekroczony (${row.occupied} z ${row.daily_limit} zajęte, ${row.requested} wymaga miejsca)`,
  occupied, daily_limit, requested
  ```
  Request stays `pending`; no email enqueued.
- Withdraw of a non-accepted request (`row.withdrawn === false`) → **409** `{ error: "To zapytanie nie jest już zaakceptowane — odśwież stronę", status: row.status }` (`withdraw.ts:67-69`).

**Auth/session shape**: cookies-only — middleware (`src/middleware.ts:6-16`) builds an SSR client from request cookies and sets `context.locals.user = (await supabase.auth.getUser()).data.user ?? null`. No `Authorization`-header fallback. Handler gates: `!user` → 401 "Zaloguj się, aby zarządzać rezerwacjami"; `!user.email_confirmed_at` → 409 "Zweryfikuj adres e-mail, aby zarządzać rezerwacjami" (`accept.ts:16-25`, `withdraw.ts:16-23`). Ownership itself is checked by an RLS pre-SELECT in the handler (`accept.ts:42-46` → foreign request returns `null` → 404 at `accept.ts:50-51`) and re-checked inside the RPC under `FOR UPDATE` (accept migration `:48-58`, withdraw migration `:34-46`).

**Success responses**: 200, `{ ok: true, status: "accepted" }` (`accept.ts:97`) / `{ ok: true, status: "withdrawn_by_owner" }` (`withdraw.ts:84`).

**Email side-effect**: `enqueueDecisionEmail` (`src/lib/booking-decision.ts:14-22`) wraps the whole enqueue in try/catch — an email failure can NEVER fail the decision response. It uses the service-role admin client to insert into `email_outbox`. Missing email env config is a logged no-op. Consequence for tests: no Brevo mock is needed in Phase 1, and assertions about "email enqueued" are observable as `email_outbox` rows via the admin client.

**Concurrency posture**: there is no application-level lock — atomicity is 100% in Postgres (fixed lock order: zagroda row `FOR UPDATE` first, then request row). The handler adds nothing to the guarantee; the HTTP test's job is to prove the handler doesn't *subtract* from it (miscall, swallowed error, skipped RPC).

### Risk #4 — Request-detail surfaces, service-role usage, ownership checks

**Full surface inventory** (which surfaces can expose teacher contact data — `guest_email`, `guest_phone`):

| Surface | Auth | Contact data exposed? | Ownership check |
|---|---|---|---|
| `POST /api/booking-request` (`index.ts:16-69`) | none | No (stored, not echoed; response `{ ok: true }`) | RLS INSERT `with check (status='pending')` |
| `POST .../accept`, `.../reject`, `.../withdraw` | session + verified email | No (context fetch only, not returned) | handler 401/409 → RLS pre-SELECT → RPC `42501` re-check |
| `POST .../cancel` (`cancel.ts:13-58`) | none | No (returns only `{ cancelled, status }`) | capability token (see risk #5) |
| `GET /dashboard/zapytania` (`index.astro:13-33`) | session (middleware redirect) | guest_name only in list | owner's zagroda fetched by `owner_id`, then `.eq("zagroda_id", zagroda.id)` |
| `GET /dashboard/zapytania/[id]` (`[id].astro:25-55`) | session (middleware redirect) | **Yes — all fields incl. email + phone** | **RLS only** — no explicit handler check; foreign id → `null` → 404 |
| `GET /anuluj?token=` (`anuluj.astro`) | none | No (GET is side-effect-free, no DB query) | token shape (UUID regex) only |

**The governing RLS policy** (`supabase/migrations/20260605090307_domain_schema.sql:145-152`):

```sql
create policy "owners can read booking requests of their zagroda"
  on public.booking_requests for select to authenticated
  using (exists (select 1 from public.zagrody z
                 where z.id = zagroda_id and z.owner_id = (select auth.uid())));
```

No UPDATE/DELETE policies exist on `booking_requests` by design (comment at `domain_schema.sql:64-68`) — all transitions go through SECURITY DEFINER RPCs.

**Service-role client**: factory `src/lib/supabase-admin.ts:17-26`, with the module-comment rule "NEVER import this module from any user-facing data path" (`supabase-admin.ts:6-8`). Verified usage in request-serving paths: only `src/pages/api/booking-request/index.ts:79-94` (resolves owner email via auth admin API for the notification — reads zagroda name + owner_id, never `booking_requests`) and `src/lib/booking-decision.ts:16` (email enqueue, message already built). **No HTTP surface serves request data through a service-role client** — RLS is live everywhere data is read.

**What the two negative identities get** (the exact Phase-1 assertions):

- Authenticated *foreign* owner: `GET /dashboard/zapytania/[foreign-id]` → 404; `POST accept/reject/withdraw` with foreign id → **404** (RLS pre-SELECT hides the row before the RPC is called — note: 404, not 403; the 403 path only triggers if the RPC is reached, which RLS prevents).
- Anonymous: `/dashboard/*` → 302 redirect to `/auth/signin` (middleware `src/middleware.ts:4-22`); decision APIs → 401.

### Risk #5 — Cancel token, server-side validation parity, unauthenticated email triggers

**Token lifecycle**: issued app-side at creation — `crypto.randomUUID()` at `src/pages/api/booking-request/index.ts:57` (DB column also has `gen_random_uuid()` default + unique index, cancel migration `:21`); delivered as `/anuluj?token=<uuid>` link in the guest confirmation email (`src/lib/booking.ts:102`); verified by `cancel_booking_request(p_token)` (`supabase/migrations/20260608100000_guest_cancel_booking_request.sql:24-70`) — lookup **by token** under `FOR UPDATE`, unknown token → `{ cancelled: false, status: null }`, only `pending` transitions to `cancelled_by_guest`, anything else returns the current status untouched.

**HTTP contract of `POST /api/booking-request/cancel`** (`cancel.ts:43-56`) — all soft outcomes are **HTTP 200**:

| Input | Response |
|---|---|
| valid token, pending request | 200 `status: "cancelled"` (request → `cancelled_by_guest`) |
| unknown/forged token | 200 `status: "not_found"` — no data, no existence signal |
| already cancelled | 200 `status: "already_cancelled"` (idempotent) |
| accepted request | 200 `status: "already_accepted"` — guest cannot cancel an accepted booking |
| withdrawn | 200 `status: "already_withdrawn"` |
| RPC failure | 500 "Nie udało się anulować zapytania" |

Cancel **does not free capacity** (only flips status of a `pending` row; occupancy is recomputed from `accepted` rows at accept time) and **sends no email**. Tests at the RPC layer already exist: `tests/db/guest-cancel.test.ts` (valid/idempotent/accepted-refusal/unknown-token/immutability cases) — the HTTP test only needs to prove the route wires token → RPC → status string faithfully, plus the malformed-token parse path.

**Server-side validation parity — core deliverable: there are NO client-only rules.** Client (`src/components/booking/BookingRequestForm.tsx:64-76`) and server (`index.ts:29-32`) parse the **same** `bookingRequestSchema` (`src/lib/booking.ts:41-65`): uuid `zagroda_id`/`turnus_id`, `trip_date` real calendar date + today-or-future refinement, `participants_count` int 1–1000 (coerced), `guest_name` 1–120 trimmed, `guest_email` zod email, `guest_phone` Polish format (`isValidPlPhone`, `booking.ts:64`). Server-only extras: zagroda must exist AND `is_published=true` (`index.ts:39-50`, else 422 "Zagroda niedostępna"); turnus-belongs-to-zagroda via FK + the published-zagroda join. So the Phase-1 "bypass the client" test asserts the server alone rejects past dates / zero participants / malformed email with 422, even though the rule source is shared — the test proves the *server actually runs the parse*, guarding against a future refactor that drops it.

**Email triggers without auth**:

| Route | Auth | Emails | Rate limit / captcha / dedup |
|---|---|---|---|
| `POST /api/booking-request` | **none** | **2 per call** (guest confirmation + owner notification, `index.ts:66-116`) | **none** |
| `POST /api/booking-request/cancel` | none | 0 | n/a |
| `POST /api/dev/test-email` | session required | 1 (to caller's own address) | none — documented accepted risk (`test-email` route, comment at line ~12) |

The quota-drain math: Brevo free tier 300/day → ~150 anonymous booking POSTs exhaust it. This is the documented accepted risk from CLAUDE.md.scaffold; Phase 1's deliverable here is the **documented decision** the test-plan asks for (test-plan §2, risk #5 "a documented decision exists on quota-draining endpoints"), not necessarily a rate-limiter.

### Risk #6 — Publication gate, OAuth merge guard, middleware vs handler split

**Publication gate** (unverified owner must not publish):

- Primary enforcement **in the DB**: `set_zagroda_published()` checks `email_verified()` and raises errcode `55000` / `'email_not_verified'` (`supabase/migrations/20260605200000_zagroda_profile_publication.sql:137-142`).
- HTTP mapping: `src/pages/api/zagroda/publish.ts:43-45` — unverified owner gets **409 "Zweryfikuj adres e-mail, aby opublikować zagrodę"**.

**OAuth merge guard** (anti-takeover): decision logic in `src/lib/auth/oauth-guard.ts:44-51` (verdicts `allow` / `block_collision` / `block_unavailable`); enforced in `src/pages/api/auth/callback.ts:39-99` — collision check runs only for `email_verified=false` OAuth identities, calls the `password_account_exists()` RPC, and is **fail-closed** since the S-07 hardening (an RPC error blocks with a generic "temporarily unavailable" message rather than allowing).

**Middleware vs handler split** (`src/middleware.ts`, 22 lines, single concern):

- Middleware: builds the SSR Supabase client from cookies, sets `locals.user` from `supabase.auth.getUser()` (server-side verification, not cookie trust), and **redirects only `/dashboard*` page routes** (`middleware.ts:4, 18-22`).
- API routes get `locals.user` but **no middleware refusal** — every API handler re-checks `locals.user` itself.
- **Test-design consequence**: a direct handler call without the middleware leaves `locals.user` undefined — which the handlers treat as anonymous (401), masking the real session path. To test "authenticated owner" at the HTTP layer, the harness must run `onRequest` → handler as a sequence (see harness section). This is the precise sense in which "the handler relies on middleware having run."

**Existing coverage at lower layers** (do not duplicate): unit truth-table for the guard logic (`tests/unit/`, oauth-guard), db tests for `set_zagroda_published` / `email_verified` / `password_account_exists` gates (`tests/db/`). The HTTP layer (409 mapping, callback redirect codes, middleware wiring) has **zero tests today** — that's the Phase-1 gap.

### Harness for cookbook §6.3 — how to actually write these tests

**Existing infrastructure** (verified):

- `vitest.config.ts` — vitest 4.1.8, `environment: "node"`, `include: ["tests/**/*.test.ts"]` (a new `tests/api/` is auto-included), `globalSetup: "tests/helpers/global-setup.ts"`, **`fileParallelism: false`** (shared DB), testTimeout 30s, alias `@` → `./src`.
- `tests/helpers/global-setup.ts:25-49` — shells `npx supabase status -o json`, exposes `supabaseUrl` / `supabaseAnonKey` / `supabaseServiceRoleKey` / `supabaseDbUrl` via vitest `provide`/`inject`; refuses non-local DBs without `ALLOW_REMOTE_TEST_DB=1` (`:85`).
- `tests/helpers/supabase.ts` — `createAdminClient` (`:18`) seeds fixtures RLS-bypassed; `createOwnerClient` (`:35`) does `auth.admin.createUser({ email_confirm: true })` + `signInWithPassword`; fresh owner + zagroda per iteration via `uniqueEmail` (`:100`); direct `pg` for `auth.*` surgery (`:60-67`).
- The exact concurrency fixture to lift one layer up: `tests/db/concurrency.test.ts:51-54` — `Promise.all` of two `rpc("accept_booking_request")` calls from two sessions, 20 iterations.

**Stack facts**: astro 6.3.1, `@astrojs/cloudflare` 13.6.0, `output: "server"`, typed env schema in `astro.config.mjs:17-27` with exactly 7 server vars (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`). Across all of `src/pages/api/` only two virtual modules appear: `astro:env/server` (5 files) and `astro:middleware` (middleware only). Handlers consume only `context.request`, `context.cookies` (`get/set/delete`, plus `headers()` in `auth/callback.ts:92`), `context.locals.user`, `context.locals.cfContext` (optional — degrades to `undefined`, `src/lib/cf.ts:4-11`), `context.redirect`.

**Recommended option (a): direct handler import composed with the real middleware.**

```typescript
import { onRequest } from "../../src/middleware";        // real middleware body
import { POST } from "../../src/pages/api/booking-request/accept";
const response = await onRequest(ctx, () => POST(ctx));  // real getUser() against local GoTrue
```

What makes it work in this repo:

1. Two vitest aliases resolve the virtual modules: `astro:middleware` → `astro/virtual-modules/middleware.js` (verified export of `defineMiddleware`, an identity wrapper — the real middleware body runs), and `astro:env/server` → a small `tests/helpers/astro-env.ts` stub exporting the 7 names from `inject()`/`process.env`.
2. The `APIContext` shell is `{ request, url, cookies, locals: {}, redirect }`; a ~20-line fake cookie jar covers the `get/set/delete/headers()` subset actually used.
3. **Auth without cookie forgery**: invoke the real `POST /api/auth/signin` handler (`src/pages/api/auth/signin.ts`) with `FormData`; `@supabase/ssr` writes the session into the jar itself (`createServerClient.js:45-63` in the installed package), chunked cookies and all. Serialize the jar into the `Cookie` header of subsequent requests. Cookie name for the local stack (`http://127.0.0.1:54321`): **`sb-127-auth-token`** (supabase-js `storageKey` derivation, chunked at 3180 chars into `.0`, `.1`, …).
4. **Concurrency**: `Promise.all([run(ctxA), run(ctxB)])` with two cookie jars — the race resolves in Postgres exactly as in the proven RPC-level test.

Cost: one helper file (~80–120 lines) + 2 vitest aliases; no new processes; runs inside the existing `npm test` flow.

**Rejected options**: (b) real `astro dev`/`preview` server + fetch — highest fidelity but 5–20s cold start per run, Windows child-process-tree kill, missing `.dev.vars` for the workerd path, and the extra fidelity (routing table, workerd runtime) doesn't cover any §2 risk; (c) Astro Container API — present in 6.3.1 (`experimental_AstroContainer`, supports `routeType: "endpoint"`) but middleware injection needs an undocumented `manifest.middleware` shim and the virtual-module plumbing from (a) is still required — strictly dominated. Also rejected: `getViteConfig` from `astro/config`, because it pulls `@cloudflare/vite-plugin` (workerd) into the vitest pipeline.

**Known blockers / accepted gaps for option (a)** (name these in the plan):

1. Env-stub drift — `tests/helpers/astro-env.ts` must mirror `astro.config.mjs`'s schema; cross-link with a comment. Missing email vars are safe (try/catch at `booking-decision.ts:14-22`).
2. Bypassed by design: Astro's routing table / 404s, `cfContext.waitUntil` (email drain runs inline or not at all — outbox row insert is still observable), prod-build behavior. These stay in §7 negative space / the Phase-2 e2e.
3. If a test ever hand-builds the auth cookie (e.g. expired-session negative test), use `@supabase/ssr`'s exported `createChunks` — don't reimplement chunking.
4. Keep `fileParallelism: false` — `tests/api/` shares the one local DB with `tests/db/`.

## Code References

- [src/pages/api/booking-request/accept.ts:11-98](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/pages/api/booking-request/accept.ts#L11-L98) — accept handler: auth gates (16-25), RLS pre-SELECT (42-46), RPC call (54), error switch (56-65), capacity 409 (72-82), success (97)
- [src/pages/api/booking-request/withdraw.ts:11-85](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/pages/api/booking-request/withdraw.ts#L11-L85) — withdraw handler: RPC (51), non-accepted 409 (67-69), success (84)
- [src/pages/api/booking-request/index.ts:16-69](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/pages/api/booking-request/index.ts#L16-L69) — guest creation: server-side zod parse (29-32), published check (39-50), token issuance (57), email enqueue (66-116)
- [src/pages/api/booking-request/cancel.ts:13-58](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/pages/api/booking-request/cancel.ts#L13-L58) — token verification route, soft-outcome status strings (43-56)
- [src/pages/api/zagroda/publish.ts:43-45](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/pages/api/zagroda/publish.ts#L43-L45) — `55000` → 409 publication-gate mapping
- [src/pages/api/auth/callback.ts:39-99](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/pages/api/auth/callback.ts#L39-L99) — merge-guard enforcement (fail-closed)
- [src/lib/auth/oauth-guard.ts:44-51](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/lib/auth/oauth-guard.ts#L44-L51) — guard verdict logic
- [src/middleware.ts](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/middleware.ts) — session bootstrap + `/dashboard*`-only redirect
- [src/lib/booking.ts:41-65](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/lib/booking.ts#L41-L65) — shared `bookingRequestSchema`; cancel link at :102; email builders at :178-192, :219-232
- [src/lib/booking-decision.ts:14-22](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/lib/booking-decision.ts#L14-L22) — best-effort email enqueue (never fails the response)
- [src/lib/supabase-admin.ts:6-26](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/lib/supabase-admin.ts#L6-L26) — service-role factory + "never user-facing" rule
- [src/pages/dashboard/zapytania/[id].astro:25-55](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/pages/dashboard/zapytania/%5Bid%5D.astro#L25-L55) — contact-data detail page (RLS-only ownership)
- [src/components/booking/BookingRequestForm.tsx:64-76](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/src/components/booking/BookingRequestForm.tsx#L64-L76) — client parse of the same schema
- [supabase/migrations/20260605090307_domain_schema.sql:134-152](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/supabase/migrations/20260605090307_domain_schema.sql#L134-L152) — booking_requests RLS policies
- [supabase/migrations/20260605094725_accept_booking_request.sql](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/supabase/migrations/20260605094725_accept_booking_request.sql) — accept RPC (lock order, ownership `42501`, capacity soft outcome)
- [supabase/migrations/20260611150000_withdraw_booking_request.sql](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/supabase/migrations/20260611150000_withdraw_booking_request.sql) — withdraw RPC
- [supabase/migrations/20260608100000_guest_cancel_booking_request.sql:24-70](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/supabase/migrations/20260608100000_guest_cancel_booking_request.sql#L24-L70) — cancel RPC (token lookup under lock, pending-only)
- [supabase/migrations/20260605200000_zagroda_profile_publication.sql:137-142](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/supabase/migrations/20260605200000_zagroda_profile_publication.sql#L137-L142) — publication gate in `set_zagroda_published()`
- [vitest.config.ts](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/vitest.config.ts) — `fileParallelism: false`, globalSetup, include glob
- [tests/helpers/supabase.ts](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/tests/helpers/supabase.ts) — admin/owner client factories, fixture seeding
- [tests/db/concurrency.test.ts:51-54](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/tests/db/concurrency.test.ts#L51-L54) — the `Promise.all` race pattern to lift to the HTTP layer
- [tests/db/guest-cancel.test.ts](https://github.com/webpush-it/zagroda-hub/blob/d4dcc218212d17ff3e2747efe31ccb436360053c/tests/db/guest-cancel.test.ts) — existing RPC-level cancel coverage (don't duplicate)

## Architecture Insights

- **Defense-in-depth on owner decisions**: handler fast-path (401/409) → RLS-scoped pre-SELECT (foreign → 404 before the RPC) → SECURITY DEFINER RPC ownership re-check (`42501` → 403). Consequence for tests: the *foreign-owner* negative case asserts **404**, not 403 — the 403 path is only reachable if RLS is bypassed, which is itself a useful invariant.
- **Soft-outcome vs error-code split**: business refusals (capacity exceeded, not-pending, not-accepted, token not found) are *successful RPC calls* returning flags, mapped to 409 (decisions) or 200-with-status (guest cancel). Postgres errcodes are reserved for not-found/permission/state violations. Tests must not conflate the two.
- **Email isolation invariant**: every decision/creation email enqueue is try/catch-wrapped and uses the outbox; HTTP responses are email-independent. Phase-1 tests need no provider mock — outbox rows are the observable.
- **RLS-first posture**: no UPDATE/DELETE policies on `booking_requests`; the dashboard detail page deliberately has no app-level ownership check (RLS is the single source of truth). The HTTP-layer IDOR test is precisely the regression net for "someone drops the RLS policy or switches a read to the admin client."
- **Single shared validation schema** (`bookingRequestSchema`) eliminates client/server drift today; the server-parse test guards the *wiring*, not the rules.
- **Middleware is intentionally thin** (session bootstrap + page redirects); API authorization is per-handler. Any harness that skips `onRequest` tests an anonymous world — composing the real middleware is what makes these tests "HTTP-surface" rather than glorified unit tests.

## Historical Context (from prior changes)

- `context/archive/2026-06-05-booking-schema-and-overbooking-guard/` — established the accept RPC, lock order, and the RPC-level concurrency test pattern.
- `context/archive/2026-06-11-gated-acceptance-with-overbooking-guard/` — handler-side gating (verified-email 409, error translation).
- `context/archive/2026-06-11-owner-undo-acceptance/` — withdraw RPC + handler (F2 guard, F3 withdraw gate per review fixes).
- `context/archive/2026-06-08-guest-booking-request/` — guest creation endpoint, shared zod schema, cancel-token issuance.
- `context/archive/2026-06-11-oauth-account-merge-guard/` — merge guard implementation; S-07 hardening made the callback fail-closed.
- `context/archive/2026-06-07-transactional-email-channel/` — outbox + best-effort enqueue posture.
- `context/foundation/lessons.md` — **lock-order lesson**: `booking_requests.zagroda_id` is load-bearing immutable; any new write path must preserve it. Phase-1 tests don't add write paths, but the harness must not seed/mutate rows in ways that violate it (use the existing helpers).

## Related Research

- `context/foundation/test-plan.md` §2–§3 — the risk map and Phase-1 brief this research grounds.
- No prior `research.md` artifacts exist under `context/changes/**` (this is the first); archived changes contain plans only.

## Open Questions

1. **Capacity-message oracle**: the handler hardcodes `"Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)"` (`accept.ts:76`). The test-plan warns against lifting the oracle from handler code and says to take "X z Y zajęte" from PRD US-01. The plan phase must check the PRD's exact wording and decide the assertion strength (substring `"z … zajęte"` + structured fields vs full-string match).
2. **Malformed (non-UUID) cancel token**: the route zod-parses `{ token: uuid }` before the RPC; the exact response for a *syntactically invalid* token (400 from parse vs 200 `not_found`) was reported inconsistently and should be pinned by reading `cancel.ts:20-40` during planning — the test should cover both malformed and well-formed-but-unknown tokens regardless.
3. **Quota-drain decision**: Phase 1's risk-#5 deliverable includes "a documented decision exists on quota-draining endpoints." Rate limiting `POST /api/booking-request` is a product/infra decision (Cloudflare-level vs app-level), not a test — the plan should scope this as a documented-decision checklist item, not implementation.
4. **`getViteConfig` interaction** (harness): using Astro's own `getViteConfig` in vitest would resolve virtual modules natively but pulls `@cloudflare/vite-plugin` into the test pipeline — not executed during research; the alias-stub approach avoids it, but if the plan prefers `getViteConfig`, it must be spiked first.
