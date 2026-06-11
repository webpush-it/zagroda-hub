# Gated Acceptance with Overbooking Guard (S-04) — Plan Brief

> Full plan: `context/changes/gated-acceptance-with-overbooking-guard/plan.md`

## What & Why

The owner gets a mobile-first panel to see booking requests and accept or reject them — with acceptance atomically guarded against overbooking and the guest notified by email. This is the roadmap's north star (S-04): success criterion #1 ("100% poprawnie blokuje overbooking") is proven or broken here, and every prior slice (schema, emails, profile, catalog, guest requests) exists to feed this flow.

## Starting Point

The hard part is already built: F-01's `accept_booking_request` SQL function atomically enforces the daily limit (zagroda-row lock, proven by a 20-iteration parallel-race test) and returns the exact numbers the UI must show — but nothing in the app calls it yet. The email channel (F-02) and guest request flow (S-03) are live. There is no owner requests UI, and no reject primitive exists (the `rejected` status has no function, and direct UPDATEs are blocked by RLS).

## Desired End State

On a phone, the owner opens Zapytania, sees pending requests first, taps into one, and one-taps Akceptuj (or confirms Odrzuć). An over-limit acceptance is blocked with "Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)" and stays pending. The teacher receives an acceptance or rejection email, and the owner's "new request" email now deep-links straight to the request.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Panel location | Dedicated `/dashboard/zapytania` page | Direct path serves the <15 s mobile budget; dashboard stays a profile editor |
| List layout | Status filter chips, default Oczekujące | Owner lands on actionable items first |
| Detail view | Separate page `/dashboard/zapytania/[id]` | Deep-linkable — the owner notification email links straight to it |
| Action UX | Accept direct, reject behind inline confirm | Rejection is irreversible in MVP; acceptance gets undo in S-05 |
| Rejection email | Yes — send it (beyond PRD scope) | Closes the information loop for the teacher |
| FR-006 gate | Explicit `email_confirmed_at` check in both APIs | Satisfies the FR literally; survives future loosening of publish rules |
| Race proof | Existing DB race test + manual two-tab smoke | The RPC is the only serialization point; no new test infra needed |
| Reject primitive | New SECURITY DEFINER fn, request-row lock only | Mirrors `cancel_booking_request`; single lock can't deadlock with accept |

## Scope

**In scope:** reject_booking_request migration + DB tests; accept/reject JSON APIs with Polish error mapping and the exact FR-014 blocked message; acceptance + rejection emails; deep link in the owner notification email (request id generated TS-side); list page with chips; detail page with decision island; Topbar/dashboard navigation; production deploy + US-01 verification.

**Out of scope:** undo acceptance (S-05), un-reject, occupancy preview on detail, pagination, automated API-level race test, any change to the proven accept RPC, SMS/push/negotiation (PRD Non-Goals).

## Architecture / Approach

Three layers, each copying a shipped pattern: a SECURITY DEFINER reject function modeled on `cancel_booking_request`; two authenticated API routes modeled on `publish.ts`/`cancel.ts` that call the RPCs, map errors to Polish, and enqueue guest emails via the F-02 outbox with `waitUntil`; SSR Astro pages with React islands modeled on `dashboard.astro`/`ZagrodaProfileForm.tsx`. The middleware already protects `/dashboard*` by prefix, and existing RLS already scopes request reads (incl. teacher contact) to the owning owner.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reject primitive (DB) | `reject_booking_request` fn + test matrix, regenerated types | Getting the ownership-check-before-soft-outcome order wrong leaks state to foreign owners |
| 2. Decision APIs + emails | accept/reject endpoints, decision emails, owner deep link | Anon insert can't `.select()` — request id must be generated TS-side |
| 3. Owner UI + close-out | List + detail pages, decision island, nav, prod deploy | Mobile UX must hit the 15 s budget; deploy must push migrations first |

**Prerequisites:** F-01, F-02, S-01, S-03 all done (they are); local Supabase stack for tests; Brevo creds on prod for email verification.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Rejection email is a deliberate scope addition beyond the PRD's email list — recorded here so the PRD/roadmap delta is visible.
- "Anulowane" chip will also absorb `withdrawn_by_owner` rows once S-05 ships; naming may need a revisit then.
- Assumes Supabase sets `email_confirmed_at` for OAuth-verified users (S-06 behavior) so the FR-006 gate doesn't block OAuth owners.

## Success Criteria (Summary)

- US-01 passes end-to-end on a phone: first acceptance succeeds, conflicting one is blocked with the exact Polish message and stays pending.
- Two parallel acceptances on production: exactly one succeeds (manual two-tab smoke; DB race test stays green).
- Teacher receives the correct decision email < 5 min; teacher contact stays visible only to the owning owner.
