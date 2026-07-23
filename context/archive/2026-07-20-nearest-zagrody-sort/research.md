---
date: 2026-07-20T00:00:00+02:00
researcher: Konrad Beśka
git_commit: b39632b
branch: master
repository: zagroda-hub
topic: "Najbliższe zagrody — sortowanie katalogu po odległości od gościa (S-10)"
tags: [research, codebase, katalog, geolokalizacja, geocoding, zagrody, sortowanie]
status: complete
last_updated: 2026-07-20
last_updated_by: Konrad Beśka
---

# Research: Najbliższe zagrody — sortowanie katalogu po odległości od gościa (S-10)

**Date**: 2026-07-20T00:00:00+02:00
**Researcher**: Konrad Beśka
**Git Commit**: b39632b
**Branch**: master
**Repository**: zagroda-hub

## Research Question

Jak wdrożyć slice S-10 (`nearest-zagrody-sort`): gość, który udostępni lokalizację
urządzenia, widzi katalog posortowany rosnąco po odległości od siebie, z przybliżoną
odległością (dokładność na poziomie miejscowości) na każdej karcie; odmowa lokalizacji
zostawia katalog dokładnie w obecnym kształcie (filtry województwo/miasto), bez błędów
i bez ponawiania prośby; sortowanie współpracuje z istniejącymi filtrami, a lokalizacja
gościa nie jest utrwalana. NFR: katalog < 2 s p95. PRD refs: FR-020, FR-030, US-04.

Zakres researchu (uzgodniony): **pełna analiza opcji pozyskiwania współrzędnych** +
katalog/filtry + geolokalizacja klienta + wydajność katalogu.

## Summary

- **Katalog jest w 100% SSR (Astro), bez żadnego React island.** `src/pages/katalog.astro`
  woła RPC `catalog_zagrody` (SECURITY DEFINER), mapuje wynik i renderuje statyczne
  `ZagrodaCard.astro`. Filtry (`wojewodztwo`/`miasto`/`data`/`osoby`) idą przez **URL query
  params** i są aplikowane **po stronie serwera, wewnątrz funkcji SQL** (AND-composowane
  klauzule `p_… is null or …`). To jest dokładnie ten addytywny model, do którego musi
  dołączyć sortowanie po odległości (FR-030 bez regresu).
- **Zero danych geograficznych w systemie.** Tabela `zagrody` ma tylko `voivodeship`
  (enum, 16 wartości) i `city` (**free text**). Brak lat/lng, brak PostGIS/`earthdistance`/`cube`,
  brak jakiegokolwiek słownika miejscowości w repo. **Odległości nie da się policzyć z
  obecnych danych — pozyskanie współrzędnych per-zagroda jest twardym prerekwizytem S-10.**
- **Zero kodu geolokalizacji i matematyki geo.** Brak `navigator.geolocation`, brak
  Permissions API, brak Haversine, brak `localStorage`/`sessionStorage`, brak nanostores.
  Stan przejściowy = `useState` / vanilla `<script>` + URL params.
