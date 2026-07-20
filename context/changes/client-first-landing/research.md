---
date: 2026-07-20T09:13:42+0200
researcher: Konrad Beśka
git_commit: baa79243d1ed08063684d20153db50f05938da33
branch: master
repository: zagroda-hub
topic: "Wzbogacenie landing page (klient-first) wg najlepszych praktyk"
tags: [research, codebase, landing, index-astro, conversion, ux, brand]
status: complete
last_updated: 2026-07-20
last_updated_by: Konrad Beśka
---

# Research: Wzbogacenie landing page (klient-first) wg najlepszych praktyk

**Date**: 2026-07-20T09:13:42+0200
**Researcher**: Konrad Beśka
**Git Commit**: baa79243d1ed08063684d20153db50f05938da33 (`baa7924`)
**Branch**: master
**Repository**: zagroda-hub

## Research Question

Obecny landing (`src/pages/index.astro`, klient-first po slice S-09) jest „zbyt ubogi". Jak go poprawić, biorąc pod uwagę najlepsze praktyki tworzenia landing page'ów — przy twardych ograniczeniach:

- **Tylko funkcje dostępne dziś** (browse katalogu z filtrami, zapytanie bez konta, gwarancja anty‑overbooking po stronie właściciela). Bez obietnic funkcji jeszcze niezbudowanych.
- **Tylko istniejące zasoby marki** (gradient `bg-meadow`, `Logo`, ilustracja `ZagrodaPlaceholder`, ikony, tokeny „Łąka i miód"). Bez nowej fotografii, bez zależności od danych katalogu.
- **Output**: analiza luk + konkretna, sekcja‑po‑sekcji specyfikacja przeprojektowania gotowa pod `/10x-plan`.

## Summary

Diagnoza „ubogi" jest trafna i mierzalna: strona to niemal wyłącznie tekst wyśrodkowany na kremowym tle — **jedna karta, jeden kolor akcentu (zieleń), zero ilustracji/ikon, zero sygnałów zaufania, brak sekcji korzyści i FAQ**. Wszystkie brakujące elementy da się zbudować z istniejącego słownika tokenów/utility bez nowych zależności ani zdjęć — kluczowo z **niewykorzystanej dotąd ilustracji `ZagrodaPlaceholder`** (skaluje się do hero) oraz **ikon wrysowanych jako statyczne SVG** (nie przez React‑island — patrz Architecture Insights).

Pięć najważniejszych wzbogaceń (wszystkie w granicach ograniczeń), uszeregowanych:

1. **Rząd korzyści dla szukającego (3–4 karty z ikoną) + przeniesienie gwarancji anty‑overbooking na język szukającego** jako sygnał zaufania. Zamyka dwie największe luki (artykulacja korzyści + brak uczciwego trust‑signalu) i daje najwięcej „ciężaru" wizualnego.
2. **Podniesienie „Jak to działa" do 3‑krokowego wizualu (ikony + karty) i powtórzenie głównego CTA** poniżej.
3. **Ilustracja `ZagrodaPlaceholder` w hero + linijka „bezpłatnie, bez konta"** tuż pod przyciskiem.
4. **Jawne zaadresowanie podwójnej persony (rodziny ORAZ szkoły)** we wspólnej treści + poszerzenie meta description.
5. **Zwięzłe, uczciwe FAQ** (konto? koszt? rodziny czy szkoły? termin? co po wysłaniu?) **+ higiena SEO** (canonical, Twitter card, opcjonalny JSON‑LD Organization/FAQPage — bez `aggregateRating`).

**Trzy twarde ostrzeżenia (honesty guardrails):**

- **Brak prawdziwego social proof.** Jeden realny właściciel‑tester, oceny/recenzje to jawny non‑goal → **żadnych testimoniali, gwiazdek, liczników „zaufało nam X", ścianek logotypów**. Zaufanie budujemy wyłącznie sygnałami weryfikowalnymi (gwarancja anty‑overbooking, prywatność kontaktu, „bez konta"). Odniesienie do Ogólnopolskiej Sieci Zagród Edukacyjnych **tylko jako kotwica kategorii** (tekst), nie jako deklaracja partnerstwa/członkostwa — chyba że realna afiliacja zostanie potwierdzona.
- **Nie obiecywać funkcji spoza dziś:** sortowanie „najbliżej mnie"/geolokalizacja (S‑10), ceny ofert (S‑12, BLOCKED), filtry temat/adresaci (S‑13, BLOCKED). To osobne, jeszcze niezbudowane slice'y.
- **Kilka wzbogaceń świadomie odwraca parked‑decyzje z `07-18`** (hero typograficzny bez ilustracji, brak ikon przy krokach, brak FAQ). To legalne — użytkownik prosi wprost o więcej „bogactwa" — ale musi być **wyborem świadomym**, nie dryfem. Decyzje wiążące (klient‑first, brak rewersu do owner‑first, motyw „Łąka i miód", brak fake‑proof) pozostają nienaruszone.

