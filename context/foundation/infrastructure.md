---
project: zagroda-hub
researched_at: 2026-05-28
recommended_platform: cloudflare-workers
runner_up: vercel
context_type: mvp
tech_stack:
  language: typescript
  framework: astro-6-ssr
  runtime: workerd (cloudflare-workers)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare Workers scored 5/5 Pass on the agent-friendly criteria (best across the six candidates) and lands at the lowest cost ceiling ($0 on Free for 100k req/day, $5/mo Workers Paid for 10M req/mo). For a low-QPS Polish booking MVP with external Supabase EU and OpenRouter, the edge POP in Warsaw/Frankfurt keeps SSR latency in the 20–30ms range, well inside the NFR budget. The leader was swapped from Vercel after the anti-bias cross-check surfaced that Vercel Hobby's [Fair Use clause](https://vercel.com/docs/limits/fair-use-guidelines) bars commercial use — a booking platform for paying zagroda owners is commercial, so Vercel would require Pro at $20/mo from day one. The tech-stack.md upstream choice (`@astrojs/vercel`) is overridden here by an evidence-based platform decision; the adapter swap to `@astrojs/cloudflare` was executed on 2026-05-28 and `npm run build` verified clean against the existing `@supabase/ssr@0.10.3` scaffold (the originally-flagged `@supabase/server` swap turned out to be unnecessary — see Risk #1 for the empirical detail).

## Platform Comparison

### Scoring matrix (hard filters applied; interview answers reweighted)

| Platform               | CLI-first | Managed              | Agent docs                                             | Stable deploy API               | MCP / Integration                                         | Verdict                                   |
| ---------------------- | --------- | -------------------- | ------------------------------------------------------ | ------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| **Cloudflare Workers** | Pass      | Pass                 | Pass (`llms.txt` + markdown-for-agents + `.md` suffix) | Pass (`wrangler deploy`)        | Pass (docs / bindings / observability MCP, unlabelled GA) | **Top pick**                              |
| Vercel                 | Pass      | Pass                 | Pass (`llms.txt` + `llms-full.txt`)                    | Pass (`vercel --prod`)          | Partial (MCP Public Beta)                                 | Runner-up                                 |
| Render                 | Pass      | Pass                 | Pass (`llms.txt` + `.md` suffix + agent skills GA)     | Pass (`render` CLI + Blueprint) | Pass (MCP GA)                                             | Third                                     |
| Netlify                | Pass      | Pass                 | Pass (`llms.txt`)                                      | Pass (`--prod` required)        | Pass (MCP GA since 2025-06)                               | Dropped — free tier locked to `us-east-2` |
| Fly.io                 | Pass      | Partial (containers) | Partial (no `llms.txt`)                                | Pass (image-redeploy rollback)  | Pass (`fly mcp server` builtin)                           | Dropped — no `waw` region, no free tier   |
| Railway                | Pass      | Pass                 | Partial (markdown on GitHub, no `llms.txt`)            | Pass (`railway up --ci --json`) | Partial (MCP beta/evolving)                               | Dropped — only EU region is Amsterdam     |

### Interview-driven weights applied

