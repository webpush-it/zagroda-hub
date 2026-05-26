---
bootstrapped_at: 2026-05-26T07:24:02Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: zagroda-hub
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
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
```

### Why this stack (from hand-off body)

Zagroda Hub is a 3-week after-hours MVP whose load-bearing domain rule is
anti-overbooking under concurrent acceptance (FR-014) — that pushes hard toward
a starter with PostgreSQL on day one. Auth is the second weight: FR-006/008
(email+password + verification + reset) plus FR-017/018 (Google + Facebook OAuth
with verified-email merge guard) is three auth flows the starter must already
handle. The 10x Astro Starter clears both by shipping Supabase (Postgres + Auth
+ Storage) wired into Astro + React + TypeScript + Tailwind 4. The mobile-first
NFR (portrait, one-handed, Chrome Android + Safari iOS) is well-served by
Astro's island architecture. All four agent-friendly gates pass, so a coding
agent can reason about the stack without extra scaffolding. Deployment target
is Vercel rather than the card's Cloudflare default — Astro on Vercel is
first-class, so the bootstrapper swaps `@astrojs/cloudflare` for
`@astrojs/vercel`. CI on GitHub Actions with auto-deploy-on-merge matches the
solo profile.

## Pre-scaffold verification

| Signal       | Value                                                                  | Severity | Notes                                                                                 |
| ------------ | ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| npm package  | not run                                                                | n/a      | cmd_template starts with `git clone`; no `create-*` CLI to query                      |
| GitHub repo  | przeprogramowani/10x-astro-starter last pushed 2026-05-17 (9 days ago) | fresh    | from card.docs_url; default_branch=master, archived=false, stargazers=84              |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 19
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold
**.gitignore handling**: moved silently (cwd had no pre-existing .gitignore)
**.bootstrap-scaffold cleanup**: deleted

### Notable warnings during install

- `npm warn EBADENGINE` on `astro@6.3.1` (requires `node >=22.12.0`), `@vitejs/plugin-react@5.2.0` (requires `>=20.19.0 || >=22.12.0`), `@eslint/core@1.2.1` and several others (require `>=22.13.0 || ^20.19.0`). Local Node is `v22.11.0`. The starter installed and resolved, but `npm run dev` may emit further engine warnings or fail on specific code paths until Node is bumped. Recommended: install Node 22.13+ (the starter's `.nvmrc` pins `22.13.0`).
- `npm warn deprecated @babel/plugin-proposal-private-methods@7.18.6` — replaced by `@babel/plugin-transform-private-methods`; transitive, not actionable directly.
- `npm warn deprecated node-domexception@1.0.0` — transitive; platform DOMException recommended upstream.
- Final tally from `npm install`: 773 packages added, 774 audited, 308 funding requests. Audit summary surfaced in next section.

### File-by-file move log

Moved (no conflict):
- `.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`

Conflicts (existing wins; scaffold lands as `.scaffold` sibling):
- `CLAUDE.md` ← scaffold copy renamed to `CLAUDE.md.scaffold` (existing CLAUDE.md is the user's 10xDevs course instructions, 12050 bytes; scaffold's was 3218 bytes)

Dropped (context/ is canonical in cwd):
- (none — scaffold does not ship a `context/` tree)

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW (total 10)
**Direct vs transitive**: 2 direct (both MODERATE: `@astrojs/check`, `wrangler`); 8 transitive (including the 1 HIGH: `devalue`)

#### CRITICAL findings

(none)

#### HIGH findings

- **devalue** (range `5.6.3 - 5.8.0`) — transitive. Advisory: "Svelte devalue: DoS via sparse array deserialization". Reached via the Cloudflare/Wrangler toolchain. Not in the request path of the runtime app; resolves once the upstream chain bumps.

#### MODERATE findings (9)

- **@astrojs/check** (`>=0.9.3`) — direct. Via `@astrojs/language-server`. Editor-time only.
- **@astrojs/language-server** — transitive via `volar-service-yaml`.
- **@cloudflare/vite-plugin** — transitive via `miniflare`, `wrangler`, `ws`.
- **miniflare** — transitive via `ws`.
- **volar-service-yaml** — transitive via `yaml-language-server`.
- **wrangler** (`3.108.0 - 4.93.0`) — direct. Via `miniflare`. Build/deploy tool, not runtime.
- **ws** (`8.0.0 - 8.20.0`) — transitive. Advisory: "ws: Uninitialized memory disclosure".
- **yaml** (`2.0.0 - 2.8.2`) — transitive. Advisory: "yaml is vulnerable to Stack Overflow via deeply nested YAML collections".
- **yaml-language-server** — transitive via `yaml`.

#### LOW / INFO findings

(none)

The clustering pattern: most findings cascade from the Cloudflare Workers tooling chain (`wrangler` → `miniflare` → `ws`/`@cloudflare/vite-plugin`) and the editor-tooling chain (`@astrojs/check` → `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml`). Since the deployment target is Vercel (not Cloudflare), the Cloudflare toolchain cluster may become moot once `@astrojs/cloudflare` is swapped for `@astrojs/vercel` and `wrangler` is removed from `package.json`.

`npm audit fix` would attempt non-breaking upgrades; `npm audit fix --force` may upgrade across major versions. Neither was run — bootstrapper informs, the user decides.

## Hints recorded but not acted on

| Hint                     | Value                  |
| ------------------------ | ---------------------- |
| bootstrapper_confidence  | first-class            |
| quality_override         | false                  |
| path_taken               | standard               |
| self_check_answers       | null                   |
| team_size                | solo                   |
| deployment_target        | vercel                 |
| ci_provider              | github-actions         |
| ci_default_flow          | auto-deploy-on-merge   |
| has_auth                 | true                   |
| has_payments             | false                  |
| has_realtime             | false                  |
| has_ai                   | false                  |
| has_background_jobs      | false                  |

Notable surface (v1 surfaces but does not compensate):
- `deployment_target: vercel` while the starter ships Cloudflare adapter + `wrangler.jsonc`. A future skill (or you, manually) will need to: install `@astrojs/vercel`, swap the adapter in `astro.config.mjs`, remove `wrangler.jsonc`/`wrangler` dep, and adjust env wiring. This is the one stack-deviation flagged at /10x-tech-stack-selector.
- `ci_provider: github-actions` + `ci_default_flow: auto-deploy-on-merge` — `.github/` from the starter is present but the workflow files were not generated by this run. A future M1L4 skill ships CI scaffolding.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review the `CLAUDE.md.scaffold` sibling and decide whether to fold any of its content into your existing `CLAUDE.md`.
- Bump local Node to 22.13+ (the starter's `.nvmrc` pins it) before running `npm run dev`.
- Swap the Astro adapter from Cloudflare to Vercel (`npm uninstall @astrojs/cloudflare wrangler && npm install @astrojs/vercel`, then update `astro.config.mjs`).
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
