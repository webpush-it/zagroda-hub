# Owner Publishes Zagroda (S-01) Implementation Plan

## Overview

Deliver the first owner-visible feature: a verified-e-mail owner creates and edits their zagroda profile (name, description, location, photo, daily limit, turnusy) and explicitly publishes it. Publication semantics (RLS visibility + verified-e-mail gate) are enforced at the database layer and proven by tests; the catalog *page* that consumes them is S-02.

PRD refs: FR-006 (verification gate), FR-007 (login — email+password path already in baseline), FR-009 (profile fields), FR-010 (published = immediately public, no admin moderation). NFR: panel usable on mobile, vertical, one-handed.

## Current State Analysis

- **F-01 schema is live and minimal** (`supabase/migrations/20260605090307_domain_schema.sql`): `zagrody(id, owner_id UNIQUE → auth.users, name, daily_limit, created_at)`, `turnusy(id, zagroda_id, label, start_time, end_time)`, `booking_requests` with composite FK `(turnus_id, zagroda_id) → turnusy(id, zagroda_id) ON DELETE CASCADE`. No description/location/photo/published columns — F-01's plan explicitly deferred them to S-01.
- **RLS today**: `zagrody`/`turnusy` SELECT is unrestricted for `anon` + `authenticated`; owner-scoped INSERT/UPDATE/DELETE already exist (`20260605090307_domain_schema.sql:66-132`). `booking_requests` has no UPDATE/DELETE policies — state transitions go through SECURITY DEFINER functions only (F-01 posture).
- **Auth baseline is incomplete**: signup/signin/signout API routes exist (`src/pages/api/auth/*.ts`), middleware protects `/dashboard` (`src/middleware.ts:4`), but **no confirmation-callback route exists**, `email_confirmed_at` is checked nowhere, and local `supabase/config.toml` has `enable_confirmations = false` (line 209). `/auth/confirm-email` is a static page with a DEV-mode branch.
- **No storage configured**: no Supabase Storage bucket, no R2 binding in `wrangler.jsonc`.
- **No zod** despite `CLAUDE.md.scaffold` mandating zod validation for API routes — will be added.
- **Test infra from F-01**: vitest, node env, helpers in `tests/helpers/supabase.ts` (`createAdminClient`, `createOwnerClient`, `seedZagroda`, `seedBookingRequest`), suites in `tests/db/`. CI runs `supabase start -x studio,realtime,storage-api,imgproxy,edge-runtime,mailpit` then `npm test` — note `storage-api` is currently excluded.
- **Constraint discovered during planning**: with Supabase native confirmations enabled, an unverified user has no session (signUp returns `session: null`; signIn fails "Email not confirmed"). Decision: **native confirm-before-login** — once logged in, every owner is verified by definition; the DB gate stays as defense-in-depth.

## Desired End State

An owner can: sign up → receive confirmation e-mail → click link → land logged-in on `/dashboard` → fill in their zagroda profile (all FR-009 fields incl. dynamic turnusy list and optional photo) → tap "Opublikuj" → the zagroda becomes visible to `anon` queries. Unpublishing hides it again. An unverified user cannot log in and can resend the confirmation e-mail. All gates (verified e-mail, min. 1 turnus, required fields, publish-flag immutability outside the function, turnus-delete protection) are DB-enforced and covered by vitest suites.

### Key Discoveries:

- `accept_booking_request` pattern to mirror for the publish function: SECURITY DEFINER, `SET search_path = ''`, errcode-based errors (42501/55000/P0002), EXECUTE revoked from `public, anon` (`supabase/migrations/20260605094725_accept_booking_request.sql:14-105`).
- Composite FK `booking_requests → turnusy` is `ON DELETE CASCADE` — owner deleting a turnus would silently delete guest requests; `lessons.md` flags `turnus_id` as load-bearing for the lock-order contract. Must become RESTRICT.
- Postgres column-level privileges are additive — a column REVOKE cannot subtract from a table-level GRANT, so `is_published` immutability needs a trigger guard, not grants.
- Form pattern: React islands with `FormField`/`SubmitButton`/`ServerError` (`src/components/auth/*`), pages POST to `/api/*` routes; `cn()` for classes; shadcn/ui "new-york" in `src/components/ui/`.
- Existing UI copy is English (starter), but product-facing copy is Polish (PRD, Layout banners) — new owner-facing UI is written in Polish.
- `src/lib/supabase.ts` returns `null` when env vars are missing — every new caller must guard.

