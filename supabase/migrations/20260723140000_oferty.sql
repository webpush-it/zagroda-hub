-- S-12: oferty zagrody z cenami (FR-024, FR-025, FR-031, US-04).
-- A new, strictly additive owner-owned child of zagrody: name, description,
-- duration, multi-select topic + audience taxonomy, and an optional price
-- (integer grosze + a per-offer za_osobe/za_grupe unit). Offers are display-
-- only — no FK from booking_requests, the guest inquiry flow (FR-029) is
-- untouched. Zagrody with no offers stay fully functional.
--
-- Nothing here changes an existing table: new enums + new table only, so the
-- old worker survives the deploy window (lessons.md: schema ships additive).
-- Owner CRUD needs no RPC — there is no cross-row invariant, so RLS + plain
-- authenticated writes suffice (precedent: turnusy / day_blocks). Public read
-- gates on BOTH zagrody.is_published AND oferty.is_active (soft delete),
-- mirroring the turnusy publish gate.

-- ---------------------------------------------------------------------------
-- 1. Value domains. ASCII tokens, all values declared up front (mirroring
--    group_type / booking_source) to avoid ALTER TYPE later. Human labels
--    live in the presentation layer (src/lib/offer.ts).
create type public.price_unit as enum ('za_osobe', 'za_grupe');

-- Tematyka zajęć — the OSZE catalog filter, adopted 1:1 (11 values).
create type public.oferta_temat as enum (
  'edukacja_regionalna',
  'ekologia',
  'ginace_zawody',
  'kuchnia_domowa',
  'przyroda',
  'rekodzielo_artystyczne',
  'rolnictwo',
  'tradycyjna_zywnosc',
  'zajecia_rekreacyjne',
  'zajecia_sportowe',
  'zwyczaje_obrzedy'
);

-- Adresaci — candidate 6-value taxonomy (frame decision). Distinct axis from
-- group_type (S-11): adresaci = who the offer is FOR (owner declares), not who
-- the guest IS. A later doradca revision is an additive follow-up.
create type public.oferta_adresat as enum (
  'przedszkola',
  'szkoly_podstawowe',
  'szkoly_ponadpodstawowe',
  'rodziny',
  'dorosli',
  'seniorzy'
);

-- ---------------------------------------------------------------------------
-- 2. The offers table. amount_grosze is integer grosze (nullable — no amount
--    means „cena ustalana indywidualnie"); price_unit is only meaningful with
--    an amount, so a CHECK ties them together. temat/adresaci are required-
--    non-empty (the "nazwa + temat + adresaci required" decision).
create table public.oferty (
  id uuid primary key default gen_random_uuid(),
  zagroda_id uuid not null references public.zagrody (id) on delete cascade,
  nazwa text not null,
  opis text,
  czas_trwania text,
  temat public.oferta_temat[] not null,
  adresaci public.oferta_adresat[] not null,
  amount_grosze integer,
  price_unit public.price_unit,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- cardinality (not array_length): array_length('{}', 1) is NULL, and a CHECK
  -- passes on NULL — so array_length would silently admit an empty array.
  -- cardinality('{}') is 0, so this actually enforces "at least one value".
  constraint oferty_temat_nonempty check (cardinality(temat) >= 1),
  constraint oferty_adresaci_nonempty check (cardinality(adresaci) >= 1),
  constraint oferty_amount_positive check (amount_grosze is null or amount_grosze > 0),
  constraint oferty_amount_needs_unit check (amount_grosze is null or price_unit is not null)
);

-- ---------------------------------------------------------------------------
-- 3. updated_at is self-maintaining (reuse set_updated_at from
--    20260605123000).
create trigger oferty_set_updated_at
  before update on public.oferty
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS. Owner ALL is scoped by zagroda ownership (mirroring turnusy /
--    day_blocks). Public SELECT (anon + authenticated) gates on BOTH the
--    offer's is_active flag AND the zagroda's is_published flag — a soft-
--    deleted offer or an unpublished zagroda is invisible to guests.
alter table public.oferty enable row level security;

create policy "owners manage offers of their zagroda"
  on public.oferty for all to authenticated
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

create policy "active offers of published zagrody readable by anon"
  on public.oferty for select to anon
  using (
    is_active
    and exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id and z.is_published
    )
  );

create policy "active offers of published zagrody readable by auth"
  on public.oferty for select to authenticated
  using (
    is_active
    and exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id and z.is_published
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Indexes. FK lookup by zagroda; GIN on the taxonomy arrays prepares the
--    S-13 catalog filter (array containment) without a later schema change.
create index oferty_zagroda_id_idx on public.oferty (zagroda_id);
create index oferty_temat_gin_idx on public.oferty using gin (temat);
create index oferty_adresaci_gin_idx on public.oferty using gin (adresaci);
