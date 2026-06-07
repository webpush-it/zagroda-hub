# Transactional Email Channel (F-02) Implementation Plan

## Overview

Wire the application's transactional-email channel on Cloudflare Workers: a durable `email_outbox` table in Supabase, a hybrid dispatcher (immediate attempt via `waitUntil` + a 5-minute Cron Trigger sweep for retries), and Brevo's HTTP API as the delivery provider (single-sender verification, no domain required). The foundation ships a generic, typed send contract plus a shared HTML layout helper — the actual booking emails (FR-005, FR-011, FR-016) are built later by S-03/S-04/S-05 on top of this channel. One delivery path is verified end-to-end in production with timestamped evidence under the 5-minute NFR.

This settles `infrastructure.md` Risk #8 (email mechanism on Workers): **external HTTP provider (Brevo) + outbox + Cron Trigger sweep**.

## Current State Analysis

- **No app email code exists.** Auth emails (signup verification) go natively through Supabase Auth's built-in SMTP (`supabase/config.toml` `[auth.email]`, custom template `supabase/templates/confirmation.html`). S-01 documented that path as dev-grade/rate-limited and explicitly deferred the provider decision to F-02 (`context/archive/2026-06-05-owner-publishes-zagroda/plan.md:201`). Auth emails stay on Supabase Auth — out of scope here.
- **Runtime is `workerd`, not Node** — no raw SMTP, no Node-only SDKs (`infrastructure.md` Risks #3/#4). Brevo's API is a plain `fetch` POST, zero bundle impact.
- **Worker entry today is adapter-default.** `wrangler.jsonc` is minimal (name, `compatibility_date: 2026-04-15`, observability) — no `main`, no `triggers`. Astro 6 / `@astrojs/cloudflare` v13 supports a custom Worker entry that composes the Astro `fetch` handler with a `scheduled` handler (the v12 `workerEntryPoint` adapter option was removed; the replacement is a standard Worker export + `main` in the Wrangler config — see Critical Implementation Details).
- **Supabase access is anon-key only.** `src/lib/supabase.ts:3` builds the SSR client from `astro:env/server` (`SUPABASE_URL`/`SUPABASE_KEY`, both optional) and returns `null` when unconfigured — every caller guards. No service-role client exists yet; the outbox (internal infrastructure, deny-all RLS) needs one.
- **Conventions in force**: zod validation in API routes (`src/pages/api/auth/signup.ts:5-8`), `export const prerender = false` on API routes, services in `src/lib/`, migrations `supabase/migrations/YYYYMMDDHHmmss_desc.sql` with RLS always enabled, vitest DB tests in `tests/db/` against the local Supabase stack (helpers in `tests/helpers/supabase.ts`), CI jobs `ci`/`test`/`deploy` in `.github/workflows/ci.yml`, and the deploy lesson: migrations push **before** the worker (`npm run deploy` = build → `db:push` → `wrangler deploy`; same order in the CI deploy job) — `context/foundation/lessons.md:12-17`.
- **Recipient lookup paths for future consumers already exist**: `booking_requests.guest_email` (guest side) and `zagrody.owner_id → auth.users.email` (owner side, requires service-role/SECURITY DEFINER to read `auth.users`).

## Desired End State

Any server-side code path can call `sendTransactionalEmail(...)` with `{to, subject, html, replyTo?}`; the message is durably recorded in `email_outbox`, delivered via Brevo within seconds in the typical case, retried by the cron sweep on transient failure, and visible (status/attempts/error) in the table. When email env vars are missing (local dev, CI), the channel degrades to a logged no-op without breaking callers. A guarded `POST /api/dev/test-email` endpoint exercises the full production path; the prod smoke records send→inbox timestamps proving < 5 minutes.

Verify by: `npm test` green (DB + unit suites), `npm run lint` and `npm run build` green, and the manual prod smoke described in Phase 3.

### Key Discoveries:

- Brevo transactional send is `POST https://api.brevo.com/v3/smtp/email` with `api-key` header and `{sender:{name,email}, to:[{email}], subject, htmlContent, replyTo?:{email}}` — plain fetch, single replyTo supported ([Brevo docs](https://developers.brevo.com/docs/send-a-transactional-email)). Free tier: 300 emails/day.
- Astro 6 + `@astrojs/cloudflare` v13: custom Worker entry = a module exporting a standard `{ fetch, scheduled }` Worker object that delegates `fetch` to the adapter's handler, referenced from the Wrangler config `main` ([Astro Cloudflare guide](https://docs.astro.build/en/guides/integrations-guide/cloudflare/), [withastro/astro#13838](https://github.com/withastro/astro/issues/13838)).
- A single-statement `UPDATE ... WHERE id = $1 AND status='pending' AND next_attempt_at <= now()` is race-safe under READ COMMITTED (the loser re-evaluates the predicate after lock wait and skips). Batch claiming needs `FOR UPDATE SKIP LOCKED`, which PostgREST can't express → claim lives in a SQL function.
- Null-guard convention to mirror: `src/lib/supabase.ts` returns `null` when env is missing; `src/lib/config-status.ts` surfaces missing config to the UI.
- Resend (the runner-up provider) was rejected because without a verified domain it only delivers to the account owner's own inbox; Brevo's single-sender verification allows arbitrary recipients with zero DNS.

## What We're NOT Doing

- **No booking emails** — the three app emails (new-request → owner, acceptance → guest, undo → guest) are owned by S-03/S-04/S-05; they will call this channel.
- **No migration of Supabase Auth emails** (verification, future password reset) to Brevo — they stay on Supabase's native mailer; revisit only if its rate limits bite.
- **No sending domain / DKIM / DMARC setup** — user has no domain; Brevo single-sender is the accepted MVP path. Deliverability degradation is a recorded, accepted risk; the upgrade path (verify a domain in Brevo, flip `EMAIL_FROM`) requires no code change.
- **No admin/owner UI for the outbox** — observability is the table itself + Workers logs.
- **No Cloudflare Queues / Durable Objects** — outbox-in-Postgres + cron is sufficient and stays on the Workers Free plan.
- **No email open/click tracking, i18n framework, or text/plain multipart** — HTML-only Polish emails at MVP.

## Implementation Approach

Three phases, each independently verifiable: (1) the durable substrate — outbox table, claim function, service-role client; (2) the pure-logic email service — Brevo client, layout, enqueue/drain orchestration with explicit config injection; (3) the runtime wiring — custom Worker entry with `scheduled`, cron schedule, guarded test endpoint, secrets, prod smoke. DB-level race-safety is proven by tests in Phase 1 so Phases 2–3 build on a trusted primitive (same strategy F-01 used for the overbooking guard).

Lease-based retry model (no `sending` state, no stuck rows): claiming a row atomically bumps `attempts` and pushes `next_attempt_at` ~5 minutes out; success marks `sent`, hard failure after `attempts >= 5` marks `failed`, otherwise the row stays `pending` and the lease expiry doubles as backoff. The immediate (`waitUntil`) path and the cron sweep share one claim primitive, so double-send is structurally excluded.

## Critical Implementation Details

- **Custom Worker entry vs adapter default.** The v12 `workerEntryPoint` adapter option is gone in v13. The current pattern: create `src/worker.ts` exporting a standard Worker object whose `fetch` delegates to the adapter's handler (import surface per the current `@astrojs/cloudflare` README — `@astrojs/cloudflare/handler` / `@astrojs/cloudflare/entrypoints/server`), set `main` in `wrangler.jsonc`, and verify against the adapter docs at implementation time — community snippets older than Q1 2026 are wrong (`infrastructure.md` Devil's Advocate #2). **Known local hazard**: `wrangler.jsonc:2-6` warns that adding `main` broke `npm run build` in this repo before — Phase 3.1 therefore starts with a build spike (Step 0) that proves or falsifies the pattern before any dependent work; the fallback (second minimal cron Worker) is named there. After building, confirm the cron trigger survives into the deployable config (`npx wrangler deploy --dry-run` or dashboard check) — the adapter generates `dist/.../wrangler.json` and the merge behavior of root-config `triggers` must be observed, not assumed.
- **`astro:env` is request-scoped; `scheduled` is not.** The email lib must take config (`apiKey`, `from`, supabase URL/key) as an explicit parameter. Request-path callers build it from `astro:env/server`; the `scheduled` handler builds it from its raw `env` bindings parameter. Do not import `astro:env/server` transitively into code reachable from `scheduled`.
- **`waitUntil` access from Astro routes changed in Astro 6** (`Astro.locals.runtime` was removed per `infrastructure.md`). Check the current adapter docs for the locals shape; if `waitUntil` is awkward to reach, the test endpoint may simply `await` the immediate attempt — the `waitUntil` fire-and-forget pattern is the documented contract for future S-03+ call-sites, not a hard requirement of this phase.
- **Timing**: Cloudflare cron minimum granularity is 1 minute; we use `*/5 * * * *` because the cron only sweeps stragglers — the immediate attempt carries the < 5 min NFR in typical conditions (NFR explicitly excludes provider outage).

## Phase 1: Outbox Schema + Service-Role Client

### Overview

Create the durable substrate: `email_outbox` table (deny-all RLS), the race-safe claim function, the service-role Supabase client, and DB tests proving claim/lease/RLS semantics.

### Changes Required:

#### 1. Outbox migration

**File**: `supabase/migrations/20260607120000_email_outbox.sql`

**Intent**: Durable record of every outbound app email with retry bookkeeping; invisible to anon/authenticated roles (it can contain guest/owner addresses and message bodies).

**Contract**: Table `public.email_outbox`: `id uuid pk default gen_random_uuid()`, `created_at timestamptz not null default now()`, `to_email text not null`, `subject text not null`, `html text not null`, `reply_to text`, `status text not null default 'pending' check (status in ('pending','sent','failed'))`, `attempts smallint not null default 0`, `next_attempt_at timestamptz not null default now()`, `last_error text`, `sent_at timestamptz`, `provider_message_id text`. Partial index on `(next_attempt_at)` `WHERE status = 'pending'`. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with **no policies** (service role bypasses RLS; everyone else is denied). Claim function (load-bearing — batch claim must skip locked rows):

```sql
create or replace function public.claim_due_emails(p_limit int default 10, p_id uuid default null)
returns setof public.email_outbox
language sql
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

revoke execute on function public.claim_due_emails(int, uuid) from public, anon, authenticated;
```

#### 2. Service-role client

**File**: `src/lib/supabase-admin.ts`

**Intent**: A server-only Supabase client with the service-role key for internal infrastructure (the outbox). Mirrors the null-guard convention of `src/lib/supabase.ts` — returns `null` when `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset.

**Contract**: `createAdminClient(override?: { url: string; serviceKey: string }): SupabaseClient<Database> | null`. Default reads from `astro:env/server`; the `override` parameter exists so the `scheduled` handler (Phase 3) can construct it from raw Worker env bindings. Plain `createClient` from `@supabase/supabase-js` (no cookies/SSR machinery), `auth: { persistSession: false }`. Never import this module from any user-facing data path.

#### 3. Env schema

**File**: `astro.config.mjs`

**Intent**: Register `SUPABASE_SERVICE_ROLE_KEY` as an optional server secret, following the existing `SUPABASE_URL`/`SUPABASE_KEY` pattern (graceful degradation when absent).

**Contract**: `SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true })`. Also add the key (empty) to `.env.example` with a comment pointing at local `supabase status` output.

#### 4. DB tests

**File**: `tests/db/email-outbox.test.ts`

**Intent**: Prove the primitive before anything builds on it: RLS denial, lease semantics, race-safety, attempts cap.

**Contract**: Using `tests/helpers/supabase.ts` conventions (`createAdminClient`-style admin from service key, anon + authenticated clients): (a) anon and authenticated clients can neither `select` nor `insert` `email_outbox`; (b) `claim_due_emails` returns a due pending row exactly once — an immediate second call returns empty (lease moved `next_attempt_at` forward); (c) two **concurrent** `claim_due_emails` calls over the same set of due rows return disjoint rows; (d) a row with `attempts = 5` is never returned; (e) `p_id` claims only the targeted row.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a reset local stack: `npm run db:reset`
- DB tests pass: `npm test`
- Type checking/linting passes: `npm run lint`
- Build passes (env additions don't break the optional-env build): `npm run build`

#### Manual Verification:

- Local Supabase Studio shows `email_outbox` with RLS enabled and no policies

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Email Service Library

### Overview

The pure-logic layer: Brevo fetch client, shared HTML layout, and the enqueue/drain orchestration with explicit config injection and graceful no-op mode. Fully unit-testable with mocked `fetch` — no runtime wiring yet.

### Changes Required:

#### 1. Email config

**File**: `src/lib/email/config.ts`

**Intent**: Resolve channel configuration from `astro:env/server` with the null-guard convention; expose the shape so non-request contexts can build it from raw bindings.

**Contract**: `type EmailConfig = { apiKey: string; fromEmail: string; fromName: string }`; `getEmailConfig(): EmailConfig | null` — null when `BREVO_API_KEY` or `EMAIL_FROM` is unset (`EMAIL_FROM_NAME` defaults to `"Zagroda Hub"`). Env schema additions in `astro.config.mjs`: `BREVO_API_KEY` (secret, optional), `EMAIL_FROM` (secret, optional), `EMAIL_FROM_NAME` (secret, optional). Add all three to `.env.example`.

#### 2. Brevo client

**File**: `src/lib/email/brevo.ts`

**Intent**: The only module that knows Brevo exists. Plain `fetch`, no SDK.

**Contract**: `sendViaBrevo(config: EmailConfig, msg: { to: string; subject: string; html: string; replyTo?: string }): Promise<{ ok: true; messageId: string } | { ok: false; error: string }>`. POST `https://api.brevo.com/v3/smtp/email`, headers `api-key: <key>`, `content-type: application/json`, body `{ sender: { name, email }, to: [{ email }], subject, htmlContent, ...(replyTo && { replyTo: { email } }) }`. Non-2xx and thrown fetch errors map to `{ ok: false, error }` with status + response text — never throws.

#### 3. Layout helper

**File**: `src/lib/email/layout.ts`

**Intent**: Minimal shared branded wrapper so S-03/S-04/S-05 emails look consistent without each slice re-inventing the shell.

**Contract**: `renderEmailLayout(opts: { title: string; bodyHtml: string }): string` — table-based, inline-styled HTML (email-client-safe), "Zagroda Hub" header, footer noting the message is automatic (Polish copy). No external images/fonts.

#### 4. Outbox orchestration

**File**: `src/lib/email/outbox.ts`

**Intent**: Enqueue + drain logic shared by the request path and the cron sweep — the single place where claim/send/mark happens.

**Contract**: `enqueueEmail(admin, msg): Promise<{ id: string } | { error: string }>` (insert, status `pending`); `drainDueEmails(admin, config | null, opts?: { limit?: number; id?: string }): Promise<{ claimed: number; sent: number; failed: number }>` — if `config` is null, log and return `{ claimed: 0, sent: 0, failed: 0 }` **without calling the claim RPC** (claiming bumps `attempts`, so a no-op drain must not consume the retry budget — rows stay genuinely pending and fully claimable once env is configured); otherwise calls `claim_due_emails` RPC, then for each row: `sendViaBrevo`, on success update `status='sent', sent_at, provider_message_id`, on failure update `last_error` and set `status='failed'` only when `attempts >= 5`. Marker updates are direct `update ... eq('id', ...)` via the admin client.

#### 5. Public entry point

**File**: `src/lib/email/index.ts`

**Intent**: The one function future slices call; hides outbox + provider behind a single contract.

**Contract**: `sendTransactionalEmail(deps: { admin: SupabaseClient | null; config: EmailConfig | null; waitUntil?: (p: Promise<unknown>) => void }, msg: { to: string; subject: string; html: string; replyTo?: string }): Promise<{ enqueued: boolean; id?: string }>` — null `admin` → logged no-op returning `{ enqueued: false }` (callers never break); otherwise enqueue, then schedule `drainDueEmails(admin, config, { id })` via `waitUntil` when provided, else fire-and-forget with `.catch` logging. Other phases and S-03+ depend on this signature.

#### 6. Unit tests

**File**: `tests/unit/email.test.ts`

**Intent**: Lock the Brevo payload contract and the no-op/failure behavior without any network.

**Contract**: vitest with `vi.stubGlobal('fetch', ...)`: (a) payload shape matches the Brevo contract incl. `replyTo` passthrough and omission; (b) non-2xx → `{ ok: false }` with status in error; (c) `drainDueEmails` with null config sends nothing and never calls the claim RPC (no `attempts` consumed — rows stay pending and claimable); (d) failure path sets `failed` only at the attempts cap (admin client mocked or exercised against local DB — follow whichever pattern `tests/` already supports with least machinery). Note: `vitest.config.ts` already includes `tests/**/*.test.ts` (no glob change needed), but its unconditional `globalSetup` (`tests/helpers/global-setup.ts:63-70`) requires the local Supabase stack for **any** test run — these "unit" tests therefore run with the stack up, same as DB tests. Accepted (least machinery); splitting vitest projects for stack-free unit runs is out of scope.

### Success Criteria:

#### Automated Verification:

- Unit + DB tests pass: `npm test`
- Lint/typecheck passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Code review of the Brevo payload against [Brevo's send-a-transactional-email doc](https://developers.brevo.com/docs/send-a-transactional-email)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Cron Wiring, Test Endpoint, Secrets & Prod Smoke

### Overview

Wire the runtime: custom Worker entry with `scheduled`, cron schedule in `wrangler.jsonc`, the guarded test endpoint, Brevo account + sender setup (external manual steps), production secrets, deploy, and the timestamped < 5 min smoke.

### Changes Required:

#### 1. Custom Worker entry

**File**: `src/worker.ts` (+ `wrangler.jsonc`)

**Intent**: Compose the Astro fetch handler with a `scheduled` handler that sweeps the outbox — same Worker, no second deployment.

**Contract**: **Step 0 — build spike, before any other Phase 3 work.** `wrangler.jsonc:2-6` documents that adding `main` previously broke `npm run build` (the Cloudflare Vite plugin validated it against a not-yet-built `dist/`). Retire this risk first: add `main: "./src/worker.ts"` plus a stub `{ fetch, scheduled }` entry and `"triggers": { "crons": ["*/5 * * * *"] }`, then run `npm run build` and `npx wrangler deploy --dry-run` and confirm the cron trigger survives into `dist/server/wrangler.json`. If green, update the now-stale comment in `wrangler.jsonc` to record the working pattern. If the build breaks, STOP — fall back to a second minimal cron Worker (own wrangler config + cron trigger, calling a shared-secret-guarded drain endpoint on the main app) and revise this phase before building anything on top.

Then the real entry: default-export a standard Worker object: `fetch` delegates to the `@astrojs/cloudflare` handler (exact import per current adapter docs — see Critical Implementation Details); `scheduled(controller, env, ctx)` builds the admin client + email config **from raw `env` bindings** (not `astro:env`) and runs `ctx.waitUntil(drainDueEmails(admin, config, { limit: 25 }))`. Verify `npm run dev` and `npm run build` still work with the custom entry, and re-check the cron after the real deploy (dashboard).

#### 2. Guarded test endpoint

**File**: `src/pages/api/dev/test-email.ts`

**Intent**: The repeatable verified-delivery path: enqueues a real email through the full channel on the real runtime.

**Contract**: `POST`, `export const prerender = false`. Guard: requires `locals.user` (401 otherwise) and sends **only to `locals.user.email`** — self-limiting, no recipient input; `User.email` is typed `string | undefined`, so respond 400 when it's missing. Body optional. Uses `sendTransactionalEmail` with `renderEmailLayout` and a timestamp in the subject/body (so inbox arrival time is comparable). For the immediate attempt, `await` the drain directly if `waitUntil` is awkward to reach from locals (see Critical Implementation Details). Response JSON: `{ enqueued, id, result: { claimed, sent, failed } }`.

#### 3. External setup (manual, human)

**File**: — (Brevo dashboard, mailbox provider, Wrangler CLI)

**Intent**: Create the sending identity and credentials. These steps gate the prod smoke.

**Contract**: (a) create the dedicated product mailbox (e.g. `zagroda.hub@gmail.com` — user's choice of free provider); (b) create a Brevo account, verify that mailbox as the single sender, generate an API key; (c) set production secrets non-interactively per the CI lesson: `echo "$VALUE" | npx wrangler secret put NAME` for `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `SUPABASE_SERVICE_ROLE_KEY`. Record (without values) which secrets were set in the change notes.

#### 4. Documentation

**File**: `CLAUDE.md.scaffold` (+ `context/changes/transactional-email-channel/change.md` Notes)

**Intent**: Close `infrastructure.md` Risk #8 — "Pick one and document the choice." Future slices must discover the channel, its no-op mode, and the domain-gap caveat without re-research.

**Contract**: Add a short "Transactional email" section: Brevo single-sender via `email_outbox` + hybrid dispatch, the `sendTransactionalEmail` entry point, env vars, no-op behavior when unconfigured, the 300/day free-tier cap, and the deliverability caveat + domain upgrade path (verify a domain in Brevo, change `EMAIL_FROM`, zero code change). Record the accepted risk: `POST /api/dev/test-email` is auth-only and self-addressed but un-rate-limited — any authenticated user could loop it and exhaust the 300/day Brevo quota, starving booking emails; revisit (cap or remove the endpoint) if abuse appears.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm test`
- Lint passes: `npm run lint`
- Build with custom entry passes: `npm run build`
- Dry-run deploy includes the cron trigger and stays under the 3 MiB Free-plan bundle ceiling: `npx wrangler deploy --dry-run`

#### Manual Verification:

- Brevo sender verified; secrets set on the production Worker (`npx wrangler secret list` shows the four names)
- Prod smoke: deploy via `npm run deploy`, sign in on the deployed app, `POST /api/dev/test-email`, email arrives in the signed-in owner's inbox; recorded send→inbox timestamps show **< 5 minutes** (expect seconds); evidence (timestamps + `provider_message_id`) recorded in the change notes / impl-review (S-01 F5 convention)
- Retry path observed once: temporarily break the API key locally (or use no-op mode), confirm the row stays `pending` and a later drain picks it up; `email_outbox` row transitions visible in Studio
- Unauthenticated `POST /api/dev/test-email` on prod returns 401

---

## Testing Strategy

### Unit Tests:

- Brevo payload contract (sender/to/subject/htmlContent/replyTo), error mapping on non-2xx and thrown fetch
- No-op mode: null config drains nothing, leaves rows pending; null admin makes `sendTransactionalEmail` a safe no-op
- Layout helper renders title + body, no external resources

### Integration Tests (DB, local Supabase):

- RLS: anon/authenticated fully denied on `email_outbox`
- `claim_due_emails`: lease single-claim, concurrent-claim disjointness, attempts cap, targeted `p_id` claim

### Manual Testing Steps:

1. Local: run app with email env unset → trigger test endpoint → row in `email_outbox` stays `pending`, payload logged (no-op mode confirmed)
2. Prod smoke per Phase 3 (timestamped < 5 min evidence)
3. Prod: confirm 401 for unauthenticated test-endpoint call

## Performance Considerations

Immediate attempt adds zero user-facing latency when `waitUntil` is used (post-response). Cron runs 288×/day on the Free plan (well under limits) and exits fast on the empty case thanks to the partial index. Brevo free tier caps at 300 emails/day — orders of magnitude above MVP volume; the cap and upgrade path are documented in Phase 3.4.

## Migration Notes

One additive migration (`email_outbox` + `claim_due_emails`). No existing tables touched — the lock-order lesson on `booking_requests` (`lessons.md:5-10`) does not apply. Per the deploy lesson (`lessons.md:12-17`), the migration ships via `npm run deploy` locally or the CI deploy job (both run `supabase db push` before `wrangler deploy`); the migration is backwards-compatible so `wrangler rollback` stays safe. Secrets are runtime state set once via `wrangler secret put`; CI needs no new GitHub secrets.

## References

- Roadmap entry: `context/foundation/roadmap.md:79-91` (F-02)
- Mechanism decision space: `context/foundation/infrastructure.md` Risk #8, Unknown Unknowns
- Deploy + rate-limit priors: `context/foundation/lessons.md`, `context/archive/2026-06-05-owner-publishes-zagroda/plan.md:201`
- Brevo API: https://developers.brevo.com/docs/send-a-transactional-email
- Astro 6 Cloudflare adapter (custom entry): https://docs.astro.build/en/guides/integrations-guide/cloudflare/

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Outbox Schema + Service-Role Client

#### Automated

- [x] 1.1 Migration applies cleanly on a reset local stack: `npm run db:reset` — 22cf3e6
- [x] 1.2 DB tests pass: `npm test` — 22cf3e6
- [x] 1.3 Type checking/linting passes: `npm run lint` — 22cf3e6
- [x] 1.4 Build passes (env additions don't break the optional-env build): `npm run build` — 22cf3e6

#### Manual

- [x] 1.5 Local Supabase Studio shows `email_outbox` with RLS enabled and no policies — 22cf3e6

### Phase 2: Email Service Library

#### Automated

- [x] 2.1 Unit + DB tests pass: `npm test` — abb908e
- [x] 2.2 Lint/typecheck passes: `npm run lint` — abb908e
- [x] 2.3 Build passes: `npm run build` — abb908e

#### Manual

- [x] 2.4 Code review of the Brevo payload against Brevo's send-a-transactional-email doc — abb908e

### Phase 3: Cron Wiring, Test Endpoint, Secrets & Prod Smoke

#### Automated

- [x] 3.1 Full suite green: `npm test` — 96be4f9
- [x] 3.2 Lint passes: `npm run lint` — 96be4f9
- [x] 3.3 Build with custom entry passes: `npm run build` — 96be4f9
- [x] 3.4 Dry-run deploy includes the cron trigger and stays under the 3 MiB bundle ceiling: `npx wrangler deploy --dry-run` — 96be4f9

#### Manual

- [x] 3.5 Brevo sender verified; four secrets visible in `npx wrangler secret list` — 96be4f9
- [x] 3.6 Prod smoke: test email delivered with timestamped < 5 min evidence recorded
- [x] 3.7 Retry path observed (row stays pending, later drain picks it up) — 96be4f9
- [x] 3.8 Unauthenticated test-endpoint call returns 401 on prod
