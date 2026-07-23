# Najbliższe zagrody — sortowanie po odległości (S-10) — Plan Brief

> Full plan: `context/changes/nearest-zagrody-sort/plan.md`
> Research: `context/changes/nearest-zagrody-sort/research.md`

## What & Why

Gość, który udostępni lokalizację urządzenia, widzi katalog posortowany rosnąco po odległości od
siebie, z przybliżoną odległością (poziom miejscowości) na karcie; odmowa zostawia katalog dokładnie
w obecnym kształcie (filtry województwo/miasto), bez błędów i bez ponawiania prośby, a lokalizacja
gościa nie jest utrwalana. To najmocniej akcentowany pomysł właściciela („strona WWW sieci tego nie
ma") i razem z S-09 domyka kryterium sukcesu #2 (max 2 interakcje od strony głównej do katalogu od
najbliższych). FR-020, FR-030, US-04.

## Starting Point

Katalog (`src/pages/katalog.astro`) jest w 100% SSR: RPC `catalog_zagrody` → statyczne
`ZagrodaCard.astro`, filtry przez URL params aplikowane serwerowo, sort `is_available/created_at`,
twardy `LIMIT 100`. `zagrody` ma tylko `voivodeship` (enum) i `city` (free text) — zero danych
geograficznych, zero kodu geolokalizacji. Distance jest niemożliwy bez nowego źródła współrzędnych.

## Desired End State

Każda opublikowana zagroda ma współrzędne na poziomie miejscowości (wyznaczone z `city`+`voivodeship`,
bez działania właściciela). Na `/katalog` przycisk „📍 Pokaż najbliżej mnie" (auto, gdy zgoda już
przyznana) przestawia ≤100 kart po odległości i pokazuje „~X km" na kartach z lokalizacją precyzyjną.
Odległość liczona wyłącznie po stronie klienta — lokalizacja gościa nigdy nie opuszcza urządzenia.

## Key Decisions Made

| Decision                         | Choice                                             | Why (1 sentence)                                                                 | Source   |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| Źródło współrzędnych             | Lokalny słownik TERYT/SIMC (server-side)           | Deterministyczny, bez zależności runtime/rate-limitów, pełne pokrycie wsi        | Plan     |
| Umiejscowienie słownika          | Tabela `localities` w Postgres (nie bundle Workera)| Dataset wsi to dziesiątki tys. wierszy — trzymamy poza limitem rozmiaru Workera  | Plan     |
| Przechowywanie coords            | Kolumny `latitude`/`longitude`/`location_precise`  | Rozwiąż raz, katalog tylko czyta; migracja addytywna                             | Plan     |
| Uzupełnianie coords              | Trigger na `zagrody` + jednorazowy backfill        | Nowe/edytowane automatycznie; istniejące jednym idempotentnym UPDATE            | Plan     |
| Liczenie odległości              | Client-side Haversine                              | Lokalizacja gościa nie trafia na serwer (nieutrwalanie), zero round-tripu        | Plan     |
| UX prośby o lokalizację          | Przycisk + auto gdy już przyznano (Permissions API)| Gest wymagany przez przeglądarki, czyste „bez ponawiania" przy odmowie           | Plan     |
| Fallback nietrafionego miasta    | Centroid województwa do sortu, bez liczby km       | Zagroda uczestniczy w sorcie, produkt nie sugeruje odległości której nie zna     | Plan     |
| `LIMIT 100`                      | Zostaw — sort w obrębie strony                      | Przy <100 opublikowanych = sort globalny; zero zmian w zapytaniu                 | Plan     |
| Format odległości                | „~12 km" zaokrąglone do km (<1 km dla bliskich)     | Jawnie przybliżone, spójne z poziomem miejscowości, bez sugestii precyzji GPS    | Plan     |

## Scope

**In scope:** kolumny coords + `location_precise` na `zagrody`; tabele `localities` + centroidy;
funkcja-resolver + trigger; przebudowa RPC (drop+recreate) o coords; dataset + seed/backfill; util
Haversine + format; przycisk geolokalizacji + client re-sort + badge na karcie.

**Out of scope:** mapa/GPS UI; nowe pola właściciela / ręczna lokalizacja; server-side liczenie
odległości; wysyłanie lokalizacji gościa na serwer; zmiana landingu; podnoszenie `LIMIT 100`;
utrwalanie lokalizacji (storage/cookie/URL).

## Architecture / Approach

Backend-first. DB rozwiązuje `city`+`voivodeship` → coords (słownik `localities` + centroid
fallback, funkcja `locality_coords`, trigger na `zagrody`); RPC `catalog_zagrody` dorzuca
`latitude/longitude/location_precise` do wyniku. Klient dostaje coords w SSR-owym HTML; po zgodzie
na geolokalizację skrypt liczy Haversine, przestawia węzły `<li>` i wpisuje „~X km" na kartach
precyzyjnych. Ścieżka odmowy = kolejność SSR bez zmian.

## Phases at a Glance

| Phase                                   | What it delivers                                              | Key risk                                                        |
| --------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 1. Warstwa danych (migracja DB)         | Kolumny coords, słownik/centroidy, resolver, trigger, RPC     | RPC drop+recreate + re-grant; poprawna normalizacja („ł")      |
| 2. Dataset + seed & backfill            | `localities` załadowane, coords istniejących zagród           | Match-rate free-textu `city`; kolejność seed→backfill          |
| 3. Klient: geolokalizacja + sort + card | Przycisk zgody, client Haversine re-sort, badge „~X km"       | Layout shift; „bez ponawiania"/odmowa; NFR < 2 s p95           |

**Prerequisites:** dostęp do publicznego datasetu miejscowości z lat/lng (GUGiK PRNG / TERYT SIMC);
środowisko DB (`db:reset`/`db:push`) i możliwość uruchomienia skryptu seed na prod.
**Estimated effort:** ~3 sesje (po jednej na fazę).

## Open Risks & Assumptions

- Match-rate zależy od jakości free-textu `city` — literówki i wsie spoza datasetu spadają do
  centroidu (sortują, bez liczby). Zakładamy wysokie pokrycie z pełnego rejestru miejscowości.
- Rozmiar datasetu w DB jest nieproblematyczny dla Postgresa; koszt to jednorazowy seed per env.
- `LIMIT 100` = sort w obrębie strony; poprawne dopóki katalog < 100 opublikowanych.
- Layout shift po re-sorcie akceptowalny; ścieżka odmowy nie regresuje obecnego UX.

## Success Criteria (Summary)

- Grant lokalizacji → katalog od najbliższej zagrody z „~X km" na kartach precyzyjnych.
- Odmowa → katalog dokładnie jak dziś, bez błędu i bez ponawiania; auto-sort przy już przyznanej zgodzie.
- Lokalizacja gościa nigdzie nieutrwalana; katalog < 2 s p95 utrzymany.
