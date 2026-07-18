---
date: 2026-07-18T10:11:55+0200
researcher: Konrad Beśka
git_commit: 5f227c1d53030dca234999c4279ad2a0bd34df36
branch: master
repository: zagroda-hub
topic: "Jak najlepiej przedstawić ideę aplikacji na landing page (naprawa pierwszego akapitu + design)"
tags: [research, landing-page, copy, positioning, design-system, conversion]
status: complete
last_updated: 2026-07-18
last_updated_by: Konrad Beśka
---

# Research: Jak najlepiej przedstawić ideę Zagroda Hub na landing page

**Date**: 2026-07-18T10:11:55+0200
**Researcher**: Konrad Beśka
**Git Commit**: 5f227c1d53030dca234999c4279ad2a0bd34df36
**Branch**: master
**Repository**: zagroda-hub

## Research Question

Zrób research, jak najlepiej przedstawić ideę tej aplikacji na landing page. Obecny
tekst w pierwszym akapicie jest śmieszny i nie oddaje istoty tej aplikacji. Zakres
uzgodniony z użytkownikiem: **przekaz/pozycjonowanie + design/układ sekcji**, źródła
**wewnętrzne (kod, PRD) + zewnętrzne (dobre praktyki landing page)**.

## Summary

Diagnoza jest jednoznaczna i zgodna między wewnętrzną analizą a zewnętrznymi dobrymi
praktykami: **problem obecnego hero to brak jasności i konkretu, nie tonu jako takiego**.
Obecny pierwszy akapit (`src/pages/index.astro:35-37`) czyta się jak podpis pod zdjęciem
stockowym, bo:

1. zawęża szeroki ból ("przy zwierzętach, w trakcie zajęć z dziećmi, w pracach
   gospodarskich") do jednego uroczego obrazka "gdy karmisz zwierzęta";
2. używa przesady ("obdzwania **pół województwa**" zamiast źródłowego "kilka zagród"),
   a przesada to klasyczny sygnał niepoważnej kopii;
3. składa dwie niepowiązane winiety (właściciel + nauczyciel) bez tezy — nie mówi, **czym
   produkt jest** ani **co robi**;
4. chowa najważniejszą rzecz — gwarancję braku podwójnej rezerwacji (Success Criterion #1)
   — na końcu długiego zdania podrzędnego w podtytule.

**Istota produktu (synteza):** Zagroda Hub to *mobilna książka rezerwacji dla właściciela
zagrody edukacyjnej* — nauczyciel wysyła zapytanie o wycieczkę online, a właściciel jednym
tapnięciem w telefonie akceptuje je **z twardą gwarancją, że ten sam dzień nigdy nie
zostanie przepełniony ponad limit**. To reguła anty-overbooking, a nie formularz, jest
rdzeniem (`context/foundation/roadmap.md:20`).

**Kierunek naprawy (zbieżny wniosek obu warstw researchu):**
- Nagłówek nazywający **odbiorcę + konkretny efekt** (clarity-over-cleverness), nie kalambur.
- Nie dzielić hero symetrycznie 50/50 na dwie persony. Produkt jest **supply-constrained**
  (bez zagród nie ma czego rezerwować), więc **właściciel = główna persona** w treści strony,
  a nauczyciel dostaje wyraźne, ale drugorzędne wejście.
- Gwarancja + "Jak to działa" + uczciwe ramowanie MVP **zastępują** brakujące opinie/testimoniale.
- Zostać w istniejącym systemie "Łąka i miód" i shellu `PageShell width="wide"` — to zadanie
  **copy/framing na istniejącej strukturze**, nie przebudowa wizualna.

## Detailed Findings

### 1. Istota aplikacji i pozycjonowanie (źródło: PRD + shape-notes + roadmap)

**Core insight (load-bearing, verbatim):**
> "właściciel zagrody pracuje na telefonie w terenie, a nie przy biurku — istniejące SaaS-y
> bookingowe celują w obsługę z desktopu/recepcji i są nieadekwatne."
> — `context/foundation/shape-notes.md:55`

**Ból głównej persony (właściciel)** — najostrzejsze cytaty:
- `context/foundation/shape-notes.md:53` — "Telefon dzwoni w trakcie pracy w terenie (przy
  zwierzętach, w trakcie zajęć z dziećmi, w pracach gospodarskich), więc każde zapytanie albo
  przerywa właściciela, albo zostaje nieobsłużone — a kartka z notatkami prowadzi do podwójnych
  rezerwacji i awantur."
- `context/foundation/shape-notes.md:59` — "wszystko na telefonie, jednoręcznie, brudnymi
  palcami." (najbardziej wizualna linia w całym dokumencie)
- `context/foundation/prd.md:42` — "jeśli czas obsługi jest 15s ale system pozwala na
  overbooking, produkt jest gorszy od kartki." (stawka)

**Ból drugiej persony (nauczyciel):**
- `context/foundation/shape-notes.md:53` — "nauczyciel nie wie, czy danej daty jest sens
  dzwonić, więc obdzwania **kilka zagród** zanim znajdzie wolny termin." (uwaga: źródło mówi
  "kilka", nie "pół województwa")

