# Guest Booking Request (S-03) Implementation Plan

## Overview

Let an unauthenticated teacher submit a booking request from the public zagroda page, receive a confirmation email containing a tokenized self-cancel link, and cancel that request while it is still `pending`. Every new request also emails the zagroda owner ("masz nowe zapytanie", reply-to = teacher). This is the roadmap slice **S-03** (FR-004, FR-011, FR-015, US-02) and the last prerequisite for the guiding-star slice S-04 (owner acceptance).

The slice is mostly wiring of patterns that already exist in the repo. The single net-new security-sensitive primitive is the **tokenized guest-cancel transition**, implemented as a `SECURITY DEFINER` function mirroring `accept_booking_request`.

## Current State Analysis

What exists today (verified against the codebase):

- **Schema (F-01 + S-01).** `public.booking_requests` exists with columns `id, zagroda_id, turnus_id, trip_date, participants_count, status, guest_name, guest_email, guest_phone, created_at, updated_at` (`supabase/migrations/20260605090307_domain_schema.sql:43-56`). `status` is the enum `request_status = pending|accepted|rejected|cancelled_by_guest|withdrawn_by_owner` (`:9-15`) — `cancelled_by_guest` is pre-enumerated but no code sets it yet. `participants_count` is `>0` and `<=1000`.
- **RLS posture (F-01).** Anon AND authenticated may `INSERT` only when `status='pending'` (`:137-143`); owner-only `SELECT` protects teacher contact data (`:145-152`); **no UPDATE/DELETE policies by design** — every state transition goes through a `SECURITY DEFINER` function (`:65-66` comment). `tests/db/rls.test.ts` asserts exactly this contract, including "anon can INSERT a pending request" with a **bare `.insert()` (no `.select()`)** because anon has no SELECT policy.
- **Accept primitive (the template).** `accept_booking_request(request_id)` (`supabase/migrations/20260605094725_accept_booking_request.sql:14-100`) is `SECURITY DEFINER`, `set search_path=''`, locks the **zagroda row first, then the request row** (deadlock-free order), re-checks status under lock, and is granted to `authenticated` only.
- **There is no `cancel_token` column and no guest-cancel RPC.** Both are net-new here.
- **Zagroda detail page (S-02).** `src/pages/zagrody/[id].astro` is pure Astro; it loads `name, description, voivodeship, city, daily_limit, photo_path, turnusy(id,label,start_time,end_time)` filtered by `is_published=true` and formats turnusy as `HH:MM–HH:MM`. A React island slots in after the turnusy `</section>` (~`:108`).
- **Email channel (F-02).** `sendTransactionalEmail(deps, msg)` (`src/lib/email/index.ts`) where `deps = { admin: createAdminClient(), config: getEmailConfig(), waitUntil }` and `msg = { to, subject, html, replyTo? }`. Wrap bodies with `renderEmailLayout({title, bodyHtml})`; escape guest data with `escapeHtml()` (`src/lib/email/layout.ts`). No-op (returns `{enqueued:false}`) when unconfigured — callers never break. The smoke caller `src/pages/api/dev/test-email.ts:36-51` shows the exact call shape and the `waitUntil` drain pattern.
- **Owner email is not anon-readable.** The owner-notification recipient must be fetched server-side with the **admin client** (`createAdminClient()`, `src/lib/supabase-admin.ts`): read `zagrody.owner_id`, then resolve the email via the GoTrue admin API `auth.admin.getUserById(owner_id)` — the admin client is a `public`-schema PostgREST client and **cannot** `.from("auth.users")`. The email-outbox tables are service-role only anyway.
- **API + form conventions.** JSON API route pattern in `src/pages/api/zagroda/publish.ts` (local `json()` helper, `createClient(headers, cookies)` null-guard → 503, `context.locals.user`, zod `safeParse` → 422 with field errors, Polish copy, never leak raw DB errors). Form pattern in `src/components/zagroda/ZagrodaProfileForm.tsx`: React island, client-side `safeParse`, `fetch` to the API, branch on `res.status===422 && data.fieldErrors`. Reusable `fieldErrorsFromZod()` lives in `src/lib/zagroda.ts:44-52`.
- **Validation helpers.** Strict `YYYY-MM-DD` + not-in-past date parsing exists in `src/pages/katalog.astro:23-28` (extractable). **No Polish phone validator exists yet** — net-new.
- **Tests.** vitest harness: `tests/db/*.test.ts` (real Postgres via `pg`, helpers `createAnonClient/createAdminClient/createOwnerClient/seedZagroda/seedBookingRequest/uniqueEmail` in `tests/helpers/supabase.ts`) and `tests/unit/*.test.ts`. `npm test` runs `vitest run`.
- **Deploy.** `npm run deploy` = `build && db:push && wrangler deploy` (migrations ship with the worker, never behind it — see `lessons.md`).