**Bonus — wykryty latentny błąd:** `e2e/desktop-width.spec.ts:26` wciąż asertuje **stary owner‑first H1** („Rezerwacje wycieczek do Twojej zagrody…"), podczas gdy landing od `dbf5563` ma H1 „Znajdź zagrodę edukacyjną…". Test jest już rozjechany z produkcją, a CI nie uruchamia e2e, więc nikt tego nie złapał. Każda zmiana H1 w tym wzbogaceniu **musi** zaktualizować ten spec (i najlepiej naprawić go już teraz).

## Detailed Findings

### A. Stan obecny strony (co dokładnie jest „ubogie")

Kolejność od góry (`src/pages/index.astro`):

1. Logo (przez `PageShell brand`, `PageShell.astro:29-33`).
2. Hero: `<h1>` „Znajdź zagrodę edukacyjną na wycieczkę — w swoim województwie." + jeden akapit + jedno CTA „Znajdź zagrodę" → `/katalog` (`index.astro:24-43`).
3. Kompaktowy 3‑liniowy pasek „jak to działa" (numerowane kółka, mały wyszarzony tekst) (`index.astro:45-59`).
4. Jedna biała karta „Prowadzisz zagrodę?" z akapitem‑ścianą tekstu i CTA właściciela (`index.astro:61-82`).
5. Wiersz „Masz już konto zagrody?" — login/rejestracja, tylko dla gościa (`index.astro:84-99`).
6. Jednolinijkowa stopka (`index.astro:101-104`).

Źródła wrażenia „ubogi": (a) zero obrazów/ikonografii, (b) monochromia zieleń‑na‑kremie (honey `accent-*` w ogóle nieużyty), (c) jednolite wyśrodkowanie bez siatki kart, która nadałaby kształt. CTA prowadzi na `/katalog` — formularz filtrów (Województwo, Miasto, Data wycieczki, Liczba osób) + lista `ZagrodaCard`. To potwierdza dokładny zestaw funkcji „na dziś".

### B. Dostępne klocki (inwentarz — bez nowych zależności/zdjęć)

Pełny inwentarz w `src/styles/global.css`:

- **Tokeny koloru** (`@theme`, `global.css:32-48`): brand `50 #f1f6ec / 100 / 200 #c6dcb4 / 600 #3f7d2c / 700 #336423 / 800`; honey accent `100 #f6e8d5 / 400 #d98e2b / 600 (dekor) / 700 #8a4407 (bezpieczny tekst 6.62:1)`; neutralne `surface #f7f5ef / ink #27301f / ink-muted #5b6350 / link / edge / edge-strong`. **Paleta jest celowo rzadka** — brak rung 300/400/500/900 brand i większości accent; nie wymyślać nowych.
- **Utility sekcji/układu**: `bg-meadow` (jedyny gradient, `:160-163`), `card-surface` (biała karta z cieniem, `:167-176`), `tap-target` (min‑height 44px, `:232-236`), `input-field` (`:240-256`).
- **CTA (dokładne stringi z repo — używać verbatim)**: `btn-primary px-6 py-3 text-base` (duże CTA landing, `index.astro:7`), `btn-secondary px-6 py-3 text-base`, `btn-primary px-4 text-sm` (kompakt w Topbar, `Topbar.astro`), `btn-primary w-full` (formularze). `btn-primary`/`btn-secondary` to `@utility` (`global.css:180-227`).
- **Ilustracja `ZagrodaPlaceholder.astro`** — pełna scena SVG (słońce, trzy warstwy łąki, gospodarstwo, płot, kwiaty), `viewBox 0 0 400 225` (16:9), `preserveAspectRatio slice` (jak `object-cover`), `aria-hidden`, jedyny prop `class`. **Dziś użyta wyłącznie jako miniatura 80×80** w `ZagrodaCard.astro:36`, `zagrody/[id].astro:76`, `404.astro:9`. **Najmocniejszy kandydat na wizual hero** — skaluje się do dowolnego kontenera, paleta 1:1 z marką.
- **Logo.astro** — logomark + wordmark; za mały/prosty na hero, dobry do nagłówka/stopki.
- **Ikony**: `lucide-react` zainstalowany, używany w 17 komponentach React (`Calendar, Clock, MapPin, Users, Home, Send, CircleCheck, Phone, Mail, Lock, KeyRound, Search…`). **Nieużywany w żadnym pliku `.astro`.** Na landingu (czyste Astro, bez islands) ikony należy **wrysować jako statyczny SVG**, nie ciągnąć React‑islanda (patrz Architecture Insights).
- **Font**: Nunito variable 400–800, self‑hosted + preload, latin‑ext (polskie znaki); dostępne `font-extrabold` (800) na duże nagłówki.
- **Brak** (musiałoby powstać z tokenów, bez nowych deps): reużywalny Badge/Pill, komponent Stat/KPI, Testimonial (i tak zakazany), karta „ikona+tytuł+tekst", Accordion/FAQ, kolorowy full‑bleed pas sekcji (tokeny `brand-50`/`accent-100` istnieją, brak utility). `src/components/ui/` zawiera tylko `button.tsx` (nieużywany na landingu).

### C. Analiza luk vs najlepsze praktyki (uszeregowana wg wpływu)

1. **Rząd korzyści + trust** (najwyższy wpływ, niski koszt): dziś korzyści są ukryte w akapicie i pasku kroków; brak dedykowanego bloku „co z tego masz". Gwarancja anty‑overbooking — najmocniejszy uczciwy sygnał zaufania — **jest pogrzebana w karcie właściciela**, gdzie szukający jej nie przeczyta. Rekomendacja: 3–4 karty `card-surface` z ikoną (tylko funkcje na dziś) + osobny „trust strip" z gwarancją przeramowaną na język szukającego.
2. **„Jak to działa" jako 3‑krokowy wizual + powtórzone CTA**: obecny pasek to najlżejszy element strony; podnieść do 3 kart z ikoną i tytułem, dodać domykające CTA „Znajdź zagrodę" niżej (strona się wydłuża, użytkownik potrzebuje CTA tam, gdzie rośnie przekonanie).
3. **Hero z ilustracją + reassurance line**: fold to ~100% typografia. Dodać `ZagrodaPlaceholder` (2 kolumny na `lg`, stack na mobile z ilustracją POD CTA, by nie spychać przycisku poniżej folda) + linijka pod przyciskiem: „Przeglądanie i wysłanie zapytania są bezpłatne. Konto nie jest potrzebne."
4. **Podwójna persona (rodziny + szkoły)**: dziś strona przechyla się w stronę szkół („na wycieczkę", „zapytania nauczycieli"). Rodzina może odbić jako „to narzędzie B2B dla szkół". Uczciwa uwaga: **formularz zapytania nadal mówi językiem szkolnym** (neutralizacja to S‑11, jeszcze nie dowiezione) — landing może zapraszać rodziny w treści, ale nie obiecywać w pełni „rodzinnego" formularza. → Open Question.
5. **FAQ + SEO**: brak obsługi obiekcji (konto? koszt? dla kogo?). FAQ to tania obsługa obiekcji, wizualne bogactwo i SEO. SEO: brak `<link rel="canonical">` (mimo że `Layout.astro` liczy `canonicalUrl`), brak Twitter Card, brak JSON‑LD. **Bez `aggregateRating`** (to byłby fake‑proof).

### D. Ton, historia i wiążące decyzje (czego nie ruszać)

- **Ton**: praktyczny, wiejski, konkretny, bez żargonu, rzeczowy (nie „śmieszny"). Słownik do utrzymania: *zagroda edukacyjna, wycieczka klasowa, turnus, województwo/miasto, dzienny limit, jednym tapnięciem, prosto z terenu*. Unikać hiperboli (dawne „obdzwania pół województwa" było flagowane). Źródło: `context/archive/2026-07-18-landing-page-content-and-design/research.md:92-96,192-196`.
- **Wiążące (NIE otwierać)**: klient‑first (FR‑019, roadmap S‑09); brak rewersu do owner‑first; **podaż idzie kanałami bezpośrednimi, nie przez landing** (roadmap `:79`) → nie „naprawiać" podaży rozdmuchiwaniem sekcji właściciela; CTA ląduje na `/katalog` bez nowego backendu; motyw „Łąka i miód" (grep‑gate zakazuje `bg-cosmic|purple-|backdrop-blur|from-blue-200|…` w `src/`); jeden `<h1>`; `PageShell width="wide"`; bez nowych tokenów.
- **Parked w `07-18`, teraz świadomie odwracane przez tę prośbę**: hero typograficzny bez ilustracji; brak ikon przy krokach/korzyściach (były tylko numerowane kółka); brak FAQ; brak sticky mobile CTA. Odwrócenie jest OK, o ile jawne.

### E. Sprzężenie z testami e2e (load‑bearing, łatwe do przeoczenia)

Playwright używa dostępnych nazw (bez `data-testid`), a **CI nie uruchamia e2e** → zmiany copy mogą po cichu zepsuć testy.

- `e2e/desktop-width.spec.ts:26` — **już rozjechany**: asertuje stary H1 „Rezerwacje wycieczek do Twojej zagrody — w jednym miejscu, prosto z telefonu.", którego na stronie nie ma od `dbf5563`. Do naprawy.
- `e2e/smoke.spec.ts:13` — asertuje `heading „Katalog zagród"` (to `/katalog`, nie landing — stabilne, ale nie zmieniać tego nagłówka katalogu).
- Stabilne muszą pozostać hrefy i dostępne nazwy CTA: `/katalog`, `/auth/signup`, `/auth/signin`, `/dashboard`, `/dashboard/zapytania`.

## Proponowana specyfikacja przeprojektowania (sekcja po sekcji)

Kolejność od góry. Wszystko na `PageShell width="wide"`, mobile‑first single‑column, tap‑target ≥44px, polski, ikony jako **inline SVG** (bez React‑island). Copy poniżej to propozycja do dopracowania na etapie planu.

### 1. Hero (wzbogacony, wciąż typograficzny rdzeń + ilustracja)
- Układ: `lg:grid-cols-2` (copy lewo / ilustracja prawo w ramce w stylu `card-surface`), na mobile stack z ilustracją **pod** CTA.
- H1 (do decyzji — jeśli zmieniony, zaktualizować e2e): utrzymać obecny „Znajdź zagrodę edukacyjną na wycieczkę — w swoim województwie." lub poszerzyć o persony (patrz sekcja 4).
- Sub‑headline z kotwicą podwójnej persony: „Dla szkół i przedszkoli — i dla rodzin szukających pomysłu na dzień z dziećmi." + zdanie o korzyści „bez zakładania konta i bez obdzwaniania kolejnych gospodarstw."
- CTA: `<a class="btn-primary px-6 py-3 text-base">Znajdź zagrodę</a>` → `/katalog` (nazwa i href bez zmian).
- Reassurance micro‑copy tuż pod CTA: „Przeglądanie i wysłanie zapytania są bezpłatne. Konto nie jest potrzebne."
- Wizual: `ZagrodaPlaceholder` w kontenerze (rounded, `border-edge`), `aria-hidden` zostaje.
- Zalogowany właściciel: drugorzędny link „Przejdź do panelu" → `/dashboard` (jak dziś, `btn-secondary`).

### 2. Rząd korzyści dla szukającego (NOWA sekcja — tylko funkcje na dziś)
3–4 karty `card-surface`, każda z inline‑SVG ikoną:
- „Wszystkie zagrody w jednym miejscu" — „Zamiast obdzwaniać gospodarstwo po gospodarstwie — przeglądasz oferty w swoim województwie na jednej stronie."
- „Bez zakładania konta" — „Wysyłasz zapytanie od razu. Bez rejestracji i bez kolejnego hasła."
- „Sprawdzisz termin od ręki" — „Wybierasz datę i liczbę osób, a katalog pokazuje, które zagrody są wtedy dostępne." (NIE „od razu zarezerwujesz" — potwierdza gospodarz.)
- „Zapytanie w kilka minut" — „Krótki formularz i gotowe — trafia prosto do gospodarza."

### 3. Trust strip (NOWA — wyłącznie sygnały uczciwe)
Krótkie linie ikona+tekst, gwarancja przeramowana na szukającego:
- „Gwarancja braku podwójnej rezerwacji — gdy gospodarz potwierdzi Twój termin, jest tylko Twój; system pilnuje dziennego limitu miejsc, nawet gdy kilka grup pyta o ten sam dzień."
- „Twoje dane kontaktowe trafiają wyłącznie do wybranego gospodarza."
- „Nie zakładamy konta i nie wysyłamy newsletterów."
- (Opcjonalnie, TYLKO jako kotwica kategorii, tekst) „Katalog gromadzi zagrody edukacyjne — ten sam typ gospodarstw, który znasz z Ogólnopolskiej Sieci Zagród Edukacyjnych." — nie jako partnerstwo, chyba że potwierdzone.

### 4. „Jak to działa" — 3 kroki jako wizual (przebudowa istniejącego paska)
Dokładnie 3 kroki (nie rozdmuchiwać), każdy jako karta z dużą inline‑SVG ikoną, pogrubionym tytułem i linią wsparcia + chevrony między krokami na desktopie:
1. „Znajdź zagrodę" — „Filtruj po województwie, mieście i terminie."
2. „Sprawdź termin" — „Zobacz, które zagrody są wolne w Twojej dacie."
3. „Wyślij zapytanie" — „Bez konta — gospodarz potwierdza rezerwację."

### 5. Domykające CTA (NOWA — powtórzenie głównej akcji)
Pas z tłem `accent-100` (`#f6e8d5`, tekst `accent-700`/`ink`) i **tym samym** CTA „Znajdź zagrodę" → `/katalog`. Etykieta identyczna jak w hero i topbarze (jedna akcja, nie wiele). Topbar pełni rolę de facto sticky CTA — dedykowany sticky bar opcjonalny (jeśli dodany: pojedynczy `btn-primary`, ≥44px, tylko dla gościa).

### 6. FAQ (NOWA — natywne `<details>` lub proste karty, ≥44px)
Pytania uczciwe do dzisiejszego zakresu (kandydat do JSON‑LD FAQPage):
- „Czy muszę mieć konto, żeby wysłać zapytanie?" — „Nie. Wybierasz zagrodę, wypełniasz krótki formularz i wysyłasz — bez rejestracji."
- „Ile to kosztuje?" — „Przeglądanie katalogu i wysłanie zapytania są bezpłatne. Warunki wizyty ustalasz bezpośrednio z gospodarzem." (bez cen — S‑12 nie dowiezione)
- „Czy to tylko dla szkół, czy też dla rodzin?" — „Dla jednych i drugich — katalog i zapytanie są te same."
- „Jak sprawdzę, czy zagroda jest wolna w moim terminie?" — „Ustawiasz datę i liczbę osób; ostateczne potwierdzenie wysyła gospodarz."
- „Co się dzieje po wysłaniu zapytania?" — „Trafia prosto do gospodarza, który potwierdza lub odrzuca; dzięki limitowi miejsc dzień nie zostanie zarezerwowany ponad limit."

### 7. Sekcja właściciela „Prowadzisz zagrodę?" (utrzymana, lżejsza, wizualnie drugorzędna)
Rozbić akapit‑ścianę na 2 punkty z ikoną, by dwie wartości nie zlewały się:
- „Zarządzaj rezerwacjami z telefonu, jedną ręką, prosto z terenu — akceptuj lub odrzucaj jednym tapnięciem."
- „System pilnuje dziennego limitu miejsc — ten sam dzień nie zostanie zarezerwowany ponad limit, nawet gdy kilku nauczycieli pisze naraz."
Jedno CTA właściciela (gość → „Załóż konto zagrody" `/auth/signup`; właściciel → „Przejdź do panelu" `/dashboard`). **Nie** rozrastać do drugiego hero (lock klient‑first).

### 8. Login/rejestracja (tylko gość) + stopka — bez zmian funkcjonalnych.

### 9. Layout/SEO (`src/layouts/Layout.astro`)
- Dodać `<link rel="canonical" href={canonicalUrl}>` (wartość już liczona, dziś tylko w `og:url`).
- Dodać Twitter Card (`summary_large_image`, title/description/image).
- Opcjonalnie JSON‑LD `Organization`/`WebSite` (+ `FAQPage` jeśli FAQ wejdzie) — **bez `aggregateRating`**.
- Poszerzyć meta description landingu o rodziny (persona + SEO).

## Sugerowane fazowanie pod /10x-plan

- **Faza 1 (największy wpływ / najniższe ryzyko)**: rząd korzyści (sekcja 2) + trust strip z przeramowaną gwarancją (sekcja 3) + kotwica podwójnej persony w sub‑headline (część sekcji 1/4). Czysto prezentacyjne, inline‑SVG ikony.
- **Faza 2**: hero z ilustracją `ZagrodaPlaceholder` + reassurance line (sekcja 1); 3‑krokowy wizual (sekcja 4); domykające CTA (sekcja 5). Naprawić `desktop-width.spec.ts:26` jeśli H1 się zmieni.
- **Faza 3**: FAQ (sekcja 6) + higiena SEO/Layout (sekcja 9) + odchudzenie sekcji właściciela (sekcja 7).

Każda faza samodzielnie wdrażalna i wycofywalna (rewert = jeden/dwa pliki), zgodnie z wzorcem poprzednich landing‑slice'ów.

## Code References

- `src/pages/index.astro` — obecny landing (klient‑first, `dbf5563`); sekcje: hero `:24-43`, „jak to działa" `:45-59`, karta właściciela `:61-82`, login/rejestracja `:84-99`, stopka `:101-104`; aliasy klas `:7-9`.
- `src/pages/katalog.astro` — cel CTA; formularz filtrów potwierdza zakres funkcji na dziś (województwo/miasto/data/liczba osób).
- `src/components/brand/ZagrodaPlaceholder.astro` — niewykorzystana ilustracja hero (viewBox 16:9, `aria-hidden`).
- `src/components/brand/Logo.astro` — logomark/wordmark.
- `src/components/PageShell.astro:19,29-33` — `bg-meadow` root, prop `brand`, warianty szerokości.
- `src/styles/global.css:32-48` (tokeny), `:160-176` (`bg-meadow`, `card-surface`), `:180-227` (`btn-primary/secondary`), `:232-236` (`tap-target`).
- `src/layouts/Layout.astro` — meta/OG (liczy `canonicalUrl`, brak `<link rel=canonical>` i Twitter Card).
- `src/components/Topbar.astro` — trwałe CTA gościa „Znajdź zagrodę" (`btn-primary px-4 text-sm`).
- `e2e/desktop-width.spec.ts:26` — **rozjechany** asert starego H1; `e2e/smoke.spec.ts:13` — „Katalog zagród".

## Architecture Insights

- **Ikony bez React‑islanda.** Landing to czyste Astro SSR bez wysp; `lucide-react` wymaga hydratacji. Wiążący guardrail z `07-18` (LCP < 2.5s na wiejskich łączach, brak nowych wysp na stronach publicznych) → **ikony wrysować jako statyczne SVG** (skopiowane ścieżki lucide lub proste własne), nie przez `lucide-react`. To godzi rekomendację „więcej ikon" z guardrailem wydajności.
- **Bogactwo z istniejących prymitywów.** Cała paleta wzbogaceń (karty `card-surface`, CTA `btn-*`, tokeny brand/accent, nagłówki Nunito 800, skalowana `ZagrodaPlaceholder`, tint sekcji `accent-100`, inline‑SVG) nie wymaga żadnej nowej zależności ani zdjęć.
- **Uczciwość > konwencja.** Standard landingów mocno stoi na social proof; ten produkt go nie ma i nie sfałszuje. Zastępniki to weryfikowalne sygnały (gwarancja, prywatność, „bez konta") — one też są „best practice", tyle że uczciwą.
- **Sprzężenie copy↔e2e bez siatki CI.** Zmiany dostępnych nazw/H1 nie są łapane przez CI; traktować e2e specs jako część kontraktu tej zmiany i aktualizować razem z copy.

## Historical Context (from prior changes)

- `context/archive/2026-07-18-landing-page-content-and-design/{research.md,plan.md}` — poprzednia (owner‑first) treść i ton; parked‑decyzje (hero typograficzny, brak ikon/FAQ, brak sticky CTA); grep‑gate motywu; sprzężenie e2e.
- `context/archive/2026-06-15-landing-page-redesign/` — pierwszy domenowy landing (ciemny „cosmic", w pełni odwrócony rebrandem `07-12`); „brak social proof w MVP → gwarancja + jak‑to‑działa jako zastępnik".
- Owner‑first copy przed flipem (do ewentualnego re‑kompaktowania gwarancji/korzyści): `git show a0f2749:src/pages/index.astro` — sekcje „Bez podwójnych rezerwacji — gwarantowane" i 3 karty korzyści.
- `context/foundation/roadmap.md:70-131,150-157` — S‑09 (ten landing) i późniejsze S‑10/S‑12/S‑13 (niedostępne dziś) + Non‑Goals.
- `context/foundation/prd-v2.md` (FR‑019, US‑04, persony), `context/foundation/shape-notes.md:56` (układ „logo, powitanie, na środku »Znajdź zagrodę«, logowanie na dole").
- `context/foundation/lessons.md:26-31` — flex `min-w-0` (istotne tylko jeśli redesign doda wiersze flex z długim tokenem).

## Related Research

- `context/archive/2026-07-18-landing-page-content-and-design/research.md` — najbliższy tematycznie artefakt (ton, guardraile, e2e).
- `context/changes/client-first-landing/plan.md` — plan slice'u S‑09, którego ten dokument jest kontynuacją.

## Open Questions

1. **H1**: utrzymać obecny („Znajdź zagrodę edukacyjną na wycieczkę — w swoim województwie.") czy poszerzyć o persony? Jeśli zmiana — **obowiązkowa** aktualizacja `e2e/desktop-width.spec.ts:26`. (Rekomendacja: naprawić ten spec od razu, niezależnie od decyzji o H1.)
2. **Podwójna persona vs formularz**: landing zaprasza rodziny, ale formularz zapytania mówi językiem szkolnym do czasu S‑11 (`group-type-neutral-language`, ready, nie done). Ile „rodzinnego" języka dać na landingu, by nie tworzyć rozjazdu z formularzem? Rozważyć zależność od S‑11.
3. **Kotwica sieci zagród**: czy istnieje realna afiliacja z Ogólnopolską Siecią Zagród Edukacyjnych? Jeśli nie — trzymać wyłącznie framing kategorii (tekst), bez logo/„partner".
4. **Zakres pod nowy change‑id?** Ten research zapisano w folderze zamkniętego slice'u `client-first-landing` (zgodnie z argumentem wywołania). Do realnego planowania warto rozważyć **nowy change** (np. `landing-enrichment`), by nie mieszać dwóch rund w jednym `change.md`.
5. **Sticky mobile CTA** — dodawać czy zostawić topbarowe CTA jako wystarczające (parked‑decyzja `07-18` mówiła „nie")? Rekomendacja: na razie polegać na topbarze.
