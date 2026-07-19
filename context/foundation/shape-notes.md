---
project: "Zagroda Hub"
context_type: brownfield
created: 2026-07-19
updated: 2026-07-19
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  delivery_weeks: 6
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "zakres zmiany"
      decision: "cały pakiet 6 poprawek w jednym PRD; ~6 tygodni po godzinach świadomie zaakceptowane; roadmapa potnie na slice'y"
    - topic: "deadline"
      decision: "brak twardego deadline'u; jesienno-zimowy zlot zagród jako cel motywacyjny, nie kontrakt"
    - topic: "rezerwacje ręczne"
      decision: "dwie akcje właściciela: wpis telefoniczny (data, turnus, liczba osób) + blokada całego dnia"
    - topic: "ceny ofert"
      decision: "cena opcjonalna per oferta; brak ceny = „ustalana indywidualnie” (nie blokuje zagród z negocjowanymi stawkami)"
    - topic: "współrzędne zagrody"
      decision: "geokodowanie miasta z istniejącego profilu przy zapisie — zero nowych pól dla właściciela, dokładność na poziomie miejscowości"
    - topic: "landing klient-first vs podaż"
      decision: "hero i główne CTA dla szukającego + mocna sekcja „Prowadzisz zagrodę?” niżej; podaż pozyskiwana kanałami bezpośrednimi (ODR, zlot), nie przez landing"
    - topic: "ryzyko „apka jako notatnik” przy wpisach ręcznych"
      decision: "każda rezerwacja ma widoczne źródło (aplikacja / telefon) — dane do analizy adopcji; bez twardych limitów wpisów ręcznych"
    - topic: "non-goals tej zmiany"
      decision: "rytm tygodnia (szablon dostępności), widok kalendarza/dnia, tryb „sama prośba o kontakt”, mapa w UI — wszystkie odłożone"
  frs_drafted: 13
  quality_check_status: accepted
---

# Shape Notes — Zagroda Hub: pakiet poprawek z feedbacku właściciela (brownfield)

Seed: wiadomości głosowe właściciela zagrody edukacyjnej (2026-07-19) + analiza zderzenia feedbacku z działającym systemem. Poprzednia sesja greenfield (MVP, w całości dowiezione) zarchiwizowana: `context/foundation/archive/shape-notes-2026-07-19-greenfield.md`.

## Current System

Zagroda Hub — działający na produkcji marketplace rezerwacji wycieczek do zagród edukacyjnych (jedno zdanie: nauczyciel znajduje zagrodę i wysyła zapytanie, właściciel akceptuje z telefonu z twardą gwarancją braku overbookingu).

- **Architektura:** Astro 6 SSR + React 19 (Tailwind 4) na Cloudflare Workers; dane i auth w Supabase (Postgres + RLS); e-mail transakcyjny wpięty (< 5 min).
- **Użytkownicy dziś:** właściciele zagród (1 zagroda/konto; e-mail+hasło z weryfikacją oraz OAuth Google/Facebook z bezpiecznym auto-merge) i niezalogowani goście (nauczyciele).
- **Core funkcjonalność:** publiczny katalog z filtrami (województwo/miasto AND, opcjonalnie data + liczba uczestników z filtrem dostępności) → strona zagrody → formularz zapytania (data, turnus, liczba osób, kontakt) → mail do właściciela → panel mobilny: lista/szczegóły zapytań, akceptacja z atomową blokadą overbookingu („X z Y zajęte, Z wymaga miejsca”; dokładnie jeden sukces pod współbieżnością), odrzucenie, cofnięcie akceptacji; gość anuluje tokenizowanym linkiem z maila.
- **Skala:** wczesna produkcja, pojedynczy realni właściciele-testerzy; roadmapa MVP (F-01…S-07) w 100% done.

## Vision & Problem Statement

