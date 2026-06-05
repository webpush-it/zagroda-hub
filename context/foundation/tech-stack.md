---
starter_id: 10x-astro-starter
package_manager: npm
project_name: zagroda-hub
hints:
  language_family: js
  team_size: solo
  deployment_target: vercel
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Zagroda Hub is a 3-week after-hours MVP whose load-bearing domain rule is
anti-overbooking under concurrent acceptance (FR-014) — that pushes hard toward
a starter with PostgreSQL on day one. Auth is the second weight: FR-006/008
(email+password + verification + reset) plus FR-017/018 (Google + Facebook OAuth
with verified-email merge guard) is three auth flows the starter must already
handle. The 10x Astro Starter clears both by shipping Supabase (Postgres + Auth

- Storage) wired into Astro + React + TypeScript + Tailwind 4. The mobile-first
  NFR (portrait, one-handed, Chrome Android + Safari iOS) is well-served by
  Astro's island architecture. All four agent-friendly gates pass, so a coding
  agent can reason about the stack without extra scaffolding. Deployment target
  is Vercel rather than the card's Cloudflare default — Astro on Vercel is
  first-class, so the bootstrapper swaps `@astrojs/cloudflare` for
  `@astrojs/vercel`. CI on GitHub Actions with auto-deploy-on-merge matches the
  solo profile.
