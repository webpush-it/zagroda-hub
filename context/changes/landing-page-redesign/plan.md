# Przeprojektowanie strony głównej (landing) Zagroda Hub — Implementation Plan

## Overview

Zastępujemy starterowy landing (`src/components/Welcome.astro` + `src/pages/index.astro`)
domenową stroną główną Zagroda Hub. Obecna strona to pozostałość po 10x Astro
Starterze: tytuł „10x Astro Starter", generyczne karty tech („Authentication
Ready / Modern Stack / Developer Experience"), mieszanka językowa PL/EN i
dekoracja w postaci kosmicznych orb + pola gwiazd. Nowa strona tłumaczy produkt
obu personom z PRD (nauczyciel-gość oraz właściciel zagrody), prowadzi je do
właściwych ścieżek (katalog / rejestracja) i robi to w istniejącym języku
wizualnym aplikacji.

## Current State Analysis

- `src/pages/index.astro` (9 linii) renderuje wyłącznie `<Layout><Welcome /></Layout>`.
- `src/components/Welcome.astro` zawiera całą treść landinga: orby + star field
  (linie 6–25), hero z tytułem „10x Astro Starter" i tech-pitchem (32–39), trzy
  CTA z mieszanką języków „Przeglądaj katalog" / „Sign In" / „Sign Up" (40–59),
  oraz trzy generyczne karty tech (62–130). Komponent sam importuje i renderuje
  `<Topbar />` (linia 28).
- `src/layouts/Layout.astro:10` — domyślny `title = "10x Astro Starter"`; landing
  nie nadpisuje tytułu, więc starterowa nazwa zostaje w `<title>`. `<head>`
  zawiera tylko `charset`, `viewport`, `favicon` (`/favicon.png`) i `<title>` —
  brak `meta description` i tagów Open Graph.
- **Kluczowe odkrycie wizualne:** `bg-cosmic` to utility zdefiniowane w
  `src/styles/global.css:113` (ciemny gradient `#0a0e1a → #0f1529 → #0a0e1a`) i
  używane w całej aplikacji — `src/pages/katalog.astro:112`, Topbar, karty. Ciemny
  motyw + glassmorphism (`border-white/10 bg-white/5 backdrop-blur-xl`) +
  gradientowe nagłówki (`bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text
  text-transparent`) + akcent `purple-600` to **język wizualny produktu, nie
  starter**. Starterowe są wyłącznie orby/gwiazdy i tech-copy.
- `src/components/Topbar.astro` już rozróżnia stan: zalogowany (`Astro.locals.user`)
  pokazuje email + Katalog/Panel/Zapytania/Wyloguj; anonim pokazuje
  Katalog/Zaloguj się/Zarejestruj się. Landing może oprzeć logikę CTA na tym
  samym `Astro.locals.user`.
- Persony z `context/foundation/prd.md`: **właściciel zagrody** (primary,
  mobile-first, jednoręcznie w terenie) i **nauczyciel** (secondary, gość bez
  konta, szuka zagrody w województwie na termin). North star: zero overbookingu.

## Desired End State

Po wejściu na `/` użytkownik widzi stronę, która:
- W `<title>` i w hero nosi nazwę „Zagroda Hub" (nie „10x Astro Starter").
- Jednym zdaniem nazywa problem (telefony przerywają pracę właściciela /
  nauczyciel obdzwania zagrody) i rozwiązanie (mobilna rezerwacja z gwarancją
  braku overbookingu).
- Pokazuje, jak to działa (3 kroki) oraz osobne bloki wartości dla nauczyciela i
  właściciela.
- Daje dwa CTA świadome stanu: anonim → „Przeglądaj zagrody" (`/katalog`) +
  „Dodaj swoją zagrodę" (`/auth/signup`); zalogowany właściciel → „Panel"
  (`/dashboard`) + „Zapytania" (`/dashboard/zapytania`).
- Wygląda spójnie z katalogiem i panelem (ten sam `bg-cosmic` + glass + gradient),
  bez kosmicznych orb i pola gwiazd.
- Ma prostą stopkę (nazwa produktu + rok) i poprawne meta (description, OG).

Weryfikacja: `npm run build` przechodzi; `/` renderuje nową treść; brak
wystąpień „10x Astro Starter" i „Sign In/Sign Up" w wyniku; landing wizualnie
zgodny z `/katalog`; CTA zmieniają się po zalogowaniu.

