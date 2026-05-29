# Plan: Pierwsze wdrożenie zagroda-hub na Cloudflare Workers (v3 — po wykonaniu Faz 2–3)

> **Co się zmieniło względem v2**: wykonanie Fazy 2–3 ujawniło, że root `wrangler.jsonc` jest czytany przez `@cloudflare/vite-plugin` **już podczas `npm run build`**, nie dopiero przy `wrangler deploy`. Minimalny config z v2 (z polami `main` + `assets`) **wywalał build** (walidacja `main` względem skasowanego `dist/` — chicken-and-egg) i — gdyby przeszedł — **nadpisałby** generowany config, gubiąc bindingi `SESSION` (KV) i `IMAGES`, które adapter auto-dodaje. v3: root config zawiera **wyłącznie nadpisania, których jesteśmy źródłem** (`name`, `compatibility_date`, `observability`); `main`/`assets`/bindingi dokłada adapter. Deploy z roota działa przez **redirected configuration** (`.wrangler/deploy/config.json` → `dist/server/wrangler.json`).
>
> **Co się zmieniło względem v1**: lokalna weryfikacja wykazała że adapter `@astrojs/cloudflare` v13.6.0 sam generuje `dist/server/wrangler.json` z aktualnym `compatibility_date = "2026-04-15"` i poprawnymi ścieżkami. Plan v1 proponował **ręczny `wrangler.toml`** ze **stale datą `2024-09-23`** i **błędną ścieżką `dist/_worker.js/index.js`**, której adapter w ogóle nie generuje. Nowy plan polega na adapter-generated configu i dokłada brakujące pre-flight checks (Node, workers.dev subdomain, Supabase Site URL).

## Context

Wdrażamy aplikację Zagroda Hub (Astro 6 SSR + React 19 + Supabase) po raz pierwszy na produkcję, zgodnie z decyzją z `context/foundation/infrastructure.md`: **Cloudflare Workers** (GA, 5/5 agent-friendly criteria, runtime `workerd`). Adapter `@astrojs/cloudflare` v13.6.0 jest już wpięty w `astro.config.mjs:7,16` (commit `15a9344 vercel -> cloudflare`). Astro 6 dev server (`astro dev`) odpala `workerd` natywnie przez Cloudflare Vite plugin — `wrangler dev` jest zbędny.

**Co już mamy**:
- Adapter `@astrojs/cloudflare` v13.6.0 wpięty (`astro.config.mjs:7,16`)
- Klient Supabase w `src/lib/supabase.ts` czyta `SUPABASE_URL` + `SUPABASE_KEY` (uwaga: nazwa, nie `SUPABASE_ANON_KEY`)
- `package.json` deklaruje `name: "10x-astro-starter"` (← będzie dziedziczone przez Worker, patrz Faza 2)
- CI build w `.github/workflows/ci.yml` przebudowuje SSR na każdy push
- `@supabase/ssr@0.10.3` — działa na Workers (zweryfikowane w `infrastructure.md`)
- **Build dziś produkuje `dist/server/wrangler.json`** z polami: `name: "10x-astro-starter"`, `main: "entry.mjs"`, `compatibility_date: "2026-04-15"`, `assets: { binding: "ASSETS", directory: "../client" }`, **bez `nodejs_compat`**.

**Czego brakuje**: konto Cloudflare, projekt Supabase, root `wrangler.jsonc` ze spójną nazwą Workera, sekrety w CF, claim workers.dev subdomain, Supabase Site URL config, drobne porządki w `.env.example`.

**Zakres**: tylko **production deploy, manualny**. Bez preview env, bez CI/CD deploy job, bez custom domain (`*.workers.dev`). "Stack żyje" jako definicja sukcesu pierwszego deployu.

**Cel**: `https://zagroda-hub.<subdomain>.workers.dev` zwraca HTTP 200 z **renderowaną stroną główną** (nie pustą skorupą), logi w `wrangler tail` czyste, sekrety widoczne w `wrangler secret list`.

