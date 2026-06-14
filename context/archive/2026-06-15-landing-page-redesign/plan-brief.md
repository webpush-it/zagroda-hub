# Przeprojektowanie strony głównej (landing) Zagroda Hub — Plan Brief

> Full plan: `context/changes/landing-page-redesign/plan.md`

## What & Why

Strona główna aplikacji to wciąż pozostałość po 10x Astro Starterze: tytuł „10x
Astro Starter", generyczne karty o technologii i kosmiczne tło — zero kontekstu
produktu. Cały backend Zagroda Hub jest gotowy i działa, ale landing nie mówi,
czym produkt jest ani dla kogo. Zastępujemy go domenową stroną główną mówiącą do
obu person z PRD (nauczyciel i właściciel zagrody).

## Starting Point

`src/pages/index.astro` renderuje `Welcome.astro` — hero „10x Astro Starter" +
tech-pitch + trzy generyczne karty + orby/pole gwiazd, z mieszanką PL/EN. Tytuł
domyślny w `Layout.astro` to „10x Astro Starter". Cała reszta apki (katalog,
panel) używa spójnego ciemnego motywu `bg-cosmic` + glassmorphism — to język
wizualny produktu, nie starter.

## Desired End State

`/` pokazuje stronę „Zagroda Hub": hero nazywający problem (telefony przerywają
właściciela / nauczyciel obdzwania zagrody) i rozwiązanie (mobilna rezerwacja z
gwarancją braku overbookingu), sekcję „jak to działa", dwa bloki person i stopkę.
CTA zmieniają się ze stanem logowania. Wygląd spójny z katalogiem i panelem,
bez kosmicznych orb.

## Key Decisions Made

| Decyzja                  | Wybór                                                | Dlaczego                                                                 | Source |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| Kierunek wizualny        | Zostać w ciemnym motywie apki, wyciąć orby/gwiazdy   | `bg-cosmic` jest app-wide; nowy motyw gryzłby się z katalogiem/panelem   | Plan   |
| Struktura strony         | Hero + jak to działa + dwie persony + stopka         | Tłumaczy produkt obu personom w jednym scrollu                           | Plan   |
| CTA                       | Dwa CTA świadome stanu (anonim vs zalogowany właściciel) | Trafia w obie persony z PRD; nie pokazuje „zarejestruj" zalogowanemu | Plan   |
| Tytuł/meta                | Zmiana domyślnego title + meta description + OG (tekstowe) | Usuwa najbardziej widoczną pozostałość startera                     | Plan   |
| Favicon / obraz OG        | Bez zmiany — zależne od dostarczenia assetu          | Generowanie grafiki poza zakresem planu kodu                            | Plan   |

## Scope

**In scope:** tytuł + meta/OG w `Layout.astro`; nowa treść i layout landinga
(`index.astro`, rozbiórka `Welcome.astro`); CTA świadome logowania; stopka.

**Out of scope:** nowy/jasny motyw wizualny; zmiany w nawigacji i innych stronach;
podmiana faviconu i dedykowany obraz OG; backend/dane/API; FAQ i social proof.

## Architecture / Approach

Czysto frontendowa zmiana w warstwie Astro. Faza 1 porządkuje `<head>`/branding w
layoucie. Faza 2 buduje stronę z sekcji wprost w `index.astro`, kopiując klasy i
wzorce z `katalog.astro` (glass cards, gradient nagłówki, `purple-600` buttony) i
logikę stanu z `Topbar.astro` (`Astro.locals.user`). Brak nowych zależności.

## Phases at a Glance

| Faza                         | Co dostarcza                                          | Główne ryzyko                                  |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| 1. Branding i metadane       | „Zagroda Hub" w title + meta/OG                       | Drobne — sprawdzić, że żadna strona nie polegała na starym domyślnym title |
| 2. Przeprojektowanie landinga | Nowa strona główna (hero, kroki, persony, stopka, CTA) | Copywriting i spójność wizualna z resztą apki  |

**Prerequisites:** brak (backend i route'y już istnieją).
**Estimated effort:** ~1 sesja, 2 fazy.

## Open Risks & Assumptions

- Favicon i obraz OG zostają domyślne — pełne brandowanie wymaga osobnego assetu (follow-up).
- Copy sekcji jest pisane na podstawie PRD; warto je przejrzeć okiem właściciela produktu.

## Success Criteria (Summary)

- `/` przedstawia Zagroda Hub i jego wartość obu personom; zero „10x Astro Starter"/„Sign In".
- Landing wizualnie spójny z katalogiem i panelem, czytelny na telefonie w pionie.
- CTA i ścieżki poprawne i zależne od stanu zalogowania.
