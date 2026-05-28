# Plan: Pierwsze wdrożenie zagroda-hub na Cloudflare Workers

## Context

Wdrażamy aplikację Zagroda Hub (Astro 6 SSR + React 19 + Supabase) po raz pierwszy na produkcję, zgodnie z decyzją z `context/foundation/infrastructure.md`: **Cloudflare Workers** (GA, 5/5 agent-friendly criteria, runtime `workerd`). Adapter `@astrojs/cloudflare` v13.6.0 jest już wpięty w `astro.config.mjs:7,16` (commit `15a9344 vercel -> cloudflare`).

**Co już mamy**: adapter, klient Supabase (`src/lib/supabase.ts` czyta `SUPABASE_URL` + `SUPABASE_KEY`), CI build w `.github/workflows/ci.yml`, `@supabase/ssr@0.10.3` (zweryfikowane jako działające na Workers + `nodejs_compat`).

**Czego brakuje** (zdiagnozowane): konto Cloudflare, projekt Supabase, `wrangler.toml`, sekrety w CF, zaktualizowane `.env.example` (brakuje wzmianki że produkcja używa `wrangler secret put`, nie `.env`).

**Zakres wybrany przez użytkownika**: tylko **production deploy, manualny**. Bez preview env, bez CI/CD deploy job, bez custom domain (zostajemy na `*.workers.dev`). Pierwszy deploy to "happy path" — udowadniamy że stack działa end-to-end na CF, dopiero potem dokładamy CI/CD w kolejnym kroku.

**Cel**: zwrócony URL `https://zagroda-hub.<subdomain>.workers.dev` zwraca HTTP 200 na `GET /`, a logi pokazują udane połączenie do Supabase.

---

## Wymagania wstępne (human-only, poza zakresem agenta)

Te kroki musisz wykonać Ty zanim agent ruszy. Każdy z nich jest **gate** — agent nie może ich obejść.

- [ ] **0.1** Załóż konto Cloudflare na <https://dash.cloudflare.com/sign-up> (free tier wystarczy do MVP)
- [ ] **0.2** Załóż projekt Supabase na <https://supabase.com/dashboard> — region **`eu-central-1` (Frankfurt)** lub **`eu-west-1` (Ireland)** dla niskiej latencji z Warszawy. Nazwa: `zagroda-hub` (lub dowolna)
- [ ] **0.3** W Supabase Dashboard → **Settings → API** skopiuj do bezpiecznego miejsca:
  - `Project URL` → trafi do `SUPABASE_URL`
  - `anon public` key → trafi do `SUPABASE_KEY` (uwaga: nazwa w naszym kodzie to `SUPABASE_KEY`, nie `SUPABASE_ANON_KEY` — patrz `src/lib/supabase.ts:3`)
- [ ] **0.4** Daj agentowi sygnał `gotowe` — wtedy ruszamy fazą 1

> **Świadomie odpuszczone**: `SUPABASE_SERVICE_ROLE_KEY` i `OPENROUTER_API_KEY` — kod MVP ich nie używa (schemat `env` w `astro.config.mjs:17-22` deklaruje tylko `SUPABASE_URL` + `SUPABASE_KEY`). Dodamy je gdy pojawią się funkcje, które ich wymagają.
>
> **Świadomie odpuszczone**: migracje SQL — folder `supabase/` zawiera tylko `config.toml` i `.gitignore`, brak migracji. Aplikacja przy pierwszym deployu może odpalić na pustej DB; tabele dodamy w kolejnych iteracjach.

---

## Fazy wdrożenia

### ☐ Faza 1 — Inicjalizacja wranglera i logowanie do Cloudflare

**Cel**: `npx wrangler whoami` zwraca prawidłowy account.

- [ ] **1.1** Zweryfikuj że wrangler jest dostępny: `npx wrangler --version` (oczekujemy ≥ 4.x — wrangler jest tranzytywną zależnością `@astrojs/cloudflare`)
- [ ] **1.2** **HUMAN GATE**: `npx wrangler login` — komenda otwiera przeglądarkę, autoryzujesz dostęp. Agent nie może tego zrobić za Ciebie (interaktywne OAuth)
- [ ] **1.3** Weryfikacja: `npx wrangler whoami` zwraca Twoje konto i Account ID

