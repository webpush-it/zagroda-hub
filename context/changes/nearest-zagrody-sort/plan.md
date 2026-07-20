# Najbliższe zagrody — sortowanie katalogu po odległości (S-10) Implementation Plan

## Overview

Dodajemy do katalogu sortowanie zagród rosnąco po odległości od lokalizacji urządzenia
gościa. Każda zagroda dostaje współrzędne na poziomie miejscowości — wyznaczane po stronie
serwera z istniejącego pola `city` + `voivodeship` przy użyciu lokalnego słownika miejscowości
(bez nowych pól dla właściciela). Gość, który tapnie „📍 Pokaż najbliżej mnie" i udzieli zgody
w przeglądarce, widzi katalog przestawiony po odległości i przybliżoną odległość na karcie;
odmowa zostawia katalog dokładnie w obecnym kształcie. Odległość liczona jest wyłącznie po
stronie klienta (Haversine), więc lokalizacja gościa nigdy nie opuszcza urządzenia i nie jest
utrwalana. Realizuje FR-020, FR-030, US-04.

## Current State Analysis

- **Katalog jest w 100% SSR** (`src/pages/katalog.astro`): frontmatter woła RPC
  `catalog_zagrody` (`.rpc(...)`, `katalog.astro:90`), mapuje wynik (`:94-103`), renderuje
  statyczne `ZagrodaCard.astro` (`:173-177`). Interaktywność to jeden progressive-enhancement
  `<script>` (`:184-204`) — brak React island na tej stronie.
- **Filtry idą przez URL query params** (`wojewodztwo/miasto/data/osoby`, parsowane
  `katalog.astro:11-37, 80-89`) i są aplikowane serwerowo w SQL jako AND-composowane klauzule
  (`...day_blocks.sql:460-463`). Sort domyślny `is_available desc nulls first, created_at desc`
  (`:464`), twardy `LIMIT 100` (`:465`).
- **Zero danych geograficznych.** `zagrody` ma tylko `voivodeship` (enum 16 wartości,
  `20260605200000_...sql:10-27`) i `city` (**free text**, `:35`; walidacja tylko
  `trim().max(120)` w `src/lib/zagroda.ts:33`). Brak lat/lng, brak PostGIS/`earthdistance`,
  brak słownika miejscowości w repo. Distance nie da się policzyć z obecnych danych.
- **Ekspozycja i publikacja.** RLS: anon SELECT `using (is_published)` czyta wszystkie kolumny
  opublikowanych wierszy (`20260605200000_...sql:191-193`) → nowa kolumna coords będzie anon-
  czytelna. Katalog czyta jednak przez RPC `catalog_zagrody` (SECURITY DEFINER, jawna lista
  kolumn, grant `anon, authenticated` — `...day_blocks.sql:407-466`). `is_published` przełącza
  wyłącznie `set_zagroda_published()`, chroniony triggerem `zagrody_guard_is_published`
  (`20260605200000_...sql:100-104`); zwykłe kolumny są UPDATE-owalne przez ownera i
  service_role.
- **Konwencje.** Skrypty: `db:push` (migracje), `db:types` (regen typów), `test` (vitest),
  `deploy = build && db:push && wrangler deploy` (`package.json:13-19`). `pg` dostępny jako
  devDependency (skrypty Node). Reguła deployu (`lessons.md:12-17`): migracje addytywne/wstecznie
  kompatybilne, `db:push` PRZED `wrangler deploy`.

## Desired End State

- Gość na `/katalog` widzi przycisk „📍 Pokaż najbliżej mnie". Po tapnięciu i zgodzie w
  przeglądarce lista ≤100 kart przestawia się rosnąco po odległości, a karty z lokalizacją na
  poziomie miejscowości pokazują „~X km". Jeśli zgoda była już wcześniej udzielona (Permissions
  API), sortowanie następuje automatycznie po wejściu. Odmowa/brak zgody: katalog zostaje w
  kolejności SSR, bez błędu, bez ponawiania prośby.
- Każda opublikowana zagroda ma `latitude`/`longitude` i flagę `location_precise`, wyznaczone z
  `city`+`voivodeship`; istniejące zagrody uzupełnione backfillem; nowe/edytowane — automatycznie
  triggerem. Właściciel nie robi nic.
