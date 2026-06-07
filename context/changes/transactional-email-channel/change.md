---
change_id: transactional-email-channel
title: Transactional email channel
status: implementing
created: 2026-06-07
updated: 2026-06-07
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 3 — runtime wiring decisions

- Custom Worker entry pattern confirmed against `@astrojs/cloudflare` v13.6.0: the adapter's wrangler customizer does `main: config.main ?? "@astrojs/cloudflare/entrypoints/server"`, so a root-config `main` pointing at `src/worker.ts` (fetch delegating to `@astrojs/cloudflare/handler`'s `handle`) is the supported override. Build spike green; `triggers.crons` from root `wrangler.jsonc` survives verbatim into `dist/server/wrangler.json`. The stale "do NOT add main" warning in `wrangler.jsonc` was removed — the break it described no longer reproduces.
- Production secrets to set via `echo "$VALUE" | npx wrangler secret put NAME`: `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `SUPABASE_SERVICE_ROLE_KEY` (names only recorded here, never values).

### Local verification (2026-06-07, performed by agent)

Done against the local Supabase stack + `npm run dev` with a confirmed throwaway user; all temp state (rows, user, `.env`, `.dev.vars`) cleaned up afterward.

- **3.7 Retry path — PASSED.** With a deliberately broken `BREVO_API_KEY`, `POST /api/dev/test-email` returned `{enqueued:true, result:{claimed:1, sent:0, failed:0}}`; the row stayed `status=pending`, `attempts` 0→1, `last_error="Brevo responded 401: {\"message\":\"Key not found\",\"code\":\"unauthorized\"}"`, lease pushed +5 min. After rewinding the lease, the exact cron-drain claim (`claim_due_emails` RPC, `p_limit=25`, no id) re-claimed the due rows, bumping `attempts` 1→2 and pushing the lease again — proving lease-based retry + no double-send.
- **3.8 (local equivalent) — PASSED.** Unauthenticated `POST /api/dev/test-email` → **401** (with same-origin `Origin`); without an `Origin` header Astro's CSRF guard returns 403 first. Prod variant still pending a deploy.
- **No-op mode — PASSED.** With email env unset, the endpoint returned `{enqueued:true, result:{claimed:0,sent:0,failed:0}}` and the row stayed `pending` (claim RPC not called — retry budget preserved).
- **Brevo network path — REACHED.** The 401 above is an authentic Brevo API response, proving the `fetch` payload + headers reach `api.brevo.com` correctly; only a valid key + verified sender are missing for real delivery.

### Brevo credentials verified (2026-06-07)

- Three Brevo secrets set on the production Worker `zagroda-hub`: `BREVO_API_KEY`, `EMAIL_FROM` (`beska.konrad@gmail.com`), `EMAIL_FROM_NAME` (`Zagroda Hub`) — confirmed via `npx wrangler secret list`. **`SUPABASE_SERVICE_ROLE_KEY` still NOT set** (4th secret) — required for the deployed worker's admin client; until set, prod email is a no-op.
- **Direct Brevo send PASSED** (same payload as `sendViaBrevo`): sender verified, key valid, `POST /v3/smtp/email` accepted. Send timestamp `2026-06-07T20:29:31Z`, `provider_message_id` `<202606072029.85189615119@smtp-relay.mailin.fr>`. Proves the Brevo account + single-sender verification + payload contract end-to-end. **Inbox arrival confirmed by user** — mail delivered to `beska.konrad@gmail.com`.

### 3.5 — DONE

Brevo sender verified (user-confirmed delivery), all four production secrets set on Worker `zagroda-hub` (`BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `SUPABASE_SERVICE_ROLE_KEY` — verified via `npx wrangler secret list`).

### Deploy decision: via merge → CI

`email_outbox` migration is NOT yet on prod (REST 404 confirmed). Per deploy-lesson, migrations ship before the worker — the prod `email_outbox` migration + worker will deploy through the **CI `deploy` job on master** (which runs `supabase link` → `supabase db push` → `wrangler deploy` with its own secrets). Local `npm run deploy` was not run (no prod DB password locally). Phase 3 code is committed now; prod smoke happens post-merge.

### Open after merge/deploy (prod smoke)

- **3.6** Prod smoke: after CI deploy, create a throwaway confirmed user via prod admin API (`beska.konrad+f02smoke@gmail.com` Gmail alias), sign in on the deployed app, `POST /api/dev/test-email`, confirm inbox arrival, record send→inbox timestamps (<5 min) + `provider_message_id`, then delete the throwaway user.
  - Send timestamp: _pending deploy_
  - Inbox arrival timestamp: _pending deploy_
  - `provider_message_id`: _pending deploy_
- **3.8** Unauthenticated `POST /api/dev/test-email` on prod → 401: _pending deploy_
