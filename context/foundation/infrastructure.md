---
project: zagroda-hub
researched_at: 2026-05-27
recommended_platform: Vercel
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR) + React 19 islands
  runtime: Node (via @astrojs/vercel adapter)
---

## Recommendation

**Deploy on Vercel.**

The project is already wired for it — `astro.config.mjs` ships `adapter: vercel()` and the repo carries a `.vercel/` dir, the result of the bootstrapper swapping `@astrojs/cloudflare` → `@astrojs/vercel`. Astro SSR on Vercel is first-class (adapter GA, Fluid compute default), the developer is already familiar with it (interview Q3), and DX was prioritized over raw cost (Q2). Single-region reach (Q4) and external Supabase (Q5) mean the two things a competitor like Cloudflare would win on — edge distribution and co-located data — carry no weight here, while Cloudflare's workerd runtime would re-introduce the `nodejs_compat` friction with `@supabase/ssr` that this project already paid to leave behind.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration | Raw score |
|---|---|---|---|---|---|---|
| Cloudflare | Pass | Pass | Pass | Pass | Pass (GA) | 5P |
| Netlify | Pass | Pass | Pass | Pass | Pass (GA) | 5P |
| **Vercel** | Pass | Pass | Pass | Pass | Partial (beta, read-only) | 4P / 1Pa |
| Railway | Pass | Pass | Pass | Pass | Partial (WIP) | 4P / 1Pa |
| Fly.io | Pass | Partial | Pass | Pass | Partial (new) | 3P / 2Pa |
| Render | Partial | Pass | Partial | Pass | Pass (GA) | 3P / 2Pa |

Per-platform notes (status checked 2026-05-27):

- **Vercel** — `@astrojs/vercel` GA; Fluid compute is the default managed Node runtime (GA). Full CLI loop (`vercel`, `vercel rollback`, `vercel logs`). `llms.txt`/`llms-full.txt` published. MCP is **public beta, read-only** → Partial. Hobby tier is non-commercial; a real product needs Pro ($20/mo). No native WebSockets.
- **Netlify** — Ties Vercel on raw criteria with a more mature GA MCP server (in the Claude directory). Node Functions model; `@astrojs/netlify` GA. New accounts are on a **credit-based plan** (watch the cap). `netlify logs` CLI is new (May 2026 — confirm version). Swap cost from Vercel is just changing one adapter.
- **Railway** — Real long-lived Node container (no statelessness traps), **deterministic instant rollback** (restores prior image), `llms-full.txt`. No free tier (~$5–10/mo always-on). Gotcha: external Supabase keeps an outbound connection open, which **prevents app-sleeping** — you pay for an always-on container regardless. MCP is "work in progress" (unlabeled).
- **Fly.io** — Most operational surface: you own a Dockerfile + `fly.toml` (→ Managed = Partial). Full WebSockets/persistent processes if ever needed. Free tier removed; ~$2–5/mo always-on. `fly mcp` is new/beta.
- **Render** — Solid Web Service model, GA MCP that explicitly supports Claude Code, but **CLI can't roll back** (API/Dashboard only → CLI-first Partial) and **no `llms.txt`** (docs Partial). Free tier cold-starts (~1 min) make it unsuitable user-facing; budget the $7 Starter.
- **Cloudflare** — Clean 5/5 on raw criteria and a generous free tier, but **weighted down for this stack**: single-region nullifies its edge advantage, and workerd + `nodejs_compat` is real friction for `@supabase/ssr` SSR — the exact reason the project already migrated off it.

### Shortlisted Platforms

#### 1. Vercel (Recommended)

Already the configured adapter, first-class Astro SSR support, user-familiar, and the strongest DX of the Node-runtime options. Every criterion passes except MCP (beta/read-only), which is a light-weight signal and doesn't affect the core deploy loop (the `vercel` CLI). Single-region + external Supabase make its lack of edge/co-located data a non-issue.

#### 2. Netlify