Pierwszy strukturalny feedback od realnego właściciela zagrody (użytkownika docelowego, potencjalnego ambasadora produktu na zlocie sieci zagród) odsłania cztery luki między zbudowanym MVP a tym, jak produkt będzie faktycznie używany:

1. **Wejście do produktu jest odwrócone.** Strona główna mówi do właściciela („Rezerwacje wycieczek do Twojej zagrody”, CTA „Załóż konto zagrody”), a szukający — jedyne źródło popytu, bez którego katalog nie przekona właścicieli — dostaje drobny link. Właściciel widzi to jednoznacznie: logo, powitanie, na środku „Znajdź zagrodę”, logowanie na dole.
2. **Gwarancja anty-overbookingu jest dziś prawdziwa tylko wewnątrz aplikacji.** Właściciele przyjmują rezerwacje telefonicznie (i będą przyjmować — „są osoby w wyższym wieku”); system o nich nie wie, więc pozwoli zaakceptować kolidujące zapytanie z aplikacji. Kryterium sukcesu #1 MVP (100% blokady overbookingu) wymaga, by popyt telefoniczny dało się wprowadzić do tej samej reguły.
3. **Odkrywanie zagród jest słabsze niż potrzeba.** Brak wyszukiwania „najbliższe zagrody” po lokalizacji telefonu (właściciel wskazuje to dwukrotnie jako przewagę nad stroną WWW sieci, która tego nie ma), brak ofert z cenami („klienci chcą ceny podane na tacy”) i brak filtrów temat warsztatów / adresaci znanych właścicielom z katalogu Ogólnopolskiej Sieci Zagród Edukacyjnych.
4. **Persona popytu jest za wąska.** „Kupa zagród robi też zajęcia indywidualne” — klient indywidualny (rodzina) jest pełnoprawnym odbiorcą, a formularze mówią dziś wyłącznie językiem szkolnym.

Dotychczasowy workaround: brak — MVP po prostu nie pokrywa tych ścieżek; rezerwacje telefoniczne żyją poza systemem (koszt: dziura w gwarancji), a klient bez preferencji lokalizacyjnych musi znać województwo/miasto z góry.

## User & Persona

**Primary persona — bez zmian:** właściciel zagrody edukacyjnej pracujący w terenie, obsługa jednoręcznie z telefonu. Zmiana rozszerza jego panel o wpisy ręczne (telefoniczne) i oferty z cenami — czyli o to, jak naprawdę prowadzi biznes.

**Secondary persona — rozszerzona:** obok nauczyciela/wychowawcy dochodzi **klient indywidualny** (rodzic/rodzina szukająca zajęć dla dzieci, także spontanicznie „jesteśmy w okolicy — co jest najbliżej?”). Ta persona napędza wyszukiwanie po lokalizacji urządzenia i neutralny język formularzy. Konwersja poza systemem (telefon/e-mail) pozostaje akceptowalna.

## Access Control

**Bez zmian w modelu ról i auth.** Gość (nauczyciel / klient indywidualny) nadal bez konta; właściciel nadal loguje się jak dotychczas (e-mail+hasło / OAuth). Nowe zdolności mapują się na istniejące role:

- Wpisy ręczne, blokady dni i oferty — akcje zalogowanego właściciela wyłącznie na własnej zagrodzie (istniejąca ochrona RLS rozszerzona na nowe dane).
- Lokalizacja gościa — wyłącznie za zgodą wyrażoną w przeglądarce, używana do posortowania wyników; odmowa niczego nie blokuje.

## Success Criteria

### Primary

- Gwarancja anty-overbookingu obejmuje 100% zaakceptowanego popytu — łącznie z rezerwacjami przyjętymi telefonicznie (wpisy ręczne) i blokadami dni. Test: wpis ręczny wyczerpujący limit dnia sprawia, że kolidująca akceptacja zapytania z aplikacji jest zablokowana z komunikatem; dzień zablokowany nie przyjmuje ani akceptacji, ani nowych zapytań.
- Gość bez konta, który udostępni lokalizację urządzenia, widzi katalog posortowany od najbliższej zagrody — maksymalnie 2 interakcje od wejścia na stronę główną (CTA „Znajdź zagrodę” → zgoda na lokalizację).

