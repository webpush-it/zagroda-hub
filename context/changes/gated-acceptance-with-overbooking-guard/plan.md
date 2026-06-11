# Gated Acceptance with Overbooking Guard (S-04) Implementation Plan

## Overview

Wire the proven F-01 atomic accept primitive into a complete owner flow: a mobile-first booking-requests panel (`/dashboard/zapytania` list + `/dashboard/zapytania/[id]` detail), accept/reject APIs with the exact PRD blocked-message ("Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)"), and decision emails to the guest. This closes the north-star loop (US-01, roadmap "gwiazda przewodnia") carrying success criterion #1: 100% overbooking block.

PRD refs: FR-005 (acceptance email), FR-012 (request list), FR-013 (request detail with teacher contact), FR-014 (accept/reject with daily-limit guard), US-01. NFRs: confirmation < 15 s on mobile, "exactly one succeeds" under concurrency, teacher-contact privacy, 12-month history, email < 5 min.

## Current State Analysis

- **Atomic accept primitive exists and is proven (F-01).** `accept_booking_request(request_id uuid)` → `(accepted bool, occupied int, daily_limit int, requested int)` at `supabase/migrations/20260605094725_accept_booking_request.sql:14-106`. SECURITY DEFINER, lock order zagroda-first-then-request, errors: `P0002` (not found), `42501` (not owner), `55000` (not pending). Over-limit is a domain outcome (`accepted=false`, status stays `pending`), not an error. Covered by `tests/db/concurrency.test.ts` (20-iteration parallel race, "exactly one succeeds") and `tests/db/acceptance-rule.test.ts` (8-case matrix). **Nothing in TypeScript calls it yet.**
- **No reject primitive.** The `rejected` enum value exists (`request_status` at `supabase/migrations/20260605090307_domain_schema.sql:9-15`), but no function transitions to it — and `booking_requests` has no UPDATE policies; all mutations go through SECURITY DEFINER functions. `cancel_booking_request` (`supabase/migrations/20260608100000_guest_cancel_booking_request.sql:24-75`) is the pattern to mirror.
- **Email channel ready (F-02).** `sendTransactionalEmail(deps, msg)` at `src/lib/email/index.ts:29-60` (outbox + Brevo + cron drain). S-03's email builders live in `src/lib/booking.ts:92-146` (`buildBookingEmails`); the enqueue-in-route pattern with `waitUntil` is at `src/pages/api/booking-request/index.ts:77-124`.
- **No owner requests UI.** `/dashboard` (`src/pages/dashboard.astro`) is the zagroda profile editor only. RLS already lets the owner SELECT their zagroda's requests including guest contact (`supabase/migrations/20260605090307_domain_schema.sql:144-152`, tested in `tests/db/rls.test.ts`). Anon has **no SELECT policy** on `booking_requests`.
- **Middleware gates by prefix.** `PROTECTED_ROUTES = ["/dashboard"]` with `startsWith` (`src/middleware.ts:4,18`) — new sub-pages are protected automatically.
- **Email-verification gate exists DB-side for publish.** `public.email_verified()` checks `auth.users.email_confirmed_at` (`supabase/migrations/20260605200000_zagroda_profile_publication.sql:60-77`); `set_zagroda_published` raises `email_not_verified`. The same signal is available TS-side as `locals.user.email_confirmed_at` with zero extra queries.
- **S-03 submit route does a bare insert** (no `.select()` — it would fail anon RLS) and the owner notification email has no link to the request.

## Desired End State

The owner opens `/dashboard/zapytania` on a phone, sees pending requests first (filter chips: Oczekujące / Zaakceptowane / Odrzucone / Anulowane), taps one to open `/dashboard/zapytania/[id]`, sees trip date, turnus, participant count, and teacher contact, and taps **Akceptuj** (immediate) or **Odrzuć** (inline confirm). Acceptance is atomically guarded: over-limit shows "Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)" and the request stays pending. The guest receives an acceptance or rejection email. The owner notification email ("Masz nowe zapytanie") now deep-links to the request's detail page.

Verify by: full US-01 scenario on a mobile viewport (two requests 20+15 on limit 30 — first accepted, second blocked with the exact message), two-tab parallel acceptance smoke on production, all DB/unit tests green.

