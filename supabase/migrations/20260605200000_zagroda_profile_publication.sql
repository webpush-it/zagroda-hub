-- S-01: zagroda profile & publication semantics.
-- Adds the FR-009 profile fields + is_published, hardens the booking_requests FK
-- (CASCADE -> RESTRICT), introduces the verified-e-mail gate (FR-006) and the
-- publish/unpublish primitive (FR-010), restricts public catalog visibility to
-- published zagrody, and creates the zagroda-photos storage bucket.

-- ---------------------------------------------------------------------------
-- 1. Voivodeship enum: the 16 Polish voivodeships (FR-002 primary filter axis).
--    Values are canonical display values (lowercase, with diacritics).
create type public.voivodeship as enum (
  'dolnośląskie',
  'kujawsko-pomorskie',
  'lubelskie',
  'lubuskie',
  'łódzkie',
  'małopolskie',
  'mazowieckie',
  'opolskie',
  'podkarpackie',
  'podlaskie',
  'pomorskie',
  'śląskie',
  'świętokrzyskie',
  'warmińsko-mazurskie',
  'wielkopolskie',
  'zachodniopomorskie'
);

-- ---------------------------------------------------------------------------
-- 2. Profile columns. NULL = draft-incomplete; completeness is validated by
--    set_zagroda_published(), not by NOT NULL constraints (draft model).
alter table public.zagrody
  add column description text,
  add column voivodeship public.voivodeship,
  add column city text,
  add column photo_path text,
  add column is_published boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. FK hardening: booking history must never be silently destroyed (12-month
--    history NFR; lessons.md immutability rule). The F-01 composite FK was
--    created unnamed -> drop by its auto-generated name, re-add named.
--
--    Cascade chain after this change:
--      delete zagroda  -> CASCADE turnusy -> RESTRICT by booking_requests
--      delete turnus   -> RESTRICT by booking_requests (direct)
--      delete auth.users row -> CASCADE zagrody -> ... -> RESTRICT
--    i.e. once any booking_request references a turnus, neither the turnus,
--    nor the zagroda, nor the owner's auth.users row can be deleted. This is
--    intentional — do NOT "fix" it back to CASCADE.
alter table public.booking_requests
  drop constraint booking_requests_turnus_id_zagroda_id_fkey,
  add constraint booking_requests_turnus_fkey
    foreign key (turnus_id, zagroda_id)
    references public.turnusy (id, zagroda_id)
    on delete restrict;

-- ---------------------------------------------------------------------------
-- 4. Verified-e-mail helper (FR-006 gate). Reads auth.users directly — the
--    JWT claim can be stale, the table is the truth.
create function public.email_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;