> **Dlaczego nie instalujemy wranglera globalnie**: `npx wrangler` z lokalnej zależności zapewnia że deploy używa tej samej wersji którą wkrótce przypną CI i inni deweloperzy. Zgodne z [Cloudflare best practices](https://developers.cloudflare.com/workers/wrangler/install-and-update/).

---

### ☐ Faza 2 — Stworzenie `wrangler.toml`

**Cel**: konfiguracja Workers wskazuje na zbudowany Astro bundle i ma `nodejs_compat`.

- [ ] **2.1** Utwórz `wrangler.toml` w korzeniu repo (zgodnie z `infrastructure.md:131-144`):

  ```toml
  name = "zagroda-hub"
  main = "./dist/_worker.js/index.js"
  compatibility_date = "2024-09-23"
  compatibility_flags = ["nodejs_compat"]

  [assets]
  directory = "./dist"

  [observability]
  enabled = true
  ```

- [ ] **2.2** Dodaj `.wrangler/` do `.gitignore` (jeśli jeszcze nie ma) — to lokalny cache wranglera, nie powinien trafić do repo
- [ ] **2.3** **NIE** commitujemy jeszcze — najpierw chcemy mieć udany build (Faza 3)

> **Dlaczego `compatibility_date = "2024-09-23"`**: ta data aktywuje `nodejs_compat_v2`, którego wymaga `@supabase/ssr@0.10.3` (zweryfikowane w `infrastructure.md:64,76`). Wcześniejsze daty łamią Supabase na Workers.
>
> **Dlaczego `main = "./dist/_worker.js/index.js"`**: to ścieżka jaką generuje `@astrojs/cloudflare` w trybie SSR (nie Pages). Pages assets path różni się — dla SSR Workers używamy tej ścieżki.

---

### ☐ Faza 3 — Lokalna walidacja buildu

**Cel**: `npm run build` kończy się sukcesem i produkuje `./dist/_worker.js/index.js`.

- [ ] **3.1** Uruchom `npm run build` — oczekujemy że Astro zbuduje SSR bundle pod `workerd`
- [ ] **3.2** Zweryfikuj że istnieje plik `./dist/_worker.js/index.js`
- [ ] **3.3** Zweryfikuj rozmiar bundla: `npx wrangler deploy --dry-run --outdir=dist` — sprawdzamy że jesteśmy poniżej **3 MiB** (limit Free plan, patrz `infrastructure.md` Risk #3). Jeśli powyżej — zatrzymujemy się, raportujemy rozmiar użytkownikowi
- [ ] **3.4** **Nie** uruchamiamy lokalnie `wrangler dev` — Astro 6 dev server odpala `workerd` natywnie (`infrastructure.md:74-76`); jeśli `npm run dev` działa lokalnie z prawdziwym Supabase (lokalny `.env`), to lokalna walidacja jest pokryta

> **Co robimy jeśli build padnie**: pierwsza linia obrony — sprawdzić `astro.config.mjs:7,16` (adapter wpięty?). Druga — `npm ls @astrojs/cloudflare` (zainstalowany?). Trzecia — jakikolwiek dynamic-require w nowym kodzie? Diagnostyka, nie ślepa naprawa.

---

### ☐ Faza 4 — Rejestracja sekretów w Cloudflare

**Cel**: produkcja zna `SUPABASE_URL` i `SUPABASE_KEY`, ale **agent nigdy nie widzi wartości**.

- [ ] **4.1** **HUMAN GATE**: ustaw `SUPABASE_URL` — agent uruchomi `npx wrangler secret put SUPABASE_URL`, ale **Ty wklejasz wartość** w interaktywny prompt
- [ ] **4.2** **HUMAN GATE**: analogicznie `npx wrangler secret put SUPABASE_KEY` — Ty wklejasz `anon public` key z Supabase Dashboard
- [ ] **4.3** Weryfikacja: `npx wrangler secret list` zwraca dwa wpisy: `SUPABASE_URL` i `SUPABASE_KEY` (tylko nazwy, nigdy wartości)

> **Dlaczego nazwa `SUPABASE_KEY` a nie `SUPABASE_ANON_KEY`**: kod produkcyjny w `src/lib/supabase.ts:3` i schemat w `astro.config.mjs:20` używają nazwy `SUPABASE_KEY`. Zmiana nazwy sekretu = zmiana kodu, więc trzymamy się aktualnej nazwy w MVP. `infrastructure.md:158-159` proponuje `SUPABASE_ANON_KEY` — to drobny rozjazd między docs a kodem, zostawiam to do późniejszej harmonizacji (nazwiska w docs vs kod) — patrz Faza 7.
>
> **Dlaczego nie commitujemy wartości nigdzie**: `wrangler secret put` przyjmuje wartość tylko przez prompt lub stdin, sekret żyje wyłącznie w infrastrukturze Cloudflare. Pliki `.env` zostają lokalne (są w `.gitignore`).

---

### ☐ Faza 5 — Pierwszy deploy produkcyjny (HUMAN GATE)

**Cel**: aplikacja dostępna pod publicznym URL `*.workers.dev`.

- [ ] **5.1** Przegląd końcowy: `wrangler.toml` istnieje, build się przebudował, sekrety zarejestrowane. Agent raportuje stan i **prosi o zgodę przed mutacją produkcji** — to twardy gate z `infrastructure.md:88`
- [ ] **5.2** **HUMAN GATE — wymaga Twojej zgody**: agent uruchamia `npx wrangler deploy`. Komenda zbuduje (jeśli nie zbudowane) i opublikuje Worker
- [ ] **5.3** Zachowaj zwrócony URL — wygląda mniej więcej tak: `https://zagroda-hub.<your-subdomain>.workers.dev`
- [ ] **5.4** Zachowaj **Deployment ID** zwrócony przez wranglera — potrzebny przy rollbacku

> **Dlaczego production deploy to gate**: zgodnie z polityką w `infrastructure.md:88`, agent może bez zgody robić tylko `wrangler deploy --env preview`, `wrangler tail`, `wrangler dev`. Production deploy bez flagi `--env` jest **human-only**. Trzymamy się tej zasady nawet w pierwszym wdrożeniu — buduje to mięsień operacyjny.

---

### ☐ Faza 6 — Smoke test produkcji

**Cel**: udowodnić że pierwsza strona renderuje się SSR-em i połączenie do Supabase działa.

- [ ] **6.1** `curl -I https://<deployed-url>/` — oczekujemy `HTTP/2 200`
- [ ] **6.2** Otwórz URL w przeglądarce — strona główna ładuje się, brak błędów w DevTools Console
- [ ] **6.3** W drugim terminalu: `npx wrangler tail` (real-time logs). Odśwież stronę — w logach powinny być widoczne requesty SSR bez błędów
- [ ] **6.4** Jeśli na stronie jest jakikolwiek widok wymagający Supabase (np. logowanie) — przejdź flow ręcznie i obserwuj `wrangler tail`. Brak `Failed to fetch` / `dynamic-require` / `stream is not defined` = sukces
- [ ] **6.5** Jeśli `Faza 6` ujawnia błąd Supabase + Workers (np. `dynamic require not supported`) — STOP, raportuj, sprawdź `Risk #1` z `infrastructure.md:95`. Nie ślepo naprawiamy

> **Co celowo nie testujemy w pierwszym deployu**: anti-overbooking (FR-014 — Risk #2 wymaga osobnego test scenario z dwoma sesjami), pełna ścieżka auth (FR-006/008/017/018), maile transakcyjne (FR-005/011/016 — wymagają decyzji Cron Triggers vs webhooki, `infrastructure.md` Risk #8). Pierwszy deploy = "stack żyje".

---

### ☐ Faza 7 — Domknięcie: dokumentacja i commit

**Cel**: stan repo i dokumentacji odzwierciedla rzeczywistość po deployu.

- [ ] **7.1** Aktualizacja `.env.example`: dodaj komentarz na górze że produkcja używa `wrangler secret put`, plik `.env` służy tylko lokalnemu dev. Zaktualizuj nazwę `SUPABASE_ANON_KEY` → `SUPABASE_KEY` jeśli była rozjazd (mała poprawka spójności)
- [ ] **7.2** Sprawdź `CLAUDE.md.scaffold` — czy nadal referuje `@astrojs/vercel`? Jeśli tak, krótka aktualizacja (one-liner: "Hosting: Cloudflare Workers via `@astrojs/cloudflare`")
- [ ] **7.3** Commit: `wrangler.toml` + ewentualne drobne poprawki dokumentacji
  - Komunikat (sugestia): `chore(deploy): add wrangler.toml for first Cloudflare Workers production deploy`
- [ ] **7.4** **NIE** commitujemy: `.env`, `.wrangler/`, żadnych sekretów ani Deployment ID

> **Co świadomie zostaje na potem (osobny krok / lekcja)**: deploy job w `.github/workflows/ci.yml` (auto-deploy na merge do `master`), preview env (`[env.preview]` w `wrangler.toml`), custom domain, audytowanie `compatibility_date` po kątem nowszego (`>= 2024-09-23` jest minimum, są nowsze daty z extra features). `infrastructure.md` opisuje pełną operational story — wracamy do niej w kolejnej lekcji.

---

## Plan rollbacku (gdy coś pójdzie nie tak po Fazie 5)

Workers ma atomiczny rollback (~5s) — `infrastructure.md:87`:

- [ ] **R.1** `npx wrangler deployments list` — pokaż ostatnie deployments
- [ ] **R.2** Jeśli to **pierwszy** deploy i jest zły — usuwasz Workera ręcznie w panelu CF (`Workers & Pages → zagroda-hub → Settings → Delete`). **Nigdy nie pozwalamy agentowi na `wrangler delete`** (`infrastructure.md:88`)
- [ ] **R.3** Jeśli to **kolejny** deploy — `npx wrangler rollback --message="rollback first-deploy issue: <powód>"`
- [ ] **R.4** **Uwaga na Supabase**: jeśli między deployami zmieniłeś schemat DB, rollback Workera nie rolluje DB. Trzymamy migracje additive — `infrastructure.md` Risk #2 i sekcja `Rollback` w docs

---

## Weryfikacja end-to-end (testy które potwierdzają sukces)

Po przejściu wszystkich faz, te trzy obserwacje muszą być prawdziwe — to nasza definicja "pierwsze wdrożenie zakończone":

1. **Publiczny URL zwraca 200**: `curl -I https://<deployed>.workers.dev/` → `HTTP/2 200`
2. **Logi są czyste**: `npx wrangler tail` w trakcie odświeżania strony nie pokazuje `error`, `dynamic require`, `stream is not defined`, ani `Failed to fetch` od strony Supabase
3. **Wrangler raportuje sekrety**: `npx wrangler secret list` → dwa wpisy (`SUPABASE_URL`, `SUPABASE_KEY`), bez wartości

---

## Pliki które będą zmienione / utworzone

| Plik | Akcja | Faza |
|------|-------|------|
| `wrangler.toml` | **Nowy** — konfiguracja Workers | 2 |
| `.gitignore` | Edycja — dodać `.wrangler/` jeśli brakuje | 2 |
| `.env.example` | Edycja — komentarz o `wrangler secret`, ewentualnie nazwa klucza | 7 |
| `CLAUDE.md.scaffold` | Mała edycja — Vercel → Cloudflare (jeśli nadal mówi Vercel) | 7 |

**Pliki referencyjne (czytane, nieedytowane)**: `astro.config.mjs`, `src/lib/supabase.ts`, `package.json`, `context/foundation/infrastructure.md`, `context/foundation/tech-stack.md`.

---

## Co jest świadomie poza zakresem tego planu

- Setup preview env w `wrangler.toml` (`[env.preview]`)
- GitHub Actions deploy job (PR → preview, master → prod)
- Custom domain (zostajemy na `*.workers.dev`)
- Migracje schematu Supabase (brak `supabase/migrations/`, decyzja na potem)
- Konfiguracja `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (kod ich nie używa)
- Cron Triggers / Webhooki dla maili transakcyjnych (`Risk #8` w `infrastructure.md`)
- Test koncurencyjnego anti-overbooking FR-014 (`Risk #2` — osobny scenariusz testowy)
- MCP servers Cloudflare (docs / observability) — bonus, nie blokuje MVP

Każdy z tych elementów to osobny krok po pierwszym udanym deployu.