### Secondary

- Strona zagrody prezentuje oferty z cenami (lub „cena ustalana indywidualnie”), a katalog filtruje po temacie warsztatów i adresatach.
- Właściciel widzi źródło każdej rezerwacji (aplikacja / telefon) — podstawa do późniejszej oceny adopcji kanału aplikacji.

### Guardrails

- Istniejący przepływ zapytań (formularz → maile → akceptacja/odrzucenie/cofnięcie → token anulowania) działa bez regresu — obecni użytkownicy nie zauważają żadnej zmiany na gorsze.
- Katalog z nowym sortowaniem i filtrami trzyma p95 < 2 s; panel pozostaje używalny jednoręcznie na telefonie w pionie.
- Odmowa udostępnienia lokalizacji zostawia gościa dokładnie tam, gdzie jest dziś (filtry województwo/miasto) — zero degradacji.
- Prywatność: kontakt gościa nadal widoczny wyłącznie dla właściciela tej zagrody; lokalizacja urządzenia gościa nie jest utrwalana.

## MVP flow (critical delta)

1. Gość: strona główna klient-first → „Znajdź zagrodę” → (zgoda na lokalizację) → katalog od najbliższych, z filtrami temat/adresaci → strona zagrody z ofertami i cenami → zapytanie (jak dziś, neutralny język + typ grupy).
2. Właściciel: telefon dzwoni w ciągu dnia → po rozmowie otwiera panel → „Dodaj rezerwację telefoniczną” (data, turnus, liczba osób) albo „Zablokuj dzień” → limit dnia natychmiast odzwierciedla rzeczywistość.
3. Kolejne zapytanie z aplikacji na ten dzień → akceptacja zablokowana istniejącym komunikatem „X z Y zajęte” — gwarancja trzyma niezależnie od kanału.

## Functional Requirements

Numeracja kontynuowana po MVP (ostatni: FR-018).

### Landing i wejście klienta

- FR-019: Gość widzi stronę główną klient-first: powitanie i główne CTA „Znajdź zagrodę” na środku, sekcja „Prowadzisz zagrodę?” z własnym CTA niżej, logowanie/rejestracja na dole strony (i w topbarze). Priority: must-have. Change: modified
  > Socrates: Kontrargument: „właściciele są jedynym źródłem podaży przy małym katalogu — odwrócenie landing może osłabić pozyskiwanie zagród, gdy to zagród brakuje najbardziej”. Rezolucja: klient-first z mocną sekcją właściciela; podaż pozyskiwana kanałami bezpośrednimi (ODR, zlot, prezentacje na scenie przez właściciela-ambasadora), nie przez landing. Układ zgodny 1:1 z feedbackiem właściciela.

### Wyszukiwanie po odległości

- FR-020: Gość może udostępnić lokalizację urządzenia i zobaczyć katalog posortowany rosnąco po odległości od siebie („najbliższe zagrody”), z przybliżoną odległością przy każdej karcie; odmowa lokalizacji pozostawia katalog w obecnym kształcie (filtry województwo/miasto). Priority: must-have. Change: new
  > Socrates: Kontrargument: „geolokalizacja była w Non-Goals MVP (mapy/GPS)”. Rezolucja: tamten non-goal dotyczył map jako UI — sortowanie listy po odległości nie wprowadza mapy i realizuje najmocniej akcentowany pomysł właściciela („strona WWW sieci tego nie ma”). Współrzędne zagrody wyznaczane geokodowaniem miasta z istniejącego profilu przy zapisie — zero nowych pól dla właściciela; dokładność miejscowości wystarcza do „co najbliżej”.

### Rezerwacje ręczne i blokady (właściciel)

