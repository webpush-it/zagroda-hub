# E2E Critical Flow on Mobile Viewport — Plan Brief

> Full plan: `context/changes/testing-e2e-critical-flow-mobile/plan.md`
> Research: `context/changes/testing-e2e-critical-flow-mobile/research.md`

## What & Why

Stand up the project's first browser-level (e2e) test harness with Playwright and drive the **built Cloudflare Worker** through the core promise on a phone viewport: teacher request → owner accept → overbooking block. This is test-plan §3 Phase 2, covering **Risk #3** (a critical mobile flow breaks above the DB layer while CI stays green) and the SSR-render half of **Risk #4** (teacher contact-data IDOR), which §7 explicitly delegated here.

## Starting Point

No browser-test layer exists — `@playwright/test` is absent and all 16 existing tests are vitest at the DB/unit/API layer. The app ships as a Cloudflare Worker (`@astrojs/cloudflare`, `wrangler deploy`), so the faithful serve target is `npm run build` → `npx wrangler dev` on :8787, not `astro dev`. There are no `data-testid` attributes anywhere in the flow, and credential resolution already has a proven pattern (`supabase status -o json`) in the vitest global-setup.

## Desired End State

`npm run build && npx playwright test` (local Supabase up) launches `wrangler dev` against the built Worker on a Pixel-5 viewport and runs three specs green: a harness smoke test, the request→accept→block critical flow (asserting the exact PRD capacity message), and the IDOR page (foreign owner → 404 with no contact data; anonymous → redirect to sign-in). Credentials resolve automatically and `.dev.vars` is generated and gitignored.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Serve target | Built Worker via `wrangler dev` | Faithful to the Cloudflare deploy artifact; `astro dev` would pass while the built Worker breaks (Risk #3 "must challenge") | Research |
| Scenario scope | Core flow + IDOR | Exactly what test-plan §3 Risk #3 + §7 delegate here; undo/release stays at DB/API layers | Plan |
| Device matrix | One phone (Pixel 5) | Critical-flow signal at minimal cost; layout is one `max-w-md` column, avoids e2e-everything | Plan |
| CI boundary | Land specs now, gate in Phase 4 | Matches test-plan's stated phase split; lets a young harness stabilize before it can block merges | Plan |
| Auth strategy | Per-test fresh sign-in via real form | Honors test-independence; exercises the real page+middleware wiring Risk #3 targets | Plan |
| Serve lifecycle | Playwright `webServer` auto-launches | One command works locally and in CI; no orphan processes | Plan |
| Env injection | Generate `.dev.vars` + reuse `supabase status -o json` | One source of truth, mirrors existing harness, no manual key copying | Plan |

## Scope

**In scope:** Playwright install + config (Pixel 5, auto-launched `wrangler dev`); a global-setup resolving creds and writing `.dev.vars`; a Node-context seeding helper; a smoke spec; the critical-flow spec; the IDOR spec; test-plan §6.4 cookbook fill.

**Out of scope:** Blocking CI job (deferred to Phase 4); second device/WebKit; undo→re-accept release in the browser; `data-testid` additions; DB teardown; editing `tech-stack.md`; re-testing RPC/RLS internals.

## Architecture / Approach

Bottom-up: prove the novel, riskiest piece — serving the *built Worker* with live local-Supabase env — in isolation (Phase 1 smoke spec) before domain flows depend on it. Two env consumers: the `wrangler dev` child (anon creds via generated `.dev.vars`) and the Playwright Node process (service-role creds in-process for seeding). One global-setup resolves both from `supabase status -o json`. Specs use per-test unique seed data + fresh sign-in for standalone re-runnability; the seed helper is a Playwright-context port of `tests/helpers/supabase.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness + serve/env | Playwright config, global-setup, `.dev.vars`, seed helper, smoke spec | `wrangler dev` not reading `.dev.vars` under the adapter; stale `dist/` |
| 2. Critical-flow spec | request → accept → overbooking block, PRD oracle | Oracle drift (use PRD message, not handler code); row disambiguation |
| 3. IDOR spec | foreign owner 404 (no contact data); anon redirect | Asserting absence of contact data correctly; fresh anon context |
| 4. Docs + handoff | §6.4 cookbook, deferred-CI note, stale-doc flag | Doc-only; low risk |

**Execution routing:** Phase 1 → `/10x-implement` (bootstraps Playwright; `/10x-e2e` halts when Playwright is absent). Phases 2–3 → **`/10x-e2e`** (browser specs, generate→review→verify loop; shares this plan + Progress). Phase 4 → `/10x-implement` or manual. See the full plan's "Execution Routing" section.

**Prerequisites:** Local Supabase stack (`npm run db:start`); a build (`npm run build`) before each run; `npx playwright install chromium`.
**Estimated effort:** ~2–3 sessions across 4 phases (Phase 1 carries the harness risk; 2–4 are incremental).

## Open Risks & Assumptions

- **`wrangler dev` reads `.dev.vars` for the secret-typed env** under the `@astrojs/cloudflare` adapter (app env name is `SUPABASE_KEY`, not `SUPABASE_ANON_KEY`). Phase 1's smoke spec is the explicit checkpoint that validates this assumption.
- **A stale `dist/`** would silently test old code — the run command and Phase 1 criteria force `npm run build` first.
- **`tech-stack.md:8` is stale** (claims Vercel; reality is Cloudflare Workers) — flagged as a `/10x-lesson` candidate, not fixed here.

## Success Criteria (Summary)

- A phone-viewport browser walks request → accept → overbooking block against the built Worker and fails when the flow breaks.
- A foreign owner gets a 404 with no teacher contact data; an anonymous visitor is redirected to sign-in.
- The harness is reproducible: auto-resolved creds, generated `.dev.vars`, green re-runs without a DB reset, and a filled §6.4 cookbook.