## Desired End State

A guest on `zagrody/[id]` fills a booking form (turnus, date, participants, name, email, phone), submits, and sees an inline confirmation. They receive a "potwierdzenie wysłania" email containing a `…/anuluj?token=<uuid>` link; the owner receives a "nowe zapytanie" email whose reply-to is the teacher's address. Visiting the cancel link shows a generic confirmation prompt ("Czy na pewno chcesz anulować to zapytanie?") and a confirm button — no per-request detail is shown, since an anon visitor cannot read `booking_requests` (owner-only SELECT) and this slice adds no anon read path; the guest already has the request context from the email they clicked. Confirming transitions the request `pending → cancelled_by_guest` (idempotent/safe for already-accepted or already-cancelled cases). The request appears in `booking_requests` as `pending` immediately and is visible to the owner via existing RLS.

Verify: `npm test` green (new db + unit tests); `npm run build` + `npm run lint` clean; manual end-to-end submit → both emails enqueued → cancel link works and is GET-safe.

### Key Discoveries:

- `accept_booking_request` (`…20260605094725…:14-100`) is the exact template for the new cancel RPC (SECURITY DEFINER, `search_path=''`, row lock + re-check under lock, grant pattern).
- Anon insert must be a bare `.insert()` — no `.select()` (anon has no SELECT policy); `tests/db/rls.test.ts:guestInsert` shows the payload shape.
- `lessons.md` "Lock-order" rule: the cancel RPC must treat `zagroda_id/turnus_id/trip_date` as immutable and must not break the zagroda-then-request lock order.
- The new column must be `NOT NULL DEFAULT gen_random_uuid()` so existing anon-insert paths and `seedBookingRequest` that omit the token keep working; the submit route still passes an explicit TS-generated token so it knows the value without reading the row back.

## What We're NOT Doing

- **No owner-side acceptance/rejection UI** — that is S-04. This slice only creates `pending` requests and the guest-cancel transition.
- **No submit-time overbooking/availability gate.** The daily-limit rule stays solely at owner-accept (FR-014). The form does not call `catalog_zagrody` to block or warn.
- **No hashed/encrypted cancel token** — plaintext `uuid` is the chosen model (low-stakes pending-request cancel).
- **No guest account, no guest panel, no request tracking** — communication is email + token only (PRD Non-Goals).
- **No SMS/push** — transactional email only.
- **No changes to the auth-email path** (Supabase native mailer) or to `accept_booking_request`.
- **No new RLS UPDATE/DELETE policy** — cancellation goes through the `SECURITY DEFINER` RPC, preserving the F-01 posture.

## Implementation Approach

Bottom-up: land the schema + cancel primitive first (with DB tests proving the security contract), then the submit API + validators (unit-tested), then the form island, then the cancel page that the confirmation email already links to. Submit uses the **request-scoped anon client** through the existing F-01 anon-INSERT policy; the token is generated in TS (`crypto.randomUUID()`) and inserted explicitly so no read-back is needed. Owner-email lookup and both email enqueues happen server-side in the same route using the **admin client** + `sendTransactionalEmail`, draining via `waitUntil`. Cancellation is GET-safe: the link renders a confirm page; an explicit POST calls `cancel_booking_request(token)`.

## Critical Implementation Details

- **Lock-order & immutability (load-bearing).** `cancel_booking_request` mutates `booking_requests`; per `lessons.md` it must NOT touch `zagroda_id/turnus_id/trip_date` and must keep the zagroda-then-request lock discipline. Cancel only needs the **request row** lock (it never reads occupancy), which is a strict subset of accept's lock set, so no deadlock cycle with `accept_booking_request` is introduced. Lock the request row `FOR UPDATE` and re-check `status='pending'` under the lock so a concurrent owner-accept and guest-cancel resolve to exactly one winner.
- **Anon insert is read-back-blind.** Insert with a bare `.insert({...})` (no `.select()`); the route already holds the generated token, so it needs nothing back. A chained `.select()` would surface a false error under anon RLS.
- **New column default is mandatory.** `cancel_token uuid NOT NULL DEFAULT gen_random_uuid()` — without the default, existing anon inserts and `seedBookingRequest` (which omit the column) break, and the `rls.test.ts` anon-insert assertion fails.
- **Email is best-effort, never blocks the response.** Mirror `test-email.ts`: enqueue + `waitUntil(drain)`; a null admin/config is a logged no-op. Submission success must not depend on email enqueue success.

