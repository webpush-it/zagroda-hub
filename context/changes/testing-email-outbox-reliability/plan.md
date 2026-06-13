# Email Outbox Reliability — Test Rollout Phase 3 Implementation Plan

## Overview

Phase 3 of the project's phased test rollout (test-plan §3) covers **risk #2** —
*transactional email silently stops (provider error, quota exhaustion,
outbox/cron bug) and nobody notices for days*. The unique signal this phase
adds is the **integration seam nobody runs today**: the real
`claim → send → mark` drain loop (`drainDueEmails`) against **real local
Supabase** with **only the Brevo HTTP edge mocked** — plus hermetic coverage of
the two partial-failure branches real infra can't trigger, assertions on the
existing observability signals, and a manual pre-prod smoke criterion for the
env failure mode no integration test can catch.

The oracle for every assertion comes from the research doc
(`context/changes/testing-email-outbox-reliability/research.md`), the archived
F-02 plan's stated intent, and the test-plan §2 Risk Response Guidance — never
from the implementation's incidental output.

## Current State Analysis

The outbox is a lease-based retry queue with a deliberately minimal state
machine (`pending → sent` | `pending → failed`, no `sending` state). The claim
RPC *is* the lease. The dispatch loop (`src/lib/email/outbox.ts:41-107`) is
**non-atomic by design**: claim (write #1) and mark sent/error (write #2) are
separate DB round-trips with the Brevo network call between them, no enclosing
transaction. This is exactly the shape test-plan §1 calls out — integration
tests for rules that depend on real DB state, hermetic tests for the
partial-failure branches.

**Existing coverage (do NOT duplicate):**

- `tests/db/email-outbox.test.ts` — proves the SQL primitive against real
  Postgres (RLS deny-all, lease bump +5 min, SKIP LOCKED disjointness, attempts
  cap, targeted `p_id`). **Never drives `drainDueEmails`.**
- `tests/unit/email.test.ts` — drives the drain but **mocks the admin client**
  (the §2 anti-pattern for this risk). Covers the Brevo payload contract,
  non-2xx/throw → `{ok:false}`, null-config no-op, failed-below-cap stays
  pending, failed-at-cap → failed, success → sent.
- `tests/api/guest-input.test.ts` — enqueue side-effects at the API layer.

**The gap (the unique Phase 3 signal):** neither layer runs the real
claim→send→mark loop against real Supabase with only the Brevo edge mocked, and
the two partial-failure branches (`outbox.ts:81-88`, `:96-99`) and the
claim-RPC-error branch (`:59-63`) are untested.

### Key Discoveries:

- **`vi.stubGlobal("fetch")` is out for the integration layer.** The real
  `supabase-js` admin client uses `fetch` internally — the unit test mocks the
  client *precisely because* stubbing global fetch would break a real client
  (`tests/unit/email.test.ts:11-13`). The integration tests need a **selective**
  fetch mock that intercepts only `api.brevo.com` and delegates everything else
  to real fetch.
- **The env stub cannot make `getEmailConfig()` truthy.**
  `tests/helpers/astro-env.ts:16-18` leaves `BREVO_API_KEY`/`EMAIL_FROM` unset
  so incidental drains no-op. A Phase 3 integration test that wants the *real*
  send branch must **inject a literal `EmailConfig`** into `drainDueEmails` and
  mock `fetch` — it does not flip the env (research Architecture Insights).
- **Determinism trap.** `claim_due_emails` orders by `created_at`, and stale
  expired-lease rows sort ahead of fresh fixtures. New outbox integration tests
  **must wipe the table in `beforeAll`** (as `tests/db/email-outbox.test.ts:57`
  does).
- **`SUPABASE_SERVICE_ROLE_KEY` is set** in the harness, so outbox rows are
  observable via `createAdminClient()` (`tests/helpers/supabase.ts:18-20`).
- **The attempts counter is post-claim.** A row claimed for its 5th try arrives
  with `attempts === 5`; `MAX_ATTEMPTS = 5` (TS) and `attempts < 5` (SQL) agree
  only because of this (research Area 1). Fixtures must seed `attempts` with the
  *pre-claim* value (e.g. seed `attempts: 4` to test the at-cap path, since the
  claim bumps it to 5).
- **Reachable drain entry point for tests** is `drainDueEmails(admin, config,
  opts)` called directly. The Worker `scheduled` export is not exposed through
  the Astro/HTTP harness (research Area 2); calling the function directly is the
  cheapest way to exercise cron *behaviour*.

## Desired End State

After this plan:

- A reusable `tests/helpers/brevo-mock.ts` lets any test program Brevo edge
  responses (2xx+messageId, 2xx-no-messageId, non-2xx, network throw) while real
  supabase-js traffic passes through untouched.
- `tests/db/email-outbox-drain.test.ts` proves, against real Supabase, every
  failure-mode the Risk Response Guidance demands: provider failure leaves the
  row claimable for retry, an already-sent row is never re-claimed (drain-level;
  the lease's own no-double-send guarantee stays SQL-covered by
  `tests/db/email-outbox.test.ts`), hard-fails after the budget, and null config
  is a logged no-op consuming zero attempts.
- `tests/unit/email.test.ts` additionally pins the three branches real infra
  can't trigger: mark-sent-fails (row stays pending), mark-error-write-fails
  (swallowed, no throw), claim-RPC-error (logged no-op).
- The cookbook §6.5 documents the edge-mock + retry/no-double-send pattern, §6.6
  carries a Phase 3 note, test-plan §5 carries a concrete manual pre-prod smoke
  criterion, and §3 Phase 3 status is `complete`.
- Verify: `npx supabase start` then `npm test` runs green; the new db file
  exercises the real drain; `git grep` shows §3 Phase 3 status `complete`.

## What We're NOT Doing

- **No 429 / quota-exhaustion assertion.** A Brevo 429 is treated as a generic
  failure today; quota remediation is delegated to Cloudflare WAF, not app code
  (test-plan §7, decision 2026-06-13). Phase 3 adds no automated 429 coverage.
- **No new runtime / observability code.** "Make a stuck outbox observable" is
  satisfied at the test layer (assert the existing `console.*` signals) plus the
  manual pre-prod smoke criterion. No health endpoint, no stuck-row query helper,
  no new logging fields.
- **No code changes to `src/lib/email/`.** This is a testing phase. The mark-error
  budget-leak and the empty-`provider_message_id` cases are pinned as
  *intended/accepted* behaviour, not fixed.
- **No re-testing the SQL primitive** (`tests/db/email-outbox.test.ts` already
  proves RLS, lease, SKIP LOCKED, cap, `p_id`).
- **No re-testing the Brevo payload contract at the unit layer**
  (`tests/unit/email.test.ts:92-150` already locks headers/body/return mapping).
- **No e2e, no Worker `scheduled` HTTP harness, no CI gate wiring** (Phase 2 /
  Phase 4 / later lessons).

## Implementation Approach

Build bottom-up, mirroring the test-plan chain (environment → dependent rules →
hermetic → cookbook): first the edge-mock capability the integration tests
depend on, then the integration drain suite (the unique signal), then the
hermetic partial-failure branches, then documentation and status sync. Phases 2
and 3 are TDD'able (each test names an observable outcome before any code); the
mock helper (Phase 1) and the docs/sync (Phase 4) route to `/10x-implement`.

## Critical Implementation Details

- **Selective fetch routing, not global stub.** The Phase 1 helper must capture
  the original `globalThis.fetch`, install a wrapper that inspects the request
  URL, return the next queued mock response when the host is `api.brevo.com`
  (and for `mockReject`, throw to exercise `sendViaBrevo`'s catch at
  `brevo.ts:48-50`), and call the captured real fetch for every other URL so
  supabase-js keeps working. **Normalize the first `fetch` arg before
  host-matching** — `fetch` may be called with a string, a `URL`, or a `Request`
  (`typeof input === "string" ? input : input instanceof Request ? input.url :
  String(input)`). A naive `input.url` read assumes a `Request` and is `undefined`
  for the string form `sendViaBrevo` actually uses, so the Brevo match would
  silently never fire and every send would hit the real network (manual check 2.4
  would catch it, but late). It must expose a teardown that restores the original
  fetch in `afterEach` — a leaked stub silently breaks later files
  (`fileParallelism: false` means files share a process).
- **Fixture attempts are pre-claim.** To assert the at-cap terminal-`failed`
  path through the *real* claim, seed the row with `attempts: 4`; the claim
  bumps it to 5 and the drain then sees `row.attempts >= MAX_ATTEMPTS`. Seeding
  `attempts: 5` makes the row un-claimable (the SQL predicate is `attempts < 5`),
  which would test the wrong thing.
- **Sent-row-not-re-claimed sequence.** Enqueue one row, drain it (immediate path,
  mocked 2xx → `status='sent'`), then drain again — the second claim must return
  zero rows, so exactly one Brevo call fires. The guard is the `status='pending'`
  predicate in `claim_due_emails` (a sent row is filtered out), **not** the lease;
  the lease's no-double-send role (still-pending claimed row unclaimable until the
  lease expires; concurrent claims disjoint) is already SQL-covered by
  `tests/db/email-outbox.test.ts` (b)/(c). This case still goes through the real
  `claim_due_emails` RPC; mocking around it would prove nothing.