- Lokalizacja gościa nigdy nie trafia na serwer, do URL, cookies ani storage.
- Weryfikacja: `npm test` (DB + unit) zielone; `npm run build`/typecheck/lint czyste; ręcznie —
  grant/deny geolokalizacji na katalogu zachowuje się jak wyżej; NFR katalog < 2 s p95 utrzymany.

### Key Discoveries:

- Zmiana return type RPC wymaga **drop + create + re-grant**, nie `CREATE OR REPLACE` (Postgres
  nie zmienia return type istniejącej funkcji). Args bez zmian → stary worker w oknie deployu
  ignoruje nowe kolumny (kompatybilne wstecz).
- Rozdzielczość współrzędnych trzymamy w DB (tabela `localities` + funkcja + trigger), nie w
  bundlu Workera — Worker ma limit rozmiaru, a dataset wsi to dziesiątki tysięcy wierszy.
- Trigger na `zagrody` (na zmianę `city`/`voivodeship`) domyka nowe publikacje/edycje bez zmian w
  `set_zagroda_published()` (`20260605200000_...sql:112-180`).
- Client `<script>` w Astro jest bundlowany przez Vite → może importować `src/lib/geo.ts`.

## What We're NOT Doing

- Żadnej mapy/widoku GPS (non-goal MVP podtrzymany; PRD §Non-Goals).
- Żadnych nowych pól w formularzu właściciela ani ręcznego wskazywania lokalizacji zagrody
  (PRD: „zero nowych pól dla właściciela").
- Bez wysyłania współrzędnych gościa na serwer, bez server-side liczenia odległości, bez
  `earthdistance`/PostGIS.
- Bez zmiany landingu — CTA „Znajdź zagrodę" → `/katalog` zostaje.
- Bez podnoszenia `LIMIT 100` (sort w obrębie zwróconej strony; przy obecnej skali <100
  opublikowanych = sort globalny). Rewizja dopiero, gdy katalog przekroczy 100.
- Bez utrwalania lokalizacji gościa (żadnego localStorage/sessionStorage/cookie/URL).

## Implementation Approach

Backend-first, trzy fazy. Najpierw warstwa danych w DB (schemat, resolver, trigger, RPC) —
addytywna i deployowalna niezależnie. Potem załadowanie datasetu miejscowości i backfill
istniejących zagród. Na końcu warstwa klienta: geolokalizacja + sort + prezentacja, w idiomie
istniejącego progressive-enhancement `<script>`.

## Critical Implementation Details

- **RPC drop+recreate, args bez zmian.** `catalog_zagrody` musi zachować dotychczasową sygnaturę
  argumentów (`p_voivodeship, p_city, p_trip_date, p_participants`), by stary worker w oknie
  deployu dalej działał; zmieniamy wyłącznie `RETURNS TABLE`/`SELECT` (dodane kolumny). Po
  recreate ponowić `grant execute ... to anon, authenticated`.
- **Kolejność seed → backfill.** Trigger i backfill zależą od danych w `localities`. Migracja
  (Faza 1) tworzy pustą tabelę `localities`; realny dataset ładuje seed (Faza 2), a backfill
  `zagrody` musi biec PO seedzie. Publikacje między migracją a seedem dostaną fallback centroidu
  — skorygowane backfillem.
- **Normalizacja nazw.** Dopasowanie `city` do słownika po `lower(extensions.unaccent(trim(name)))`;
  `unaccent` na Supabase żyje w schemacie `extensions`, a funkcje mają `set search_path = ''`, więc
  wywołanie MUSI być schema-kwalifikowane (`extensions.unaccent(...)`) — bez tego funkcja rzuci
  „function unaccent(text) does not exist". `unaccent` musi mapować polskie znaki włącznie z „ł" —
  jeśli domyślny słownik nie tnie „ł", dołożyć jawne `replace(...,'ł','l')`/`'Ł'` w normalizacji
  (jedno miejsce: funkcja `locality_coords`).
- **Layout shift.** SSR renderuje kolejność domyślną; po zgodzie klient re-sortuje ≤100 kart →
  reflow. Ścieżka odmowy (domyślna) MUSI renderować dokładnie obecną kolejność SSR bez regresu.

## Phase 1: Warstwa danych współrzędnych (migracja DB)

### Overview

Jedna addytywna migracja: rozszerzenie `zagrody` o współrzędne, tabele słownika, funkcja-resolver
z fallbackiem centroidu, trigger auto-uzupełniający, oraz przebudowa RPC katalogu tak, by
zwracał współrzędne. Regeneracja typów.

### Changes Required:

#### 1. Migracja schematu i logiki geo

**File**: `supabase/migrations/<timestamp>_zagroda_coordinates.sql` (nowa)

**Intent**: Wprowadzić pełną warstwę danych współrzędnych na poziomie miejscowości, addytywnie i
wstecznie kompatybilnie, zgodnie z regułą deployu.

**Contract**:
- `create extension if not exists unaccent with schema extensions;` — na Supabase rozszerzenia
  żyją w schemacie `extensions`, nie `public`. **Każde** wywołanie musi być schema-kwalifikowane
  (`extensions.unaccent(...)`), bo funkcje mają `set search_path = ''`.
- `alter table public.zagrody add column latitude double precision, add column longitude double
  precision, add column location_precise boolean not null default false;` (nullable coords; brak
  precyzji dopóki nie rozwiązane).
- `create table public.localities (voivodeship public.voivodeship not null, name text not null,
  name_normalized text not null, latitude double precision not null, longitude double precision
  not null, primary key (voivodeship, name_normalized));` — słownik miejscowość→coords, klucz na
  (enum województwa + znormalizowana nazwa). **Jedno źródło prawdy dla normalizacji (F2):**
  `name_normalized` NIE jest liczone w Node — seed wstawia surowe `name`, a wartość
  `name_normalized` liczy DB tym samym wyrażeniem SQL co lookup w `locality_coords`
  (`lower(extensions.unaccent(trim(name)))` z „ł"→"l"); dzięki temu asset i lookup nie mogą się
  rozjechać. RLS: włączyć, brak polityk anon (tabela referencyjna czytana tylko przez SECURITY
  DEFINER funkcję).
- `create table public.voivodeship_centroids (voivodeship public.voivodeship primary key, latitude
  double precision not null, longitude double precision not null);` + `insert` 16 centroidów
  (wartości wpisane w migracji — mały, stały zbiór).
- `create function public.locality_coords(p_voivodeship public.voivodeship, p_city text) returns
  table (latitude double precision, longitude double precision, is_precise boolean)` — `stable`,
  `security definer`, `set search_path = ''`. Logika: gdy `p_voivodeship`/`p_city` puste → brak
  wiersza (coords null). W przeciwnym razie lookup w `localities` po
  `(p_voivodeship, normalize(p_city))`; trafienie → coords + `is_precise = true`; brak trafienia →
  centroid z `voivodeship_centroids` + `is_precise = false`. Normalizacja =
  `lower(extensions.unaccent(trim(...)))` — z gwarancją „ł"→"l" (patrz Critical Implementation
  Details). Wywołanie `unaccent` MUSI być schema-kwalifikowane (`extensions.`) pod `search_path=''`.
- `create function public.zagrody_set_coords() returns trigger` + `create trigger` `before insert
  or update of city, voivodeship on public.zagrody for each row` — ustawia
  `new.latitude/longitude/location_precise` z `locality_coords(new.voivodeship, new.city)`.
  **Zero-row-safety (F5):** gdy `locality_coords` nie zwróci wiersza (puste `city`/`voivodeship`),
  `latitude/longitude` → NULL, a `location_precise` → `coalesce(..., false)` (kolumna jest NOT
  NULL — NULL wywróciłby insert). Nie dotyka `is_published` (nie koliduje z
  `zagrody_guard_is_published`). Uwaga na blast radius: trigger odpala się przy KAŻDYM
  `seedZagroda(...)` we wszystkich suite'ach DB — musi być szybki i nie rzucać.
- **RPC**: `drop function public.catalog_zagrody(public.voivodeship, text, date, integer);` a
  następnie `create function public.catalog_zagrody(... te same argumenty ...)` z `RETURNS TABLE`
  rozszerzonym o `latitude double precision, longitude double precision, location_precise boolean`
  i odpowiednim `select z.latitude, z.longitude, z.location_precise`. Klauzule `where`/`order
  by`/`limit` **bez zmian** (odległość nie jest filtrem ani sortem serwerowym). Po recreate:
  `grant execute on function public.catalog_zagrody(public.voivodeship, text, date, integer) to
  anon, authenticated;`.

#### 2. Regeneracja typów

**File**: `src/db/database.types.ts` (generowany)

**Intent**: Zaktualizować typy TS o nowe kolumny `zagrody` i nowy kształt zwrotu `catalog_zagrody`.

**Contract**: uruchomić `npm run db:types` (po `db:reset`/`db:push` lokalnie). Bez ręcznej edycji.

#### 3. Testy DB warstwy geo

**File**: `tests/db/zagroda-coordinates.test.ts` (nowy; wzorzec `tests/db/*.test.ts`)

**Intent**: Zabezpieczyć resolver, trigger i kontrakt RPC.

**Contract**: przypadki — (a) `locality_coords` trafienie → `is_precise=true`; (b) miss →
centroid + `is_precise=false`; (c) normalizacja: różnice wielkości liter/diakrytyków/„ł"/spacji
dają to samo trafienie; (d) trigger ustawia coords przy insert i przy update `city`/`voivodeship`;
(e) `catalog_zagrody` zwraca `latitude/longitude/location_precise` i zachowuje istniejące filtry
+ sort + `LIMIT 100`.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `npm run db:reset`
- Typy regenerują się bez rozjazdu: `npm run db:types` (brak niezacommitowanego diffu poza
  oczekiwanym)
- Testy DB przechodzą: `npm test`
- Typecheck czysty: `npx astro check`
- Lint czysty: `npm run lint`

#### Manual Verification:

- W Supabase Studio: publikacja/edycja zagrody z realnym miastem ustawia `location_precise=true` i
  sensowne coords; z nieznanym miastem → centroid i `location_precise=false`.
- Stary kształt zapytania katalogu (bez nowych kolumn po stronie klienta) nadal zwraca wyniki
  (kompatybilność wsteczna RPC).
- Regresja (F5): istniejące suity `tests/db/catalog.test.ts` i `tests/db/day-blocks.test.ts`
  pozostają zielone po drop+recreate RPC i po wprowadzeniu triggera (który odpala się na każdym
  `seedZagroda`).

**Implementation Note**: Po tej fazie i przejściu automatycznej weryfikacji zatrzymaj się na
ręczne potwierdzenie zanim przejdziesz do Fazy 2.

---

## Phase 2: Dataset miejscowości + seed i backfill

### Overview

Pozyskanie i normalizacja publicznego (domena publiczna) zbioru polskich miejscowości ze
współrzędnymi, załadowanie go do `public.localities` idempotentnym skryptem, oraz jednorazowy
backfill współrzędnych istniejących opublikowanych zagród.

### Changes Required:

#### 1. Znormalizowany dataset miejscowości (asset repo)

**File**: `scripts/data/localities.pl.csv` (lub `.json`) — commitowany asset

**Intent**: Dostarczyć deterministyczne źródło `(voivodeship, name, lat, lng)` na poziomie
miejscowości, wystarczające dla obszarów wiejskich (zagrody edukacyjne).

**Contract**: źródło = publiczny rejestr z lat/lng dla wszystkich miejscowości (np. GUGiK PRNG /
TERYT SIMC z geokoordynatami — licencja domena publiczna). Kolumny assetu: `voivodeship` (dokładnie
16 wartości enuma, mapowane z kodów TERYT), `name` (**surowa, bez normalizacji** — normalizację
liczy wyłącznie DB, F2), `latitude`, `longitude`. **Nie** trzymać `name_normalized` w assecie.
Deduplikacja `(voivodeship, name_normalized)` domykana jest przy ładowaniu przez `on conflict`
(np. największa/gminna miejscowość wygrywa — kolejność/priorytet ustala seed). Pozyskanie/
transformacja może być osobnym skryptem generującym asset — do repo trafia gotowy plik z surowymi
nazwami.

#### 2. Skrypt seed + backfill

**File**: `scripts/seed-localities.ts` (nowy; Node + `pg`, service-role/URL z env)

**Intent**: Idempotentnie załadować słownik do `localities` i uzupełnić coords istniejących
zagród — jedno uruchomienie na środowisko (lokalne i prod), zgodnie z wybraną strategią „backfill
skryptem przy deployu".

**Contract**: (a) upsert wierszy z assetu do `public.localities` — INSERT liczy `name_normalized`
tym samym wyrażeniem SQL co `locality_coords` (`lower(extensions.unaccent(trim(name)))` z „ł"→"l"),
`on conflict (voivodeship, name_normalized) do update` (jedno źródło prawdy dla normalizacji, F2);
(b) po załadowaniu wykonać set-owy
backfill: `update public.zagrody z set (latitude, longitude, location_precise) = (lc.latitude,
lc.longitude, lc.is_precise) from public.locality_coords(z.voivodeship, z.city) lc where
z.voivodeship is not null;` — idempotentny, re-runnable. Skrypt loguje liczbę wierszy słownika,
liczbę zagród zaktualizowanych i **match-rate** (ile `location_precise=true`). **Próg jakości (F4):**
match-rate ≥ 90% opublikowanych zagród; poniżej progu — remediacja przed Fazą 3: skrypt zrzuca listę
nietrafionych `(voivodeship, city)`, a implementer inspekcjonuje normalizację / dedup / mapowanie
kodów TERYT→enum. Cicha degradacja do centroidów (sortuje, ale bez „~X km") nie może przejść jako
sukces.

#### 3. Runbook deployu

**File**: `context/foundation/lessons.md` lub `README`/`change.md` (notatka) + `package.json`
(opcjonalny skrypt `db:seed-localities`)

**Intent**: Utrwalić, że seed+backfill biegnie raz po migracji, PRZED/obok `wrangler deploy`, aby
prod miał słownik i coords (spójne z regułą deployu z `lessons.md:12-17`).

**Contract**: dodać krok „po `db:push` uruchom `npm run db:seed-localities`" do runbooku deployu i
Migration Notes; dla lokalnego dev — po `db:reset` uruchomić ten sam skrypt.

#### 4. Testy seed/backfill

**File**: `tests/db/localities-seed.test.ts` (nowy)

**Intent**: Zabezpieczyć idempotencję i poprawność backfillu.

**Contract**: (a) dwukrotne uruchomienie upsertu nie tworzy duplikatów i nie zmienia wyniku;
(b) po seedzie backfill ustawia coords zgodnie z `locality_coords`; (c) zagroda z nieznanym
miastem dostaje centroid + `location_precise=false`.

### Success Criteria:

#### Automated Verification:

- Skrypt uruchamia się i jest idempotentny: `npm run db:seed-localities` (dwa razy — ten sam stan)
- Testy przechodzą: `npm test`
- Lint/typecheck czyste: `npm run lint`, `npx astro check`

#### Manual Verification:

- Match-rate ≥ 90% opublikowanych zagród (`location_precise=true`); logi skryptu potwierdzają liczby.
  Poniżej progu — remediacja (dump nietrafionych miast → inspekcja normalizacji/dedupu/mapowania)
  przed przejściem do Fazy 3.
- Ręczny przegląd kilku zagród: coords wskazują właściwą miejscowość (spot-check na mapie).

**Implementation Note**: Po tej fazie i automatycznej weryfikacji zatrzymaj się na ręczne
potwierdzenie (zwłaszcza match-rate) przed Fazą 3.

---

## Phase 3: Klient — geolokalizacja, sort po odległości, prezentacja

### Overview

Warstwa przeglądarki: util Haversine + formatowanie, przekazanie współrzędnych zagród do klienta,
przycisk zgody z auto-lokalizacją gdy już przyznano, klient-side re-sort ≤100 kart, badge „~X km"
tylko dla lokalizacji precyzyjnej, oraz obsługa odmowy/braku ponawiania i layout shift.

### Changes Required:

#### 1. Util geo (współdzielony, testowalny)

**File**: `src/lib/geo.ts` (nowy)

**Intent**: Czysta funkcja Haversine (km) i formatowanie odległości jako jawnie przybliżonej.

**Contract**: `haversineKm(a: {lat:number; lng:number}, b: {lat:number; lng:number}): number`;
`formatApproxDistance(km: number): string` → „<1 km" dla <1, w przeciwnym razie „~{round(km)} km".
Bez zależności DOM (importowalne i przez `<script>` klienta, i przez vitest).

#### 2. Przekazanie współrzędnych do klienta

**File**: `src/pages/katalog.astro`

**Intent**: Udostępnić skryptowi klienta współrzędne i precyzję każdej karty, w kolejności
renderu, oraz zaktualizować `CatalogRow`/mapowanie o nowe pola.

**Contract**: rozszerzyć interfejs `CatalogRow` (`katalog.astro:45-55`) i `results`
(`:94-103`) o `latitude/longitude/location_precise`. Wstrzyknąć dane per karta w sposób
odczytywalny przez `<script>` (np. `data-*` na `<li>`/karcie albo serializowany JSON w
`<script type="application/json">`), zachowując SSR-ową kolejność jako domyślną. Bez zmian w
zapytaniu RPC args.

#### 3. Karta: badge odległości

**File**: `src/components/katalog/ZagrodaCard.astro`

**Intent**: Miejsce na „~X km" przy linii lokalizacji, wypełniane po sortowaniu po stronie
klienta; pokazywane tylko gdy lokalizacja precyzyjna.

**Contract**: dodać opcjonalny slot/element odległości przy `lokalizacja` (`ZagrodaCard.astro:52`),
domyślnie pusty/ukryty w SSR; wypełniany przez skrypt klienta. Przekazać `location_precise` (i
coords, jeśli potrzebne) do karty jako prop lub `data-*`. Badge NIE renderuje się dla
`location_precise=false` (fallback centroidu — sortuje, ale bez liczby).

#### 4. Sterowanie geolokalizacją + re-sort

**File**: `src/pages/katalog.astro` (blok `<script>`, `:184-204`)

**Intent**: Dodać przycisk „📍 Pokaż najbliżej mnie", obsłużyć zgodę/odmowę/auto, przeliczyć
odległości i przestawić karty w DOM bez utrwalania lokalizacji.

**Contract**:
- Dodać w formularzu/nad listą przycisk/baner „📍 Pokaż najbliżej mnie" (gest użytkownika).
- Na starcie: **feature-detect Permissions API** (`if (navigator.permissions?.query)` w try/catch —
  iOS Safari, główna persona mobilna US-04, historycznie nie wspiera `query` dla `geolocation`;
  może być undefined lub odrzucać). Gdy dostępne: `state==='granted'` → auto-wywołać lokalizację po
  cichu; `'prompt'` → pokazać przycisk; `'denied'` → nie pokazywać prośby (przycisk ukryty/nieaktywny),
  **bez ponawiania**. Gdy Permissions API niedostępne/rzuca → **po prostu pokazać przycisk i pominąć
  auto-locate** (żaden błąd nie może wywrócić inicjalizacji). Ścieżka przycisku (jawny gest →
  `getCurrentPosition`) MUSI działać w pełni bez Permissions API.
- Po zgodzie (`getCurrentPosition`): policzyć `haversineKm` dla kart z coords, posortować węzły
  `<li>` rosnąco (karty bez coords / z `location_precise=false` bez badge; karty bez coords na
  koniec), wpisać `formatApproxDistance` do badge tam gdzie `location_precise`. Re-order przez
  przestawienie istniejących węzłów DOM (bez re-fetchu).
- Współrzędne gościa trzymać wyłącznie w zmiennej JS w zasięgu handlera; **nie** zapisywać do
  URL/cookies/storage. Błąd/`PermissionDenied`: zostawić kolejność SSR, żadnego komunikatu błędu,
  żadnego ponawiania w tej sesji.
- Zachować istniejące handlery (`wojSelect` submit, `osoby` toggle) — sort po odległości jest
  dodatkiem do filtrów (po submit filtra strona renderuje się od nowa; jeśli zgoda już przyznana,
  auto-sort zadziała ponownie na nowej liście).

#### 5. Testy util

**File**: `tests/unit/geo.test.ts` (lub obok, wg konwencji vitest)

**Intent**: Zabezpieczyć poprawność Haversine i formatowania.

**Contract**: (a) znane pary miast → dystans w oczekiwanym zakresie; (b) `formatApproxDistance`:
<1 → „<1 km", zaokrąglanie do km, prefiks „~".

### Success Criteria:

#### Automated Verification:

- Unit testy geo przechodzą: `npm test`
- Build przechodzi (bundling `<script>` z importem `src/lib/geo.ts`): `npm run build`
- Typecheck czysty: `npx astro check`
- Lint czysty: `npm run lint`

#### Manual Verification:

- Grant lokalizacji (DevTools sensors) → lista przestawia się po odległości, najbliższa na górze,
  karty precyzyjne mają „~X km", karty centroidowe bez liczby.
- Deny lokalizacji → katalog dokładnie w kolejności SSR, brak błędu, brak ponownej prośby przy
  odświeżeniu (dopóki stan przeglądarki = denied).
- Ponowna wizyta z już przyznaną zgodą → auto-sort bez dodatkowego tapnięcia.
- Sort współpracuje z filtrami (ustaw województwo/miasto, potem lokalizacja).
- NFR: katalog < 2 s p95 utrzymany (ścieżka odmowy bez dodatkowego narzutu; brak ciężkiego assetu
  po stronie klienta).
- iOS Safari (lub brak Permissions API): przycisk „📍 Pokaż najbliżej mnie" działa przez gest,
  inicjalizacja się nie wywraca, auto-locate po prostu pominięte.

**Implementation Note**: Po tej fazie i automatycznej weryfikacji zatrzymaj się na ręczne
potwierdzenie (grant/deny/auto + filtry + NFR) przed uznaniem zmiany za gotową.

---

## Testing Strategy

### Unit Tests:

- `src/lib/geo.ts`: Haversine (znane dystanse), `formatApproxDistance` (progi „<1 km"/„~N km").

### Integration Tests (DB, `tests/db/`):

- `locality_coords`: trafienie/precyzja, miss→centroid, normalizacja (wielkość liter, diakrytyki,
  „ł", spacje).
- Trigger `zagrody_set_coords`: insert i update `city`/`voivodeship`.
- `catalog_zagrody`: zwraca nowe kolumny, zachowuje filtry/sort/`LIMIT 100`, kompatybilność args.
- Seed/backfill: idempotencja upsertu, poprawność backfillu, centroid dla nieznanych miast.

### Manual Testing Steps:

1. DevTools → Sensors: ustaw lokalizację, wejdź na `/katalog`, tapnij „📍 Pokaż najbliżej mnie",
   zaakceptuj → sprawdź kolejność i badge.
2. Zmień lokalizację i powtórz — kolejność się zmienia (brak utrwalania poprzedniej).
3. Odmów zgody → katalog w kolejności SSR, brak błędu; odśwież → brak ponownej prośby.
4. Z przyznaną zgodą wejdź ponownie → auto-sort.
5. Ustaw filtr województwo/miasto + lokalizacja → sort działa na przefiltrowanej liście.
6. Zagroda z nieznanym miastem (centroid) → sortuje się, ale bez „~X km".

### E2E (opcjonalnie, przez `/10x-e2e`):

- Playwright z `context.grantPermissions(['geolocation'])` + `setGeolocation` — happy path sortu i
  ścieżka odmowy. Ryzyko genuinie przeglądarkowe (permission prompt, re-order DOM). Poza zakresem
  tego planu implementacyjnego; kandydat do osobnej sesji E2E.

## Performance Considerations

- Odległość liczona po stronie klienta na ≤100 wierszach (Haversine ~sub-ms) — brak round-tripu,
  brak wpływu na p95 ścieżki serwerowej.
- Ścieżka odmowy nie dokłada żadnego narzutu (brak ciężkiego assetu po stronie klienta — słownik
  został w DB, do przeglądarki lecą tylko coords już obecnych ≤100 kart).
- `LIMIT 100`: sort w obrębie zwróconej strony; przy obecnej skali = sort globalny. Gdy katalog
  przekroczy 100 — rewizja (np. distance-order w RPC z coords gościa) w osobnej zmianie.

## Migration Notes

- Migracja addytywna: nowe kolumny nullable + `location_precise` z `default false`, nowe tabele,
  RPC drop+recreate z tą samą sygnaturą argumentów (stary worker w oknie deployu ignoruje nowe
  kolumny). Zgodne z regułą `lessons.md:12-17`.
- Kolejność deployu: `db:push` (migracja) → `npm run db:seed-localities` (słownik + backfill) →
  `wrangler deploy`. Lokalnie po `db:reset` uruchomić seed. Seed/backfill idempotentne.
- `voivodeship_centroids` seedowane inline w migracji (16 wierszy). `localities` seedowane
  skryptem (duży dataset — poza migracją, by nie puchła i by trzymać się limitu Workera).

## References

- Research: `context/changes/nearest-zagrody-sort/research.md`
- Katalog SSR + RPC call: `src/pages/katalog.astro:90,94-103,184-204`
- Karta: `src/components/katalog/ZagrodaCard.astro:52`
- RPC bazowa: `supabase/migrations/20260719100000_manual_bookings_and_day_blocks.sql:407-466`
- Profil/publikacja/RLS/trigger: `supabase/migrations/20260605200000_zagroda_profile_publication.sql:10-27,32-37,100-104,112-180,191-197`
- Walidacja/enum: `src/lib/zagroda.ts:5,33`
- Reguła deployu: `context/foundation/lessons.md:12-17`
- PRD: `context/foundation/prd-v2.md` (FR-020:115, FR-030:146, US-04:88-101, NFR:170-173)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Warstwa danych współrzędnych (migracja DB)

#### Automated

- [x] 1.1 Migracja aplikuje się czysto: `npm run db:reset` — 3135c61
- [x] 1.2 Typy regenerują się bez rozjazdu: `npm run db:types` — 3135c61
- [x] 1.3 Testy DB przechodzą: `npm test` — 3135c61
- [x] 1.4 Typecheck czysty: `npx astro check` — 3135c61
- [x] 1.5 Lint czysty: `npm run lint` — 3135c61

#### Manual

- [x] 1.6 Publikacja/edycja z realnym miastem → `location_precise=true` i sensowne coords; nieznane miasto → centroid + `false` — 3135c61
- [x] 1.7 Stary kształt zapytania katalogu nadal zwraca wyniki (kompatybilność wsteczna RPC) — 3135c61
- [x] 1.8 Regresja: `catalog.test.ts` i `day-blocks.test.ts` zielone po drop+recreate RPC i triggerze — 3135c61

### Phase 2: Dataset miejscowości + seed i backfill

#### Automated

- [x] 2.1 Skrypt idempotentny: `npm run db:seed-localities` (dwa razy — ten sam stan)
- [x] 2.2 Testy przechodzą: `npm test`
- [x] 2.3 Lint/typecheck czyste: `npm run lint`, `npx astro check`

#### Manual

- [x] 2.4 Match-rate ≥ 90% opublikowanych zagród (`location_precise=true`); poniżej progu — remediacja przed Fazą 3
- [x] 2.5 Spot-check kilku zagród: coords wskazują właściwą miejscowość

### Phase 3: Klient — geolokalizacja, sort po odległości, prezentacja

#### Automated

- [ ] 3.1 Unit testy geo przechodzą: `npm test`
- [ ] 3.2 Build przechodzi (bundling `<script>` z importem `src/lib/geo.ts`): `npm run build`
- [ ] 3.3 Typecheck czysty: `npx astro check`
- [ ] 3.4 Lint czysty: `npm run lint`

#### Manual

- [ ] 3.5 Grant → lista przestawia się po odległości; precyzyjne karty mają „~X km", centroidowe bez liczby
- [ ] 3.6 Deny → kolejność SSR, brak błędu, brak ponawiania przy odświeżeniu
- [ ] 3.7 Ponowna wizyta z przyznaną zgodą → auto-sort bez dodatkowego tapnięcia
- [ ] 3.8 Sort współpracuje z filtrami województwo/miasto
- [ ] 3.9 NFR: katalog < 2 s p95 utrzymany
- [ ] 3.10 iOS Safari / brak Permissions API: przycisk działa przez gest, init się nie wywraca, auto-locate pominięte
