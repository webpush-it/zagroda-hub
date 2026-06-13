---
date: 2026-06-13T10:29:25+0200
researcher: Konrad Beśka
git_commit: d93037690fee1985e4b908b20bcc442f691dfdc3
branch: master
repository: zagroda-hub
topic: "Email outbox reliability — oracle for Phase 3 failure-mode tests (risk #2)"
tags: [research, codebase, email, outbox, brevo, cron, reliability, test-plan-phase-3]
status: complete
last_updated: 2026-06-13
last_updated_by: Konrad Beśka
---

# Research: Email outbox reliability (Phase 3, risk #2)

**Date**: 2026-06-13T10:29:25+0200
**Researcher**: Konrad Beśka
**Git Commit**: d93037690fee1985e4b908b20bcc442f691dfdc3
**Branch**: master
**Repository**: zagroda-hub

## Research Question

Test-plan §3 Phase 3 ("Email outbox reliability") covers risk #2 — *transactional
email silently stops (provider error, quota exhaustion, outbox/cron bug) and
nobody notices for days*. The Risk Response Guidance (§2) requires research to
ground three things before any test is written:

1. The **outbox state machine** — claim / lease / attempt budget.
2. The **cron trigger shape** on Cloudflare Workers.
3. **What is mockable at the Brevo HTTP edge.**

This document is the **oracle source**: what the outbox *should* do per failure
mode (derived from the lease model, the archived plan's intent, and the PRD-level
risk), so tests assert against intended behaviour — not against the
implementation's incidental output.

## Summary

The outbox is a **lease-based retry queue** with a deliberately minimal state
machine: `pending → sent` or `pending → failed`, **no intermediate `sending`
state**. "Claiming" a row *is* the lease — a single SQL RPC (`claim_due_emails`)
atomically bumps `attempts +1` and pushes `next_attempt_at` 5 minutes out under
`FOR UPDATE SKIP LOCKED`. That one primitive is what structurally prevents
double-send across the two dispatch paths (immediate `waitUntil` after enqueue,
and the `*/5 * * * *` cron sweep).