---

## Wymagania wstępne (human-only, poza zakresem agenta)

Te kroki musisz wykonać Ty zanim agent ruszy z Fazą 0.5. Każdy `0.x` to **hard gate** — agent nie może go obejść (interaktywny signup, dashboard click-through, prywatne wartości).

### 0.1 — Konto Cloudflare

- [ ] **0.1.1** Otwórz <https://dash.cloudflare.com/sign-up> i załóż konto na adres email, do którego masz stały dostęp (potrzebny do **2FA** i recovery)
- [ ] **0.1.2** Potwierdź adres email (link z inboxa) — bez tego część funkcji jest zablokowana
- [ ] **0.1.3** **Włącz 2FA** w **My Profile → Authentication** (TOTP lub klucz sprzętowy). To konto trzyma klucze do produkcji — 2FA jest minimum
- [ ] **0.1.4** Nie podajesz karty kredytowej — **Free plan** wystarczy do MVP (100k req/dzień, 10ms CPU per invocation, 1MB worker size limit). Karta będzie potrzebna dopiero przy upgrade do **Workers Paid ($5/mc)**, którego MVP nie wymaga
- [ ] **0.1.5** Zachowaj: **Account Name** (widoczny w prawym górnym rogu dashboardu) i **Account ID** (Workers & Pages → prawa kolumna). Account ID przyda się przy konfiguracji CI w kolejnej lekcji

> **Workers.dev subdomain** wybierasz osobno w Fazie 1.3 (nie tutaj) — wrangler login musi być najpierw.

### 0.2 — Projekt Supabase