**Load-bearing obietnica (anty-overbooking), po ludzku:**
- Reguła: `context/foundation/prd.md:149` / `shape-notes.md:192`.
- Test pass/fail całego produktu: `context/foundation/prd.md:38` — "jeśli kiedykolwiek dwie
  rezerwacje na ten sam termin / przekroczenie limitu miejsc zostaną zaakceptowane, produkt
  zawiódł."
- Limit liczony **per dzień** (suma turnusów), nie per slot (`prd.md:97`) → w marketingu mówić
  "dzień", nie "godzina/turnus".

**Głos/ton (wyłania się ze źródła):** praktyczny, wiejski, konkretny, bez żargonu. Słownik do
utrzymania: *zagroda edukacyjna, wycieczka klasowa, turnus, województwo/miasto, dzienny limit,
kartka, poczta pantoflowa*. Unikać rejestru startupowo-techowego. Ton źródła jest rzeczowy
("Desktop-only panel = produkt do kosza", `prd.md:46`), a nie żartobliwy — i to rozjazd
tonu jest dokładnie tym, co sprawia, że obecne hero czyta się "śmiesznie".

**Czego NIE mówić** (Non-Goals, `context/foundation/prd.md:180-189`): brak map/GPS, brak
płatności online, brak ocen/recenzji, brak SMS/push, jedno konto = jedna zagroda (nie do
sieci/łańcuchów), brak konta gościa/panelu nauczyciela, brak kuracji/moderacji katalogu. Nie
opierać obietnicy na specyfice rynku PL (dotacje/sezonowość) — jawnie oznaczone jako
non-load-bearing dla MVP (`shape-notes.md:55`).

### 2. System designu — z czego komponować (bez nowych tokenów)

Stack: Astro 6 + React 19 + Tailwind 4 (CSS-first `@theme`, brak `tailwind.config`). Jeden
globalny arkusz `src/styles/global.css`. **Light-mode only** (dark block to leftover startera,
`color-scheme: light` wymuszone — `global.css:52`).

**Shell:** każda strona = `PageShell` (`src/components/PageShell.astro`). `width="wide"` →
`max-w-4xl xl:max-w-6xl` (`PageShell.astro:17`), tło `bg-meadow`, Topbar w standardzie. Landing
już go używa (`src/pages/index.astro:31`).

**Paleta "Łąka i miód"** (`src/styles/global.css:16-48`):
- Zieleń: `brand-50 #f1f6ec`, `-100 #e2edd8`, `-200 #c6dcb4`, `-600 #3f7d2c`, `-700 #336423`,
  `-800 #29511c` (brak 300/400/500 — nie wymyślać).
- Miód/amber: `accent-100 #f6e8d5`, `-400 #d98e2b`, `-600 #b45e14`, `-700 #8a4407`. **Tekst
  akcentowy tylko `accent-700`** (600 nie przechodzi AA dla małego tekstu — `global.css:26-27`).
- Neutralne/semantyczne: `surface #f7f5ef` (kremowe tło insetów), `ink #27301f`, `ink-muted
  #5b6350`, `link #2e6b27`/`link-hover #21491b`, `edge #e3e0d3`, `edge-strong #8b917f`. Karty =
  białe `#ffffff`.
