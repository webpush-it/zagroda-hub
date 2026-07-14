# Opcjonalny brand-header (logo) na odsłonach auth — Implementation Plan

## Overview

Dodajemy do `src/components/PageShell.astro` jeden nowy, opcjonalny prop `brand?: boolean` (domyślnie `false`), który renderuje wyśrodkowany, linkujący do `/` logotyp (`<Logo variant="full" />`) **nad** slotem. Włączamy go na 5 odsłonach auth (`signin`, `signup`, `forgot-password`, `reset-password`, `confirm-email`), które po refaktorze RWD nie mają Topbara. Cel jest czysto UX: przywrócić obecność marki (zaufanie/rozpoznawalność na ekranach logowania — typowy cel phishingu) oraz drogę powrotu do aplikacji (escape hatch), **bez** przywracania pełnego Topbara z nawigacją, którą świadomie usunięto z auth.

## Current State Analysis

Stan po zmianie `refactor-responsive-web-design` (zarchiwizowany/zamknięty):

- `PageShell.astro:22-28` — powłoka renderuje `Layout` wewnętrznie, a w wyśrodkowanym kontenerze `mx-auto w-full <widthClass>` układa `{showTopbar && <Topbar />}` a potem `<slot />`. Wariant `align="center"` owija outer w `flex items-center justify-center`, więc kolumna (logo + karta) będzie wyśrodkowana jako grupa w obu osiach.
- **Wszystkie 5 stron auth** używają dokładnie tego samego kontraktu: `<PageShell width="narrow" align="center" showTopbar={false}>` ze slotem = `<div class="card-surface">` zawierającym `<h1>` (tytuł formularza) — potwierdzone w `signin.astro:9-19`, `signup.astro:9-19`, `forgot-password.astro:9-44`, `reset-password.astro:18-23`, `confirm-email.astro:9-44`.
- **Auth nie ma dziś żadnej marki ani linku powrotu** — `showTopbar={false}` usunął logo Topbara, a żadna z 5 stron nie renderuje `Logo` ani `href="/"`. Jedyne wyjścia to linki krzyżowe między auth (`signin`↔`signup`, `→signin`) — nic nie prowadzi do aplikacji.
- `Logo.astro` — komponent współdzielony; `variant="full"` = znak + wordmark „Zagroda Hub" (`text-lg`). Topbar owija go w `<a href="/" class="tap-target" aria-label="Zagroda Hub — strona główna">` (`Topbar.astro:29-31`) — to kanoniczny wzorzec brand-linku w tym repo.
- Gate'y e2e do utrzymania: `e2e/mobile-320.spec.ts` (@320 brak overflow, tap-target ≥44, password `pr-10`, date `appearance:none`) oraz `e2e/desktop-width.spec.ts` (kontrakt szerokości; mierzy `.bg-meadow > firstElementChild` jako kolumnę, m.in. na `/auth/signin` jako `narrow/center`).

## Desired End State

Po ukończeniu:

- `PageShell` ma prop `brand?: boolean = false`. Gdy `true`, nad slotem renderuje wyśrodkowany `<a href="/" aria-label="Zagroda Hub — strona główna"><Logo variant="full" /></a>` z odstępem dolnym; gdy `false` (domyślnie) — render bez zmian, więc **żadna z ~8 stron top-align nie zmienia się**.
- Wszystkie 5 stron auth przekazuje `brand` do `PageShell`; na każdej widać wyśrodkowane logo „Zagroda Hub" nad kartą, klikalne → `/`. Karty (`card-surface`, `<h1>`, formularze, wyspy React, przekazywanie `error`/searchParams, guard sesji w `reset-password`) — bez zmian.
- Auth **nadal nie ma Topbara/nawigacji** (`showTopbar={false}` bez zmian) — brand to pojedynczy link do strony głównej, nie menu.
- `mobile-320`, `desktop-width` i pełny `npm run test:e2e` zielone; nowa lekka asercja e2e potwierdza, że auth ma brand-link do `/` i **nie** ma nav Topbara.

