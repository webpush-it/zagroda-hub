-- S-11: group type on booking requests (FR-027) + neutral language.
-- A guest picks a group type (school / kindergarten / individual / other) when
-- submitting; the owner may optionally record one for a phone entry. The change
-- is strictly additive: a nullable enum column (legacy rows, phone entries, and
-- untyped rows stay NULL), and one new trailing parameter on
-- create_manual_booking. No RLS change — the guest INSERT policies pin
-- status/source/note only, so a guest-supplied group_type passes through and the
-- enum type is the sole value constraint. No backfill.

-- ---------------------------------------------------------------------------
-- 1. Group type enum. All values up front (mirroring booking_source /
--    request_status) to avoid ALTER TYPE later. ASCII tokens; human labels
--    live in the presentation layer.
create type public.group_type as enum ('szkola', 'przedszkole', 'grupa_indywidualna', 'inna');

alter table public.booking_requests
  add column group_type public.group_type;

-- ---------------------------------------------------------------------------
-- 2. create_manual_booking gains a trailing p_group_type (default null): the
--    owner may tag a phone entry, but existing callers keep working. Adding a
--    parameter changes the function's signature identity, so the old function
--    is DROPPED and recreated (a bare CREATE OR REPLACE would leave a second
--    overload and a dangling grant). Everything else is IDENTICAL to
--    20260719100000: lock order (zagroda FIRST), ownership check, past-date
--    hard error, soft day-block / does-not-fit outcomes, status='accepted',
--    source='phone'. Only the INSERT column/value lists gain group_type.
drop function public.create_manual_booking(uuid, uuid, date, integer, text);

create function public.create_manual_booking(
  p_zagroda_id uuid,
  p_turnus_id uuid,
  p_trip_date date,
  p_participants integer,
  p_note text default null,
  p_group_type public.group_type default null
)
returns table (
  created boolean,
  request_id uuid,
  day_blocked boolean,
  occupied integer,
  daily_limit integer,
  requested integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_occupied integer;
begin
  -- 1. Lock the zagroda row (ownership + serialization with acceptances).
  select z.daily_limit
    into v_limit
    from public.zagrody z
    where z.id = p_zagroda_id
      and z.owner_id = (select auth.uid())
    for update;

  if not found then
    raise exception 'caller is not the owner of zagroda %', p_zagroda_id
      using errcode = '42501'; -- insufficient_privilege
  end if;

  -- 2. Past dates are invalid for new demand.
  if p_trip_date < current_date then
    raise exception 'trip date % is in the past', p_trip_date
      using errcode = '55000'; -- object_not_in_prerequisite_state
  end if;

  -- 3. Blocked day check — under the zagroda lock (cannot race block_day).
  day_blocked := exists (
    select 1
      from public.day_blocks db
      where db.zagroda_id = p_zagroda_id
        and db.blocked_date = p_trip_date
  );

  -- 4. Same per-day occupancy sum as accept_booking_request (all turnusy).
  select coalesce(sum(br.participants_count), 0)
    into v_occupied
    from public.booking_requests br
    where br.zagroda_id = p_zagroda_id
      and br.trip_date = p_trip_date
      and br.status = 'accepted';

  -- 5. Conditional insert. Participant/note bounds ride on the table CHECKs
  --    (participants 1..1000, note <= 500) — violations are hard errors.
  if not day_blocked and v_occupied + p_participants <= v_limit then
    insert into public.booking_requests
        (zagroda_id, turnus_id, trip_date, participants_count, status, source, note, group_type)
      values
        (p_zagroda_id, p_turnus_id, p_trip_date, p_participants, 'accepted', 'phone', p_note, p_group_type)
      returning id into request_id;
    created := true;
  else
    created := false;
  end if;

  occupied := v_occupied;
  daily_limit := v_limit;
  requested := p_participants;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Re-state the EXECUTE grants for the new signature (owner-only; PUBLIC
--    gets EXECUTE by default on new functions, and the drop above cleared the
--    old grant with the old argument-type list).
revoke execute on function public.create_manual_booking(uuid, uuid, date, integer, text, public.group_type) from public, anon;
grant execute on function public.create_manual_booking(uuid, uuid, date, integer, text, public.group_type) to authenticated;
