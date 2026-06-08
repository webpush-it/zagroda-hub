-- S-03 phase 1: guest self-cancel primitive (FR-015).
-- A guest has no account; the only proof they own a request is an unguessable
-- token mailed to them. cancel_token is that capability — a 122-bit UUID,
-- unique per request, that the confirmation e-mail carries in the cancel link.
--
-- Cancellation is the ONLY guest-driven state transition, and it goes through a
-- SECURITY DEFINER function (RLS-first posture: booking_requests has no UPDATE
-- policy by design). The function locks ONLY the request row and re-checks
-- status under the lock — a strict subset of accept_booking_request's lock set
-- (zagroda THEN request), so no new deadlock cycle is introduced, and a
-- concurrent owner-accept vs guest-cancel race resolves to exactly one winner.
--
-- Immutability contract (see context/foundation/lessons.md): this mutator must
-- never touch zagroda_id / turnus_id / trip_date. It only flips status.
-- updated_at stays honest via the booking_requests_set_updated_at trigger.

alter table public.booking_requests
  add column cancel_token uuid not null default gen_random_uuid();

-- One token -> exactly one request: the lookup key for guest cancel.
create unique index booking_requests_cancel_token_idx
  on public.booking_requests (cancel_token);

create or replace function public.cancel_booking_request(p_token uuid)
returns table (
  cancelled boolean,
  status public.request_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status public.request_status;
begin
  -- Lock the request row by its token and re-read status under the lock.
  -- Only this row is locked (cancel never reads day occupancy).
  select br.id, br.status
    into v_id, v_status
    from public.booking_requests br
    where br.cancel_token = p_token
    for update;

  -- Unknown / already-consumed token: not an error — a domain outcome the
  -- caller maps to a "nieprawidłowy link" message. status is null.
  if not found then
    cancelled := false;
    status := null;
    return next;
    return;
  end if;

  -- Only a still-pending request can be cancelled by the guest (FR-015).
  -- Anything else (accepted / rejected / already cancelled / withdrawn) is a
  -- no-op; the current status is returned so the caller can explain why.
  if v_status = 'pending' then
    update public.booking_requests br
      set status = 'cancelled_by_guest'
      where br.id = v_id;
    cancelled := true;
    status := 'cancelled_by_guest';
  else
    cancelled := false;
    status := v_status;
  end if;

  return next;
end;
$$;

-- The guest is anon. PUBLIC gets EXECUTE by default on new functions — revoke
-- it, then grant to the roles that actually call it (anon + authenticated).
revoke execute on function public.cancel_booking_request(uuid) from public;
grant execute on function public.cancel_booking_request(uuid) to anon, authenticated;