**Weryfikacja end-state:** `npm run lint && npm run build` przechodzą; `/auth/signin` @320 bez horizontal scroll z logo nad kartą; klik w logo → `/`; `grep -c "brand" src/pages/auth/*.astro` = 1 w każdej z 5 stron; top-align strony (np. `/katalog`, `/dashboard`) wizualnie bez zmian.

### Key Discoveries:

- `PageShell.astro:22-28` — miejsce wstrzyknięcia: wewnątrz kolumny, przed `<slot />`; w `align="center"` grupa logo+karta pozostaje wyśrodkowana.
- `Topbar.astro:29-31` — gotowy wzorzec brand-linku (`href="/"`, `aria-label="Zagroda Hub — strona główna"`, `tap-target`) do skopiowania 1:1 dla spójności i tap-target ≥44px.
- `Logo.astro:13,17-24` — `variant="full"` domyślny; przyjmuje `class` (można dodać margines/wyśrodkowanie od zewnątrz).
- `desktop-width.spec.ts:24` — mierzy kolumnę jako `.bg-meadow`→`firstElementChild`; brand żyje **wewnątrz** tej kolumny (nie jest nowym pierwszym dzieckiem `.bg-meadow`), więc pomiar szerokości/centrowania pozostaje poprawny.

## What We're NOT Doing

- **Nie przywracamy Topbara ani nawigacji na auth** — `showTopbar` zostaje `false`; brand to wyłącznie logo-link do `/`.
- **Nie zmieniamy zachowania stron top-align** — `brand` domyślnie `false`; katalog/dashboard/zapytania/zagrody/404/anuluj/home bez zmian.
- **Nie ruszamy kart auth** (`card-surface`, `<h1>`, formularze, wyspy, `text-center` w `confirm-email`, guard sesji w `reset-password`, przekazywanie `error`/`sent`/`email`).
- **Nie parametryzujemy** headera (href/wariant/slot) — świadomie prosty boolean (YAGNI dla jednego przypadku użycia).
- **Nie dotykamy** `Logo.astro`, `Layout.astro`, `Topbar.astro` ani komponentów React.
- **Nie usuwamy** krzyżowych linków auth (`Nie masz konta?` itd.) — brand jest dodatkiem, nie zamiennikiem.

## Implementation Approach

Jedna zmiana strukturalna w powłoce (nowy opcjonalny, default-false prop → zero regresji na istniejących stronach), potem 5 trywialnych edycji call-site (dodanie `brand` do `<PageShell>`), na końcu lekki gate e2e chroniący przed cichą regresją (przypadkowy powrót Topbara / zniknięcie logo). Ponieważ prop jest default-false, Faza 1 jest bezpieczna dla całej reszty aplikacji, a jedyną realną powierzchnią ryzyka jest @320 (wysokość/overflow) — pokryte istniejącym `mobile-320` + weryfikacją manualną.

## Phase 1: Brand-header w PageShell + 5 stron auth

### Overview

Dodać opcjonalny brand-header do `PageShell` i włączyć go na wszystkich 5 stronach auth.

### Changes Required:

#### 1. Nowy prop `brand` w powłoce

**File**: `src/components/PageShell.astro`

**Intent**: Dodać opcjonalny, wyśrodkowany logo-link do `/` nad slotem, sterowany propem `brand`. Domyślnie wyłączony, więc istniejące strony top-align pozostają bez zmian. Realizuje „obecność marki + escape hatch" na ekranach bez Topbara.

**Contract**: Rozszerzyć `interface Props` o `brand?: boolean`; w destrukturyzacji `Astro.props` dodać `brand = false`. Zaimportować `Logo` z `@/components/brand/Logo.astro`. W kontenerze (`mx-auto w-full <widthClass>`), **przed** `<slot />` i po `{showTopbar && <Topbar />}`, renderować warunkowo `{brand && <a href="/" aria-label="Zagroda Hub — strona główna" class="tap-target mb-6 flex justify-center"><Logo variant="full" /></a>}`. Klasy i `aria-label` zgodne z brand-linkiem z `Topbar.astro:29-31` (spójność + tap-target ≥44px). Bez zmian w `outer`/`widthClass`/logice Topbara.

