# Wspólny PageShell i spójny kontrakt szerokości RWD — Plan Brief

> Full plan: `context/changes/refactor-responsive-web-design/plan.md`
> Research: `context/changes/refactor-responsive-web-design/research.md`

## What & Why

Strony aplikacji mają dziś trzy różne szerokości treści (`max-w-4xl`/`max-w-md`/`max-w-sm`), dwa mechanizmy centrowania i Topbar wklejany ręcznie w 8 miejscach — bo `Layout.astro` nie narzuca żadnej powłoki, a każda strona roluje własną. Wprowadzamy jeden współdzielony `PageShell.astro` i migrujemy wszystkie ~13 stron, ustanawiając jeden responsywny kontrakt szerokości.

## Starting Point

`Layout.astro` to goła powłoka (`<head>` + Banner + `<slot/>`, bez kontenera). Każda strona hand-roluje `bg-meadow min-h-screen p-4` + `mx-auto w-full max-w-*` i (poza auth) wkleja `<Topbar />`, który czyta `Astro.locals.user` wewnętrznie. Padding jest płaski (`p-4`), nie ma responsywnego gutteru poziomego.

## Desired End State

Istnieje `PageShell.astro` — jedyny właściciel powłoki treści (tło, `min-h-screen`, gutter, wyśrodkowany parametryzowany kontener, warunkowy Topbar), renderujący `Layout` wewnętrznie. Każda strona to jeden wrapper `<PageShell width=… >`. Jeden kontrakt szerokości z zachowawczym poszerzaniem na desktopie; auth wyśrodkowane bez Topbara. Gate e2e @320 utrzymany + nowy test @1280.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Zakres shella | Pełny PageShell (tło+gutter+kontener+Topbar) | Usuwa duplikację Topbara z 8 stron, centralizuje szerokość | Plan |
| Model szerokości | Parametr `width` + responsywne poszerzanie na lg/xl | Jeden kontrakt + lepsze wykorzystanie desktopu | Plan |
| Ramp szerokości | Zachowawczy (default `max-w-md→lg:max-w-2xl`, wide `max-w-4xl→xl:max-w-6xl`, narrow `max-w-sm` stałe) | Czytelna długość linii, minimalne ryzyko regresji | Plan |
| Home | Wariant `wide` shella | Ta sama powłoka co reszta, landing zachowuje szerokość | Plan |
| Auth | Wariant `narrow` + `center`, bez Topbara | Jedna powłoka dla całej apki, zachowana karta 384px | Plan |
| Gutter | Responsywny `px-4 sm:px-6 lg:px-8` | Spójny margines rosnący z szerokością kolumny | Plan |
| E2E | Utrzymać mobile-320 + dodać asercję @1280 | Chroni nowy poszerzany kontrakt, łagodzi osłabione single-device | Plan |

## Scope

**In scope:** nowy `PageShell.astro`; migracja wszystkich ~13 stron; jeden kontrakt szerokości + gutter; wariant auth (center, bez Topbara); nowy e2e desktop-width.

**Out of scope:** redesign `card-surface`/insetów; ujednolicanie progów gridów na Home; zmiany w `<head>`/SEO/Banner; poprawki z `fix-mobile-ui-bugs`; poszerzanie kart auth; komponenty React.

## Architecture / Approach

`PageShell.astro` forwarduje `title`/`description` do `Layout` i renderuje: `<div bg-meadow min-h-screen [flex-center] gutter><div mx-auto w-full {widthClass}>{Topbar?}<slot/></div></div>`. Warianty przez propsy `width`/`align`/`showTopbar`. Topbar zostaje komponentem Astro (czyta `Astro.locals.user`; wyspy React nie mają dostępu do `locals`). Migracja strona-po-stronie, każda faza niezależnie buildowalna i weryfikowalna wizualnie względem baseline.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Build + pilot | `PageShell.astro` + `dashboard.astro` zmigrowany | Topbar musi czytać `locals` z wnętrza shella |
| 2. App pages | 6 stron top-align na PageShell | Regresje wizualne vs baseline @320 |
| 3. Home + Auth | Warianty `wide` i `narrow/center` | Dwutorowość wariantów (center bez Topbara) |
| 4. E2E + sweep | Gate @320 + nowy @1280, grep-sweep | Selektory e2e po zmianie wrappera |

**Prerequisites:** działający `npm run build` + `npm run test:e2e` (Playwright); dostęp do dev-servera do weryfikacji manualnej @320/@1280.
**Estimated effort:** ~2-3 sesje przez 4 fazy (Faza 1 najostrożniej — dowód kontraktu Topbara).

## Open Risks & Assumptions

- **Świadoma modyfikacja guardrailu** "jednokolumnowy `max-w-md` mobile-first zostaje" (`new-user-interface/plan.md:43`) — wybór responsywnego poszerzania osłabia uzasadnienie e2e single-device (Pixel 5 ~393px). Łagodzone nowym testem @1280 (Faza 4).
- Zakładamy, że locatory `mobile-320.spec.ts` (role/text) przetrwają zmianę struktury wrappera; jeśli nie — drobna korekta selektorów w Fazie 4.
- Zakładamy, że `<Topbar />` renderowany z wnętrza PageShell nadal czyta `Astro.locals.user` — walidowane jako pierwszy krok (pilot 1.4).

## Success Criteria (Summary)

- Wszystkie ~13 stron używają jednego `PageShell`; `grep "min-h-screen" src/pages` = 0 trafień.
- Spójne szerokości i gutter na każdym progu; poszerzanie na lg/xl dla `default`/`wide`; auth wyśrodkowane bez Topbara.
- `mobile-320` zielony + nowy `desktop-width` zielony; brak wizualnych regresji @320/@768/@1280.