**The single most important fact for test selection:** the dispatch loop is
**non-atomic**. Claiming (write #1) and marking sent/error (write #2) are
separate DB round-trips with the Brevo network call *between* them and **no
enclosing transaction** (`src/lib/email/outbox.ts:41-107`). This is exactly the
shape the test-plan §1 calls out: *write hermetic tests for the partial-failure
branches (write #2 fails), and integration tests for the rules that depend on
real DB state (lease, attempts cap, no-op).*

**Coverage status — this risk is partially covered, and the gap is the point of
Phase 3.** `tests/unit/email.test.ts` already exercises the drain logic, but it
does so by **mocking the admin (Supabase) client** — i.e. mocking the outbox
internals, the exact anti-pattern §2 warns against for this risk ("Mocking
outbox internals instead of the network edge"). `tests/db/email-outbox.test.ts`
proves the SQL primitive (RLS, lease, concurrency, cap) against real Postgres but
never drives `drainDueEmails`. **Neither layer runs the real claim→send→mark
loop against real Supabase with only the Brevo HTTP edge mocked.** That
integration seam — plus hermetic tests for the two partial-failure branches —
is Phase 3's unique signal.

## Detailed Findings

### Area 1 — The outbox state machine (claim / lease / attempt budget)

**Table** (`supabase/migrations/20260607120000_email_outbox.sql:14-27`):

```sql
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  to_email text not null,
  subject text not null,
  html text not null,
  reply_to text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  provider_message_id text
);
```

- `status` is enum-by-CHECK: `pending | sent | failed`. **No `sending` state** — the
  lease covers the in-flight window.
- `attempts` is bumped **by the claim**, not by the send (post-claim counter).
- `next_attempt_at` is both the **due clock** and the **lease expiry / backoff**.
- Partial index for due rows (`:31`): `... on (next_attempt_at) where status = 'pending'`.
- **RLS enabled, zero policies** (`:34`) → deny-all; only `service_role` (RLS-bypassing
  admin client) touches the table. No FKs, no unique constraints beyond the PK.

**The claim/lease RPC** — current definition pins `search_path`
(`supabase/migrations/20260608000000_claim_due_emails_search_path.sql:12-32`,
supersedes the original at `20260607120000_email_outbox.sql:40-59`):

```sql
create or replace function public.claim_due_emails(p_limit int default 10, p_id uuid default null)
returns setof public.email_outbox
language sql
set search_path = ''
as $$
  update public.email_outbox e
  set attempts = e.attempts + 1,
      next_attempt_at = now() + interval '5 minutes'
  from (
    select id from public.email_outbox
    where status = 'pending'
      and next_attempt_at <= now()
      and attempts < 5
      and (p_id is null or id = p_id)
    order by created_at
    limit p_limit
    for update skip locked
  ) due
  where e.id = due.id
  returning e.*;
$$;
```

- **Race safety**: `FOR UPDATE SKIP LOCKED` → concurrent claimers take disjoint
  row sets.
- **Claim = lease**: the UPDATE bumps `attempts +1` and pushes `next_attempt_at`
  5 min out; the returned row carries the **post-bump** `attempts`.
- **Targeted claim**: `p_id` lets the immediate path claim only the just-enqueued
  row; `p_limit` (default 10; cron passes 25) batches the sweep.
- FIFO by `created_at`. `EXECUTE` revoked from public/anon/authenticated (`:34`).

**Attempt budget** = **5**, enforced in two places that must agree:
- SQL predicate `attempts < 5` (RPC `:24`) — a row at 5 is never re-claimed.
- TS `MAX_ATTEMPTS = 5` (`src/lib/email/outbox.ts:16`); exhaustion test
  `row.attempts >= MAX_ATTEMPTS` (`:91`). These line up *only because* the claim
  bumps before returning — a row claimed for its 5th try arrives with
  `attempts === 5`.

**State diagram (the oracle):**

```
                 enqueue (INSERT, status=pending, attempts=0, next_attempt_at=now())
                        │
                        ▼
                   ┌──────────┐  claim: attempts+1, next_attempt_at += 5min
   ┌── claim ─────►│ pending  │◄── re-claimable once lease expires AND attempts<5
   │ (attempts<5   └──────────┘
   │  & due)             │
   │              sendViaBrevo (never throws)
   │            ┌────────┴─────────┐
   │      ok    │                  │  not ok
   │            ▼                  ▼
   │      ┌──────────┐     attempts >= 5 ? ──yes──► ┌──────────┐
   │      │  sent    │              │               │  failed  │ (terminal)
   │      │(terminal)│              no              └──────────┘
   │      └──────────┘              │
   └─────────────────────  stays pending (lease = backoff) ◄┘
```

### Area 2 — Cron trigger + Worker dispatch shape

- **Schedule** (`wrangler.jsonc:14-16`): `"triggers": { "crons": ["*/5 * * * *"] }`
  — every 5 minutes; confirmed to survive the build into
  `dist/server/wrangler.json`. Per config comments the cron is **retry-only**:
  the immediate `waitUntil` attempt on the request path carries the <5-min
  delivery NFR; the cron just sweeps stragglers.
- **Scheduled handler** (`src/worker.ts:27-51`): a custom Worker default export
  composes Astro's `fetch` handler with a `scheduled(controller, env, ctx)`
  handler. The cron path is:
  Cloudflare fires `scheduled` → build admin client + `EmailConfig` from **raw
  `env` bindings** (not `astro:env`, which is unavailable off the request path)
  → `ctx.waitUntil(drainDueEmails(admin, config, { limit: 25 }))`.
- **Astro-on-Workers wiring**: `astro.config.mjs:16` `adapter: cloudflare()`;
  `wrangler.jsonc:8-11` `"main": "./src/worker.ts"` replaces the adapter's
  default server entry (`config.main ?? "@astrojs/cloudflare/entrypoints/server"`),
  so `scheduled` ships in the **same Worker** as `fetch` — no second deployment.
- **Admin client acquisition** (`src/lib/supabase-admin.ts:17-26`):
  `createAdminClient(override?)` accepts a `{ url, serviceKey }` override
  *specifically* so the cron can pass raw env bindings; request-path callers omit
  it and fall back to `astro:env/server`. RLS-bypassing service-role client.
- **The manual/smoke trigger** (`src/pages/api/dev/test-email.ts:19-57`,
  `POST /api/dev/test-email`, `prerender = false`):
  - **Auth**: requires `locals.user` → 401 if absent; 400 if the user has no
    email. Self-limiting — sends **only to the signed-in user's own email**, no
    recipient input.
  - **Rate limit**: **none** (documented accepted risk, see Historical Context).
  - **Behaviour**: runs the full production path but **captures and awaits** the
    `waitUntil` drain, so the `DrainResult` (`{ enqueued, id, result }`) lands in
    the JSON response as smoke evidence. It is the only **network-reachable**
    drain trigger.

**Test-reachability of the two entry points:** the `scheduled` export is a
Worker-level handler not exposed through the Astro/HTTP harness. The cheapest way
to exercise cron *behaviour* is to call `drainDueEmails(admin, config, {limit:25})`
directly (or invoke the worker default export's `scheduled` with stub `env`/`ctx`).
The HTTP smoke endpoint is the only route-level trigger.

### Area 3 — The Brevo HTTP edge (what to mock)

**The only module that touches the network** is `sendViaBrevo`
(`src/lib/email/brevo.ts`) — mock `fetch` here, not the outbox internals.

- **Request** (`brevo.ts:16,22-34`): `POST https://api.brevo.com/v3/smtp/email`,
  headers `api-key`, `content-type: application/json`, `accept: application/json`;
  body `{ sender:{name,email}, to:[{email}], subject, htmlContent, replyTo?:{email} }`.
- **Return contract** (`brevo.ts:14`):
  `{ ok: true; messageId: string } | { ok: false; error: string }`.
  **Never throws** — non-2xx and thrown fetch errors both map to `{ ok:false }`
  (`brevo.ts:36-39`, `:48-50`).
- **2xx without messageId** (`brevo.ts:41-47`): logs a `console.warn` but still
  returns `{ ok:true, messageId: "" }` → row marked `sent` with empty
  `provider_message_id`.
- **Config** (`src/lib/email/config.ts`): `getEmailConfig()` returns `null` unless
  **both** `BREVO_API_KEY` and `EMAIL_FROM` are set (`config.ts:18`);
  `EMAIL_FROM_NAME` defaults to `"Zagroda Hub"`. Env schema:
  `astro.config.mjs:23-25` (all three `server`/`secret`/`optional`).

**The null-config no-op (oracle confirmed — code intent and behaviour agree)**
`src/lib/email/outbox.ts:46-53`:

```js
if (!config) {
  // No-op mode must NOT call the claim RPC — claiming bumps `attempts`,
  // which would consume the retry budget. Rows stay genuinely pending and
  // fully claimable once env is configured.
  console.warn("[email] channel unconfigured — drain skipped, rows stay pending");
  return { claimed: 0, sent: 0, failed: 0 };
}
```

→ Returns **before** the claim RPC, so it **consumes no retry budget**. Marker
string to assert: `"[email] channel unconfigured — drain skipped, rows stay pending"`.

**Error interpretation by the drain** (`outbox.ts:90-104`): on `{ ok:false }` it
sets `last_error`; only if `row.attempts >= 5` does it also set `status:'failed'`
and increment `failed`. Non-exhausted rows stay `pending` and the lease
(`next_attempt_at + 5min`) is the backoff.

**Quota (300/day) is NOT special-cased.** A Brevo 429 flows through the generic
non-2xx branch → `{ ok:false, error:"Brevo responded 429: ..." }` → treated like
any other failure (retry until `attempts >= 5`, then terminal `failed`), with no
longer backoff. The 300/day cap appears only as a comment
(`src/pages/api/dev/test-email.ts:12-13`). **Oracle note:** if the intended
behaviour for quota is "back off longer / don't burn the budget", the code does
not do that — assert against intent and flag the gap, don't mirror the code.

### Area 4 — Existing coverage (what NOT to re-test) and the gap

**Already covered — do not duplicate:**

- **SQL primitive** — `tests/db/email-outbox.test.ts` (real Postgres): RLS
  deny-all + RPC execute denial (`:62-91`); lease bump +5 min and immediate
  re-claim returns 0 (`:95-109`); concurrent-claim disjointness via SKIP LOCKED
  (`:111-129`); attempts cap — a row at 5 is never claimed (`:131-141`); targeted
  `p_id` claim (`:143-156`). Wipes the table in `beforeAll` (`:57`) for
  determinism.
- **Brevo payload contract + drain branches at the UNIT layer** —
  `tests/unit/email.test.ts`: request shape & headers (`:93-129`); non-2xx and
  thrown-fetch → `{ok:false}` (`:131-149`); null-config no-op (`:153-164`);
  failed-below-cap stays pending (`:166-176`); failed-at-cap → failed (`:178-188`);
  success → sent + messageId + sent_at (`:190-200`). **But these mock the admin
  client** (`:44-79`) — outbox internals are mocked, the §2 anti-pattern for this
  risk.
- **Enqueue side-effects at the API layer** — `tests/api/guest-input.test.ts`:
  valid request → guest + owner outbox rows present (`:120-139`); unpublished
  zagroda → no outbox rows (`:173-185`), via `outboxCountFor()` (`:87-93`).
- **Email body escaping / link construction** — `tests/unit/booking.test.ts:81-189`.

**The Phase 3 gap (the unique signal):**

1. **Integration drain** — `drainDueEmails` against **real local Supabase** with
   only the **Brevo `fetch` edge mocked**, proving: success → `sent` +
   `provider_message_id`; provider failure below cap → row **claimable for retry**
   (stays `pending`, `last_error` set, `next_attempt_at` advanced); failure at cap
   → terminal `failed`, never re-claimed; **no double-send** across an
   immediate-then-cron sequence; null config → logged no-op consuming **zero**
   attempts.
2. **Hermetic partial-failure branches** (real infra cannot easily trigger these
   — stub the admin client's *second* write only):
   - **Mark-sent fails after Brevo 2xx** (`outbox.ts:81-88`): row must **stay
     `pending`** (NOT flipped to `failed`); mail is considered delivered; a
     bounded re-send (≤5) is the accepted consequence.
   - **Mark-error write itself fails** (`outbox.ts:96-99`): swallowed → `attempts`
     already burned by the claim but `last_error`/`status` not persisted. Oracle:
     this is a silent retry-budget leak; pin the intended behaviour.
3. **Observability of a stuck outbox** (risk #2's "nobody notices for days"): the
   only signals today are `console.warn`/`console.error` on the no-config and
   claim-failure branches (`outbox.ts:51,61`; `worker.ts:38`). The §3 line item
   for this risk includes "make a stuck outbox observable" + a **manual pre-prod
   smoke criterion** (§5 gate, optional after Phase 3).

## Code References

- `supabase/migrations/20260607120000_email_outbox.sql:14-31` — outbox table, due index, RLS deny-all
- `supabase/migrations/20260608000000_claim_due_emails_search_path.sql:12-34` — current claim/lease RPC (the primitive)
- `src/lib/email/outbox.ts:18-33` — `enqueueEmail` (INSERT)
- `src/lib/email/outbox.ts:41-107` — `drainDueEmails` (the **non-atomic** claim→send→mark loop; the oracle)
- `src/lib/email/outbox.ts:46-53` — null-config no-op (consumes no retry)
- `src/lib/email/outbox.ts:81-88` — mark-sent-failure → bounded duplicate send (hermetic target)
- `src/lib/email/outbox.ts:91-104` — error branch, attempts-cap → terminal `failed`
- `src/lib/email/brevo.ts:14-50` — `sendViaBrevo`, the only network edge; never throws
- `src/lib/email/config.ts:18` — null-config trigger (`!BREVO_API_KEY || !EMAIL_FROM`)
- `src/lib/email/index.ts:29-60` — `sendTransactionalEmail` (enqueue + immediate targeted `waitUntil` drain)
- `src/worker.ts:27-51` — Worker `scheduled` cron handler → `drainDueEmails({limit:25})`
- `src/lib/supabase-admin.ts:17-26` — `createAdminClient(override?)` (cron passes raw env)
- `wrangler.jsonc:8-16` — custom `main` + `*/5 * * * *` cron
- `astro.config.mjs:16,23-25` — cloudflare adapter; email env schema
- `src/pages/api/dev/test-email.ts:6,11-13,19-57` — auth-only, un-rate-limited smoke endpoint
- `src/pages/api/booking-request/{index.ts:114-116,accept.ts:85,reject.ts:72,withdraw.ts:72}` — enqueue trigger sites
- `tests/db/email-outbox.test.ts:57-156` — SQL-primitive coverage (real Postgres)
- `tests/unit/email.test.ts:44-200` — drain coverage with **mocked admin client** (gap to close at integration)
- `tests/api/guest-input.test.ts:87-93,120-139,173-185` — enqueue side-effect assertions
- `tests/helpers/astro-env.ts:10-18` — env split: SERVICE_ROLE set (outbox observable), BREVO unset (drain no-ops)
- `tests/helpers/global-setup.ts:73-94` — local-stack credential injection; refuses non-local DB unless `ALLOW_REMOTE_TEST_DB=1`
- `vitest.config.ts:16-25` — aliases (`astro:env/server` → stub), `fileParallelism:false`, include glob

## Architecture Insights

- **Lease == claim.** There is no separate "sending" state or lock table. The
  single `claim_due_emails` RPC, shared by both dispatch paths, is the entire
  concurrency story. Any test that "proves no double-send" must go through that
  RPC, not around it.
- **Non-atomic by design.** The plan accepted that claim and mark are separate
  writes; the consequence (bounded duplicate send on mark-sent failure) was
  reviewed and accepted (archive F3). This is *why* the partial-failure branches
  are hermetic, not integration, tests — real Supabase will not fail write #2 on
  command.
- **Two TS↔SQL coupling points to pin** so they cannot silently drift:
  `MAX_ATTEMPTS = 5` (TS) vs `attempts < 5` (SQL), and the post-claim bump timing.
- **Test harness is already outbox-aware**: `SUPABASE_SERVICE_ROLE_KEY` is set so
  outbox rows are observable, and `BREVO_API_KEY`/`EMAIL_FROM` are unset so any
  incidental drain is a no-op (zero network egress). A Phase 3 integration test
  that wants the *real* send branch must **inject a literal `EmailConfig` and mock
  `fetch`** — it cannot make `getEmailConfig()` truthy via the env stub.
- **Determinism trap**: because the claim orders by `created_at` and stale
  expired-lease rows sort ahead of fresh fixtures, new outbox integration tests
  must wipe the table in `beforeAll` (as `tests/db/email-outbox.test.ts:57` does).

## Open Questions

1. **Quota (429) backoff oracle.** Should a Brevo 429 burn the 5-attempt budget at
   the fixed 5-min lease like any other failure (current behaviour), or back off
   longer / not consume the budget? The PRD/risk note doesn't specify. *Stop and
   confirm with the team before asserting either way* — do not lift the answer
   from the code.
2. **Mark-error-write-failure oracle** (`outbox.ts:96-99`). The budget is consumed
   but nothing is recorded. Is the intended behaviour "best-effort, accept the
   leak" (matching the accepted-risk posture) or should it be observable? Needs an
   intent decision before a hermetic test pins it.
3. **`provider_message_id: ""` on 2xx-without-messageId** (`brevo.ts:41-47`). Is a
   sent row with an empty provider id acceptable (audit-trail loss, current
   behaviour) or should the absence of a messageId be treated as a soft failure?
4. **"Make a stuck outbox observable"** (§3 Phase 3 goal). What is the observable
   signal — a count/age query, a structured log, a health endpoint? Today only
   `console.*` exists. The deliverable likely pairs an integration assertion with
   the **manual pre-prod smoke criterion** (§5), not a new feature; confirm scope
   so Phase 3 stays a *testing* phase, not a feature build.

## Historical Context (from prior changes)

The outbox was built in the now-archived **transactional-email-channel** change
(F-02), 2026-06-07:

- `context/archive/2026-06-07-transactional-email-channel/plan.md:5,45-46,64-93` —
  designed as a durable `email_outbox` with **hybrid dispatch** (immediate
  `waitUntil` + `*/5` cron), lease model (atomic `attempts +1`, +5 min), terminal
  `failed` after `attempts >= 5`, claim via `FOR UPDATE SKIP LOCKED`,
  service-role-only execute. This is the **intent source** for the oracle.
- `context/archive/2026-06-07-transactional-email-channel/change.md:19-26,41-55` —
  local verification recorded the exact retry-path oracle:
  *broken `BREVO_API_KEY` → `enqueued:true, claimed:1, sent:0, failed:0`, row
  stays `pending`, `attempts 0→1`, `last_error` captured, lease +5 min*; no-op
  mode → `claimed:0,sent:0,failed:0`, claim RPC not called; prod smoke →
  `{enqueued:true,claimed:1,sent:1,failed:0}`, ~175 ms enqueue→provider.
- `context/archive/2026-06-07-transactional-email-channel/reviews/impl-review.md:33-89`
  — three decisions that bound Phase 3's oracle:
  - **F2** (`/api/dev/test-email` quota-exhaustible): **ACCEPTED** as-is —
    auth-only, self-addressed, un-rate-limited; must stay reachable in prod for
    smoke. (Mirrors CLAUDE.md.scaffold accepted-risk note.)
  - **F3** (sent-but-mark-failed → duplicate resend): **ACCEPTED**, bounded to ≤5
    by the cap; idempotency key deferred. → This is the hermetic mark-sent test's
    expected behaviour.
  - **F5** (claim RPC missing `search_path`): **FIXED** via migration
    `20260608000000_claim_due_emails_search_path.sql`.
- `context/foundation/lessons.md:19-24` — the F-02 prod-smoke incident: PowerShell
  `"value" | wrangler secret put` appended a trailing `\n`, corrupting
  `SUPABASE_SERVICE_ROLE_KEY` (silent `enqueued:false`) and `BREVO_API_KEY` (Brevo
  401). **This is an environment/secrets failure mode, not an outbox-logic one** —
  the §5 pre-prod smoke criterion is the right place to catch it; an integration
  test cannot.
- `CLAUDE.md.scaffold:38-39` — accepted-risk note: Brevo free tier 300/day; the
  un-rate-limited smoke endpoint can drain the quota and starve booking emails.
  Quota-drain remediation is delegated to Cloudflare WAF, not app code
  (test-plan §7, decision 2026-06-13).

## Related Research

- `context/foundation/test-plan.md` — §2 risk #2 + Risk Response Guidance (the
  brief this research answers); §3 Phase 3 row; §4 (no API-mock tooling yet —
  Phase 3 picks the Brevo edge-mock strategy); §6.5 cookbook stub to be filled
  when this phase ships.
- `context/archive/2026-06-12-testing-http-surface-booking/` — Phase 1 (HTTP-surface
  integration); established the `tests/api/` harness (`runRoute`, real middleware,
  the env stub) that the Phase 3 integration tests build on.
