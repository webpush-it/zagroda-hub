-- zagroda-map-location Phase 1: manual/auto coordinate precedence.
-- Additive, backwards-compatible migration (lessons.md deploy rule): a new
-- location_source discriminator (default 'auto' -> the old worker, which does
-- not send the column, keeps behaving exactly as today), plus a rebuild of
-- zagrody_set_coords so a manual pin is honored instead of being clobbered by
-- the locality-name resolver. Read-side (catalog_zagrody) is untouched: a
-- manual precise pin flows through the existing latitude/longitude/
-- location_precise columns with no RPC or client change.

-- ---------------------------------------------------------------------------
-- 1. Discriminator column. Default 'auto' so pre-existing rows and the old
--    worker (which never sets it) land on the S-10 name-derivation path.
--    A 'manual' row must carry coords (the pin the owner dropped) — enforced
--    by the second check so a manual source can never mean "no coords".
alter table public.zagrody
  add column location_source text not null default 'auto',
  add constraint zagrody_location_source_check
    check (location_source in ('auto', 'manual')),
  add constraint zagrody_location_source_manual_has_coords_check
    check (location_source = 'auto' or (latitude is not null and longitude is not null));

-- ---------------------------------------------------------------------------
-- 2. Rebuild the trigger function with a manual/auto branch. `set search_path
--    = ''` and schema-qualified calls are kept (no regression vs 20260720120000).
--    - manual: leave new.latitude/longitude as sent, force location_precise
--      = true (a hand-dropped pin is precise), do NOT call the resolver.
--    - auto: derive from locality_coords(voivodeship, city) exactly as before;
--      zero-row-safety unchanged (empty city -> null coords, precise coalesces
--      to false — the column is NOT NULL so a null would abort the insert).
create or replace function public.zagrody_set_coords()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_precise boolean;
begin
  if new.location_source = 'manual' then
    -- Honor the owner's pin: keep the coords they sent, mark precise, skip derivation.
    new.location_precise := true;
    return new;
  end if;

  select lc.latitude, lc.longitude, lc.is_precise
    into v_lat, v_lng, v_precise
  from public.locality_coords(new.voivodeship, new.city) lc;

  new.latitude := v_lat;
  new.longitude := v_lng;
  new.location_precise := coalesce(v_precise, false);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Recreate the trigger adding location_source to the `of` list, so a revert
--    manual -> auto (with no city/voivodeship change) re-fires derivation.
--    Without it, a revert would leave the stale manual pin in place.
drop trigger zagrody_set_coords on public.zagrody;

create trigger zagrody_set_coords
  before insert or update of city, voivodeship, location_source on public.zagrody
  for each row
  execute function public.zagrody_set_coords();