#### 2. Włączenie brand na stronach auth

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/forgot-password.astro`, `src/pages/auth/reset-password.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Na każdej z 5 stron dodać atrybut `brand` do istniejącego `<PageShell …>`, aby pokazać logo nad kartą. Żadnych innych zmian — zawartość slotu (karta, h1, formularze, wyspy, searchParams, guard sesji) bez modyfikacji.

**Contract**: W każdym pliku zmienić `<PageShell width="narrow" align="center" showTopbar={false}>` na `<PageShell width="narrow" align="center" showTopbar={false} brand>`. Nic poza tym.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking + lint: `npm run lint`
- [ ] Build przechodzi (adapter Cloudflare): `npm run build`
- [ ] `astro check` — brak błędów typów (nowy prop `brand`)
- [ ] `grep -lE "showTopbar=\{false\} brand" src/pages/auth/*.astro` zwraca wszystkie 5 stron

#### Manual Verification:

- [ ] Każda z 5 stron auth pokazuje wyśrodkowane logo „Zagroda Hub" nad kartą; klik → `/`
- [ ] Auth nadal bez Topbara/nawigacji (tylko brand-link)
- [ ] @320px brak horizontal scroll z logo; karta i formularze bez regresji; @393 i @1280 wyśrodkowane
- [ ] Strona top-align (np. `/katalog`, `/dashboard`) wizualnie identyczna jak przed zmianą (dowód, że default-false nie zmienia niczego)

**Implementation Note**: Po tej fazie i przejściu automated verification — pauza na manualne potwierdzenie (szczególnie @320 i brak regresji stron top-align) przed Fazą 2.

---

## Phase 2: E2E guard + weryfikacja

### Overview

Dodać lekką asercję e2e chroniącą kontrakt „auth ma brand-link do `/`, ale nie ma nav Topbara" i potwierdzić brak regresji istniejących gate'ów.

### Changes Required:

#### 1. Asercja brand + brak Topbara na auth

**File**: `e2e/desktop-width.spec.ts` (rozszerzenie) lub nowy krótki `e2e/auth-brand.spec.ts`

**Intent**: Zablokować dwie regresje niskim kosztem: (a) zniknięcie brand-linku z auth, (b) przypadkowy powrót nawigacji Topbara na auth. Preferować dołożenie asercji do istniejącego przypadku `/auth/signin` w `desktop-width.spec.ts` (już tam ładowany), by nie mnożyć plików; jeśli czytelniej — osobny mały spec.

**Contract**: Dla `/auth/signin` (repr. auth): assert `page.getByRole("link", { name: "Zagroda Hub — strona główna" })` jest widoczny i ma `href="/"`; assert brak linków nawigacyjnych Topbara na auth (`getByRole("link", { name: "Katalog" })` ma count 0). **Uzasadnić w komentarzu testu wybór „Katalog"**: to jedyny link renderowany wyłącznie przez Topbar — „Zaloguj się"/„Zarejestruj się" występują też jako krzyżowe linki auth, więc nie nadają się na dyskryminator „brak Topbara". Locatory wg konwencji `/10x-e2e` (role/name), bez `waitForTimeout`, test niezależny. Bez zmian w asercjach geometrii (kolumna nadal `.bg-meadow`→firstElementChild).

#### 2. Utrzymanie istniejących gate'ów

**File**: (weryfikacja, bez nowego kodu) `e2e/mobile-320.spec.ts`, `e2e/desktop-width.spec.ts`

**Intent**: Potwierdzić, że dodanie logo nie łamie @320 (overflow/tap-target) ani kontraktu szerokości.