### Key Discoveries:

- Język wizualny do naśladowania: `src/pages/katalog.astro:111-198` (kontener
  `bg-cosmic min-h-screen`, glass `rounded-2xl border border-white/10 bg-white/10
  backdrop-blur-xl`, gradient h1, przyciski `bg-purple-600 hover:bg-purple-500`).
- CTA/stan logowania: wzorzec z `src/components/Topbar.astro:8-48`
  (`const { user } = Astro.locals;`).
- `bg-cosmic` jako współdzielony utility: `src/styles/global.css:113`.
- Treść merytoryczna (problem, persony, north star, kroki flow): `context/foundation/prd.md`
  sekcje „Vision & Problem Statement", „User & Persona", „User Stories".

## What We're NOT Doing

- Nie wprowadzamy nowego/jasnego motywu wizualnego — zostajemy w ciemnym
  `bg-cosmic` apki (decyzja z planowania), żeby landing nie gryzł się z katalogiem
  i panelem, do których kieruje.
- Nie zmieniamy nawigacji (`Topbar.astro`) ani innych stron — **wyjątek**: tytuły
  stron auth (`signin.astro`, `signup.astro`) zmieniamy na polskie, bo landing
  kieruje na nie CTA i angielski tytuł „Sign up" psuje pierwsze wrażenie tuż za
  przyciskiem (Faza 1 #3). Treść formularzy auth pozostaje nietknięta.
- Nie podmieniamy pliku faviconu ani nie tworzymy dedykowanego obrazu OG —
  wymaga to assetu graficznego; zostaje istniejący `/favicon.png`. Tekstowe meta
  (description, OG title/description/type/url) robimy.
- Nie dotykamy backendu, schematu danych, API ani logiki rezerwacji.
- Nie dodajemy FAQ ani sekcji social proof (brak realnego social proof w MVP).

## Implementation Approach

Dwie fazy. Najpierw branding/metadane w `Layout.astro` (mała, niezależna, od
razu usuwa najbardziej widoczną pozostałość — tytuł w karcie przeglądarki).
Potem właściwa treść landinga: rozbieramy `Welcome.astro` i budujemy nową stronę
w `index.astro`, składając ją z czytelnych sekcji (hero, jak to działa, persony,
stopka). Wszystkie klasy i wzorce kopiujemy z istniejących stron (katalog,
Topbar), więc nie wymyślamy nowego stylu. CTA i ścieżki opieramy o
`Astro.locals.user`, dokładnie jak Topbar.

## Phase 1: Branding i metadane

### Overview

Usunięcie starterowej nazwy z tytułu strony i uzupełnienie podstawowych meta dla
landinga. Niezależne od reszty, daje natychmiast widoczny efekt w karcie
przeglądarki i w udostępnieniach linku.

### Changes Required:

#### 1. Domyślny tytuł i meta w layoucie

**File**: `src/layouts/Layout.astro`

**Intent**: Zmienić domyślny `title` z „10x Astro Starter" na „Zagroda Hub", tak
by każda strona bez własnego tytułu nosiła nazwę produktu. Dodać do `<head>`
`meta description` oraz tagi Open Graph (title, description, type, url) korzystając
z istniejącego propsa `title` i ewentualnie nowego opcjonalnego propsa `description`.

**Contract**: `interface Props { title?: string; description?: string }`; domyślny
`title = "Zagroda Hub"`. Nowe znaczniki w `<head>`: `<meta name="description">`,
`<meta property="og:title">`, `<meta property="og:description">`,
`<meta property="og:type" content="website">`, `<meta property="og:url">`
(url z `Astro.url`). Favicon pozostaje `/favicon.png` bez zmian.

#### 2. Tytuł i opis na landingu

**File**: `src/pages/index.astro`

**Intent**: Przekazać do `Layout` jawny tytuł landinga i opis (np. „Zagroda Hub —
rezerwacje wycieczek do zagród edukacyjnych"), żeby strona główna miała własny,
opisowy `<title>` i description niezależnie od domyślnego.

**Contract**: `<Layout title="…" description="…">`. (Treść strony zmienia Faza 2 —
tu chodzi tylko o propsy meta.)

#### 3. Polskie tytuły stron auth (pozostałość startera na ścieżce CTA)

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: Zmienić angielskie tytuły „Sign in" (`signin.astro:9`) i „Sign up"
(`signup.astro:9`) na polskie, spójne z resztą apki i z CTA landinga. Landing
aktywnie kieruje na `/auth/signup` przyciskiem „Dodaj swoją zagrodę" — docelowa
strona nie powinna witać użytkownika angielskim „Sign up".

**Contract**: `<Layout title="Zaloguj się">` (signin) i `<Layout title="Zarejestruj się">`
(signup). Tylko atrybut `title`, bez zmian w treści/logice formularzy. (Pełny
PL-pass treści wewnątrz formularzy auth — poza zakresem, ewentualny follow-up.)

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Lint przechodzi: `npm run lint`
- Brak wystąpień „10x Astro Starter" w `src/`: `grep -r "10x Astro Starter" src/` nic nie zwraca
- Brak tytułów „Sign in"/„Sign up" na stronach auth: `grep -rE 'title="Sign (in|up)"' src/pages/auth/` nic nie zwraca

#### Manual Verification:

- Karta przeglądarki na `/` pokazuje „Zagroda Hub …", nie „10x Astro Starter"
- Podgląd linku (np. w narzędziu OG / wklejenie do komunikatora) pokazuje sensowny tytuł i opis
- Strony `/auth/signin` i `/auth/signup` mają polskie tytuły w karcie przeglądarki

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj
się na potwierdzenie manualne, zanim ruszysz Fazę 2.

---

## Phase 2: Przeprojektowanie strony głównej

### Overview

Zastąpienie starterowej treści `Welcome.astro` domenową stroną główną: hero z
problemem/rozwiązaniem i dwoma CTA, sekcja „jak to działa", dwa bloki person,
stopka — w ciemnym motywie apki, bez orb i gwiazd.

### Changes Required:

#### 1. Nowa treść landinga

**File**: `src/pages/index.astro` (treść) — rozbierając obecny `src/components/Welcome.astro`

**Intent**: Zbudować stronę główną z sekcji:
- **Hero**: gradientowy nagłówek „Zagroda Hub", jedno-dwuzdaniowy lead opisujący
  problem (właściciel odbiera telefony w terenie / nauczyciel obdzwania zagrody)
  i rozwiązanie (mobilna rezerwacja z gwarancją braku overbookingu), oraz dwa CTA.
- **Jak to działa**: 3 kroki (np. „Znajdź zagrodę po województwie i terminie" →
  „Wyślij zapytanie" → „Właściciel akceptuje — bez ryzyka podwójnej rezerwacji").
- **Dwie persony**: blok dla nauczyciela (szukasz zagrody na wycieczkę) i blok
  dla właściciela (zarządzaj zapytaniami z telefonu, jednoręcznie, zero
  overbookingu) — każdy z własnym CTA/linkiem.
- **Stopka**: nazwa produktu + rok.
Cała treść po polsku, w klasach przeniesionych z `katalog.astro`/`Topbar.astro`
(glass cards, gradient h1, `purple-600` buttony). Usunąć orby i star field.

**Contract**: Sekcje używają wyłącznie istniejących utility/klas Tailwind z
projektu (`bg-cosmic`, `border-white/10 bg-white/5 backdrop-blur-xl`,
`from-blue-200 to-purple-200 bg-clip-text text-transparent`,
`bg-purple-600 hover:bg-purple-500`). Layout responsywny, czytelny w pionie na
mobile (guardrail z PRD). Topbar nadal renderowany na górze strony.

#### 2. CTA świadome stanu zalogowania

**File**: `src/pages/index.astro`

**Intent**: Uzależnić główne CTA od `Astro.locals.user` (wzorzec z Topbar). Anonim:
„Przeglądaj zagrody" → `/katalog` (primary) + „Dodaj swoją zagrodę" →
`/auth/signup` (secondary). Zalogowany właściciel: „Panel" → `/dashboard` +
„Zapytania" → `/dashboard/zapytania` (bez „zarejestruj się").

**Contract**: `const { user } = Astro.locals;` w frontmatter; warunkowy render
bloku CTA. Linki zgodne z istniejącymi route'ami (`/katalog`, `/auth/signup`,
`/dashboard`, `/dashboard/zapytania`).

