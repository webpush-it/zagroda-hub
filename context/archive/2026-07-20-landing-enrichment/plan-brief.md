# Wzbogacenie landing page (klient-first) — Plan Brief

> Full plan: `context/changes/landing-enrichment/plan.md`
> Research: `context/changes/client-first-landing/research.md`

## What & Why

Publiczny landing (`src/pages/index.astro`) jest klient-first, ale „zbyt ubogi" — niemal sam wyśrodkowany tekst, jedna karta, jeden kolor akcentu, zero ilustracji/ikon/trust-signali/FAQ. Wzbogacamy go wg najlepszych praktyk landing page'ów, czysto prezentacyjnie, w trzech niezależnie wdrażalnych fazach.

## Starting Point

Po slice S-09 (`client-first-landing`) strona ma: hero z centralnym CTA „Znajdź zagrodę" → `/katalog`, kompaktowy 3-liniowy pasek „jak to działa", jedną kartę „Prowadzisz zagrodę?", wiersz login/rejestracja i stopkę. Gwarancja anty-overbooking jest pogrzebana w karcie właściciela; brak korzyści dla szukającego, zaufania i FAQ.

## Desired End State

Bogatsza, wciąż klient-first strona: hero z ilustracją i linijką „bezpłatnie, bez konta"; rząd kart korzyści z ikonami; pasek zaufania z gwarancją braku podwójnej rezerwacji przeramowaną na język szukającego; czytelny 3-krokowy wizual; powtórzone CTA; uczciwe FAQ; lżejsza, drugorzędna sekcja właściciela; uzupełnione SEO. Rodziny zaproszone lekkim akcentem. Wszystko po polsku, mobile-first, bez nowych zależności/zdjęć, bez fałszywego social proof, bez obietnic funkcji spoza dziś.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Zakres funkcji | Tylko dostępne dziś | Nie obiecywać geolokalizacji/cen/filtrów (S-10/12/13 niezbudowane). | Research |
| Wizualia | Tylko istniejące zasoby marki | `bg-meadow`, `ZagrodaPlaceholder`, inline-SVG ikony; bez nowej fotografii. | Research |
| Social proof | Brak (tylko uczciwe sygnały) | Jeden realny właściciel-tester, recenzje to non-goal → gwarancja/prywatność/„bez konta". | Research |
| H1 | Bez zmian + naprawa e2e | Utrzymać działający client-first H1/SEO; naprawić rozjechany spec. | Plan |
| Persona rodzinna | Lekki akcent | Formularz szkolny do S-11; sub-headline + jedna linia FAQ, bez pełnej neutralizacji. | Plan |
| Sieć zagród | Omit | Brak potwierdzonej afiliacji — zero ryzyka implikowania partnerstwa. | Plan |
| FAQ | Natywne `<details>` | Zero JS, dostępne, zgodne z guardrailem „brak wysp na landingu". | Plan |
| Sticky CTA | Polegamy na topbarze | Topbar niesie trwałe CTA; bez dodatkowego JS/ryzyka okluzji. | Plan |
| Fazowanie | 3 fazy | Każda niezależnie wdrażalna/wycofywalna; P1 = najwyższy wpływ. | Research |

## Scope

**In scope:** karty korzyści; pasek zaufania (gwarancja przeramowana); akcent persony; naprawa `e2e/desktop-width.spec.ts`; ilustracja hero + reassurance; 3-krokowy wizual; powtórzone CTA; FAQ; odchudzenie sekcji właściciela; SEO w `Layout.astro` (canonical, Twitter Card, JSON-LD, meta description).

**Out of scope:** obietnice funkcji spoza dziś (najbliższe/ceny/filtry tematyczne); rewers do owner-first; fałszywy social proof / odniesienie do sieci zagród; nowa fotografia/zależności; React-wyspy na landingu; sticky mobile CTA; zmiana H1; pełna neutralizacja języka (S-11); zmiany danych/API/tras/auth/katalogu/formularza.

## Architecture / Approach

Trzy fazy edytujące głównie `src/pages/index.astro` (+ `Layout.astro` w P3, `e2e/desktop-width.spec.ts` w P1). Klocki: `card-surface`, `btn-primary/secondary`, `tap-target`, tokeny brand/accent, `ZagrodaPlaceholder`, inline-SVG ikony, natywne `<details>`. Bez nowych tokenów, wysp ani zdjęć; typograficzny rdzeń hero i budżet LCP < 2.5s zachowane.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Wartość i zaufanie | Karty korzyści + pasek zaufania (gwarancja dla szukającego) + akcent persony + naprawa e2e | Sprzężenie copy↔e2e (CI nie łapie) |
| 2. Hero i przepływ | Ilustracja hero + reassurance + 3-krokowy wizual + powtórzone CTA | Kolejność folda na mobile (CTA nad ilustracją) |
| 3. FAQ, właściciel, SEO | Uczciwe FAQ (`<details>`) + odchudzenie karty właściciela + canonical/Twitter/JSON-LD | JSON-LD bez `aggregateRating`; utrzymać uczciwość |

**Prerequisites:** brak (kontynuacja zamkniętego S-09; strona i zasoby już istnieją).
**Estimated effort:** ~2–3 sesje, 3 fazy, każda 1 commit + weryfikacja.

## Open Risks & Assumptions

- CI nie uruchamia e2e — zmiany dostępnych nazw/H1 nie są łapane automatycznie; e2e trzymane jako część kontraktu i naprawiane w P1.
- Lekki akcent rodzinny na landingu vs szkolny formularz (S-11 niezbudowane) — świadomie akceptowany drobny rozjazd do czasu S-11.
- Ikony inline SVG zamiast `lucide-react` — trochę ręcznej roboty, ale bez hydratacji (guardrail LCP/no-island).

## Success Criteria (Summary)

- Gość na telefonie widzi bogatszą, wciąż klient-first stronę: korzyści + uczciwe zaufanie + czytelne „jak to działa" + FAQ; katalog o jedno tapnięcie z góry.
- Zero fałszywego social proof i zero obietnic funkcji spoza dziś; wszystko po polsku, tap-target ≥44px, bez poziomego scrolla na 320–414px.
- `astro check`/`lint`/`build`/`test` zielone; e2e zsynchronizowany z aktualnym H1; SEO ma canonical/Twitter/JSON-LD bez `aggregateRating`.
