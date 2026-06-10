---
project: "Zagroda Hub"
version: 2
status: draft
created: 2026-05-25
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# Zagroda Hub — Product Requirements Document

## Vision & Problem Statement

Właściciel zagrody edukacyjnej traci czas reagując na telefoniczne zapytania o rezerwacje wycieczek szkolnych. Telefon dzwoni w trakcie pracy w terenie (przy zwierzętach, w trakcie zajęć z dziećmi, w pracach gospodarskich), więc każde zapytanie albo przerywa właściciela, albo zostaje nieobsłużone — a kartka z notatkami prowadzi do podwójnych rezerwacji i awantur. Po drugiej stronie nauczyciel nie wie, czy danej daty jest sens dzwonić, więc obdzwania kilka zagród zanim znajdzie wolny termin.

Insight: właściciel zagrody pracuje na telefonie w terenie, a nie przy biurku — istniejące rozwiązania bookingowe celują w obsługę z desktopu/recepcji i są nieadekwatne. Drugi insight (kontekstowy, nie load-bearing dla MVP): polski rynek wycieczek edukacyjnych ma swoją specyfikę (sezonowość, dotacje, klasa = ~25 dzieci) — produkt może to dopasować w wersjach następnych.

## User & Persona

**Primary persona — Właściciel zagrody edukacyjnej.** Prowadzi jedną zagrodę edukacyjną z programem dla dzieci (zajęcia, kontakt ze zwierzętami, rękodzieło itp.). Pracuje fizycznie — w polu, z dziećmi, w zwierzętarni. Sięga po aplikację gdy: (a) ma chwilę przerwy między zajęciami, (b) wieczorem zbiera nieobsłużone zapytania, (c) telefon dzwoni i chce szybko sprawdzić czy ten termin jest wolny — wszystko na telefonie, jednoręcznie, brudnymi palcami. Właściciele z wieloma lokalizacjami pozostają poza zakresem MVP (patrz `## Non-Goals`).

### Secondary persona

**Nauczyciel/wychowawca.** Szuka zagrody na wycieczkę klasową. Zazwyczaj 2–4 tygodnie przed terminem. Chce minimalnie: znaleźć zagrodę w swoim województwie, zobaczyć czy termin jest sensowny, wysłać zapytanie z liczbą uczniów i kontaktem. Konwersja od kontaktu do potwierdzenia może iść poza systemem (telefon, email).

## Success Criteria

### Primary

- System w 100% przypadków poprawnie blokuje overbooking i konflikty współbieżnych rezerwacji w momencie zatwierdzania terminu przez właściciela. To jest test domain rule: jeśli kiedykolwiek dwie rezerwacje na ten sam termin / przekroczenie limitu miejsc zostaną zaakceptowane, produkt zawiódł.

### Secondary

- Właściciel zagrody jest w stanie zweryfikować i zmienić status rezerwacji w czasie poniżej 15 sekund na urządzeniu mobilnym. Mocne, ale nie wystarczające samo w sobie — jeśli czas obsługi jest 15s ale system pozwala na overbooking, produkt jest gorszy od kartki.

### Guardrails

- Panel właściciela jest używalny na telefonie w pionie, jednoręcznie (przy zwierzętach / w terenie). Desktop-only panel = produkt do kosza.

## User Stories

### US-01: Właściciel akceptuje rezerwację bez ryzyka overbooking

- **Given** właściciel z opublikowaną zagrodą (dzienny limit np. 30 osób), zalogowany na telefonie
- **And** w skrzynce zapytań są dwa oczekujące zapytania na ten sam dzień (klasa A: 20 osób, klasa B: 15 osób)
- **When** właściciel otwiera pierwsze zapytanie (klasa A: 20 osób) i klika "Akceptuj"
- **Then** system zapisuje rezerwację i wysyła email do nauczyciela klasy A
- **And** gdy właściciel otwiera drugie zapytanie (klasa B: 15 osób) i klika "Akceptuj"
- **Then** system blokuje akceptację, pokazuje "Limit dzienny przekroczony (20 z 30 zajęte, 15 wymaga miejsca)" i pozostawia status oczekujące