- Typografia: jeden font **Nunito** (400–800, self-hosted). Brak własnej skali — Tailwind
  defaults (`text-sm`…`text-6xl`).

**Gotowe klasy komponentów** (`@utility` w `global.css`): `bg-meadow` (tło strony), `card-surface`
(biała karta, `rounded 1rem`, cień), `btn-primary` (solid brand-600), `btn-secondary` (outline
brand-600), `input-field`, `tap-target` (min-height 2.75rem — guardrail ≥44px). **Nie ma**
gotowych utili sekcji landingowych (`.hero`/`.section`) — sekcje komponuje się inline.

**Brand/ilustracje** (`src/components/brand/`): `Logo.astro` (logomark miód+stodoła + wordmark
"Zagroda Hub"), `ZagrodaPlaceholder.astro` (dekoracyjna scena stodoły na łące jako inline SVG,
zachowuje się jak `object-cover`). **Brak zdjęcia hero / stocku** — jedyna dekoracyjna grafika
to te dwa SVG; realne zdjęcia to user-upload z Supabase. Wszystkie assety to świadome
placeholdery do podmiany.

**Ikony:** `lucide-react` (^1.14.0) — bogaty zestaw już w użyciu (`Calendar, Clock, Users,
MapPin, Home, Mail, Phone, Send, Check, X, Undo2, Inbox, CircleCheck`…). **Działają tylko w
React (`.tsx`)**, nie w markupie `.astro`. Landing jest SSR-only (świadomie brak wysp na
publicznych stronach dla kosztu mobile — `new-user-interface/research.md:137`), więc ikony na
landingu wymagałyby albo małej wyspy, albo inline SVG.

**Ustalone wzorce do reużycia** (obecny `src/pages/index.astro`): hero (`:33-65`), 3-krokowy
grid "Jak to działa" z numerowanymi chipami (`:68-83`), dwie karty-persony
`md:grid-cols-2` (`:86-113`), footer (`:116-118`), CTA state-aware przez `Astro.locals.user`.
Rytm sekcji `py-12…py-16/sm:py-24`, gridy `gap-6`.

### 3. Zewnętrzne dobre praktyki (z cytowaniami)

