<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Owner Publishes Zagroda (S-01)

- **Plan**: context/changes/owner-publishes-zagroda/plan.md
- **Mode**: Deep
- **Date**: 2026-06-05
- **Verdict**: SOUND (after triage — all 6 findings fixed in plan, 2026-06-05)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS (1 observation) |
| Architectural Fitness | PASS (1 observation) |
| Blind Spots | WARNING (3 warnings, 1 observation) |
| Plan Completeness | PASS |

## Grounding

9/9 paths ✓, 3/3 symbols ✓, brief↔plan ✓. No `docs/reference/contract-surfaces.md` (check skipped).

Deep verification confirmed: test helpers create users via admin API with `email_confirm: true` (`tests/helpers/supabase.ts:39`) — suites survive `enable_confirmations = true`; no existing test or src/ code SELECTs `zagrody`/`turnusy` through RLS-bound clients — zero blast radius for the SELECT-policy rewrite; `'signup'` is a valid `verifyOtp` token_hash type (`@supabase/auth-js` `EmailOtpType`); imgproxy is only needed for image transformation (unused — originals only), so removing only `storage-api` from the CI `-x` list is correct; signin redirect `/` → `/dashboard` has no dependents.

## Findings

### F1 — Photo upload has no zagroda row to update on first visit

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — changes #3 (photo route) and #6 (form island)
- **Detail**: The form island "uploads via /api/zagroda/photo on selection" and the photo route "updates zagrody.photo_path", but a first-time owner has no `zagrody` row until the first "Zapisz" — the upload succeeds in storage while the `photo_path` UPDATE silently no-ops under RLS. The plan never sequences photo vs first save.
- **Fix A ⭐ Recommended**: Disable photo upload until the profile exists (island knows `initialData` is null); copy explains "zapisz profil, aby dodać zdjęcie".
  - Strength: Trivial gating; no orphaned objects; route keeps one responsibility.
  - Tradeoff: Owner must save once before adding the photo.
  - Confidence: HIGH — pure sequencing fix, no new surface.
  - Blind spot: None significant.
- **Fix B**: Upload returns only the storage path; `PUT /api/zagroda` persists `photo_path` with the other fields.
  - Strength: Single save action; photo pickable before first save.
  - Tradeoff: Orphaned objects when user uploads but never saves; PUT must validate the path belongs to the caller's folder.
  - Confidence: MEDIUM — workable but adds a cleanup concern.
  - Blind spot: Orphan-cleanup story unspecified.
- **Decision**: FIXED via Fix A — photo route returns 409 without a profile row; island disables upload until profile exists.

### F2 — Prod confirmation e-mails ride Supabase's dev-grade SMTP

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — change #6 (production ops checklist)
- **Detail**: Enabling confirmations in prod makes every signup depend on e-mail delivery, but hosted Supabase's built-in SMTP is rate-limited to a handful of e-mails per hour and not intended for production. A burst of signups hits the cap; resend then fails too. The ops checklist configures the gate but says nothing about deliverability.
- **Fix A ⭐ Recommended**: Document the limit in the Phase 2 ops checklist and accept for MVP scale; revisit at F-02 (transactional e-mail channel) where the provider decision lives.
  - Strength: Zero extra work now; signups trickle at MVP scale; F-02 is the natural decision point.
  - Tradeoff: A signup burst hits the cap with a confusing "no e-mail arrived" failure.
  - Confidence: HIGH — matches top_blocker: time and the roadmap's F-02 note.
  - Blind spot: Exact per-hour cap on the hosted project unverified.
- **Fix B**: Configure custom SMTP in the same ops step.
  - Strength: Removes the failure mode before anyone signs up.
  - Tradeoff: Forces the e-mail-provider decision ahead of F-02 — duplicated research under time pressure.
  - Confidence: MEDIUM — out-of-order provider choice may not match F-02's outcome.
  - Blind spot: Whether F-02's chosen mechanism even offers SMTP.
- **Decision**: FIXED via Fix A — rate-limit risk documented in Phase 2 ops checklist; provider decision deferred to F-02.

### F3 — Turnus time edits with accepted requests are unguarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — change #1 / Phase 3 — change #2 (turnusy reconcile)
- **Detail**: Deletion is guarded (FK RESTRICT) but UPDATE isn't: editing a turnus from 9-12 to 14-17 silently changes what guests already booked — same integrity class lessons.md flags for deletes. Anon INSERT on `booking_requests` is already live (F-01 RLS), so referencing requests are technically possible before S-03.
- **Fix A ⭐ Recommended**: Accept for MVP, add a note to the plan, queue the guard decision for S-03.
  - Strength: No real request traffic until S-03; avoids speculative trigger work; the note keeps the risk visible.
  - Tradeoff: Theoretical window where a REST-crafted request could be re-timed silently.
  - Confidence: HIGH — preconditions don't occur in practice before S-03.
  - Blind spot: None significant.
- **Fix B**: Trigger blocking start/end updates on turnusy with referencing requests (mirror of FK RESTRICT).
  - Strength: Closes the class now, DB-first.
  - Tradeoff: More Phase 1 surface; owners can't fix a typo'd time once any request exists unless the trigger filters by status — more logic.
  - Confidence: MEDIUM — status-scoping is exactly the discussion S-03 should own.
  - Blind spot: Status-scoping semantics unexplored.
- **Decision**: FIXED via Fix A — accepted-risk note added to Critical Implementation Details; guard decision queued for S-03.

### F4 — BEFORE INSERT trigger where a WITH CHECK clause suffices

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 — change #1 (trigger guard)
- **Detail**: Unlike UPDATE (no OLD/NEW in policies), INSERT needs no trigger: the existing owner INSERT policy's WITH CHECK can gain `AND is_published = false`. One less trigger.
- **Fix**: Replace the BEFORE INSERT trigger with the WITH CHECK extension; keep the UPDATE trigger guard as planned.
- **Decision**: FIXED — INSERT trigger replaced with `AND is_published = false` in the existing INSERT policy WITH CHECK; test case (j) updated.

### F5 — JSON routes diverge from form-POST pattern; null-guard shape unspecified

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 — changes #2–#4
- **Detail**: Verified all existing API routes are form-POST + redirect; the JSON routes are a genuinely new (justified) pattern. Existing routes handle the null Supabase client with a redirect — JSON routes must return a JSON error instead, and the plan doesn't say so.
- **Fix**: One sentence in Phase 3 change #2: "null-client guard returns JSON 503 (not a redirect); uppercase PUT export."
- **Decision**: FIXED — pattern note added to Phase 3 change #2 covering all three JSON routes.

### F6 — FK swap mechanics: unnamed constraint + transitive protection

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — change #1 (FK recreation)
- **Detail**: The F-01 composite FK is unnamed (auto-generated name must be looked up to drop). Zagroda-delete protection is transitive only (zagroda → turnusy CASCADE → RESTRICT) — works, but also means deleting an `auth.users` row fails once requests exist.
- **Fix**: Name the recreated constraint explicitly and add a migration comment documenting the cascade chain (incl. the auth.users implication).
- **Decision**: FIXED — explicit constraint name + cascade-chain migration comment specified in Phase 1 change #1.