### Key Discoveries:

- `accept_booking_request`'s return row gives exactly the X/Y/Z for the PRD message: X=`occupied`, Y=`daily_limit`, Z=`requested` (`supabase/migrations/20260605094725_accept_booking_request.sql:14-22`).
- Anon INSERT has no SELECT policy → `.insert().select()` fails in the submit route; generating the request `id` TS-side (like `cancel_token` already is, `src/pages/api/booking-request/index.ts:24-75`) makes the deep link possible without RLS changes.
- A single-row-lock reject function cannot deadlock with accept's zagroda→request lock order (one lock can't form a cycle) — same posture as `cancel_booking_request`.
- Lesson (lessons.md): `zagroda_id`, `turnus_id`, `trip_date` of `booking_requests` are load-bearing immutables — the reject function must only touch `status`/`updated_at`.
- Lesson (lessons.md): every schema-touching deploy runs `supabase db push` **before** `wrangler deploy` — `npm run deploy` already encodes this order.

## What We're NOT Doing

- **No undo of acceptance** — `withdrawn_by_owner` transitions are S-05 (`owner-undo-acceptance`).
- **No un-reject / re-open** — `rejected` is terminal in MVP (hence the confirm step).
- **No occupancy preview on the detail page** ("X z Y zajęte tego dnia" before deciding) — not required by any FR; the blocked message carries the numbers when it matters.
- **No pagination** — data volume is small; the full 12-month history renders as one list (NFR satisfied because nothing is deleted or filtered out by age).
- **No automated API-level race test** — the RPC is the only serialization point; the existing DB race test is the proof, plus a manual two-tab smoke (user decision).
- **No returnTo deep-link preservation** — middleware and post-auth redirects (`signin.ts`, `callback.ts`, `confirm.ts`) hardcode `/dashboard`; a logged-out owner tapping the email link lands on the dashboard, not the request. Accepted: mobile sessions persist, so the active-session case dominates. returnTo is a future change touching the S-06 auth surface.
- **No changes to the accept RPC** — it's proven; the FR-006 gate lives in the API routes.
- **No notification settings, SMS/push, negotiation flows** — PRD Non-Goals.

## Implementation Approach

Three phases following the established slice pattern: (1) DB primitive + tests, (2) API layer + emails, (3) SSR pages + React islands. Each layer reuses a documented pattern: the reject function mirrors `cancel_booking_request`, the API routes mirror `publish.ts`/`cancel.ts` (Zod, `json()` helper, Polish error mapping), emails mirror `buildBookingEmails` + `sendTransactionalEmail` with `waitUntil`, and the UI mirrors `dashboard.astro` + `ZagrodaProfileForm.tsx` (SSR fetch → island with fetch-on-action, field-level Polish errors, green/red outcome cards).

## Critical Implementation Details

- **Anon insert cannot `.select()`**: `booking_requests` has no anon SELECT policy, so the S-03 submit route must generate the request `id` with `crypto.randomUUID()` and include it in the INSERT payload (exactly like `cancel_token` today) to build the owner deep link. Do not add a `.select()` or an anon SELECT policy.
- **Reject lock posture**: lock the request row only (`FOR UPDATE`), never the zagroda row — acquiring a single lock cannot deadlock with accept's zagroda→request order. Re-check `status = 'pending'` under the lock. Update only `status` and rely on the existing `updated_at` trigger; `zagroda_id`/`turnus_id`/`trip_date` are immutable per lessons.md.
- **Owner check before soft outcomes**: the reject function must verify ownership (raise `42501`) *before* returning soft not-pending outcomes, so a foreign owner can't probe request states by id.
- **Decision emails need row data the RPC doesn't return**: fetch the request row (guest fields, trip_date, participants) joined with zagroda name and turnus label via the owner's session client **before** calling the RPC; RLS guarantees the owner only reads their own rows.
- **FR-006 gate semantics**: `locals.user.email_confirmed_at` is server truth (middleware uses `supabase.auth.getUser()`, not a stale JWT) — but note this app-layer gate is a novel pattern; the existing convention is DB-side `public.email_verified()`. One reachable state gets blocked: an OAuth user whose provider reported `email_verified=false` with no password-account collision (allowed through by `callback.ts`) — correct, since such users can't publish and therefore can't have requests. `tests/helpers/supabase.ts:55-68` provides `createUnverifiedOwnerClient` for exercising unverified-owner states.
- **waitUntil lives at `locals.cfContext`** (not `locals.runtime`): extract the private `getWaitUntil()` helper from `src/pages/api/booking-request/index.ts:14-22` into a shared module (e.g. `src/lib/cf.ts`) and import it in the submit, accept, and reject routes — don't make a third private copy.