#### Acceptance Criteria

- Akceptacja musi sprawdzić limit miejsc na konkretny dzień rezerwacji, nie tylko czy są inne rezerwacje
- Komunikat błędu musi wskazać konkretną liczbę zajętych vs wymaganych miejsc
- Po cofnięciu akceptacji (FR-016) miejsca muszą być natychmiast dostępne dla kolejnych akceptacji
- Współbieżność: jeśli dwie sesje jednocześnie akceptują konfliktujące zapytania, dokładnie jedna akceptacja zostaje przyjęta

### US-02: Nauczyciel znajduje zagrodę i wysyła zapytanie

- **Given** niezalogowany nauczyciel szukający zagrody w województwie mazowieckim na konkretny dzień (2026-06-12) dla klasy 25 uczniów
- **When** otwiera stronę główną → katalog
- **And** filtruje listę po województwie "mazowieckie" i mieście "Płock"
- **Then** widzi listę zagród spełniających kryteria (lub komunikat "brak wyników" jeśli pusta)
- **When** klika kartę zagrody i wypełnia formularz (data, liczba uczniów, imię, email, telefon) → wyślij
- **Then** widzi potwierdzenie wysłania i otrzymuje email z linkiem do anulowania zapytania
- **And** właściciel otrzymuje email "masz nowe zapytanie"

#### Acceptance Criteria

- Filtr województwo + miasto działa jako AND (nie OR)
- Formularz waliduje: data w przyszłości, liczba uczniów > 0, email w prawidłowym formacie, telefon w polskim formacie
- Email do gościa zawiera token w linku anulowania (bez tokena = brak możliwości anulowania cudzego zapytania)
- Zapytanie ląduje na liście "oczekujące" w panelu właściciela natychmiast po wysłaniu (max 2s)

## Functional Requirements

### Catalog (publiczne)

- FR-001: Gość może przeglądać publiczny katalog opublikowanych zagród. Priority: must-have
  > Socrates: stands as written — standardowy public listing, brak ryzyka domenowego; bez tego nie ma katalogu.
- FR-002: Gość może filtrować katalog po województwie, mieście oraz (opcjonalnie) dacie wycieczki i liczbie uczestników. Zagrody bez wolnych miejsc na podany dzień/liczbę osób są filtrowane z wyników (lub oznaczone jako niedostępne). Priority: must-have
  > Socrates: Kontrargument: "filtr po lokalizacji bez filtra dostępności daty jest połowiczny — nauczyciel i tak musi wejść w każdą zagrodę". Rezolucja: rozszerzono FR-002 o opcjonalny filtr data + liczba osób; pokazujemy tylko zagrody z wolnymi miejscami na ten dzień. Bez tego ścieżka wyszukiwania pozostaje frustrująca.
- FR-003: Gość może otworzyć stronę pojedynczej zagrody z jej opisem i zdjęciem. Priority: must-have
  > Socrates: stands as written — strona zagrody jest pre-requisite formularza FR-004.

### Booking request (gość)

- FR-004: Gość może wysłać zapytanie o rezerwację z formularza na karcie zagrody, podając datę wycieczki, wybrany turnus (z listy slotów zdefiniowanych przez tę zagrodę), liczbę uczestników, swoje imię/nazwisko, email i telefon. Priority: must-have
  > Socrates: Kontrargument: "sama data nie wystarczy — dwie klasy mogą być w różnych slotach tego samego dnia". Rezolucja: dodano pole 'turnus' do formularza; sloty definiowane per-zagroda przez właściciela (FR-009). Limit miejsc liczony łącznie per dzień (suma uczestników wszystkich slotów ≤ limit dzienny), nie per slot — zwykle te same fizyczne zasoby (sala, zwierzęta) obsługują wszystkie turnusy.
- FR-005: Gość otrzymuje email z potwierdzeniem akceptacji rezerwacji po decyzji właściciela. Priority: must-have
  > Socrates: stands as written — kanał wybrany świadomie w Phase 3 (email obustronny); bez tego gość nie wie czy może planować wycieczkę.