## What We're NOT Doing

- **No catalog page or zagroda detail page** — S-02. Publication visibility is proven by RLS tests, not UI.
- **No OAuth, no password reset** — S-06 (FR-008, FR-017, FR-018).
- **No booking-request UI** (list/accept/reject) — S-03/S-04.
- **No transactional app e-mails** — F-02. Verification e-mails go natively through Supabase Auth (explicitly allowed by roadmap F-02 note).
- **No multi-zagroda** — `owner_id UNIQUE` stays (PRD Non-Goal).
- **No admin moderation, no TERYT city dictionary, no image cropping/resizing pipeline** — single original-size upload with mime/size limits.
- **No "draft editing while unverified"** — superseded by the native confirm-before-login decision (unverified users have no session).

## Implementation Approach

Three phases mirroring the F-01 discipline: (1) schema + DB primitives with tests first — they are the contract S-02/S-03 build on; (2) complete the e-mail verification loop the starter left unfinished; (3) the mobile-first owner panel UI on top. DB is the source of truth for every gate; the app layer only adds UX. All new SQL follows F-01 conventions: pinned `search_path`, fully-qualified names, errcode-based errors, RLS-first.

## Critical Implementation Details

- **Timing & lifecycle**: flipping `enable_confirmations = true` changes signup behavior for *local dev and prod simultaneously-ish* — the prod toggle is a manual Supabase-dashboard step that must happen together with deploying the callback route, otherwise prod confirmation links break. Existing prod users were auto-confirmed at creation (confirmations were off), so they are unaffected.
- **State sequencing**: the `is_published` trigger guard must be created *after* the column exists but the publish function must be owned by the migration role (postgres) so its UPDATE passes the `current_user`-based guard while direct `authenticated`/`anon` UPDATEs are rejected. Test both directions.
- **Turnusy reconciliation**: the profile form replaces the turnusy set (update by id / insert new / delete removed). A delete hitting the new RESTRICT FK must surface as a domain error ("turnus ma zapytania"), not a 500.
- **Accepted risk — turnus time edits**: deletion is guarded (FK RESTRICT) but UPDATE of `start_time`/`end_time` on a turnus with referencing requests is not — it would silently change what guests booked. Accepted for S-01 (no request traffic exists before S-03 ships the form; only a hand-crafted REST insert could hit it). S-03 must decide the guard (trigger with status-scoping) when it touches `booking_requests` write paths — same integrity class as the `lessons.md` immutability rule.

## Phase 1: Schema & DB Primitives

### Overview

One migration (plus storage setup) extends `zagrody` with profile/publication fields, hardens the turnus FK, adds the verified-e-mail helper + publish function + trigger guard, and rewrites public SELECT policies. Tests prove every gate before any UI exists.

### Changes Required:

#### 1. Profile & publication migration

**File**: `supabase/migrations/<timestamp>_zagroda_profile_publication.sql`

**Intent**: Add everything S-01 needs in the domain schema: profile columns, publication flag, location enum, FK hardening, and the DB-enforced gates.

**Contract**:

- `CREATE TYPE public.voivodeship AS ENUM (...)` — the 16 Polish voivodeships, lowercase with diacritics (`'dolnośląskie'`, … `'zachodniopomorskie'`); these are both storage and display values.
- `ALTER TABLE public.zagrody ADD COLUMN`: `description text` (NULL = draft-incomplete), `voivodeship public.voivodeship` (NULL allowed in draft), `city text` (NULL allowed in draft; stored trimmed), `photo_path text` (NULL = no photo; storage object path), `is_published boolean NOT NULL DEFAULT false`.
- Composite FK on `booking_requests` `(turnus_id, zagroda_id)` recreated with `ON DELETE RESTRICT`. The F-01 constraint is unnamed — drop it by its auto-generated name (look up via `\d booking_requests` / `pg_constraint`) and re-add with an explicit name (e.g. `booking_requests_turnus_fkey`). This blocks turnus deletion directly and zagroda deletion transitively (zagroda → turnusy `CASCADE` → RESTRICT) — intended (12-month history NFR, lessons.md immutability rule). Add a migration comment documenting the cascade chain, including that deleting an `auth.users` row also fails once requests exist (owner_id → zagrody is CASCADE).
- `public.email_verified() RETURNS boolean` — SECURITY DEFINER, `SET search_path = ''`, returns whether `auth.users.email_confirmed_at IS NOT NULL` for `auth.uid()`; EXECUTE granted to `authenticated` only.
- `public.set_zagroda_published(zagroda_id uuid, publish boolean)` — SECURITY DEFINER, `SET search_path = ''`, mirrors `accept_booking_request` error style: raises 42501 when caller doesn't own the row, P0002 when not found; when `publish = true` additionally validates (raising distinct, app-mappable errors, suggested errcode 55000 + distinct messages): caller `email_verified()`, `name`/`description`/`city` non-empty, `voivodeship` set, at least one turnus exists. Photo is NOT required. When `publish = false`: no validations beyond ownership. Sets `is_published` and returns the new value. EXECUTE revoked from `public, anon`, granted to `authenticated`.
- Trigger guard: `BEFORE UPDATE ON public.zagrody FOR EACH ROW WHEN (OLD.is_published IS DISTINCT FROM NEW.is_published)` → trigger function raises (42501) when `current_user IN ('authenticated', 'anon')`. The SECURITY DEFINER publish function (owner: postgres) passes; direct RLS-path updates cannot flip the flag. The INSERT path needs no trigger: extend the existing owner INSERT policy's `WITH CHECK` with `AND is_published = false` (policies can check NEW values on INSERT — the trigger workaround is only needed for UPDATE's OLD/NEW comparison).
- RLS SELECT rewrite:
  - `zagrody`: drop the unrestricted public SELECT policy; new policy for `anon, authenticated`: `USING (is_published OR (SELECT auth.uid()) = owner_id)`.
  - `turnusy`: drop unrestricted public SELECT; new policy: visible when parent zagroda is published or owned by the caller (EXISTS subquery on `public.zagrody`).
  - Existing owner-scoped INSERT/UPDATE/DELETE policies on both tables stay untouched.

#### 2. Storage bucket + policies

**File**: same migration (or a sibling `<timestamp>_zagroda_photos_bucket.sql`)

**Intent**: Create the `zagroda-photos` public bucket with owner-scoped write access so photo upload works identically in local dev, CI, and prod.

**Contract**: `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)` → `('zagroda-photos', 'zagroda-photos', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])`. Policies on `storage.objects` for `authenticated`: INSERT/UPDATE/DELETE restricted to `bucket_id = 'zagroda-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text`. Public read comes from the bucket's `public` flag (CDN URL); no anon SELECT policy needed.

#### 3. Regenerated DB types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate via `npm run db:types` so the new columns, enum, and function are typed; commit the result.

**Contract**: `Database` type gains `voivodeship` enum, new `zagrody` columns, and `set_zagroda_published` in `Functions`.

#### 4. Test helper extensions

**File**: `tests/helpers/supabase.ts`

**Intent**: Support unverified users and published zagrody in seeds.