The closest alternative — it matches Vercel's 5-criteria profile and actually edges it on MCP maturity (GA vs beta). Same stateless Node-function model, so it carries the *same* serverless caveats (no WebSockets, atomicity-in-DB). It loses to Vercel only on incumbency: the project is already wired for Vercel, and switching means re-validating the adapter and re-learning a second platform for no functional gain. The new credit-based pricing is an unknown worth watching.

#### 3. Railway

The hedge against the Q1 "don't know" on persistent connections. A real Node container removes every statelessness trap (in-memory state is safe, WebSockets work, no cold-start NFR risk) and offers deterministic instant rollback. It drops below the serverless pair only because it costs money from day one and its app-sleeping is defeated by Supabase's persistent connection — but if the product ever grows background jobs or live push, Railway is the natural destination.

## Anti-Bias Cross-Check: Vercel

### Devil's Advocate — Weaknesses

1. **Hobby tier is non-commercial.** A booking product (even pre-revenue) needs Pro ($20/mo); "it's free" is wrong the moment it's a business.
2. **Stateless functions make in-memory concurrency guards silently wrong.** FR-014 atomic anti-overbooking cannot use an in-process lock — each concurrent acceptance runs in a separate isolate. It must be a Postgres transaction/constraint.
3. **`context.locals` is serialized into a header** between edge middleware and the serverless function (403 if bypassed/oversized) — a Vercel-specific coupling that can break Supabase session passing as middleware grows.
4. **No native WebSockets.** A future live "new inquiry" push (vs email) would require Supabase Realtime; Vercel can't do it natively. The Q1 "don't know" lands here.
5. **Cold-start on a cold SSR path** could brush the p95 < 2s catalog NFR — mitigated by low QPS + Fluid compute, but real.

### Pre-Mortem — How This Could Fail

The team guarded the daily-limit check with an in-memory mutex, assuming one long-lived server. On Vercel's stateless isolates the mutex never coordinated; during the spring school-trip rush two classes were accepted into the same full day — the one rule the product exists to enforce failed in production. Compounding it: they stayed on Hobby, and when real bookings arrived Vercel flagged commercial use, forcing a scramble to Pro mid-incident. Email (FR-005/011/016) was sent synchronously inside the handler; when the email provider slowed, function duration spiked past the 15s acceptance NFR and some invocations timed out, leaving reservations half-accepted with no email sent. Nobody had `vercel logs` tailing or alerting, so the overbooking surfaced via an angry phone call — the exact pain point the product set out to kill.

### Unknown Unknowns

- **Region pinning:** Vercel functions default to a US region (`iad1`). For Polish users + an EU Supabase region, pin functions to `fra1`/`arn1` or eat transatlantic latency on every SSR→DB round-trip.
- **Supabase connection exhaustion:** each serverless invocation opens DB connections; under burst you exhaust Postgres. Use Supabase's transaction pooler (PgBouncer, port 6543), not the direct 5432 connection.
- **Atomicity belongs in Postgres** (`SELECT … FOR UPDATE` or an exclusion constraint), never app memory — Vercel's statelessness makes this non-negotiable.
- **Vercel MCP is public beta + read-only** — don't assume agent-driven deploys through it; the deploy loop is the `vercel` CLI.
- **Hobby → Pro is a licensing line, not just a limits line.**

## Operational Story

