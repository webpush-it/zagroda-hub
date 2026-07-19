-- S-08 phase 1: phone bookings (manual entries) + day blocks.
-- Manual entries are booking_requests rows born accepted with source = 'phone'
-- and no guest contact — the occupancy SUM stays a single-table query on the
-- existing partial index, and the withdraw/list machinery is reused unchanged.
-- Day blocks are a separate table ("day off" != "day full"): a blocked day
-- stops NEW demand (guest inserts, acceptances, manual entries) but never
-- touches existing accepted rows (grandfathering philosophy).
--
-- Lock posture (contract from accept_booking_request / withdraw_booking_request):
-- demand-INCREASING ops (create_manual_booking, block_day) take the zagroda row
-- FOR UPDATE first — the same serialization point as acceptances. Demand-
-- DECREASING ops (unblock_day; entry removal via withdraw_booking_request)
-- take no zagroda lock: availability only grows, so they can never overbook.

-- ---------------------------------------------------------------------------
-- 1. Booking source: which channel produced the row. All values up front
--    (mirroring request_status) to avoid ALTER TYPE later.
create type public.booking_source as enum ('app', 'phone');

alter table public.booking_requests
  add column source public.booking_source not null default 'app',
  add column note text check (char_length(note) <= 500);

-- ---------------------------------------------------------------------------
-- 2. Phone entries carry no guest contact. App rows must keep the full
--    contact triple — enforced by CHECK now that NOT NULL is per-source.
alter table public.booking_requests
  alter column guest_name drop not null,
  alter column guest_email drop not null,
  alter column guest_phone drop not null,
  add constraint booking_requests_guest_contact_presence
    check (
      source = 'phone'
      or (guest_name is not null and guest_email is not null and guest_phone is not null)
    );

-- ---------------------------------------------------------------------------
-- 3. Guest INSERT policies additionally pin source = 'app': a direct insert
--    (anon or authenticated) can never forge a phone entry. Owner phone
--    entries bypass RLS via the SECURITY DEFINER RPC below. BOTH policies are
--    recreated — recreating only one would leave the other role able to forge.
drop policy "anyone can submit a pending booking request (anon)" on public.booking_requests;
drop policy "anyone can submit a pending booking request (authenticated)" on public.booking_requests;

create policy "anyone can submit a pending booking request (anon)"
  on public.booking_requests for insert to anon
  with check (status = 'pending' and source = 'app');

create policy "anyone can submit a pending booking request (authenticated)"
  on public.booking_requests for insert to authenticated
  with check (status = 'pending' and source = 'app');

-- ---------------------------------------------------------------------------
-- 4. Day blocks. One row = one blocked day for one zagroda. Writes go
--    exclusively through block_day()/unblock_day() (no INSERT/DELETE
--    policies); the owner may read their own blocks for the panel strip.
create table public.day_blocks (
  id uuid primary key default gen_random_uuid(),
  zagroda_id uuid not null references public.zagrody (id) on delete cascade,
  blocked_date date not null,
  created_at timestamptz not null default now(),
  unique (zagroda_id, blocked_date)
);

alter table public.day_blocks enable row level security;

create policy "owners can read day blocks of their zagroda"
  on public.day_blocks for select to authenticated
  using (
    exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id and z.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Guard trigger: a pending INSERT (the guest path) on a blocked day is
--    rejected. SECURITY DEFINER is required — anon has no SELECT on
--    day_blocks, so an invoker-rights check would silently see zero rows
--    (precedent: zagrody_guard_is_published). RPC write paths are exempt by
--    the status condition (manual entries are born 'accepted') and do their
--    own soft checks. NOTE: service_role seeding bypasses RLS but NOT this
--    trigger — a pending fixture on a blocked day must be seeded BEFORE the
--    block is created.
create function public.enforce_day_not_blocked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' and exists (
    select 1
      from public.day_blocks db
      where db.zagroda_id = new.zagroda_id
        and db.blocked_date = new.trip_date
  ) then
    raise exception 'day_blocked'
      using errcode = '55000'; -- object_not_in_prerequisite_state
  end if;
  return new;
end;
$$;

create trigger booking_requests_guard_day_blocked
  before insert on public.booking_requests
  for each row
  execute function public.enforce_day_not_blocked();

-- ---------------------------------------------------------------------------
-- 6. accept_booking_request learns about day blocks. The return table gains
--    day_blocked — CREATE OR REPLACE cannot change OUT parameters, so the
--    function is dropped and recreated (grants below are re-stated).
--
--    Everything else is IDENTICAL to 20260605094725: atomicity lives 100% in
--    Postgres; lock order is a contract (zagroda FIRST, request SECOND);
--    grandfathering — the function does NOT assume "sum <= limit" holds on
--    entry. New: after both locks, a blocked day is a soft domain outcome
--    (accepted = false, day_blocked = true) — the request stays pending and
--    can be accepted after the owner unblocks the day.
drop function public.accept_booking_request(uuid);

