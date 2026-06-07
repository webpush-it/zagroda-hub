-- F-02 impl-review follow-up (F5): pin search_path on claim_due_emails.
-- The original 20260607120000 definition omitted `set search_path`, which
-- trips Supabase's mutable-search-path linter and diverges from the sibling
-- functions (set_zagroda_published, email_verified). SECURITY INVOKER stays
-- correct here — service_role is the only grantee after the revoke — so this
-- only pins the path; all object references are already fully qualified, so
-- search_path = '' is safe (pg_catalog stays implicitly available).
--
-- CREATE OR REPLACE preserves the existing ACL; the revoke is re-applied for
-- explicitness and idempotency.

create or replace function public.claim_due_emails(p_limit int default 10, p_id uuid default null)
returns setof public.email_outbox
language sql
set search_path = ''
as $$
  update public.email_outbox e
  set attempts = e.attempts + 1,
      next_attempt_at = now() + interval '5 minutes'
  from (
    select id from public.email_outbox
    where status = 'pending'
      and next_attempt_at <= now()
      and attempts < 5
      and (p_id is null or id = p_id)
    order by created_at
    limit p_limit
    for update skip locked
  ) due
  where e.id = due.id
  returning e.*;
$$;

revoke execute on function public.claim_due_emails(int, uuid) from public, anon, authenticated;
