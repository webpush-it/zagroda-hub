# Frame Brief: Map-picker lokalizacji zagrody (Leaflet/OSM)

> Framing step before /10x-plan. Captures what is *actually* at issue, separated
> from what was initially assumed.

## Reported Observation

Sortowanie „najbliżej mnie" (S-10) bywa błędne dla dwuznacznych nazw miejscowości;
po fixie honest-fallback ~12% nazw spada do centroidu województwa (sortują zgrubnie,
bez „~X km"). Właściciel nie ma żadnego sposobu, by jego zagroda miała dokładną
lokalizację i poprawną odległość. Dodatkowo: brak mapy na stronie zagrody.

## Initial Framing (preserved)

- **User's stated cause or approach**: Brak dokładnych coords per-zagroda — źródłem
  jest słownik nazw (PRNG), nie właściciel. Rozwiązanie: map-picker (Leaflet/OSM),
  właściciel przypina punkt; coords per-zagroda z precedencją nad tymi z nazwy; embed
  mapy na stronie zagrody.
- **User's proposed direction**: Zbudować map-picker (Leaflet/MapLibre + OSM, bez klucza).
- **Pre-dispatch narrowing**: rdzeń = input-accuracy i map-embed **równorzędnie**;
  metoda wprowadzania (pin) **do zbadania** (alternatywy dozwolone); zakres = input + embed
  **razem** w jednej zmianie.

## Dimension Map

1. **Input method (design space)** — pin-on-map / geocode-from-address / postal code /
   confirm-suggested-locality. ← oś, którą kazano zbadać
2. **Coords precedence & trigger** — `zagrody_set_coords` nadpisuje coords z nazwy. ← ryzyko z framingu
3. **Owner form + write path** — form → schema → `PUT /api/zagroda` (allowlist) → DB.
4. **Detail embed + catalog consumption** — mapa na stronie zagrody; katalog już czyta coords.
5. **Provider / dependency** — Leaflet vs MapLibre, OSM tiles, Astro island, CSP.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Input: pin jest właściwą metodą (vs geocode/postal/confirm) | Mapa-embed chciana i tak → komponent istnieje niezależnie → pin reużywa go (input+embed jeden island). Zagrody wiejskie często bez dokładnego adresu → geocode zawodny, kod pocztowy zbyt gruby, confirm-locality naprawia tylko dwuznaczność, nie precyzję, i wymaga wskrzeszenia usuniętych duplikatów. | STRONG (confirm) |
| Precedence: trigger klobruje manualne coords | `zagrody_set_coords` (`20260720120000_...sql:138-162`) BEZWARUNKOWO nadpisuje lat/lng/location_precise przy insert i przy update `city`/`voivodeship`. Seed `backfillZagrody` (`seed-localities.ts:182-203`) też — bez guardu. Brak jakiejkolwiek kolumny-dyskryminatora. | STRONG |
| Write path: coords blokowane, ale nie przez RLS | Form (`ZagrodaProfileForm.tsx`) nie ma pola coords; `zagrodaProfileSchema` (`lib/zagroda.ts:29-40`) nie ma lat/lng (zod obcina); `PUT /api/zagroda` (`api/zagroda/index.ts:36-52`) pisze allowlist 5 kolumn. RLS UPDATE (`domain_schema.sql:83-86`) jest tylko row-level — NIE chroni kolumn coords. | STRONG |
| Read-side (katalog + detail) wymaga zmian | Katalog: RPC `catalog_zagrody` już zwraca lat/lng/location_precise (`database.types.ts:338-340`); `ZagrodaCard`/`katalog.astro` już sortują i pokazują badge gated na `location_precise`. Manualny precyzyjny pin **przepływa bez żadnej zmiany read-side**. Detail (`zagrody/[id].astro:30`) nie selektuje coords — dodanie to 1 linia. | STRONG (prawie żadna zmiana) |
| Provider: Leaflet+OSM wykonalny w stacku | Brak CSP gdziekolwiek (`middleware.ts`, `Layout.astro`, `wrangler.jsonc`, `_headers`) → zewnętrzne kafelki/CDN ładują się bez zmian. Islandy `client:load` idiomatyczne (`BookingRequestForm`, `ZagrodaProfileForm`). Ani leaflet ani maplibre-gl nie są depsem → nowy dep. Leaflet ~40KB gz vs MapLibre ~200KB+ → Leaflet lżejszy, ląduje w bundlu klienta (nie Worker). | STRONG |

## Narrowing Signals

- Read-side katalogu jest czystym konsumentem `location_precise`/lat/lng → **naprawa sortu jest automatyczna**, gdy tylko coords staną się owner-authoritative. Cała praktyczna praca to write-side.
- Klobrowanie jest w DWÓCH miejscach (trigger + seed backfill) — oba muszą honorować flagę manualną, inaczej re-seed przy deployu skasuje piny.
- Brak CSP → provider map to wybór bundla/UX, nie bezpieczeństwa.

## Cross-System Convention

W tym repo mapy w UI dotąd NIE było — `roadmap.md:155` jawnie parkuje „Mapa w UI" jako
PRD §Non-Goal („zniesiony tylko w tym zawężeniu" — sortowanie listy w S-10), a S-10 miało
twarde „zero nowych pól dla właściciela". Ta zmiana **świadomie odwraca oba non-goale** (decyzja v2).
Reszta konwencji (islandy `client:load`, allowlist w API, trigger-driven coords) jest respektowana.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: lokalizacja zagrody jest dziś wyłącznie
> *stratną pochodną* wolnego tekstu `city` — właściciel nie jest źródłem prawdy o swoim
> punkcie. Rozwiązaniem jest uczynić właściciela źródłem prawdy przez pin na mapie, a
> słownik nazw (PRNG) zdegradować do fallbacku dla zagród bez pinu.

Initial framing (map-pin) **held up** — potwierdzony, nie obalony. Badanie osi „metoda
wprowadzania" wskazało pin jako najlepszy (a nie tylko domyślny): mapa-embed i tak wymaga
komponentu mapy, więc pin reużywa go za darmo, a alternatywy (geocode/kod pocztowy/confirm)
nie dają dokładnego wiejskiego punktu. Kluczowe przesunięcie względem intuicji: **read-side
katalogu nie wymaga zmian** — precyzja sortu naprawia się sama, gdy coords staną się manualne.

## Confidence

- **HIGH** — silne dowody na każdym wymiarze (file:line), konwencja jasna, sygnały decydujące.
  Read-side nie wymaga zmian; ryzyko skupione w dwóch znanych write'ach (trigger + seed).

## What Changes for /10x-plan

Plan ma być o **write-side + prezentacji**, nie o katalogu:
- **Schemat:** dodać dyskryminator (np. `coords_manual boolean default false` lub `location_source text`); trigger `zagrody_set_coords` early-return / skip gdy manualny; guard w seed `backfillZagrody` (`where not coords_manual`).
- **Precedencja:** pin ustawia lat/lng + `location_precise=true` + flagę manualną; wyczyszczenie pinu wraca do derywacji z nazwy.
- **Write path:** rozszerzyć `zagrodaProfileSchema` (walidacja lat/lng + flaga) i allowlist w `PUT /api/zagroda`.
- **Form:** island map-picker (Leaflet, `client:load`), start mapy = coords z nazwy; opcjonalny search „fly-to" (Nominatim jako pomoc pozycjonująca, nieutrwalany).
- **Detail:** dodać `latitude,longitude` do selectu (`zagrody/[id].astro:30`) + island mapy (embed).
- **Provider/deps:** Leaflet + kafelki OSM; nowy dep; atrybucja „© OpenStreetMap contributors"; brak zmian CSP (bo CSP nie ma — rozważyć czy dołożyć przy okazji).
- **Non-goale:** zaktualizować `roadmap.md`/PRD (Mapa w UI, zero pól właściciela) jako świadomie zniesione w v2.

## References

- Trigger + RPC + kolumny: `supabase/migrations/20260720120000_zagroda_coordinates.sql:20-23,99-128,138-162,171-238`
- Seed backfill: `scripts/seed-localities.ts:182-203`
- Form / schema / API: `src/components/zagroda/ZagrodaProfileForm.tsx:53-121`, `src/lib/zagroda.ts:29-40`, `src/pages/api/zagroda/index.ts:28-53`
- RLS UPDATE: `supabase/migrations/20260605090307_domain_schema.sql:83-86`
- Katalog consumer: `src/pages/katalog.astro:108-110,266-283`, `src/components/katalog/ZagrodaCard.astro:42,53-55,82`
- Detail page: `src/pages/zagrody/[id].astro:28-33,71-111`
- Island pattern + config: `astro.config.mjs:11`, `dashboard.astro:55`, `zagrody/[id].astro:104-109`
- Non-goal parked: `context/foundation/roadmap.md:155`; PRD `context/foundation/prd-v2.md`
- Investigation tasks: #3 (write path), #4 (precedence/trigger), #5 (detail/island/CSP)
