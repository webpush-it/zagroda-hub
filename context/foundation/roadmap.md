---
project: "Zagroda Hub"
version: 2
status: draft
created: 2026-07-19
updated: 2026-07-23
prd_version: 2
main_goal: market-feedback
top_blocker: time
---

# Roadmap: Zagroda Hub — pakiet poprawek z feedbacku właściciela

> Wyprowadzona z `context/foundation/prd-v2.md` (v2) + auto-zbadany baseline kodu (potwierdzony przez użytkownika 2026-07-19).
> Edytuj w miejscu; archiwizuj przy pełnej regeneracji. Poprzednia roadmapa (MVP, w całości done) w `context/foundation/archive/2026-07-19-roadmap.md`.
> Slice'y poniżej są w kolejności zależności. Tabela „At a glance" jest indeksem. Numeracja kontynuowana po roadmapie MVP (ostatni: S-07) — spójnie z numeracją FR w PRD.

## Vision recap

MVP Zagroda Hub działa na produkcji, a pierwszy strukturalny feedback od realnego właściciela zagrody (potencjalnego ambasadora produktu na zlocie sieci zagród) odsłania cztery luki między zbudowanym produktem a tym, jak będzie faktycznie używany: strona główna mówi do właściciela zamiast do szukającego; gwarancja anty-overbookingu nie widzi rezerwacji przyjmowanych telefonicznie; odkrywanie zagród nie zna „najbliższych zagród", ofert z cenami ani filtrów temat/adresaci; a formularze mówią wyłącznie językiem szkolnym, choć pełnoprawnym klientem jest też rodzina. Ten pakiet zamyka te cztery luki addytywnie — bez zmiany modelu ról, kanału e-mail i publicznych kontraktów — tak, by ambasador zobaczył swoje uwagi wdrożone i dostarczył kolejną rundę sygnału z rynku.

## North star

**S-08: Właściciel wpisuje rezerwację telefoniczną i blokuje dni, a gwarancja anty-overbooking obejmuje oba kanały** — to milestone walidacyjny pakietu, bo niesie kryterium sukcesu #1 („gwarancja obejmuje 100% zaakceptowanego popytu") i łata jedyną realną dziurę w rdzennej obietnicy produktu; przy celu `market-feedback` to zarazem najważniejszy postulat właściciela-ambasadora, więc domyka pętlę feedbacku najszybciej jak się da.

> _Gwiazda przewodnia_ = najmniejszy kompletny, widoczny dla użytkownika slice, którego udane dostarczenie udowadnia rdzenną hipotezę tego pakietu — umieszczony tak wcześnie, jak pozwalają prerekwizyty, bo reszta pakietu ma sens tylko, jeśli gwarancja trzyma między kanałami.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                                          | Prerequisites | PRD refs                                    | Status  |
| ---- | --------------------------- | ------------------------------------------------------------------------------ | ------------- | -------------------------------------------- | ------- |
| S-08 | phone-bookings-and-day-blocks | właściciel wpisuje rezerwację telefoniczną / blokuje dzień; gwarancja trzyma między kanałami; źródło widoczne | —             | FR-021, FR-022, FR-023, FR-028, FR-031, US-03 | done    |
| S-09 | client-first-landing        | gość widzi stronę główną klient-first z centralnym CTA „Znajdź zagrodę"        | —             | FR-019, US-04                                | ready   |
| S-10 | nearest-zagrody-sort        | gość po udostępnieniu lokalizacji widzi katalog od najbliższej zagrody         | —             | FR-020, FR-030, US-04                        | done    |
| S-11 | group-type-neutral-language | gość wybiera typ grupy w zapytaniu, formularz mówi neutralnym językiem         | —             | FR-027, FR-029, US-04                        | ready   |
| S-12 | zagroda-offers-with-prices  | właściciel zarządza ofertami z cenami; gość widzi je na stronie zagrody        | —             | FR-024, FR-025, FR-031, US-04                | blocked |
| S-13 | topic-audience-filters      | gość filtruje katalog po temacie warsztatów i adresatach                       | S-12          | FR-026, FR-030, US-04                        | blocked |