## Phase 1: Reject Primitive (DB)

### Overview

Add the missing `pending → rejected` transition as a SECURITY DEFINER function with the same RLS-first posture as the rest of the domain, plus its DB test matrix.

### Changes Required:

#### 1. Migration: reject function

**File**: `supabase/migrations/<timestamp>_reject_booking_request.sql` (new)

**Intent**: Give owners a guarded way to reject a pending request — no UPDATE policies exist, so this must be a SECURITY DEFINER function like `cancel_booking_request`.

**Contract**: `public.reject_booking_request(request_id uuid) RETURNS TABLE (rejected boolean, status public.request_status)`, `SECURITY DEFINER`, `SET search_path = ''`. Semantics: raise `P0002` if the request doesn't exist; raise `42501` if `auth.uid()` is not the owner of the request's zagroda (check before any state-dependent return); lock the request row `FOR UPDATE`; if status is `pending` → set `status = 'rejected'`, return `(true, 'rejected')`; otherwise return `(false, <current status>)` (soft outcome, mirroring `cancel_booking_request` — a guest cancelling concurrently is a state to report, not an exception). `REVOKE` from `public`/`anon`, `GRANT EXECUTE` to `authenticated` only.

#### 2. Regenerated DB types

**File**: `src/db/database.types.ts`

**Intent**: Expose the new function to TypeScript.

**Contract**: `npm run db:types` after `npm run db:reset`; `Functions.reject_booking_request` appears with `Args: { request_id: string }`.

#### 3. DB test matrix

**File**: `tests/db/reject.test.ts` (new)

**Intent**: Prove the reject contract the same way `tests/db/guest-cancel.test.ts` proves cancel.

**Contract**: Using helpers from `tests/helpers/supabase.ts` (`createOwnerClient`, `seedZagroda`, `seedBookingRequest`): (a) owner rejects pending → `(true, 'rejected')`, row status is `rejected`; (b) non-owner authenticated caller → error `42501`; (c) unknown id → `P0002`; (d) already `accepted` / `cancelled_by_guest` → `(false, <status>)`, row unchanged; (e) anon caller → `42501` (no EXECUTE grant); (f) a rejected request cannot subsequently be accepted (`accept_booking_request` raises `55000`); (g) rejecting does not change occupancy — an unrelated acceptance on the same day still sees the same `occupied`.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `npm run db:reset`
- Types regenerate without diff drift: `npm run db:types` (then `git diff --stat src/db/database.types.ts` shows the new function)
- New reject tests pass: `npm test -- reject`
- Full suite stays green (incl. concurrency + RLS): `npm test`
- Lint passes: `npm run lint`

**Implementation Note**: After completing this phase and all automated verification passes, proceed — no manual gate needed for the DB-only phase (no Manual Verification criteria).

---

## Phase 2: Decision APIs + Emails

### Overview

Expose accept/reject over authenticated JSON endpoints with the FR-006 verification gate and Polish error mapping; build the two guest decision emails; add the owner-email deep link by generating the request id in the S-03 submit route.

### Changes Required:

#### 1. Decision email builders

**File**: `src/lib/booking.ts`

**Intent**: Build the acceptance email (FR-005) and the rejection email (user decision: scope addition beyond PRD) for the guest, following `buildBookingEmails`' style.

**Contract**: `buildDecisionEmails(ctx)` (or two sibling builders) taking `{ guest_name, guest_email, zagroda_name, trip_date, turnus_label, participants_count }` and returning `EmailMessage` objects. Acceptance subject: "Rezerwacja potwierdzona — {zagroda}"; rejection subject: "Zapytanie odrzucone — {zagroda}". Bodies in Polish via `renderEmailLayout`, every interpolated field escaped with `escapeHtml`. No reply-to (decisions are final-state notifications); no cancel link in either.

