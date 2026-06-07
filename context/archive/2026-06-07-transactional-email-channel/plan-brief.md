# Transactional Email Channel (F-02) — Plan Brief

> Full plan: `context/changes/transactional-email-channel/plan.md`

## What & Why

Pick and wire the mechanism for sending the app's transactional emails from Cloudflare Workers, with one verified delivery path under 5 minutes (NFR). This is roadmap foundation F-02: it doesn't ship the booking emails themselves (FR-005/011/016 belong to S-03/S-04/S-05), but it settles the one decision that would otherwise force rework across three slices — `infrastructure.md` Risk #8.

## Starting Point

No app email code exists. Auth emails go natively through Supabase Auth's dev-grade SMTP (explicitly out of scope here). The Worker runs on `workerd` (no Node SMTP), the Wrangler config is adapter-default (no custom entry, no cron), and Supabase access is anon-key-only with a null-guard graceful-degradation convention.

## Desired End State

Any server code path calls `sendTransactionalEmail({to, subject, html, replyTo?})`; the message is durably recorded in an `email_outbox` table, delivered via Brevo within seconds typically, retried by a 5-minute cron sweep on transient failure, and a no-op (logged, rows kept pending) when email env is unconfigured. A guarded `POST /api/dev/test-email` proves the path on production with timestamped evidence.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Provider | Brevo HTTP API (plain fetch) | Single-sender verification works without a domain (user has none); Resend's domain-less mode only delivers to your own inbox. |
| Sender identity | Dedicated new mailbox, verified in Brevo | Product-named From: without exposing a personal address; `EMAIL_FROM` is env, so a future domain swap is zero-code. |
| Dispatch | DB outbox + hybrid (immediate `waitUntil` attempt + `*/5` cron sweep) | Durability and an audit trail, while the immediate attempt carries the < 5 min NFR. |
| Retry model | Lease-based claim (`claim_due_emails` with `FOR UPDATE SKIP LOCKED`, attempts cap 5) | Race-safe between the immediate path and cron; no stuck "sending" rows. |
| Outbox access | Service-role client + deny-all RLS | Outbox is internal infrastructure holding emails/bodies; invisible to anon/authenticated. |
| Dev/CI mode | Graceful no-op when env unset | Mirrors the existing `src/lib/supabase.ts` null-guard convention; no real sends in CI. |
| Template surface | Generic send contract + shared layout helper only | Channel decided here; email content belongs to the slices that own the flows. |
| Verification | Guarded test endpoint + prod smoke with timestamps | Proves the real path (workerd + secrets + Brevo + outbox), repeatable. |
| Domain gap | Accepted: no sending domain at MVP | Deliverability caveat recorded; upgrade path = verify a domain in Brevo, flip `EMAIL_FROM`. |

## Scope

**In scope:** `email_outbox` migration + claim function, service-role client, Brevo fetch client, shared HTML layout helper, enqueue/drain orchestration, custom Worker entry with `scheduled`, cron trigger, guarded test endpoint, Brevo/secrets setup, prod smoke, channel documentation.

**Out of scope:** the three booking emails (S-03/04/05), Supabase Auth email migration, domain/DKIM setup, outbox admin UI, Cloudflare Queues, open/click tracking.

## Architecture / Approach

Caller → `sendTransactionalEmail` → insert `email_outbox` row → immediate `drainDueEmails` attempt (post-response via `waitUntil`) → Brevo `POST /v3/smtp/email`. A `scheduled` handler in a custom Worker entry (Astro 6 / `@astrojs/cloudflare` v13 pattern) re-drains due rows every 5 minutes as the retry safety net. Config is injected explicitly because `astro:env` is request-scoped and the cron path isn't.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Outbox schema + service-role client | Durable table, race-safe claim function, DB tests | Claim semantics subtly wrong under concurrency — mitigated by dedicated tests |
| 2. Email service library | Brevo client, layout, enqueue/drain, no-op mode, unit tests | Brevo payload contract drift — locked by mocked-fetch tests |
| 3. Cron wiring + verified delivery | Custom Worker entry, cron, test endpoint, secrets, prod smoke | Astro 6 custom-entry pattern is new; cron must survive into deployed config |

**Prerequisites:** Brevo account + dedicated mailbox creation + sender verification (manual, Phase 3); Wrangler access to set production secrets.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Deliverability from a free-mailbox sender (no domain, no DKIM alignment) may land in spam — accepted MVP trade-off; upgrade path documented.
- Astro 6 custom Worker entry + root-config `triggers` merge behavior must be verified empirically (`wrangler deploy --dry-run`); community snippets pre-Q1-2026 are wrong.
- Brevo free tier: 300 emails/day — far above MVP volume, documented cap.

## Success Criteria (Summary)

- A test email triggered on production arrives in < 5 minutes (expect seconds), with timestamped evidence recorded.
- Unit + DB suites prove payload contract, RLS denial, and race-safe single-claim semantics.
- S-03/S-04/S-05 can send their emails by calling one documented function — no further mechanism decisions needed.
