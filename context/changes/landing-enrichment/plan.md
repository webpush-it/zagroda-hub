# Wzbogacenie landing page (klient-first) Implementation Plan

## Overview

Wzbogacić publiczny landing (`src/pages/index.astro`) klient-first, który dziś jest „zbyt ubogi" (niemal sam wyśrodkowany tekst, jedna karta, jeden kolor akcentu, zero ilustracji/ikon/trust-signali/FAQ). Zmiana jest **czysto prezentacyjna** — bez danych, API, tras, auth. Wzbogacenie realizuje najlepsze praktyki landing page'ów w trzech niezależnie wdrażalnych fazach, używając **wyłącznie istniejących zasobów marki**, promując **tylko funkcje dostępne dziś** i budując zaufanie **wyłącznie uczciwymi sygnałami** (bez fałszywego social proof). Kontynuacja slice'u S-09 (`client-first-landing`, zamknięty). Research: `context/changes/client-first-landing/research.md`.

## Current State Analysis

Kolejność strony dziś (`src/pages/index.astro`, commit `dbf5563`):

1. Logo przez `PageShell brand` (`PageShell.astro:29-33`).
2. Hero: `<h1>` „Znajdź zagrodę edukacyjną na wycieczkę — w swoim województwie." + jeden akapit + jedno CTA „Znajdź zagrodę" → `/katalog` (`index.astro:24-43`); zalogowany właściciel dostaje drugorzędny „Przejdź do panelu".
3. Kompaktowy 3-liniowy pasek „jak to działa" — numerowane kółka, mały wyszarzony tekst (`index.astro:45-59`, dane `clientSteps` `:11-15`).
4. Jedna biała karta `card-surface` „Prowadzisz zagrodę?" — akapit-ściana + CTA właściciela (`index.astro:61-82`).
5. Wiersz „Masz już konto zagrody?" login/rejestracja, tylko gość (`index.astro:84-99`).
6. Jednolinijkowa stopka (`index.astro:101-104`).

Klocki dostępne bez nowych zależności/zdjęć (pełny inwentarz w research §B):

- Tokeny „Łąka i miód" (`global.css:32-48`): brand `50/100/200/600/700/800`, honey `accent-100 #f6e8d5 / accent-700 #8a4407` (bezpieczny tekst), neutralne `surface/ink/ink-muted/edge`.
- Utility: `bg-meadow` (gradient, `global.css:160-163`), `card-surface` (`:167-176`), `tap-target` (min-height 44px, `:232-236`), `btn-primary`/`btn-secondary` (`:180-227`).
- Dokładne stringi CTA w repo: `btn-primary px-6 py-3 text-base`, `btn-secondary px-6 py-3 text-base`, `btn-primary px-4 text-sm`.
- Ilustracja `ZagrodaPlaceholder.astro` — pełna scena SVG (viewBox 16:9, `aria-hidden`, prop `class`), dziś użyta tylko jako miniatura 80×80; skaluje się do hero.
- Font Nunito do 800 (`font-extrabold`).

### Key Discoveries:

- **Ikony wyłącznie jako inline SVG.** Landing to czyste Astro SSR bez wysp; `lucide-react` wymaga hydratacji i łamie guardrail LCP < 2.5s / „brak nowych wysp na stronach publicznych" (`07-18` decyzje, research §E). Ikony wrysować statycznie w `.astro` (skopiowane ścieżki lucide lub proste własne). Zestaw motywów: `Search/Calendar/Send/KeyRound/ShieldCheck/Lock/Smartphone` itd.
- **`e2e/desktop-width.spec.ts:26` jest już rozjechany** — asertuje STARY owner-first H1 („Rezerwacje wycieczek do Twojej zagrody — w jednym miejscu, prosto z telefonu."), którego strona nie ma od `dbf5563` (obecny H1: „Znajdź zagrodę edukacyjną na wycieczkę — w swoim województwie."). CI nie uruchamia e2e, więc rozjazd jest niewidoczny. Naprawiane w Fazie 1.
- **Gwarancja anty-overbooking jest dziś pogrzebana w karcie właściciela** (`index.astro:65-69`), gdzie szukający jej nie przeczyta — to najmocniejszy uczciwy sygnał zaufania, do przeramowania na język szukającego.
- **`Layout.astro` liczy `canonicalUrl`, ale podaje go tylko do `og:url`** — brak `<link rel="canonical">`, Twitter Card i JSON-LD.
- **Motyw i struktura pod grep-gate**: zakaz `bg-cosmic|purple-|backdrop-blur|from-blue-200|bg-clip-text|text-blue-100|bg-white/(5|10)` w `src/`; `grep min-h-screen src/pages` musi być 0 (dozwolone tylko w `PageShell.astro:19`); jeden `<h1>`; `PageShell width="wide"`; bez nowych tokenów.

