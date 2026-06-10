---
project: "Zagroda Hub"
version: 1
status: draft
created: 2026-06-02
updated: 2026-06-11
prd_version: 2
main_goal: quality
top_blocker: time
---

# Roadmap: Zagroda Hub

> Wyprowadzona z `context/foundation/prd.md` (v2) + auto-zbadany baseline kodu (potwierdzony przez użytkownika 2026-06-02).
> Edytuj w miejscu; archiwizuj przy pełnej regeneracji.
> Slice'y poniżej są w kolejności zależności. Tabela „At a glance" jest indeksem.

## Vision recap

Właściciel zagrody edukacyjnej pracuje w terenie (przy zwierzętach, z dziećmi) i traci czas na telefoniczne zapytania o rezerwacje wycieczek; kartka z notatkami prowadzi do podwójnych rezerwacji. Po drugiej stronie nauczyciel obdzwania kilka zagród, bo nie wie, gdzie jest wolny termin. Zagroda Hub przenosi cały obieg na telefon: nauczyciel znajduje zagrodę i wysyła zapytanie, a właściciel jednoręcznie akceptuje je z **twardą gwarancją braku overbookingu**. Rdzeń produktu — to, co odróżnia go od zwykłego formularza kontaktowego — to reguła domenowa: suma zaakceptowanych uczestników na dany dzień nigdy nie przekroczy dziennego limitu zagrody, nawet przy równoległych akceptacjach.

## North star

**S-04: Właściciel akceptuje/odrzuca zapytanie z atomową blokadą overbookingu** — to milestone walidacyjny, bo kryterium sukcesu #1 ("100% poprawnie blokuje overbooking") wisi właśnie na nim; wszystko inne ma znaczenie tylko jeśli ten przepływ działa.

> _Gwiazda przewodnia_ = najmniejszy kompletny (od zapytania gościa do decyzji właściciela) przepływ, którego udane dostarczenie udowadnia rdzenną hipotezę produktu — umieszczony tak wcześnie, jak pozwalają prerekwizyty, bo reszta produktu obudowuje tylko ten rdzeń.

## At a glance

| ID   | Change ID                               | Outcome (user can …)                                                          | Prerequisites          | PRD refs                                                  | Status   |
| ---- | --------------------------------------- | ----------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------- | -------- |
| F-01 | booking-schema-and-overbooking-guard    | (foundation) schemat domeny + atomowa reguła anty-overbooking z testem        | —                      | FR-014, US-01, NFR (concurrency, privacy, historia 12 mc) | done     |
| F-02 | transactional-email-channel             | (foundation) wpięty kanał e-maili transakcyjnych na Workers (<5 min)          | —                      | FR-005, FR-011, FR-016, NFR (e-mail <5 min)               | done     |
| S-01 | owner-publishes-zagroda                 | właściciel weryfikuje e-mail, tworzy i publikuje profil zagrody w katalogu    | F-01                   | FR-006, FR-007, FR-009, FR-010                            | done     |
| S-02 | catalog-browse-and-zagroda-page         | nauczyciel przegląda i filtruje katalog oraz otwiera stronę zagrody           | F-01, S-01             | FR-001, FR-002, FR-003, US-02                             | done     |
| S-03 | guest-booking-request                   | nauczyciel wysyła zapytanie, dostaje mail z linkiem anulowania, może anulować | F-01, F-02, S-02       | FR-004, FR-011, FR-015, US-02                             | done     |
| S-04 | gated-acceptance-with-overbooking-guard | właściciel widzi listę/szczegóły i akceptuje/odrzuca z blokadą overbookingu   | F-01, F-02, S-01, S-03 | FR-005, FR-012, FR-013, FR-014, US-01                     | proposed |
| S-05 | owner-undo-acceptance                   | właściciel cofa akceptację, zwalnia miejsca i powiadamia nauczyciela mailem   | F-02, S-04             | FR-016                                                    | proposed |
| S-06 | owner-oauth-and-password-reset          | właściciel loguje się przez Google/Facebook OAuth oraz resetuje hasło         | S-01                   | FR-007, FR-008, FR-017                                    | done     |
| S-07 | oauth-account-merge-guard               | właściciel logujący się OAuth na istniejący e-mail ma bezpieczny auto-merge   | S-06                   | FR-018                                                    | proposed |