- FR-021: Właściciel może dodać ręczną rezerwację (przyjętą telefonicznie): data, turnus, liczba uczestników, opcjonalna notatka — wpis konsumuje miejsca z dziennego limitu w tej samej atomowej regule co akceptacje z aplikacji. Priority: must-have. Change: new
  > Socrates: Kontrargument: „właściciel może wpisywać wszystko ręcznie i ignorować zapytania z aplikacji — apka staje się notatnikiem, nie kanałem rezerwacji”. Rezolucja: ryzyko zaadresowane oznaczeniem źródła (FR-023) zamiast twardych limitów — nawet jako „notatnik” apka trzyma gwarancję anty-overbooking i buduje nawyk; zapytania z aplikacji i tak przychodzą mailem.
- FR-022: Właściciel może zablokować cały dzień („zablokuj mi ten dzień”) i zdjąć blokadę; zablokowany dzień nie przyjmuje nowych zapytań gości ani akceptacji, a w filtrze dostępności katalogu (FR-002) zachowuje się jak dzień bez wolnych miejsc. Priority: must-have. Change: new
  > Socrates: Kontrargument: „blokadę da się osiągnąć wpisem ręcznym na pełny limit — po co osobna akcja?”. Rezolucja: osobna akcja zostaje — semantyka „dzień wyłączony” ≠ „dzień pełny” (właściciel prosił wprost; wpis na sztuczną liczbę osób zakłamuje statystyki i źródła).
- FR-023: Właściciel widzi przy każdej rezerwacji jej źródło: aplikacja lub telefon (wpis ręczny). Priority: must-have. Change: new
  > Socrates: stands as written — minimalny koszt, daje dane do oceny adopcji kanału aplikacji (wybór użytkownika w rundzie decyzyjnej 2026-07-19).

### Oferty i filtry tematyczne

- FR-024: Właściciel może dodać, edytować i usunąć oferty swojej zagrody: nazwa, opis, czas trwania, adresaci, temat warsztatów, opcjonalna cena; brak ceny prezentowany jako „cena ustalana indywidualnie”. Priority: must-have. Change: new
  > Socrates: Kontrargument: „obowiązkowa cena daje klientowi »cenę na tacy«, o którą prosił właściciel”. Rezolucja: cena opcjonalna — część zagród ma stawki negocjowane per grupa; przymus ceny byłby barierą publikacji ofert. Jednostka ceny (za osobę / za grupę) → Open Questions.
- FR-025: Gość widzi na stronie zagrody listę jej ofert z cenami (lub „cena ustalana indywidualnie”). Priority: must-have. Change: new
  > Socrates: stands as written — konsumpcja FR-024; „klienci chcą ceny gotowe podane na tacy” (feedback wprost).
- FR-026: Gość może filtrować katalog po temacie warsztatów i adresatach (taksonomia wzorowana na katalogu Ogólnopolskiej Sieci Zagród Edukacyjnych: tematyka zajęć, zakres oferty, adresaci). Priority: must-have. Change: new
  > Socrates: Kontrargument: „właściciel sam mówi, że te filtry »nie muszą być« na start”. Rezolucja: zostają w pakiecie jako must-have, bo zależą od danych z FR-024 (jedna migracja, jeden formularz właściciela); dokładna lista wartości taksonomii → Open Questions. Roadmapa może dowieźć ten slice jako ostatni.

### Persona klienta indywidualnego

- FR-027: Gość wysyłający zapytanie wybiera typ grupy (szkoła / przedszkole / grupa indywidualna / inna), a formularz i komunikaty używają neutralnego języka („liczba uczestników”, „osoba kontaktowa” zamiast wyłącznie „uczniowie”/„nauczyciel”). Priority: must-have. Change: modified
  > Socrates: stands as written — „kupa zagród robi też zajęcia indywidualne” (feedback wprost); minimalna zmiana istniejącego formularza, nie osobna ścieżka produktowa.