revoke execute on function public.email_verified() from public, anon;
grant execute on function public.email_verified() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Publish-flag immutability guard: is_published changes ONLY through
--    set_zagroda_published(). The trigger rejects direct flips by the RLS
--    roles; the SECURITY DEFINER function (owner: postgres) and service_role
--    seeding pass. INSERT needs no trigger — the owner INSERT policy's
--    WITH CHECK enforces is_published = false (policies can check NEW values
--    on INSERT; the trigger workaround is only needed for UPDATE's OLD/NEW).
create function public.enforce_publish_via_function()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'is_published can only be changed via set_zagroda_published()'
      using errcode = '42501'; -- insufficient_privilege
  end if;
  return new;
end;
$$;

create trigger zagrody_guard_is_published
  before update on public.zagrody
  for each row
  when (old.is_published is distinct from new.is_published)
  execute function public.enforce_publish_via_function();

-- ---------------------------------------------------------------------------
-- 6. Publish/unpublish primitive (mirrors accept_booking_request error style:
--    P0002 not found, 42501 not owner, 55000 gate violations with distinct,
--    app-mappable messages). Photo is deliberately NOT required (FR-009:
--    photo optional at publish). Param is target_zagroda_id (not zagroda_id)
--    to avoid plpgsql ambiguity with the turnusy.zagroda_id column.
create function public.set_zagroda_published(target_zagroda_id uuid, publish boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zagroda public.zagrody%rowtype;
  v_missing text[] := '{}';
  v_turnus_count integer;
begin
  select z.* into v_zagroda
    from public.zagrody z
    where z.id = target_zagroda_id;

  if not found then
    raise exception 'zagroda % does not exist', target_zagroda_id
      using errcode = 'P0002'; -- no_data_found
  end if;

  if v_zagroda.owner_id is distinct from (select auth.uid()) then
    raise exception 'caller is not the owner of zagroda %', target_zagroda_id
      using errcode = '42501'; -- insufficient_privilege
  end if;

  if publish then
    -- Gate 1: verified e-mail (FR-006) — the catalog's only anti-spam gate.
    if not public.email_verified() then
      raise exception 'email_not_verified'
        using errcode = '55000'; -- object_not_in_prerequisite_state
    end if;

    -- Gate 2: required profile fields (photo intentionally absent).
    -- array_append, not ||: an unknown-typed literal on the right of text[] ||
    -- resolves to array-concat and fails to parse as an array literal (22P02).
    if v_zagroda.name is null or btrim(v_zagroda.name) = '' then
      v_missing := array_append(v_missing, 'name');
    end if;
    if v_zagroda.description is null or btrim(v_zagroda.description) = '' then
      v_missing := array_append(v_missing, 'description');
    end if;
    if v_zagroda.voivodeship is null then
      v_missing := array_append(v_missing, 'voivodeship');
    end if;
    if v_zagroda.city is null or btrim(v_zagroda.city) = '' then
      v_missing := array_append(v_missing, 'city');
    end if;
    if array_length(v_missing, 1) > 0 then
      raise exception 'profile_incomplete: %', array_to_string(v_missing, ',')
        using errcode = '55000';
    end if;

    -- Gate 3: at least one turnus (FR-009: min. 1).
    select count(*) into v_turnus_count
      from public.turnusy t
      where t.zagroda_id = target_zagroda_id;
    if v_turnus_count = 0 then
      raise exception 'no_turnus'
        using errcode = '55000';
    end if;
  end if;

  update public.zagrody z
    set is_published = publish
    where z.id = target_zagroda_id;

  return publish;
end;
$$;

revoke execute on function public.set_zagroda_published(uuid, boolean) from public, anon;
grant execute on function public.set_zagroda_published(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Catalog visibility: published zagrody are public, drafts are owner-only.
--    Replaces the F-01 unrestricted public SELECT policies.
drop policy "zagrody are publicly readable by anon" on public.zagrody;
drop policy "zagrody are publicly readable by authenticated" on public.zagrody;

create policy "published zagrody are readable by anon"
  on public.zagrody for select to anon
  using (is_published);

create policy "published or own zagrody are readable by authenticated"
  on public.zagrody for select to authenticated
  using (is_published or (select auth.uid()) = owner_id);

drop policy "turnusy are publicly readable by anon" on public.turnusy;
drop policy "turnusy are publicly readable by authenticated" on public.turnusy;

create policy "turnusy of published zagrody are readable by anon"
  on public.turnusy for select to anon
  using (
    exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id and z.is_published
    )
  );

create policy "turnusy readable when zagroda published or own (authenticated)"
  on public.turnusy for select to authenticated
  using (
    exists (
      select 1 from public.zagrody z
      where z.id = zagroda_id
        and (z.is_published or z.owner_id = (select auth.uid()))
    )
  );

-- Owner INSERT may only create drafts (publish goes through the function).
drop policy "owners can insert their own zagroda" on public.zagrody;

create policy "owners can insert their own zagroda as draft"
  on public.zagrody for insert to authenticated
  with check ((select auth.uid()) = owner_id and is_published = false);

-- ---------------------------------------------------------------------------
-- 8. Storage: public bucket for zagroda photos; writes owner-scoped by the
--    first path folder (= auth.uid()). Public read comes from the bucket's
--    public flag (CDN URL) — no anon SELECT policy needed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'zagroda-photos',
  'zagroda-photos',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
);

create policy "owners can upload photos to their folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'zagroda-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "owners can update photos in their folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'zagroda-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'zagroda-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "owners can delete photos in their folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'zagroda-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
