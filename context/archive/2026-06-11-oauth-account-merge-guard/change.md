---
change_id: oauth-account-merge-guard
title: Oauth account merge guard
status: archived
created: 2026-06-11
updated: 2026-06-11
archived_at: 2026-06-11T12:06:23Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Accepted assumption (GoTrue auto-linking)**: GoTrue links an OAuth identity into an existing user only when the involved emails are verified — confirmed empirically by the S-06 Phase 2.0 spike against local Supabase and by the Supabase auth docs. This repo does not test GoTrue's handshake-time linking decision itself; `tests/db/oauth-merge-guard.test.ts` simulates the post-handshake states instead.
- **Live unverified-Facebook smoke (plan 3.4, 2026-06-11)**: NOT executed — still blocked on Meta App Review. The deployed chain was probed headlessly up to Meta's OAuth dialog (`/api/auth/oauth/facebook` 302 → Supabase `/auth/v1/authorize?provider=facebook` 302 → `facebook.com/dialog/oauth` with the expected client_id and Supabase redirect_uri), but a real unverified-email login cannot be attempted until the app clears review. Expected outcome when it does: the collision block message when a password account exists for that email.