create function public.accept_booking_request(request_id uuid)
returns table (
  accepted boolean,
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

  -- 2.5. Blocked day check — read under the zagroda lock, so it cannot race
  --      block_day (which takes the same lock).
  day_blocked := exists (
    select 1
      from public.day_blocks db
      where db.zagroda_id = v_zagroda_id
        and db.blocked_date = v_trip_date
  );

  -- 3. Sum accepted participants for the day — ALL turnusy combined
  --    (the limit is per day, not per turnus). This is the occupancy BEFORE
  --    this acceptance, returned to the caller for the FR-014 message.
  select coalesce(sum(br.participants_count), 0)
    into v_occupied
    from public.booking_requests br
    where br.zagroda_id = v_zagroda_id
      and br.trip_date = v_trip_date
      and br.status = 'accepted';

  -- 4. Conditional transition pending -> accepted. A blocked day and a
  --    does-not-fit request are both domain outcomes (not errors): status
  --    stays 'pending'.
  if not day_blocked and v_occupied + v_participants <= v_limit then
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

-- ---------------------------------------------------------------------------
-- 7. Manual phone entry: a row born accepted with source = 'phone' and no
--    guest contact, created under the SAME zagroda lock as acceptances — the
--    anti-overbooking rule covers both channels ("exactly one success").
--    Blocked day and does-not-fit are soft outcomes; a foreign owner gets
--    42501 before learning anything; a past date is a hard 55000 (defense in
--    depth — zod validates upstream). An invalid turnus for this zagroda
--    fails on the composite FK (hard error; the UI select prevents it).
create function public.create_manual_booking(
  p_zagroda_id uuid,
  p_turnus_id uuid,
  p_trip_date date,
  p_participants integer,
  p_note text default null
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
        (zagroda_id, turnus_id, trip_date, participants_count, status, source, note)
      values
        (p_zagroda_id, p_turnus_id, p_trip_date, p_participants, 'accepted', 'phone', p_note)
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
-- 8. Block a day. Demand-increasing (new demand gets refused from commit on),
--    so it takes the zagroda lock — an acceptance and a block of the same day
--    serialize instead of racing. Idempotent: re-blocking reports
--    already_blocked instead of erroring.
create function public.block_day(p_zagroda_id uuid, p_blocked_date date)
returns table (blocked boolean, already_blocked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  perform 1
    from public.zagrody z
    where z.id = p_zagroda_id
      and z.owner_id = (select auth.uid())
    for update;

  if not found then
    raise exception 'caller is not the owner of zagroda %', p_zagroda_id
      using errcode = '42501'; -- insufficient_privilege
  end if;

  if p_blocked_date < current_date then
    raise exception 'blocked date % is in the past', p_blocked_date
      using errcode = '55000'; -- object_not_in_prerequisite_state
  end if;

  insert into public.day_blocks (zagroda_id, blocked_date)
    values (p_zagroda_id, p_blocked_date)
    on conflict (zagroda_id, blocked_date) do nothing;
  get diagnostics v_inserted = row_count;

  blocked := true;
  already_blocked := (v_inserted = 0);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Unblock a day. Demand-decreasing (availability only grows), so NO
--    zagroda lock — same posture as withdraw_booking_request. A missing block
--    is a soft outcome (unblocked = false), not an error.
create function public.unblock_day(p_zagroda_id uuid, p_blocked_date date)
returns table (unblocked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if not exists (
    select 1
      from public.zagrody z
      where z.id = p_zagroda_id
        and z.owner_id = (select auth.uid())
  ) then
    raise exception 'caller is not the owner of zagroda %', p_zagroda_id
      using errcode = '42501'; -- insufficient_privilege
  end if;

  delete from public.day_blocks db
    where db.zagroda_id = p_zagroda_id
      and db.blocked_date = p_blocked_date;
  get diagnostics v_deleted = row_count;

  unblocked := (v_deleted > 0);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants: owner-only actions — anon must not even reach the
--     denied-by-logic path, and PUBLIC gets EXECUTE by default on new
--     functions. accept_booking_request was dropped above, so its grants are
--     re-stated here.
revoke execute on function public.accept_booking_request(uuid) from public, anon;
grant execute on function public.accept_booking_request(uuid) to authenticated;

revoke execute on function public.create_manual_booking(uuid, uuid, date, integer, text) from public, anon;
grant execute on function public.create_manual_booking(uuid, uuid, date, integer, text) to authenticated;

revoke execute on function public.block_day(uuid, date) from public, anon;
grant execute on function public.block_day(uuid, date) to authenticated;

revoke execute on function public.unblock_day(uuid, date) from public, anon;
grant execute on function public.unblock_day(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Second availability surface: catalog_zagrody must mirror the rule or
--     the guarantee splits across channels. Return type is unchanged, so
--     CREATE OR REPLACE is legal (existing anon/authenticated grants persist).
--     The day-block EXISTS folds into the else-arm only — the
--     "p_trip_date is null then null" arm stays first because
--     "order by is_available desc nulls first" depends on the null tier.
create or replace function public.catalog_zagrody(
  p_voivodeship public.voivodeship default null,
  p_city text default null,
  p_trip_date date default null,
  p_participants integer default 1
) returns table (
  id uuid,
  name text,
  description text,
  voivodeship public.voivodeship,
  city text,
  photo_path text,
  daily_limit integer,
  created_at timestamptz,
  is_available boolean -- null when p_trip_date is null
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    z.id,
    z.name,
    z.description,
    z.voivodeship,
    z.city,
    z.photo_path,
    z.daily_limit,
    z.created_at,
    case
      when p_trip_date is null then null
      else (
        not exists (
          select 1
          from public.day_blocks db
          where db.zagroda_id = z.id
            and db.blocked_date = p_trip_date
        )
        and (
          coalesce((
            select sum(br.participants_count)
            from public.booking_requests br
            where br.zagroda_id = z.id
              and br.trip_date = p_trip_date
              and br.status = 'accepted'
          ), 0)
          -- null or < 1 participants clamps to 1 (date-alone filter, FR-002)
          + greatest(coalesce(p_participants, 1), 1)
        ) <= z.daily_limit
      )
    end as is_available
  from public.zagrody z
  where z.is_published
    and (p_voivodeship is null or z.voivodeship = p_voivodeship)
    -- city is owner-entered free text — compare case-insensitively on trimmed values
    and (p_city is null or lower(trim(z.city)) = lower(trim(p_city)))
  order by is_available desc nulls first, z.created_at desc
  limit 100
$$;
