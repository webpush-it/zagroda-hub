-- F-01: minimal domain schema for the anti-overbooking rule + teacher-contact privacy.
-- Tables: zagrody (farm with daily participant limit), turnusy (daily time slots),
-- booking_requests (guest booking inquiries with status workflow).
-- Core domain names stay Polish (zagrody, turnusy) — product identity; the rest is English.

-- Booking request status workflow (PRD §Business Logic). Future-slice states
-- (cancelled_by_guest — S-03, withdrawn_by_owner — S-05) are included up front
-- to avoid ALTER TYPE later.
create type public.request_status as enum (
  'pending',
  'accepted',
  'rejected',
  'cancelled_by_guest',
  'withdrawn_by_owner'
);

-- Zagroda: one owner account = one zagroda (MVP, PRD §Access Control).
create table public.zagrody (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null,
  daily_limit integer not null check (daily_limit > 0),
  created_at timestamptz not null default now()
);

-- Turnus: a labelled daily time slot within a zagroda (structured HH:MM range, FR-009).
-- UNIQUE (id, zagroda_id) is the target of the composite FK on booking_requests.
create table public.turnusy (
  id uuid primary key default gen_random_uuid(),
  zagroda_id uuid not null references public.zagrody (id) on delete cascade,
  label text not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (id, zagroda_id)
);

-- Booking request: guest inquiry for a turnus on a specific date.
-- Composite FK (turnus_id, zagroda_id) enforces the invariant that the turnus
-- belongs to the same zagroda the request points at.
-- trip_date is DATE — no timezone logic anywhere in the rule.
create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  zagroda_id uuid not null,
  turnus_id uuid not null,
  trip_date date not null,
  participants_count integer not null check (participants_count > 0),
  status public.request_status not null default 'pending',
  guest_name text not null,
  guest_email text not null,
  guest_phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (turnus_id, zagroda_id) references public.turnusy (id, zagroda_id) on delete cascade
);

-- Read path for the daily SUM in accept_booking_request and the future
-- availability filter (S-02): only accepted rows matter.
create index booking_requests_accepted_per_day_idx
  on public.booking_requests (zagroda_id, trip_date)
  where status = 'accepted';

-- RLS-first posture: state transitions happen ONLY through SECURITY DEFINER
-- functions (phase 2); no UPDATE/DELETE policies on booking_requests by design.
alter table public.zagrody enable row level security;
alter table public.turnusy enable row level security;
alter table public.booking_requests enable row level security;

-- zagrody: public catalog (FR-001) — anyone can read; only the owner mutates.
create policy "zagrody are publicly readable by anon"
  on public.zagrody for select to anon
  using (true);

create policy "zagrody are publicly readable by authenticated"
  on public.zagrody for select to authenticated
  using (true);

create policy "owners can insert their own zagroda"
  on public.zagrody for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "owners can update their own zagroda"
  on public.zagrody for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "owners can delete their own zagroda"
  on public.zagrody for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- turnusy: publicly readable; writes only by the owner of the parent zagroda.
create policy "turnusy are publicly readable by anon"
  on public.turnusy for select to anon
  using (true);

create policy "turnusy are publicly readable by authenticated"
  on public.turnusy for select to authenticated
  using (true);

create policy "owners can insert turnusy of their zagroda"
  on public.turnusy for insert to authenticated
  with check (
    exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id and z.owner_id = (select auth.uid())
    )
  );

create policy "owners can update turnusy of their zagroda"
  on public.turnusy for update to authenticated
  using (
    exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id and z.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id and z.owner_id = (select auth.uid())
    )
  );

create policy "owners can delete turnusy of their zagroda"
  on public.turnusy for delete to authenticated
  using (
    exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id and z.owner_id = (select auth.uid())
    )
  );

-- booking_requests: guests (anon or signed-in) may only create pending requests;
-- teacher contact data is readable exclusively by the owner of the zagroda
-- (privacy NFR). No UPDATE/DELETE policies — transitions via SECURITY DEFINER only.
create policy "anyone can submit a pending booking request (anon)"
  on public.booking_requests for insert to anon
  with check (status = 'pending');

create policy "anyone can submit a pending booking request (authenticated)"
  on public.booking_requests for insert to authenticated
  with check (status = 'pending');

create policy "owners can read booking requests of their zagroda"
  on public.booking_requests for select to authenticated
  using (
    exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id and z.owner_id = (select auth.uid())
    )
  );