**Contract**: user-creation helper accepts an `emailConfirmed: boolean` option (admin API `email_confirm`); `seedZagroda` accepts optional profile-field overrides and a `published` flag (admin client may set `is_published` directly — service_role bypasses the trigger guard's role check by design; verify this in a test or seed via the function with a confirmed owner).

#### 5. Publication-gate test suite

**File**: `tests/db/publication-gate.test.ts`

**Intent**: Prove every publish gate as observable behavior, mirroring `acceptance-rule.test.ts` style (sequential lettered cases).

**Contract**: cases — (a) verified owner + complete profile + ≥1 turnus → publish succeeds, anon can now SELECT the row; (b) unverified owner → publish raises (mappable error); (c) verified owner, zero turnusy → raises; (d) missing required field (e.g. no city) → raises; (e) photo absent → publish still succeeds; (f) non-owner caller → 42501; (g) nonexistent id → P0002; (h) unpublish succeeds without validations; (i) direct `UPDATE zagrody SET is_published = true` as owner → rejected by trigger guard; (j) INSERT with `is_published = true` as owner → rejected by the INSERT policy `WITH CHECK`.

#### 6. Visibility & FK-guard tests

**File**: `tests/db/visibility-rls.test.ts` (new; existing `rls.test.ts` stays booking_requests-focused)

**Intent**: Prove the new SELECT semantics and the turnus-delete protection.

**Contract**: cases — (a) anon sees published zagroda, not draft; (b) owner sees own draft; (c) foreign authenticated owner does NOT see another's draft; (d) turnusy visibility follows parent zagroda; (e) owner deleting a turnus with a booking_request → FK RESTRICT violation (`23503`); (f) deleting a turnus with no requests → succeeds.

#### 7. CI storage service

**File**: `.github/workflows/ci.yml`

**Intent**: Remove `storage-api` (and `imgproxy` if storage requires it) from the `-x` exclusion list in the test job so bucket migrations apply in CI.

**Contract**: `supabase start -x studio,realtime,edge-runtime,mailpit` (final list verified by a green CI run).

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly from scratch: `npx supabase db reset`
- Regenerated types committed, no drift: `npm run db:types` then `git diff --exit-code src/db/database.types.ts`
- All DB suites green (new + F-01 regression): `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- In local Studio/psql: `zagroda-photos` bucket exists with 5 MB limit and image mime types; new policies listed on `zagrody`/`turnusy`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: E-mail Verification Loop

### Overview

Complete the confirmation flow the starter stubbed out: enable confirmations, handle the link, map the "not confirmed" sign-in error, and offer resend. After this phase every logged-in user has `email_confirmed_at` set.

### Changes Required:

#### 1. Local auth config

**File**: `supabase/config.toml`

**Intent**: Mirror the production gate locally: require e-mail confirmation and route the confirmation link through our callback.

**Contract**: `[auth.email] enable_confirmations = true`; confirmation e-mail template overridden (template file + `content_path`) so the link is `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=signup`; `site_url` / `additional_redirect_urls` cover `http://localhost:4321`.

#### 2. Confirmation callback route

**File**: `src/pages/api/auth/confirm.ts`

**Intent**: Verify the token from the e-mail link and sign the user in.

**Contract**: `GET` handler; reads `token_hash` + `type` query params, calls `supabase.auth.verifyOtp({ token_hash, type })` (sets session cookies via the SSR client), redirects to `/dashboard` on success and to `/auth/signin?error=...` (Polish message) on failure/expiry. Guards the null-client case like sibling routes.

#### 3. Resend endpoint

**File**: `src/pages/api/auth/resend.ts`

**Intent**: Let a user whose confirmation e-mail was lost request another, without enabling user enumeration.

**Contract**: `POST` with form-encoded `email` (zod-validated); calls `supabase.auth.resend({ type: 'signup', email })`; always redirects back to `/auth/confirm-email?sent=1` regardless of whether the account exists.

#### 4. Confirm-email page rework

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Turn the static stub into the post-signup hub: explain the gate, offer resend.

**Contract**: removes the `import.meta.env.DEV` auto-confirm branch; shows "sprawdź skrzynkę" copy (Polish), a resend form POSTing to `/api/auth/resend` (e-mail field pre-filled from `?email=` when present), and a confirmation note when `?sent=1`.

#### 5. Sign-in error mapping

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Route unverified users to the resend path instead of a raw Supabase error string.

**Contract**: signin detects the "Email not confirmed" error and redirects to `/auth/confirm-email?email=<email>` instead of `?error=`; signup passes the e-mail along in its redirect (`/auth/confirm-email?email=...`). Successful signin redirect changes from `/` to `/dashboard` (owner lands in their panel).

#### 6. Production configuration (manual ops)

**File**: `context/changes/owner-publishes-zagroda/plan.md` (this checklist) — no code

**Intent**: The hosted Supabase project must match local config at deploy time.

**Contract**: in the Supabase dashboard — enable "Confirm email", set Site URL to the production domain (`https://zagroda-hub.webpushit.workers.dev`), add it to redirect URLs, and update the confirmation e-mail template to the `/api/auth/confirm?token_hash=...&type=signup` form. Done in the same window as the production deploy of this phase.

**Known limitation (accepted)**: hosted Supabase's built-in SMTP is dev-grade and rate-limited to a handful of e-mails per hour — a signup burst hits the cap and resend fails too. Accepted at MVP scale (signups trickle in); check the project's current auth rate limits while in the dashboard and note the cap. The custom-SMTP/provider decision belongs to F-02 (transactional-email-channel) — revisit there.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Test suites unaffected (helpers create users via admin API): `npm test`

#### Manual Verification:

- Local: signup → e-mail visible in Mailpit (`localhost:54324`) → clicking link lands logged-in on `/dashboard`
- Local: signin before confirming shows the confirm-email page with working resend (second e-mail arrives in Mailpit)
- Production: settings updated per the ops checklist; one real signup confirms end-to-end

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Owner Profile Panel UI

### Overview

The mobile-first owner panel: profile form with dynamic turnusy editor, photo upload, and publish/unpublish — in Polish, one-handed, vertical.

### Changes Required:

#### 1. zod dependency

**File**: `package.json`

**Intent**: Add `zod` for API-route validation per `CLAUDE.md.scaffold` mandate.

**Contract**: runtime dependency; shared schemas live in `src/lib/` so the React island can reuse them client-side.

#### 2. Profile API route

**File**: `src/pages/api/zagroda/index.ts`

**Intent**: Upsert the caller's zagroda profile and reconcile its turnusy in one request.

**Contract**: `PUT` (JSON, zod-validated): `name` (non-empty), `description`, `voivodeship` (enum), `city` (trimmed), `daily_limit` (int 1–1000, matching the DB CHECK), `turnusy: [{ id?, label, start_time, end_time }]` with `HH:MM` format and `end > start` validation. Uses the user's SSR client (RLS enforces ownership): upsert `zagrody` (insert on first save — `owner_id = auth.uid()`), then reconcile turnusy (update rows with `id`, insert rows without, delete missing ones). A `23503` on turnus delete maps to 409 with a Polish domain message ("Turnus ma już zapytania — nie można go usunąć"). Returns JSON `{ ok }` or `{ fieldErrors }` (422). Pattern note for all three JSON routes (deliberate divergence from the form-POST+redirect auth routes): uppercase method exports per `CLAUDE.md.scaffold`; the null-Supabase-client guard returns JSON 503, not a redirect.

#### 3. Photo upload route

**File**: `src/pages/api/zagroda/photo.ts`

**Intent**: Accept a phone photo, store it owner-scoped, point `photo_path` at it.

**Contract**: `POST` multipart with a single `photo` file; requires the caller's `zagrody` row to exist — returns 409 ("najpierw zapisz profil") before touching storage when it doesn't (a missing row would make the `photo_path` UPDATE a silent no-op under RLS); validates mime (`jpeg/png/webp`) and size (≤ 5 MB) before upload; stores at `zagroda-photos/<auth.uid()>/<random>.<ext>` via the user's SSR client (storage RLS applies); updates `zagrody.photo_path`; best-effort deletes the previously referenced object. Returns the new public URL.

#### 4. Publish route

**File**: `src/pages/api/zagroda/publish.ts`

**Intent**: Thin wrapper over the DB primitive.

**Contract**: `POST` JSON `{ publish: boolean }`; resolves the caller's zagroda id, calls `rpc('set_zagroda_published', ...)`; maps the function's distinct error messages to Polish UX copy: unverified ("Zweryfikuj adres e-mail"), no turnus ("Dodaj co najmniej jeden turnus"), incomplete profile (named missing fields). Returns `{ is_published }`.

#### 5. Dashboard page rework

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the starter "Welcome" stub with the owner panel: load the owner's zagroda (or none) server-side and render the profile island.

**Contract**: server-side query via SSR client for the caller's `zagrody` row + its `turnusy`; passes initial data (or `null` for first-time) to `<ZagrodaProfileForm client:load />`; keeps sign-out; shows publication status (Szkic / Opublikowana) prominently.

#### 6. Profile form island

**Files**: `src/components/zagroda/ZagrodaProfileForm.tsx` (+ small subcomponents as needed, e.g. `TurnusyEditor.tsx`, `PhotoUpload.tsx`)

**Intent**: The single mobile-first form for the whole FR-009 field set, with explicit save and publish actions.

**Contract**: React island reusing the `FormField`-style conventions (Polish labels); native `<select>` for voivodeship (16 options); dynamic turnusy rows (label + two `type="time"` inputs, add/remove buttons with large tap targets); photo input (`accept="image/*"`, preview, uploads via `/api/zagroda/photo` on selection — disabled with hint "zapisz profil, aby dodać zdjęcie" until the profile exists, i.e. `initialData` is non-null or the first save succeeded); "Zapisz" submits via `fetch` PUT to `/api/zagroda` and renders field errors inline; "Opublikuj"/"Cofnij publikację" calls `/api/zagroda/publish` and surfaces gate errors near the button. Single-column layout, actions reachable in the bottom half of a vertical phone screen.

#### 7. Topbar polish

**File**: `src/components/Topbar.astro`

**Intent**: Keep nav consistent — the Dashboard link is the entry to the panel; no new nav structure.

**Contract**: copy only ("Panel" / Polish labels where touched); no structural change.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- All suites still green: `npm test`

#### Manual Verification:

- Full flow on a phone-sized viewport (vertical, one-handed): signup → confirm → create profile → add 2 turnusy → upload photo → publish — no horizontal scrolling, all actions thumb-reachable
- Publish with zero turnusy is blocked with the Polish message; succeeds after adding one
- Anon visibility: REST/psql query as `anon` returns the published zagroda and not a draft; after "Cofnij publikację" it disappears
- Turnus with a seeded booking_request cannot be removed via the form — friendly 409 message shown
- Photo replace works (old object removed from bucket, new URL renders)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- (DB-level, vitest against local Supabase — house style from F-01) publication gates: verified/unverified, turnus count, required fields, photo-optional, ownership, direct-flag-flip rejection
- Visibility RLS: anon vs owner vs foreign owner, drafts vs published, turnusy inheritance
- FK RESTRICT: turnus delete with/without referencing requests

### Integration Tests:

- F-01 regression: `acceptance-rule`, `concurrency`, `rls` suites must stay green (schema change is additive; FK direction change affects deletes only)

### Manual Testing Steps:

1. Local end-to-end: signup → Mailpit link → `/dashboard` → fill profile → publish → verify anon SELECT
2. Resend path: signin before confirmation → confirm-email page → resend → second Mailpit message
3. Mobile guardrail: complete flow in vertical phone viewport one-handed
4. Production smoke after deploy + dashboard config: one real signup/confirm/publish

## Performance Considerations

Negligible at MVP scale. The new SELECT policies add an `is_published` predicate (zagrody) and an EXISTS subquery (turnusy) — trivial at <100 rows; S-02 can add a partial index on `zagrody(is_published)` if catalog p95 demands it. Photo uploads capped at 5 MB, single original served via Supabase CDN.

## Migration Notes

- All schema changes are additive except the FK `CASCADE → RESTRICT` swap; no rows reference turnusy in production yet, so the swap is risk-free now and load-bearing later.
- Existing production users were created with confirmations disabled → `email_confirmed_at` already set → unaffected by the gate.
- Prod Supabase dashboard changes (confirmations ON, Site URL, e-mail template) must land in the same window as the Phase 2 deploy — see Phase 2 change #6.

## References

- Roadmap entry S-01: `context/foundation/roadmap.md:94-104`
- PRD: FR-006/007/009/010 — `context/foundation/prd.md:105-121`
- F-01 contract: `context/archive/2026-06-05-booking-schema-and-overbooking-guard/plan.md`
- Lock-order/immutability lesson: `context/foundation/lessons.md:5-10`
- SECURITY DEFINER pattern: `supabase/migrations/20260605094725_accept_booking_request.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & DB Primitives

#### Automated

- [x] 1.1 Migrations apply cleanly: `npx supabase db reset` — 2c323ff
- [x] 1.2 Regenerated types committed, no drift: `npm run db:types` + `git diff --exit-code src/db/database.types.ts` — 2c323ff
- [x] 1.3 All DB suites green (new + F-01 regression): `npm test` — 2c323ff
- [x] 1.4 Lint passes: `npm run lint` — 2c323ff

#### Manual

- [x] 1.5 Bucket + policies spot-checked in local Studio/psql — 2c323ff

### Phase 2: E-mail Verification Loop

#### Automated

- [x] 2.1 Lint passes: `npm run lint`
- [x] 2.2 Build passes: `npm run build`
- [x] 2.3 Test suites unaffected: `npm test`

#### Manual

- [x] 2.4 Local signup → Mailpit link → logged-in on `/dashboard`
- [x] 2.5 Unverified signin routes to confirm-email page; resend delivers
- [ ] 2.6 Production Supabase dashboard configured (ops checklist)

### Phase 3: Owner Profile Panel UI

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Build passes: `npm run build`
- [ ] 3.3 All suites still green: `npm test`

#### Manual

- [ ] 3.4 Full mobile one-handed flow (signup → profile → turnusy → photo → publish)
- [ ] 3.5 Publish gate UX (zero-turnusy blocked, Polish message)
- [ ] 3.6 Anon sees published only; unpublish hides
- [ ] 3.7 Turnus-with-requests delete blocked with friendly 409
- [ ] 3.8 Photo replace works (old object cleaned up)
