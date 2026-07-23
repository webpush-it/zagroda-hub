# Map-picker lokalizacji zagrody (Leaflet/OSM) — Plan Brief

> Full plan: `context/changes/zagroda-map-location/plan.md`
> Frame brief: `context/changes/zagroda-map-location/frame.md`

## What & Why

Lokalizacja zagrody jest dziś stratną pochodną wolnego tekstu `city` — właściciel nie jest
źródłem prawdy o swoim punkcie, co psuje sortowanie „najbliżej mnie" dla dwuznacznych nazw wsi.
Robimy właściciela źródłem prawdy przez pin na mapie (Leaflet/OSM), a słownik nazw (PRNG)
degradujemy do fallbacku. Przy okazji mapa ląduje na stronie szczegółów zagrody.

## Starting Point

`zagrody` ma już `latitude/longitude/location_precise`, ale ustawiane wyłącznie przez trigger z
nazwy miasta (i seed-backfill). Katalog już konsumuje te kolumny (sort + badge „~X km" gated na
`location_precise`). Brak jakiegokolwiek pola lokalizacji u właściciela; brak mapy w UI.

## Desired End State

Właściciel przeciąga marker na mapie startującej przy jego mieście; zapis oznacza coords jako
`manual` i chroni je przed nadpisaniem z nazwy (także przy edycji miasta i re-seedzie). Katalog
pokazuje wtedy dokładne „~X km", a strona zagrody — interaktywną mapę z markerem.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Metoda inputu | Pin na mapie (source of truth) | Embed i tak wymaga mapy → pin ją reużywa; alternatywy nie dają dokładnego wiejskiego punktu | Frame |
| Dyskryminator | `location_source text` ('auto'/'manual') | Czytelne i rozszerzalne; trigger+seed skip gdy 'manual' | Plan |
| Start mapy | Coords z nazwy | Marker startuje przy właściwym mieście, zero zewnętrznych API | Plan |
| Provider | Leaflet + kafelki OSM | ~40KB, prosty, bez klucza/billingu | Frame/Plan |
| Embed | Interaktywny, leniwa hydratacja | Spójny z pickerem; nie blokuje treści | Plan |
| Read-side katalogu | Bez zmian | Już honoruje location_precise/lat/lng | Frame |
| Testy | DB + unit teraz, e2e mapy osobno | Interakcja Leaflet krucha w e2e | Plan |

## Scope

**In scope:** kolumna `location_source` + precedencja w triggerze i seedzie; walidacja + API +
map-picker w formularzu; interaktywny embed na stronie zagrody; odwrócenie non-goali w docs.

**Out of scope:** geokodowanie/Nominatim; zmiany read-side katalogu; usunięcie słownika PRNG;
MapLibre; e2e interakcji mapy; nowa polityka RLS.

## Architecture / Approach

Backend-first. Faza 1: `location_source` + trigger reagujący na `city/voivodeship/location_source`
(gałąź manual zostawia coords + `location_precise=true`; auto derywuje) + guard w seed-backfillu.
Faza 2: dep Leaflet + zod/API + island `MapPicker` (`client:only`, start na coords z nazwy, revert
„Użyj lokalizacji miasta"). Faza 3: read-only mapa na detalu (`client:visible`) + docs.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Precedencja w DB | `location_source` + trigger/seed honorują manual | Trigger musi reagować na `location_source` (revert do auto) — inaczej stały pin |
| 2. Map-picker właściciela | Pin w formularzu, zapis coords, walidacja/API | Leaflet SSR — wymaga `client:only`; ścieżki ikon markera pod Vite |
| 3. Embed + docs | Mapa na stronie zagrody + zniesione non-goale | Leniwa hydratacja, by nie ruszyć NFR ładowania |

**Prerequisites:** S-10 (kolumny coords + katalog) na miejscu — jest. Lokalny stack Supabase.
**Estimated effort:** ~3 sesje (po fazie), głównie Faza 2 (island + form).

## Open Risks & Assumptions

- Leaflet pod Astro/Cloudflare wymaga `client:only="react"` i ręcznego ustawienia ikon markera.
- OSM tile usage policy: niski wolumen + atrybucja; bez własnego proxy kafelków.
- Match-rate/gate seeda bez zmian — manualne piny nie wchodzą do statystyki nazw.

## Success Criteria (Summary)

- Manualny pin przeżywa edycję miasta i re-seed; revert do auto re-derywuje z nazwy.
- Katalog „najbliżej mnie" pokazuje dokładne „~X km" dla zagrody z pinem (bez zmian read-side).
- Strona zagrody pokazuje interaktywną mapę z markerem + atrybucję; brak regresu NFR ładowania.