- FR-015: Gość może anulować swoje zapytanie przed akceptacją przez właściciela poprzez tokenizowany link w mailu potwierdzającym wysłanie zapytania. Priority: must-have
  > Socrates: stands as written — bez tej ścieżki anulowanie wraca na telefon (główny pain point produktu); tokenizowany link to jedyny sposób auth bez konta gościa.

### Authentication (właściciel)

- FR-006: Właściciel może zarejestrować konto (email + hasło). Po rejestracji system wysyła link weryfikacyjny na podany email — publikacja zagrody (FR-010) i zarządzanie rezerwacjami (FR-014, FR-016) są niedostępne dopóki email nie zostanie zweryfikowany. Dotyczy wyłącznie ścieżki email+hasło; ścieżka OAuth z `email_verified=true` jest zwolniona z tej bramki (FR-017). Priority: must-have
  > Socrates: stands as written — weryfikacja emaila rozszerzona w odpowiedzi na Socrates FR-010 (bramka anty-spam). Standardowy auth flow.
- FR-007: Właściciel może zalogować się i wylogować. Logowanie obsługuje obie ścieżki: email+hasło oraz OAuth (FR-017). Priority: must-have
  > Socrates: stands as written — podstawa auth, brak ryzyka domenowego.
- FR-008: Właściciel może zresetować hasło przez email. Priority: must-have
  > Socrates: stands as written — bez resetu serwis manualny dla każdego zapomnianego hasła; dostarczanie maili i tak wymagane przez FR-006 (weryfikację) i FR-011 (notyfikacje).
- FR-017: Właściciel może zarejestrować konto i zalogować się przez Google OAuth lub Facebook OAuth. Jeśli dostawca zwraca `email_verified=true`, system traktuje email jako zweryfikowany i pomija bramkę z FR-006 (publikacja zagrody i zarządzanie rezerwacjami dostępne natychmiast po pierwszym logowaniu). Priority: must-have
  > Socrates: Kontrargument: "dwa OAuth + email+hasło + reset + weryfikacja = trzy równoległe ścieżki auth w 3-tyg. MVP; OAuth był w Non-Goals dokładnie z powodu kosztu konfiguracji". Rezolucja: user świadomie akceptuje poszerzenie scope i potencjalne wydłużenie timeline'u (zarejestrowane w shape-notes `## Timeline acknowledgment`). Pominięcie własnej weryfikacji emaila gdy dostawca już go zweryfikował to standardowy OAuth pattern, nie domain risk.
- FR-018: Gdy logowanie OAuth (FR-017) trafia na adres email istniejącego konta założonego ścieżką email+hasło (FR-006), system automatycznie łączy obie ścieżki w jedno konto **wyłącznie** gdy dostawca zwraca `email_verified=true`. Bez verified — próba logowania OAuth zostaje zablokowana z komunikatem. Priority: must-have
  > Socrates: Kontrargument: "auto-merge po samym dopasowaniu emaila to klasyczny wektor account-takeover — atakujący kontrolujący OAuth z cudzym emailem przejmuje zagrodę i rezerwacje". Rezolucja: bramka `email_verified=true` od dostawcy jest twardym warunkiem merge'u; bez verified merge nie następuje. Edge case (provider zwraca verified=false) skierowany do `## Open Questions` co do dokładnego UX.

### Owner profile (właściciel)

- FR-009: Właściciel może dodać i edytować profil swojej zagrody: nazwa, opis, lokalizacja (województwo + miasto), zdjęcie, dzienny limit uczestników, lista oferowanych turnusów (każdy turnus: nazwa wyświetlana + obowiązkowy zakres czasowy w formacie HH:MM-HH:MM), min. 1 turnus. Priority: must-have
  > Socrates: Kontrargument: "wolny tekst dla slotów → chaos: '9-12' / 'rano' / '9.00-12.00' = niemożliwe filtrowanie". Rezolucja: zakres czasowy ustrukturyzowany jako HH:MM-HH:MM (walidacja przy zapisie); etykieta wyświetlana może być dowolna ("Rano", "Po południu"). Dwie kolumny per slot: label + time_range.