## Phase 1: Selective Brevo-edge mock helper

### Overview

Create the reusable test helper that mocks only the Brevo HTTP edge while
letting real supabase-js fetch traffic through. This is the "API mocking"
capability test-plan §4 records as missing; every Phase 2 integration test and
the cookbook §6.5 pattern depend on it.

### Changes Required:

#### 1. Brevo edge-mock helper

**File**: `tests/helpers/brevo-mock.ts` (new)

**Intent**: Provide a programmable mock for the Brevo send endpoint that does
not disturb supabase-js, so integration tests can drive `drainDueEmails`'s real
DB writes while controlling the provider's response. Mirrors the unit test's
intent (control the network edge) but for a real-client context.

**Contract**: Exposes an installer that, once active, routes `POST
https://api.brevo.com/v3/smtp/email` to a caller-controlled response and
delegates all other requests to the original `globalThis.fetch`. The mock must
support, per call: a 2xx with a `messageId`, a 2xx **without** a `messageId`
(empty-id oracle), a non-2xx status with a body (generic failure), and a thrown
network error (`sendViaBrevo` catch path). It records the Brevo requests it saw
(count + parsed bodies) for assertions, and provides a teardown restoring the
original fetch. Match `sendViaBrevo`'s expectations exactly: response `.ok`,
`.status`, `.text()`, and `.json()` returning `{ messageId? }`
(`brevo.ts:36-47`). Default install location for callers is `afterEach`
teardown so no stub leaks across files.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- The helper file is importable under node (no `astro:` virtual-module imports):
  `npx vitest run tests/db/email-outbox.test.ts` still green (regression guard —
  no global-fetch leak introduced)

