---
change_id: testing-e2e-critical-flow-mobile
title: Testing e2e critical flow mobile
status: implemented
created: 2026-06-14
updated: 2026-06-14
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Deferred CI gate (decision).** This change landed the e2e config + specs +
  a documented local run command (`npm run test:e2e`) only. The **blocking CI
  job** (Supabase + build + `wrangler dev` + `playwright install` + run, as a
  required PR check) is formally **test-plan §3 Phase 4**, per §5's gate row
  ("e2e on critical flow … wired into CI by §3 Phase 4"). No `.github/workflows/ci.yml`
  edit in this change.
- **Stale-doc finding → `/10x-lesson` candidate.** `context/foundation/tech-stack.md:8`
  declares `deployment_target: vercel`, but the project actually deploys to
  **Cloudflare Workers** (`astro.config.mjs` uses `@astrojs/cloudflare` with
  `output:"server"`; root `wrangler.jsonc` `main:"./src/worker.ts"`;
  `package.json` `deploy` = `build && db:push && wrangler deploy`; there is no
  `vercel.json` / `@astrojs/vercel`). This drift bit the e2e serve-target
  decision (had to serve via `wrangler dev`, not Vercel preview). Recommend a
  `/10x-lesson` entry — `tech-stack.md` itself is **not** edited in this change.
