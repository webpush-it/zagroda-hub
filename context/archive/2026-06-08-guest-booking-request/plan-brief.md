# Guest Booking Request (S-03) — Plan Brief

> Full plan: `context/changes/guest-booking-request/plan.md`

## What & Why

Let an unauthenticated teacher submit a booking request straight from the public zagroda page, get a confirmation email with a tokenized self-cancel link, and cancel while the request is still pending — and notify the owner of every new request (reply-to = teacher). This is roadmap slice **S-03** (FR-004, FR-011, FR-015, US-02). Without it, cancellation falls back to the phone — the product's core pain point — and S-04 (owner acceptance) has no requests to act on.

## Starting Point

The schema (F-01) already has `booking_requests` with the `cancelled_by_guest` status enumerated, an open anon-INSERT RLS policy (`status='pending'` only), owner-only SELECT for contact privacy, and **no UPDATE/DELETE policies** — transitions go through `SECURITY DEFINER` functions (`accept_booking_request` is the template). The public zagroda page (`zagrody/[id].astro`, S-02) already loads turnusy + daily limit. The email channel (F-02, `sendTransactionalEmail`) and a vitest db/unit test harness are in place. **Net-new in this slice:** a `cancel_token` column and a guest-cancel RPC — neither exists yet.

## Desired End State

A guest submits the form and sees an inline confirmation; a `pending` row appears immediately (owner-visible via existing RLS). The guest gets a "potwierdzenie wysłania" email with a `…/anuluj?token=<uuid>` link; the owner gets a "nowe zapytanie" email they can reply to directly. The cancel link opens a GET-safe confirmation page; confirming flips the request to `cancelled_by_guest`, with sensible copy for already-accepted/already-cancelled cases.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Submit path | Anon RLS insert, TS-generated token | Reuses the sanctioned F-01 anon-INSERT posture; zero new DB surface | Plan |
| Cancel-token model | Plaintext `uuid` column | 122-bit unguessable; standard for a low-stakes pending-request cancel | Plan |
| Submit-time limit check | None — always create `pending` | PRD enforces the daily limit only at owner-accept; catalog already steers away from full days | Plan (PRD) |
| Phone validation | Lenient PL (optional +48 + 9 digits) | Accepts the spaced/prefixed forms teachers actually type without rejecting real numbers | Plan |
| Cancel link behavior | GET confirm page + POST to cancel | Keeps GET side-effect-free so link prefetch can't auto-cancel | Plan |
| Email reply-to | Owner email → reply-to = guest | Owner answers the teacher in one tap; guest contact stays owner-only | Plan |
| Test depth | DB (cancel RPC) + unit (validators/email) | Locks the one new security-sensitive primitive + the immutability lesson | Plan |

## Scope

**In scope:** cancel-token column + guest-cancel `SECURITY DEFINER` RPC; submit API route + shared zod/phone/date validators; booking form island on the zagroda page; guest confirmation + owner notification emails; GET-safe cancel page + cancel route; db + unit tests.

**Out of scope:** owner accept/reject UI (S-04); any submit-time overbooking gate; hashed tokens; guest accounts/panel; SMS/push; changes to `accept_booking_request` or the auth-email path; new RLS UPDATE/DELETE policies.

## Architecture / Approach

Bottom-up across four layers. Submit uses the **request-scoped anon client** through F-01's anon-INSERT policy; the cancel token is generated in TS (`crypto.randomUUID()`) and inserted explicitly (bare `.insert()` — anon has no SELECT to read it back). Owner-email lookup + both email enqueues run server-side in the same route via the **admin client** and `sendTransactionalEmail`, drained off the response path with `waitUntil` (no-op when email is unconfigured). Cancellation is a `SECURITY DEFINER` RPC that locks only the request row and re-checks `status='pending'` under the lock — a strict subset of accept's lock set, so no new deadlock cycle and the lock-order lesson holds.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + cancel RPC | `cancel_token` column, `cancel_booking_request()`, grants, types, DB tests | Must honor immutability/lock-order lesson; `NOT NULL DEFAULT` to not break anon insert/seeds |
| 2. Submit API + validators | `/api/booking-request` POST, `src/lib/booking.ts`, both emails, unit tests | Anon insert must be read-back-blind; email best-effort, must not block response |
| 3. Form island | `BookingRequestForm.tsx` on `zagrody/[id]` | Mobile-portrait one-handed usability |
| 4. Cancel flow | GET-safe `/anuluj` page + `/api/booking-request/cancel` | Keep GET side-effect-free; correct copy per status |

**Prerequisites:** F-01, F-02, S-02 — all done. Local Supabase (Docker) for db tests; email env optional.
**Estimated effort:** ~2–3 after-hours sessions across the four phases.

## Open Risks & Assumptions

- Assumes the anon-INSERT policy stays open (no slice plans to revoke it); if it's later locked down, the submit path moves to a SECURITY DEFINER RPC.
- Plaintext token accepts that a full DB read-leak could replay into cancellations — worst case is cancelling a pending request (no contact-data exposure).
- Brevo free tier (300/day) and single-sender deliverability caveats from F-02 still apply.

## Success Criteria (Summary)

- A guest can submit from the zagroda page and immediately sees confirmation; a `pending` request reaches the owner.
- The guest receives a confirmation email and can self-cancel a pending request via a GET-safe tokenized link; the owner receives a reply-to-teacher notification.
- `npm test` (new db + unit), `npm run lint`, and `npm run build` are green; the overbooking guarantee and F-01 RLS contract are unregressed.