#### Manual Verification:

- A scratch test confirms: a mocked Brevo 2xx is returned for `api.brevo.com`,
  while a `supabase-js` query in the same test still reaches the local DB
  (proves selective routing, not a global stub).

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Integration drain tests (real Supabase + mocked Brevo edge)

### Overview

Drive the real `drainDueEmails` claim→send→mark loop against the local Supabase
stack with only the Brevo edge mocked. This is the phase's unique signal — the
seam neither existing layer exercises. TDD'able: each test names an observable
outcome first.

### Changes Required:

#### 1. Integration drain suite

**File**: `tests/db/email-outbox-drain.test.ts` (new)

**Intent**: Prove every risk #2 failure-mode the Risk Response Guidance demands,
through the real RPC and real DB writes, asserting against the oracle (research
state diagram + archived F-02 verification log), not the code's output.

**Contract**: Uses `createAdminClient()` (`tests/helpers/supabase.ts`) for real
DB access and the Phase 1 edge mock for the provider. Injects a **literal
`EmailConfig`** (the env stub leaves config null). Wipes `email_outbox` in
`beforeAll` (determinism trap). Restores fetch in `afterEach`. Test cases:

- **success → `sent` + provider_message_id**: enqueue, mock 2xx+messageId, drain
  by `p_id`; assert row `status='sent'`, `provider_message_id` set, `sent_at`
  set, `DrainResult {claimed:1, sent:1, failed:0}`.