## Desired End State

Gość otwierający `/` widzi bogatszą, ale wciąż klient-first stronę: hero z ilustracją `ZagrodaPlaceholder` i linijką reassurance pod CTA; rząd 3–4 kart korzyści z ikonami; pasek zaufania z gwarancją braku podwójnej rezerwacji przeramowaną na jego język, prywatnością kontaktu i „bez konta"; czytelny 3-krokowy wizual „jak to działa"; powtórzone CTA „Znajdź zagrodę"; zwięzłe, uczciwe FAQ (`<details>`); lżejsza, wizualnie drugorzędna sekcja właściciela; na dole login/rejestracja i stopka. Rodziny są zaproszone lekkim akcentem (sub-headline + jedna linia FAQ). SEO ma canonical, Twitter Card i JSON-LD. Wszystko po polsku, mobile-first, tap-target ≥44px, bez nowych zależności, bez zdjęć, bez fałszywego social proof, bez obietnic funkcji spoza dziś. E2E spec zgodny z aktualnym H1.

Weryfikacja: `npx astro check` (0 błędów), `npm run lint`, `npm run build`, `npm test` zielone; wizualne sprawdzenie na 320–414px i desktopie; grep-gate motywu pusty; `npx playwright test desktop-width` zielony (jeśli uruchamiany lokalnie).

## What We're NOT Doing

- **Bez obietnic funkcji niezbudowanych**: sortowanie „najbliżej mnie"/geolokalizacja (S-10), ceny ofert (S-12), filtry temat/adresaci (S-13). Landing nie wspomina o żadnej z nich.
- **Bez rewersu do owner-first** — sekcja właściciela pozostaje drugorzędna; nie rozrasta się do drugiego hero; podaż pozyskiwana kanałami bezpośrednimi, nie przez landing.
- **Bez fałszywego social proof** — żadnych testimoniali, gwiazdek, liczników „zaufało nam X", ścianek logotypów, `aggregateRating`. Bez odniesienia do Ogólnopolskiej Sieci Zagród Edukacyjnych (omit — brak potwierdzonej afiliacji).
- **Bez nowej fotografii ani nowych zależności** — tylko istniejące tokeny/utility, `ZagrodaPlaceholder`, inline SVG.
- **Bez React-wysp na landingu** — FAQ przez natywne `<details>`, ikony inline; brak sticky mobile CTA (polegamy na CTA w topbarze).
- **Bez zmian danych/API/tras/auth**, bez zmian strony katalogu, strony zagrody, formularza zapytania, middleware.
- **Bez pełnego „rodzinnego" języka** w treści — tylko lekki akcent; głęboka neutralizacja to S-11 (formularz nadal szkolny).
- **Bez zmiany H1** (tylko naprawa rozjechanego e2e spec).

## Implementation Approach

Trzy niezależnie wdrażalne i wycofywalne fazy (rewert = jeden/dwa pliki), spójne z kadencją poprzednich landing-slice'ów. Faza 1 wnosi najwięcej wartości najmniejszym kosztem (korzyści + zaufanie + persona) i przy okazji naprawia rozjechany e2e spec. Faza 2 podnosi „bogactwo" wizualne (ilustracja hero, 3-krokowy wizual, powtórzone CTA). Faza 3 domyka obiekcje i SEO (FAQ, odchudzenie sekcji właściciela, meta/OG/JSON-LD). Copy trzyma ton praktyczny/rzeczowy z poprzednich landingów; ikony wrysowane inline; wszystko na `btn-primary`/`btn-secondary`/`card-surface`/`tap-target` + tokeny brand/accent.

## Critical Implementation Details