#### 3. Uporządkowanie Welcome.astro

**File**: `src/components/Welcome.astro`

**Intent**: Po przeniesieniu treści do `index.astro` usunąć `Welcome.astro`
(lub, jeśli wygodniej dla implementera, zostawić go jako cienki komponent sekcji
landinga). Domyślnie: usunąć, bo `index.astro` przejmuje rolę. Zapewnić brak
martwych importów.

**Contract**: Brak odwołań do `@/components/Welcome.astro` po zmianie
(`grep -r "Welcome" src/` tylko jeśli świadomie zostawiony jako sekcja).

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Lint przechodzi: `npm run lint`
- Brak „Sign In"/„Sign Up"/„10x Astro Starter" na landingu: `grep -rE "Sign In|Sign Up|10x Astro Starter" src/pages/index.astro` nic nie zwraca
- Brak martwych importów `Welcome` (jeśli usunięty): `grep -r "Welcome" src/` nic nie zwraca

#### Manual Verification:

- `/` pokazuje hero z „Zagroda Hub", problem+rozwiązanie i dwa CTA
- Widoczne sekcje: jak to działa (3 kroki), blok nauczyciela, blok właściciela, stopka
- Brak kosmicznych orb / pola gwiazd; landing wizualnie spójny z `/katalog`
- Niezalogowany: CTA „Przeglądaj zagrody" + „Dodaj swoją zagrodę"; po zalogowaniu właściciela CTA → „Panel" / „Zapytania"
- Strona czytelna i klikalna na telefonie w pionie (guardrail PRD)
- Linki CTA prowadzą do właściwych stron (`/katalog`, `/auth/signup`, `/dashboard`, `/dashboard/zapytania`)

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj
się na potwierdzenie manualne (najlepiej zobaczyć stronę w obu stanach logowania).

