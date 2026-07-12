# Poprawa błędów UI na mobile od 320px — Implementation Plan

## Overview

Ustanawiamy **używalną podłogę poprawności przy 320px** na wszystkich powierzchniach mobilnych. To nie jest łatka dwóch zauważonych miejsc (nagłówek, formularz katalogu), lecz systemowy sweep: redesign „Łąka i miód" przeskórował markup startera, którego struktura responsywna była walidowana tylko przy ~393px (Pixel 5), więc klasa objawów @320px powtarza się na wielu powierzchniach. Naprawiamy klasę objawów naraz i domykamy ją bramką regresji.

## Current State Analysis

Szkielety stron są mobile-first i zdrowe (`p-4` + `card-surface` + `max-w-*`, landing z prefiksami `sm:`/`md:`, `ZagrodaCard` z `min-w-0`/`truncate`). Regresje kumulują się w powtarzalnych klasach, wszystkie **pre-existing** (git cross-check `45e1a63^` — nie regresja redesignu):

- **Nagłówek bez responsywności** (`Topbar.astro:10-47`) — jeden niezawijalny poziomy rząd (~448px treści vs ~288px @320) bez `flex-wrap`/hamburgera/`min-w-0` → poziomy scroll całej strony. Topbar jest wstawiany bezpośrednio w 8 stronach (nie przez `Layout`), czyta `Astro.locals.user`.
- **Natywne kontrolki `date/time/number` w wąskich/wielokolumnowych kontenerach** (`katalog.astro:146-164` data ~116px; `TurnusyEditor.tsx:71` dwa `time` ~103px/kol) — intrinsic min nie kurczy się → clipping/overflow, różny między silnikami (Firefox szerszy niż Chrome).
- **Pole hasła bez prawej rezerwy** (`FormField.tsx:48` `pl-10!` bez `pr-10`) + `PasswordToggle.tsx:10-17` hit-area ~16px.
- **Tap-targety < 44px** — guardrail `min-height:2.75rem` istnieje tylko na `btn-*` (`global.css:180,207`); nie przeniesiony na linki nav, chipy, `PasswordToggle`, linki `text-sm`.
- **Treść bez zabezpieczeń wrap** (`RequestsList.tsx:72-84`, `zagrody/[id].astro:88,102-105`, `zapytania/[id].astro:92-110`) — brak `min-w-0`/`truncate`/`break-words`/`shrink-0`.
- **Meta viewport bez `initial-scale=1`** (`Layout.astro:27`) — wzmacniacz overflow.

### Key Discoveries:

- **Poprawny wzorzec już istnieje w repo** — `ZagrodaCard.astro` i rząd E-mail w `zapytania/[id].astro:111-121` (`gap-2`, `dd` `min-w-0`, anchor `block truncate`, `shrink-0`). Fix jest lokalny i znany, nie wymaga nowej architektury.
- **Guardrail 44px istnieje, ale niespójnie egzekwowany** — `global.css:180,207` (`btn-*`). Konwencja `@utility` (Tailwind v4, CSS-first) pozwala dodać wspólny `tap-target` obok `btn-*`.
- **Repo hydratuje interaktywność React-islandami** — `client:load` używane wszędzie (`SignInForm`, `RequestsList`, `RequestDecision`…). Stan otwarcia drawera, Escape, focus-trap i `aria-expanded` należą do małego islandu, nie do Astro.
- **Playwright harness istnieje** — `playwright.config.ts` (`testDir: ./e2e`, jeden projekt „Pixel 5" ~393px), wzorzec no-seed public smoke w `smoke.spec.ts`. 320px można pokryć nadpisując viewport na poziomie pliku i asertując brak poziomego overflow na powierzchniach publicznych.

## Desired End State

Przy szerokości 320px każda dotknięta powierzchnia jest **używalna bez poziomego scrolla strony** (dopięta wizualnie @360+): nagłówek zwija się w hamburger + drawer, natywne kontrolki daty/czasu stają na pełną szerokość, pole hasła nie chowa tekstu pod ikoną, a wszystkie interaktywne elementy mają tap-target ≥44px. Regresja jest zablokowana automatycznym testem @320 (powierzchnie publiczne) + udokumentowaną manualną checklistą (Chrome + Firefox) dla powierzchni wymagających logowania.

Weryfikacja: `npm run test:e2e` przechodzi (w tym nowy spec @320), `npm run build` i lint czyste, oraz manualny przegląd @320 w DevTools potwierdza brak overflow i clippingu na każdej powierzchni z listy.

## What We're NOT Doing

- **Nie** przeprojektowujemy szkieletów stron ani systemu motywu — są zdrowe, zmiany są punktowe.
- **Nie** wprowadzamy twardej zero-tolerancji poziomego scrolla w skrajnych przypadkach < 320px (Galaxy Fold 280px) — podłoga to *używalny @320, dopięty @360+*.
- **Nie** budujemy pełnego systemu nawigacji z pod-menu — drawer to płaska lista istniejących linków.
- **Nie** dodajemy lint-reguły egzekwującej `tap-target` (rozważane w Open Questions researchu) — w tym cyklu wprowadzamy wspólne utility i stosujemy je ręcznie; egzekwowanie lintem to osobna zmiana.
- **Nie** zmieniamy zachowania autentykacji, danych ani logiki biznesowej — tylko warstwa prezentacji/responsywności.

## Implementation Approach

Sweep w kolejności BREAKS-first, każda faza niezależnie weryfikowalna @320. Najpierw tanie fundamenty globalne (viewport + wspólne utility), które odblokowują resztę. Potem główny bug (Topbar) jako osobna faza ze względu na powierzchnię kodu i a11y. Następnie pozostałe klasy BREAKS (natywne kontrolki, pola hasła), potem sweep kosmetyki wrap + tap-targetów przenoszący istniejący wzorzec z repo. Na końcu bramka regresji utrwala podłogę.

Każda faza stosuje **istniejące wzorce z repo** (`ZagrodaCard`, rząd E-mail, `btn-*` guardrail) — nie wynajdujemy nowych. Manualna weryfikacja @320 w DevTools jest kryterium każdej fazy; automatyczny spec Playwright dochodzi w ostatniej.

## Critical Implementation Details

- **Timing & lifecycle** — Topbar czyta `Astro.locals.user` po stronie serwera; drawer musi dostać z Astro-szkieletu payload linków + flagę stanu zalogowania jako propsy islandu (island nie ma dostępu do `Astro.locals`). Formularz `POST /api/auth/signout` (obecnie `Topbar.astro:28-32`) musi być odtworzony w drawerze bez duplikacji logiki — przekazać jako akcję, nie jako drugi mechanizm.
- **User experience spec** — drawer: otwarcie przez przycisk hamburgera (≥44px), zamknięcie na Escape i na wybór linku; `aria-expanded`/`aria-controls` na przycisku; focus wraca na przycisk po zamknięciu. Desktop (≥`sm`) pokazuje dotychczasowe linki inline (`hidden sm:flex`), hamburger `sm:hidden`.
- **Performance constraints** — natywne kontrolki `date/time/number` mają intrinsic-min zależny od silnika (Firefox szerszy). Stack full-width @<`sm` eliminuje zależność od silnika; NIE polegać na tuningu `min-width` per przeglądarka.

## Phase 1: Fundamenty globalne

### Overview

Dwa tanie, globalne fixy odblokowujące resztę sweepu: poprawny meta viewport i wspólne utility tap-target.

### Changes Required:

#### 1. Meta viewport

**File**: `src/layouts/Layout.astro`

**Intent**: Dodać `initial-scale=1`, by przeglądarki mobilne (iOS Safari przy zmianie orientacji) nie potęgowały overflow przez zoom ≠ 1.

**Contract**: `<meta name="viewport" content="width=device-width, initial-scale=1" />` (obecnie `Layout.astro:27` bez `initial-scale`).

#### 2. Wspólne utility tap-target

**File**: `src/styles/global.css`

**Intent**: Przenieść guardrail 44px z per-elementowego `btn-*` do jednego, wielokrotnego utility, którym w kolejnych fazach oznaczymy interaktywne elementy poniżej progu (linki nav, chipy, `PasswordToggle`, linki `text-sm`).

**Contract**: Nowe `@utility tap-target` obok `btn-primary`/`btn-secondary` (`global.css:180-227`), z `min-height: 2.75rem` + `display:inline-flex; align-items:center;` (tak, by wysokość obowiązywała także dla elementów inline typu `<a>`/`<button>`).

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Lint/format czyste: `npm run lint`

#### Manual Verification:

- W DevTools @320 strona nie zoomuje się przypadkowo po zmianie orientacji.
- `tap-target` zaaplikowany na testowym elemencie daje wysokość 44px.

**Implementation Note**: Po zakończeniu tej fazy i przejściu automatycznej weryfikacji zatrzymaj się na manualne potwierdzenie od człowieka przed przejściem do następnej fazy.

---

## Phase 2: Topbar — zwinięcie responsywne (hamburger + drawer)

### Overview

Główny bug BREAKS: nieresponsywny nagłówek. Poniżej `sm` linki chowają się w drawer otwierany hamburgerem; desktop zachowuje linki inline. Naprawiamy też tap-targety loga i linków nav.

### Changes Required:

#### 1. Island nawigacji mobilnej

**File**: `src/components/TopbarMobileMenu.tsx` (nowy)

**Intent**: React-island własnym stanem otwarcia obsługujący hamburger + drawer poniżej `sm`: przycisk ≥44px, drawer z płaską listą przekazanych linków, zamknięcie na Escape i na wybór linku, focus z powrotem na przycisk. Zgodny z idiomem islandów w repo. **Hydratacja: preferować `client:idle`** — drawer jest bezczynny do dotknięcia, więc nie potrzebuje natychmiastowej hydratacji (`client:load`) na wszystkich 8 stronach; `client:idle` odracza koszt bez utraty funkcji.

**Contract**: Props: lista linków `{ href: string; label: string }[]` oraz flaga/akcja wylogowania (odtwarza `POST /api/auth/signout`). Przycisk ma `aria-expanded`/`aria-controls`; kontener drawera ma `id` odpowiadający `aria-controls`. Widoczny tylko `sm:hidden`.

#### 2. Topbar jako szkielet SSR + linki desktop

**File**: `src/components/Topbar.astro`

**Intent**: Zachować SSR-owe czytanie `Astro.locals.user` i zbudowę listy linków (stan gość/zalogowany); wyrenderować `TopbarMobileMenu` z tą listą (`sm:hidden`) oraz dotychczasowe linki inline jako `hidden sm:flex`. Dodać `min-w-0` na klaster i `tap-target` na linki nav (dziś ~40px, `Topbar.astro:7`) i link loga (dziś ~28px, `:13`).

**Contract**: Rząd `Topbar.astro:10-47` zyskuje: klaster linków `hidden sm:flex` + `<TopbarMobileMenu client:idle .../>` `sm:hidden`; `navLink` (`:7`) oznaczony `tap-target`; `<a>` loga z `tap-target`; kontener z `min-w-0`. Payload linków budowany raz w frontmatterze i współdzielony przez oba warianty (uniknąć rozjazdu gość/zalogowany).

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Lint/format czyste: `npm run lint`
- Istniejące e2e nie regresują: `npm run test:e2e`

#### Manual Verification:

- @320 w DevTools: brak poziomego scrolla strony na każdej z 8 stron używających Topbara, w stanie gościa i zalogowanym.
- Hamburger otwiera/zamyka drawer; Escape zamyka; wybór linku nawiguje i zamyka; focus wraca na przycisk.
- `aria-expanded` zmienia się poprawnie; drawer osiągalny klawiaturą.
- @≥sm (desktop) nagłówek wygląda jak dotychczas (linki inline, brak hamburgera).
- Tap-targety hamburgera, linków nav i loga ≥44px.

**Implementation Note**: Po zakończeniu tej fazy i przejściu automatycznej weryfikacji zatrzymaj się na manualne potwierdzenie od człowieka przed przejściem do następnej fazy.

---

## Phase 3: Natywne kontrolki — stack pełnej szerokości @<sm

### Overview

Natywne `date/time/number` nie kurczą się poniżej intrinsic-min. Poniżej `sm` przełączamy ich kontenery na jedną kolumnę (pełna szerokość karty), eliminując zależność od silnika przeglądarki.

### Changes Required:

#### 1. Rząd filtra katalogu (data + liczba osób)

**File**: `src/pages/katalog.astro`

**Intent**: Rozłożyć rząd `flex gap-3` (`date` `flex-1` + `number` `w-28`) na jedną kolumnę poniżej `sm`, tak by każda kontrolka dostała pełną szerokość karty; wrócić do rzędu od `sm`.

**Contract**: `katalog.astro:146-164` — kontener responsywny (`flex-col sm:flex-row`), `input[type=number]` traci sztywne `w-28` na mobile (pełna szerokość), odzyskuje kompaktową szerokość od `sm`.

#### 2. TurnusyEditor — dwa `time`

**File**: `src/components/zagroda/TurnusyEditor.tsx`

**Intent**: Dwa `input[type=time]` w `grid-cols-2` (~103px/kol) rozłożyć na jedną kolumnę poniżej `sm`; wrócić do dwóch kolumn od `sm`.

**Contract**: `TurnusyEditor.tsx:71` — `grid-cols-1 sm:grid-cols-2` (lub odpowiednik flex). Przycisk delete (`:66`, już `size-11`) bez zmian.

#### 3. Data w formularzu rezerwacji — TYLKO weryfikacja (już full-width)

**File**: `src/components/booking/BookingRequestForm.tsx`

**Intent**: Bez zmian strukturalnych — `input[type=date]` (`:142-163`) jest już w `space-y-4` (jedna kolumna, pełna szerokość), więc nie ma czego rozkładać. Przy 320px renderuje się na ~240px, co research klasyfikuje jako przypadek bezpieczny. Item sprowadzony do weryfikacji, by nie robić martwej roboty.

**Contract**: Brak edycji layoutu. Potwierdzić manualnie @320 (Chrome + Firefox), że natywna data + wiodąca ikona (`pl-10!`, `:159`) renderują się czysto, bez clippingu i overflow.

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Lint/format czyste: `npm run lint`

#### Manual Verification:

- @320 w Chrome **i Firefox** (różny intrinsic-min): kontrolki daty w katalogu, czasu w TurnusyEditor i daty rezerwacji nie są przycięte ani nie powodują overflow.
- @≥sm kontrolki wracają do kompaktowego układu wielokolumnowego.

**Implementation Note**: Po zakończeniu tej fazy i przejściu automatycznej weryfikacji zatrzymaj się na manualne potwierdzenie od człowieka przed przejściem do następnej fazy.

---

## Phase 4: Pola hasła (auth)

### Overview

Dwa bugi BREAKS na każdym polu hasła: tekst wsuwa się pod ikonę oka (brak `pr-10`), a `PasswordToggle` ma hit-area ~16px.

### Changes Required:

#### 1. Prawe dopełnienie inputu hasła

**File**: `src/components/auth/FormField.tsx`

**Intent**: Zarezerwować miejsce po prawej pod nakładkę `PasswordToggle`, by wpisywany tekst/placeholder nie wsuwał się pod ikonę oka. Symetrycznie do istniejącego `pl-10!` dla ikony wiodącej.

**Contract**: `FormField.tsx:48` — dodać `pr-10` do klasy inputu, gdy pole ma toggle hasła (warunkowo, jak `pl-10!`).

#### 2. Hit-area PasswordToggle

**File**: `src/components/auth/PasswordToggle.tsx`

**Intent**: Powiększyć pole dotyku przycisku „pokaż hasło" z ~16px do ≥44px, zachowując wizualne umiejscowienie ikony przy prawej krawędzi.

**Contract**: `PasswordToggle.tsx:10-17` — przycisk oznaczony `tap-target` (z fazy 1) + wyśrodkowanie ikony (`size-4` w polu 44px), pozycjonowanie `absolute` dostrojone do nowego `pr-10`.

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Lint/format czyste: `npm run lint`

#### Manual Verification:

- @320 na `SignInForm`, `SignUpForm`, `ResetPasswordForm`: wpisywane hasło nie chowa się pod ikoną oka.
- Przycisk toggle łatwo trafialny kciukiem (≥44px), ikona wizualnie na miejscu.

**Implementation Note**: Po zakończeniu tej fazy i przejściu automatycznej weryfikacji zatrzymaj się na manualne potwierdzenie od człowieka przed przejściem do następnej fazy.

---

## Phase 5: Sweep zawijania treści + tap-targetów

### Overview

Przeniesienie istniejącego wzorca `min-w-0`/`truncate`/`break-words`/`shrink-0` (z `ZagrodaCard` i rzędu E-mail) oraz `tap-target` na wiersze i elementy, które je pominęły. Klasa RISKY/kosmetyka — domyka podłogę.

### Changes Required:

#### 1. RequestsList — chipy, badge+data, długa etykieta

**File**: `src/components/booking/RequestsList.tsx`

**Intent**: Chipy filtrów dostają `tap-target` (dziś ~38px); rząd badge + „Wysłano <data>" dostaje `shrink-0`/`whitespace-nowrap` na dacie i `shrink-0` na badge; długa etykieta turnusu dostaje `break-words`/`min-w-0`.

**Contract**: `RequestsList.tsx:45-50` (chipy → `tap-target`), `:72-74` (data `shrink-0 whitespace-nowrap`, badge `shrink-0`), `:81-84` (label `break-words min-w-0`).

#### 2. StatusBadge — brak zawijania

**File**: `src/components/booking/StatusBadge.tsx`

**Intent**: Zapobiec deformacji pigułki badge przez zawijanie tekstu statusu.

**Contract**: `StatusBadge.tsx:16-18` — `whitespace-nowrap` (+ `shrink-0` jeśli używany w rzędzie flex).

#### 3. RequestDecision — przyciski potwierdzeń

**File**: `src/components/booking/RequestDecision.tsx`

**Intent**: Zweryfikować i, jeśli trzeba, złagodzić zawijanie „Tak, odrzuć"/„Tak, cofnij" w wąskim boxie (dziś ~47px na tekst); `min-h-11` już absorbuje wysokość — celem jest brak clippingu, nie zero-wrap.

**Contract**: `RequestDecision.tsx:133-153,177-197` — potwierdzić `tap-target`/`min-h-11`, w razie potrzeby stack pełnej szerokości poniżej `sm`.

#### 4. Szczegóły zapytania — `dd` bez zabezpieczeń

**File**: `src/pages/dashboard/zapytania/[id].astro`

**Intent**: Wiersze Turnus i imię gościa dostają wzorzec z rzędu E-mail (`:111-121`), by długi label/token nie ściskał `dt`.

**Contract**: `zapytania/[id].astro:92-97,107-110` — `dd` `min-w-0`/`break-words` (naśladować `:111-121`).

#### 5. Strona zagrody (publiczna)

**File**: `src/pages/zagrody/[id].astro`

**Intent**: `h1` nazwy zagrody dostaje `break-words`; wiersz turnusu `li justify-between` dostaje `min-w-0`/`truncate`; link „← Wróć do katalogu" i „Przejdź do katalogu" dostają `tap-target`.

**Contract**: `zagrody/[id].astro:88` (`h1` `break-words`), `:102-105` (`min-w-0`/`truncate`), `:69,125` (linki `tap-target`).

#### 6. Linki `text-sm` (przekrojowe) — rozróżnić standalone vs inline

**File**: `src/components/booking/CancelRequest.tsx`, `src/pages/anuluj.astro`, `src/components/auth/SignInForm.tsx`, stopki auth (`src/pages/auth/signin.astro`, `signup.astro`, `forgot-password.astro`, `confirm-email.astro`)

**Intent**: Linki `text-sm` ~20px (lista J researchu) dostają większy hit-area, ale **rozróżniając dwa przypadki** — WCAG 2.5.5/2.5.8 zwalnia cele „w zdaniu" z reguły 44px, a `min-height:2.75rem`+`inline-flex` w środku akapitu łamie baseline i wstrzykuje wysoki box.
- **Standalone** (link jako samodzielny CTA/wiersz, nie w zdaniu): np. „← Wróć do katalogu", „Przejdź do katalogu", „Nie, wróć do katalogu" — dostają `tap-target`.
- **Inline w zdaniu** (link w obrębie `<p>`/flow): np. stopki auth `signin.astro:17` (link w `text-sm <p>`), „Nie pamiętam hasła" (`SignInForm.tsx:81`) — **NIE** dostają `tap-target`; zostawić (WCAG-exempt) albo powiększyć wyłącznie pionowym paddingiem (bez `min-height`/`inline-flex`).

**Contract**: Przy implementacji sklasyfikować każdy link z listy J jako standalone/inline wg kontekstu renderu; `tap-target` tylko na standalone. Inline bez `min-height`/`inline-flex`.

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Lint/format czyste: `npm run lint`
- Istniejące e2e nie regresują: `npm run test:e2e`

#### Manual Verification:

- @320 w DevTools: RequestsList, szczegóły zapytania, strona zagrody — brak overflow, długie tokeny zawijają/truncują zamiast rozpychać.
- Standalone linki i chipy mają tap-target ≥44px; linki inline-w-zdaniu nie mają wstrzykniętego wysokiego boxu (baseline nienaruszony).
- Badge nie deformuje się, data „Wysłano…" nie łamie układu.

**Implementation Note**: Po zakończeniu tej fazy i przejściu automatycznej weryfikacji zatrzymaj się na manualne potwierdzenie od człowieka przed przejściem do następnej fazy.

---

## Phase 6: Bramka regresji @320

### Overview

Utrwalenie podłogi: automatyczny spec Playwright @320 na powierzchniach publicznych (bez seedowania) + udokumentowana manualna checklista dla powierzchni wymagających logowania.

### Changes Required:

#### 1. Spec Playwright @320 (powierzchnie publiczne)

**File**: `e2e/mobile-320.spec.ts` (nowy)

**Intent**: Asertować brak poziomego overflow strony przy 320px na powierzchniach publicznych osiągalnych bez seedowania (wzorem `smoke.spec.ts`): `/`, `/katalog`, `/auth/signin`, `/auth/signup`. Nadpisać viewport na poziomie pliku (projekt „Pixel 5" to ~393px). **Dodatkowo — poza overflow — asertować podłogę tap-targetów i rezerwę pola hasła**, by bramka chroniła klasę D3–D5, nie tylko klasę overflow (D1). Clipping natywnych kontrolek jest renderowany przez silnik i zostaje w weryfikacji manualnej (Chrome + Firefox).

**Contract**: `test.use({ viewport: { width: 320, height: 640 } })` na poziomie pliku; testy niezależne, bez współdzielonego stanu DB. Asercje:
- **Overflow**: per strona `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
- **Tap-target**: `boundingBox().height >= 44` dla przycisku hamburgera (`/katalog`) oraz próbki linku nav/stopki auth (`/auth/signin`).
- **Rezerwa pola hasła**: na `/auth/signin` computed `padding-right` inputu hasła rezerwuje miejsce pod toggle (np. `>= 2.25rem`), tak by tekst nie wchodził pod ikonę.

#### 2. Manualna checklista @320 (powierzchnie authed)

**File**: `context/changes/fix-mobile-ui-bugs/manual-320-checklist.md` (nowy) lub sekcja w `change.md`

**Intent**: Udokumentować kroki manualnej weryfikacji @320 (Chrome + Firefox) dla powierzchni wymagających seedowania/logowania: dashboard (TurnusyEditor), lista zapytań (RequestsList), szczegóły zapytania, decyzja o rezerwacji.

**Contract**: Checklista per powierzchnia: brak poziomego scrolla, kontrolki natywne nieprzycięte, tap-targety ≥44px, badge/label bez deformacji.

### Success Criteria:

#### Automated Verification:

- Nowy spec przechodzi: `npm run test:e2e`
- Spec @320 asertuje tap-target ≥44 (hamburger + link) i rezerwę pola hasła, nie tylko overflow: `npm run test:e2e`
- Cała suita e2e zielona: `npm run test:e2e`
- Lint/format czyste: `npm run lint`

#### Manual Verification:

- Manualna checklista @320 wykonana w Chrome i Firefox dla powierzchni authed — wszystkie pozycje zaliczone.
- Spec @320 faktycznie łapie regresję (sanity: tymczasowe cofnięcie fixu Topbara wywala test).

**Implementation Note**: Po zakończeniu tej fazy i przejściu automatycznej weryfikacji zatrzymaj się na manualne potwierdzenie od człowieka.

---

## Testing Strategy

### Unit Tests:

- Brak nowej logiki jednostkowej (zmiany prezentacyjne). Jeśli `TopbarMobileMenu` zyska nietrywialną logikę stanu, rozważyć test renderu islandu (opcjonalnie).

### Integration Tests:

- Spec Playwright @320 (`e2e/mobile-320.spec.ts`) na powierzchniach publicznych — brak poziomego overflow.
- Istniejące e2e (`critical-flow`, `idor-contact-data`, `smoke`) nie regresują — Topbar zmienia strukturę, więc lokatorami są role/tekst, nie CSS.

### Manual Testing Steps:

1. DevTools @320: przejść wszystkie 8 stron z Topbarem (gość + zalogowany) — brak poziomego scrolla; hamburger/drawer działa (Escape, wybór linku, focus).
2. @320 w Chrome i Firefox: katalog (data+liczba), TurnusyEditor (czasy), rezerwacja (data) — kontrolki pełnej szerokości, brak clippingu.
3. @320: pola hasła (signin/signup/reset) — tekst nie pod ikoną, toggle trafialny.
4. @320: RequestsList, szczegóły zapytania, strona zagrody — długie tokeny zawijają/truncują, badge/data OK, tap-targety ≥44px.
5. @≥sm: potwierdzić brak regresji desktopu (Topbar inline, kontrolki wielokolumnowe).

## Performance Considerations

Zmiany są czysto CSS/markup + jeden mały island (`client:idle`) dla drawera — narzut JS minimalny, odroczony i tylko na mobile. Stack full-width natywnych kontrolek zwiększa wysokość formularzy na mobile (więcej scrolla pionowego) — akceptowalny koszt za brak clippingu.

## Migration Notes

Brak zmian schematu/danych. Zmiany są wstecznie kompatybilne i nie dotykają logiki biznesowej ani autentykacji.

## References

- Frame brief: `context/changes/fix-mobile-ui-bugs/frame.md`
- Related research: `context/changes/fix-mobile-ui-bugs/research.md`
- Poprawny wzorzec do naśladowania: `src/components/zagroda/../ZagrodaCard.astro`, `src/pages/dashboard/zapytania/[id].astro:111-121`
- Guardrail tap-target: `src/styles/global.css:180,207`
- E2E wzorzec no-seed: `e2e/smoke.spec.ts`; konfiguracja: `playwright.config.ts`
- Cross-check pre-existing: `git show 45e1a63^`
- Historical baseline (QA Pixel 5 ~393px): `context/archive/2026-07-12-new-user-interface/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fundamenty globalne

#### Automated

- [x] 1.1 Build przechodzi: `npm run build` — 8daf902
- [x] 1.2 Lint/format czyste: `npm run lint` — 8daf902

#### Manual

- [x] 1.3 @320 brak przypadkowego zoomu po zmianie orientacji — 8daf902
- [x] 1.4 `tap-target` daje wysokość 44px na testowym elemencie — 8daf902

### Phase 2: Topbar — zwinięcie responsywne (hamburger + drawer)

#### Automated

- [x] 2.1 Build przechodzi: `npm run build` — d2310f7
- [x] 2.2 Lint/format czyste: `npm run lint` — d2310f7
- [x] 2.3 Istniejące e2e nie regresują: `npm run test:e2e` — d2310f7

#### Manual

- [x] 2.4 @320 brak poziomego scrolla na 8 stronach (gość + zalogowany) — d2310f7
- [x] 2.5 Hamburger/drawer: Escape zamyka, wybór linku nawiguje i zamyka, focus wraca — d2310f7
- [x] 2.6 `aria-expanded` poprawny, drawer osiągalny klawiaturą — d2310f7
- [x] 2.7 @≥sm nagłówek jak dotychczas (linki inline) — d2310f7
- [x] 2.8 Tap-targety hamburgera/linków/loga ≥44px — d2310f7

### Phase 3: Natywne kontrolki — stack pełnej szerokości @<sm

#### Automated

- [x] 3.1 Build przechodzi: `npm run build`
- [x] 3.2 Lint/format czyste: `npm run lint`

#### Manual

- [x] 3.3 @320 Chrome i Firefox: data katalogu, czasy TurnusyEditor, data rezerwacji nieprzycięte
- [x] 3.4 @≥sm kontrolki wracają do układu wielokolumnowego

### Phase 4: Pola hasła (auth)

#### Automated

- [ ] 4.1 Build przechodzi: `npm run build`
- [ ] 4.2 Lint/format czyste: `npm run lint`

#### Manual

- [ ] 4.3 @320 hasło nie chowa się pod ikoną oka (signin/signup/reset)
- [ ] 4.4 Toggle trafialny ≥44px, ikona na miejscu

### Phase 5: Sweep zawijania treści + tap-targetów

#### Automated

- [ ] 5.1 Build przechodzi: `npm run build`
- [ ] 5.2 Lint/format czyste: `npm run lint`
- [ ] 5.3 Istniejące e2e nie regresują: `npm run test:e2e`

#### Manual

- [ ] 5.4 @320 RequestsList/szczegóły zapytania/strona zagrody bez overflow, tokeny zawijają
- [ ] 5.5 Standalone linki i chipy ≥44px; linki inline-w-zdaniu bez naruszenia baseline
- [ ] 5.6 Badge nie deformuje się, data „Wysłano…" nie łamie układu

### Phase 6: Bramka regresji @320

#### Automated

- [ ] 6.1 Nowy spec @320 przechodzi: `npm run test:e2e`
- [ ] 6.2 Spec @320 asertuje tap-target ≥44 (hamburger + link) i rezerwę pola hasła, nie tylko overflow
- [ ] 6.3 Cała suita e2e zielona: `npm run test:e2e`
- [ ] 6.4 Lint/format czyste: `npm run lint`

#### Manual

- [ ] 6.5 Manualna checklista @320 (Chrome + Firefox) dla powierzchni authed zaliczona
- [ ] 6.6 Sanity: cofnięcie fixu Topbara wywala spec @320
