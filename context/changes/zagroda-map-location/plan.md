# Map-picker lokalizacji zagrody (Leaflet/OSM) Implementation Plan

## Overview

Właściciel staje się źródłem prawdy o lokalizacji swojej zagrody: przypina dokładny punkt na
mapie Leaflet/OSM w formularzu. Współrzędne zapisywane per zagroda z flagą `location_source =
'manual'`, która ma precedencję nad współrzędnymi wyprowadzanymi z nazwy miejscowości (słownik
PRNG, S-10). Rozwiązuje problem dwuznacznych nazw miejscowości w sortowaniu „najbliżej mnie" i
dodaje interaktywną mapę na stronie szczegółów zagrody. Bez klucza API/billingu.

## Current State Analysis

- **Coords są dziś czysto pochodne.** `public.zagrody` ma `latitude/longitude/location_precise`
  ustawiane BEZWARUNKOWO przez trigger `zagrody_set_coords`
  (`supabase/migrations/20260720120000_zagroda_coordinates.sql:138-162`) z
  `locality_coords(voivodeship, city)` przy insert i przy update `city`/`voivodeship`. Drugi
  writer: seed `backfillZagrody` (`scripts/seed-localities.ts:182-203`) — też bezwarunkowo.
- **Brak dyskryminatora manual/auto** — grep nie znajduje `location_source`/`coords_manual`.
- **Write path właściciela to allowlist 5 kolumn** (`src/pages/api/zagroda/index.ts:36-52`) po
  walidacji `zagrodaProfileSchema` (`src/lib/zagroda.ts:29-40`, brak lat/lng). Form
  (`src/components/zagroda/ZagrodaProfileForm.tsx`) nie ma pola lokalizacji. RLS UPDATE jest
  tylko row-level (`20260605090307_domain_schema.sql:83-86`) — NIE chroni kolumn coords.
- **Read-side katalogu jest gotowy.** RPC `catalog_zagrody` już zwraca lat/lng/location_precise
  (`src/db/database.types.ts:338-340`); sort i badge „~X km" w `katalog.astro`/`ZagrodaCard.astro`
  są gated na `location_precise`. Manualny precyzyjny pin przepływa BEZ zmian read-side.
- **Detail page** (`src/pages/zagrody/[id].astro:28-33`) nie selektuje coords (dodanie = 1 linia).
- **Brak CSP** gdziekolwiek → zewnętrzne kafelki OSM i skrypt mapy ładują się bez zmian nagłówków.
  Islandy `client:load`/`client:idle` idiomatyczne; ani `leaflet` ani `maplibre-gl` nie są depsem.

### Key Discoveries:

- Manualny pin z `location_precise=true` uczestniczy w sorcie i badge katalogu bez żadnej zmiany
  RPC ani klienta (frame Hypothesis table) — cała praca jest po stronie zapisu i prezentacji.
- Klobrowanie jest w DWÓCH miejscach: trigger (`...20260720120000...sql:152-154`) i seed
  (`scripts/seed-localities.ts:190-197`). Oba muszą honorować `location_source`.
- Leaflet odwołuje się do `window` przy imporcie → island mapy MUSI być `client:only="react"`
  (SSR wysypałby się). Dodatkowo domyślne ikony markera Leaflet mają zepsute ścieżki pod
  bundlerem — trzeba jawnie ustawić `iconUrl`/`iconRetinaUrl`/`shadowUrl` z importów.

## Desired End State

- W formularzu zagrody właściciel widzi mapę wycentrowaną na współrzędnych z nazwy miasta i może
  przeciągnąć marker do dokładnego miejsca; zapis ustawia `location_source='manual'`,
  `location_precise=true`. Przycisk „Użyj lokalizacji miasta" czyści pin (powrót do `auto` →
  ponowna derywacja z nazwy).
- Edycja miasta zagrody z manualnym pinem NIE nadpisuje pinu; ponowny seed/backfill też nie.
- Katalog „najbliżej mnie" pokazuje poprawne „~X km" i kolejność dla zagród z manualnym pinem —
  bez zmian w RPC/kliencie.
- Strona szczegółów zagrody pokazuje interaktywną mapę z markerem w lokalizacji zagrody +
  atrybucja „© OpenStreetMap contributors".
- Weryfikacja: `npm test` (DB + unit) zielone; `npm run build`/`astro check`/`lint` czyste;
  ręcznie — pin/edycja miasta/revert + mapa na detalu.

## What We're NOT Doing

