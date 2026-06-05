-- F-01 phase 2: atomic acceptance primitive.
-- accept_booking_request is the ONLY place the anti-overbooking rule executes.
-- Atomicity lives 100% in Postgres (workerd is per-request — no app-side locks):
-- a row lock on the zagroda serializes all acceptances of that zagroda.
--
-- Lock order is a contract: zagroda FIRST, request SECOND. The fixed order
-- eliminates deadlocks; the request lock + status = 'pending' re-check prevents
-- double-acceptance of the same request.
--
-- Grandfathering: the function does NOT assume "sum <= limit" holds on entry
-- (lowering daily_limit below the current sum is legal). It only checks whether
-- the NEW acceptance would fit within the limit.

create or replace function public.accept_booking_request(request_id uuid)
returns table (
  accepted boolean,
  occupied integer,
  daily_limit integer,
  requested integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zagroda_id uuid;
  v_trip_date date;
  v_participants integer;
  v_limit integer;
  v_occupied integer;
begin
  -- 0. Unlocked read to learn which zagroda to lock first (lock-order contract).
  --    zagroda_id is immutable on booking_requests (no UPDATE policies; no
  --    SECURITY DEFINER mutator touches it), so reading it before the lock is safe.
  select br.zagroda_id
    into v_zagroda_id
    from public.booking_requests br
    where br.id = request_id;

  if not found then
    raise exception 'booking request % does not exist', request_id
      using errcode = 'P0002'; -- no_data_found
  end if;

  -- 1. Lock the zagroda row (serializes all acceptances of this zagroda).
  --    No row here means the caller is not the owner (the zagroda itself must
  --    exist — FK from booking_requests guarantees it).
  select z.daily_limit
    into v_limit
    from public.zagrody z
    where z.id = v_zagroda_id
      and z.owner_id = (select auth.uid())
    for update;

  if not found then
    raise exception 'caller is not the owner of the zagroda for booking request %', request_id
      using errcode = '42501'; -- insufficient_privilege
  end if;

  -- 2. Lock the request row + re-validate state under the lock.
  select br.trip_date, br.participants_count
    into v_trip_date, v_participants
    from public.booking_requests br
    where br.id = request_id
      and br.status = 'pending'
    for update;

  if not found then
    raise exception 'booking request % is not pending', request_id
      using errcode = '55000'; -- object_not_in_prerequisite_state
  end if;

  -- 3. Sum accepted participants for the day — ALL turnusy combined
  --    (the limit is per day, not per turnus). This is the occupancy BEFORE
  --    this acceptance, returned to the caller for the FR-014 message.
  select coalesce(sum(br.participants_count), 0)
    into v_occupied
    from public.booking_requests br
    where br.zagroda_id = v_zagroda_id
      and br.trip_date = v_trip_date
      and br.status = 'accepted';

  -- 4. Conditional transition pending -> accepted. When the request does not
  --    fit, this is a domain outcome (not an error): status stays 'pending'.
  if v_occupied + v_participants <= v_limit then
    update public.booking_requests br
      set status = 'accepted',
          updated_at = now()
      where br.id = request_id;
    accepted := true;
  else
    accepted := false;
  end if;

  occupied := v_occupied;
  daily_limit := v_limit;
  requested := v_participants;
  return next;
end;
$$;

-- EXECUTE for authenticated only: anon must not even see a denied-by-logic path,
-- and PUBLIC gets EXECUTE by default on new functions — revoke it explicitly.
revoke execute on function public.accept_booking_request(uuid) from public, anon;
grant execute on function public.accept_booking_request(uuid) to authenticated;