| Interview signal                    | Effect on scoring                                                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 — no persistent connections      | No hard filter; all six candidates remain                                                                                                                                                                                                            |
| Q2 — cost ≈ DX (no preference)      | No re-weight against pricier options; honest pricing surfaced per platform                                                                                                                                                                           |
| Q3 — no platform familiarity        | Penalizes platforms with non-obvious gotchas; favors first-class Astro guides                                                                                                                                                                        |
| Q4 — single region (Poland)         | Edge-global advantage of Cloudflare neutralized as a _feature_, but Frankfurt/Warsaw POP remains a free latency win; **Netlify's `us-east-2` free-tier lock becomes a real penalty** (~150ms cross-Atlantic per SSR request to Supabase EU and back) |
| Q5 — external Supabase + OpenRouter | Co-location not a tiebreaker; raised a concern about `@supabase/ssr` on Workers (issue #37592) — empirically verified resolved at v0.10.3+ with `nodejs_compat`; pin and gate upgrades                                                               |

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

- **Why it won**: best agent-friendly surface area (5/5), cheapest credible plan ($0–$5/mo with no hidden R2/KV charges if unused), excellent CLI (`wrangler` with non-interactive flags), multiple official MCP servers, and Astro 6's dev server already runs `workerd` natively — meaning local-dev fidelity to production is the highest of any candidate. The Warsaw/Frankfurt POP serves Polish traffic in ~20ms.
- **Where it fights you**: `@supabase/ssr` previously had a `stream` dynamic-require crash on Workers ([issue #37592](https://github.com/supabase/supabase/issues/37592) — closed; reproduced against `@supabase/ssr@0.6.1`). Empirically verified 2026-05-28: `@supabase/ssr@0.10.3` + `@astrojs/cloudflare` + `nodejs_compat` flag builds cleanly, so the current scaffold (`src/lib/supabase.ts` using `createServerClient`+`parseCookieHeader`) works as-is. The runner-up option `@supabase/server` exists but uses a request-handler-wrapping API that doesn't slot neatly into Astro's `Astro.locals.user` middleware pattern — adopt only if a future `@supabase/ssr` regression forces it. The Workers runtime is `workerd`, not Node — `nodejs_compat` shims most things but not all, and the failure mode is runtime, not build-time.

#### 2. Vercel

- **Why it scored second**: `@astrojs/vercel` is currently configured in `tech-stack.md`; Astro+Vercel+Supabase is the most-trodden community path; mature CLI + Marketplace Supabase integration; honest first-class `llms.txt` and `llms-full.txt` for agent docs.
- **Where it loses to the leader**: **Hobby plan is non-commercial-only** per Fair Use — for a real product, Pro $20/mo is mandatory from day one. MCP is Public Beta (subject to AI Product Terms, not GA). Fluid Compute is Pro+ only, so cold starts on Hobby are unmitigated. Open Astro 6+Vercel SSR esbuild bug #16258 as of April 2026. Astro+Supabase SSR cookies are DIY — no first-party `@supabase/ssr` Astro adapter.

#### 3. Render

- **Why it scored third**: boring-and-safe path. First-class Astro guide, Frankfurt EU region GA, MCP GA, agent skills (`render-deploy` / `render-debug` / `render-monitor`) installable via CLI. `@astrojs/node` standalone mode means no Workers-style SSR weirdness — what you build locally is what runs in production.
- **Where it loses to the leader**: Free tier sleeps after 15min (~30–60s cold start) — for a mobile booking UX, that's a non-starter, so Starter $7/mo is required from day one. The single load-bearing gotcha is `HOST=0.0.0.0` (Astro defaults to localhost in containers; Render won't reach the port without it).

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`@supabase/ssr` Workers regression risk.** [Supabase issue #37592](https://github.com/supabase/supabase/issues/37592) (closed, reproduced against `@supabase/ssr@0.6.1`) documented a `stream` dynamic-require crash. Empirically verified on 2026-05-28: `@supabase/ssr@0.10.3` + `@astrojs/cloudflare` + `nodejs_compat` builds and bundles cleanly — the crash does not reproduce on the project's current pinned version. The risk is _regression_ on a future Supabase or Workers update: pin `@supabase/ssr` exactly, add a build-fails-CI check, and keep `@supabase/server` (with its `withSupabase` request-handler API) as a fallback if a future upgrade brings the crash back. Auth flows FR-006/008/017/018 are the cookie-heavy surface that would be impacted.
2. **Astro 5→6 migration on `@astrojs/cloudflare` v13 is non-trivial.** `Astro.locals.runtime` removed, `workerEntryPoint` removed, prerender now runs in `workerd` not Node, Pages deployment removed entirely. Community snippets older than Q1 2026 will be subtly wrong — the agent must validate examples against the current docs.
3. **Workers runtime is `workerd`, not Node.** `nodejs_compat` shims most things, but the catch is "most". Any third-party npm package added during the MVP carries silent runtime incompatibility risk (`Buffer`, `fs`, native bindings, dynamic require). Failure mode is at request time, not build time.
4. **EU-only data residency requires Enterprise.** Free/$5 Paid runs globally; pinning SSR compute to EU only is in the Data Localization Suite (Enterprise). For a zagroda booking app this is unlikely to bind near-term, but it's a real future ceiling if Polish data-residency regulation tightens.
5. **MCP servers are unlabelled (no formal GA).** They work today, but agent workflows that depend on schema stability have no contractual guarantee. Acceptable for dev-time, risky if you ever script production diagnostics through MCP.

### Pre-Mortem — How This Could Fail

It's late November 2026. Zagroda Hub launched on Cloudflare Workers two weeks late. The catalog works, but the owner panel hit a wall in week 2 when FR-014 (anti-overbooking acceptance) needed transactional semantics against Supabase Postgres. The dev built the flow using the scaffolded `@supabase/ssr` client, and it works in isolation — but a concurrent-acceptance test (US-01) revealed that under load, two parallel `accept` calls from two browser tabs sometimes both succeed because the cookie-bound Supabase auth context is being rebuilt per-request on Workers and doesn't share the row-lock the dev assumed Postgres-level isolation gave them. The fix turned out to be straightforward (`SELECT ... FOR UPDATE` inside an explicit `rpc()` transaction), but it took five evenings of after-hours debugging before someone in the Astro Discord pointed out that the Workers cookie/session model is _not_ like the Node session model the user's mental model came from — every request rebuilds context from scratch, and any "this connection is mine, I'll lock and write" assumption is wrong. Two weeks earlier, the team had also spent a weekend on a CommonJS dynamic-require error from a third-party package they added for Polish phone-number validation, only to discover they needed `nodejs_compat_v2` plus a wrangler config tweak — meanwhile they accidentally bloated the bundle past the 3 MiB Free-plan ceiling and got auto-rejected on deploy. The lesson written up: "We picked the most agent-friendly platform by checklist, but we underestimated how much our mental model was Node-shaped. Workers isn't Node-on-the-edge; it's a different runtime that _looks_ like Node."

### Unknown Unknowns

- **`astro dev` already runs `workerd` directly in Astro 6** — `wrangler dev` is largely redundant for SSR. Most tutorials and a lot of agent training data still recommend `wrangler dev` as the canonical local-dev command. Running both confuses the dev loop. Use `astro dev` (`npm run dev`) only.
- **`nodejs_compat_v2` auto-activates with `compatibility_date >= 2024-09-23`** and _inflates bundle size_. If the bundle approaches the 3 MiB Free / 10 MiB Paid ceiling, add `no_nodejs_compat_v2` to revert. The failure is "deploy rejected", not "deploy slow" — easy to misread.
- **Workers has no Node-style persistent server; transactional emails (FR-005 / FR-011 / FR-016) must use either Supabase webhooks, an external transactional-mail provider, or Cron Triggers** — which run in the same `workerd` bundle with the same compat rules.
- **`wrangler secret put` is interactive by default**. Non-interactive CI requires `wrangler secret put NAME < value.txt` or `wrangler secret bulk`. The agent will hit the interactive prompt on the first `wrangler secret put` and stall if not told.
- **`secret-store` (newer central-secrets product) is still Open Beta** per [workers-sdk #10566](https://github.com/cloudflare/workers-sdk/issues/10566). For MVP, use per-Worker `secret put` (GA), not the secret store.

## Operational Story

How Cloudflare Workers operates day-to-day for this stack. One concrete answer per line.

- **Preview deploys**: every `wrangler deploy` against a non-production environment in `wrangler.toml` (e.g. `[env.preview]`) creates a versioned deployment with a stable `*.workers.dev` URL. GitHub Actions can wire branch-pushes to preview environments via `cloudflare/wrangler-action@v3`. Fork PR preview deploys require explicit opt-in (Workers Builds, GA) — without it, fork PRs cannot deploy because they lack secret access.
- **Secrets**: `wrangler secret put SUPABASE_URL`, `wrangler secret put SUPABASE_ANON_KEY`, `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`, `wrangler secret put OPENROUTER_API_KEY`. Secrets are encrypted at rest, scoped per Worker per environment, and injected as `env` bindings at runtime. CI must use `wrangler secret put NAME < value.txt` (stdin) or `wrangler secret bulk` to avoid the interactive prompt. Rotation flow: `wrangler secret put NAME` again with the new value — old value is replaced atomically. **Do not** commit secrets to `wrangler.toml`.
- **Rollback**: `wrangler rollback --message="reason"` reverts to the previous deployment immediately (~5s). DB migrations on Supabase do _not_ roll back automatically — keep migrations additive and backwards-compatible for the duration of a rollback window. `wrangler deployments list` shows the rollback target IDs.
- **Approval**: the agent may unattended (a) `wrangler dev`, (b) `wrangler deploy --env preview`, (c) `wrangler tail`, (d) `wrangler secret list` (names only, never values). Human-only: (i) production `wrangler deploy` from a local shell — CI deploys production automatically on push to master (the push/merge is the human decision; the agent must not push to master unattended), (ii) `wrangler delete` (kills the Worker), (iii) rotating `SUPABASE_SERVICE_ROLE_KEY`, (iv) Supabase project-level operations (drop DB, change auth providers).
- **Logs**: `wrangler tail` for real-time stream from production; `wrangler tail --env preview` for preview env. Workers Logs (GA, 20M events / 7-day retention on Paid) is queryable via the dashboard or `wrangler logs` for historical analysis. For agent-driven diagnostics, the [Workers Observability MCP server](https://observability.mcp.cloudflare.com/mcp) exposes typed log queries.

## Risk Register

| #   | Risk                                                                                                                        | Source                                                                                                                                      | Likelihood                        | Impact                               | Mitigation                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Future `@supabase/ssr` regression on Workers — auth flows (FR-006/008/017/018) blocked                                      | Devil's advocate (downgraded after empirical verification 2026-05-28: v0.10.3 + `nodejs_compat` builds clean against `@astrojs/cloudflare`) | Low (today) / Medium (on upgrade) | High (if it hits)                    | Pin `@supabase/ssr` exactly in `package.json`; gate dependency bumps behind a Workers build smoke-test in CI. Keep `@supabase/server` (`withSupabase` handler) as documented fallback. Link the package's GitHub releases page in `CLAUDE.md` for the agent to check on every Supabase upgrade |
| 2   | Anti-overbooking (FR-014) fails under concurrent acceptance because the Workers per-request session model differs from Node | Pre-mortem                                                                                                                                  | Medium                            | Critical (primary success criterion) | Enforce row-locking inside a Supabase `rpc()` function — `SELECT ... FOR UPDATE` on the day's acceptance count, then `INSERT`. Test US-01 concurrent-acceptance with two parallel `wrangler dev` sessions or a `k6`/`vegeta` script before launch                                              |
| 3   | Bundle size exceeds 3 MiB (Free) or 10 MiB (Paid) ceiling — deploy auto-rejected                                            | Unknown unknowns                                                                                                                            | Medium                            | Medium                               | Run `wrangler deploy --dry-run --outdir=dist` and inspect bundle size on every PR. If close to the ceiling, add `no_nodejs_compat_v2` to `wrangler.toml`. Move large libs (e.g. PDF generation) to external services                                                                           |
| 4   | Third-party npm package fails at runtime due to `workerd` incompatibility (Node-only Buffer/fs/native binding)              | Devil's advocate                                                                                                                            | Medium                            | Medium                               | Smoke-test every new dependency on a preview deploy before merging. Prefer dependencies advertised as "edge-compatible" or "isomorphic". Maintain a `docs/reference/known-compat-issues.md`                                                                                                    |
| 5   | EU data-residency requirement emerges later and Free/$5 plan can't satisfy it (Enterprise-only Data Localization)           | Devil's advocate                                                                                                                            | Low                               | High (if it binds)                   | Document the ceiling in `CLAUDE.md`. Re-evaluate platform if the regulatory landscape changes; Frankfurt-only runner-ups (Render, Vercel Pro) are the migration target                                                                                                                         |
| 6   | `wrangler secret put` stalls on interactive prompt in CI                                                                    | Unknown unknowns                                                                                                                            | High (first hit)                  | Low (5-min fix once known)           | Use `wrangler secret put NAME < value.txt` or `wrangler secret bulk` in GitHub Actions. Document the pattern in `CLAUDE.md`                                                                                                                                                                    |
| 7   | Cloudflare MCP servers change schema without notice                                                                         | Devil's advocate                                                                                                                            | Low                               | Low (dev-time only)                  | Do not gate production workflows on MCP. Use CLI for production diagnostics; treat MCP as a query convenience layer                                                                                                                                                                            |
| 8   | Transactional emails (FR-005 / FR-011 / FR-016) need scheduling, but Workers has no Node-style timer                        | Unknown unknowns                                                                                                                            | Medium                            | Medium                               | Use Cron Triggers (GA) for scheduled emails, or Supabase webhooks for event-driven delivery. Pick one and document the choice in `CLAUDE.md`                                                                                                                                                   |
| 9   | Adapter swap from `@astrojs/vercel` to `@astrojs/cloudflare` regresses the bootstrapper-generated example code              | Research finding                                                                                                                            | Medium                            | Low (one-time fix)                   | Run the swap in a single PR; verify all auto-generated middleware and env-var access patterns still work. The Astro 6 dev server runs `workerd` natively, so `npm run dev` is the verification command                                                                                         |
| 10  | Vercel's stale Astro doc trap (if user pivots later)                                                                        | Research finding                                                                                                                            | Low                               | Low                                  | Documented for context; not applicable while on Cloudflare. If a future swap to Vercel is considered, follow [docs.astro.build/en/guides/integrations-guide/vercel/](https://docs.astro.build/en/guides/integrations-guide/vercel/), not Vercel's own framework page                           |

## Getting Started

These commands are validated against the Astro 6 + `@astrojs/cloudflare` v13 combination as of 2026-05-28. Adjust if any pinned version in `package.json` differs.

1. **Swap the adapter from `@astrojs/vercel` to `@astrojs/cloudflare`.**

   ```bash
   npm uninstall @astrojs/vercel
   npx astro add cloudflare
   ```

   This installs `@astrojs/cloudflare` (v13+) and updates `astro.config.mjs`. Verify the `output: 'server'` and `adapter: cloudflare({...})` lines.

2. **Install Wrangler globally (optional) or use `npx wrangler`.**

   ```bash
   npm i -g wrangler
   wrangler --version  # expect 4.x or newer
   ```

3. **Authenticate Wrangler.**

   ```bash
   wrangler login         # interactive, opens browser
   # OR for CI / non-interactive:
   #   export CLOUDFLARE_API_TOKEN=...    (scoped: Workers Scripts:Edit + Account Settings:Read)
   #   export CLOUDFLARE_ACCOUNT_ID=...
   ```

4. **Create `wrangler.toml` (or `wrangler.jsonc`) at repo root.**

   ```toml
   name = "zagroda-hub"
   main = "./dist/_worker.js/index.js"
   compatibility_date = "2024-09-23"
   compatibility_flags = ["nodejs_compat"]

   [assets]
   directory = "./dist"

   [observability]
   enabled = true
   ```

   Note: `compatibility_date >= 2024-09-23` is the threshold that activates `nodejs_compat_v2`. Bundle size to be monitored — see Risk #3.

5. **Local dev — use Astro's dev server, not `wrangler dev`.**

   ```bash
   npm run dev   # runs `astro dev` which uses workerd natively in Astro 6
   ```

   The Astro 6 dev server already exposes Workers bindings (env vars, KV, R2 if configured) with HMR. `wrangler dev` is only useful for testing post-build artifacts.

6. **Keep `@supabase/ssr` — empirically verified to work on Workers at v0.10.3+.**
   The bootstrapper-scaffolded `src/lib/supabase.ts` uses `createServerClient` + `parseCookieHeader` from `@supabase/ssr`; build verified clean on `@astrojs/cloudflare` + `nodejs_compat` on 2026-05-28. Pin the exact version and gate upgrades behind a build check (see Risk #1). The earlier-issue's [`@supabase/server`](https://supabase.com/blog/introducing-supabase-server) (`withSupabase` request-handler) remains documented as the regression fallback, but its API does not slot into Astro's `Astro.locals.user` middleware pattern, so it is not the default.

7. **Set production secrets (one-time, before first deploy).**

   ```bash
   wrangler secret put SUPABASE_URL
   wrangler secret put SUPABASE_ANON_KEY
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   wrangler secret put OPENROUTER_API_KEY
   ```

   Each command opens an interactive prompt for the secret value. For CI, pipe from stdin: `echo "$SUPABASE_URL" | wrangler secret put SUPABASE_URL`.

8. **Deploy.**

   ```bash
   npm run build && wrangler deploy
   ```

   First successful deploy returns a `*.workers.dev` URL. For a custom domain, add a [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) in the dashboard or via `wrangler` config.

9. **Verify in production.**

   ```bash
   wrangler tail   # live log stream
   curl -I https://<your-worker>.workers.dev/
   ```

10. **Add an MCP server for the agent (optional, dev-time).**
    Point Claude Code's MCP config at `https://docs.mcp.cloudflare.com/mcp` (documentation queries) and/or `https://observability.mcp.cloudflare.com/mcp` (log queries). See [Cloudflare MCP servers catalog](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/).

## Out of Scope

The following were **not** evaluated in this research:

- Docker image configuration (Workers does not use containers; Render/Fly.io paths would have).
- CI/CD pipeline setup (Plan Mode deploy will produce `context/deployment/deploy-plan.md`; that's where the GitHub Actions / Workers Builds wiring decision lands).
- Production-scale architecture (multi-region HA, dedicated SLA, DR drills) — out of MVP scope per the skill's non-goals.
- Data Localization Suite (Enterprise add-on) — documented as Risk #5 but not researched as a near-term option.
- Comparative cost modeling at >1M req/month — `tech-stack.md` `target_scale.qps: low` and `users: medium` keep this out of scope; revisit when traffic crosses 100k req/day.