- **Sprzężenie copy↔e2e bez siatki CI.** Playwright używa dostępnych nazw (bez `data-testid`), a CI nie uruchamia e2e. Zmiany H1/nagłówków/nazw CTA nie są łapane automatycznie. Hrefy i dostępne nazwy CTA muszą pozostać stabilne: `/katalog` („Znajdź zagrodę"), `/auth/signup`, `/auth/signin`, `/dashboard`. `e2e/desktop-width.spec.ts:26` naprawiany w Fazie 1 do aktualnego H1.
- **Ikony bez hydratacji.** Nie importować `lucide-react` na landingu — wrysować SVG statycznie w Astro, każda ikona `aria-hidden` (dekoracyjna obok tekstu), by uniknąć podwójnego odczytu przez czytnik ekranu.
- **Kolejność folda na mobile.** W hero dwukolumnowym (`lg:grid-cols-2`) na mobile ilustracja musi iść POD CTA, żeby nie spychać przycisku poniżej pierwszego ekranu na 320–414px.
- **Kontrast honey.** Tekst na tle `accent-100` używa `accent-700`/`ink` (accent-600 nie przechodzi AA dla małego tekstu — `global.css:26`).

## Phase 1: Wartość dla szukającego i zaufanie

### Overview

Dodać rząd kart korzyści (tylko funkcje na dziś), pasek zaufania z gwarancją anty-overbooking przeramowaną na język szukającego, lekki akcent podwójnej persony w sub-headline; naprawić rozjechany e2e spec. Największy wpływ, najniższe ryzyko.

### Changes Required:

#### 1. Rząd korzyści dla szukającego

**File**: `src/pages/index.astro`

**Intent**: Zamienić ukryte, feature'owe frazy na jawny, skanowalny blok korzyści dla szukającego — 3–4 karty z ikoną, wyłącznie o funkcjach dostępnych dziś (browse w jednym miejscu, bez konta, sprawdzenie terminu, zapytanie w kilka minut).

**Contract**: Nowa `<section>` po hero. Siatka `grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4` z kartami `card-surface`; każda karta: inline-SVG ikona (`aria-hidden`) + `<h3>` tytuł + akapit `text-ink-muted`. Treść wg research §Sekcja 2 (tytuły: „Wszystkie zagrody w jednym miejscu", „Bez zakładania konta", „Sprawdzisz termin od ręki", „Zapytanie w kilka minut"). Bez wzmianki o cenach/najbliższych/filtrach tematycznych. Nagłówek sekcji jako `<h2>`.

#### 2. Pasek zaufania (uczciwe sygnały)

**File**: `src/pages/index.astro`

**Intent**: Wydobyć gwarancję anty-overbooking z karty właściciela i pokazać ją szukającemu w jego języku, obok prywatności kontaktu i „bez konta/bez newsletterów" — wyłącznie sygnały weryfikowalne.

**Contract**: Nowa `<section>` (linie ikona+tekst lub 3 małe karty). Treść wg research §Sekcja 3: „Gwarancja braku podwójnej rezerwacji — gdy gospodarz potwierdzi Twój termin, jest tylko Twój…", „Twoje dane kontaktowe trafiają wyłącznie do wybranego gospodarza.", „Nie zakładamy konta i nie wysyłamy newsletterów." Ikony inline (`ShieldCheck`/`Lock`/`KeyRound`), `aria-hidden`. BEZ odniesienia do sieci zagród. Gwarancja pozostaje też (skrótowo) w sekcji właściciela — to nie kolizja, inny język/adresat.

#### 3. Lekki akcent podwójnej persony

**File**: `src/pages/index.astro`

**Intent**: Zasygnalizować, że katalog jest dla szkół I rodzin, bez pełnej neutralizacji języka (formularz nadal szkolny do S-11) i bez zmiany H1.

**Contract**: Rozszerzyć sub-headline hero (`index.astro:29-32`) o kotwicę persony, np. „Dla szkół i przedszkoli — i dla rodzin szukających pomysłu na dzień z dziećmi." H1 (`:26-28`) bez zmian.

#### 4. Naprawa rozjechanego e2e spec

**File**: `e2e/desktop-width.spec.ts`

**Intent**: Zsynchronizować asercję nagłówka `/` z aktualnym H1 landingu (spec od `dbf5563` wskazuje nieistniejący owner-first H1).

**Contract**: W tablicy `VARIANTS` (`:24-28`) wpis dla `path: "/"` — zmienić `heading` na aktualny H1 „Znajdź zagrodę edukacyjną na wycieczkę — w swoim województwie." (`cap: 1152` bez zmian). Jeśli w tej fazie sub-headline zmieni jakiekolwiek asercje — nie dotyczy (spec sprawdza H1 level 1, nie sub-headline).

### Success Criteria:

#### Automated Verification:

- Typecheck: `npx astro check` (0 błędów)
- Lint: `npm run lint`
- Build: `npm run build`
- Testy: `npm test`
- Grep-gate motywu pusty: `! grep -rElq "bg-cosmic|purple-|backdrop-blur|from-blue-200|bg-clip-text|text-blue-100" src/`
- E2E (jeśli uruchamiany lokalnie): `npx playwright test desktop-width mobile-320` zielony (mobile-320 pokrywa brak poziomego overflow na `/`)

#### Manual Verification:

- Na 320–414px: karty korzyści układają się w jedną kolumnę, pasek zaufania czytelny, tap-target ≥44px
- Gwarancja anty-overbooking widoczna dla szukającego (nie tylko w sekcji właściciela), język skierowany do gościa
- Sub-headline wspomina rodziny i szkoły; H1 bez zmian; brak wzmianek o cenach/najbliższych/filtrach tematycznych
- Copy po polsku, ton rzeczowy; brak jakiegokolwiek fałszywego social proof

**Implementation Note**: Po tej fazie i przejściu automatycznej weryfikacji — pauza na manualne potwierdzenie przed Fazą 2. Bloki fazy używają zwykłych bulletów; checkboxy w `## Progress`.

---

## Phase 2: Hero i przepływ

### Overview

Podnieść „bogactwo" wizualne: ilustracja `ZagrodaPlaceholder` w hero + linijka reassurance pod CTA; przebudować „jak to działa" na 3-krokowy wizual z ikonami; dodać domykające, powtórzone CTA.

### Changes Required:

#### 1. Hero z ilustracją + reassurance line

**File**: `src/pages/index.astro`

**Intent**: Zamienić fold z ~100% typografii na prawdziwe hero z wizualem marki i mikro-copy redukującym ryzyko tuż pod przyciskiem.

**Contract**: Hero (`index.astro:24-43`) na `lg:grid-cols-2` (copy lewo / `ZagrodaPlaceholder` prawo w ramce `rounded-*` z `border-edge`); na mobile stack z ilustracją POD CTA. Import `ZagrodaPlaceholder` (jak w `ZagrodaCard.astro:36`), pozostaje `aria-hidden`. Pod przyciskiem linia `text-ink-muted text-sm`: „Przeglądanie i wysłanie zapytania są bezpłatne. Konto nie jest potrzebne." CTA i href bez zmian. Utrzymać jeden `<h1>` i `PageShell width="wide"`.

#### 2. „Jak to działa" jako 3-krokowy wizual

**File**: `src/pages/index.astro`

**Intent**: Podnieść najlżejszy element strony do czytelnego 3-krokowego wizualu (dokładnie 3 kroki), z ikoną, pogrubionym tytułem i linią wsparcia.

**Contract**: Przebudować sekcję `:45-59` i dane `clientSteps` `:11-15` z tablicy stringów na tablicę obiektów `{ icon, title, body }`. Render: karty `card-surface` (lub tint `brand-50`) `grid ... sm:grid-cols-3`; inline-SVG ikona (`aria-hidden`) + `<h3>` + akapit. Treść wg research §Sekcja 4: 1) „Znajdź zagrodę" 2) „Sprawdź termin" 3) „Wyślij zapytanie". Opcjonalnie chevrony między krokami na desktopie (dekoracyjne, `aria-hidden`).