## Baseline

Co już jest w kodzie na dzień `2026-07-19` (auto-zbadane + potwierdzone przez użytkownika). Pakiet jest addytywny wobec działającego MVP — niczego z poniższych nie re-scaffolduje.

- **Frontend:** present — per tech-stack.md: Astro 6 SSR + React 19 + Tailwind 4; aplikacja żyje na produkcji.
- **Backend / API:** present — per tech-stack.md: Astro SSR na Cloudflare Workers (`src/worker.ts`), trasy API wpięte.
- **Data:** present — per tech-stack.md: Supabase Postgres z migracjami (`supabase/migrations/`); schemat domeny MVP kompletny.
- **Auth:** present — per tech-stack.md: Supabase Auth (e-mail+hasło z weryfikacją, OAuth Google/Facebook z merge-guardem).
- **Deploy / infra:** present — per tech-stack.md: wrangler + GitHub Actions auto-deploy-on-merge; migracje idą przed workerem (lessons.md).
- **Observability:** partial — wyłącznie `console.error/warn` (~17 miejsc, głównie podsystem e-mail), czytane przez `wrangler tail`; brak error trackingu i metryk. Żaden slice pakietu tego nie wymaga — nie otwiera fundamentu.

Feature-delta pakietu (wszystko poniżej dziś **absent** — to jest zakres slice'ów): oferty z cenami; wpisy ręczne (telefoniczne); blokady dni; współrzędne zagród i sortowanie po odległości; typ grupy w formularzu (język dziś szkolny — „nauczyciel"); landing dziś owner-first (hero „Rezerwacje wycieczek do Twojej zagrody"). Atomowa reguła akceptacji **present** — `accept_booking_request()` sumuje wyłącznie zaakceptowane zapytania.

## Foundations

Brak fundamentów w tym pakiecie. Baseline raportuje wszystkie warstwy jako obecne, a każdy element techniczny pakietu (rozszerzenie sumy reguły akceptacji, współrzędne miejscowości, nowe byty danych) pojawia się w pierwszym slice'ie, który go potrzebuje — zgodnie z zasadą progresywnego odsłaniania. W szczególności rozszerzenie rdzennej reguły akceptacji NIE jest fundamentem: żyje wewnątrz S-08, bo tylko tam jest konsumowane i tylko przez zachowanie użytkownika da się je zweryfikować end-to-end.

## Slices

### S-08: Wpisy telefoniczne, blokady dni i źródło rezerwacji (gwiazda przewodnia)

- **Outcome:** właściciel może dodać z telefonu ręczną rezerwację przyjętą telefonicznie (data, turnus, liczba uczestników, opcjonalna notatka) oraz zablokować i odblokować cały dzień; wpis konsumuje miejsca z dziennego limitu tą samą regułą co akceptacje z aplikacji („dokładnie jeden sukces" pod współbieżnością), zablokowany dzień nie przyjmuje zapytań ani akceptacji i znika z filtra dostępności, usunięcie wpisu/blokady natychmiast zwalnia miejsca, a każda rezerwacja pokazuje źródło (aplikacja / telefon).
- **Change ID:** phone-bookings-and-day-blocks
- **PRD refs:** FR-021, FR-022, FR-023, FR-028, FR-031, US-03, NFR (wpis ręczny jednoręcznie < 15 s; prywatność per-właściciel na nowych danych)
- **Prerequisites:** —
- **Parallel with:** S-09, S-10, S-11, S-12
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Jedyny slice pakietu dotykający rdzenia reguły akceptacji — rozszerzenie sumy o wpisy ręczne i blokady nie może osłabić własności „dokładnie jeden sukces" (istniejący test współbieżności do rozszerzenia o mix wpis ręczny + akceptacja, nie do podmiany). Sekwencjonowany pierwszy, bo niesie kryterium sukcesu #1, największe ryzyko regresu i najgłośniejszy postulat feedbacku; musi być wycofywalny niezależnie (blast radius: panel + suma dostępności).
- **Status:** done

### S-09: Landing klient-first

- **Outcome:** gość widzi stronę główną mówiącą do szukającego — powitanie i główne CTA „Znajdź zagrodę" na środku, sekcja „Prowadzisz zagrodę?" z własnym CTA niżej, logowanie/rejestracja na dole strony i w topbarze.
- **Change ID:** client-first-landing
- **PRD refs:** FR-019, US-04
- **Prerequisites:** —
- **Parallel with:** S-08, S-10, S-11, S-12
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Czysto prezentacyjny i najmniejszy slice pakietu — układ zgodny 1:1 z feedbackiem właściciela, więc tani punkt w pętli feedbacku. Sekwencjonowany wcześnie, bo razem z S-10 domyka kryterium sukcesu #2 („maksymalnie 2 interakcje od strony głównej do katalogu od najbliższych"); ryzyko ograniczone do osłabienia pozyskiwania właścicieli przez landing — zaakceptowane w PRD (podaż idzie kanałami bezpośrednimi).
- **Status:** ready

### S-10: Najbliższe zagrody — sortowanie po odległości

- **Outcome:** gość, który udostępni lokalizację urządzenia, widzi katalog posortowany rosnąco po odległości od siebie, z przybliżoną odległością (dokładność na poziomie miejscowości) na każdej karcie; odmowa lokalizacji zostawia katalog dokładnie w obecnym kształcie (filtry województwo/miasto), bez błędów i bez ponawiania prośby; sortowanie współpracuje z istniejącymi filtrami, a lokalizacja gościa nie jest utrwalana.
- **Change ID:** nearest-zagrody-sort
- **PRD refs:** FR-020, FR-030, US-04, NFR (katalog < 2 s p95; lokalizacja nieutrwalana; odległość jawnie przybliżona)
- **Prerequisites:** —
- **Parallel with:** S-08, S-09, S-11, S-12
- **Blockers:** —
- **Unknowns:**
  - Mechanizm wyznaczania współrzędnych miejscowości (słownik lokalny vs zewnętrzne API geokodowania) — wymaganie produktowe tylko: zero nowych pól dla właściciela, dokładność miejscowości, uzupełnienie istniejących zagród automatycznie. — Owner: dev. Block: no (decyzja domyka się w `/10x-plan`, zgodnie z zapisem w shape-notes).
- **Risk:** Najmocniej akcentowany pomysł właściciela („strona WWW sieci tego nie ma") — najwyższa wartość w pętli feedbacku po gwieździe. Ryzyko: sortowanie po odległości musi trzymać p95 < 2 s i być dodatkiem do istniejących filtrów (FR-030 bez regresu); kryterium sukcesu #2 mierzone dopiero, gdy dowiezione są S-09 i S-10 razem.
- **Status:** done

### S-11: Typ grupy i neutralny język formularza

- **Outcome:** gość wysyłający zapytanie wybiera typ grupy (szkoła / przedszkole / grupa indywidualna / inna), a formularz i komunikaty używają neutralnego języka („liczba uczestników", „osoba kontaktowa"); walidacja i cały istniejący przepływ zapytań (maile, token anulowania, akceptacja/odrzucenie/cofnięcie) działają bez zmian.
- **Change ID:** group-type-neutral-language
- **PRD refs:** FR-027, FR-029, US-04
- **Prerequisites:** —
- **Parallel with:** S-08, S-09, S-10, S-12
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Minimalna zmiana istniejącego formularza, nie osobna ścieżka produktowa — otwiera personę klienta indywidualnego niskim kosztem. Główne ryzyko to regres zachowanego przepływu gościa (FR-029) i istniejących maili — slice dotyka najczęściej używanej ścieżki produktu, więc wymaga jawnego potwierdzenia braku zmian w walidacji i treściach maili.
- **Status:** ready

### S-12: Oferty zagrody z cenami

- **Outcome:** właściciel może dodać, edytować i usunąć oferty swojej zagrody (nazwa, opis, czas trwania, adresaci, temat warsztatów, opcjonalna cena), a gość widzi na stronie zagrody listę ofert z cenami lub „cena ustalana indywidualnie"; zagrody bez ofert pozostają w pełni funkcjonalne (pusta sekcja, nie błąd), a oferty są edytowalne wyłącznie przez właściciela tej zagrody.
- **Change ID:** zagroda-offers-with-prices
- **PRD refs:** FR-024, FR-025, FR-031, US-04
- **Prerequisites:** —
- **Parallel with:** S-08, S-09, S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - Jednostka ceny oferty: za osobę, za grupę, czy oba warianty do wyboru właściciela? — Owner: user (z właścicielem-doradcą). Block: **yes** (PRD: rozstrzygnąć przed planowaniem tego slice'a).
  - Taksonomia temat warsztatów / adresaci (pola formularza ofert) — dokładna lista wartości, wzorowana na katalogu Ogólnopolskiej Sieci Zagród Edukacyjnych. — Owner: user (z właścicielem-doradcą). Block: no (per PRD oferty mogą iść; lista musi się domknąć najpóźniej przed S-13).
- **Risk:** Odpowiada wprost na „klienci chcą ceny podane na tacy" — drugi filar feedbacku strony popytu. Nowy byt widoczny publicznie: zmiana danych wyłącznie addytywna, istniejące zagrody bez ofert nie mogą się zepsuć w katalogu. Sekwencjonowany za slice'ami gotowymi do planowania tylko dlatego, że gate'uje go otwarte pytanie o jednostkę ceny — rozstrzygnięcie odblokowuje go natychmiast.
- **Status:** blocked

### S-13: Filtry temat warsztatów i adresaci

- **Outcome:** gość może filtrować katalog po temacie warsztatów i adresatach (w koniunkcji z istniejącymi filtrami województwo/miasto/data/liczba uczestników, które działają bez zmian).
- **Change ID:** topic-audience-filters
- **PRD refs:** FR-026, FR-030, US-04
- **Prerequisites:** S-12 (taksonomia i dane ofert, po których filtr filtruje)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Taksonomia temat warsztatów / adresaci — dokładna lista wartości (tematyka zajęć, zakres oferty, adresaci), skonsultowana z właścicielem-doradcą. — Owner: user. Block: **yes**.
- **Risk:** Świadomie ostatni w pakiecie — właściciel sam mówi, że te filtry „nie muszą być" na start, a bez ofert z taksonomią (S-12) filtr nie ma po czym filtrować. Zostaje w pakiecie jako konieczny, bo dane bierze z tego samego formularza właściciela co S-12 — dowożony na końcu nie dokłada osobnej zmiany modelu danych.
- **Status:** blocked

## Backlog Handoff

| Roadmap ID | Change ID                     | Suggested issue title                                                        | Ready for `/10x-plan` | Notes                                                        |
| ---------- | ----------------------------- | ----------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| S-08       | phone-bookings-and-day-blocks | Wpisy telefoniczne + blokady dni z gwarancją anty-overbooking między kanałami | yes                   | Gwiazda przewodnia — `/10x-plan phone-bookings-and-day-blocks` |
| S-09       | client-first-landing          | Strona główna klient-first (CTA „Znajdź zagrodę" na środku)                   | yes                   | Najmniejszy slice; szybki punkt w pętli feedbacku            |
| S-10       | nearest-zagrody-sort          | Katalog „najbliższe zagrody" — sortowanie po odległości z lokalizacji         | yes                   | Mechanizm geokodowania domyka `/10x-plan`                    |
| S-11       | group-type-neutral-language   | Typ grupy w zapytaniu + neutralny język formularza                            | yes                   | Uwaga na regres przepływu zapytań (FR-029)                   |
| S-12       | zagroda-offers-with-prices    | Oferty zagrody z opcjonalnymi cenami (panel + strona zagrody)                 | no                    | Czeka na pytanie #2 (jednostka ceny)                         |
| S-13       | topic-audience-filters        | Filtry katalogu: temat warsztatów / adresaci                                  | no                    | Czeka na pytanie #1 (taksonomia) i S-12                      |

## Open Roadmap Questions

1. **Taksonomia temat warsztatów / adresaci (FR-024/FR-026)** — dokładna lista wartości; wzorować na katalogu Ogólnopolskiej Sieci Zagród Edukacyjnych (tematyka zajęć, zakres oferty, adresaci) i skonsultować z właścicielem-doradcą. Owner: user. Block: `S-13` (twardo); `S-12` może iść, ale lista musi się domknąć najpóźniej przed S-13.
2. **Jednostka ceny oferty (FR-024)** — cena za osobę, za grupę, czy oba warianty do wyboru właściciela? Owner: user (z właścicielem-doradcą). Block: `S-12` — rozstrzygnąć przed jego planowaniem.

## Parked

- **Rytm tygodnia (szablon dostępności)** — Why parked: PRD §Non-Goals; pomysł właściciela „5 minut w niedzielę" to duży moduł kalendarza — wraca, gdy będzie więcej niż jeden aktywny właściciel (v2).
- **Widok kalendarza / pojedynczego dnia** — Why parked: PRD §Non-Goals; lista zapytań + wpisy ręczne wystarczą do domknięcia pętli (v2).
- **Tryb „sama prośba o kontakt"** — Why parked: PRD §Non-Goals; lżejszy typ zapytania bez daty/liczby osób odłożony (v2).
- **Mapa w UI** — Why parked: PRD §Non-Goals; geolokalizacja to wyłącznie sortowanie listy po odległości — non-goal MVP zniesiony tylko w tym zawężeniu. **Zniesiony w v2 (2026-07-23) przez zmianę `zagroda-map-location`**: map-picker Leaflet/OSM w formularzu właściciela + interaktywna mapa na stronie szczegółów zagrody. Bez zewnętrznego geokodowania.
- **Non-goals MVP (płatności, oceny/recenzje, SMS/push, multi-zagroda, konto gościa, moderacja admin, negocjacja poza limit)** — Why parked: PRD §Non-Goals; ten pakiet niczego z tej listy nie otwiera.
- **Model biznesowy (abonament / darmowa)** — Why parked: PRD §Non-Goals; decyzja go-to-market, nie produktowa — nie blokuje żadnego FR pakietu.

## Done

(Pusta przy pierwszej generacji. `/10x-archive` dopisuje wpis tutaj — i przełącza `Status` elementu na `done` — gdy zmiana o pasującym `Change ID` zostaje zarchiwizowana. NIE wypełniać ręcznie.)

- **S-08: właściciel może dodać z telefonu ręczną rezerwację przyjętą telefonicznie (data, turnus, liczba uczestników, opcjonalna notatka) oraz zablokować i odblokować cały dzień; wpis konsumuje miejsca z dziennego limitu tą samą regułą co akceptacje z aplikacji („dokładnie jeden sukces" pod współbieżnością), zablokowany dzień nie przyjmuje zapytań ani akceptacji i znika z filtra dostępności, usunięcie wpisu/blokady natychmiast zwalnia miejsca, a każda rezerwacja pokazuje źródło (aplikacja / telefon).** — Archived 2026-07-19 → `context/archive/2026-07-19-phone-bookings-and-day-blocks/`. Lesson: —.
- **S-10: gość, który udostępni lokalizację urządzenia, widzi katalog posortowany rosnąco po odległości od siebie, z przybliżoną odległością (dokładność na poziomie miejscowości) na każdej karcie; odmowa lokalizacji zostawia katalog dokładnie w obecnym kształcie (filtry województwo/miasto), bez błędów i bez ponawiania prośby; sortowanie współpracuje z istniejącymi filtrami, a lokalizacja gościa nie jest utrwalana.** — Archived 2026-07-23 → `context/archive/2026-07-20-nearest-zagrody-sort/`. Lesson: —.