**Contract**: Pełny `npm run test:e2e` zielony; selektory `mobile-320` bez zmian (brand-link niesie `tap-target`, ale gate mierzy hamburger/nav — auth nie ma hamburgera, więc bez kolizji).

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:e2e` — nowa asercja brand/no-nav zielona
- [ ] `npm run test:e2e` — `mobile-320.spec.ts` zielony (bez zmian asercji)
- [ ] `npm run test:e2e` — `desktop-width.spec.ts` zielony (geometria bez regresji)
- [ ] Pełny `npm run test:e2e` zielony (critical-flow, smoke, idor-contact-data włącznie)
- [ ] Lint + build: `npm run lint && npm run build`

#### Manual Verification:

- [ ] Klik w logo na każdej z 5 stron auth → ląduje na `/` (spójny escape hatch)
- [ ] @320 / @1280 auth: logo + karta wyśrodkowane, brak overflow, brak nav

**Implementation Note**: Po tej fazie zmiana jest kompletna; pauza na finalne manualne potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- Brak dedykowanych unitów (komponent czysto prezentacyjny, nowy prop boolean). Kontrakt Props weryfikowany przez `astro check`/TS.

### Integration Tests:

- Build SSR przez adapter Cloudflare (`npm run build`) jako integracja renderu 5 stron auth z brand-headerem.

### Manual Testing Steps:

1. `/auth/signin` @320px (DevTools) — logo nad kartą, brak horizontal scroll, formularz bez regresji.
2. Powtórzyć dla `signup`, `forgot-password`, `reset-password` (wymaga aktywnej sesji recovery — inaczej redirect do `forgot-password`, co też jest OK do sprawdzenia brandu), `confirm-email`.
3. Klik w logo → `/` na każdej stronie.
4. `/katalog` i `/dashboard` — potwierdzić brak zmian (prop default-false).
5. @1280 — logo + karta wyśrodkowane, `max-w-sm` bez zmian.

## Performance Considerations

Zmiana czysto prezentacyjna — jeden dodatkowy `<a>`+SVG (`Logo`) na stronach auth, renderowany server-side. Brak wpływu na wyspy React. `Logo` już jest w bundlu (używany przez Topbar).

## Migration Notes

Brak migracji danych. Rollback = revert commitu. Prop `brand` jest addytywny i default-false, więc nie wpływa na żadną istniejącą stronę.

## References

- Powłoka i kontrakt szerokości: `src/components/PageShell.astro` (change: refactor-responsive-web-design)
- Wzorzec brand-linku: `src/components/Topbar.astro:29-31`
- Komponent logo: `src/components/brand/Logo.astro`
- Gate'y e2e: `e2e/mobile-320.spec.ts`, `e2e/desktop-width.spec.ts`
- Strony auth: `src/pages/auth/{signin,signup,forgot-password,reset-password,confirm-email}.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Brand-header w PageShell + 5 stron auth

#### Automated

- [x] 1.1 Type checking + lint: `npm run lint`
- [x] 1.2 Build przechodzi (adapter Cloudflare): `npm run build`
- [x] 1.3 `astro check` — brak błędów typów (nowy prop `brand`)
- [x] 1.4 `grep -lE "showTopbar=\{false\} brand" src/pages/auth/*.astro` zwraca wszystkie 5 stron

#### Manual

- [x] 1.5 5 stron auth pokazuje wyśrodkowane logo nad kartą; klik → `/`
- [x] 1.6 Auth nadal bez Topbara/nawigacji (tylko brand-link)
- [x] 1.7 @320 brak overflow z logo; karta/formularze bez regresji; @393/@1280 wyśrodkowane
- [x] 1.8 Strona top-align (katalog/dashboard) wizualnie identyczna (default-false)

### Phase 2: E2E guard + weryfikacja

#### Automated

- [ ] 2.1 `npm run test:e2e` — asercja brand/no-nav zielona
- [ ] 2.2 `npm run test:e2e` — `mobile-320.spec.ts` zielony
- [ ] 2.3 `npm run test:e2e` — `desktop-width.spec.ts` zielony
- [ ] 2.4 Pełny `npm run test:e2e` zielony (critical-flow, smoke, idor-contact-data)
- [ ] 2.5 Lint + build: `npm run lint && npm run build`

#### Manual

- [ ] 2.6 Klik w logo na 5 stronach auth → `/`
- [ ] 2.7 @320/@1280 auth: logo + karta wyśrodkowane, brak overflow, brak nav