- Bez zewnętrznego geokodowania/wyszukiwarki adresu (Nominatim) — start mapy na coords z nazwy
  wystarcza; można dołożyć w osobnej zmianie.
- Bez zmian read-side katalogu (RPC, sort, badge) — działa jak jest.
- Bez usuwania słownika PRNG / logiki S-10 — pozostaje fallbackiem dla zagród bez pinu.
- Bez MapLibre/wektorów — Leaflet + raster OSM.
- Bez e2e interakcji mapy w tym planie — przeciąganie pinu weryfikowane manualnie; automatyczne
  e2e (Playwright) kandydatem do osobnej sesji `/10x-e2e`.
- Bez nowej polityki RLS — kolumny coords są już zapisywalne przez ownera (row-level policy).

## Implementation Approach

Backend-first, trzy fazy (wzorzec S-10). Najpierw precedencja w DB (kolumna + trigger + guard
seeda) — addytywna, deployowalna niezależnie, stary worker kompatybilny (nie wysyła
`location_source` → default `'auto'` → zachowanie jak dziś). Potem input właściciela (dep +
walidacja + API + island pickera). Na końcu prezentacja publiczna (embed mapy) i odwrócenie
non-goali w dokumentach.

## Critical Implementation Details

- **Trigger musi reagować też na zmianę `location_source`.** Rozszerzyć `of city, voivodeship` o
  `location_source`, by powrót `manual→auto` wyzwolił ponowną derywację. Gałąź `manual`:
  zostawia `new.latitude/longitude`, ustawia `location_precise=true`, nie woła resolvera. Gałąź
  `auto`: derywacja jak dziś. Bez tego revert do auto zostawiłby nieaktualny pin.
- **Leaflet = `client:only="react"`.** Import Leaflet dotyka `window`; SSR island wysypie build/
  runtime. Ikony markera: ustawić jawnie z importów assetów (znany bug ścieżek Leaflet pod Vite).
- **OSM tile usage policy.** Niski wolumen, wymagana atrybucja „© OpenStreetMap contributors" na
  każdej mapie (picker i embed). Bez własnego proxy kafelków.
- **Deploy addytywny.** Kolumna `location_source` z `default 'auto'` + rekreacja funkcji triggera;
  stary worker w oknie deployu nie wysyła kolumny → default → OK. Seed guard sprawia, że
  `db:seed-localities` przy deployu nie tknie manualnych zagród. Zgodne z regułą `lessons.md`.

## Phase 1: Precedencja w DB (location_source)

### Overview

Addytywna migracja: kolumna-dyskryminator, przebudowa triggera na gałąź manual/auto, guard w
seed-backfillu, regeneracja typów. Read-side katalogu bez zmian.

### Changes Required:

#### 1. Migracja: kolumna + trigger

**File**: `supabase/migrations/<timestamp>_zagroda_location_source.sql` (nowa)

**Intent**: Wprowadzić flagę źródła współrzędnych i sprawić, by trigger honorował manualny pin
zamiast go nadpisywać. Addytywnie i wstecznie kompatybilnie.

**Contract**:
- `alter table public.zagrody add column location_source text not null default 'auto'` +
  `check (location_source in ('auto','manual'))` + `check (location_source = 'auto' or (latitude
  is not null and longitude is not null))` (manual wymaga coords).
- `create or replace function public.zagrody_set_coords()` — gałąź: gdy
  `new.location_source = 'manual'` → `new.location_precise := true`, zostaw `new.latitude/longitude`,
  `return new` (bez wołania resolvera); w przeciwnym razie derywacja z `locality_coords(new.voivodeship,
  new.city)` jak dziś (zero-row-safety bez zmian). `set search_path = ''`, schema-kwalifikowane
  wywołania (bez regresu względem `20260720120000`).
- `drop trigger zagrody_set_coords on public.zagrody;` + `create trigger zagrody_set_coords before
  insert or update of city, voivodeship, location_source on public.zagrody for each row execute
  function public.zagrody_set_coords();` (dodane `location_source` w liście `of`).

#### 2. Guard w seed-backfillu

**File**: `scripts/seed-localities.ts`

**Intent**: Backfill z nazwy nie może nadpisywać manualnych pinów przy re-seedzie (deploy).

**Contract**: w `backfillZagrody` (`:169-181`) dodać warunek `and zz.location_source <> 'manual'`
do podzapytania (obok `zz.voivodeship is not null`). Idempotencja i reszta bez zmian.

