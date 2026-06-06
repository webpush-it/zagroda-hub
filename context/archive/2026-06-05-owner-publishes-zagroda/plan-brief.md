# Owner Publishes Zagroda (S-01) — Plan Brief

> Full plan: `context/changes/owner-publishes-zagroda/plan.md`

## What & Why

The first owner-visible slice: a zagroda owner with a verified e-mail creates and edits their profile (name, description, location, photo, daily limit, turnusy) and explicitly publishes it to the public catalog. The verification gate is the product's only anti-spam mechanism (FR-010 ships without admin moderation), so it is enforced in the database, not just the UI.

## Starting Point

F-01 delivered the minimal domain schema (`zagrody` with owner + daily limit, `turnusy`, `booking_requests`, atomic accept function) but no profile fields, no published flag, and unrestricted public SELECT. The auth starter has signup/signin but the e-mail confirmation loop is unfinished — no callback route, `email_confirmed_at` checked nowhere, confirmations disabled. No photo storage exists anywhere.

## Desired End State

An owner signs up, confirms via e-mail link (landing logged-in on `/dashboard`), fills in the full FR-009 profile on a phone one-handed, and taps "Opublikuj" — the zagroda instantly becomes visible to anonymous queries (the catalog page itself is S-02). Unpublish hides it. Every gate is DB-enforced and test-proven.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Photo storage | Supabase Storage (public bucket, owner-scoped paths) | Stays in the existing stack — RLS reuses auth, works in local dev/CI, ample free tier. |
| Photo requirement | Optional to publish | Lowest publish friction for a field-working owner; placeholder in catalog. |
| Publication model | `is_published` boolean + explicit publish toggle | Matches FR-006 wording, allows temporary unpublish; boolean can become an enum in v2. |
| Gate enforcement | DB-enforced (`set_zagroda_published()` SECURITY DEFINER + trigger guard) + app UX | Consistent with F-01's RLS-first posture; no future route can bypass the anti-spam gate. |
| Verification flow | Native Supabase confirm-before-login + resend button | Discovered constraint: unverified users have no session — custom token machinery isn't worth days of auth risk. |
| Turnus deletion | FK `CASCADE → RESTRICT` (block when requests exist) | Prevents silent guest-data loss and protects the F-01 lock-order immutability contract. |
| Location capture | Voivodeship enum (16) + free-text city (trimmed) | Exact primary filter axis for S-02 with zero external data dependency. |
| S-01/S-02 boundary | Publication semantics only — no catalog page | Clean slice boundary; visibility proven by RLS tests, not throwaway UI. |

## Scope

**In scope:** zagrody profile columns + `voivodeship` enum + `is_published`; publish/unpublish DB function with verified-e-mail / min-1-turnus / required-fields gates; RLS visibility rewrite (drafts owner-only); storage bucket + photo upload; complete e-mail confirmation loop (callback, resend, error mapping); mobile-first owner panel (profile form, turnusy editor, photo, publish); zod for API validation; DB test suites for all gates.

**Out of scope:** catalog/zagroda pages (S-02), OAuth + password reset (S-06), booking-request UI (S-03/S-04), transactional app e-mails (F-02), multi-zagroda, admin moderation, image processing pipeline.

## Architecture / Approach

DB is the source of truth for every gate, app layer adds UX — mirroring F-01. One migration extends the schema and rewrites SELECT policies; `set_zagroda_published()` (SECURITY DEFINER, errcode-style errors) is the only way to flip the flag (trigger guard rejects direct updates). The UI is a single React island on `/dashboard` talking to three zod-validated API routes (profile upsert + turnusy reconcile, photo upload, publish), following the existing form-component conventions, in Polish.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & DB primitives | Migration + gates + storage bucket, proven by new vitest suites | Trigger-guard mechanics (`current_user` check) need both directions tested |
| 2. E-mail verification loop | Confirmation callback, resend, error mapping, config flip | Prod dashboard config must land with the deploy or prod links break |
| 3. Owner profile panel UI | Mobile-first form (fields, turnusy editor, photo, publish) | Turnusy reconcile hitting FK RESTRICT must surface as domain error, not 500 |

**Prerequisites:** F-01 archived (done); local Supabase via Docker; access to the hosted Supabase dashboard for Phase 2 ops step.
**Estimated effort:** ~3 sessions, one per phase (after-hours pace).

## Open Risks & Assumptions

- Assumes existing prod users were auto-confirmed while confirmations were off (true per Supabase behavior) — gate flip doesn't lock anyone out.
- CI must start `storage-api` (currently excluded) for bucket migrations — small CI change, verified by a green run.
- City as free text can fragment the S-02 filter on typos — accepted; S-02 mitigates with case/diacritic-insensitive matching.

## Success Criteria (Summary)

- A verified owner can publish a complete profile from a phone, one-handed; an unverified user can't log in but can resend the confirmation e-mail.
- Anonymous queries see only published zagrody; drafts are owner-only — proven by RLS tests.
- All F-01 suites stay green; no path exists to publish without verified e-mail + ≥1 turnus + required fields.
