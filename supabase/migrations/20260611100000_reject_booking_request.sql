-- S-04 phase 1: owner reject primitive (FR-014, reject side).
-- The pending -> rejected transition is owner-driven and goes through a
-- SECURITY DEFINER function (RLS-first posture: booking_requests has no UPDATE
-- policy by design), mirroring cancel_booking_request.
--
-- Lock posture: ONLY the request row is locked (reject never reads day
-- occupancy, so it never needs the zagroda lock). A single lock cannot form a
-- cycle with accept_booking_request's zagroda -> request order, so no deadlock
-- is possible; the status re-check under the lock resolves a concurrent
-- owner-accept or guest-cancel race to exactly one winner.
--
-- Ownership is verified BEFORE any state-dependent return, so a foreign owner
-- cannot probe request states by id — they get 42501 regardless of status.
--
-- Immutability contract (see context/foundation/lessons.md): this mutator must
-- never touch zagroda_id / turnus_id / trip_date. It only flips status.
-- updated_at stays honest via the booking_requests_set_updated_at trigger.

create or replace function public.reject_booking_request(request_id uuid)
returns table (
  rejected boolean,
  status public.request_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.request_status;
  v_is_owner boolean;
begin
  -- Lock the request row and read status + ownership under the lock.
  -- zagroda_id is immutable on booking_requests (lessons.md), so the
  -- ownership join is stable for the lifetime of the lock.
  select br.status,
         exists (
           select 1
             from public.zagrody z
             where z.id = br.zagroda_id
               and z.owner_id = (select auth.uid())
         )
    into v_status, v_is_owner
    from public.booking_requests br
    where br.id = request_id
    for update of br;

  if not found then
    raise exception 'booking request % does not exist', request_id
      using errcode = 'P0002'; -- no_data_found
  end if;

  -- Ownership check FIRST: a non-owner learns nothing about the request's
  -- state, only that they may not touch it.
  if not v_is_owner then
    raise exception 'caller is not the owner of the zagroda for booking request %', request_id
      using errcode = '42501'; -- insufficient_privilege
  end if;

  -- Only a still-pending request can be rejected. Anything else (accepted /
  -- already rejected / cancelled / withdrawn) is a soft outcome: the current
  -- status is returned so the caller can explain why ("odśwież stronę").
  if v_status = 'pending' then
    update public.booking_requests br
      set status = 'rejected'
      where br.id = request_id;
    rejected := true;
    status := 'rejected';
  else
    rejected := false;
    status := v_status;
  end if;

  return next;
end;
$$;

-- Owner-only action: anon must not even reach the denied-by-logic path, and
-- PUBLIC gets EXECUTE by default on new functions — revoke it explicitly.
revoke execute on function public.reject_booking_request(uuid) from public, anon;
grant execute on function public.reject_booking_request(uuid) to authenticated;