- **Preview deploys:** Vercel's Git integration builds every branch/PR push into a unique preview URL automatically (matches `ci_default_flow: auto-deploy-on-merge`). Production deploys on merge to the production branch. Preview URLs are public by default — gate sensitive previews with Vercel's Deployment Protection (Pro) if needed.
- **Secrets:** `SUPABASE_URL` / `SUPABASE_KEY` live as Vercel Environment Variables (Project → Settings → Environment Variables), scoped per environment (Production/Preview/Development). They are read server-side through Astro's `astro:env/server` schema (already declared in `astro.config.mjs`). Never expose the Supabase service-role key — keep it non-`PUBLIC_`. Rotate by updating the var and redeploying.
- **Rollback:** `vercel rollback <deployment-url>` (or the Dashboard → Deployments → Promote a prior build). Time-to-revert is seconds (no rebuild). Caveat: a rollback reverts *code*, not Supabase schema — any forward DB migration must have a separate, tested down-path.
- **Approval:** Production promotion and Supabase secret rotation should require a human. An agent may run lint/build, deploy previews, tail logs, and trigger a rollback unattended; it must **not** run destructive Supabase operations (drop table, prod migration) without approval.
- **Logs:** `vercel logs <deployment-url>` streams runtime logs (CLI, read-only); build logs via `vercel inspect --logs` or the Dashboard. Vercel MCP (beta, read-only) can surface logs/deployments to the agent but is not required.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Anti-overbooking (FR-014) implemented as in-memory lock → fails on stateless functions | Pre-mortem / Devil's advocate | M | H | Enforce atomicity in Postgres: a `SELECT … FOR UPDATE` transaction or exclusion constraint that sums accepted participants per day; add the US-01 concurrency test (two parallel accepts → exactly one succeeds). |
| Hobby tier non-commercial; commercial use flagged | Devil's advocate / Unknown unknowns | M | M | Move to Pro ($20/mo) before taking real bookings; budget it in the MVP cost line now. |
| Transatlantic latency from US-default function region to EU Supabase | Unknown unknowns | M | M | Pin function region to `fra1`/`arn1` (EU); host Supabase in an EU region; verify the p95 < 2s catalog NFR after pinning. |
| Postgres connection exhaustion under burst from serverless invocations | Unknown unknowns / Research | M | M | Connect via Supabase transaction pooler (PgBouncer, port 6543), not direct 5432. |
| Synchronous transactional email inflates function duration past the 15s acceptance NFR | Pre-mortem | M | M | Decouple email from the request path (Supabase queue / async trigger / provider with fast accept); never block the accept response on SMTP. |
| Future need for live push / persistent connections (Q1 "don't know") | Devil's advocate / Research | L | M | Use Supabase Realtime for any live updates; if background jobs/WebSockets become core, Railway (runner-up-adjacent) is the documented escape hatch. |
| Overbooking discovered too late (no observability) | Pre-mortem | M | H | Wire `vercel logs` tailing + an alert on accept-path errors before launch; log every accept/block decision with day + counts. |
| `context.locals` header serialization breaks Supabase session as middleware grows | Devil's advocate | L | M | Keep `locals` payload small; validate session server-side on each request; cover auth flow with an end-to-end check after middleware changes. |

## Getting Started

Versions validated against the project's pinned stack (`@astrojs/vercel`, Astro 6, Node 22.14) on 2026-05-27 — not generic platform docs.

1. **Local loop stays `npm run dev`.** Astro's own dev server gives full SSR fidelity for app logic; `vercel dev` is *not* needed for this externally-hosted-Supabase app (it only emulates Vercel routing/edge-middleware). Don't add it to the workflow.
2. **Connect the repo to Vercel** (Dashboard → Add New → Project → import the GitHub repo). Vercel auto-detects Astro and the `@astrojs/vercel` adapter; the Git integration builds on push — this *is* your `auto-deploy-on-merge` CI flow, so you don't run `vercel build` locally. (CLI alternative: `npx vercel link` then `npx vercel --prod`.)
3. **Set environment variables** in Vercel (Production + Preview): `SUPABASE_URL`, `SUPABASE_KEY`. These resolve through the existing `astro:env/server` schema — no code change needed. Mirror the GitHub Actions secrets already used by `ci.yml`.
4. **Pin the function region to EU** (`fra1` or `arn1`) in `vercel.json` (`{ "functions": { "...": { "regions": ["fra1"] } } }` or the project's Region setting) so SSR sits close to an EU Supabase project.
5. **Verify the ops loop:** trigger a preview deploy from a branch, run `vercel logs <url>` to confirm log access, and test `vercel rollback <url>` once so the revert path is known before you need it under pressure.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
