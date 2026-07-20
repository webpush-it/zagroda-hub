-- S-10: locality-level coordinates for distance sorting (FR-020, FR-030, US-04).
-- Additive, backwards-compatible migration (lessons.md deploy rule): new nullable
-- coordinate columns on zagrody, a locality dictionary + voivodeship centroids, a
-- resolver that maps (voivodeship, free-text city) -> coords with a centroid
-- fallback, a trigger that keeps zagrody coords in sync on insert/update, and a
-- drop+recreate of catalog_zagrody so it returns the coordinates. The guest's own
-- location never touches the server — distance is computed client-side (Phase 3).

-- ---------------------------------------------------------------------------
-- 1. unaccent lives in the `extensions` schema on Supabase. Functions below run
--    with `set search_path = ''`, so EVERY call must be schema-qualified
--    (`extensions.unaccent(...)`) — unqualified it errors "function unaccent(text)
--    does not exist" (plan-review F1).
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. Coordinate columns on zagrody. Nullable (draft/unresolved rows carry no
--    coords); location_precise is NOT NULL default false so the trigger never
--    has to null it (see zero-row-safety below, plan-review F5).
alter table public.zagrody
  add column latitude double precision,
  add column longitude double precision,
  add column location_precise boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. Single source of truth for locality-name normalization (plan-review F2).
--    Both the dictionary asset load (Phase 2 seed) and the resolver lookup below
--    compute name_normalized through THIS function, so they can never diverge.
--    unaccent does not fold Polish "ł"/"Ł" — replace it explicitly before
--    unaccent, then lower-case. `stable` (unaccent is dictionary-backed, not
--    immutable), so it cannot back a GENERATED column — callers apply it inline.
create function public.locality_normalize(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(
    extensions.unaccent(
      replace(replace(trim(p_name), 'ł', 'l'), 'Ł', 'L')
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Locality dictionary: (voivodeship enum + normalized name) -> coords. The
--    enum discriminates the common case of the same town name across regions.
--    name is the RAW source value (Phase 2 seed inserts raw; name_normalized is
--    computed by DB via locality_normalize — F2). RLS on, NO anon policies: this
--    is a reference table read only through the SECURITY DEFINER resolver.
create table public.localities (
  voivodeship public.voivodeship not null,
  name text not null,
  name_normalized text not null,
  latitude double precision not null,
  longitude double precision not null,
  primary key (voivodeship, name_normalized)
);

alter table public.localities enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Voivodeship centroids: small, static fallback set (16 rows, seeded inline).
--    Used when a city has no precise dictionary hit — sorts, but no "~X km" badge.
create table public.voivodeship_centroids (
  voivodeship public.voivodeship primary key,
  latitude double precision not null,
  longitude double precision not null
);

alter table public.voivodeship_centroids enable row level security;

insert into public.voivodeship_centroids (voivodeship, latitude, longitude) values
  ('dolnośląskie',        51.10, 16.60),
  ('kujawsko-pomorskie',  53.10, 18.50),
  ('lubelskie',           51.25, 22.90),
  ('lubuskie',            52.20, 15.20),
  ('łódzkie',             51.60, 19.40),
  ('małopolskie',         49.90, 20.20),
  ('mazowieckie',         52.30, 21.00),
  ('opolskie',            50.70, 17.90),
  ('podkarpackie',        49.90, 22.10),
  ('podlaskie',           53.30, 22.90),
  ('pomorskie',           54.20, 18.00),
  ('śląskie',             50.30, 19.00),
  ('świętokrzyskie',      50.80, 20.70),
  ('warmińsko-mazurskie', 53.90, 20.90),
  ('wielkopolskie',       52.40, 17.30),
  ('zachodniopomorskie',  53.60, 15.60);

-- ---------------------------------------------------------------------------
-- 6. Resolver: (voivodeship, free-text city) -> (lat, lng, is_precise).
--    - voivodeship OR city empty  -> NO row (coords stay null on the caller).
--    - both present, dictionary hit -> precise coords, is_precise = true.
--    - both present, no hit        -> voivodeship centroid, is_precise = false.
--    Returns at most one row. SECURITY DEFINER to read the RLS-locked reference
--    tables; `set search_path = ''` -> extensions.unaccent is schema-qualified
--    inside locality_normalize (F1).
create function public.locality_coords(p_voivodeship public.voivodeship, p_city text)
returns table (latitude double precision, longitude double precision, is_precise boolean)
language sql
stable
security definer
set search_path = ''
as $$
  -- precise hit
  select l.latitude, l.longitude, true
  from public.localities l
  where p_voivodeship is not null
    and p_city is not null
    and trim(p_city) <> ''
    and l.voivodeship = p_voivodeship
    and l.name_normalized = public.locality_normalize(p_city)
  union all
  -- centroid fallback: both inputs present, but no precise hit
  select c.latitude, c.longitude, false
  from public.voivodeship_centroids c
  where p_voivodeship is not null
    and p_city is not null
    and trim(p_city) <> ''
    and c.voivodeship = p_voivodeship
    and not exists (
      select 1
      from public.localities l2
      where l2.voivodeship = p_voivodeship
        and l2.name_normalized = public.locality_normalize(p_city)
    )
$$;

-- ---------------------------------------------------------------------------
-- 7. Trigger: keep zagrody coords in sync from city/voivodeship on insert and on
--    changes to those columns. Zero-row-safety (F5): when the resolver returns
--    no row (empty city/voivodeship), lat/lng fall to NULL and location_precise
--    coalesces to false (the column is NOT NULL — a null would abort the insert).
--    Does NOT touch is_published (no interference with zagrody_guard_is_published).
--    Fires on every seedZagroda across the whole DB suite — must be fast and
--    never raise.
create function public.zagrody_set_coords()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_precise boolean;
begin
  select lc.latitude, lc.longitude, lc.is_precise
    into v_lat, v_lng, v_precise
  from public.locality_coords(new.voivodeship, new.city) lc;

  new.latitude := v_lat;
  new.longitude := v_lng;
  new.location_precise := coalesce(v_precise, false);
  return new;
end;
$$;

create trigger zagrody_set_coords
  before insert or update of city, voivodeship on public.zagrody
  for each row
  execute function public.zagrody_set_coords();

-- ---------------------------------------------------------------------------
-- 8. catalog_zagrody: return type changes (added coordinate columns), so Postgres
--    requires DROP + CREATE — CREATE OR REPLACE cannot alter a return type. The
--    argument signature is UNCHANGED so the old worker in the deploy window keeps
--    working (it just ignores the new columns). WHERE/ORDER BY/LIMIT are
--    untouched: distance is neither a server-side filter nor sort. Re-grant after
--    recreate.
drop function if exists public.catalog_zagrody(public.voivodeship, text, date, integer);

create function public.catalog_zagrody(
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
  is_available boolean, -- null when p_trip_date is null
  latitude double precision,
  longitude double precision,
  location_precise boolean
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
    end as is_available,
    z.latitude,
    z.longitude,
    z.location_precise
  from public.zagrody z
  where z.is_published
    and (p_voivodeship is null or z.voivodeship = p_voivodeship)
    -- city is owner-entered free text — compare case-insensitively on trimmed values
    and (p_city is null or lower(trim(z.city)) = lower(trim(p_city)))
  order by is_available desc nulls first, z.created_at desc
  limit 100
$$;

grant execute on function public.catalog_zagrody(public.voivodeship, text, date, integer) to anon, authenticated;
