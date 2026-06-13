---
change_id: testing-http-surface-booking
title: HTTP-surface integration on the booking lifecycle
status: impl_reviewed
created: 2026-06-12
updated: 2026-06-13
---

## Notes

- Rollout phase 1 of `context/foundation/test-plan.md` §3 — covers risks #1, #4, #5, #6.
- Goal: prove the API/handler layer enforces what the DB layer already proves — concurrency outcome, ownership, tokens, server-side validation parity.
- Research brief comes from test-plan §2 "Risk Response Guidance", column "Context `/10x-research` must ground".
