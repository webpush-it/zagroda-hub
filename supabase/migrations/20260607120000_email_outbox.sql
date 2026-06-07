-- F-02 phase 1: transactional email outbox.
-- Durable record of every outbound app email with retry bookkeeping.
-- The table is internal infrastructure: it can contain guest/owner addresses
-- and message bodies, so RLS is enabled with NO policies — only the
-- service_role client (which bypasses RLS) may touch it.
--
-- Retry model is lease-based (no 'sending' state, no stuck rows): claiming a
-- row atomically bumps attempts and pushes next_attempt_at ~5 minutes out.
-- Success marks 'sent'; hard failure after attempts >= 5 marks 'failed';
-- otherwise the row stays 'pending' and the lease expiry doubles as backoff.
-- The immediate (waitUntil) path and the cron sweep share this one claim
-- primitive, so double-send is structurally excluded.

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  to_email text not null,
  subject text not null,
  html text not null,
  reply_to text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  provider_message_id text
);

-- The cron sweep polls for due pending rows 288x/day; the partial index keeps
-- the empty case (the common one) a fast no-op.
create index email_outbox_due_idx on public.email_outbox (next_attempt_at) where status = 'pending';

-- Deny-all: RLS enabled, zero policies. service_role bypasses RLS by design.
alter table public.email_outbox enable row level security;

-- Race-safe batch claim. FOR UPDATE SKIP LOCKED makes concurrent claimers
-- (immediate waitUntil attempt vs cron sweep) take disjoint row sets; the
-- UPDATE re-evaluates the predicate after any lock wait, so a row is never
-- handed out twice within one lease window.
create or replace function public.claim_due_emails(p_limit int default 10, p_id uuid default null)
returns setof public.email_outbox
language sql
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

-- Only service_role may claim (Supabase default privileges grant it EXECUTE
-- explicitly; revoking from public/anon/authenticated leaves that intact).
revoke execute on function public.claim_due_emails(int, uuid) from public, anon, authenticated;