- FR-010: Zagroda dodana przez właściciela ze zweryfikowanym emailem jest natychmiast widoczna w katalogu publicznym — brak moderacji treści przez admina w MVP. Priority: must-have
  > Socrates: Kontrargument: "fake-profile / spam zniszczą reputację katalogu jeśli każdy może publikować". Rezolucja: brama na publikację to weryfikacja emaila (FR-006 rozszerzone); ręczne kasowanie śmieci przez operatora 1x/tydzień przez pierwsze 2-3 miesiące akceptowane jako koszt MVP. Moderacja admin draftów wraca w v2 gdy katalog przekroczy ~50 zagród.

### Owner panel (właściciel)

- FR-011: Właściciel otrzymuje email gdy pojawi się nowe zapytanie na jego zagrodę. Priority: must-have
  > Socrates: stands as written — bez powiadomienia właściciel sam musi się logować by zobaczyć zapytania; kanał wybrany w Phase 3.
- FR-012: Właściciel może zobaczyć listę zapytań na swoją zagrodę (oczekujące, zaakceptowane, odrzucone, anulowane), posortowaną wg daty zapytania. Priority: must-have
  > Socrates: stands as written — pure read-only listing, brak ryzyka domenowego.
- FR-013: Właściciel może otworzyć szczegóły zapytania (data wycieczki, liczba uczestników, kontakt nauczyciela). Priority: must-have
  > Socrates: stands as written — szczegóły to dane wprowadzone przez gościa w FR-004; widoczne tylko dla właściciela tej zagrody (privacy guardrail).
- FR-014: Właściciel może zaakceptować lub odrzucić zapytanie. Akceptacja uruchamia sprawdzenie sumy uczestników wszystkich zaakceptowanych rezerwacji na dany dzień; jeśli suma + liczba uczestników nowego zapytania przekroczyłaby limit dzienny zagrody, system blokuje akceptację i pokazuje "Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)". Priority: must-have
  > Socrates: Kontrargument: "współbieżne akceptacje (dwie sesje, dwa zapytania kolidujące) mogą oba przejść walidację jednocześnie". Rezolucja: właściwość 'exactly one succeeds' jest już w US-01 Acceptance Criteria. Mechanizm gwarantujący atomowość pozostaje decyzją downstream (warstwa implementacji), ale PRD wymaga tej własności jako observable behavior — test: dwie równoległe próby akceptacji konfliktujących zapytań → dokładnie jedna kończy się sukcesem, dokładnie jedna jest zablokowana z komunikatem przekroczenia limitu.
- FR-016: Właściciel może cofnąć akceptację rezerwacji (np. nauczyciel odwołał telefonicznie), zwalniając termin/miejsca dla innych zapytań. System wysyła email do nauczyciela informujący o cofnięciu akceptacji. Priority: must-have
  > Socrates: Kontrargument: "bez notyfikacji do nauczyciela o cofnięciu → niespójność informacji: nauczyciel myśli że ma akceptację, a system zwolnił termin". Rezolucja: cofnięcie akceptacji wyzwala email do gościa (analogiczny do FR-005 ale w odwrotną stronę). Bez tego cofnięcie powoduje gorszy chaos niż brak rezerwacji.

## Non-Functional Requirements

