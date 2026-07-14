# Opcjonalny brand-header (logo) na odsłonach auth — Plan Brief

> Full plan: `context/changes/auth-brand-header/plan.md`

## What & Why

Dodajemy do `PageShell` opcjonalny prop `brand?: boolean` (default `false`), który renderuje wyśrodkowany, linkujący do `/` logotyp „Zagroda Hub" nad slotem, i włączamy go na 5 stronach auth. Po refaktorze RWD auth nie ma Topbara, przez co ekrany logowania/rejestracji nie pokazują żadnej marki ani drogi powrotu — a to typowy cel phishingu i słaby UX (brak escape hatch). Brand-header zamyka tę lukę bez przywracania pełnej nawigacji.

## Starting Point

Wszystkie 5 stron auth (`signin`, `signup`, `forgot-password`, `reset-password`, `confirm-email`) używa dziś `<PageShell width="narrow" align="center" showTopbar={false}>` z kartą `card-surface` w slocie. Żadna nie renderuje logo ani `href="/"` — jedyne wyjścia to krzyżowe linki między samymi ekranami auth.

## Desired End State

Na każdej z 5 stron auth widać wyśrodkowane logo „Zagroda Hub" nad kartą, klikalne → strona główna; Topbar/nawigacja nadal nieobecne. Strony top-align (katalog, dashboard, home, …) pozostają bez zmian, bo prop jest domyślnie wyłączony. Gate'y e2e (mobile-320, desktop-width, pełny suite) zielone, plus nowa lekka asercja „auth ma brand-link do `/`, nie ma nav Topbara".

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| API propu | boolean `brand` (default false) | Najprostsze, trzyma strukturę w jednym miejscu, zero duplikatu w 5 stronach | Plan |
| Wariant logo | `full` (znak + wordmark) | Pełny sygnał marki/zaufania, spójny z Topbarem, mieści się w `max-w-sm` @320 | Plan |
| Zakres stron | Wszystkie 5 auth | Spójność — każdy ekran auth ma markę i wyjście do `/` | Plan |
| Testy | Lekka asercja + zielony gate | Blokuje regresję (powrót Topbara / zniknięcie logo) niskim kosztem | Plan |

## Scope

**In scope:** nowy prop `brand` w `PageShell`; `brand` na 5 stronach auth; lekka asercja e2e; utrzymanie mobile-320 + desktop-width.

**Out of scope:** przywracanie Topbara/nawigacji na auth; zmiany stron top-align; parametryzacja headera (href/wariant/slot); edycje `Logo`/`Layout`/`Topbar`/komponentów React; usuwanie krzyżowych linków auth.

## Architecture / Approach

Jeden warunkowy blok w kolumnie `PageShell` (`{brand && <a href="/" aria-label…><Logo variant="full"/></a>}`) przed `<slot />`, z klasami brand-linku skopiowanymi z `Topbar.astro:29-31` (`tap-target`, wyśrodkowanie, margines dolny). W `align="center"` grupa logo+karta jest wyśrodkowana jako całość. Call-sites: dodanie atrybutu `brand` do 5 istniejących `<PageShell>`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Brand-header + 5 stron | Prop `brand` w PageShell + włączenie na auth | @320 wysokość/overflow z logo |
| 2. E2E guard + weryfikacja | Asercja brand/no-nav + zielone gate'y | Selektory kolidujące z mobile-320 (mało prawdopodobne) |

**Prerequisites:** brak — bazuje na zamkniętym `refactor-responsive-web-design`.
**Estimated effort:** ~1 sesja, 2 fazy (zmiana trywialna).

## Open Risks & Assumptions

- Logo `full` (wordmark `text-lg`) mieści się w `max-w-sm` przy 320px bez overflow — do potwierdzenia manualnie i przez mobile-320.
- `reset-password` bez aktywnej sesji przekierowuje do `forgot-password` — brand i tak widoczny na stronie docelowej; weryfikacja manualna to uwzględnia.

## Success Criteria (Summary)

- Każdy ekran auth pokazuje logo „Zagroda Hub" nad kartą, klik → `/`, bez nawigacji Topbara.
- Strony top-align bez żadnych zmian (dowód: prop default-false).
- `npm run lint && npm run build` oraz pełny `npm run test:e2e` (z nową asercją) zielone.
