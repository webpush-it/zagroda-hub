<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Guest Booking Request (S-03)

- **Plan**: `context/changes/guest-booking-request/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-08
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING → PASS (F2 fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS (F3 observation fixed) |
| Plan Completeness | WARNING → PASS (F1 fixed; F4 left as-is) |

## Grounding
15/15 paths ✓, 4/4 symbols ✓ (escapeHtml, renderEmailLayout, sendTransactionalEmail, fieldErrorsFromZod), brief↔plan ✓, no `docs/reference/contract-surfaces.md` (skipped). Progress section well-formed (one `## Progress`, all 4 phases present, parseable).

## Findings

### F1 — Owner-email retrieval can't use `.from(auth.users)`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real mechanism gap; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §2 (Submit API route)
- **Detail**: `createAdminClient()` returns a `public`-schema PostgREST/supabase-js client (`src/lib/supabase-admin.ts:14-23`); it cannot read `auth.users` via `.from('users')`/`.from('auth.users')` (auth schema not exposed; absent from `database.types.ts`). No `getUserById` caller exists anywhere; only `email_verified()` reads `auth.users` (bool, authenticated-only). Owner-email lookup is net-new — the transactional-email-channel archive plan already flagged this. The plan's literal "fetch owner `auth.users.email`" via the admin client won't compile/run.
- **Fix A ⭐ Recommended**: Use the GoTrue admin API — `admin.from('zagrody').select('name, owner_id')` then `admin.auth.admin.getUserById(owner_id)`.
  - Strength: No new migration; uses the service-role client already created; smallest surface.
  - Tradeoff: Two admin round-trips.
  - Confidence: HIGH — standard GoTrue admin call; service role already wired.
  - Blind spot: None significant.
- **Fix B**: New `SECURITY DEFINER` `owner_notification_target(zagroda_id)` returning email+name in one call.
  - Strength: Single round-trip; keeps auth.users access in SQL.
  - Tradeoff: Another migration + grant + test for this slice.
  - Confidence: HIGH — mirrors `email_verified()`.
  - Blind spot: Must restrict EXECUTE to service_role/authenticated, never anon.
- **Decision**: FIXED via Fix A (Phase 2 §2 + Current State Analysis updated to specify `getUserById`).

### F2 — Cancel page "shows the request summary" contradicts anon RLS

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State (L27) vs Phase 4 §1
- **Detail**: Desired End State + Phase 4 title/overview promise the cancel page "shows the request summary", but the visitor is anon, `booking_requests` has no anon SELECT policy (`domain_schema.sql:145-152`), and no anon read-by-token function exists. Phase 4 §1 itself hedges "minimal/no read needed", contradicting the end state. As written the page cannot fetch any detail.
- **Fix A ⭐ Recommended**: Drop the per-request summary; generic confirm ("Czy na pewno chcesz anulować to zapytanie?") + button; align Desired End State + Phase 4 wording.
  - Strength: Zero new DB surface; matches GET-safe goal; guest has context from the email.
  - Tradeoff: No echo of date/turnus before confirming.
  - Confidence: HIGH — removes a contradiction with no functional loss.
  - Blind spot: None significant.
- **Fix B**: Add anon-callable `booking_request_summary(token)` `SECURITY DEFINER` returning ONLY non-PII fields.
  - Strength: Richer confirm UX.
  - Tradeoff: New fn + grant + test; must exclude contact PII to preserve privacy NFR.
  - Confidence: MED — adds a second anon-exposed token surface.
  - Blind spot: Token-enumeration exposure widens (read + cancel).
- **Decision**: FIXED via Fix A (Desired End State + Phase 4 §1 reworded to a generic confirm, no detail read).

### F3 — Submit doesn't verify the zagroda is published

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2
- **Detail**: The anon INSERT policy checks only `status='pending'` (`domain_schema.sql:137-139`), not `is_published`. A crafted POST with a draft zagroda's id would create a pending request against an unpublished zagroda. Harm is low (only that owner sees it; no data exposure) and consistent with the "gate at accept" decision, but was unstated.
- **Fix**: Add a cheap server-side `is_published` check before insert (anon can already read published zagrody).
- **Decision**: FIXED (Phase 2 §2 now reads the zagroda with `is_published=true` and rejects with "Zagroda niedostępna"; manual verify 2.7 added).

### F4 — Phase 3/4 fold "build + lint" into one SC bullet, Progress splits it

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — cosmetic; fix is obvious
- **Dimension**: Plan Completeness
- **Location**: Phase 3/4 Success Criteria vs Progress 3.1/3.2, 4.1/4.2
- **Detail**: Phase 3/4 list "Build + lint pass" as one Automated bullet, but Progress enumerates them as two items. Benign — Progress is well-formed and parseable, so `/10x-implement` is unaffected.
- **Fix**: Leave as-is (Progress granularity is fine) or split the Phase bullet.
- **Decision**: DISMISSED (left as-is — no correctness impact).