## Streams

Pomoc nawigacyjna — grupuje elementy dzielące łańcuch prerekwizytów. Kanoniczna kolejność wciąż żyje w grafie zależności poniżej; ta tabela to proponowana kolejność czytania w równoległych torach.

| Stream | Theme                       | Chain                                               | Note                                                                                                               |
| ------ | --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A      | Reguła rezerwacji (rdzeń)   | `F-01` → `S-01` → `S-02` → `S-03` → `S-04` → `S-05` | Ścieżka krytyczna do gwiazdy `S-04`; sekwencjonowana eagerly zgodnie z celem `quality`.                            |
| B      | Powiadomienia e-mail        | `F-02`                                              | Równoległy enabler; dołącza do Stream A przy `S-03` (i zasila `S-04`/`S-05`).                                      |
| C      | Pełne logowanie właściciela | `S-06` → `S-07`                                     | Odgałęzia się od Stream A przy `S-01`; zakres-ryzyko-czasu, po gwieździe; pytanie #1 rozstrzygnięte (opcja a).     |

## Baseline

Co już jest w kodzie na dzień `2026-06-02` (auto-zbadane + potwierdzone przez użytkownika). Fundamenty poniżej zakładają obecność tych warstw i ich **nie** re-scaffoldują.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4 (per tech-stack.md); `src/components/ui` + `src/layouts/Layout.astro`; aplikacja żyje na produkcji.
- **Backend / API:** present — Astro 6 SSR na Cloudflare Workers; trasy API w `src/pages/api/auth/*`; `src/middleware.ts` wpięty (ochrona `/dashboard`).
- **Data:** partial — klient Supabase wpięty (`src/lib/supabase.ts`, `@supabase/ssr@0.10.3`), ale brak katalogu `supabase/migrations/` — zero schematu, brak tabel domenowych (zagroda / zapytanie / turnus).
- **Auth:** partial — starter dostarcza e-mail+hasło (signup/signin/signout API + strona `confirm-email` + bramka `/dashboard`). BRAK wg PRD: reset hasła (FR-008), OAuth Google/Facebook (FR-017), merge kont (FR-018), bramka publikacji na weryfikacji e-mail (FR-006 rozszerzone).
- **Deploy / infra:** present — Cloudflare Workers żywe (`zagroda-hub.webpushit.workers.dev`); `wrangler.jsonc` + CI build (`.github/workflows/ci.yml`, bez joba deploy).
- **Observability:** partial — `observability.enabled` w `wrangler.jsonc` (Workers Logs); brak error trackingu / metryk / dashboardów.

## Foundations

### F-01: Schemat domeny + atomowa reguła anty-overbooking

