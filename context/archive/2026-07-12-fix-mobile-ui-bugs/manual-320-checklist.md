# Manualna checklista @320 — powierzchnie authed

Uzupełnienie automatycznej bramki `e2e/mobile-320.spec.ts` (która pokrywa tylko
powierzchnie publiczne bez seedowania). Poniższe wymagają logowania/seedu, więc
weryfikujemy je ręcznie w DevTools przy **320px** — w **Chrome i Firefox** (różny
intrinsic-min natywnych kontrolek). Zaznacz każdą pozycję po obu silnikach.

## Jak przygotować

1. `npm run build && npx wrangler dev` (lub środowisko z seedem).
2. Zaloguj się jako właściciel z danymi testowymi (patrz `e2e/helpers/seed.ts`).
3. DevTools → Toggle device toolbar → Responsive → szerokość **320px**.
4. Powtórz cały przebieg w Chrome, potem w Firefox.

## Powierzchnie

### Dashboard — TurnusyEditor (`/dashboard`, edycja zagrody)

- [ ] Chrome: brak poziomego scrolla strony.
- [ ] Firefox: brak poziomego scrolla strony.
- [ ] Dwa pola `time` (start/koniec) stają na pełną szerokość @<sm — nieprzycięte, bez overflow.
- [ ] @≥sm wracają do układu dwukolumnowego.
- [ ] Przycisk delete turnusu ma tap-target ≥44px.

### Lista zapytań — RequestsList (`/dashboard/zapytania`)

- [ ] Chrome / Firefox: brak poziomego scrolla.
- [ ] Chipy filtrów mają tap-target ≥44px.
- [ ] Rząd badge + „Wysłano <data>" nie łamie układu (data `whitespace-nowrap`, badge `shrink-0`).
- [ ] Długa etykieta turnusu zawija/truncuje zamiast rozpychać wiersz.
- [ ] StatusBadge nie deformuje się (bez zawijania tekstu statusu).

### Szczegóły zapytania (`/dashboard/zapytania/[id]`)

- [ ] Chrome / Firefox: brak poziomego scrolla.
- [ ] Wiersze Turnus i imię gościa: długi label/token nie ściska `dt` (wzorzec z rzędu E-mail).
- [ ] Przyciski decyzji „Tak, odrzuć"/„Tak, cofnij" bez clippingu; tap-target ≥44px.

### Strona zagrody — widok właściciela/publiczny (`/zagrody/[id]`)

- [ ] Chrome / Firefox: brak poziomego scrolla.
- [ ] `h1` nazwy zagrody zawija (`break-words`) — bez overflow.
- [ ] Wiersz turnusu (`justify-between`) truncuje długi tekst.
- [ ] Linki „← Wróć do katalogu" / „Przejdź do katalogu" mają tap-target ≥44px.

## Sanity bramki automatycznej

- [ ] Tymczasowe cofnięcie fixu Topbara (usuń responsywność nagłówka) → `npm run test:e2e`
      wywala test overflow @320 na `/` i `/katalog`. Przywróć fix po sprawdzeniu.
