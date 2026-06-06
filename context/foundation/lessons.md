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