#### 3. Regeneracja typów

**File**: `src/db/database.types.ts` (generowany)

**Intent**: Uwzględnić `location_source` w wierszu `zagrody`.

**Contract**: `npm run db:types` po `db:reset`. Bez ręcznej edycji.

#### 4. Testy DB precedencji

**File**: `tests/db/zagroda-location-source.test.ts` (nowy; wzorzec `tests/db/*.test.ts`)

**Intent**: Zabezpieczyć precedencję i powrót do auto.

**Contract**: (a) zagroda z `location_source='manual'` + coords — update `city` NIE zmienia
lat/lng; (b) ustawienie `location_source='auto'` (bez zmiany miasta) → trigger re-derywuje z
nazwy; (c) `backfillZagrody` pomija manualne, aktualizuje auto; (d) regresja: insert/update auto
derywuje jak w S-10 (centroid dla nieznanego miasta, precyzyjne dla znanego).

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `npm run db:reset`
- Typy bez rozjazdu: `npm run db:types`
- Testy DB przechodzą: `npm test`
- Typecheck czysty: `npx astro check`
- Lint czysty: `npm run lint`

#### Manual Verification:

- Studio: zagroda z manualnymi coords + `location_source='manual'` — zmiana `city` zostawia
  coords; ustawienie `location_source='auto'` przywraca derywację z nazwy.
- Istniejące suity S-10 (`zagroda-coordinates`, `localities-seed`, `catalog`) zielone.

**Implementation Note**: Po tej fazie i przejściu automatycznej weryfikacji zatrzymaj się na
ręczne potwierdzenie przed Fazą 2.

---

## Phase 2: Map-picker w formularzu właściciela

### Overview

Nowa zależność Leaflet, rozszerzenie walidacji i API o współrzędne, island map-pickera w
formularzu profilu z markerem startującym na coords z nazwy i możliwością powrotu do lokalizacji
miasta.

### Changes Required:

#### 1. Zależność mapy

**File**: `package.json`

**Intent**: Dodać Leaflet (klient) + typy.

**Contract**: `leaflet` + `@types/leaflet` w dependencies/devDependencies. Ląduje w bundlu
klienta (nie Workera).

#### 2. Walidacja współrzędnych

**File**: `src/lib/zagroda.ts`

**Intent**: Przyjąć opcjonalne coords z formularza; source wyprowadza API.

**Contract**: rozszerzyć `zagrodaProfileSchema` (`:29-40`) o `latitude: z.number().min(-90).max(90).nullable()`,
`longitude: z.number().min(-180).max(180).nullable()` + refine „oba albo żadne". `ZagrodaProfileInput`
(z.infer) niesie je automatycznie.

#### 3. Write path

**File**: `src/pages/api/zagroda/index.ts`

**Intent**: Utrwalić coords właściciela i ustawić `location_source`.

**Contract**: rozszerzyć obiekt `profile` (`:36-42`) o `latitude`, `longitude`, `location_source`.
`location_source = (latitude != null && longitude != null) ? 'manual' : 'auto'`. Upsert bez zmian
poza tym (trigger domknie precyzję/derywację wg gałęzi). Uwaga: przy `auto` przekazać
`latitude/longitude` jako to co przyjdzie — trigger i tak nadpisze z nazwy.

#### 4. Island map-picker

**File**: `src/components/zagroda/MapPicker.tsx` (nowy)

**Intent**: Interaktywny wybór punktu; marker przeciągalny; czysta funkcja onChange do formularza.

**Contract**: props `{ latitude: number|null; longitude: number|null; fallback: {lat;lng}|null;
onChange: (c: {lat;lng}|null) => void }`. Renderuje Leaflet z markerem draggable; klik na mapie/
drag ustawia coords; przycisk „Użyj lokalizacji miasta" → `onChange(null)`. Start: `latitude/longitude`
jeśli są, inaczej `fallback` (coords z nazwy), inaczej centroid PL. Atrybucja OSM. Montowany
`client:only="react"`; ikony markera ustawione z importów (patrz Critical Implementation Details).

#### 5. Podpięcie w formularzu

**File**: `src/components/zagroda/ZagrodaProfileForm.tsx`, `src/pages/dashboard.astro`

**Intent**: Stan lat/lng + mapa w formularzu; przekazać bieżące coords jako initialData.