### Zachowane (preserved — muszą jawnie przetrwać)

- FR-028: Atomowa reguła akceptacji („dokładnie jeden sukces” pod współbieżnością, komunikat „X z Y zajęte, Z wymaga miejsca”) działa jak dotychczas — z sumą rozszerzoną o wpisy ręczne i blokady dni. Priority: must-have. Change: modified
  > Socrates: stands as written — to nośnik kryterium sukcesu #1; rozszerzenie sumy nie może osłabić własności atomowości (test współbieżności do powtórzenia z wpisami ręcznymi w miksie).
- FR-029: Istniejący przepływ gościa — zapytanie z formularza, mail potwierdzający z tokenem anulowania, anulowanie przed akceptacją, maile akceptacji/cofnięcia — działa bez zmian. Priority: must-have. Change: preserved
- FR-030: Istniejące filtry katalogu (województwo/miasto AND, opcjonalnie data + liczba uczestników z filtrem dostępności) działają bez zmian; sortowanie po odległości jest dodatkiem, nie zamiennikiem. Priority: must-have. Change: preserved
- FR-031: Prywatność kontaktu gościa (widoczny wyłącznie dla właściciela tej zagrody, RLS) oraz jednoręczna mobilna używalność panelu — bez regresu; nowe tabele objęte analogiczną ochroną. Priority: must-have. Change: preserved

## User Stories

### US-03: Właściciel wpisuje rezerwację telefoniczną, a gwarancja anty-overbooking trzyma między kanałami

- **Given** właściciel z opublikowaną zagrodą (limit dzienny 30 osób), zalogowany na telefonie
- **And** w skrzynce czeka zapytanie z aplikacji na 2026-09-15 (15 osób)
- **When** po rozmowie telefonicznej dodaje wpis ręczny: 2026-09-15, turnus „Rano”, 20 osób
- **Then** wpis pojawia się na liście ze źródłem „telefon”, a wolne miejsca na ten dzień spadają do 10
- **And** gdy właściciel próbuje zaakceptować oczekujące zapytanie (15 osób)
- **Then** system blokuje akceptację komunikatem „Limit dzienny przekroczony (20 z 30 zajęte, 15 wymaga miejsca)”
- _(Przed zmianą: rezerwacja telefoniczna była niewidzialna dla systemu i akceptacja przeszłaby, tworząc overbooking w realu.)_

#### Acceptance Criteria

- Wpis ręczny konsumuje miejsca tą samą atomową operacją co akceptacja z aplikacji (test współbieżny: równoległy wpis ręczny i akceptacja kolidującego zapytania → dokładnie jedna operacja przechodzi)
- Blokada dnia (FR-022) zeruje dostępność: nowe zapytania gości na ten dzień są odrzucane na formularzu, akceptacje blokowane, a zagroda znika z wyników filtra dostępności na tę datę
- Wpis ręczny i blokadę można usunąć — miejsca wracają natychmiast (jak przy cofnięciu akceptacji)
- Źródło rezerwacji (aplikacja/telefon) widoczne na liście i w szczegółach

### US-04: Klient indywidualny znajduje najbliższą zagrodę z telefonu

- **Given** niezalogowany gość z telefonem, poza domem, bez wiedzy o zagrodach w okolicy
- **When** otwiera stronę główną i tapie centralne CTA „Znajdź zagrodę”, po czym zgadza się na udostępnienie lokalizacji
- **Then** widzi katalog posortowany od najbliższej zagrody, z przybliżoną odległością na każdej karcie
- **When** otwiera stronę zagrody
- **Then** widzi oferty z cenami (lub „cena ustalana indywidualnie”) i wysyła zapytanie wybierając typ grupy „grupa indywidualna”
- _(Przed zmianą: landing mówił do właściciela, katalog wymagał znajomości województwa/miasta, strona zagrody nie miała ofert ani cen, formularz zakładał klasę szkolną.)_