- **2xx without messageId → `sent` + empty id + warn** (empty-id oracle:
  accepted): mock 2xx with no `messageId`; assert `status='sent'`,
  `provider_message_id === ''`, and a `console.warn` fired (`brevo.ts:45`).
- **failure below cap → stays claimable**: seed a fresh row, mock non-2xx; assert
  row stays `status='pending'`, `last_error` set, `attempts` bumped, and
  `next_attempt_at` advanced ~5 min (lease = backoff); `DrainResult
  {claimed:1, sent:0, failed:0}`.
- **failure at cap → terminal `failed`**: seed `attempts: 4` (claim bumps to 5),
  mock non-2xx; assert `status='failed'`, `last_error` set; row is never
  re-claimed by a subsequent `claim_due_emails`; `DrainResult {failed:1}`.
- **a sent row is not re-claimed by a subsequent drain**: enqueue one row, drain
  (mock 2xx → row flips to `status='sent'`), drain again; assert exactly one Brevo
  request was recorded and the second drain claimed zero rows. Note the guard
  here is the `status='pending'` filter in `claim_due_emails` (a sent row is
  excluded regardless of lease), *not* the lease — the lease's own no-double-send
  guarantee (a still-pending claimed row is unclaimable until `next_attempt_at`
  expires, and concurrent claims are disjoint) is already proven at the SQL layer
  by `tests/db/email-outbox.test.ts` (b)/(c). This case adds the drain-level
  signal that the full claim→send→mark loop never re-sends an already-sent row.
- **null config → logged no-op, zero attempts consumed**: insert a due row, call
  `drainDueEmails(admin, null)`; assert the claim RPC was NOT called (row
  `attempts` unchanged, still `pending`, `next_attempt_at` unmoved), the
  `"[email] channel unconfigured — drain skipped, rows stay pending"` warn fired,
  and `DrainResult {claimed:0, sent:0, failed:0}`.

### Success Criteria:

#### Automated Verification:

- Local stack up (`npx supabase start`), then `npx vitest run tests/db/email-outbox-drain.test.ts` passes
- Full suite still green: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Confirm zero network egress to the real Brevo API during the run (the edge
  mock intercepts every `api.brevo.com` call) — no hangs, run completes within
  the 30 s test timeout.
- Spot-check one assertion against the oracle (e.g. the no-double-send count) to
  confirm it reads from intended behaviour, not from re-deriving the code.

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Hermetic partial-failure & claim-failure branches

### Overview

Pin the three branches real Supabase can't trigger on command, by stubbing the
admin client's relevant write/RPC. Extends the existing
`tests/unit/email.test.ts` (which already carries the mock-admin factory).
TDD'able.

### Changes Required:

#### 1. Mark-sent-failure, mark-error-failure, claim-error tests

**File**: `tests/unit/email.test.ts` (extend; reuse `createMockAdmin` /
`stubFetchResponse`)

**Intent**: Lock the accepted partial-failure behaviour so it can't silently
regress: a sent-but-unmarked row stays pending (bounded duplicate accepted), a
failed mark-error write is swallowed without throwing, and a claim-RPC error is
a logged no-op. Oracle = archived F-02 impl-review F3 (bounded dup accepted) +
research Open Questions resolution (best-effort, accept the leak).

**Contract**: Extend `createMockAdmin` so the second write (`update().eq()`) can
be made to return `{ error: {...} }` on demand (the factory currently always
resolves `{ error: null }`). Test cases:

- **mark-sent fails after Brevo 2xx** (`outbox.ts:81-88`): claimed row, Brevo
  2xx, but the `status:'sent'` update returns an error; assert `drainDueEmails`
  does NOT throw, the row is NOT flipped to `failed`, `console.error` fired with
  the `"failed to mark … sent"` marker, and `DrainResult` still counts `sent:1`
  (mail is considered delivered; a bounded re-send ≤5 is the accepted
  consequence).