**Contract**: dodać `latitude/longitude` do stanu i `payload` (`:78`); zamontować `<MapPicker>`;
`dashboard.astro:55` przekazuje bieżące `latitude/longitude` zagrody do `initialData` (rozszerzyć
select ładujący profil o te kolumny). `fallback` = coords z nazwy (możliwe do policzenia po
stronie serwera z obecnego wiersza).

#### 6. Testy jednostkowe

**File**: `tests/unit/zagroda-schema.test.ts` (nowy lub dołączony do istniejących)

**Intent**: Zabezpieczyć walidację coords.

**Contract**: lat/lng w zakresie akceptowane; poza zakresem odrzucone; „jedno z dwóch" odrzucone;
oba null akceptowane.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe: `npm test`
- Build (bundling Leaflet + island): `npm run build`
- Typecheck czysty: `npx astro check`
- Lint czysty: `npm run lint`

#### Manual Verification:

- Przeciągnięcie pinu i zapis → reload pokazuje pin; `location_source='manual'`.
- „Użyj lokalizacji miasta" → pin znika, powrót do derywacji z nazwy.
- Katalog: zagroda z pinem pokazuje precyzyjne „~X km" i poprawną kolejność.
- Edycja miasta przy ustawionym pinie nie przesuwa pinu.

**Implementation Note**: Po tej fazie i automatycznej weryfikacji zatrzymaj się na ręczne
potwierdzenie przed Fazą 3.

---

## Phase 3: Embed mapy na stronie zagrody + odwrócenie non-goali

### Overview

Interaktywna mapa (read-only) na stronie szczegółów zagrody, współdzielony komponent bazowy z
pickerem, oraz aktualizacja dokumentów o świadomym zniesieniu non-goali.

### Changes Required:

#### 1. Współdzielony komponent mapy

**File**: `src/components/zagroda/MapPicker.tsx` → wydzielić bazę, lub nowy `ZagrodaMapView.tsx`

**Intent**: Read-only widok mapy z markerem, reużywający konfiguracji kafelków/atrybucji/ikon.

**Contract**: tryb `readonly` (marker nieprzeciągalny, brak onChange) lub osobny lekki komponent.
Props `{ latitude; longitude }`. Atrybucja OSM.

#### 2. Detal zagrody

**File**: `src/pages/zagrody/[id].astro`

**Intent**: Wczytać coords i pokazać mapę, gdy są.

**Contract**: dodać `latitude, longitude` do selectu (`:30`) i do interfejsu `ZagrodaProfile`
(`:11-19`); wyrenderować island mapy (`client:visible`) po linii lokalizacji (`:81`) tylko gdy
coords obecne. Bez mapy dla zagród bez coords.

#### 3. Odwrócenie non-goali w dokumentach

**File**: `context/foundation/roadmap.md`, `context/foundation/prd-v2.md`

**Intent**: Zapisać świadomą decyzję v2 znoszącą „Mapa w UI" i „zero nowych pól właściciela".

**Contract**: w `roadmap.md:155` (Mapa w UI) i sekcji Non-Goals PRD dopisać, że ograniczenie jest
zniesione w v2 przez zmianę `zagroda-map-location` (data + odniesienie). Bez przepisywania całości.

### Success Criteria:

#### Automated Verification:

- Build: `npm run build`
- Typecheck czysty: `npx astro check`
- Lint czysty: `npm run lint`
- Testy przechodzą: `npm test`

#### Manual Verification:

- Strona zagrody z coords pokazuje mapę z markerem w właściwym miejscu; atrybucja widoczna.
- Zagroda bez coords: brak mapy, brak błędu w konsoli.
- NFR: strona szczegółów ładuje się płynnie (mapa leniwie hydratowana, nie blokuje treści).

**Implementation Note**: Po tej fazie i automatycznej weryfikacji zatrzymaj się na ręczne
potwierdzenie przed uznaniem zmiany za gotową.

---

## Testing Strategy

### Unit Tests:

- `zagrodaProfileSchema`: zakresy lat/lng, „oba albo żadne", oba null.

### Integration Tests (DB, `tests/db/`):

- Precedencja: manual przeżywa update miasta; auto derywuje; revert manual→auto re-derywuje.
- Seed backfill pomija manualne, aktualizuje auto.
- Regresja S-10: derywacja auto niezmieniona.

### Manual Testing Steps:

1. Dashboard → formularz: przeciągnij pin, zapisz → reload pokazuje pin.
2. Zmień miasto zagrody → pin nie drgnął.
3. „Użyj lokalizacji miasta" → pin znika, coords wracają do derywacji z nazwy.
4. Katalog + geolokalizacja: zagroda z pinem ma precyzyjne „~X km" i poprawną pozycję.
5. Strona zagrody: mapa z markerem we właściwym miejscu; atrybucja OSM.