#### Acceptance Criteria

- Odmowa lokalizacji → katalog w obecnym kształcie (filtry), bez komunikatów błędu i bez ponawiania prośby przy każdej wizycie
- Sortowanie po odległości współpracuje z istniejącymi filtrami (AND) i filtrem temat/adresaci
- Lokalizacja gościa nie jest utrwalana po zakończeniu sesji wyszukiwania
- Formularz z typem grupy nadal waliduje jak dziś (data w przyszłości, liczba uczestników > 0, e-mail, telefon PL)

## Business Logic

Reguła obecna: system przy akceptacji sumuje uczestników zaakceptowanych zapytań na dany dzień i odmawia, gdy suma + nowi uczestnicy przekroczyłaby dzienny limit zagrody — atomowo, „dokładnie jeden sukces”.

**Zmiana reguły (modyfikacja):** suma obejmuje odtąd także uczestników z ręcznych wpisów właściciela, a dzień objęty blokadą ma dostępność zero (żadne zapytania ani akceptacje nie przechodzą). Wejścia rozszerzone o wpisy ręczne (data, turnus, liczba osób) i blokady dni; wyjście i komunikaty bez zmian („X z Y zajęte, Z wymaga miejsca”). Usunięcie wpisu/blokady zwalnia miejsca natychmiast — symetrycznie do cofnięcia akceptacji.

**Nowa reguła (kalkulacja):** katalog porządkuje zagrody rosnąco po odległości między lokalizacją urządzenia gościa a lokalizacją zagrody (wyznaczoną z miejscowości profilu); gość spotyka ją jako domyślne sortowanie „najbliżej mnie” po udostępnieniu lokalizacji, z przybliżoną odległością na karcie.

Workflow stanów zapytania — bez zmian; wpis ręczny jest nowym bytem obok zapytań (nie przechodzi przez stany oczekujące/zaakceptowane — powstaje od razu jako zajętość miejsc).

## Constraints & Preserved Behavior

- **Migracje wyłącznie addytywne:** nowe tabele/kolumny (oferty, wpisy ręczne, blokady dni, współrzędne zagrody, typ grupy, taksonomia temat/adresaci) nie łamią istniejących danych produkcyjnych; istniejące zagrody bez ofert/taksonomii pozostają w pełni funkcjonalne w katalogu (puste sekcje, nie błędy). Współrzędne istniejących zagród uzupełniane automatycznie z miasta w profilu.
- **Kontrakty publiczne bez zmian:** URL-e katalogu i stron zagród, tokenizowane linki anulowania w już wysłanych mailach, istniejące API akceptacji/odrzucenia/cofnięcia.
- **Kanał e-mail bez zmian:** żadnych nowych typów maili w tym pakiecie; istniejące maile (nowe zapytanie, akceptacja, cofnięcie, weryfikacja, reset) działają jak dotychczas.
- **RLS/prywatność:** nowe tabele (wpisy ręczne, blokady, oferty) objęte ochroną per-właściciel analogiczną do zapytań; kontakt gościa niezmiennie tylko dla właściciela tej zagrody.
- **Test współbieżności z F-01 do rozszerzenia**, nie do podmiany: mix wpis ręczny + akceptacja z aplikacji musi zachować „dokładnie jeden sukces”.
- **Rollback:** każdy slice pakietu musi być wycofywalny niezależnie (blast radius: katalog i panel — rdzeń akceptacji dotykany tylko rozszerzeniem sumy).

## Non-Functional Requirements