- **mark-error write itself fails** (`outbox.ts:96-99`): claimed row, Brevo
  non-2xx, and the `last_error` update returns an error; assert the error is
  swallowed (no throw), `console.error` fired with the `"failed to record error
  for"` marker, and the function returns a coherent `DrainResult`. Pin this as
  intended best-effort behaviour (the attempt is already burned by the claim;
  the leak is accepted).
- **claim RPC error → logged no-op** (`outbox.ts:59-63`): make `rpc` resolve
  `{ data: null, error: {...} }`; assert `console.error` fired with the
  `"claim_due_emails failed"` marker, `DrainResult {claimed:0, sent:0,
  failed:0}`, and no provider call.

### Success Criteria:

#### Automated Verification:

- `npx vitest run tests/unit/email.test.ts` passes (new + existing cases)
- Full suite still green: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Confirm the mark-sent-failure test asserts the row stays `pending` (not
  `failed`) — the load-bearing distinction that documents the bounded-duplicate
  acceptance.

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Documentation & status sync

### Overview

Capture the reusable pattern and the manual gate, and advance the rollout state.
No tests, no code. `/10x-implement`.

### Changes Required:

#### 1. Cookbook §6.5 — email/outbox failure-mode pattern

**File**: `context/foundation/test-plan.md` (§6.5)

**Intent**: Replace the "TBD — see §3 Phase 3" stub with the concrete pattern so
the next contributor can add a provider-edge failure-mode test without
rediscovering the constraints.

**Contract**: Document: location split (integration → `tests/db/`, hermetic →
`tests/unit/`); the selective-edge-mock rule (`tests/helpers/brevo-mock.ts`,
never `vi.stubGlobal("fetch")` against a real client); inject a literal
`EmailConfig` (env stub leaves it null); wipe the table in `beforeAll`; seed
pre-claim `attempts` values; the no-double-send-through-the-real-RPC rule.
Reference tests: `tests/db/email-outbox-drain.test.ts` and the extended
`tests/unit/email.test.ts`.

#### 2. Cookbook §6.6 — Phase 3 note

**File**: `context/foundation/test-plan.md` (§6.6)

**Intent**: Add the 2–3 line "what this phase taught" note.

**Contract**: A bullet dated 2026-06-13 capturing the non-obvious traps (real
client + selective fetch mock; post-claim attempts counter; null-config no-op
consumes zero budget by design).

#### 3. Manual pre-prod smoke criterion — §5

**File**: `context/foundation/test-plan.md` (§5 row "pre-prod smoke (email
deliverability)")