### E2E (opcjonalnie, przez `/10x-e2e`):

- Playwright: happy-path przypięcia i zapisu pinu (interakcja Leaflet). Poza zakresem tego planu.

## Performance Considerations

- Leaflet + kafelki ładują się w bundlu klienta (nie Worker) i leniwie (`client:only`/`client:visible`),
  więc nie dokładają do CPU/rozmiaru Workera ani nie blokują treści strony.
- Read-side katalogu bez zmian → NFR katalog < 2 s p95 utrzymany.

## Migration Notes

- Migracja addytywna: `location_source` z `default 'auto'` + rekreacja funkcji/triggera (te same
  argumenty, kompatybilne wstecz — stary worker nie wysyła kolumny). Zgodne z regułą `lessons.md`.
- Kolejność deployu bez zmian: `db:push` → `db:seed-localities` (teraz z guardem manual) →
  `wrangler deploy`. Seed nie tknie manualnych pinów.
- Nowa zależność `leaflet` — tylko klient; brak zmian CSP (CSP nie istnieje).

## References

- Frame: `context/changes/zagroda-map-location/frame.md`
- Trigger + RPC + kolumny S-10: `supabase/migrations/20260720120000_zagroda_coordinates.sql:20-23,138-162,171-238`
- Seed backfill: `scripts/seed-localities.ts:169-203`
- Form / schema / API: `src/components/zagroda/ZagrodaProfileForm.tsx:53-121`, `src/lib/zagroda.ts:29-40`, `src/pages/api/zagroda/index.ts:36-52`
- Katalog consumer (bez zmian): `src/pages/katalog.astro:108-110,266-283`, `src/components/katalog/ZagrodaCard.astro:42,53-55,82`
- Detal: `src/pages/zagrody/[id].astro:28-33,71-111`; island pattern: `dashboard.astro:55`
- Non-goale: `context/foundation/roadmap.md:155`, `context/foundation/prd-v2.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Precedencja w DB (location_source)

#### Automated

- [x] 1.1 Migracja aplikuje się czysto: `npm run db:reset` — d5dda06
- [x] 1.2 Typy bez rozjazdu: `npm run db:types` — d5dda06
- [x] 1.3 Testy DB przechodzą: `npm test` — d5dda06
- [x] 1.4 Typecheck czysty: `npx astro check` — d5dda06
- [x] 1.5 Lint czysty: `npm run lint` — d5dda06

#### Manual

- [x] 1.6 Studio: manual przeżywa zmianę miasta; auto przywraca derywację — d5dda06
- [x] 1.7 Suity S-10 (`zagroda-coordinates`, `localities-seed`, `catalog`) zielone — d5dda06

### Phase 2: Map-picker w formularzu właściciela

#### Automated

- [x] 2.1 Testy jednostkowe: `npm test` — f1638af
- [x] 2.2 Build (bundling Leaflet + island): `npm run build` — f1638af
- [x] 2.3 Typecheck czysty: `npx astro check` — f1638af
- [x] 2.4 Lint czysty: `npm run lint` — f1638af

#### Manual

- [x] 2.5 Przeciągnięcie pinu + zapis → reload pokazuje pin; `location_source='manual'` — f1638af
- [x] 2.6 „Użyj lokalizacji miasta" → pin znika, powrót do derywacji z nazwy — f1638af
- [x] 2.7 Katalog: zagroda z pinem ma precyzyjne „~X km" i poprawną kolejność — f1638af
- [x] 2.8 Edycja miasta przy pinie nie przesuwa pinu — f1638af

### Phase 3: Embed mapy na stronie zagrody + odwrócenie non-goali

#### Automated

- [x] 3.1 Build: `npm run build` — f356209
- [x] 3.2 Typecheck czysty: `npx astro check` — f356209
- [x] 3.3 Lint czysty: `npm run lint` — f356209
- [x] 3.4 Testy przechodzą: `npm test` — f356209

#### Manual

- [x] 3.5 Strona zagrody z coords pokazuje mapę z markerem we właściwym miejscu + atrybucja — f356209
- [x] 3.6 Zagroda bez coords: brak mapy, brak błędu w konsoli — f356209
- [x] 3.7 NFR: strona szczegółów ładuje się płynnie (mapa leniwie hydratowana) — f356209
