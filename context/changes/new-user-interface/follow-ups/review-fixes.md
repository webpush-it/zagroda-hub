# Follow-ups — impl-review (new-user-interface)

Items from the 2026-07-12 implementation review triage.

## F2 — Pin `site` / use `Astro.site` for canonical & OG URLs — RESOLVED (2026-07-12)

- **Location**: src/layouts/Layout.astro:16-17 (+ astro.config.mjs)
- **Severity**: WARNING (Safety & Quality — security/SEO)
- **Problem**: `canonicalUrl`/`ogImageUrl` were built from `Astro.url`, i.e. the incoming Host header → host-header-reflectable OG/canonical (SEO poisoning / spoofed unfurls). Separately, `sitemap()` was enabled but silently skipped (no `site`).
- **Fix applied**: Set `site: "https://zagroda-hub.webpushit.workers.dev"` in astro.config.mjs and switched Layout.astro to `const base = Astro.site ?? Astro.url;` for canonical/OG. One Astro-native value covers both concerns.
- **Verified**: build no longer skips sitemap (emits `sitemap-index.xml` + `sitemap-0.xml` with the configured host); lint ✅; vitest 163/163 ✅.
- **Status**: RESOLVED

_No open follow-ups remain._