- **Rekomendowana architektura obliczeń:** przy skali ≤100 wierszy (twardy `LIMIT 100`
  w RPC) i braku cache — **wyślij współrzędne zagród do przeglądarki i posortuj po Haversine
  po stronie klienta**. Współrzędne gościa nie opuszczają urządzenia (wzmacnia „nieutrwalanie"),
  brak round-tripu, ~100 obliczeń Haversine to <1 ms. Round-trip na serwer wymagałby
  przesłania lokalizacji gościa (większa latencja + ślad prywatności).
- **Rekomendowane źródło współrzędnych (do domknięcia w `/10x-plan`):** lokalny słownik
  `(voivodeship enum + znormalizowane city) → (lat, lng)` na poziomie miejscowości (np.
  z publicznej domeny TERYT/GUS SIMC), zapisany do nowych **nullable, addytywnych** kolumn
  `latitude`/`longitude` w `zagrody`; wypełnianie przy publikacji + jednorazowy backfill
  istniejących rekordów; fallback do centroidu województwa dla nietrafionych nazw. API
  geokodowania zewnętrznego to fallback, jeśli match-rate free-textu okaże się za niski.

## Detailed Findings

### Katalog + filtry (SSR, server-side)

- **Strona/route:** `src/pages/katalog.astro` — route `/katalog`, czysta strona Astro (SSR),
  bez React island.
- **Pobieranie danych:** klient Supabase tworzony serwerowo w frontmatterze
  (`katalog.astro:57`) przez `createClient(...)` z `src/lib/supabase.ts:10`
  (`@supabase/ssr` `createServerClient`). Dwa zapytania:
  1. Dropdown miast (`katalog.astro:66-68`): `supabase.from("zagrody").select("city").eq("is_published", true)`,
     opcjonalnie `.eq("voivodeship", ...)`, dedup/sort w JS (`:70-76`).
  2. Wiersze katalogu (`katalog.astro:90`): **RPC** `supabase.rpc("catalog_zagrody", rpcArgs)`.
- **Definicja RPC:** `supabase/migrations/20260607090000_catalog_zagrody.sql`, aktualna
  wersja (z day-blocks) w `supabase/migrations/20260719100000_manual_bookings_and_day_blocks.sql:407-466`.
  - Zwracane kolumny (`catalog_zagrody.sql:22-31`): `id, name, description, voivodeship,
    city, photo_path, daily_limit, created_at, is_available` — **żadnych współrzędnych**.
  - Filtry wewnątrz SQL: `voivodeship` (`:461-462`), `city` case-insensitive trim
    (`:463`), `data`/`osoby` sterują `is_available` (occupancy SUM + day-block, `:437-458`).
  - **Sort domyślny:** `order by is_available desc nulls first, z.created_at desc` (`:464`).
  - **`LIMIT 100`** (`:465`), brak paginacji, brak offsetu.
- **Stan filtrów:** formularz `<form method="GET" action="/katalog">` (`katalog.astro:113`);
  params `wojewodztwo`, `miasto`, `data`, `osoby` parsowane w frontmatterze
  (`katalog.astro:11-37, 80-81`), składane warunkowo w args RPC (`:83-89`). Vanilla JS
  (`:184-204`) tylko auto-submit formularza po zmianie województwa i toggle `osoby`.
- **Karta:** `src/components/katalog/ZagrodaCard.astro` (Astro, SSR). Props (`:4-12`):
  `id, name, description, city, voivodeship, photoUrl, available`; linia lokalizacji
  `[city, voivodeship].join(", ")` (`:21, 52`). Mapowanie wierszy: `katalog.astro:94-103`.

**Punkty wpięcia dla odległości:** (1) źródło współrzędnych (nowe kolumny + backfill);
(2) kanał lokalizacji gościa (klient); (3) RPC — dołożyć współrzędne do `RETURNS TABLE`
i SELECT (klauzule WHERE `:460-463` zostają nietknięte — odległość jest dodatkiem do sortu,
nie filtrem); (4) mapowanie `distanceKm` w `katalog.astro:94-103`; (5) wyświetlenie przy
linii lokalizacji w `ZagrodaCard.astro:52`.

### Model danych i pozyskiwanie współrzędnych

- **Tabela `public.zagrody`:** baza w `supabase/migrations/20260605090307_domain_schema.sql:18-24`
  (`id, owner_id, name, daily_limit, created_at`), rozszerzona w
  `supabase/migrations/20260605200000_zagroda_profile_publication.sql:32-37`:
  `description text`, `voivodeship public.voivodeship` (**enum, 16 wartości**, def. `:10-27`),
  `city text` (**free text**, etykieta UI „Miejscowość"), `photo_path text`,
  `is_published boolean`.
- **Brak jakichkolwiek kolumn geo** (lat/lng/point/geography/geometry), **brak
  `create extension`** dla PostGIS/`earthdistance`/`cube`, brak indeksów geo, brak `ST_*`.
  Grep po `supabase/` i `src/` — zero trafień. Mechanizm współrzędnych jest greenfield.
- **`voivodeship` = pewny enum** (`src/lib/zagroda.ts:5` → `VOIVODESHIPS`; `<select>` w
  `src/components/zagroda/ZagrodaProfileForm.tsx:200-215`). **`city` = niewalidowany free
  text** (`z.string().trim().max(120)`, `src/lib/zagroda.ts:33`; input `ZagrodaProfileForm.tsx:219`).
  Gate publikacji sprawdza tylko niepustość miasta (`20260605200000_...sql:156`).
  → geokodowanie musi tolerować literówki i kolizje nazw; **województwo (enum) jest kluczowym
  dyskryminatorem** przy powtarzających się nazwach miejscowości.
- **Brak słownika/datasetu lokalizacji w repo** (żadnych TERYT/GUS/powiat/gmina, JSON/CSV/GeoJSON).
  Jedyna „lista miast" powstaje dynamicznie z DISTINCT `zagrody.city` w `katalog.astro:66-76`.
- **RLS / ekspozycja:** `zagrody` ma RLS; polityka anon SELECT `using (is_published)` —
  anon czyta **wszystkie kolumny** opublikowanych wierszy (`20260605200000_...sql:191-193`),
  więc nowa kolumna współrzędnych będzie automatycznie czytelna publicznie. Katalog i tak
  czyta przez RPC `catalog_zagrody` (SECURITY DEFINER, jawna lista kolumn, grant `anon,
  authenticated` — `catalog_zagrody.sql:72`), więc trzeba rozszerzyć `RETURNS TABLE` + SELECT.
  Zwykłe kolumny (para współrzędnych) są UPDATE-owalne przez właściciela
  (`domain_schema.sql:83-86`) i przez `service_role`/SECURITY DEFINER przy backfillu.
- **Konwencje migracji / lessons:** addytywne `alter table ... add column` to ustalony wzorzec;
  enumy deklarowane z góry ze wszystkimi wartościami. `context/foundation/lessons.md:12-17`
  — twarda reguła deployu: `supabase db push` PRZED deployem workera; migracje **addytywne/
  wstecznie kompatybilne**. → kolumny współrzędnych muszą być nullable/backfillowalne.

### Geolokalizacja klienta + wydajność

- **React islands:** tylko `client:load` (formularze/interakcje-na-wejściu: `signin.astro:12,14`,
  `signup.astro:12,14`, `reset-password.astro:21`, `dashboard.astro:55`, `zagrody/[id].astro:105`,
  `anuluj.astro:23`, `dashboard/zapytania/index.astro:77-79`, `.../[id].astro:165`) i
  `client:idle` (menu: `Topbar.astro:44,47`). Brak `client:visible`/`client:only`.
  **Katalog nie ma React island** — ma vanilla `<script>` (`katalog.astro:184-204`).
  Dwa warianty domu dla re-sortu po geolokalizacji: (a) rozszerzyć istniejący vanilla
  `<script>` (lżejszy, zgodny z idiomem strony), (b) nowy React island wokół listy wyników.
- **Brak kodu geolokalizacji** (`navigator.geolocation`, Permissions API) — potwierdzone.
- **Stan/„nieutrwalanie":** tylko `useState`; **brak `localStorage`/`sessionStorage`**,
  brak nanostores/zustand/jotai. Wymóg „lokalizacja nieutrwalana" spełniony za darmo przez
  trzymanie współrzędnych w zmiennej JS / `useState`. **Nie wkładać współrzędnych do URL**
  (historia = możliwość udostępnienia/utrwalenia).
- **Ścieżka wydajności:** `astro.config.mjs` → `output: "server"` + adapter
  `@astrojs/cloudflare`; katalog renderowany dynamicznie w Workerze per request. **Brak
  `Cache-Control`/cache** — każde wejście woła RPC świeżo. Dane **≤100 wierszy** (`LIMIT 100`,
  `catalog_zagrody.sql:66`), brak masowego seeda. → **client-side Haversine na ≤100 wierszach
  jest oczywiście wykonalny i preferowany**; współrzędne już w SSR-owym HTML/props.
- **CTA:** „Znajdź zagrodę" to zwykły anchor do `/katalog`, dwukrotnie na landingu:
  `src/pages/index.astro:39` (hero) i `:279` (domykające CTA). Krok „zgoda na lokalizację"
  z „max 2 interakcje" najnaturalniej wyzwalać na stronie katalogu po wejściu.
- **Brak utili geo/Haversine** w `src/lib/` — potwierdzone.

## Code References

- `src/pages/katalog.astro:57` — serwerowy klient Supabase (SSR)
- `src/pages/katalog.astro:66-76` — dropdown miast z DISTINCT `city`
- `src/pages/katalog.astro:11-37, 80-89` — parsing filtrów z URL → args RPC
- `src/pages/katalog.astro:90` — `supabase.rpc("catalog_zagrody", rpcArgs)`
- `src/pages/katalog.astro:94-103` — mapowanie wierszy (punkt na `distanceKm`)
- `src/pages/katalog.astro:113` — `<form method="GET" action="/katalog">`
- `src/pages/katalog.astro:184-204` — vanilla `<script>` (dom dla re-sortu, wariant a)
- `src/components/katalog/ZagrodaCard.astro:4-12, 21, 52` — props + linia lokalizacji (miejsce na odległość)
- `supabase/migrations/20260607090000_catalog_zagrody.sql:21-31, 63-66, 72` — RPC: kolumny, filtr city, sort, LIMIT, grant
- `supabase/migrations/20260719100000_manual_bookings_and_day_blocks.sql:407-466` — aktualna wersja RPC
- `supabase/migrations/20260605090307_domain_schema.sql:18-24, 83-86` — baza `zagrody`, owner UPDATE policy
- `supabase/migrations/20260605200000_zagroda_profile_publication.sql:10-27, 32-37, 191-193` — enum województw, kolumny profilu, anon SELECT policy
- `src/lib/zagroda.ts:5, 33` — `VOIVODESHIPS`, walidacja `city`
- `src/components/zagroda/ZagrodaProfileForm.tsx:200-215, 219` — select województwa, input miasta
- `src/pages/index.astro:39, 279` — CTA „Znajdź zagrodę" → `/katalog`
- `astro.config.mjs` — `output: "server"`, adapter `@astrojs/cloudflare`
- `context/foundation/lessons.md:12-17` — reguła deployu (db push przed workerem, migracje addytywne)

## Architecture Insights

- **Wszystko (filtr + sort) żyje serwerowo w `catalog_zagrody`.** Najczystsze wpięcie
  odległości architektonicznie byłoby też tam — ale zależy od dostarczenia współrzędnych
  gościa na serwer, co koliduje z „nieutrwalaniem" i modelem URL-params. Stąd napięcie:
  **SSR-only vs geolokalizacja tylko po stronie klienta.**
- **Dwie realne architektury obliczeń odległości:**
  - **Client-side (rekomendowane):** RPC zwraca współrzędne zagród → wysyłane do przeglądarki
    → po zgodzie na geolokalizację JS liczy Haversine i re-sortuje ≤100 kart. Współrzędne
    gościa nie opuszczają urządzenia. Koszt: **layout shift** (SSR renderuje kolejność
    domyślną, klient przestawia listę po zgodzie).
  - **Server-side:** przesłać współrzędne gościa do RPC (`p_lat`/`p_lng`, `order by distance`).
    Wymaga POST/body (nie URL — inaczej łamie „nieutrwalanie"), dokłada latencję i ślad
    prywatności; brak `earthdistance`/PostGIS dziś → Haversine w SQL albo nowe rozszerzenie.
- **Pułapka `LIMIT 100`:** sort po odległości po stronie klienta przestawia tylko te 100
  wierszy zwróconych wg dostępności/świeżości — przy >100 opublikowanych *najbliższa*
  zagroda mogłaby nie trafić do setki. Na skali MVP nieistotne, ale to sort w obrębie strony,
  nie globalne „najbliżej", dopóki RPC nie dostanie orderowania po odległości przed LIMIT.
- **Opcje źródła współrzędnych (city → lat/lng):**
  - **A. Lokalny słownik** `(voivodeship + city_norm) → (lat, lng)` (bundel JSON lub tabela
    DB, np. TERYT/GUS SIMC, licencja: domena publiczna). Plusy: bez zależności runtime,
    deterministyczny, darmowy, pasuje do addytywnej migracji i SECURITY DEFINER RPC; enum
    województwa rozstrzyga kolizje nazw. Minusy: trzeba pozyskać/zweryfikować dataset,
    fuzzy-matching free-textu (case/diakrytyki/łączniki) + fallback dla nietrafień, rozmiar bundla.
  - **B. Zewnętrzne API geokodowania przy publikacji** (Nominatim/OSM, Google, Geoapify z
    `city + voivodeship + "Polska"`), zapis do kolumn. Plusy: radzi sobie z literówkami,
    bez datasetu, współrzędne cache'owane w DB. Minusy: zależność/awaryjność w ścieżce
    publikacji (musi degradować się miękko), rate-limity/ToS, sekret/klucz, egress z workera,
    przegląd prywatności; i tak wymaga backfillu istniejących wierszy.
  - **C. Jednorazowy backfill** (uzupełnia A lub B): skrypt/data-migration iteruje
    opublikowane `zagrody`, rozwiązuje współrzędne, UPDATE nowych kolumn (service_role,
    omija RLS). Domyka wymóg „auto-uzupełnienie bez działania właściciela"; musi być idempotentny.
- **Rekomendacja do planu:** A (słownik na poziomie miejscowości, klucz = enum województwa
  + znormalizowane miasto) → nowe nullable kolumny `latitude`/`longitude`, wypełniane przy
  publikacji + backfill (C), z fallbackiem do centroidu województwa; B jako fallback przy
  niskim match-rate. Rozszerzyć `catalog_zagrody` `RETURNS TABLE` + SELECT o współrzędne.

## Historical Context (from prior changes)

- `context/archive/2026-06-07-catalog-browse-and-zagroda-page/` — pierwotny katalog i RPC
  `catalog_zagrody`; ustalił model: filtr+sort serwerowy w SECURITY DEFINER RPC, `city` jako
  free text, `voivodeship` jako enum.
- `context/archive/2026-07-19-phone-bookings-and-day-blocks/` — ostatnia (aktualna) wersja
  RPC `catalog_zagrody` z obsługą day-blocks (`20260719100000_...:407-466`); to wersja,
  którą trzeba rozszerzyć o współrzędne.
- `context/archive/2026-07-20-landing-enrichment/` i `client-first-landing` (S-09) — landing
  „client-first" z CTA „Znajdź zagrodę"; razem z S-10 domyka kryterium sukcesu #2
  („max 2 interakcje od strony głównej do katalogu od najbliższych").
- `context/foundation/lessons.md:12-17` — deploy: `supabase db push` przed workerem; migracje
  addytywne (dotyczy nowej kolumny współrzędnych i backfillu).

## Related Research

- `context/foundation/prd-v2.md` — FR-020, FR-030, US-04, reguła kalkulacji i NFR
  (linie 55, 66-67, 88-101, 113-116, 146, 151, 164, 170-173, 181, 188).
- `context/foundation/roadmap.md:82-92, 140, 155` — definicja slice'a S-10 i parking „Mapa w UI".
- Brak wcześniejszego `research.md` dla tego tematu.

## Open Questions

1. **Źródło współrzędnych (główny unknown, do domknięcia w `/10x-plan`):** lokalny słownik
   (A) vs zewnętrzne API (B)? Który dataset (TERYT/GUS SIMC subset), jak normalizować free-text
   `city`, jaki próg match-rate uzasadnia fallback na B, jaki fallback dla nietrafień
   (centroid województwa)?
2. **Client-side vs server-side liczenie odległości:** rekomendacja to client-side (Haversine
   na ≤100 wierszach, współrzędne gościa nie opuszczają urządzenia). Potwierdzić wobec NFR
   < 2 s p95 i wymogu „nieutrwalania".
3. **`LIMIT 100` vs globalne „najbliżej":** czy przy obecnej skali akceptujemy sort w obrębie
   setki, czy RPC ma sortować po odległości przed LIMIT (wymaga współrzędnych gościa na serwerze)?
4. **Layout shift:** SSR renderuje kolejność domyślną, klient re-sortuje po zgodzie — jak
   zaadresować reflow bez regresu UX (rezerwacja wysokości / gating renderu / animacja)?
5. **Ścieżka odmowy / brak ponawiania:** `getCurrentPosition` tylko na jawną akcję użytkownika;
   po `PermissionDenied` katalog zostaje w SSR-owej kolejności, bez błędu i bez ponawiania —
   flaga in-memory wystarczy (brak store'a dziś).
6. **Infra:** env wskazuje Vercel, lessons/deploy odwołują się do Cloudflare Workers + wrangler
   — potwierdzić faktyczny runtime, jeśli plan wybierze geokodowanie HTTP przy publikacji (egress/sekret).
7. **Precyzja/prywatność komunikatu:** odległość „jawnie przybliżona" (poziom miejscowości) —
   jak sformułować na karcie, by nie sugerować precyzji GPS (FR-020 / NFR).