- Lista wyników katalogu publicznego jest widoczna dla gościa w czasie poniżej 2 sekund od kliknięcia filtra, p95.
- Akceptacja zapytania przez właściciela kończy się widocznym potwierdzeniem (zaakceptowane / zablokowane z powodem) w czasie poniżej 15 sekund od dotarcia do listy oczekujących na urządzeniu mobilnym, p95.
- Pod równoczesnymi próbami akceptacji konfliktujących zapytań na tę samą datę dokładnie jedna kończy się sukcesem; pozostałe widzą komunikat blokady. (Domain rule observable property; mechanizm gwarantujący — downstream.)
- Panel właściciela i katalog publiczny są używalne (pełna ścieżka MVP możliwa do ukończenia) na dwóch ostatnich wersjach mobile Chrome Android i mobile Safari iOS, w orientacji pionowej, jednoręcznie.
- Email transakcyjny (nowe zapytanie do właściciela, akceptacja do gościa, cofnięcie akceptacji do gościa, link weryfikacyjny, reset hasła) jest dostarczany w czasie poniżej 5 minut od akcji uruchamiającej, w warunkach typowych (brak masowego outage'u dostawcy email).
- Dane kontaktowe nauczyciela (email + telefon) są widoczne wyłącznie dla właściciela tej zagrody, do której zapytanie zostało wysłane — żaden inny zalogowany właściciel ani niezalogowany użytkownik ich nie widzi.
- Historia zapytań (we wszystkich stanach) jest dostępna w panelu właściciela przez minimum 12 miesięcy od daty wysłania zapytania.
- Łączenie konta email+hasło z kontem OAuth (FR-018) wymaga potwierdzenia `email_verified=true` od dostawcy; system nigdy nie scali kont na podstawie samego dopasowania adresu email (anty-takeover guardrail).

## Business Logic

Zagroda Hub przy każdej akceptacji zapytania o rezerwację sumuje zaakceptowanych uczestników na ten dzień w wybranej zagrodzie i gwarantuje, że suma + nowi uczestnicy nie przekroczy dziennego limitu miejsc zdefiniowanego przez właściciela — w przeciwnym razie odmawia akceptacji.

Wejścia (z perspektywy użytkownika):

- Data wycieczki, liczba uczestników (wybrane przez gościa w formularzu — FR-004)
- Dzienny limit uczestników (zdefiniowany przez właściciela w profilu zagrody — FR-009)
- Zbiór wcześniej zaakceptowanych rezerwacji na tę zagrodę na ten dzień (suma uczestników)

Wyjście: akceptacja zostaje zatwierdzona (rezerwacja przechodzi w stan "zaakceptowana", gość otrzymuje email) lub odrzucona z komunikatem wskazującym liczbę zajętych vs wymaganych miejsc.

Gdzie użytkownik to spotyka: właściciel klika "Akceptuj" w panelu na liście oczekujących zapytań (FR-014). Reguła zostaje wykonana raz, atomowo — przy równoległych próbach akceptacji konfliktujących zapytań dokładnie jedna kończy się sukcesem.

Workflow stanów zapytania: `oczekujące` → `zaakceptowane` (akcja: FR-014 akceptacja) | `odrzucone` (akcja: FR-014 odrzucenie) | `anulowane przez gościa` (akcja: FR-015) | `cofnięte przez właściciela` (akcja: FR-016, ze stanu "zaakceptowane"). Stan `cofnięte przez właściciela` zwalnia miejsca dla kolejnych akceptacji.

## Access Control

Dwie role w MVP:

- **Gość (nauczyciel)** — może przeglądać katalog publiczny i wysłać zapytanie o rezerwację bez logowania ani zakładania konta. Komunikacja statusu rezerwacji (potwierdzenie wysłania, akceptacja, cofnięcie akceptacji) odbywa się wyłącznie przez email. Anulowanie zapytania przed akceptacją — przez tokenizowany link w mailu (FR-015).
- **Właściciel zagrody** — dwie równoległe ścieżki rejestracji/logowania w MVP:
  - **Email + hasło** — rejestracja otwarta; po rejestracji system wymaga weryfikacji emaila (link), zanim odblokuje publikację zagrody i zarządzanie rezerwacjami (FR-006). Reset hasła przez email (FR-008).
  - **OAuth Google lub Facebook** — rejestracja/logowanie przez dostawcę (FR-017). Jeśli dostawca zwraca `email_verified=true`, bramka weryfikacji z FR-006 jest pominięta i właściciel ma od razu dostęp do publikacji zagrody.
  - **Merge kont** — gdy logowanie OAuth trafia na email istniejącego konta założonego emailem+hasłem, system automatycznie łączy ścieżki w jedno konto, **wyłącznie** gdy dostawca zwraca `email_verified=true` (FR-018). Bez verified — login OAuth zostaje zablokowany z komunikatem (patrz `## Open Questions` co do dokładnego UX tego edge case'u).
  - Właściciel prowadzi w MVP dokładnie jedną zagrodę przypisaną do swojego konta. Zarządza wyłącznie zapytaniami na swoją zagrodę.

Auth: email + hasło **oraz** OAuth Google i OAuth Facebook. Reset hasła przez email jest must-have dla ścieżki email+hasło (FR-008).

Niezalogowany użytkownik trafiający na route panelu właściciela → przekierowanie na login (z opcją wyboru: email/hasło lub OAuth). Gość z formularzem publicznym i tokenowanym linkiem anulowania → brak gate.

Role nieobecne w MVP (patrz `## Non-Goals`): admin do moderacji drafts (publikacja od razu po weryfikacji emaila / OAuth verified), konto gościa z panelem śledzenia (komunikacja przez email + token).

## Non-Goals

- **Mapy / geolokalizacja GPS** — filtr lokalizacji to wybór województwa i miasta z listy, koniec. Mapy podnoszą koszt MVP bez zmiany core flow.
- **Płatności online + fakturowanie** — rozliczenia gotówka/przelew na miejscu po wizycie. Integracja płatności = osobny moduł, nie pasuje do "anti-overbooking" jako rule.
- **System ocen / opinii / recenzji** — reputacja przez pocztę pantoflową. Recenzje wymagają moderacji + obsługi sporów = nie MVP.
- **SMS / push notifications / advanced digesty** — tylko email transakcyjny (FR-005, FR-011, FR-016 + reset hasła, weryfikacja). SMS = koszt + integracja dodatkowego dostawcy.
- **Multi-zagroda na konto właściciela** — w MVP jedno konto = jedna zagroda. Multi przesunięte do v2 gdy pierwsi właściciele będą prosić.
- **Konto gościa z panelem śledzenia zapytań** — gość nie zakłada konta; komunikacja przez email (potwierdzenie wysłania z linkiem anulowania, akceptacja/cofnięcie). Konto gościa w v2.
- **Moderacja admin draftów zagród** — brak roli admin w MVP. Anti-spam przez weryfikację emaila (FR-006) + ręczne kasowanie śmieci przez operatora 1x/tydzień. Moderacja w v2 gdy katalog przekroczy ~50 zagród.
- **Negocjacja liczby uczestników poza limit** — system odrzuca twardo zapytania > wolnych miejsc. "Weź 30 zamiast 35" załatwia się telefonicznie poza systemem. Implikuje akceptowany trade-off: część rezerwacji ucieknie na telefon przy szczytach.

## Open Questions

1. **OAuth merge UX gdy `email_verified=false`** (FR-018) — gdy logowanie OAuth zwraca adres email nie-zweryfikowany przez dostawcę, a istnieje już konto email+hasło z tym samym adresem, jakie powinno być zachowanie? Możliwe opcje: (a) login OAuth zostaje odrzucony z komunikatem "potwierdź email u dostawcy i spróbuj ponownie", (b) tworzy się osobne konto OAuth obok istniejącego (split-brain — dwa konta dla tego samego użytkownika), (c) system wysyła link weryfikacyjny do email właściciela istniejącego konta z prośbą o ręczne potwierdzenie merge'u. Owner: user. By: planowanie implementacji (przed startem prac nad FR-017/FR-018). Block: częściowo (FR-017 może ruszyć równolegle; FR-018 wymaga rozstrzygnięcia).
   **Rozstrzygnięte 2026-06-11 (user): opcja (a).** Login OAuth zostaje odrzucony z komunikatem; konto email+hasło pozostaje nietknięte (logowanie hasłem i reset działają normalnie). Blokada jest tymczasowa per stan u dostawcy: gdy dostawca zacznie zwracać `email_verified=true`, następuje standardowy auto-merge (FR-018 happy path). Zachowanie zaimplementowane w S-06 jako bezpieczny default.
