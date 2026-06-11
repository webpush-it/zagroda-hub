<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Gated Acceptance with Overbooking Guard (S-04)

- **Plan**: context/changes/gated-acceptance-with-overbooking-guard/plan.md
- **Scope**: Full plan (3 of 3 phases)
- **Date**: 2026-06-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Evidence: drift agent found full MATCH across all 3 phases (only EXTRA: StatusBadge.tsx, justified shared component); scope guardrails all respected. Success criteria re-run at review time: `npm test` 108/108, `npm run lint` exit 0, `npm run build` exit 0. Manual items backed by observable local + production smoke (US-01, race, privacy, emails via Brevo).

## Findings

### F1 — FR-006 email-verification gate enforced only at the API layer, not in the decision RPCs

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/booking-request/accept.ts:30, reject.ts:28, supabase/migrations/20260611100000_reject_booking_request.sql
- **Detail**: Both decision RPCs grant EXECUTE to all `authenticated` and check only ownership; an unverified owner could call them directly via PostgREST, bypassing the route-level 409. Contrast: `set_zagroda_published` enforces verification inside the SECURITY DEFINER function. The plan documented this deliberately ("the FR-006 gate lives in the API routes"; unverified owners can't publish, so they can't have requests — the state is practically unreachable).
- **Fix A (Recommended)**: Accept as documented plan decision.
- **Fix B**: Add `public.email_verified()` check inside both RPCs (follow-up migration), map error like publish.ts.
- **Decision**: ACCEPTED — Fix A (documented plan decision; bypass state unreachable in domain)

### F2 — Unguarded `data[0]` after RPC in accept/reject

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/booking-request/accept.ts:76, reject.ts:71
- **Detail**: `const row = data[0]; if (!row.accepted)` throws TypeError if the RPC ever returns zero rows — raw 500 instead of the Polish error mapping.
- **Fix**: Guard with `data.at(0)` and return a Polish 500 when empty.
- **Decision**: FIXED — `data.at(0)` + null guard in both routes

### F3 — Email links derive origin from request.url

- **Severity**: OBSERVATION
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/booking-request/index.ts:97
- **Detail**: Owner deep link + guest cancel link built origin from the incoming Host — theoretical phishing vector under an unexpected host. Inherited S-03 pattern, endorsed by the plan ("as today").
- **Fix**: Configured site origin instead of request.url.
- **Decision**: FIXED — `SITE_URL` env (astro.config schema + wrangler.jsonc vars) with request-origin fallback for dev

### F4 — Duplicated helpers and a second pre-fetch round trip

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: accept.ts, reject.ts
- **Detail**: `enqueueDecisionEmail` and `json()` duplicated between accept/reject; pre-fetch issued two queries though the zagroda name can join into one select.
- **Fix**: Shared module + single select.
- **Decision**: FIXED — shared `src/lib/booking-decision.ts` (`json`, `enqueueDecisionEmail`); pre-fetch uses nested embed `turnusy(label, zagrody(name))` (direct `zagrody(name)` embed impossible — booking_requests has no direct FK to zagrody; nested path verified at runtime against local PostgREST)

### F5 — Two cosmetic nits

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/email/layout.ts:10, src/pages/dashboard/zapytania/[id].astro
- **Detail**: (1) `escapeHtml` didn't escape single quotes — safe today, future footgun. (2) `id ?? ""` when mounting the island — unreachable empty string.
- **Fix**: Escape `'` as `&#39;`; carry the validated id inside the `request` object.
- **Decision**: FIXED — both applied

## Triage summary

- Fixed: F2, F3, F4, F5
- Accepted: F1 (Fix A — documented plan decision)
- Post-fix verification: `npm test` 108/108, `npx eslint .` exit 0, `npm run build` exit 0; nested embed runtime-checked against local Supabase.