**Intent**: Author the concrete manual criterion (the gate is "optional after §3
Phase 3"), since it's the only artifact that catches the env failure mode no
integration test can — the lessons.md secrets-newline corruption.

**Contract**: A short checklist: after deploy, `POST /api/dev/test-email` as a
signed-in owner; assert the JSON `DrainResult` is
`{enqueued:true, claimed:1, sent:1, failed:0}` (the archived F-02 prod-smoke
oracle); verify the secret values were read correctly at runtime, not merely
listed (per lessons.md "Set wrangler secrets from a newline-free source"); if
`enqueued:false` or Brevo 401, suspect a corrupted secret, not outbox logic.

#### 4. Status sync — §3 + change.md

**File**: `context/foundation/test-plan.md` (§3 Phase 3 row) and
`context/changes/testing-email-outbox-reliability/change.md`

**Intent**: Advance rollout state to reflect the landed phase.

**Contract**: §3 Phase 3 Status `change opened` → `complete`. `change.md`
`status` → `implemented` (or project convention), `updated: 2026-06-13`.

### Success Criteria:

#### Automated Verification:

- §6.5 no longer contains "TBD": `git grep -n "TBD — see §3 Phase 3" context/foundation/test-plan.md` returns nothing for §6.5
- §3 Phase 3 row shows `complete`: `git grep -n "Email outbox reliability" context/foundation/test-plan.md`
- Lint passes (markdown untouched by lint, but run the full gate): `npm test` still green

#### Manual Verification:

- Read §6.5 as a newcomer: it should be enough to author a new provider-edge test
  without re-reading the source.
- The §5 smoke criterion names the secrets-newline failure mode explicitly.

**Implementation Note**: Final phase — confirm the full suite is green and the
test-plan reads coherently before closing the change.

---

## Testing Strategy

### Unit Tests (hermetic, stubbed admin client):

- mark-sent fails → row stays pending (bounded dup accepted)
- mark-error write fails → swallowed, no throw, logged
- claim RPC error → logged no-op
- (existing cases retained: payload contract, null-config, below/at cap, success)

### Integration Tests (real Supabase, mocked Brevo edge):

- success → sent + messageId; 2xx-no-messageId → sent + empty id + warn
- failure below cap → claimable (pending, last_error, lease advanced)
- failure at cap → terminal failed, never re-claimed
- sent row not re-claimed by a subsequent drain (status-filter guard; lease's own no-double-send is SQL-covered)
- null config → logged no-op, zero attempts consumed

### Manual Testing Steps:

1. `npx supabase start`, `npm test` — full suite green.
2. Pre-prod smoke (the new §5 criterion) — run after a real deploy, not part of
   the automated suite.

## Performance Considerations

`fileParallelism: false` (shared DB) is unchanged; the new db file adds a
`beforeAll` table wipe and a handful of round-trips — within the 30 s timeout.
The edge mock removes all real Brevo egress, so no external latency enters the
suite.

## Migration Notes

None — no schema changes. The selective fetch mock must restore the original
`globalThis.fetch` in teardown or it leaks across files (shared process).

## References

- Research: `context/changes/testing-email-outbox-reliability/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 risk #2, §3 Phase 3, §4, §5,
  §6.5/6.6)
- Lessons: `context/foundation/lessons.md` (secrets-newline on Windows)
- Archived intent source: `context/archive/2026-06-07-transactional-email-channel/`
- Drain loop (oracle): `src/lib/email/outbox.ts:41-107`
- Brevo edge: `src/lib/email/brevo.ts:14-50`
- Existing coverage: `tests/db/email-outbox.test.ts`,
  `tests/unit/email.test.ts:44-200`
- Harness: `tests/helpers/supabase.ts`, `tests/helpers/api.ts`,
  `tests/helpers/astro-env.ts`, `vitest.config.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Selective Brevo-edge mock helper

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — b72ffcf
- [x] 1.2 Helper importable under node; `tests/db/email-outbox.test.ts` still green (no global-fetch leak) — b72ffcf

#### Manual

- [x] 1.3 Scratch test confirms selective routing (Brevo mocked, supabase-js reaches local DB) — b72ffcf

### Phase 2: Integration drain tests (real Supabase + mocked Brevo edge)

#### Automated

- [x] 2.1 `npx vitest run tests/db/email-outbox-drain.test.ts` passes — 6e6f819
- [x] 2.2 Full suite still green: `npm test` — 6e6f819
- [x] 2.3 Lint passes: `npm run lint` — 6e6f819

#### Manual

- [x] 2.4 Zero real Brevo egress; run completes within timeout — 6e6f819
- [x] 2.5 Spot-check one assertion reads from the oracle, not the code — 6e6f819

### Phase 3: Hermetic partial-failure & claim-failure branches

#### Automated

- [x] 3.1 `npx vitest run tests/unit/email.test.ts` passes (new + existing)
- [x] 3.2 Full suite still green: `npm test`
- [x] 3.3 Lint passes: `npm run lint`

#### Manual

- [x] 3.4 Mark-sent-failure test asserts row stays `pending` (not `failed`)

### Phase 4: Documentation & status sync

#### Automated

- [ ] 4.1 §6.5 no longer contains "TBD" stub
- [ ] 4.2 §3 Phase 3 row shows `complete`
- [ ] 4.3 `npm test` still green

#### Manual

- [ ] 4.4 §6.5 is sufficient to author a new provider-edge test without re-reading source
- [ ] 4.5 §5 smoke criterion names the secrets-newline failure mode explicitly
