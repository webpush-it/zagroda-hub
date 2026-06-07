<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Transactional Email Channel (F-02)

- **Plan**: context/changes/transactional-email-channel/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-08
- **Verdict**: NEEDS ATTENTION (no blockers)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Shared email layout has no escaping primitive for bodyHtml

- **Severity**: ⚠️ WARNING (sub-agent rated CRITICAL; downgraded — no live vuln, only caller injects a server timestamp)
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrow
- **Dimension**: Safety & Quality
- **Location**: src/lib/email/layout.ts:28
- **Detail**: `title` is escaped but `opts.bodyHtml` is interpolated raw (by design — callers pass HTML). No escaping helper is exported, so the path of least resistance for S-03/S-04/S-05 (which will embed user data) is an unescaped template literal → HTML injection into recipient inboxes. Shipped code is safe (only caller passes a server timestamp); the hazard is structural for downstream slices.
- **Fix**: Export `escapeHtml` from layout.ts (re-export from the email barrel) + a doc note that values interpolated into `bodyHtml` must be escaped.
- **Decision**: FIXED — exported `escapeHtml` from layout.ts (+ doc comment) and re-exported from the email barrel (index.ts).

### F2 — /api/dev/test-email is reachable + quota-exhaustible in prod

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/dev/test-email.ts:19
- **Detail**: Auth-only and self-addressed but unthrottled; a signed-in user could loop it and burn the 300/day Brevo quota. Already a documented accepted risk. The standard `import.meta.env.DEV` gate conflicts with the plan — criterion 3.6 requires hitting this endpoint on prod for the smoke.
- **Fix A ⭐ Recommended**: Keep as-is (documented accepted risk)
  - Strength: Endpoint is the prod-smoke mechanism (3.6); self-limited to caller's own address; risk is written down.
  - Tradeoff: Quota exhaustion theoretically possible.
  - Confidence: HIGH — matches the plan's explicit accepted-risk note.
  - Blind spot: No abuse telemetry.
- **Fix B**: Add a per-user cooldown (1 send / N min)
  - Strength: Caps abuse while keeping prod smoke working.
  - Tradeoff: New state (KV/DB) for a dev-only endpoint.
  - Confidence: MED — KV session binding exists.
  - Blind spot: Cooldown store not scoped.
- **Decision**: ACCEPTED (Fix A) — kept as-is; documented accepted risk, and the endpoint must stay reachable in prod for the 3.6 smoke. Revisit (cooldown/remove) if abuse appears.

### F3 — "Sent but mark-failed" will resend a duplicate

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/email/outbox.ts:74-85
- **Detail**: If Brevo send succeeds but the status='sent' UPDATE fails, the row stays pending; after lease expiry the cron re-claims and re-sends a duplicate (Brevo not idempotent on this payload). Bounded to ~5 by the attempts cap. Inline comment understates it ("may resend" → will resend).
- **Fix A ⭐ Recommended**: Accept for MVP; tighten the comment
  - Strength: Bounded (≤5); matches the plan's lease tradeoff; low harm.
  - Tradeoff: Occasional 2× delivery.
  - Confidence: HIGH — attempts cap proven by tests.
  - Blind spot: None significant at MVP volume.
- **Fix B**: Send a Brevo idempotency/dedup key derived from row.id
  - Strength: Eliminates duplicates at the provider.
  - Tradeoff: Couples to a Brevo feature; extra payload + verification.
  - Confidence: LOW — Brevo support on this route unverified.
  - Blind spot: Brevo idempotency-key support unverified.
- **Decision**: FIXED (Fix A) — accepted the bounded duplicate risk for MVP; tightened the inline comment to state it WILL resend (≤5). Idempotency key (Fix B) left as a future option.

### F4 — claim RPC result not null-guarded (cron unhandled rejection)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrow
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/email/outbox.ts:55-67
- **Detail**: `for (const row of rows)` / `rows.length` assume an array. If PostgREST returns null data with no error, both throw. The immediate path has a .catch (index.ts:54); the cron `waitUntil` (worker.ts:49) does not → unhandled rejection, silent sweep failure. Low likelihood (setof returns []), but unguarded.
- **Fix**: `const rows = data ?? []` before the loop.
- **Decision**: DISMISSED — non-issue. The typed linter proves `data` is a non-nullable array after the error-check (`claim_due_emails` returns `setof`), so `rows.length`/iteration can't throw and `?? []` is dead code (`@typescript-eslint/no-unnecessary-condition`). Added a clarifying comment instead.

### F5 — claim_due_emails omits `set search_path = ''`

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrow
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260607120000_email_outbox.sql:42
- **Detail**: Sibling functions use `set search_path = ''`; this one doesn't → trips Supabase's mutable-search-path linter. SECURITY INVOKER is correct (no definer needed). Migration already applied on prod, so the fix is a NEW follow-up migration via `create or replace ... set search_path = ''`.
- **Fix**: Follow-up migration recreating the function with `set search_path = ''` (fully-qualified names already used).
- **Decision**: FIXED — added migration 20260608000000_claim_due_emails_search_path.sql (create or replace with `set search_path = ''`, revoke re-applied).

### F6 — Empty provider_message_id stored on 2xx-without-messageId

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrow
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/email/brevo.ts:40-41
- **Detail**: `data.messageId ?? ""` stores an empty audit id if Brevo returns 2xx without messageId. Send is correctly marked sent; only the audit trail is lost. (Prod smoke showed Brevo returns it.)
- **Fix**: Log a warning when a 2xx response lacks messageId.
- **Decision**: FIXED — added a console.warn when a 2xx Brevo response has no messageId.