**Dwie persony na jednej stronie:**
- Wybrać JEDNĄ główną personę dla treści strony, drugą wyprowadzić jednym wyraźnym CTA — nie
  dzielić każdej sekcji 50/50. (CXL: https://cxl.com/blog/how-to-write-copy-for-more-than-one-audience-on-a-page/ ,
  Copy Hackers: https://copyhackers.com/2013/02/writing-a-page-for-2-audiences/ )
- Marketplace zwykle jest **supply-constrained** → priorytet dla strony podaży (właściciel).
  (Lenny Rachitsky: https://www.lennysnewsletter.com/p/how-to-know-if-youre-supply-or-demand )
  → Dla Zagroda Hub: **właściciel = główna persona**, nauczyciel = drugorzędne wejście
  "Szukasz zagrody na wycieczkę? →". Selektor "Jestem właścicielem / nauczycielem" dopiero gdy
  żadna strona nie może być główna.

**Hero / kopia (sedno problemu klienta):**
- Nagłówek musi przejść test "jeśli przeczytają tylko to, wiedzą dokładnie co sprzedajesz?" —
  konkret bije spryt; NN/g "five-second test". (Julian Shapiro:
  https://www.julian.com/guide/startup/landing-pages , Demand Curve:
  https://www.demandcurve.com/playbooks/above-the-fold )
- Równanie konwersji: `Purchase = Desire − (Labor + Confusion)` — audytować każde słowo hero.
- Podtytuł = **wiarygodność, nie powtórzenie**: odpowiada "jak to dokładnie działa?" i "co
  uwiarygadnia śmiałą obietnicę?" w 1–2 zdaniach. Hero = nagłówek + 1–2 zdania + jedno CTA
  (nie akapit). (Prismic: https://prismic.io/blog/website-hero-section )
  → Wiarygodność gwarancji: np. "Każde zapytanie trafia do jednego kalendarza — system blokuje
  termin, gdy tylko go potwierdzisz."

**Anatomia sekcji dla wczesnego produktu:**
- Kolejność: Hero → value prop → jak to działa → korzyści → (dowód) → powtórzone CTA → FAQ →
  final CTA. Każdy blok korzyści wraca do dwóch obietnic hero (kontrola z terenu + brak
  podwójnej rezerwacji). (Shapiro; involve.me: https://www.involve.me/blog/landing-page-structure )
- Bez testimoniali slot "social proof" zastąpić: jasnym "Jak to działa" + screenem widoku
  telefonu + gwarancją + wiarygodnością twórcy + uczciwym "rekrutujemy pierwsze zagrody"
  (uczciwe ograniczenie **zwiększa** zaufanie). Silny dowód blisko pierwszego CTA, nie tylko
  na dole. (Coruzant: https://coruzant.com/digital-strategy/page-startup/ , Geeks for Growth:
  https://geeksforgrowth.com/startup-build-trust-early/ )

**Mobile-first (właściciel na telefonie):**
- Projektować pod "thumb zone" + rozważyć sticky dolne CTA (wzrosty konwersji ~15–25% na
  długich stronach); tap-targets ≥48px. (Heyflow: https://heyflow.com/blog/mastering-the-thumb-zone/ ,
  Replo: https://www.replo.app/blog/mobile-first-landing-page-design-how-to-build-for-conversions )
  → Zagroda Hub ma już guardrail `tap-target` (≥44px) i NFR mobile-first; LCP < 2.5s ważne
  (wiejskie łącza).

**Zaufanie bez recenzji:** minimum viable trust = jedna jasna obietnica + jedna konkretna
persona + konkretne liczby/specyfika zamiast ogólników; pokazać działający prototyp zamiast go
opisywać. (Coruzant, jw.)

**CTA:** jedno główne CTA powtórzone przy każdym foldzie (wzrost ~20–35% vs jedno CTA); drugie
wizualnie podrzędne; kopia first-person, czasownik + efekt, unikać "Wyślij". (VWO:
https://vwo.com/blog/call-to-action-buttons-ultimate-guide/ , Shapiro jw.)
→ **Główne** = akcja właściciela ("Zacznij zarządzać rezerwacjami"), powtarzane; **drugorzędne**
= ścieżka nauczyciela ("Znajdź zagrodę w swoim regionie"), bez konta — genuinie low-labor.

> Uwaga metodologiczna od agenta researchu: findingi NN/g i Baymard (five-second test, szybkość
> nawigacji z persistent header, rozmiary tap-targets) pojawiły się przez agregatory, nie
> bezpośrednio z domen NN/g/Baymard — traktować jako wtórne cytowanie.

### 4. Assessment obecnej kopii (dlaczego "śmieszny")

Obecny lead (`src/pages/index.astro:35-37`):
> "Telefon dzwoni, gdy karmisz zwierzęta. Nauczyciel obdzwania pół województwa, żeby
> zarezerwować wycieczkę."

Podtytuł (`:38-41`):
> "Zagroda Hub przenosi rezerwacje wycieczek do zagród edukacyjnych do sieci — mobilnie,
> z telefonu i z gwarancją, że ten sam termin nie zostanie zarezerwowany dwa razy."

Surowe składniki są **poprawne** (ból przerwania, ring-around nauczyciela, oba differentiatory
w podtytule), ale wykonanie zawodzi:
1. "gdy karmisz zwierzęta" zawęża szeroki workflow do jednego cukierkowego obrazka.
2. "obdzwania **pół województwa**" — przesada vs źródłowe "kilka zagród"; sygnał niepoważności.
3. Dwie niepowiązane winiety bez tezy — hero nie mówi, czym produkt jest.
4. Gwarancja (najważniejsza rzecz, Success Criterion #1) schowana w zdaniu podrzędnym po myślniku.
5. "przenosi… do sieci" — rejestr lekko przestarzały/mglisty; brak konkretu głosu źródła
   ("kartka", "awantura", "brudnymi palcami").
6. Rozjazd tonu: żartobliwo-cukierkowy vs rzeczowy głos produktu — to jest rdzeń "śmieszności".

## Code References

- `src/pages/index.astro:35-41` — obecny hero lead + podtytuł (do przepisania)
- `src/pages/index.astro:11-24` — dane 3 kroków "Jak to działa"
- `src/pages/index.astro:33-65` — sekcja hero (struktura, klasy, CTA state-aware)
- `src/pages/index.astro:86-113` — dwie karty-persony
- `src/components/PageShell.astro:7-21` — props shellu, mapa szerokości, `bg-meadow`
- `src/styles/global.css:16-48` — paleta "Łąka i miód" (tokeny kolorów)
- `src/styles/global.css:160-227` — `bg-meadow`, `card-surface`, `btn-primary`, `btn-secondary`
- `src/components/brand/Logo.astro` — logomark + wordmark (placeholder)
- `src/components/brand/ZagrodaPlaceholder.astro` — dekoracyjna scena SVG (jedyna grafika hero-able)
- `context/foundation/prd.md:20-46` — Vision, Persona, Success Criteria (substancja kopii)
- `context/foundation/prd.md:149` — reguła anty-overbooking (business logic)
- `context/foundation/shape-notes.md:53-59` — najostrzejsze cytaty o bólu persony
- `context/foundation/shape-notes.md:55` — core insight (field-phone vs desktop)

## Architecture Insights

- **To zadanie copy/framing, nie rebuild wizualny.** Struktura (`PageShell width="wide"` + hero
  + 3 kroki + 2 persony + footer) jest sprawdzona i zaaprobowana; zmieniamy treść i ewentualnie
  kolejność/hierarchię, zostając w tokenach "Łąka i miód".
- **Sekcje komponuje się inline** z `@utility` klas — brak abstrakcji sekcji, więc redesign
  układu to edycja markupu w `index.astro`, nie nowy design system.
- **Landing jest SSR-only** (świadomie brak React na publicznych stronach). Ikony lucide
  wymagałyby małej wyspy lub inline SVG — decyzja do planu.
- **Placeholder-first assety** (logo, ilustracja, OG) — jest przestrzeń na mocniejszą grafikę
  hero, ale w ramach obecnych tokenów i budżetu mobile.

## Historical Context (from prior changes)

- `context/archive/2026-06-15-landing-page-redesign/` — pierwsza domenowa wersja landingu (hero
  + how-it-works + 2 persony + footer + state-aware CTA). Plan jawnie zaprasza: copy "warto je
  przejrzeć okiem właściciela produktu" (`plan-brief.md:67`) — to dokładnie bieżące zadanie.
- `context/archive/2026-07-12-new-user-interface/` — **rebrand na "Łąka i miód"** (odwrócenie
  wcześniejszego "cosmic/purple"). Tokeny w `plan.md:88`, Nunito, assety-placeholdery. **Grep-gate**
  zakazuje starter/cosmic/purple idiomów w `src/` (`plan.md:350`) — nie reintrodukować.
- `context/archive/2026-07-13-refactor-responsive-web-design/` — Home przeniesiony na
  `PageShell width="wide"`; guardrail `grep "min-h-screen" src/pages` = 0.
- `context/archive/2026-07-14-auth-brand-header/` — Logo jako nagłówek zaufania nad kartami auth.
- **Brak osobnego dokumentu z uzasadnieniem nazwy "Zagroda Hub"** — nazwa przyjęta z PRD jako dana.
- Lekcja `context/foundation/lessons.md:26-31` (min-w-0 w flex) — istotna tylko jeśli redesign
  doda wiersze flex z długimi tokenami.

### Constraints, których redesign musi przestrzegać
- Tylko tokeny "Łąka i miód" + `@utility` klasy — bez hardkodowanych kolorów.
- Grep-gate: `bg-cosmic|backdrop-blur|from-blue-200|bg-clip-text|text-blue-100|bg-white/(5|10)|purple-`
  musi zwracać 0 w `src/` (poza OAuth brand SVG).
- Landing zostaje `PageShell width="wide"`; `grep "min-h-screen" src/pages` = 0.
- Mobile-first: jednoręcznie, portrait, tap-targets ≥44px, katalog < 2s.
- **E2E locators są sprzężone z kopią, a CI NIE odpala e2e.** Zmiana nagłówków/labeli może cicho
  zepsuć Playwright (accessible names, brak `data-testid`). `smoke.spec.ts:13` asertuje "Katalog
  zagród"; kopia auth zamrożona. CTA nawigujące do katalogu/auth trzymać spójnie.
- Bez nowych React-wysp bez potrzeby (publiczne strony SSR-only).

## Decisions (post-research, 2026-07-18)

Rozstrzygnięte z użytkownikiem po prezentacji wariantów hero:

- **Główna persona strony = właściciel zagrody** (złamanie obecnej symetrii 50/50);
  nauczyciel dostaje wyraźne, ale drugorzędne wejście (CTA "Szukasz zagrody na wycieczkę? →").
  Rozstrzyga Open Question #1.
- **Value proposition staje się H1**; marka "Zagroda Hub" schodzi do Topbara (logo już tam jest).
  Nagłówek ma nazywać odbiorcę + efekt, nie powtarzać nazwy.
- **Wybrany kierunek copy: Wariant C — „Maksymalna jasność"** (otwiera tym, czym produkt jest;
  gwarancja jako drugie zdanie; najspokojniejszy ton, najniższe ryzyko „przekombinowania"):
  - H1 (roboczo): "Rezerwacje wycieczek do Twojej zagrody — w jednym miejscu, prosto z telefonu."
  - Sub (roboczo): "Zamiast odbierać telefony w polu, dostajesz zapytania nauczycieli online
    i akceptujesz je jednym tapnięciem. Zagroda Hub gwarantuje, że ten sam dzień nie zostanie
    zarezerwowany ponad Twój limit miejsc."
  - CTA: primary "Załóż konto zagrody" (właściciel) / secondary "Szukasz zagrody na wycieczkę? →"
    (nauczyciel, bez konta).
- Brzmienie H1/sub/CTA powyżej jest **robocze** — do finalnej akceptacji właściciela produktu
  w planie/implementacji. **Uwaga e2e:** CTA nawigujące do `/katalog` i `/auth/signup` oraz ich
  accessible names trzymać spójnie (Playwright bez `data-testid`, CI nie odpala e2e).
- Open Questions #2 (grafika/screen hero), #3 (sticky mobilne CTA), #4 (ikony lucide / wyspa)
  pozostają **otwarte do rozstrzygnięcia na starcie `/10x-plan`**.

## Related Research

- `context/archive/2026-06-15-landing-page-redesign/plan.md` — pełny plan pierwszej wersji landingu
- `context/archive/2026-07-12-new-user-interface/research.md` — research rebrandu, uzasadnienie zieleni
- `context/archive/2026-07-12-new-user-interface/plan.md` — tokeny, typografia, grep-gates

## Open Questions

1. **Która persona jest główna na stronie?** Research zewnętrzny mocno sugeruje **właściciela**
   (supply-constrained). Do potwierdzenia przez właściciela produktu — bo obecna strona jest
   symetryczna 50/50, a rekomendacja to złamanie tej symetrii.
2. **Czy dokładać grafikę hero / ilustrację?** Jest tylko `ZagrodaPlaceholder` SVG i brak zdjęcia
   stockowego. Czy hero pozostaje typograficzne, czy wprowadzamy ilustrację/screen telefonu
   (mocny "product evidence" dla MVP bez testimoniali)?
3. **Sticky mobilne CTA** — dobra praktyka, ale to nowy element UI. Wchodzi w zakres tego
   change'u czy zostaje na później?
4. **Ikony na landingu** — czy warto wprowadzić małą React-wyspę / inline SVG dla ikon lucide
   przy 3 krokach i korzyściach, kosztem czystego SSR?
5. **Dokładne finalne brzmienie** nagłówka/podtytułu/CTA — to decyzja copywriterska do
   rozstrzygnięcia w `/10x-plan` (research daje kierunek i ograniczenia, nie gotowy tekst do
   wklejenia bez akceptacji właściciela produktu).
