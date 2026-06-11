---
change_id: oauth-account-merge-guard
title: Oauth account merge guard
status: implementing
created: 2026-06-11
updated: 2026-06-11
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Accepted assumption (GoTrue auto-linking)**: GoTrue links an OAuth identity into an existing user only when the involved emails are verified — confirmed empirically by the S-06 Phase 2.0 spike against local Supabase and by the Supabase auth docs. This repo does not test GoTrue's handshake-time linking decision itself; `tests/db/oauth-merge-guard.test.ts` simulates the post-handshake states instead.
