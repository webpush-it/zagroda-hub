# Booking Schema & Overbooking Guard (F-01) — Plan Brief

> Full plan: `context/changes/booking-schema-and-overbooking-guard/plan.md`

## What & Why

Fundament F-01 z roadmapy: minimalny schemat domeny (zagroda, turnusy, zapytania o rezerwację), atomowa funkcja akceptacji z blokadą na poziomie Postgresa oraz test współbieżności dowodzący „dokładnie jeden sukces". To nośnik kryterium sukcesu #1 z PRD („100% poprawnie blokuje overbooking") i największego ryzyka technicznego — per-request model sesji na Cloudflare Workers unieważnia każde założenie o trzymaniu locka po stronie aplikacji, więc atomowość musi żyć w 100% w bazie.

## Starting Point

Projekt ma działający starter (Astro 6 SSR + Supabase auth + Workers na produkcji), ale **zero schematu domeny** — katalog `supabase/migrations/` nie istnieje — oraz **zero infrastruktury testowej** (brak runnera, CI robi tylko lint + build). `supabase/config.toml` i CLI w devDeps są gotowe na migracje.

## Desired End State

`supabase db reset` stawia od zera trzy tabele z RLS i funkcję `accept_booking_request`; `npm test` (vitest na lokalnym stacku Supabase) dowodzi reguły limitu, prywatności kontaktu nauczyciela i własności „dokładnie jeden sukces" pod wyścigiem; CI uruchamia te testy na każdym pushu. Slice'y S-01…S-05 budują na stabilnym, otypowanym kontrakcie schematu.

## Key Decisions Made

| Decision                      | Choice                                                                                               | Why (1 sentence)                                                                               | Source         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------- |
| Mechanizm atomowości          | `SELECT … FOR UPDATE` na wierszu zagrody w funkcji SQL                                               | Trywialnie poprawna serializacja per zagroda; przy niskim QPS koszt zerowy                     | Roadmap / Plan |
| Zakres schematu               | Tylko kolumny nośne (bez pól katalogowych, bez tokena anulowania)                                    | S-01/S-03 dołożą swoje kolumny; F-01 niesie tylko regułę i prywatność                          | Plan           |
| Ekspozycja prymitywy          | Wyłącznie RPC (bez endpointu API)                                                                    | Atomowość żyje w bazie, więc test `rpc()` dowodzi własności; endpoint buduje S-04              | Plan           |
| Środowisko testowe            | Lokalny Supabase (Docker), w CI przez `npx supabase` z devDeps (bez setup-cli)                       | Hermetyczne, powtarzalne, jedna pinowana wersja CLI, zero cloudowych sekretów w jobie testowym | Plan           |
| Postura RLS                   | RLS-first: anon INSERT `pending`, SELECT tylko właściciel, zmiany stanu tylko przez SECURITY DEFINER | Kontakt nauczyciela chroniony na poziomie bazy niezależnie od błędów w API                     | Plan           |
| Zakres testów                 | Wyścig (≥20 iteracji) + pełna macierz sekwencyjna + testy RLS                                        | Kryterium sukcesu #1 to nie tylko race condition — także poprawność SUM i zwalnianie miejsc    | Plan           |
| CI                            | Job testowy od razu w F-01                                                                           | Każdy późniejszy slice dotykający schematu przechodzi przez test reguły                        | Plan           |
| Obniżenie limitu poniżej sumy | Grandfathering — dozwolone; nowe akceptacje blokowane aż suma spadnie                                | Reguła zostaje jednym warunkiem w jednym miejscu; UI w S-04 musi stan pokazać                  | Plan           |

## Scope

**In scope:** migracje (schemat + RLS + funkcja akceptacji), generowane typy DB wpięte w `src/lib/supabase.ts`, vitest + helpery + 3 pliki testów, job CI, skrypty npm (`db:start`, `db:reset`, `db:types`, `test`).

**Out of scope:** UI i endpointy API (S-04), pola katalogowe zagrody (S-01), token i funkcja anulowania (S-03), funkcja cofnięcia akceptacji (S-05), rate-limiting anon INSERT (S-03), retencja 12 mc (spełniona przez brak kasowania), deploy migracji na cloud.

## Architecture / Approach

Dwie addytywne migracje SQL: (1) `zagrody` (owner_id UNIQUE, daily_limit) + `turnusy` (composite FK gwarantuje spójność zagroda↔turnus) + `booking_requests` (enum 5 stanów workflow, kontakt gościa, indeks częściowy na zaakceptowanych per dzień) z politykami RLS; (2) `accept_booking_request(request_id)` — SECURITY DEFINER, lock zagrody → lock zapytania → SUM per dzień → warunkowy UPDATE; zwraca `(accepted, occupied, daily_limit, requested)` dla komunikatu „X z Y zajęte, Z wymaga miejsca". Testy biją w lokalny stack przez typowane klienty (anon / owner / service_role).

## Phases at a Glance

| Phase                   | What it delivers                                          | Key risk                                                    |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Schemat + RLS + typy | Migracja tabel/enum/polityk, generowane typy, skrypty npm | Źle zaprojektowany kontrakt = churn we wszystkich slice'ach |
| 2. Prymitywa akceptacji | Funkcja SQL z lockiem i wynikiem strukturalnym            | Search-path / uprawnienia / kolejność locków                |
| 3. Testy                | Vitest + wyścig + macierz reguły + RLS                    | Flaky test współbieżności; klucze lokalnego stacka          |
| 4. Job CI               | Stack Supabase w Actions + `npm test` na każdym PR        | Czas joba (~3–5 min), Docker w runnerze                     |

**Prerequisites:** Docker lokalnie (~7 GB RAM dla `supabase start`); brak zależności od innych zmian (F-01 nie ma prerekwizytów).
**Estimated effort:** ~2–3 sesje po godzinach; fazy 1–2 to głównie SQL, faza 3 jest największa.

## Open Risks & Assumptions

- Zakładamy, że `supabase start` w GitHub Actions (ubuntu-latest) działa bez konfiguracji Dockera — standardowy pattern, ale pierwszy run może wymagać korekty.
- Stan „suma > limit" jest legalny (grandfathering) — S-04 musi go czytelnie pokazać w UI; zapisane w planie jako kontrakt.
- Test wyścigu z `Promise.all` na dwóch klientach uznajemy za wystarczający dowód współbieżności; realny ruch z Workers zweryfikuje S-04.

## Success Criteria (Summary)

- Dwa równoległe wywołania akceptacji konfliktujących zapytań → dokładnie jedno `accepted = true`, w ≥20 iteracjach, lokalnie i w CI.
- Macierz reguły (dopełnienie, przekroczenie z poprawnymi liczbami, zwalnianie miejsc, suma per dzień) zielona.
- Anon i cudzy właściciel nigdy nie widzą kontaktu nauczyciela (testy RLS zielone).