- [ ] **0.2.1** Otwórz <https://supabase.com/dashboard> i zaloguj się (GitHub OAuth lub email)
- [ ] **0.2.2** **New project** w organization (twoja personal org wystarczy). Nazwa projektu: `zagroda-hub` (lub dowolna spójna)
- [ ] **0.2.3** **Region** — wybierz z dropdown'a **najbliższy geograficznie** (Frankfurt EU lub London EU dla użytkowników z Polski). **Decyzja jednorazowa** — Supabase nie pozwala zmienić regionu po utworzeniu projektu (musiałbyś migrować dane)
- [ ] **0.2.4** **Database password** — wygenerowany losowy ciąg. **Zapisz w menedżerze haseł** zaraz po wygenerowaniu. Bez niego nie podłączysz się do DB przez `psql` ani Supabase CLI; reset wymaga supportu
- [ ] **0.2.5** **Plan**: Free (500MB DB, 1GB Storage, 50k MAU, no card required) — wystarczy do MVP
- [ ] **0.2.6** Poczekaj 1–3 minuty na provisioning (UI pokaże "Setting up project...")
- [ ] **0.2.7** Zachowaj: nazwę projektu, region, **Project Ref** (część URL'a po utworzeniu, format `<xxxxxxxxxxxx>` w `https://<ref>.supabase.co`)

### 0.3 — Credentiale z Supabase API panel

- [ ] **0.3.1** W Supabase Dashboard wybierz świeżo utworzony projekt → **Settings (lewy dolny róg) → API**
- [ ] **0.3.2** Z sekcji **Project URL** skopiuj wartość pola `URL` (format: `https://<project-ref>.supabase.co`). To pójdzie do sekretu **`SUPABASE_URL`**
- [ ] **0.3.3** Z sekcji **Project API keys** skopiuj **`anon` `public`** (NIE `service_role`!). To pójdzie do sekretu **`SUPABASE_KEY`** (nazwa zgodna z `src/lib/supabase.ts:3` — w MVP używamy nazwy `SUPABASE_KEY`, nie `SUPABASE_ANON_KEY`)
- [ ] **0.3.4** Wklej obie wartości tymczasowo do menedżera haseł lub bezpiecznej notatki — wkleisz je w Faza 4 w interaktywne prompty `wrangler secret put` (agent nigdy ich nie zobaczy)

> **CRITICAL — różnica `anon` vs `service_role`**: `anon public` to klucz przeznaczony do publicznego użytku (klient w przeglądarce / SSR), respektuje **Row Level Security (RLS)**. `service_role` to **admin key** bypassujący RLS — **NIGDY** w klientcie, **NIGDY** w MVP. Używanie service_role w SSR byłoby krytycznym lukiem bezpieczeństwa. W tym deployu używamy wyłącznie `anon public`.

### 0.4 — Sanity-check checklist przed sygnałem "gotowe"

Zanim dasz agentowi sygnał, sprawdź że masz **wszystko** z poniższej listy zapisane w bezpiecznym miejscu (menedżer haseł / prywatna notatka):

- [ ] **0.4.1** Cloudflare: email konta + hasło + dostęp do 2FA
- [ ] **0.4.2** Cloudflare: Account Name + Account ID
- [ ] **0.4.3** Supabase: email/GitHub konto użytkownika + dostęp
- [ ] **0.4.4** Supabase: Database password projektu `zagroda-hub`
- [ ] **0.4.5** Supabase: Project URL (`https://<ref>.supabase.co`) — wartość dla `SUPABASE_URL`
- [ ] **0.4.6** Supabase: `anon public` key — wartość dla `SUPABASE_KEY`
- [ ] **0.4.7** Plik repo lokalnie z brancha `master`, z czystym working tree (zostanie zweryfikowane w Faza 0.5)
- [ ] **0.4.8** Lokalne `.env` (jeśli istnieje) dla `npm run dev` ma te same wartości co planowane sekrety — sanity-check że dev działa lokalnie ZANIM ruszamy na prod

### 0.5 — Sygnał "gotowe"

- [ ] **0.5.1** Daj agentowi sygnał `gotowe` (lub `kontynuuj`) w tej konwersacji — wtedy agent uruchamia **Fazę 0.6 — Pre-flight check** (lokalne narzędzia: Node, npm, wrangler, git status)

> **Świadomie odpuszczone na tym etapie**:
> - `SUPABASE_SERVICE_ROLE_KEY` — kod MVP go nie używa (`astro.config.mjs:17-22` deklaruje schemat tylko dla `SUPABASE_URL` + `SUPABASE_KEY`)
> - `OPENROUTER_API_KEY` — żadna ścieżka w kodzie obecnie tego nie czyta
> - Migracje SQL — folder `supabase/migrations/` jest pusty; aplikacja przy pierwszym deployu odpali na pustej DB. Schema dodamy później osobnym krokiem (`supabase migration new ...` przez CLI, który już jest w devDependencies)
> - Custom domain — celowo zostajemy na `*.workers.dev` na pierwszy deploy
> - GitHub Personal Access Token / CF API Token — nie potrzebne dla manualnego deployu; pojawią się dopiero przy konfiguracji CI w kolejnej lekcji
> - Konfiguracja Supabase Auth providers (Google, Facebook OAuth z FR-017/018) — wymaga osobnej konfiguracji w Supabase Dashboard; nie blokuje pierwszego deployu, bo testujemy tylko renderowanie strony głównej

---

## Faza 0.6 — Pre-flight check (read-only, agent)

**Cel**: zatrzymać deploy jeśli lokalne środowisko nie jest gotowe, ZANIM zaczniemy mutować.

- [ ] **0.6.1** `node --version` — wymagane ≥ 20.10 (Astro 6 + adapter v13). Repo nie ma `.nvmrc` — flaguję to jako drobny gap w `CLAUDE.md.scaffold`
- [ ] **0.6.2** `npm --version` — sanity check (≥ 10)
- [ ] **0.6.3** `git status --porcelain` — musi być pusty. Brudny tree przed deployem = anty-wzorzec
- [ ] **0.6.4** `npm ci` jeśli `node_modules/` jest nieaktualny względem `package-lock.json`
- [ ] **0.6.5** `npx wrangler --version` — wrangler ≥ 4.x tranzytywnie z `@astrojs/cloudflare`. Brak = STOP

---

## Faza 1 — Logowanie do Cloudflare + claim workers.dev subdomain

**Cel**: `npx wrangler whoami` zwraca konto **i** subdomena `*.workers.dev` jest zarezerwowana.

- [ ] **1.1** **HUMAN GATE**: `npx wrangler login` — otwiera przeglądarkę, autoryzujesz dostęp
- [ ] **1.2** Weryfikacja: `npx wrangler whoami` zwraca Twój account name i Account ID
- [ ] **1.3** **HUMAN GATE**: zaloguj się do <https://dash.cloudflare.com> → **Workers & Pages**. Pierwsze konto musi wybrać **`workers.dev` subdomain** (np. `konrad-beska`). Bez tego `wrangler deploy` zwróci błąd `you need to register a workers.dev subdomain`
- [ ] **1.4** Zanotuj wybraną subdomenę — finalny URL będzie `zagroda-hub.<subdomain>.workers.dev`

> **Dlaczego claim subdomain to osobny krok**: bez tego `wrangler deploy` faila na pierwszym uruchomieniu komunikatem, który łatwo zinterpretować jako bug w configu. Wolimy zatrzymać się tu, niż debugować pod presją.

---

## Faza 2 — Root `wrangler.jsonc` (override adapter-generated configu)

**Cel**: jedno źródło prawdy w korzeniu repo z nazwą Workera `zagroda-hub`, spójną z `infrastructure.md` i bez konieczności ruszania `package.json.name`.

- [ ] **2.1** Utwórz `wrangler.jsonc` w **korzeniu repo** — **tylko nadpisania, bez `main`/`assets`** (patrz korekta v3 poniżej):

  ```jsonc
  {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "zagroda-hub",
    "compatibility_date": "2026-04-15",
    "observability": {
      "enabled": true
    }
  }
  ```

- [ ] **2.2** Dodaj `.wrangler/` do `.gitignore` jeśli brakuje (lokalny cache wranglera + redirect config)
- [ ] **2.3** **Nie commitujemy jeszcze** — najpierw build i weryfikacja w Fazie 3

> **⚠️ KOREKTA v3 — żadnego `main`/`assets` w root configu**: `@cloudflare/vite-plugin` czyta root `wrangler.jsonc` podczas `npm run build` i waliduje, że `main` wskazuje na **istniejący** plik. Faza 3.1 kasuje `dist/`, więc `main: "./dist/server/entry.mjs"` → build error `main field doesn't point to an existing file`. Ponadto root config **scala się** z adapter-generated (nie nadpisuje go w całości), więc ręczne `assets`/`main` tylko duplikują (i potrafią zepsuć ścieżki względne `../client`) to, co adapter ustawia sam. Root config trzyma wyłącznie `name` (override), `compatibility_date` (pin) i `observability`.
>
> **Dlaczego `wrangler.jsonc` a nie `wrangler.toml`**: docs Astro i adapter używają JSON; mieszanie formatów daje two-source-of-truth.
>
> **Bindingi SESSION + IMAGES**: adapter v13.6 auto-dodaje binding `SESSION` (KV, sessions) i `IMAGES` (Cloudflare Images) do `dist/server/wrangler.json`. Zweryfikowane w Fazie 3: po buildzie generowany config ma `name: "zagroda-hub"` (z root override) **oraz** `kv_namespaces: [{binding: "SESSION"}]`, `images: {binding: "IMAGES"}`, `assets: {binding: "ASSETS", directory: "../client"}`, `main: "entry.mjs"`.
>
> **Dlaczego `compatibility_date: "2026-04-15"`**: to data którą wybrał adapter w `dist/server/wrangler.json` (zweryfikowane lokalnie). Wcześniejsza data (np. 2024-09-23) cofa funkcje runtime'u, których adapter v13.6 oczekuje.
>
> **Dlaczego BEZ `nodejs_compat`**: adapter-generated config nie ustawia tego flag'a, a Supabase działa empirycznie. Jeśli Faza 3/6 ujawni runtime error (`stream is not defined`, `dynamic require`), wracamy i dodajemy `"compatibility_flags": ["nodejs_compat"]`.
>
> **Worker name override**: root `wrangler.jsonc` ma precedencję nad adapter-generated `dist/server/wrangler.json` (wartość `name` wygrywa). Worker będzie nazwany `zagroda-hub`, nie `10x-astro-starter` (nazwa z `package.json:2`). Nie ruszamy `package.json.name` — to zmiana publiczna pakietu, ortogonalna do deployu.

---

## Faza 3 — Czysty build + weryfikacja artefaktów

**Cel**: `npm run build` produkuje znane artefakty pod znanymi ścieżkami; bundle mieści się w limicie Free.

- [ ] **3.1** `rm -rf dist .wrangler` — twardy reset stanów lokalnych przed pierwszym deployem (eliminuje stare artefakty po commicie `vercel -> cloudflare`)
- [ ] **3.2** `npm run build` — oczekujemy zero błędów; output kończy się na `Astro [@astrojs/cloudflare]`
- [ ] **3.3** Zweryfikuj że istnieje **`./dist/server/entry.mjs`** (~170 B shim) i katalog **`./dist/client/`**
- [ ] **3.4** Otwórz `./dist/server/wrangler.json` — sanity check: `compatibility_date` zgadza się z root configiem (lub jest nowszy)
- [ ] **3.5** `npx wrangler deploy --dry-run --outdir=.wrangler/dry-run` (nie `--outdir=dist` — koliduje z Astro buildem). Raportuj rozmiar bundla — czerwone światło przy ≥ 3 MiB (Free)
- [ ] **3.6** **NIE** `wrangler dev` — Astro 6 `npm run dev` odpala `workerd` natywnie. Jeśli chcesz przetestować lokalnie, użyj `npm run dev` z lokalnym `.env`

---

## Faza 4 — Rejestracja sekretów w Cloudflare

**Cel**: produkcja zna `SUPABASE_URL` i `SUPABASE_KEY`, **agent nigdy nie widzi wartości**.

- [ ] **4.1** **HUMAN GATE**: `npx wrangler secret put SUPABASE_URL` — wklejasz wartość w interaktywny prompt
- [ ] **4.2** **HUMAN GATE**: `npx wrangler secret put SUPABASE_KEY` — wklejasz `anon public` key
- [ ] **4.3** Weryfikacja: `npx wrangler secret list` → dwa wpisy (`SUPABASE_URL`, `SUPABASE_KEY`), tylko nazwy

> **Decyzja nazewnictwa**: trzymamy `SUPABASE_KEY` (zgodnie z `src/lib/supabase.ts:3` i `astro.config.mjs:20`). Rename do `SUPABASE_ANON_KEY` (jak sugeruje `infrastructure.md:158`) to osobny chirurgiczny refactor — **nie robimy go w deployu**.

---

## Faza 5 — Commit + pierwszy deploy produkcyjny (HUMAN GATE)

**Cel**: stan na masterze zawiera config deployu; aplikacja żyje pod `*.workers.dev`.

- [ ] **5.1** Commit infrastruktury **przed deployem** (nie po — commit timing v1 był za późno):
  ```
  git add wrangler.jsonc .gitignore
  git commit -m "chore(deploy): wire root wrangler.jsonc for first Cloudflare Workers deploy"
  ```
  > Dlaczego teraz, nie po smoke teście: Faza 6 może się rozciągnąć w czasie (przerwy, debug). `wrangler.jsonc` jest już zweryfikowany w Faza 3 — commit go zabezpiecza.

- [ ] **5.2** Przegląd końcowy stanu: wrangler.jsonc istnieje i jest scommitowany, build green, sekrety zarejestrowane, subdomena zaclaimed. Agent raportuje i prosi o zgodę
- [ ] **5.3** **HUMAN GATE — wymaga Twojej zgody**: agent uruchamia `npx wrangler deploy` **z korzenia repo** (build już istnieje). Wrangler wykrywa **redirected configuration**: build zapisał `.wrangler/deploy/config.json`, które przekierowuje z root `wrangler.jsonc` (`Original user's configuration`) na pełny `dist/server/wrangler.json` (`Configuration being used`). Dzięki temu deploy z roota działa mimo że root config nie ma `main` — adapter dostarcza entry + bindingi. Zweryfikowane przez `--dry-run` w Fazie 3.5 (bundle 392 KiB gzip, bindingi SESSION/IMAGES/ASSETS obecne)
- [ ] **5.4** Zanotuj zwrócony URL (`https://zagroda-hub.<subdomain>.workers.dev`) i **Deployment ID**

---

## Faza 6 — Smoke test produkcji (z weryfikacją treści, nie tylko 200)

**Cel**: udowodnić że SSR faktycznie renderuje stronę, a nie zwraca pustą skorupę / 200 od redirectu.

- [ ] **6.1** Status code: `curl -I https://<deployed-url>/` → `HTTP/2 200`
- [ ] **6.2** **Treść SSR** (kluczowy nowy krok względem v1): `curl -sS https://<deployed-url>/ | grep -i "<znany-marker>"` — gdzie marker to znany tag/tekst ze strony głównej (np. fragment `<title>`, nazwa aplikacji, znana sekcja nawigacji). Bez tego 200 może być od pustej skorupy
- [ ] **6.3** Otwórz URL w przeglądarce — strona ładuje się, brak błędów w DevTools Console
- [ ] **6.4** `npx wrangler tail` w drugim terminalu. Odśwież stronę → logi pokazują requesty SSR bez `Failed to fetch` / `dynamic require` / `stream is not defined`
- [ ] **6.5** **Supabase Site URL** (nawet jeśli auth dziś nie używamy): Supabase Dashboard → **Authentication → URL Configuration** → ustaw **Site URL** na `https://<deployed-url>`. Bez tego pierwszy auth flow w przyszłości breaknie z `redirect_to mismatch`
- [ ] **6.6** Jeśli widoczny Supabase error w `wrangler tail` (`dynamic require not supported`) — STOP. Dodaj `"compatibility_flags": ["nodejs_compat"]` do `wrangler.jsonc`, commit, redeploy. Patrz `infrastructure.md` Risk #1

> **Czego nie testujemy w pierwszym deployu**: FR-014 (anti-overbooking) — wymaga concurrent test scenario (`infrastructure.md` Risk #2). Pełne auth flows — wymagają user accounts. Maile transakcyjne — wymagają decyzji Cron Triggers vs webhooki.

---

## Faza 7 — Domknięcie dokumentacji

**Cel**: docs odzwierciedlają rzeczywistość. **Bez commit'a wrangler.jsonc** (już zrobione w Faza 5).

- [ ] **7.1** `.env.example`: dodaj komentarz na górze że produkcja używa `wrangler secret put`, nie tego pliku. Plik pokazuje **lokalny** dev set
- [ ] **7.2** Sprawdź `CLAUDE.md.scaffold` — czy nadal mówi o Vercel? Jeśli tak, krótka aktualizacja jednej linii o Cloudflare Workers + adapter
- [ ] **7.3** Drugi commit (tylko docs):
  ```
  git add .env.example CLAUDE.md.scaffold
  git commit -m "docs: align env example and scaffold notes with Cloudflare Workers deploy"
  ```
- [ ] **7.4** **NIE** commitujemy: `.env`, `.wrangler/`, Deployment ID, sekretów

> **Rename `SUPABASE_KEY` → `SUPABASE_ANON_KEY`**: **wyrzucone z tego planu**. To osobny chirurgiczny refactor (3 pliki: kod, config schema, .env.example), godny własnego PR.

---

## Plan rollbacku (gdy Faza 5 lub 6 ujawnia regres)

Workers ma overwrite-in-place — usuwanie nie jest potrzebne dla "bad deploy". Korekta plus redeploy nadpisuje:

- [ ] **R.1** Diagnoza: `npx wrangler tail` + `npx wrangler deployments list`
- [ ] **R.2** Korekta w kodzie lub `wrangler.jsonc` → `npm run build` → `npx wrangler deploy` (HUMAN GATE). **Nie kasujemy Workera**
- [ ] **R.3** Jeśli koniecznie trzeba cofnąć do poprzedniego deploymentu (np. zła aplikacja, regres niemożliwy do szybkiego naprawienia): `npx wrangler rollback --message="<powód>"` (~5s, atomic). Wymaga ≥ 2 deploymentów w historii — przy pierwszym deployu nie zadziała
- [ ] **R.4** **`wrangler delete` jest human-only i potrzebny TYLKO** gdy chcesz zwolnić nazwę `zagroda-hub` lub kompletnie usunąć Workera z konta. Nigdy jako standardowy rollback
- [ ] **R.5** Uwaga: rollback Workera **nie rolluje** Supabase DB. Migracje powinny być additive

---

## Weryfikacja end-to-end (definicja "zrobione")

1. `curl -I https://<deployed>.workers.dev/` → `HTTP/2 200`
2. `curl -sS https://<deployed>.workers.dev/ | grep -q "<znany-marker-strony>"` → exit 0
3. `npx wrangler tail` w trakcie ruchu pokazuje requesty SSR **bez** errorów Supabase
4. `npx wrangler secret list` → `SUPABASE_URL`, `SUPABASE_KEY` (sama lista nazw)
5. Supabase Dashboard → Authentication → URL Configuration → Site URL = `https://<deployed-url>`
6. `git status` clean, dwa commity dodane (deploy config + docs)

---

## Pliki tworzone / edytowane

| Plik | Akcja | Faza |
|------|-------|------|
| `wrangler.jsonc` | **Nowy** (zamiast `wrangler.toml`) | 2 |
| `.gitignore` | Edycja — dodać `.wrangler/` jeśli brakuje | 2 |
| `.env.example` | Edycja — komentarz o `wrangler secret put` | 7 |
| `CLAUDE.md.scaffold` | Drobna edycja — Vercel → Cloudflare jeśli nieaktualne | 7 |

**Read-only**: `astro.config.mjs`, `src/lib/supabase.ts`, `package.json`, `dist/server/wrangler.json` (generowany), `context/foundation/infrastructure.md`, `context/foundation/tech-stack.md`.

---

## Świadomie poza zakresem

- Setup preview env (`[env.preview]` w `wrangler.jsonc`)
- GitHub Actions deploy job
- Custom domain
- Migracje schematu Supabase (folder `supabase/migrations/` pusty)
- `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (kod ich nie używa)
- Cron Triggers / webhooki dla maili (`infrastructure.md` Risk #8)
- Test konkurencyjnego FR-014 (`infrastructure.md` Risk #2)
- Rename `SUPABASE_KEY` → `SUPABASE_ANON_KEY` (osobny PR)
- MCP servers Cloudflare (`docs.mcp.cloudflare.com`, `observability.mcp.cloudflare.com`)
- Billing notification / hard cap (Free tier — degradacja przy 100k req/day, ale to nie blokuje MVP)

---

## Notatki z wykonania Faz 2–3 (audit trail v2 → v3)

| Defekt v2 | Co było źle | Co teraz (v3) |
|-----------|-------------|---------------|
| Root config z `main: "./dist/server/entry.mjs"` | `@cloudflare/vite-plugin` waliduje `main` podczas `npm run build`; Faza 3.1 kasuje `dist/` → build error `main field doesn't point to an existing file` (chicken-and-egg) | Root config **bez `main`** — adapter ustawia `main: "entry.mjs"` sam w `dist/server/wrangler.json` |
| Root config z `assets.directory: "./dist/client"` | Root config **scala się** z adapter-generated, nie nadpisuje go w całości; ręczne `assets` duplikuje/psuje ścieżkę względną `../client` adaptera | Root config **bez `assets`** — adapter ustawia `assets: {binding: "ASSETS", directory: "../client"}` |
| Założenie: root config czytany dopiero przy `wrangler deploy` | Plugin czyta go też przy `astro build` | Root config trzyma wyłącznie `name`/`compatibility_date`/`observability` (nadpisania, nie pełna definicja) |
| Brak świadomości bindingów SESSION/IMAGES | Minimalny root config nadpisujący całość zgubiłby auto-bindingi adaptera (KV sessions, Cloudflare Images) | Bindingi zachowane — zweryfikowane w generowanym configu po buildzie |
| Faza 5.3: „wrangler resolvuje root `wrangler.jsonc`" | Niepełne — deploy działa przez **redirected configuration** (`.wrangler/deploy/config.json` → `dist/server/wrangler.json`), nie przez sam root config | Mechanizm opisany w 5.3; zweryfikowany dry-runem (3.5) |

## Notatki z lokalnej weryfikacji (audit trail v1 → v2)

| Defekt v1 | Co było źle | Co teraz |
|-----------|-------------|----------|
| `main = "./dist/_worker.js/index.js"` | Adapter v13.6 nie generuje tego pliku w SSR mode | `main = "./dist/server/entry.mjs"` (adapter-emitted) |
| `[assets] directory = "./dist"` | Wystawiłoby `dist/server/*` z bundlem jako public static | `assets.directory = "./dist/client"` |
| `compatibility_date = "2024-09-23"` | 19 miesięcy stale; adapter sam wybiera `2026-04-15` | `compatibility_date = "2026-04-15"` |
| `compatibility_flags = ["nodejs_compat"]` | Adapter v13.6 nie wymaga go w tej dacie; Supabase działa bez | Bez flag'a; fallback w Faza 6.6 jeśli runtime fail |
| `wrangler.toml` format | Adapter używa JSON, mieszanie → two-source-of-truth | `wrangler.jsonc` |
| Brak Node version check | Astro 6 + adapter v13 wymaga Node ≥ 20.10 | Faza 0.5 preflight |
| Brak claim workers.dev subdomain | Pierwszy deploy fail z błędem `register a workers.dev subdomain` | Faza 1.3 explicit human gate |
| `--dry-run --outdir=dist` | Koliduje z Astro buildem | `--outdir=.wrangler/dry-run` |
| Hardcoded Supabase region `eu-central-1` | Slug niespójny między dokumentacją a UI | "wybierz z dropdown'a" |
| Smoke test tylko `curl -I` | 200 może być od pustej skorupy / redirectu | `curl ... \| grep "<marker>"` w 6.2 |
| Brak Supabase Site URL | Przyszłe auth flows breakną z `redirect_to mismatch` | Faza 6.5 |
| Rollback R.2 = "usuń Workera" | Overreach — redeploy nadpisuje | R.2 = redeploy; delete tylko jako teardown |
| Commit wrangler.jsonc w Fazie 7 | Za późno — godziny niezapisanego stanu | Commit w Fazie 5 (po build green) |
| Faza 7.1 wspomina rename `SUPABASE_KEY` | Zaciemnia zakres deployu | Rename wyrzucony — osobny PR |