#### 2. Accept endpoint

**File**: `src/pages/api/booking-request/accept.ts` (new)

**Intent**: The owner's accept action — the single place the F-01 primitive gets called from the app.

**Contract**: `POST` with body `{ id: uuid }` (Zod). Guards in order: Supabase configured (503) → `locals.user` (401) → `user.email_confirmed_at` set (409, "Zweryfikuj adres e-mail, aby zarządzać rezerwacjami" — FR-006 gate, user decision: explicit). Fetch the request row + zagroda name + turnus label via the session client (RLS-scoped) for the email context; a null result → 404 (RLS hides foreign/unknown requests — don't call the RPC); then `supabase.rpc("accept_booking_request", { request_id })`. Mapping: RPC error `P0002` → 404; `42501` → 403; `55000` → 409 "To zapytanie nie jest już oczekujące — odśwież stronę". Result row `accepted=false` → 409 `{ error: "Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)", occupied, daily_limit, requested }` with X=`occupied`, Y=`daily_limit`, Z=`requested` (exact FR-014 copy). `accepted=true` → enqueue the acceptance email best-effort via `sendTransactionalEmail` + `waitUntil` (pattern from `src/pages/api/booking-request/index.ts:77-124`; email failure never fails the response) → 200 `{ ok: true, status: "accepted" }`.

#### 3. Reject endpoint

**File**: `src/pages/api/booking-request/reject.ts` (new)

**Intent**: The owner's reject action, symmetric to accept minus the limit math.

**Contract**: Same guards, body shape, and RLS-scoped email-context pre-fetch as accept (null → 404, skip the RPC). Calls `supabase.rpc("reject_booking_request", { request_id })`. `rejected=true` → enqueue rejection email best-effort → 200 `{ ok: true, status: "rejected" }`. `rejected=false` → 409 with the soft status and "To zapytanie nie jest już oczekujące — odśwież stronę". Same P0002/42501 mapping.

#### 4. Deep link in the owner notification email

**File**: `src/pages/api/booking-request/index.ts`, `src/lib/booking.ts`

**Intent**: "Masz nowe zapytanie" → one tap → detail page (user decision; serves the 15 s budget).

**Contract**: The submit route generates `id = crypto.randomUUID()` and includes it in the INSERT payload (no `.select()` — anon has no SELECT policy). `buildBookingEmails`' context gains the request id; the owner email body gains a "Zobacz zapytanie" link to `{origin}/dashboard/zapytania/{id}` (origin derived from `request.url` as today).

#### 5. Unit tests for builders

**File**: `tests/unit/booking.test.ts`

**Intent**: Lock the email contracts the same way existing builder tests do.

**Contract**: Acceptance/rejection emails: correct recipient, Polish subjects, escaped guest/zagroda fields, no cancel link. Owner email: contains the `/dashboard/zapytania/{id}` link with the generated id.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test -- unit`
- Full suite green: `npm test`
- Lint passes: `npm run lint`
- Build succeeds (route modules compile): `npm run build`

#### Manual Verification:

- Local smoke: submit a request as guest, owner email (Brevo or outbox row) contains the deep link with a valid request id
- Accept via `curl`/REST on local: pending request → 200 + outbox row with acceptance email; second conflicting request → 409 with exact "Limit dzienny przekroczony (20 z 30 zajęte, 15 wymaga miejsca)" copy

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Owner UI (List + Detail) and Slice Close-out

### Overview

The mobile-first owner panel: requests list with status chips, detail page with the decision island, navigation links — then deploy and prove US-01 end-to-end on production.

### Changes Required:

#### 1. Requests list page

**File**: `src/pages/dashboard/zapytania/index.astro` (new)

**Intent**: FR-012 — the owner's request inbox, pending-first (user decisions: dedicated page, filter chips defaulting to Oczekujące).

**Contract**: SSR (middleware already gates `/dashboard*`): fetch the owner's zagroda (`eq("owner_id", user.id).maybeSingle()` — pattern `src/pages/dashboard.astro:14-20`); if none, render an empty state pointing to `/dashboard`. Fetch all `booking_requests` for that zagroda with the turnus label joined (`turnusy(label, start_time, end_time)`), ordered `created_at desc` (FR-012 sort), no pagination. Mount a `client:load` island with the rows.

#### 2. Requests list island

**File**: `src/components/booking/RequestsList.tsx` (new)

**Intent**: Client-side status filtering without refetching — the dataset is small and already RLS-scoped.

**Contract**: Props: rows (id, trip_date, turnus label, participants_count, guest_name, status, created_at). Chips: Oczekujące (default) / Zaakceptowane / Odrzucone / Anulowane, each with a count; "Anulowane" bucket covers `cancelled_by_guest` (and `withdrawn_by_owner` rows once S-05 exists). Each row is a tappable card (status badge, trip date, turnus, participants, guest name) linking to `/dashboard/zapytania/{id}`. Styling follows the existing cosmic/white-on-dark input-card patterns and lucide icons; touch targets sized for one-handed portrait use.

#### 3. Request detail page

**File**: `src/pages/dashboard/zapytania/[id].astro` (new)

**Intent**: FR-013 — full request details including teacher contact, plus the decision actions (user decision: separate deep-linkable page).

**Contract**: SSR fetch by id via the session client; RLS returns null for foreign/unknown ids → respond 404 (`Astro.redirect` to the list or a 404 render — match existing not-found handling in `src/pages/zagrody/[id].astro`). Render: trip_date, turnus (label + HH:MM range), participants_count, guest_name, guest_email (`mailto:`), guest_phone (`tel:`), status badge, created_at. Mount the decision island only when status is `pending`; otherwise show the terminal-state card.

#### 4. Decision island

**File**: `src/components/booking/RequestDecision.tsx` (new)

**Intent**: FR-014 + US-01 — accept instantly, reject behind an inline confirm (user decision: asymmetric guard, rejection is irreversible).

**Contract**: Two buttons: **Akceptuj** (primary, fires `POST /api/booking-request/accept` immediately, pending spinner per `SubmitButton`/`Loader2` pattern) and **Odrzuć** (secondary; first tap swaps to inline "Na pewno odrzucić?" confirm/cancel pair; confirm fires `POST /api/booking-request/reject`). Outcomes: 200 → green success card ("Zaakceptowano — nauczyciel dostanie e-mail" / "Odrzucono — nauczyciel dostanie e-mail") and status badge update; 409 limit-blocked → red card with the server's exact message, request stays pending and buttons stay active; 409 state-changed → amber card "Zapytanie zmieniło status — odśwież stronę"; network/500 → "Błąd połączenia — spróbuj ponownie" (existing copy). Response body is the source of truth; no optimistic updates (matches `ZagrodaProfileForm`).

#### 5. Navigation links

**File**: `src/components/Topbar.astro`, `src/pages/dashboard.astro`

**Intent**: Make the panel reachable in one tap for a logged-in owner.

**Contract**: Topbar gains a "Zapytania" link next to "Panel" for authenticated users; `/dashboard` gains a visible link/button to `/dashboard/zapytania`.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm test`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- US-01 end-to-end on a mobile viewport (portrait): zagroda limit 30, two pending requests (20 + 15) → accept first succeeds (green card), accept second blocked with exactly "Limit dzienny przekroczony (20 z 30 zajęte, 15 wymaga miejsca)", second stays in Oczekujące
- Reject flow: Odrzuć → inline confirm → status flips to Odrzucone; rejection email lands < 5 min
- Acceptance email lands at the guest address < 5 min
- Owner-email deep link opens the right detail page with an active session (known limitation: logged-out users land on `/auth/signin` → `/dashboard` — middleware and all post-auth redirects drop the path; returnTo support is future work)
- Privacy: a second owner account opening the first owner's request URL gets 404; anon gets redirected to signin
- Two-tab race smoke on production: two sessions accept conflicting requests simultaneously → exactly one success, one blocked message
- Deploy via `npm run deploy` (db push before wrangler deploy — lessons.md) and re-run the US-01 scenario on production

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before archiving the change.

---

## Testing Strategy

### Unit Tests:

- Decision email builders: recipients, Polish subjects, HTML escaping of guest/zagroda fields, absence of cancel link
- Owner notification email: deep link contains the TS-generated request id

### Integration Tests (DB, vitest against local Supabase):

- `tests/db/reject.test.ts` matrix (Phase 1, cases a–g)
- Existing suites stay green: `acceptance-rule`, `concurrency` (the "exactly one succeeds" proof), `rls`, `guest-cancel`

### Manual Testing Steps:

1. Seed: owner with published zagroda (limit 30, ≥1 turnus), two guest requests same day (20 and 15 participants)
2. Phone viewport: list shows both under Oczekujące; open first → Akceptuj → green card; guest inbox gets acceptance email
3. Open second → Akceptuj → red card with exact "Limit dzienny przekroczony (20 z 30 zajęte, 15 wymaga miejsca)"; chip counts unchanged for Oczekujące minus the accepted one
4. Odrzuć the second with confirm step → Odrzucone; rejection email arrives
5. Two browsers, two conflicting pending requests, tap Akceptuj simultaneously → exactly one success
6. Cross-owner URL probe → 404; anon → signin redirect

## Performance Considerations

List page is a single RLS-scoped SELECT with a join, rendered SSR — well within the 15 s end-to-end budget (the budget is dominated by human taps, not queries). The accept path is one SELECT + one RPC; the partial index `booking_requests_accepted_per_day_idx` already serves the occupancy sum inside the RPC. Emails are enqueued post-response via `waitUntil`, so they never block the confirmation.

## Migration Notes

One additive migration (new function only — no table changes), so old workers survive the deploy window and `wrangler rollback` stays safe. Per lessons.md, production deploy must run `supabase db push` before `wrangler deploy` — use `npm run deploy`, never bare `wrangler deploy`.

## References

- Accept primitive: `supabase/migrations/20260605094725_accept_booking_request.sql:14-106`
- Cancel pattern for the reject function: `supabase/migrations/20260608100000_guest_cancel_booking_request.sql:24-75`
- Email send + waitUntil pattern: `src/lib/email/index.ts:29-60`, `src/pages/api/booking-request/index.ts:77-124`
- Polish error mapping pattern: `src/pages/api/zagroda/publish.ts:19-36`
- Owner page + island pattern: `src/pages/dashboard.astro`, `src/components/zagroda/ZagrodaProfileForm.tsx`
- Lessons: `context/foundation/lessons.md` (lock-order immutables; db push before deploy)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reject Primitive (DB)

#### Automated

- [x] 1.1 Migrations apply cleanly: `npm run db:reset` — 6838fd8
- [x] 1.2 Types regenerate with the new function: `npm run db:types` — 6838fd8
- [x] 1.3 New reject tests pass: `npm test -- reject` — 6838fd8
- [x] 1.4 Full suite stays green: `npm test` — 6838fd8
- [x] 1.5 Lint passes: `npm run lint` — 6838fd8

### Phase 2: Decision APIs + Emails

#### Automated

- [x] 2.1 Unit tests pass: `npm test -- unit` — 74801e6
- [x] 2.2 Full suite green: `npm test` — 74801e6
- [x] 2.3 Lint passes: `npm run lint` — 74801e6
- [x] 2.4 Build succeeds: `npm run build` — 74801e6

#### Manual

- [x] 2.5 Owner email contains deep link with valid request id (local smoke) — 74801e6
- [x] 2.6 Accept over REST: success + exact blocked-message copy on conflict (local smoke) — 74801e6

### Phase 3: Owner UI (List + Detail) and Slice Close-out

#### Automated

- [x] 3.1 Full suite green: `npm test` — cd50403
- [x] 3.2 Lint passes: `npm run lint` — cd50403
- [x] 3.3 Build succeeds: `npm run build` — cd50403

#### Manual

- [x] 3.4 US-01 end-to-end on mobile viewport (accept + exact blocked message) — cd50403
- [x] 3.5 Reject flow with confirm + rejection email < 5 min — cd50403
- [x] 3.6 Acceptance email < 5 min — cd50403
- [x] 3.7 Owner-email deep link opens the right detail page with an active session — cd50403
- [x] 3.8 Privacy: cross-owner 404, anon redirect — cd50403
- [x] 3.9 Two-tab race smoke on production: exactly one success — cd50403
- [x] 3.10 Deployed via `npm run deploy`; US-01 re-verified on production — cd50403
