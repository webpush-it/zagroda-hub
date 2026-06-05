# Booking Schema & Overbooking Guard (F-01) Implementation Plan

## Overview

Fundament F-01 z roadmapy: minimalny schemat domeny (zagroda z dziennym limitem, turnusy, zapytania o rezerwację z workflow stanów, powiązanie właściciel↔zagroda), polityki RLS chroniące kontakt nauczyciela, atomowa funkcja akceptacji z blokadą wiersza zagrody na poziomie Postgresa oraz test współbieżności dowodzący „dokładnie jeden sukces" — nośnik kryterium sukcesu #1 z PRD i największego ryzyka technicznego (`infrastructure.md` Risk #2).

## Current State Analysis

- **Zero schematu**: `supabase/config.toml` istnieje (Postgres 17, `project_id = "10x-astro-starter"`, migrations enabled z pustym `schema_paths`), ale katalog `supabase/migrations/` nie istnieje. `seed.sql` wskazany w configu — nieobecny. CLI `supabase@2.23.4` w devDependencies.
- **Klient server-only**: `src/lib/supabase.ts` — `createServerClient` z `@supabase/ssr@0.10.3`, env `SUPABASE_URL`/`SUPABASE_KEY` przez `astro:env/server` (oba `optional: true`). Brak typów DB (`database.types.ts` nie istnieje), klient nietypowany.
- **Middleware**: `src/middleware.ts` ustawia `Astro.locals.user` z `supabase.auth.getUser()`; chroni `/dashboard`.
- **Zero testów**: brak runnera (vitest/playwright nieobecne), brak plików testowych, brak configów.
- **CI**: `.github/workflows/ci.yml` — jeden job (Node 22): `npm ci` → `astro sync` → `lint` → `build`. Brak kroku testowego.
- **Runtime**: Astro 6 SSR na Cloudflare Workers (workerd) — per-request model sesji; żadne założenie o trzymaniu locka po stronie aplikacji nie jest bezpieczne. Atomowość musi żyć w 100% w Postgresie (`infrastructure.md` Risk #2).

## Desired End State

Po tej zmianie:

1. `supabase db reset` stawia od zera schemat: `zagrody`, `turnusy`, `booking_requests` + enum stanów + polityki RLS + funkcja `accept_booking_request`.
2. `npm test` (vitest, przeciwko lokalnemu stackowi Supabase) przechodzi: test współbieżności („dokładnie jeden sukces"), przypadki sekwencyjne reguły limitu, testy RLS prywatności kontaktu.
3. CI uruchamia te testy na każdym pushu/PR (lokalny stack przez `supabase/setup-cli`).
4. `src/lib/supabase.ts` jest otypowany generowanymi typami DB; slice'y S-01…S-05 budują na stabilnym kontrakcie.

Weryfikacja całości: `npm test` zielony lokalnie i w CI; test współbieżności wykonuje wiele iteracji wyścigu i nigdy nie dopuszcza dwóch sukcesów.

### Key Discoveries:

- `supabase/config.toml` jest gotowy na migracje — wystarczy utworzyć `supabase/migrations/` (`config.toml:53-58`).
- Wzorzec klienta: `createServerClient` + cookies w `src/lib/supabase.ts:1-24`; typowanie przez generic `<Database>` to jedyna zmiana potrzebna w istniejącym kodzie.
- CI wymaga sekretów `SUPABASE_URL`/`SUPABASE_KEY` tylko do builda (`ci.yml:22-25`) — job testowy używa lokalnego stacka, więc nie dotyka cloudowych sekretów.
- Mechanizm atomowości potwierdzony upstream: Supabase `rpc()` + `SELECT … FOR UPDATE` (`roadmap.md:75`, `infrastructure.md` Risk #2).
- Limit liczony **per dzień**, nie per turnus — suma uczestników wszystkich turnusów dnia ≤ dzienny limit (PRD FR-004 rezolucja Sokratesa).

## What We're NOT Doing

- **Żadnego UI ani endpointów API** — prymitywa eksponowana wyłącznie jako funkcja RPC; endpoint i panel buduje S-04 (decyzja użytkownika).
- **Pól katalogowych zagrody** (opis, lokalizacja, zdjęcie, flaga publikacji) — dołoży S-01.
- **Tokena anulowania i funkcji anulowania przez gościa** — dołoży S-03 (FR-015); enum stanów już zawiera `cancelled_by_guest`.
- **Funkcji cofnięcia akceptacji** — dołoży S-05 (FR-016); enum zawiera `withdrawn_by_owner`, a test zwalniania miejsc symuluje cofnięcie bezpośrednim UPDATE-em (service role).
- **Rate-limitingu anon INSERT** — odpowiedzialność S-03 (formularz publiczny).
- **Mechaniki retencji 12 miesięcy** — NFR historii spełniony przez brak kasowania; żadnych TTL/cronów.
- **Walidacji blokującej obniżenie limitu** — grandfathering (decyzja użytkownika): stan „suma > limit" jest legalny, nowe akceptacje blokowane aż suma spadnie poniżej limitu.
- **Seed danych produkcyjnych** — fixtures tworzą testy; `seed.sql` pozostaje nieobecny.

## Implementation Approach

Dwie migracje SQL (schemat+RLS, potem funkcja akceptacji), generowane typy wpięte w istniejący klient, następnie infrastruktura vitest bijąca w lokalny stack Supabase i job CI. Atomowość: funkcja `SECURITY DEFINER` bierze `SELECT … FOR UPDATE` na wierszu zagrody (serializacja per zagroda — przy niskim QPS z PRD bez kosztu), sumuje zaakceptowanych uczestników na dzień i warunkowo akceptuje. Postura RLS-first: anon może tylko INSERT zapytania w stanie `pending`; SELECT zapytań (z kontaktem nauczyciela) wyłącznie właściciel tej zagrody; zmiany stanu wyłącznie przez funkcje `SECURITY DEFINER`.

Konwencja nazewnicza: rdzeniowe pojęcia domeny zostają po polsku (`zagrody`, `turnusy` — tożsamość produktu, tłumaczenie gubi znaczenie), reszta po angielsku (`booking_requests`, kolumny, enum).

## Critical Implementation Details

- **Pinowanie `search_path` w SECURITY DEFINER** — każda funkcja `SECURITY DEFINER` musi mieć `SET search_path = ''` (i w pełni kwalifikowane nazwy `public.*`, `auth.uid()`); bez tego lint Supabase krzyczy, a funkcja jest podatna na search-path hijacking.
- **Kolejność locków** — funkcja akceptacji lockuje NAJPIERW wiersz zagrody, POTEM wiersz zapytania (`FOR UPDATE`). Stała kolejność eliminuje deadlock; lock na zapytaniu + warunek `status = 'pending'` zapobiega podwójnej akceptacji tego samego zapytania.
- **Uprawnienia funkcji** — `REVOKE EXECUTE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated`. `auth.uid()` wewnątrz `SECURITY DEFINER` czyta JWT z kontekstu requestu, więc check właścicielstwa działa poprawnie.
- **Test wyścigu musi iterować** — pojedynczy przebieg dwóch równoległych `rpc()` może przejść szczęśliwym trafem bez realnej kolizji. Test wykonuje ≥20 iteracji (świeże zapytania per iteracja) i przy każdej asertuje dokładnie jeden sukces.
- **Klucze lokalnego stacka** — testy pobierają URL + anon/service_role key z `supabase status -o json` w `globalSetup` vitest (z fallbackiem na env vars dla CI), zamiast hardkodować.
- **Plik generowanych typów** — `src/db/database.types.ts` jest artefaktem `supabase gen types`; dodać do ignorów ESLint (strictTypeChecked na wygenerowanym kodzie = szum).

## Phase 1: Schemat domeny + RLS + typy

### Overview

Pierwsza migracja: tabele, enum stanów, indeksy, polityki RLS. Generowane typy DB wpięte w istniejący klient. Skrypty npm dla lokalnej pracy z bazą.

### Changes Required:

#### 1. Migracja schematu

**File**: `supabase/migrations/<timestamp>_domain_schema.sql` (nowy katalog `supabase/migrations/`)

**Intent**: Minimalny schemat nośny dla reguły anty-overbooking + prywatności kontaktu — kontrakt, który slice'y S-01…S-05 rozszerzają, ale go nie zmieniają.

**Contract**:

- Enum `public.request_status`: `'pending' | 'accepted' | 'rejected' | 'cancelled_by_guest' | 'withdrawn_by_owner'` (pełny workflow z PRD §Business Logic — stany przyszłych slice'ów już w typie, by uniknąć `ALTER TYPE` później).
- Tabela `public.zagrody`: `id uuid PK default gen_random_uuid()`, `owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE` (MVP: 1 konto = 1 zagroda, PRD §Access Control), `name text NOT NULL`, `daily_limit integer NOT NULL CHECK (daily_limit > 0)`, `created_at timestamptz NOT NULL DEFAULT now()`.
- Tabela `public.turnusy`: `id uuid PK`, `zagroda_id uuid NOT NULL REFERENCES zagrody ON DELETE CASCADE`, `label text NOT NULL`, `start_time time NOT NULL`, `end_time time NOT NULL CHECK (end_time > start_time)` (ustrukturyzowany zakres HH:MM z FR-009), `created_at`. Dodatkowo `UNIQUE (id, zagroda_id)` — cel composite FK niżej.
- Tabela `public.booking_requests`: `id uuid PK`, `zagroda_id uuid NOT NULL`, `turnus_id uuid NOT NULL`, **composite FK** `(turnus_id, zagroda_id) REFERENCES turnusy (id, zagroda_id)` (niezmiennik: turnus należy do tej samej zagrody co zapytanie), `trip_date date NOT NULL` (DATE — zero logiki stref czasowych), `participants_count integer NOT NULL CHECK (participants_count > 0)`, `status request_status NOT NULL DEFAULT 'pending'`, `guest_name text NOT NULL`, `guest_email text NOT NULL`, `guest_phone text NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- Indeks częściowy `ON booking_requests (zagroda_id, trip_date) WHERE status = 'accepted'` — ścieżka odczytu SUM w funkcji akceptacji i w przyszłym filtrze dostępności (S-02).
- RLS włączone na wszystkich trzech tabelach. Polityki:
  - `zagrody`: SELECT dla `anon, authenticated` (katalog publiczny — FR-001); INSERT/UPDATE/DELETE tylko `authenticated` z `auth.uid() = owner_id`.
  - `turnusy`: SELECT dla `anon, authenticated`; zapisy tylko właściciel zagrody nadrzędnej.
  - `booking_requests`: INSERT dla `anon, authenticated` z `WITH CHECK (status = 'pending')` (gość składa wyłącznie oczekujące); SELECT wyłącznie `authenticated` z warunkiem właścicielstwa zagrody (kontakt nauczyciela niewidoczny dla anon i cudzych właścicieli — NFR prywatności); **brak** polityk UPDATE/DELETE (zmiany stanu wyłącznie przez funkcje `SECURITY DEFINER`).

#### 2. Generowane typy DB

**File**: `src/db/database.types.ts` (nowy, generowany)

**Intent**: Typowany kontrakt schematu dla klienta i testów; regenerowany po każdej migracji.

**Contract**: Wyjście `npx supabase gen types typescript --local`. Plik wyłączony z lintowania (wpis w `eslint.config.js` ignores).

#### 3. Typowanie istniejącego klienta

**File**: `src/lib/supabase.ts`

**Intent**: Wpięcie generica `Database` w `createServerClient`, by całe API (`from`, przyszłe `rpc`) było typowane.

**Contract**: `createServerClient<Database>(…)` — sygnatura funkcji `createClient` bez zmian dla wywołujących.

#### 4. Skrypty npm

**File**: `package.json`

**Intent**: Powtarzalne komendy lokalnej pracy z bazą.

**Contract**: `"db:start": "supabase start"`, `"db:reset": "supabase db reset"`, `"db:types": "supabase gen types typescript --local > src/db/database.types.ts"`.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `npx supabase db reset`
- Typy generują się i kompilują: `npm run db:types && npx astro check` (lub `astro sync` + tsc przez build)
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Przegląd schematu w Supabase Studio (http://127.0.0.1:54323): trzy tabele, enum, RLS włączone, polityki widoczne

**Implementation Note**: Po ukończeniu fazy i zielonej weryfikacji automatycznej — pauza na ręczne potwierdzenie przed Fazą 2.

---

## Phase 2: Atomowa prymitywa akceptacji

### Overview

Druga migracja: funkcja `accept_booking_request` — jedyne miejsce wykonania reguły domenowej, z lockiem wiersza zagrody.

### Changes Required:

#### 1. Migracja funkcji akceptacji

**File**: `supabase/migrations/<timestamp>_accept_booking_request.sql`

**Intent**: Atomowa akceptacja zapytania: serializacja per zagroda przez lock wierszowy, suma zaakceptowanych uczestników per dzień, warunkowe przejście `pending → accepted`. Grandfathering: funkcja nie zakłada niezmiennika „suma ≤ limit" na wejściu — sprawdza wyłącznie, czy NOWA akceptacja zmieściłaby się w limicie.

**Contract**: `public.accept_booking_request(request_id uuid)` — `SECURITY DEFINER`, `SET search_path = ''`, `EXECUTE` tylko dla `authenticated`. Zwraca jeden wiersz: `(accepted boolean, occupied integer, daily_limit integer, requested integer)` — `occupied` to suma zaakceptowanych miejsc na dzień PRZED tą akceptacją, co pozwala klientom zbudować komunikat „X z Y zajęte, Z wymaga miejsca" (FR-014) bez drugiego zapytania. Błędy twarde (zapytanie nie istnieje, wołający nie jest właścicielem zagrody, status ≠ `pending`) → `RAISE EXCEPTION` z czytelnym `ERRCODE`/komunikatem; wynik domenowy (zaakceptowane vs zablokowane limitem) → wiersz wynikowy, status zapytania pozostaje `pending` przy blokadzie.

Rdzeń funkcji (kolejność locków jest kontraktem — patrz Critical Implementation Details):

```sql
-- 1. lock zagrody (serializacja wszystkich akceptacji tej zagrody)
SELECT z.daily_limit INTO v_limit FROM public.zagrody z
  WHERE z.id = v_zagroda_id AND z.owner_id = (SELECT auth.uid())
  FOR UPDATE;
-- 2. lock zapytania + walidacja stanu
SELECT … FROM public.booking_requests WHERE id = request_id AND status = 'pending' FOR UPDATE;
-- 3. suma na dzień (wszystkie turnusy łącznie — limit per dzień, nie per turnus)
SELECT COALESCE(SUM(participants_count), 0) INTO v_occupied
  FROM public.booking_requests
  WHERE zagroda_id = v_zagroda_id AND trip_date = v_trip_date AND status = 'accepted';
-- 4. warunkowy UPDATE status='accepted', updated_at=now()
```

#### 2. Regeneracja typów

**File**: `src/db/database.types.ts`

**Intent**: Funkcja RPC pojawia się w typach (`Database['public']['Functions']`) — typowane `supabase.rpc('accept_booking_request', …)` dla S-04.

**Contract**: `npm run db:types` po migracji.

### Success Criteria:

#### Automated Verification:

- Migracje aplikują się czysto od zera: `npx supabase db reset`
- Anon nie ma uprawnień do funkcji: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "select has_function_privilege('anon','public.accept_booking_request(uuid)','execute')"` → `f` (standardowe creds lokalnego stacka, port z `config.toml`)
- Typy zawierają funkcję: `npm run db:types` + `npm run lint` + `npm run build`

#### Manual Verification:

- Smoke w Supabase Studio SQL editor: ręczne wywołanie funkcji na fixture (akceptacja w limicie, blokada ponad limit) zwraca oczekiwane wiersze

**Implementation Note**: Po ukończeniu fazy i zielonej weryfikacji automatycznej — pauza na ręczne potwierdzenie przed Fazą 3.

---

## Phase 3: Infrastruktura testowa + testy reguły

### Overview

Vitest od zera, helpery łączące się z lokalnym stackiem, pełna macierz testów reguły domenowej + testy RLS + test współbieżności.

### Changes Required:

#### 1. Instalacja i konfiguracja vitest

**File**: `package.json`, `vitest.config.ts`

**Intent**: Runner testów DB; testy integracyjne biją w lokalny Supabase, więc bez jsdom — środowisko node.

**Contract**: devDependency `vitest`; skrypt `"test": "vitest run"`; config z `globalSetup` (pobranie kluczy stacka) i wyłączoną równoległością plików (`fileParallelism: false`) — testy współdzielą bazę.

#### 2. Helpery testowe

**File**: `tests/helpers/supabase.ts`, `tests/helpers/global-setup.ts`

**Intent**: Jedno miejsce tworzenia klientów (admin/service_role, authed-owner, anon) i fixtures (właściciel + zagroda + turnusy + zapytania). GlobalSetup czyta `supabase status -o json` (fallback: env vars `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` dla CI) i wystawia wartości testom.

**Contract**: `createAdminClient()`, `createAnonClient()`, `createOwnerClient(email, password)` (admin `auth.admin.createUser` + `signInWithPassword`), `seedZagroda(admin, {dailyLimit, …})` zwracające id-ki. Klienty typowane `Database`.

#### 3. Testy reguły domenowej (sekwencyjne)

**File**: `tests/db/acceptance-rule.test.ts`

**Intent**: Macierz reguły limitu poza wyścigiem.

**Contract**: przypadki — (a) akceptacja mieszcząca się w limicie przechodzi; (b) dokładne dopełnienie limitu (suma == limit) przechodzi; (c) przekroczenie blokuje, wiersz wynikowy niesie poprawne `(occupied, daily_limit, requested)`, status zostaje `pending`; (d) zwolnienie miejsc: po przejściu akceptacji w `withdrawn_by_owner` / `cancelled_by_guest` (UPDATE adminem — funkcje cofania to S-05/S-03) kolejna akceptacja przechodzi; (e) suma liczona per dzień łącznie dla różnych turnusów tego samego dnia; (f) różne dni są niezależne; (g) grandfathering: gdy suma już przekracza obniżony limit, każda nowa akceptacja jest blokowana; (h) błędy twarde: nie-właściciel → exception, status ≠ pending → exception, nieistniejące id → exception.

#### 4. Test współbieżności

**File**: `tests/db/concurrency.test.ts`

**Intent**: Dowód „dokładnie jeden sukces" — kryterium sukcesu #1 z PRD (US-01).

**Contract**: per iteracja (≥20): świeża zagroda (limit 30) + dwa zapytania `pending` (20 i 15 osób) na ten sam dzień; dwa równoległe `rpc('accept_booking_request', …)` przez `Promise.all` z dwóch niezależnych klientów właściciela; asercja: dokładnie jedno `accepted = true`, drugie `accepted = false` z poprawnym `occupied`; stan końcowy w bazie: dokładnie jedno zapytanie `accepted`.

#### 5. Testy RLS

**File**: `tests/db/rls.test.ts`

**Intent**: Dowód prywatności kontaktu nauczyciela i postury RLS-first.

**Contract**: przypadki — (a) anon może INSERT zapytanie `pending`; (b) anon NIE może INSERT ze statusem ≠ `pending`; (c) anon nie widzi żadnych `booking_requests` (SELECT zwraca 0 wierszy); (d) właściciel widzi zapytania swojej zagrody z kontaktem; (e) inny właściciel nie widzi cudzych zapytań; (f) anon nie może wykonać `accept_booking_request` (brak uprawnień); (g) anon/cudzy właściciel nie może UPDATE zapytania. Uwaga: anon wstawia gołym `.insert()` bez `.select()` — brak polityki SELECT dla anon sprawia, że `return=representation` padnie nawet przy udanym insercie; chainowanie `.select()` w teście (a) dałoby fałszywy fail polityki.

#### 6. ESLint dla testów

**File**: `eslint.config.js`

**Intent**: Testy pod lintem; generowany `src/db/database.types.ts` w ignores (z Fazy 1 — potwierdzić spójność).

**Contract**: pliki `tests/**` objęte konfiguracją TS.

### Success Criteria:

#### Automated Verification:

- Wszystkie testy przechodzą: `npm test` (przy działającym `supabase start`)
- Test współbieżności stabilny: `npm test -- --retry=0` kilkukrotnie pod rząd bez flake'a
- Lint przechodzi: `npm run lint`
- Build nietknięty: `npm run build`

#### Manual Verification:

- Przegląd outputu testu współbieżności: iteracje faktycznie kolidują (przynajmniej część iteracji kończy się blokadą drugiego wywołania)

**Implementation Note**: Po ukończeniu fazy i zielonej weryfikacji automatycznej — pauza na ręczne potwierdzenie przed Fazą 4.

---

## Phase 4: Job CI

### Overview

Nowy job testowy w istniejącym workflow — lokalny stack Supabase w GitHub Actions.

### Changes Required:

#### 1. Workflow CI

**File**: `.github/workflows/ci.yml`

**Intent**: Test reguły domenowej jako bramka na każdy push/PR do `master` — ochrona regresyjna od pierwszego dnia.

**Contract**: nowy job `test` (równolegle z istniejącym `ci`): checkout → setup-node (22, cache npm) → `npm ci` → `npx supabase start -x studio,realtime,storage-api,imgproxy,edge-runtime,mailpit` → `npm test`. CLI wyłącznie z devDependencies (`npx` — bez `supabase/setup-cli`): jedna pinowana wersja lokalnie i w CI. Ubuntu-latest ma Dockera; migracje aplikują się przy starcie świeżego stacka; flaga `-x` wycina serwisy niepotrzebne testom (db + auth + PostgREST wystarczą). Żadnego eksportu kluczy do env — globalSetup vitest sam pobiera je przez `supabase status -o json`, identycznie lokalnie i w CI. Job nie wymaga cloudowych sekretów `SUPABASE_URL`/`SUPABASE_KEY`.

### Success Criteria:

#### Automated Verification:

- Workflow przechodzi na gałęzi: push + zielony status obu jobów (`ci` + `test`)
- Lint lokalnie: `npm run lint`

#### Manual Verification:

- Przegląd czasu joba `test` w Actions (akceptowalny narzut, oczekiwane ~3–5 min)
- Potwierdzenie, że job faktycznie failuje przy złamaniu reguły (np. chwilowe zepsucie asercji na gałęzi roboczej — opcjonalny sanity check)

---

## Testing Strategy

### Unit Tests:

- Brak czystych unitów — reguła żyje w SQL; testowanie jej w izolacji od Postgresa nie dowodzi niczego.

### Integration Tests:

- `tests/db/acceptance-rule.test.ts` — macierz reguły limitu (8 przypadków, patrz Faza 3).
- `tests/db/concurrency.test.ts` — wyścig ≥20 iteracji, „dokładnie jeden sukces".
- `tests/db/rls.test.ts` — prywatność kontaktu + postura RLS (7 przypadków).

### Manual Testing Steps:

1. `npm run db:reset` — czysta aplikacja obu migracji.
2. Supabase Studio: wizualna inspekcja tabel, RLS, polityk.
3. SQL editor: ręczna akceptacja na fixture w limicie i ponad limit.
4. Kilkukrotne `npm test` pod rząd — stabilność testu wyścigu.

## Performance Considerations

Lock wiersza zagrody serializuje wszystkie akceptacje danej zagrody (nie tylko tego samego dnia) — świadomy trade-off przy `target_scale.qps: low` z PRD; akceptacja to operacja rzadka (właściciel-człowiek w panelu). Indeks częściowy na `(zagroda_id, trip_date) WHERE status='accepted'` trzyma SUM na ścieżce indeksowej również dla przyszłego filtra dostępności (S-02, FR-002).

## Migration Notes

Baza produkcyjna jest pusta (zero tabel domenowych) — obie migracje są czysto addytywne, bez backfillu i bez okna rollbacku. Zgodnie z `infrastructure.md` (sekcja Rollback): migracje addytywne i kompatybilne wstecz. Deploy migracji na cloud (`supabase db push` lub link projektu) wykonuje człowiek — poza zakresem tej zmiany (żaden slice jeszcze nie czyta schematu na produkcji).

## References

- Roadmapa F-01: `context/foundation/roadmap.md:65-77`
- PRD — reguła domenowa: `context/foundation/prd.md:147-161` (Business Logic), FR-014 `prd.md:131`, US-01 `prd.md:50-64`
- Ryzyko współbieżności workerd: `context/foundation/infrastructure.md:96` (Risk #2)
- Istniejący klient: `src/lib/supabase.ts:1-24`; middleware: `src/middleware.ts:1-25`
- CI: `.github/workflows/ci.yml:1-25`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schemat domeny + RLS + typy

#### Automated

- [x] 1.1 Migracja aplikuje się czysto: `npx supabase db reset`
- [x] 1.2 Typy generują się i kompilują: `npm run db:types` + `npx astro check`
- [x] 1.3 Lint przechodzi: `npm run lint`
- [x] 1.4 Build przechodzi: `npm run build`

#### Manual

- [x] 1.5 Przegląd schematu w Supabase Studio (tabele, enum, RLS, polityki)

### Phase 2: Atomowa prymitywa akceptacji

#### Automated

- [ ] 2.1 Migracje aplikują się czysto od zera: `npx supabase db reset`
- [ ] 2.2 Anon bez uprawnień do funkcji: psql `has_function_privilege` → `f`
- [ ] 2.3 Typy zawierają funkcję; lint + build zielone

#### Manual

- [ ] 2.4 Smoke w SQL editor: akceptacja w limicie + blokada ponad limit

### Phase 3: Infrastruktura testowa + testy reguły

#### Automated

- [ ] 3.1 Wszystkie testy przechodzą: `npm test`
- [ ] 3.2 Test współbieżności stabilny w kilku przebiegach pod rząd
- [ ] 3.3 Lint przechodzi: `npm run lint`
- [ ] 3.4 Build nietknięty: `npm run build`

#### Manual

- [ ] 3.5 Przegląd outputu testu współbieżności (iteracje faktycznie kolidują)

### Phase 4: Job CI

#### Automated

- [ ] 4.1 Push gałęzi: oba joby (`ci` + `test`) zielone
- [ ] 4.2 Lint lokalnie: `npm run lint`

#### Manual

- [ ] 4.3 Przegląd czasu joba `test` w Actions
- [ ] 4.4 (Opcjonalnie) sanity check: job failuje przy zepsutej asercji
