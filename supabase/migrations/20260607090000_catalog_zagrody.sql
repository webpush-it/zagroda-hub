-- S-02: anon-callable catalog query (FR-001/002/003).
-- catalog_zagrody is the ONLY new DB surface of the slice: publish gate,
-- AND location filters, per-day availability boolean, two-tier sort, LIMIT 100.
--
-- SECURITY DEFINER bypasses RLS, so the function self-enforces the publish
-- gate (is_published = true) and exposes NOTHING from booking_requests beyond
-- the derived is_available boolean — no guest data fields, no occupancy counts.
-- The boolean is inferable into a count by repeated queries varying
-- p_participants; accepted by design (inherent to FR-002, no guest data).
--
-- Occupancy math mirrors accept_booking_request exactly:
-- coalesce(sum(participants_count), 0) over status = 'accepted' rows for the
-- (zagroda_id, trip_date) pair, all turnusy combined. The read rides the
-- partial index booking_requests_accepted_per_day_idx.

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
    end as is_available
  from public.zagrody z
  where z.is_published
    and (p_voivodeship is null or z.voivodeship = p_voivodeship)
    -- city is owner-entered free text — compare case-insensitively on trimmed values
    and (p_city is null or lower(trim(z.city)) = lower(trim(p_city)))
  order by is_available desc nulls first, z.created_at desc
  limit 100
$$;

-- PUBLIC gets EXECUTE by default on new functions — revoke, then grant the
-- catalog read to both guest roles (this surface is deliberately public).
revoke execute on function public.catalog_zagrody(public.voivodeship, text, date, integer) from public;
grant execute on function public.catalog_zagrody(public.voivodeship, text, date, integer) to anon, authenticated;