## Phase 1: Schema — cancel token + guest-cancel RPC

### Overview

Add the cancel-token column and the `SECURITY DEFINER` cancellation function, with grants and regenerated DB types. Prove the security contract with DB tests.

### Changes Required:

#### 1. Migration — cancel token column + cancel RPC

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_guest_cancel_booking_request.sql` (new)

**Intent**: Add a unguessable per-request cancel token and the only sanctioned path for a guest to cancel a still-pending request, following the F-01 RLS-first posture (no UPDATE policy; transition via function).

**Contract**:
- `alter table public.booking_requests add column cancel_token uuid not null default gen_random_uuid();` plus a unique constraint/index on `cancel_token`.
- `create function public.cancel_booking_request(p_token uuid) returns table (cancelled boolean, status public.request_status) language plpgsql security definer set search_path = ''`. Behavior: look up the request by `cancel_token`; lock that row `FOR UPDATE`; if not found return `(false, null)`; if `status='pending'` set `status='cancelled_by_guest'` (let the existing `set_updated_at` trigger stamp `updated_at`) and return `(true, 'cancelled_by_guest')`; otherwise return `(false, <current status>)` so the caller can message "już zaakceptowane"/"już anulowane". Must not modify `zagroda_id/turnus_id/trip_date`.
- Grants: `revoke execute … from public;` then `grant execute on function public.cancel_booking_request(uuid) to anon, authenticated;` (guests are anon).

#### 2. Regenerated database types

**File**: `src/db/database.types.ts`

**Intent**: Reflect the new column and RPC so TS callers are typed.

**Contract**: Run `npm run db:reset` (or `db:push`) then `npm run db:types`. Expect `booking_requests.Row/Insert/Update` to gain `cancel_token: string`, and a new `Functions.cancel_booking_request` entry with `Args: { p_token: string }` and the returns row shape.

#### 3. DB tests for the cancel primitive

**File**: `tests/db/guest-cancel.test.ts` (new)

**Intent**: Lock the security-sensitive transition and the immutability/lock-order contract.

**Contract**: Using the `tests/helpers/supabase.ts` helpers, assert: (a) `cancel_booking_request` with a valid token on a `pending` request returns `cancelled=true` and the row becomes `cancelled_by_guest`; (b) a second call with the same token returns `cancelled=false` with status `cancelled_by_guest` (idempotent/no re-cancel); (c) cancelling an `accepted` request returns `cancelled=false, status=accepted` and does not change it; (d) an unknown/random token returns `cancelled=false`; (e) the cancel path does not change `zagroda_id/turnus_id/trip_date`; (f) the existing anon `.insert()` (without supplying `cancel_token`) still succeeds (default fires).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset`
- Types regenerate without diffnoise beyond the new column/RPC: `npm run db:types`
- New + existing DB tests pass: `npm test`
- Lint/type check passes: `npm run lint`

#### Manual Verification:

- In local Studio, a manually inserted `pending` request can be cancelled via `select * from cancel_booking_request('<token>')` and flips to `cancelled_by_guest`; a second call is a no-op.
- `accept_booking_request` and `rls.test.ts` behavior are unchanged (no regression in the F-01 contract).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Submit API + validation helpers

### Overview

Add booking validation helpers (zod schema, lenient PL-phone, future-date) and the `/api/booking-request` POST route that inserts the request via anon RLS with a TS-generated token, then enqueues the guest-confirmation and owner-notification emails server-side.

### Changes Required:

#### 1. Booking validation helpers

**File**: `src/lib/booking.ts` (new)

**Intent**: Single source of truth for the booking-request shape, reused by both the API route (server) and the form island (client).

