# Poprawa błędów UI na mobile od 320px — Plan Brief

> Full plan: `context/changes/fix-mobile-ui-bugs/plan.md`
> Frame brief: `context/changes/fix-mobile-ui-bugs/frame.md`
> Research: `context/changes/fix-mobile-ui-bugs/research.md`

## What & Why

Aplikacja nigdy nie miała podłogi poprawności przy 320px — redesign „Łąka i miód" przeskórował markup startera, którego struktura responsywna była walidowana tylko przy ~393px (Pixel 5). Ustanawiamy **używalną podłogę 320px + przeniesioną regułę tap-target ≥44px** na wszystkich powierzchniach, zamiast łatać dwa zauważone miejsca (nagłówek, formularz katalogu). Objaw w Topbarze i katalogu to najbardziej widoczne przejawy jednej klasy braku podłogi, powtarzającej się w polach hasła, TurnusyEditor, chipach i tap-targetach.

## Starting Point

Szkielety stron są mobile-first i zdrowe; regresje są punktowe i **pre-existing** (git cross-check `45e1a63^` — nie regresja redesignu). Poprawny wzorzec już istnieje w repo (`ZagrodaCard`, rząd E-mail w `zapytania/[id].astro:111-121`), a guardrail 44px żyje na `btn-*` — brakuje tylko konsekwentnego zastosowania.

## Desired End State

Przy 320px każda powierzchnia jest używalna bez poziomego scrolla strony (dopięta @360+): Topbar zwija się w hamburger + drawer, natywne kontrolki daty/czasu stają na pełną szerokość, pole hasła nie chowa tekstu pod ikoną, a interaktywne elementy mają tap-target ≥44px. Regresja zablokowana testem Playwright @320 (publiczne) + manualną checklistą (Chrome + Firefox) dla powierzchni authed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Zakres | Pełny sweep 320px (BREAKS + tap-targety + kosmetyka wrap) | Objawy to jedna klasa braku podłogi, nie odosobnione bugi | Frame |
| Podłoga dolna | Używalny @320, dopięty @360+ (nie twarde zero-scroll) | Pragmatyczna granica; skrajne < 320px poza zakresem | Frame |
| Egzekwowanie 44px | W zakresie, przez wspólne `@utility tap-target` | Jedno źródło prawdy zamiast per-element, zgodne z `btn-*` | Frame + Plan |
| Wzorzec Topbara | Hamburger + drawer (React island) | Najczystszy @320; a11y (focus/Escape/aria) łatwiejsze w islandzie, zgodne z idiomem repo | Plan |
| Natywne kontrolki | Stack pełnej szerokości poniżej `sm` | Eliminuje zależny od silnika intrinsic-min (Firefox ≠ Chrome) | Plan |
| Bramka regresji | Playwright @320 (publiczne) + manualna checklista (authed) | Egzekwowanie w CI dla no-seed powierzchni, manual dla seedowanych | Plan |

## Scope

**In scope:** viewport `initial-scale=1`; wspólne `tap-target`; Topbar hamburger+drawer; stack natywnych `date/time/number`; `pr-10` + hit-area pola hasła; sweep `min-w-0`/`truncate`/`break-words`/`shrink-0` + tap-targety na RequestsList/StatusBadge/RequestDecision/`zapytania[id]`/`zagrody[id]`/linki `text-sm`; spec Playwright @320.

**Out of scope:** redesign szkieletów/motywu; twarda zero-tolerancja < 320px; lint egzekwujący `tap-target`; zmiany logiki/danych/autentykacji; pod-menu w drawerze.

## Architecture / Approach

Sweep BREAKS-first w 6 niezależnie weryfikowalnych fazach, każda stosująca istniejące wzorce z repo. Topbar zostaje SSR-owym szkieletem (czyta `Astro.locals.user`, buduje payload linków), delegując mobilny drawer do małego `client:idle` islandu; desktop zachowuje linki inline przez `hidden sm:flex`. Manualna weryfikacja @320 jest kryterium każdej fazy; automatyczny spec Playwright dochodzi na końcu jako trwała bramka.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fundamenty globalne | viewport `initial-scale=1` + `@utility tap-target` | Utility musi działać dla elementów inline (`<a>`/`<button>`) |
| 2. Topbar hamburger+drawer | Responsywny nagłówek, główny BREAKS | A11y drawera (focus/Escape/aria); rozjazd payloadu gość/zalogowany |
| 3. Natywne kontrolki stack | Data/czas pełnej szerokości @<sm | Weryfikacja intrinsic-min w dwóch silnikach |
| 4. Pola hasła | `pr-10` + hit-area toggle ≥44px | Pozycjonowanie ikony po zmianie paddingu |
| 5. Sweep wrap + tap-targety | Przeniesiony wzorzec na pozostałe powierzchnie | Szeroka powierzchnia plików, ryzyko pominięcia |
| 6. Bramka regresji @320 | Spec Playwright + manualna checklista | Asercje overflow bywają płynne; authed powierzchnie tylko manual |

**Prerequisites:** działający lokalny stack Supabase + `wrangler dev` dla e2e (`playwright.config.ts`); brak zależności zewnętrznych.
**Estimated effort:** ~2-3 sesje na 6 faz; Faza 2 (Topbar/island) najcięższa, reszta lekka i mechaniczna.

## Open Risks & Assumptions

- Topbar zmienia strukturę — istniejące e2e muszą polegać na lokatorach role/tekst, nie CSS (weryfikacja w Fazie 2).
- Intrinsic-min natywnych kontrolek różni się między Chrome a Firefox — stack full-width to zabezpieczenie, ale wymaga potwierdzenia w obu.
- Spec @320 pokrywa tylko powierzchnie publiczne (no-seed); authed (TurnusyEditor, RequestsList) zależą od manualnej checklisty.
- Plik formularza rezerwacji z natywną datą do potwierdzenia przy implementacji (Faza 3).

## Success Criteria (Summary)

- @320 brak poziomego scrolla strony na wszystkich powierzchniach; hamburger/drawer działa z pełną a11y.
- Natywne kontrolki nieprzycięte w Chrome i Firefox; pole hasła używalne; wszystkie interaktywne elementy ≥44px.
- Spec Playwright @320 zielony i faktycznie łapiący regresję; manualna checklista authed zaliczona.