- **Outcome:** (foundation) minimalny schemat domeny (zagroda z dziennym limitem + turnusy, zapytanie z datą / liczbą uczestników / stanem workflow, powiązanie właściciel↔zagroda, polityka RLS chroniąca kontakt nauczyciela) oraz atomowa operacja akceptacji z blokadą wierszową na poziomie bazy, plus test współbieżności dowodzący „dokładnie jeden sukces".
- **Change ID:** booking-schema-and-overbooking-guard
- **PRD refs:** FR-014, US-01, NFR (współbieżność „dokładnie jeden sukces", prywatność kontaktu nauczyciela, historia zapytań ≥ 12 mc)
- **Unlocks:** S-01, S-02, S-03, S-04 (dostarcza schemat); redukuje główne ryzyko techniczne (`infrastructure.md` Risk #2 — model współbieżności workerd); dostarcza ścieżkę weryfikacji wymaganą przez gwiazdę S-04 (test równoległej akceptacji).
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:**
  - Czy per-request model sesji na workerd nie podważa założeń o transakcji DB? (`infrastructure.md` Risk #2) — Owner: dev. Block: no (mechanizm znany: Supabase `rpc()` + `SELECT … FOR UPDATE`; wymaga potwierdzenia testem).
- **Risk:** Minimalny enabler — ustanawia kontrakt schematu + jedną ryzykowną prymitywę (atomowa akceptacja), nie buduje CRUD katalogu/profilu (to robią slice'y, które ten schemat rozszerzają przez funkcje użytkownika). Sekwencjonowany pierwszy, bo to nośnik kryterium sukcesu #1 i największego ryzyka technicznego; błąd tutaj kompromituje cały produkt.
- **Status:** done

### F-02: Kanał e-maili transakcyjnych

- **Outcome:** (foundation) wybrany i wpięty mechanizm wysyłki maili transakcyjnych aplikacji na Cloudflare Workers, z jedną zweryfikowaną ścieżką dostarczenia poniżej 5 minut.
- **Change ID:** transactional-email-channel
- **PRD refs:** FR-005, FR-011, FR-016, NFR (e-mail transakcyjny < 5 min)
- **Unlocks:** S-03 (potwierdzenie wysłania + link anulowania FR-015, powiadomienie właściciela FR-011), S-04 (mail akceptacji FR-005), S-05 (mail o cofnięciu FR-016).
- **Prerequisites:** —
- **Parallel with:** F-01, S-01
- **Blockers:** —
- **Unknowns:**
  - Mechanizm wysyłki: provider zewnętrzny vs Supabase webhooks vs Cron Triggers? (`infrastructure.md` Risk #8 — Workers nie ma serwera w stylu Node) — Owner: dev/user. Block: no (można ruszyć z domyślnym providerem zewnętrznym; decyzję domyka `/10x-plan`).
- **Risk:** Maile auth (weryfikacja FR-006, reset FR-008) idą natywnie przez Supabase Auth — ten kanał dotyczy wyłącznie maili aplikacyjnych. Niezależny od schematu, więc może iść równolegle z F-01. Ryzyko: zła decyzja mechanizmu może wymusić przeróbkę w kilku slice'ach — stąd osobny fundament, by rozstrzygnąć raz.

## Slices

### S-01: Właściciel publikuje profil zagrody

- **Outcome:** właściciel z zweryfikowanym e-mailem tworzy i edytuje profil zagrody (nazwa, opis, lokalizacja, zdjęcie, dzienny limit, turnusy z zakresem HH:MM-HH:MM), który natychmiast pojawia się w katalogu publicznym.
- **Change ID:** owner-publishes-zagroda
- **PRD refs:** FR-006, FR-007, FR-009, FR-010, NFR (panel używalny na mobile, pionowo, jednoręcznie)
- **Prerequisites:** F-01
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bramka weryfikacji e-mail (FR-006 rozszerzone) dokłada się do istniejącego w baseline skeletonu e-mail+hasło; to anty-spam dla katalogu (FR-010 bez moderacji admina). Pierwsza widoczna funkcja właściciela i jedyne źródło danych katalogu — musi być przed S-02.
- **Status:** done

### S-02: Katalog i strona zagrody (gość)

- **Outcome:** nauczyciel przegląda publiczny katalog, filtruje po województwie i mieście (AND) oraz opcjonalnie po dacie i liczbie uczestników (zagrody bez wolnych miejsc znikają/oznaczone), i otwiera stronę pojedynczej zagrody.
- **Change ID:** catalog-browse-and-zagroda-page
- **PRD refs:** FR-001, FR-002, FR-003, US-02, NFR (lista katalogu < 2 s p95; mobile)
- **Prerequisites:** F-01, S-01
- **Parallel with:** F-02, S-06
- **Blockers:** —
- **Unknowns:**
  - Filtr dostępności (FR-002) czyta sumę zaakceptowanych miejsc na dany dzień — czy to ten sam odczyt co reguła F-01? — Owner: dev. Block: no.
- **Risk:** Konsumuje opublikowane zagrody z S-01, więc po nim w kolejności; sam katalog jest niskiego ryzyka domenowego (publiczny listing), ale filtr dostępności dotyka danych rezerwacji z F-01.
- **Status:** done

### S-03: Nauczyciel wysyła zapytanie o rezerwację

- **Outcome:** nauczyciel wysyła z karty zagrody zapytanie (data, turnus, liczba uczestników, imię, e-mail, telefon), dostaje mail potwierdzający z tokenizowanym linkiem anulowania i może anulować przed akceptacją; właściciel dostaje mail „nowe zapytanie".
- **Change ID:** guest-booking-request
- **PRD refs:** FR-004, FR-011, FR-015, US-02, NFR (zapytanie na liście oczekujących ≤ 2 s; e-mail < 5 min)
- **Prerequisites:** F-01, F-02, S-02
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Formularz żyje na stronie zagrody (S-02), a maile zależą od F-02; walidacja (data w przyszłości, telefon PL, e-mail) i token anulowania to standard. Bez tej ścieżki anulowanie wraca na telefon — główny pain point produktu.
- **Status:** done

### S-04: Akceptacja z blokadą overbookingu (gwiazda przewodnia)

- **Outcome:** właściciel widzi listę zapytań (oczekujące/zaakceptowane/odrzucone/anulowane) i szczegóły (data, liczba uczestników, kontakt nauczyciela widoczny tylko dla niego), po czym akceptuje lub odrzuca — akceptacja jest blokowana, gdy suma uczestników na dzień przekroczyłaby limit, z komunikatem „X z Y zajęte, Z wymaga miejsca"; gość dostaje mail akceptacji.
- **Change ID:** gated-acceptance-with-overbooking-guard
- **PRD refs:** FR-005, FR-012, FR-013, FR-014, US-01, NFR (potwierdzenie < 15 s mobile; „dokładnie jeden sukces" pod współbieżnością; prywatność kontaktu)
- **Prerequisites:** F-01, F-02, S-01, S-03
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** To gwiazda przewodnia i nośnik kryterium sukcesu #1. Cała poprawność współbieżności pochodzi z prymitywy F-01 — ten slice musi udowodnić, że atomowa blokada trzyma pod realnym ruchem mobilnym na workerd (test dwóch równoległych akceptacji). Sekwencjonowany tak wcześnie, jak pozwalają prerekwizyty (potrzebuje danych z S-01 i zapytań z S-03).
- **Status:** proposed

### S-05: Cofnięcie akceptacji przez właściciela

- **Outcome:** właściciel cofa wcześniejszą akceptację (np. nauczyciel odwołał telefonicznie), co natychmiast zwalnia miejsca dla kolejnych akceptacji i wysyła nauczycielowi mail o cofnięciu.
- **Change ID:** owner-undo-acceptance
- **PRD refs:** FR-016, NFR (e-mail < 5 min; miejsca natychmiast dostępne po cofnięciu)
- **Prerequisites:** F-02, S-04
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Domyka workflow stanów (stan „cofnięte przez właściciela" zwalnia miejsca). Bez maila do nauczyciela powstaje niespójność informacji — stąd zależność od F-02. Mniejszy zakres niż gwiazda, ale wymaga, by akceptacja (S-04) już istniała.
- **Status:** proposed

### S-06: Pełne logowanie właściciela — OAuth + reset hasła

- **Outcome:** właściciel rejestruje się i loguje przez Google OAuth lub Facebook OAuth (e-mail z `email_verified=true` pomija bramkę weryfikacji FR-006) oraz może zresetować hasło ścieżki e-mail+hasło przez e-mail.
- **Change ID:** owner-oauth-and-password-reset
- **PRD refs:** FR-007 (ścieżka OAuth), FR-008, FR-017, NFR (mobile)
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-05
- **Blockers:**
  - Konfiguracja aplikacji OAuth u dostawców (Google + Facebook) — credentiale ustawia człowiek w panelach dostawców i Supabase. (external pending)
- **Unknowns:** —
- **Risk:** To zakres świadomie przyjęty ponad pierwotny 3-tyg. budżet (`Timeline acknowledgment`); przy `top_blocker: time` sekwencjonowany **po** gwieździe, bo rdzenna pętla działa na samym e-mail+haśle. Nie blokuje S-04 — może iść równolegle, gdy starczy rąk.
- **Status:** done

### S-07: Bezpieczny merge kont OAuth↔e-mail

- **Outcome:** gdy logowanie OAuth trafia na e-mail istniejącego konta e-mail+hasło, system łączy je w jedno konto **wyłącznie** gdy dostawca zwraca `email_verified=true`; bez verified login OAuth zostaje zablokowany z komunikatem.
- **Change ID:** oauth-account-merge-guard
- **PRD refs:** FR-018, NFR (anty-takeover: nigdy merge po samym dopasowaniu e-maila)
- **Prerequisites:** S-06
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** — (UX merge'u przy `email_verified=false` rozstrzygnięty 2026-06-11: opcja (a) — patrz Open Roadmap Questions #1)
- **Risk:** Klasyczny wektor account-takeover — bramka `email_verified=true` jest twarda. UX edge case'u (verified=false) rozstrzygnięty: opcja (a) — odrzucenie loginu OAuth z komunikatem; S-06 zaimplementował już to zachowanie jako bezpieczny default (`shouldBlockOAuth` + blok w callbacku), więc zakres S-07 kurczy się do weryfikacji live ścieżki `email_verified=false` u prawdziwego dostawcy i ewentualnego dopracowania komunikatu/testów.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                               | Suggested issue title                                                  | Issue                                                    | Ready for `/10x-plan` | Notes                                                     |
| ---------- | --------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | --------------------- | --------------------------------------------------------- |
| F-01       | booking-schema-and-overbooking-guard    | Schemat domeny + atomowa reguła anty-overbooking + test współbieżności | [#1](https://github.com/webpush-it/zagroda-hub/issues/1) | yes                   | Najwyższy fan-out; redukuje główne ryzyko (Risk #2)       |
| F-02       | transactional-email-channel             | Kanał e-maili transakcyjnych na Workers (<5 min)                       | [#2](https://github.com/webpush-it/zagroda-hub/issues/2) | yes                   | Można równolegle z F-01; rozstrzygnij mechanizm (Risk #8) |
| S-01       | owner-publishes-zagroda                 | Właściciel publikuje profil zagrody (z bramką weryfikacji e-mail)      | [#3](https://github.com/webpush-it/zagroda-hub/issues/3) | no                    | Czeka na F-01                                             |
| S-02       | catalog-browse-and-zagroda-page         | Katalog publiczny + filtry + strona zagrody                            | [#4](https://github.com/webpush-it/zagroda-hub/issues/4) | no                    | Czeka na F-01, S-01                                       |
| S-03       | guest-booking-request                   | Formularz zapytania + mail potwierdzenia + link anulowania             | [#5](https://github.com/webpush-it/zagroda-hub/issues/5) | no                    | Czeka na F-01, F-02, S-02                                 |
| S-04       | gated-acceptance-with-overbooking-guard | Panel akceptacji z blokadą overbookingu (gwiazda)                      | [#6](https://github.com/webpush-it/zagroda-hub/issues/6) | no                    | Czeka na F-01, F-02, S-01, S-03                           |
| S-05       | owner-undo-acceptance                   | Cofnięcie akceptacji + mail do nauczyciela                             | [#7](https://github.com/webpush-it/zagroda-hub/issues/7) | no                    | Czeka na F-02, S-04                                       |
| S-06       | owner-oauth-and-password-reset          | OAuth Google/Facebook + reset hasła                                    | [#8](https://github.com/webpush-it/zagroda-hub/issues/8) | no                    | Czeka na S-01; external: credentiale OAuth                |
| S-07       | oauth-account-merge-guard               | Bezpieczny auto-merge kont OAuth↔e-mail                                | [#9](https://github.com/webpush-it/zagroda-hub/issues/9) | yes                   | Pytanie #1 rozstrzygnięte (opcja a); S-06 done            |

## Open Roadmap Questions

1. ~~**UX merge'u OAuth gdy `email_verified=false`** (FR-018) — gdy logowanie OAuth zwraca e-mail nie-zweryfikowany przez dostawcę, a istnieje już konto e-mail+hasło z tym samym adresem: (a) odrzucić login OAuth z komunikatem „potwierdź e-mail u dostawcy", (b) utworzyć osobne konto OAuth (split-brain), (c) wysłać link weryfikacyjny do właściciela istniejącego konta z prośbą o ręczne potwierdzenie merge'u? Owner: user. Block: `S-07` (FR-017/S-06 może ruszyć równolegle).~~ **Rozstrzygnięte 2026-06-11 (user): opcja (a)** — login OAuth odrzucony, konto e-mail+hasło nietknięte, logowanie hasłem (i reset) działa; blokada ustępuje sama, gdy dostawca zacznie raportować `email_verified=true` (wtedy standardowy auto-merge). S-06 zaimplementował to zachowanie jako default; S-07 odblokowany.

## Parked

- **Mapy / geolokalizacja GPS** — Why parked: PRD §Non-Goals; filtr lokalizacji to wybór województwa+miasta, mapy podnoszą koszt bez zmiany core flow.
- **Płatności online + fakturowanie** — Why parked: PRD §Non-Goals; rozliczenia gotówka/przelew po wizycie, osobny moduł.
- **System ocen / opinii / recenzji** — Why parked: PRD §Non-Goals; wymaga moderacji + obsługi sporów.
- **SMS / push / advanced digesty** — Why parked: PRD §Non-Goals; tylko e-mail transakcyjny w MVP.
- **Multi-zagroda na konto właściciela** — Why parked: PRD §Non-Goals; w MVP jedno konto = jedna zagroda, multi w v2.
- **Konto gościa z panelem śledzenia** — Why parked: PRD §Non-Goals; komunikacja przez e-mail + token, konto gościa w v2.
- **Moderacja admin draftów zagród** — Why parked: PRD §Non-Goals; anty-spam przez weryfikację e-mail + ręczne kasowanie 1x/tydzień, moderacja w v2 (>~50 zagród).
- **Negocjacja liczby uczestników poza limit** — Why parked: PRD §Non-Goals; system odrzuca twardo, negocjacja telefonicznie poza systemem.

## Done

(Pusta przy pierwszej generacji. `/10x-archive` dopisuje wpis tutaj — i przełącza `Status` elementu na `done` — gdy zmiana o pasującym `Change ID` zostaje zarchiwizowana. NIE wypełniać ręcznie.)

- **F-01: (foundation) minimalny schemat domeny (zagroda z dziennym limitem + turnusy, zapytanie z datą / liczbą uczestników / stanem workflow, powiązanie właściciel↔zagroda, polityka RLS chroniąca kontakt nauczyciela) oraz atomowa operacja akceptacji z blokadą wierszową na poziomie bazy, plus test współbieżności dowodzący „dokładnie jeden sukces".** — Archived 2026-06-05 → `context/archive/2026-06-05-booking-schema-and-overbooking-guard/`. Lesson: —.
- **S-01: właściciel z zweryfikowanym e-mailem tworzy i edytuje profil zagrody (nazwa, opis, lokalizacja, zdjęcie, dzienny limit, turnusy z zakresem HH:MM-HH:MM), który natychmiast pojawia się w katalogu publicznym.** — Archived 2026-06-06 → `context/archive/2026-06-05-owner-publishes-zagroda/`. Lesson: —.
- **S-02: nauczyciel przegląda publiczny katalog, filtruje po województwie i mieście (AND) oraz opcjonalnie po dacie i liczbie uczestników (zagrody bez wolnych miejsc znikają/oznaczone), i otwiera stronę pojedynczej zagrody.** — Archived 2026-06-07 → `context/archive/2026-06-07-catalog-browse-and-zagroda-page/`. Lesson: —.
- **F-02: (foundation) wybrany i wpięty mechanizm wysyłki maili transakcyjnych aplikacji na Cloudflare Workers, z jedną zweryfikowaną ścieżką dostarczenia poniżej 5 minut.** — Archived 2026-06-08 → `context/archive/2026-06-07-transactional-email-channel/`. Lesson: na Windows ustawiaj sekrety wranglera ze źródła bez końcowego newline (`printf '%s'`).
- **S-03: nauczyciel wysyła zapytanie, dostaje mail z linkiem anulowania, może anulować** — Archived 2026-06-09 → `context/archive/2026-06-08-guest-booking-request/`. Lesson: —.
- **S-06: właściciel rejestruje się i loguje przez Google OAuth lub Facebook OAuth (e-mail z `email_verified=true` pomija bramkę weryfikacji FR-006) oraz może zresetować hasło ścieżki e-mail+hasło przez e-mail.** — Archived 2026-06-09 → `context/archive/2026-06-08-owner-oauth-and-password-reset/`. Lesson: —.