#### 3. Domykające powtórzone CTA

**File**: `src/pages/index.astro`

**Intent**: Na wydłużonej stronie powtórzyć główną akcję, by gość mógł skonwertować tam, gdzie rośnie przekonanie.

**Contract**: Nowa `<section>` (po „jak to działa") — pas z tłem `bg-accent-100` (tekst `accent-700`/`ink`), krótki nagłówek + to samo CTA `btn-primary px-6 py-3 text-base` „Znajdź zagrodę" → `/katalog`. Etykieta identyczna jak w hero i topbarze (jedna akcja). Tło jako inline `class="bg-accent-100"` lub utility — bez nowych tokenów (accent-100 już istnieje).

### Success Criteria:

#### Automated Verification:

- Typecheck: `npx astro check` (0 błędów)
- Lint: `npm run lint`
- Build: `npm run build`
- Testy: `npm test`
- `grep -c "<h1" src/pages/index.astro` = 1 (dokładnie jeden H1)
- E2E (jeśli uruchamiany lokalnie): `npx playwright test desktop-width mobile-320` zielony (mobile-320 pokrywa brak poziomego overflow na `/`)

#### Manual Verification:

- Na 320–414px: CTA hero pozostaje nad ilustracją (ilustracja pod przyciskiem), nic nie wypada poza ekran (brak poziomego scrolla)
- Ilustracja `ZagrodaPlaceholder` renderuje się ostro w hero; ramka spójna z marką
- 3 kroki czytelne z ikonami; dokładnie 3 (bez rozdmuchania)
- Powtórzone CTA prowadzi na `/katalog`; pas accent-100 kontrastuje wystarczająco
- Desktop: hero dwukolumnowy nie łamie szerokości `width="wide"`

**Implementation Note**: Po tej fazie i automatycznej weryfikacji — pauza na manualne potwierdzenie przed Fazą 3.

---

## Phase 3: FAQ, odchudzenie sekcji właściciela i SEO

### Overview

Domknąć obiekcje (uczciwe FAQ przez natywne `<details>`), rozbić akapit-ścianę sekcji właściciela na 2 punkty z ikoną (wizualnie drugorzędna), uzupełnić SEO w `Layout.astro`.

### Changes Required:

#### 1. FAQ (natywne `<details>/<summary>`)

**File**: `src/pages/index.astro`

**Intent**: Odpowiedzieć wprost na najczęstsze obiekcje bezkontowego marketplace, uczciwie do dzisiejszego zakresu; tania obsługa obiekcji + SEO, bez JS.

**Contract**: Nowa `<section>` z listą `<details>` (każdy `<summary>` = pytanie, `tap-target` ≥44px; treść = odpowiedź). 5 pozycji wg research §Sekcja 6 (konto? koszt? szkoły czy rodziny? sprawdzenie terminu? co po wysłaniu?). Odpowiedź o kosztach BEZ cen. Jedna pozycja niesie lekki akcent rodzinny (spójny z Fazą 1). Lekki styl na domyślny chrome przeglądarki (marker/spacing) — bez nowych tokenów. (FAQ pozostaje wyłącznie widoczną treścią — NIE dodajemy JSON-LD FAQPage; patrz uwaga o zakresie przy zmianie SEO poniżej.)

#### 2. Odchudzenie sekcji właściciela

**File**: `src/pages/index.astro`

**Intent**: Rozbić akapit-ścianę (`index.astro:65-69`) na 2 punkty z ikoną, by dwie wartości (zarządzanie z telefonu + gwarancja limitu) nie zlewały się; utrzymać sekcję wizualnie drugorzędną wobec treści dla szukającego.

**Contract**: W karcie „Prowadzisz zagrodę?" zamienić pojedynczy akapit na 2 punkty ikona+tekst wg research §Sekcja 7. Jedno CTA właściciela bez zmian (gość → „Załóż konto zagrody" `/auth/signup`; właściciel → „Przejdź do panelu" `/dashboard`). Nie rozrastać do drugiego hero.

#### 3. SEO / meta / OG / JSON-LD

**File**: `src/layouts/Layout.astro`

**Intent**: Uzupełnić brakującą higienę SEO wykrytą w research §C.10; utrzymać wszystkie deklaracje uczciwe (bez `aggregateRating`).

**Contract**: Dodać `<link rel="canonical" href={canonicalUrl}>` (wartość już liczona, dziś tylko `og:url`). Dodać Twitter Card (`twitter:card=summary_large_image`, `twitter:title/description/image`). Dodać JSON-LD **wyłącznie `Organization`/`WebSite`** jako `<script type="application/ld+json">` — te schematy są site-wide, więc `Layout.astro` (współdzielony przez wszystkie strony) jest właściwym miejscem. **BEZ `FAQPage`**: `Layout.astro` przyjmuje tylko propy `title`/`description` i ma jeden `<slot/>` w `<body>` — brak head-slotu, więc FAQPage z Layoutu wyemitowałby się na KAŻDEJ stronie (nieprawidłowy structured data dla stron bez FAQ). BEZ `aggregateRating`/recenzji. Zachować pojedynczy `<h1>` na stronach.

**File**: `src/pages/index.astro`

**Intent**: Poszerzyć meta description landingu o rodziny (persona + SEO), spójnie z lekkim akcentem persony.

**Contract**: `PageShell description` (`index.astro:20`) — dodać wzmiankę o rodzinach obok szkół; utrzymać zwięzłość i brak obietnic funkcji spoza dziś.

### Success Criteria:

#### Automated Verification:

- Typecheck: `npx astro check` (0 błędów)
- Lint: `npm run lint`
- Build: `npm run build`
- Testy: `npm test`
- JSON-LD parsuje się: `node -e "…"` lub walidacja w buildzie (brak błędów budowania); brak `aggregateRating` w źródle: `! grep -rq aggregateRating src/`
- E2E (jeśli uruchamiany lokalnie): `npx playwright test` zielony

#### Manual Verification:

- FAQ: `<details>` rozwija/zwija bez JS, klikalne obszary ≥44px, odpowiedzi uczciwe (koszt bez cen; jedna linia o rodzinach)
- Sekcja właściciela czyta się jako 2 wyraźne punkty, pozostaje wizualnie drugorzędna wobec sekcji dla szukającego
- `view-source`/devtools: obecny `<link rel="canonical">`, Twitter Card, JSON-LD (Organization/WebSite — bez FAQPage); brak `aggregateRating`; JSON-LD nie pojawia się z FAQ na innych stronach
- Meta description wspomina rodziny i szkoły; podgląd linku (OG/Twitter) poprawny

**Implementation Note**: Po tej fazie i automatycznej weryfikacji — pauza na manualne potwierdzenie; ta faza domyka wzbogacenie.

---

## Testing Strategy

### Unit Tests:

- Brak nowych testów jednostkowych — zmiana jest prezentacyjna (Astro, bez logiki poza istniejącym gatingiem `user`). Istniejące suity muszą zostać zielone.

### Integration Tests:

- Brak specyficznych dla tego slice'u. `npm test` (vitest: db + api + unit) musi przejść bez zmian — zmiana nie dotyka API/DB.
- `e2e/desktop-width.spec.ts` zsynchronizowany z aktualnym H1 (Faza 1); pełny `npx playwright test` zielony lokalnie (CI nie uruchamia e2e).

### Manual Testing Steps:

1. Gość `/` na 320–414px: kolejność hero → korzyści → zaufanie → jak to działa → powtórzone CTA → FAQ → „Prowadzisz zagrodę?" → login/rejestracja → stopka; brak poziomego scrolla; tap-target ≥44px.
2. Klik „Znajdź zagrodę" (hero, powtórzone CTA, topbar) → `/katalog`.
3. Zalogowany właściciel `/`: hero klient-first + „Przejdź do panelu"; sekcja właściciela drugorzędna; login/rejestracja ukryte.
4. FAQ rozwija/zwija bez JS; treści uczciwe (koszt bez cen).
5. Brak jakiegokolwiek fałszywego social proof; brak wzmianek o najbliższych/cenach/filtrach tematycznych.
6. SEO: canonical + Twitter + JSON-LD obecne, bez `aggregateRating`.
7. Spot-check innych stron (katalog, dashboard) — topbar bez regresu.

## Performance Considerations

Brak nowych zapytań, wysp ani JS klienta poza istniejącym `TopbarMobileMenu`. Ilustracja i ikony to inline SVG (bez dodatkowych żądań sieciowych). Utrzymać typograficzny rdzeń hero i brak wysp na landingu — budżet LCP < 2.5s (wiejskie łącza) pozostaje spełniony.

## Migration Notes

Bez zmian schematu/danych. Ships standardową ścieżką (`npm run deploy` / CI na master). Bez migracji; rollback = rewert plików danej fazy. W pełni wstecznie kompatybilne — brak zmian kontraktów dla jakiegokolwiek konsumenta.

## References

- Research (analiza luk + specyfikacja sekcja-po-sekcji + fazowanie): `context/changes/client-first-landing/research.md`
- Poprzedni slice (S-09, klient-first flip): `context/changes/client-first-landing/plan.md`
- Historia landingu i ton: `context/archive/2026-07-18-landing-page-content-and-design/{research.md,plan.md}`
- Obecny landing: `src/pages/index.astro:24-104`
- Ilustracja: `src/components/brand/ZagrodaPlaceholder.astro`; użycie: `src/components/katalog/ZagrodaCard.astro:36`
- Tokeny/utility: `src/styles/global.css:32-48,160-176,180-227,232-236`
- SEO: `src/layouts/Layout.astro`
- E2E coupling: `e2e/desktop-width.spec.ts:24-28`, `e2e/smoke.spec.ts:13`
- PRD/persony: `context/foundation/prd-v2.md` (FR-019, US-04); roadmap S-10/S-12/S-13: `context/foundation/roadmap.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wartość dla szukającego i zaufanie

#### Automated

- [x] 1.1 Typecheck: `npx astro check` (0 błędów) — a5e6894
- [x] 1.2 Lint: `npm run lint` — a5e6894
- [x] 1.3 Build: `npm run build` — a5e6894
- [x] 1.4 Testy: `npm test` — a5e6894
- [x] 1.5 Grep-gate motywu pusty — a5e6894
- [x] 1.6 E2E desktop-width + mobile-320 zielony (jeśli uruchamiany lokalnie) — a5e6894

#### Manual

- [x] 1.7 320–414px: karty korzyści jednokolumnowo, pasek zaufania czytelny, tap-target ≥44px — a5e6894
- [x] 1.8 Gwarancja anty-overbooking widoczna dla szukającego, jego językiem — a5e6894
- [x] 1.9 Sub-headline wspomina rodziny i szkoły; H1 bez zmian; brak obietnic spoza dziś — a5e6894
- [x] 1.10 Copy po polsku, ton rzeczowy; brak fałszywego social proof — a5e6894

### Phase 2: Hero i przepływ

#### Automated

- [x] 2.1 Typecheck: `npx astro check` (0 błędów)
- [x] 2.2 Lint: `npm run lint`
- [x] 2.3 Build: `npm run build`
- [x] 2.4 Testy: `npm test`
- [x] 2.5 Dokładnie jeden `<h1>` w `index.astro`
- [x] 2.6 E2E desktop-width + mobile-320 zielony (jeśli uruchamiany lokalnie)

#### Manual

- [x] 2.7 320–414px: CTA hero nad ilustracją, brak poziomego scrolla
- [x] 2.8 Ilustracja renderuje się ostro w hero; ramka spójna z marką
- [x] 2.9 3 kroki czytelne z ikonami (dokładnie 3)
- [x] 2.10 Powtórzone CTA → `/katalog`; pas accent-100 kontrastuje
- [x] 2.11 Desktop: hero dwukolumnowy nie łamie `width="wide"`

### Phase 3: FAQ, odchudzenie sekcji właściciela i SEO

#### Automated

- [ ] 3.1 Typecheck: `npx astro check` (0 błędów)
- [ ] 3.2 Lint: `npm run lint`
- [ ] 3.3 Build: `npm run build`
- [ ] 3.4 Testy: `npm test`
- [ ] 3.5 Brak `aggregateRating` w źródle; JSON-LD buduje się bez błędów
- [ ] 3.6 E2E zielony (jeśli uruchamiany lokalnie)

#### Manual

- [ ] 3.7 FAQ `<details>` rozwija/zwija bez JS, obszary ≥44px, odpowiedzi uczciwe
- [ ] 3.8 Sekcja właściciela jako 2 punkty, wizualnie drugorzędna
- [ ] 3.9 canonical + Twitter Card + JSON-LD obecne; brak `aggregateRating`
- [ ] 3.10 Meta description wspomina rodziny i szkoły; podgląd OG/Twitter poprawny