- Odmowa udostępnienia lokalizacji nie blokuje żadnej ścieżki gościa — katalog zachowuje się dokładnie jak przed zmianą.
- Lokalizacja urządzenia gościa jest używana wyłącznie do posortowania wyników bieżącej sesji i nie jest utrwalana ani przekazywana dalej.
- Prezentowana odległość jest jawnie przybliżona (dokładność na poziomie miejscowości); produkt nie sugeruje precyzji GPS.
- Lista katalogu z sortowaniem po odległości i nowymi filtrami trzyma dotychczasowy próg: widoczna < 2 s od interakcji, p95.
- Dodanie wpisu ręcznego przez właściciela — jednoręcznie na telefonie, z widocznym potwierdzeniem < 15 s od otwarcia panelu (spójnie z progiem akceptacji).
- Istniejące NFR MVP (e-mail < 5 min, prywatność kontaktu, mobile Chrome/Safari dwie ostatnie wersje, historia zapytań ≥ 12 mc) obowiązują bez zmian.

## Non-Goals

- **Rytm tygodnia (szablon dostępności)** — pomysł właściciela „5 minut w niedzielę”: duży moduł kalendarza; wraca gdy będzie więcej niż jeden aktywny właściciel (v2).
- **Widok kalendarza / pojedynczego dnia** — wizualny kalendarz w panelu odłożony; lista zapytań + wpisy ręczne wystarczą do domknięcia pętli (v2).
- **Tryb „sama prośba o kontakt”** — lżejszy typ zapytania bez daty/liczby osób odłożony (v2).
- **Mapa w UI** — geolokalizacja to wyłącznie sortowanie listy po odległości; żadnego widoku mapy (podtrzymany non-goal MVP w zawężonej formie — zniesiony tylko dla sortowania).
- **Non-goals MVP pozostają w mocy:** płatności online, oceny/recenzje, SMS/push, multi-zagroda na konto, konto gościa, moderacja admin, negocjacja liczby uczestników poza limit — ta zmiana niczego z tej listy nie otwiera.
- **Model biznesowy (abonament/darmowa)** — decyzja go-to-market, nie produktowa; nie blokuje żadnego FR tego pakietu.

## Open Questions

1. **Taksonomia temat warsztatów / adresaci (FR-024/026)** — dokładna lista wartości; wzorować na katalogu Ogólnopolskiej Sieci Zagród Edukacyjnych (tematyka zajęć, zakres oferty, adresaci) i skonsultować z właścicielem-doradcą. Owner: user. Block: tylko slice filtrów (FR-026); reszta pakietu może iść.
2. **Jednostka ceny oferty (FR-024)** — cena za osobę, za grupę, czy oba warianty do wyboru właściciela? Owner: user (z właścicielem-doradcą). Block: slice ofert; rozstrzygnąć przed jego planowaniem.

## Forward: tech-stack

- Mechanizm geokodowania miejscowości (źródło współrzędnych polskich miast, np. słownik lokalny vs zewnętrzne API) — decyzja downstream przy planowaniu slice'a geolokalizacji; wymaganie produktowe to tylko: zero nowych pól dla właściciela, dokładność miejscowości.
- Sortowanie po odległości ma współpracować z istniejącym zapytaniem katalogu bez regresu p95 < 2 s (indeks/obliczenie — downstream).

## Quality cross-check

Wynik: **accepted** — wszystkie 7 elementów obecnych (Access Control: bez zmian, jawnie zapisane; Business Logic: jednozdaniowa modyfikacja reguły + nowa kalkulacja; artefakty: obecne; Timeline acknowledgment: obecny; Non-Goals: obecne; Preserved behavior: obecne, FR-028…031 + sekcja Constraints).

## Timeline acknowledgment

Acknowledged on 2026-07-19: pakiet 6 poprawek szacowany na ~6 tygodni pracy po godzinach — powyżej domyślnego 3-tygodniowego budżetu. User świadomie zaakceptował sustained-effort cost; mitygacja ryzyka „w połowie zmienionego systemu”: roadmapa tnie pakiet na niezależnie wycofywalne slice'y dowożone po kolei, wartość przyrostowo. Brak twardego deadline'u — jesienno-zimowy zlot zagród traktowany jako cel motywacyjny.