---

## Testing Strategy

### Manual Testing Steps:

1. `npm run dev`, otwórz `/` jako niezalogowany — sprawdź hero, sekcje, dwa CTA i stopkę.
2. Kliknij „Przeglądaj zagrody" → ląduje na `/katalog`; „Dodaj swoją zagrodę" → `/auth/signup`.
3. Zaloguj się jako właściciel, wróć na `/` — CTA zmieniają się na „Panel" / „Zapytania".
4. Zwęź okno do szerokości telefonu (lub DevTools mobile) — układ czytelny w pionie, przyciski klikalne.
5. Sprawdź `<title>` w karcie i podgląd OG linku.

## References

- PRD (wizja, persony, north star): `context/foundation/prd.md`
- Wzorzec wizualny: `src/pages/katalog.astro:111-198`
- Wzorzec stanu logowania: `src/components/Topbar.astro:8-48`
- Definicja motywu: `src/styles/global.css:113`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Branding i metadane

#### Automated

- [x] 1.1 Build przechodzi: `npm run build` — 5d891f8
- [x] 1.2 Lint przechodzi: `npm run lint` — 5d891f8
- [x] 1.3 Brak wystąpień „10x Astro Starter" w `src/` (cross-phase: domyka się w Fazie 2 po usunięciu Welcome.astro)
- [x] 1.4 Brak tytułów „Sign in"/„Sign up" na stronach auth — 5d891f8

#### Manual

- [x] 1.5 Karta przeglądarki na `/` pokazuje „Zagroda Hub …" — 5d891f8
- [x] 1.6 Podgląd linku (OG) pokazuje sensowny tytuł i opis — 5d891f8
- [x] 1.7 Strony `/auth/signin` i `/auth/signup` mają polskie tytuły — 5d891f8

### Phase 2: Przeprojektowanie strony głównej

#### Automated

- [x] 2.1 Build przechodzi: `npm run build`
- [x] 2.2 Lint przechodzi: `npm run lint`
- [x] 2.3 Brak „Sign In"/„Sign Up"/„10x Astro Starter" na landingu
- [x] 2.4 Brak martwych importów `Welcome` (jeśli usunięty)

#### Manual

- [x] 2.5 Hero z „Zagroda Hub", problem+rozwiązanie i dwa CTA
- [x] 2.6 Widoczne sekcje: jak to działa, blok nauczyciela, blok właściciela, stopka
- [x] 2.7 Brak orb/gwiazd; spójność wizualna z `/katalog`
- [x] 2.8 CTA świadome stanu logowania (anonim vs właściciel)
- [x] 2.9 Czytelność i klikalność na telefonie w pionie
- [x] 2.10 Linki CTA prowadzą do właściwych stron
