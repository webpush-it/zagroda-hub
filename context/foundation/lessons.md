# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Lock-order: booking_requests.zagroda_id is a load-bearing immutable

- **Context**: supabase/migrations/20260605094725_accept_booking_request.sql:35-43 — accept function pre-reads zagroda_id unlocked to pick its first lock target
- **Problem**: The per-zagroda serialization guarantee (lock zagroda row FIRST, then request row) depends on booking_requests.zagroda_id never changing after insert. Nothing in the schema enforces this — a future SECURITY DEFINER mutator (S-03 guest-cancel, S-05 withdrawal) or service-role path that updates zagroda_id would silently break the anti-overbooking guarantee.
- **Rule**: Any new write path touching `booking_requests` must treat `zagroda_id` (and `turnus_id`, `trip_date` of accepted rows) as immutable. If a feature ever needs to re-point a request, it must add a mechanical guard (trigger) and re-prove the lock-order contract first.
- **Applies to**: All future migrations and SECURITY DEFINER functions mutating `booking_requests` — especially S-03 (guest cancel) and S-05 (owner withdrawal).

## Deploy: schema changes ship with the worker, never behind it

- **Context**: Deploy pipeline (F3, S-01 impl review) — deploy was `wrangler deploy` only; F-01 and S-01 schemas lived only locally until the production smoke failed
- **Problem**: Neither the plan, CI, nor any runbook pushed migrations to the hosted DB. Fixed ad-hoc (6 migrations via Management API + bookkeeping in supabase_migrations.schema_migrations), but the class of failure recurs on every slice that touches schema unless the deploy path carries migrations.
- **Rule**: Every production deploy goes through a path that runs `supabase db push` BEFORE `wrangler deploy` — locally `npm run deploy`, in CI the `deploy` job on master. Bare `npx wrangler deploy` after a schema-touching change is a process violation. Migrations stay additive/backwards-compatible so the old worker survives the window (and `wrangler rollback` stays safe).
- **Applies to**: Every future slice with a migration (S-02+); plan "Migration Notes" sections; any change to ci.yml's deploy job.

## Set wrangler secrets from a newline-free source on Windows

- **Context**: Any phase that sets Cloudflare Worker secrets via `npx wrangler secret put NAME` from a Windows/PowerShell shell — esp. `/10x-implement` prod-smoke and deploy steps reading keys/tokens (service-role JWTs, API keys).
- **Problem**: Piping with PowerShell `"value" | npx wrangler secret put NAME` appends a trailing newline to the stored value. The secret is non-empty (so `wrangler secret list` shows it and null-guards pass), but the value is corrupted. Discovered in F-02 prod smoke: `SUPABASE_SERVICE_ROLE_KEY` with `\n` made the admin-client JWT invalid → enqueue 401 (silent `enqueued:false`); `BREVO_API_KEY` with `\n` → Brevo 401 "Key not found". Hours lost because the failure looked like a code/no-op-mode bug, not a corrupted secret.
- **Rule**: On Windows, never set wrangler secrets with PowerShell `"value" | npx wrangler secret put`. Pipe from a newline-free source — `printf '%s' 'value' | npx wrangler secret put NAME` (bash) — and verify the runtime actually reads the value, not just that `wrangler secret list` names it.
- **Applies to**: implement, impl-review

## Truncate w kontenerze flex wymaga min-w-0 na kurczącym się dziecku

- **Context**: Każdy komponent (`.astro`/`.tsx`) z wierszem `flex`, w którym tekst o zmiennej długości ma się skracać (`truncate`/`max-w-*`) — zwłaszcza paski/nagłówki jak Topbar zawierające pojedynczy długi token (e-mail, nazwa, URL) bez spacji.
- **Problem**: Flex-child bez `min-w-0` nie zwęża się poniżej swojej min-content. Pojedynczy długi token (np. e-mail bez spacji) ma min-content = pełna szerokość, więc `truncate`/`max-w-*` nie tną — element rozpycha layout lub wylewa się poza kontener. Wystąpiło przy `fix-mobile-ui-bugs` i ponownie przy `topbar-user-email` (inline e-mail wylewał się poza nagłówek @640–900px; fix `76a1d6b`).
- **Rule**: Gdy flex-child ma się skracać, dodaj `min-w-0` do tego dziecka (i w razie potrzeby do jego flex-kontenera). Samo `truncate`/`max-w-*` nie zadziała w wierszu flex — bez `min-w-0` próg min-content blokuje zwężanie.
- **Applies to**: plan, implement, impl-review
