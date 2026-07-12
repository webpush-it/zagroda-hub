<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Redesign UI „Łąka i miód"

- **Plan**: context/changes/new-user-interface/plan.md
- **Scope**: All 5 phases (full plan)
- **Date**: 2026-07-12
- **Verdict**: NEEDS ATTENTION → all findings triaged and FIXED (5 fixed)
- **Findings**: 0 critical  2 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F1 — incomplete phase-4 color migration) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F2 security; F1/F3/F4 accessibility) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (build ✅, lint ✅, vitest 163/163 ✅, all grep-gates ✅; e2e not re-run here) |

## Automated re-verification (this review)

- `npm run build` — PASS
- `npm run lint` — PASS (exit 0)
- `npm test` (vitest) — 163/163 PASS
- Grep-gates 5.2 (theme), 5.3 (starter name), 3.2 (EN auth strings), 1.4 (lang), 5.4 (deleted files) — all PASS
- e2e (`npm run test:e2e`) — NOT re-executed in this review (requires a running worker); Progress marks it passing and the 6 auth locators were verified correct/atomic.

## Findings

### F1 — Two turnus-time validation errors left in dark-theme red

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (also Plan Adherence — incomplete migration)
- **Location**: src/components/zagroda/TurnusyEditor.tsx:86, :106
- **Detail**: Phase 4 (commit a08b7b5) migrated the label error on line 54 to `text-red-700` but left the two time-field errors on lines 86/106 as `text-red-300` (dark-theme leftover from June commit 9d4c9a93). On the light `card-surface`/white background this is ~1.5:1 contrast — near-invisible and WCAG-failing. Only such leftovers in `src/`. Failure scenario: owner enters an invalid "Od"/"Do" turnus time → validation message renders near-white-on-white.
- **Fix**: Change `text-red-300` → `text-red-700` on lines 86 and 106.
- **Decision**: FIXED

### F2 — Canonical / OG URLs reflect the request Host header

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/layouts/Layout.astro:16-17
- **Detail**: `canonicalUrl` and `ogImageUrl` are built from `Astro.url`. With SSR on Cloudflare and no `site` pinned in astro.config.mjs, the host segment reflects the incoming Host header — so `og:url`, `og:image` and canonical are host-header-reflectable (SEO poisoning / spoofed unfurls). The plan (Phase 1 #4) specified using `Astro.url`, so this is a plan-level choice. Repo already has the trusted-origin pattern: `src/pages/api/booking-request/index.ts:108` uses `SITE_URL ?? new URL(request.url).origin`, and `SITE_URL` is declared in astro.config.mjs:22 but unused here. Corroborating: build warns `[@astrojs/sitemap] requires the site option. Skipping` — sitemap() is enabled (astro.config.mjs:12) but emits nothing because `site` is unset.
- **Fix A ⭐ Recommended**: Set `site` in astro.config.mjs and build absolute URLs from `SITE_URL` (fallback to Astro.url origin).
  - Strength: Kills host-header reflection AND un-breaks the already-enabled sitemap() in one move; reuses the SITE_URL pattern the API layer already uses.
  - Tradeoff: Needs SITE_URL wired at build/runtime; a wrong value points canonical/OG at the wrong host.
  - Confidence: HIGH — identical pattern proven in booking-request API.
  - Blind spot: Haven't checked whether SITE_URL is set in the Cloudflare env for all deploy targets.
- **Fix B**: Leave as-is (accept the risk).
  - Strength: No change; matches what the plan specified.
  - Tradeoff: Sitemap stays silently empty; OG unfurls remain host-spoofable.
  - Confidence: MED — impact real but low-frequency.
  - Blind spot: None significant.
- **Decision**: FIXED — set `site` in astro.config.mjs (`https://zagroda-hub.webpushit.workers.dev`) and switched Layout.astro to build canonical/OG from `Astro.site ?? Astro.url`. Verified: build no longer skips sitemap (emits sitemap-index.xml/sitemap-0.xml with the configured host), lint ✅, vitest 163/163 ✅.

### F3 — Decorative 📧 emoji missing aria-hidden

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: src/pages/auth/confirm-email.astro:12
- **Detail**: `<div class="mb-4 text-5xl">📧</div>` lacked `aria-hidden`, so screen readers announce "envelope". Only emoji left in markup after the redesign replaced 🏡.
- **Fix**: Add `aria-hidden="true"` to the emoji div.
- **Decision**: FIXED

### F4 — Farm hero photo uses empty alt

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: src/pages/zagrody/[id].astro:77
- **Detail**: The farm's hero photo had `alt=""` (decorative), giving screen-reader users no signal a representative photo of this specific farm exists. Pre-existing; surfaced because the file was in scope.
- **Fix**: Set `alt={profile.name}` on the hero img.
- **Decision**: FIXED

### F5 — Brand-asset build script has no error handling

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: scripts/generate-brand-assets.mjs:23-48
- **Detail**: No try/catch around readFileSync / new Resvg / writeFileSync — a missing input threw a raw stack. Acceptable for a manually-run tool, but a clear message helps. (The comment did not actually mention "sharp" — no comment fix needed.)
- **Fix**: Wrap generation in try/catch with an actionable message; `process.exit(1)` on failure.
- **Decision**: FIXED