**Contract**: Export `bookingRequestSchema` (zod): `zagroda_id` uuid, `turnus_id` uuid, `trip_date` (strict `YYYY-MM-DD`, must be today-or-future — reuse the `katalog.astro` date logic, extracted here), `participants_count` int `>=1` and `<=1000`, `guest_name` trimmed `1..120`, `guest_email` `z.email()`, `guest_phone` via a lenient PL validator. Export a `normalizePhone`/`isValidPlPhone` helper: strip spaces/dashes/parens, accept optional `+48`/`0048`/`48` prefix followed by exactly 9 digits. Reuse `fieldErrorsFromZod` from `src/lib/zagroda.ts` (import, don't duplicate).

#### 2. Submit API route

**File**: `src/pages/api/booking-request/index.ts` (new); `export const prerender = false`

**Intent**: Validate and persist a guest request, then fire the two emails without blocking the response.

**Contract**: `POST` (uppercase export) following `api/zagroda/publish.ts` conventions: local `json()` helper; `createClient(request.headers, cookies)` with null-guard → 503; parse JSON body (catch → 400); `bookingRequestSchema.safeParse` → 422 with `fieldErrors`. Then verify the target zagroda is published: `supabase.from("zagrody").select("id").eq("id", data.zagroda_id).eq("is_published", true).maybeSingle()` → if null, return a Polish 404/422 ("Zagroda niedostępna"). This closes the gap that the anon INSERT policy checks only `status='pending'`, not `is_published`, so a crafted POST could otherwise create a pending request against a draft zagroda. On success: generate `const cancel_token = crypto.randomUUID()`; **bare** `await supabase.from("booking_requests").insert({ ...data, cancel_token })` (no `.select()`); map a turnus/zagroda FK or RLS failure to a Polish 422/409, never leak raw error. Then, best-effort (must not fail the response): with `createAdminClient()` read `admin.from("zagrody").select("name, owner_id")`, then resolve the owner's email via the GoTrue admin API `admin.auth.admin.getUserById(owner_id)` (**not** `.from("auth.users")` — the `auth` schema is not exposed over PostgREST and is absent from `database.types.ts`; no `getUserById` caller exists yet, so this is net-new). Then call `sendTransactionalEmail` twice — guest confirmation (`to`=guest, body includes `<site>/anuluj?token=<cancel_token>`, built from request origin/`Astro` URL) and owner notification (`to`=owner email, `replyTo`=guest email, body summarizes date/turnus/participants/contact). Wrap bodies in `renderEmailLayout` and `escapeHtml()` all guest-supplied fields. Drain via `waitUntil`. Return `json({ ok: true })` on success.

#### 3. Unit tests for validators + email bodies

**File**: `tests/unit/booking.test.ts` (new)

**Intent**: Verify validation edges and that guest data is escaped in email HTML.

**Contract**: Assert the PL-phone helper accepts `600 700 800`, `+48 600700800`, `0048-600-700-800` and rejects too-short/too-long/letters; `trip_date` rejects past dates and bad formats; `participants_count` bounds; and that the email-body builder escapes a `guest_name` containing `<script>`/`&`. (If body builders are inlined in the route, extract a small pure `buildBookingEmails()` into `src/lib/booking.ts` so it is unit-testable.)

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type check + lint pass: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `curl`/REST POST a valid body → `200 {ok:true}` and a `pending` row appears; invalid phone/past date → `422` with field errors in Polish.
- With email env configured locally, both emails land (or are enqueued in `email_outbox`); with email env unset, the route still returns success (no-op).
- Owner email's reply-to is the teacher's address; guest email contains a working `/anuluj?token=…` URL.
- A POST targeting an unpublished/draft zagroda id is rejected ("Zagroda niedostępna"), no row created.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Booking form island

### Overview

A React island on the zagroda detail page that collects the request, validates client-side with the shared schema, and POSTs to the submit route.

### Changes Required:

#### 1. Booking form component

**File**: `src/components/booking/BookingRequestForm.tsx` (new)

**Intent**: The guest-facing form; mirrors `ZagrodaProfileForm.tsx` structure (state, client validation, fetch, field/server-error/success branches).

**Contract**: Props: `zagrodaId`, `turnusy: {id,label,time}[]`, optional `dailyLimit` (display hint only). Fields: turnus `<select>` (required), date `<input type="date" min={today}>`, participants number, name, email, phone, reusing the shared `FormField`/`SubmitButton` UI components. On submit: `bookingRequestSchema.safeParse` client-side; `fetch("/api/booking-request", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(data) })`; branch on `res.status===422 && data.fieldErrors` → field errors, else `!res.ok` → generic Polish server error, else show success state ("Zapytanie wysłane — sprawdź e-mail, znajdziesz tam link do anulowania."). Usable mobile-portrait, one-handed.

#### 2. Mount the island on the zagroda page

**File**: `src/pages/zagrody/[id].astro`

**Intent**: Render the form below the turnusy section, passing the already-loaded turnusy + id.

**Contract**: Import and render `<BookingRequestForm client:load zagrodaId={id} turnusy={turnusy} dailyLimit={daily_limit} />` after the turnusy `</section>` (~`:108`). No new data fetch — reuse the page's existing query result.

### Success Criteria:

#### Automated Verification:

- Build + lint pass: `npm run build` and `npm run lint`

#### Manual Verification:

- On a published zagroda page (mobile-portrait), the form renders, client-side validation shows inline Polish errors, a valid submit shows the success state and creates a `pending` request.
- Selecting a turnus, a future date, and a participant count works one-handed; past dates are not selectable/accepted.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Guest cancel flow

### Overview

The GET-safe cancel page linked from the confirmation email, plus the POST route that calls the cancel RPC.

### Changes Required:

#### 1. Cancel confirmation page

**File**: `src/pages/anuluj.astro` (new)

**Intent**: GET landing for the email link — side-effect-free; presents a generic confirm prompt and a button.

**Contract**: Read `token` from the query string. Render a confirmation card with a **generic** prompt ("Czy na pewno chcesz anulować to zapytanie?") — **no per-request detail**, because anon has no SELECT on `booking_requests` and this slice adds no anon read path (the guest has context from their email). No DB read or mutation on GET. The card holds a small island/form that POSTs the token to `/api/booking-request/cancel`. If `token` is missing/malformed, show a Polish "nieprawidłowy link" message. Result rendering driven by the POST response (below).

#### 2. Cancel API route

**File**: `src/pages/api/booking-request/cancel.ts` (new); `export const prerender = false`

**Intent**: Perform the cancellation via the RPC and return a typed outcome for the page to render.

**Contract**: `POST` reading `{ token }` (zod uuid; a malformed token is folded into the same `not_found` outcome as an unknown one → `200 {status:"not_found"}`, since both mean "no such request" — the guest sees one coherent "nieprawidłowy link" message and the island treats any `status` as terminal). `createClient` null-guard → 503. Call `supabase.rpc("cancel_booking_request", { p_token: token })` (anon is granted EXECUTE). Map the RPC return: `cancelled=true` → `200 {status:"cancelled"}`; `cancelled=false` with status `accepted`/`withdrawn_by_owner` → `200 {status:"already_accepted"}` (page copy: "To zapytanie zostało już zaakceptowane — zadzwoń do gospodarza, aby je odwołać."); status `cancelled_by_guest` → `200 {status:"already_cancelled"}`; no row (null) → `200 {status:"not_found"}` ("Link nieprawidłowy lub zapytanie nie istnieje."). Never leak raw DB errors.

#### 3. Cancel result island (if needed)

**File**: `src/components/booking/CancelRequest.tsx` (new, optional)

**Intent**: Drive the confirm-button POST and render the result message without a full page reload.

**Contract**: Minimal React island: a confirm button that POSTs the token, then renders the Polish message for each `status` value above. (May be folded into `anuluj.astro` with a plain form POST if simpler — keep one approach.)

### Success Criteria:

#### Automated Verification:

- Build + lint pass: `npm run build` and `npm run lint`
- Cancel-RPC DB tests (from Phase 1) still pass: `npm test`

#### Manual Verification:

- Clicking the email link opens `/anuluj?token=…` with NO state change (GET is safe — refresh/prefetch does not cancel); confirming cancels a `pending` request and shows success.
- Cancelling an already-accepted request shows the "zadzwoń do gospodarza" copy; an already-cancelled or unknown token shows the idempotent/not-found copy.
- The cancelled request shows as `cancelled_by_guest` in the owner's view (existing RLS).

**Implementation Note**: After automated verification passes, this completes the slice — run the full `npm run deploy` path (it runs `db:push` before `wrangler deploy`) and smoke-test in production.

---

## Testing Strategy

### Unit Tests (`tests/unit/booking.test.ts`):

- PL-phone helper: accepts spaced / `+48` / `0048` / dashed forms; rejects short/long/alpha.
- `trip_date`: rejects past + malformed; accepts today/future.
- `participants_count` bounds (1..1000).
- Email body builder escapes `<`, `&`, `"` in guest-supplied fields.

### Integration / DB Tests (`tests/db/guest-cancel.test.ts`):

- Valid token cancels a pending request → `cancelled_by_guest`.
- Idempotent: second call is a no-op (`cancelled=false`).
- Accepted request cannot be guest-cancelled; row unchanged.
- Unknown token → `cancelled=false`.
- `zagroda_id/turnus_id/trip_date` unchanged by cancel.
- Anon insert without supplying `cancel_token` still succeeds (default fires) — guards the `rls.test.ts` contract.

### Manual Testing Steps:

1. Submit a valid request on a published zagroda (mobile-portrait) → success state + `pending` row.
2. Confirm both emails (guest confirmation with cancel link, owner notification with reply-to=guest).
3. Open the cancel link, refresh it (no cancellation on GET), then confirm → `cancelled_by_guest`.
4. Try cancelling an accepted request → "zadzwoń do gospodarza" copy.
5. Submit invalid phone/past date → Polish field errors, no row created.

## Performance Considerations

Low-QPS, small-data product. The submit route does one insert + one admin read + two email enqueues (drained via `waitUntil`, off the response path). No new indexes needed beyond the `cancel_token` unique index. Catalog availability is intentionally not read at submit time.

## Migration Notes

Single additive migration: a new nullable-defaulted column (`NOT NULL DEFAULT gen_random_uuid()` is safe on an empty/low-volume table and backfills existing rows automatically) plus a new function — fully backwards-compatible, so the old worker survives the deploy window and `wrangler rollback` stays safe. Ships via `npm run deploy` (`db:push` before `wrangler deploy`), per the standing deploy lesson.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- PRD: `context/foundation/prd.md` (FR-004, FR-011, FR-015, US-02)
- Accept-RPC template: `supabase/migrations/20260605094725_accept_booking_request.sql:14-100`
- RLS posture + anon-insert contract: `supabase/migrations/20260605090307_domain_schema.sql:137-152`, `tests/db/rls.test.ts`
- Email API + call shape: `src/lib/email/index.ts`, `src/pages/api/dev/test-email.ts:36-51`
- Form + API conventions: `src/components/zagroda/ZagrodaProfileForm.tsx`, `src/pages/api/zagroda/publish.ts`
- Lock-order/immutability rule: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema — cancel token + guest-cancel RPC

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:reset` — d18086a
- [x] 1.2 Types regenerate without diffnoise beyond the new column/RPC: `npm run db:types` — d18086a
- [x] 1.3 New + existing DB tests pass: `npm test` — d18086a
- [x] 1.4 Lint/type check passes: `npm run lint` — d18086a

#### Manual

- [x] 1.5 Manual `cancel_booking_request('<token>')` flips pending → cancelled_by_guest; second call is a no-op — d18086a
- [x] 1.6 `accept_booking_request` and `rls.test.ts` behavior unchanged (no F-01 regression) — d18086a

### Phase 2: Submit API + validation helpers

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — e5f0e14
- [x] 2.2 Type check + lint pass: `npm run lint` — e5f0e14
- [x] 2.3 Build succeeds: `npm run build` — e5f0e14

#### Manual

- [x] 2.4 Valid POST → 200 `{ok:true}` + pending row; invalid phone/past date → 422 with Polish field errors — e5f0e14
- [x] 2.5 Email configured → both emails enqueued/sent; email unset → route still succeeds (no-op) — e5f0e14
- [x] 2.6 Owner email reply-to = teacher; guest email contains a working `/anuluj?token=…` URL — e5f0e14
- [x] 2.7 POST against an unpublished/draft zagroda id is rejected ("Zagroda niedostępna"), no row created — e5f0e14

### Phase 3: Booking form island

#### Automated

- [x] 3.1 Build passes: `npm run build` — 8f3c41c
- [x] 3.2 Lint passes: `npm run lint` — 8f3c41c

#### Manual

- [x] 3.3 Form renders on a published zagroda (mobile-portrait); client-side validation shows inline Polish errors; valid submit shows success + creates a pending request — 8f3c41c
- [x] 3.4 Turnus/date/participants usable one-handed; past dates not accepted — 8f3c41c

### Phase 4: Guest cancel flow

#### Automated

- [x] 4.1 Build passes: `npm run build` — 44047e8
- [x] 4.2 Lint passes: `npm run lint` — 44047e8
- [x] 4.3 Phase-1 cancel-RPC DB tests still pass: `npm test` — 44047e8

#### Manual

- [x] 4.4 Email link opens `/anuluj?token=…` with no state change on GET; confirming cancels a pending request — 44047e8
- [x] 4.5 Already-accepted → "zadzwoń do gospodarza"; already-cancelled/unknown token → idempotent/not-found copy — 44047e8
- [x] 4.6 Cancelled request shows as `cancelled_by_guest` in the owner's view — 44047e8
