# Redesign UI „Łąka i miód" — Plan Brief

> Full plan: `context/changes/new-user-interface/plan.md`
> Research: `context/changes/new-user-interface/research.md`

## What & Why

Zagroda Hub — polska platforma rezerwacji wycieczek szkolnych do zagród edukacyjnych — wciąż nosi skórę 10x Astro Startera: ciemny „kosmiczny" gradient, glassmorphism i fioletowe akcenty, do tego angielskie formularze logowania i favicon-rakietę. Przeprojektowujemy całe UI na jasny, ciepły motyw domenowy „Łąka i miód" (zieleń łąki + miodowy akcent na kremowym tle), domykając przy okazji polonizację i sprzątając pliki startera — żeby produkt wyglądał jak katalog zagród, a nie szablon.

## Starting Point

Copy jest już polskie i domenowe (landing przeprojektowany w czerwcu 2026), ale 31 z 34 plików UI hardkoduje klasy ciemnego motywu; tokeny shadcn w `global.css` to nieużywane defaulty, a e-maile mają już własną, jasno-zieloną markę — rozjechaną z webem. Poprzednia zmiana świadomie uznała ciemny motyw za „język produktu" — ten plan tę decyzję odwraca, globalnie.

## Desired End State

Każda strona (landing, katalog, zagroda, auth, panel, /anuluj, nowa 404) i e-maile są w jednej palecie „Łąka i miód", z logomarkiem w Topbarze i faviconie, ilustracją domenową zamiast emoji 🏡, typografią Nunito i całym copy po polsku. Grepy `bg-cosmic|purple-|backdrop-blur|Sign in` w `src/` nic nie zwracają; e2e przechodzi z polskimi lokatorami.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Kierunek motywu | Jasny, ciepły | Pasuje do domeny i czytelności w terenie (PRD: właściciel pracuje na dworze); spójny z jasnymi e-mailami | Plan |
| Paleta | Nowa: „Łąka i miód" (zieleń #3F7D2C + miód #B45E14 na kremie #F7F5EF) | Naturalna, przyjazna szkole; blisko zieleni e-maili, więc ich aktualizacja jest kosmetyczna | Plan |
| Powierzchnie | Miękkie białe karty (zamiast glass) | Glass `bg-white/N` nie działa na jasnym tle; karty to najprostsze przemapowanie 1:1 | Research |
| Typografia | Pełny webfont Nunito (self-hosted, latin-ext) | Wyraźny charakter brandu; budżet ≤ ~120 KB pod guardrail katalog < 2 s | Plan |
| Mechanika | Tokeny `@theme` + `@utility` w global.css, migracja per plik | Wzorzec już działa (`bg-cosmic` = 1-linijkowa dźwignia); przyszłe re-themingi = edycja 1 pliku | Research |
| Assety | Proste SVG w repo (logomark, favicon, OG, ilustracja) + skrypt rasteryzacji | Odblokowuje redesign bez czekania na grafika; świadomy placeholder brandu | Plan |
| Polonizacja | Pełny pass EN→PL (labelki, walidacje, aria) | Domyka odroczony follow-up z landing-redesign | Research |
| Testy e2e | Lokalny `npm run test:e2e` jako bramka faz 3–5; bez joba CI | 6 lokatorów zależy od copy auth, a CI nie uruchamia e2e — ryzyko adresowane procesowo | Research |
| Zakres dodatkowy | 404, poprawki kontrastu AA, sprzątanie startera, aktualizacja e-maili | Wszystko dotyka tych samych plików/klas — naprawa niemal darmowa teraz | Plan |

## Scope

**In scope:** re-theme wszystkich stron i komponentów UI; tokeny+utilities w global.css; webfont; logomark/favicon/og-image/ilustracja SVG; `lang="pl"`; pełna polonizacja auth (+ aria); strona 404; aktualizacja 6 lokatorów e2e; poprawki kontrastu WCAG AA; usunięcie LibBadge/template.png, restyle Banner, link w config-status, rename package.json; paleta e-maili.

**Out of scope:** dark mode toggle; pełna adopcja shadcn/ui; job e2e w CI; snapshoty wizualne; zmiany treści merytorycznej, backendu, API, schematu; profesjonalne logo; zmiany struktury layoutu (`max-w-md` mobile-first zostaje).

## Architecture / Approach

Jedno źródło prawdy motywu w `src/styles/global.css`: tokeny `@theme` (brand/accent/surface/ink) + utility-szkielety (`bg-meadow`, `card-surface`, `btn-primary`, `btn-secondary`, `input-field`) zastępują powtarzane verbatim idiomy klas. `bg-cosmic` żyje do fazy 5, więc niezmigrowane strony działają w trakcie; migracja idzie grupami powierzchni, a każda strona jest wewnętrznie spójna. Tokeny shadcn `:root` przekolorowane przy okazji — `Button` i przyszłe komponenty grają z motywem za darmo.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fundament motywu i brandu | Tokeny, utilities, Nunito, lang=pl, wszystkie assety SVG (bez zmian wyglądu stron) | Akceptacja estetyki logomarku/ilustracji — decyzja człowieka |
| 2. Powierzchnie publiczne | Topbar+logo, landing, katalog, zagroda+formularz, /anuluj, nowa 404 w nowym motywie | Przejściowa dwumotywowość z panelem/auth |
| 3. Auth + polonizacja + e2e | 5 stron auth po polsku i w nowym motywie; 6 lokatorów zaktualizowanych atomowo | Cichy regres e2e — CI nie łapie; bramka: lokalny pełny test:e2e |
| 4. Panel właściciela | Dashboard i zapytania w nowym motywie; statusy odwrócone na jasne tinty | Czytelność statusów/guardrail 15 s na mobile |
| 5. Sprzątanie + e-maile | Usunięty bg-cosmic/LibBadge/template.png, Banner+config-status, rename, paleta e-maili, grep-gates | Dotyka przetestowanego kanału e-mail — re-test przez dev endpoint |

**Prerequisites:** brak — wszystko w repo; fonty z github.com/google/fonts (OFL), rasteryzacja skryptem node.
**Estimated effort:** ~5 sesji (1 faza = 1 sesja); fazy 2 i 4 największe objętościowo, faza 3 najbardziej ryzykowna (testy).

## Open Risks & Assumptions

- Logomark i ilustracja projektowane „inżyniersko" w repo — jeśli estetyka nie przejdzie akceptacji w fazie 1, potrzebny zewnętrzny asset (plan się nie zmienia, tylko podmiana plików).
- Dokładne odcienie palety mogą się przesunąć przy weryfikacji kontrastu AA (deklarowane w planie jako dopuszczalne odstępstwo).
- Deploy na produkcję dopiero po fazie 4/5 — wcześniejszy deploy pokazałby użytkownikom miks motywów.

## Success Criteria (Summary)

- Użytkownik na żadnej stronie ani w e-mailu nie widzi śladu startera: ciemnego kosmosu, fioletu, angielskich formularzy, rakiety w faviconie.
- Aplikacja wygląda „jak zagroda": zieleń/miód/krem, logomark, ilustracja domenowa, Nunito — spójnie web ↔ e-mail.
- `npm run build && npm run lint && npm test && npm run test:e2e` przechodzą; wszystkie strony zatwierdzone manualnie na viewporcie Pixel 5.
