# Zagroda Hub

Mobile-first booking platform for Polish educational farms (*zagrody edukacyjne*). Owners
manage class-trip booking requests one-handed from the field; the core promise is that the
system **never accepts an overbooking** — concurrent acceptances on the same day resolve to
exactly one success, enforced atomically in the database.

- **Owner** registers (email + password, or Google/Facebook OAuth), publishes one farm
  profile with a daily participant limit and time slots, and accepts/rejects/withdraws
  incoming requests from a mobile panel.
- **Guest** (teacher) browses the public catalog, filters by region + city (+ optional date /
  group size), and sends a booking request without an account. All status updates arrive by
  email; a tokenized link lets the guest cancel before acceptance.

See [`context/foundation/prd.md`](./context/foundation/prd.md) for the full product spec and
[`context/foundation/test-plan.md`](./context/foundation/test-plan.md) for the test strategy.

## Tech Stack

- [Astro](https://astro.build/) v6 — server-first rendering (SSR on Cloudflare)
- [React](https://react.dev/) v19 — interactive islands
- [TypeScript](https://www.typescriptlang.org/) v5
- [Tailwind CSS](https://tailwindcss.com/) v4
- [Supabase](https://supabase.com/) — Postgres, Auth (email/password + OAuth), Storage
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge deployment runtime
- [Brevo](https://www.brevo.com/) — transactional email (degrades to a logged no-op when unconfigured)
- [Zod](https://zod.dev/) v4 — server-side input validation
- [Vitest](https://vitest.dev/) v4 — unit / DB-integration / HTTP-handler tests

## Prerequisites

- Node.js v22.14.0 (see `.nvmrc`)
- npm (bundled with Node.js)
- [Docker](https://www.docker.com/) + ~7 GB RAM — required for the local Supabase stack
  (Postgres, Auth, Storage) used by `npm run dev` and the test suite

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your env files (local dev only — production secrets live in Cloudflare/Supabase):

   ```bash
   cp .env.example .env
   cp .env.example .dev.vars
   ```

3. Start the local Supabase stack (downloads Docker images on first run, applies all
   migrations in `supabase/migrations/`):

   ```bash
   npm run db:start
   ```

4. Copy the printed credentials into `.env` and `.dev.vars`:

   ```
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_KEY=<anon key from CLI output>
   SUPABASE_SERVICE_ROLE_KEY=<service_role key from CLI output>
   ```

5. Run the development server (Cloudflare `workerd` runtime):

   ```bash
   npm run dev
   ```

## Available Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server (Cloudflare `workerd` runtime) |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build |
| `npm run lint` / `npm run lint:fix` | Type-checked ESLint (auto-fix) |
| `npm run format` | Run Prettier |
| `npm test` | Run the Vitest suite (requires the local Supabase stack running) |
| `npm run db:start` | Start the local Supabase stack (applies migrations) |
| `npm run db:reset` | Reset the local DB and re-apply all migrations |
| `npm run db:types` | Regenerate `src/db/database.types.ts` from the local schema |
| `npm run db:push` | Push migrations to the linked remote project |
| `npm run deploy` | `build` → `db:push` → `wrangler deploy` |

## Project Structure

```md
.
├── src/
│  ├── components/         # UI components (Astro & React)
│  │  ├── auth/ booking/ katalog/ zagroda/ ui/
│  ├── pages/             # Astro routes
│  │  ├── api/            # API endpoints (auth, booking-request, zagroda, dev)
│  │  ├── auth/           # sign-in / sign-up / confirm / reset pages
│  │  ├── dashboard/      # owner panel (zapytania = requests)
│  │  ├── zagrody/        # public farm detail pages
│  │  ├── katalog.astro   # public catalog
│  │  └── index.astro     # landing
│  ├── lib/               # auth + email (outbox) domain logic
│  ├── db/                # generated database.types.ts
│  ├── layouts/  styles/
│  └── middleware.ts      # route protection
├── supabase/migrations/  # SQL schema, atomic-accept RPC, email outbox
├── tests/                # unit / db / api (see Testing)
├── context/foundation/   # PRD, test-plan, and other living docs
├── astro.config.mjs      # astro:env server-secret schema
└── wrangler.jsonc        # Cloudflare Workers config (name: zagroda-hub)
```

## Environment Variables

Declared via Astro's `astro:env` schema (`astro.config.mjs`) as **server-only secrets** —
never exposed to the client. All are optional; missing values degrade gracefully (e.g. an
unset email channel becomes a logged no-op).

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_KEY` | Supabase project URL + `anon` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client for the email outbox; unset → outbox no-op |
| `SITE_URL` | Origin used for absolute links in emails |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | Transactional email; `EMAIL_FROM` must be the Brevo-verified sender |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_*`, `SUPABASE_AUTH_EXTERNAL_FACEBOOK_*` | OAuth credentials — **local dev only**, consumed by the Supabase CLI via `config.toml`. Production OAuth lives in the hosted Supabase dashboard. |

For a hosted Supabase project, set `SUPABASE_URL`/`SUPABASE_KEY` from
**Dashboard → Settings → API** instead of the local CLI output.

### Auth routes

| Route | Description |
| --- | --- |
| `/auth/signin`, `/auth/signup` | Email/password forms |
| `/auth/confirm-email` | Post-signup "check your inbox" page |
| `/auth/forgot-password`, `/auth/reset-password` | Password reset flow |
| `/dashboard`, `/dashboard/zapytania` | Owner panel (protected) |
| `/katalog`, `/zagrody/[id]` | Public catalog + farm detail |
| `/anuluj` | Guest cancellation via tokenized link |

Route protection lives in `src/middleware.ts`. Email-verification gating, the OAuth
account-merge guard, and the atomic acceptance rule are enforced in `supabase/migrations/`
and `src/lib/`.

## Testing

Vitest runs three layers against the **local Supabase stack** (the suite is not hermetic —
start Docker first). The Brevo edge is the only mocked boundary
(`tests/helpers/brevo-mock.ts`); file-level parallelism is off since all files share one DB.

```bash
npm run db:start   # once, leave running
npm test           # or: npx vitest run tests/db tests/api tests/unit
```

- `tests/db/` — DB-integration: atomic accept/concurrency, RLS, catalog, email outbox.
- `tests/api/` — HTTP-handler integration through real middleware (auth, authz/IDOR, guest input).
- `tests/unit/` — hermetic logic + partial-failure branches the DB can't trigger on command.

See [`context/foundation/test-plan.md`](./context/foundation/test-plan.md) §6 for the cookbook
on adding tests by layer.

## Deployment

Deploys to Cloudflare Workers. The CI pipeline (`.github/workflows/ci.yml`) runs lint + build
and the full test suite (with a local Supabase stack) on every push/PR to `master`; on push
to `master` it pushes migrations to the linked Supabase project, then deploys the worker
(migrations land before the worker — additive-only policy).

Manual deploy:

```bash
npm run deploy   # build → db:push → wrangler deploy
```

Set production secrets in Cloudflare (`npx wrangler secret put SUPABASE_URL`, etc.) and the
required GitHub repository secrets (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN`) for CI.

## License

MIT
