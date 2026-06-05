<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Booking Schema & Overbooking Guard (F-01)

- **Plan**: context/changes/booking-schema-and-overbooking-guard/plan.md
- **Mode**: Deep
- **Date**: 2026-06-05
- **Verdict**: SOUND
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | WARNING |
| Architectural Fitness | PASS    |
| Blind Spots           | PASS    |
| Plan Completeness     | WARNING |

## Grounding

6/6 paths ✓ (src/lib/supabase.ts, src/middleware.ts, .github/workflows/ci.yml, supabase/config.toml, package.json, eslint.config.js), symbols ✓ (`createServerClient` src/lib/supabase.ts:1,9; callers `createClient`: middleware + 3 routy auth), brief↔plan ✓, Progress↔Fazy ✓. Dodatkowo zweryfikowane: `@astrojs/check@^0.9.8` obecny (package.json:15); `enable_confirmations = false` lokalnie (config.toml:209); eslint bez bloku `ignores` — tylko `includeIgnoreFile(.gitignore)` (eslint.config.js:12,72); husky+lint-staged odpala `eslint --fix` na stagowanych `.ts`.

## Findings

### F1 — setup-cli w CI jest zbędny i wprowadza dryf wersji CLI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Lean Execution
- **Location**: Faza 4 — Workflow CI
- **Detail**: Plan każe instalować `supabase/setup-cli@v1` ORAZ wołać `npx supabase start`. CLI jest devDependency pinowaną na ^2.23.4 (package.json:52) — po `npm ci` `npx` rozwiązuje lokalną binarkę, więc setup-cli to martwy krok; przy odwrotnym rozstrzygnięciu PATH CI biegałoby na niepinowanej wersji (drift lokalnie↔CI).
- **Fix**: Usunąć setup-cli z kontraktu Fazy 4; job używa wyłącznie `npx supabase start` z devDep.
- **Decision**: FIXED

### F2 — Niespójna hydraulika kluczy: CI eksportuje env, którego globalSetup nie czyta

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Lean Execution
- **Location**: Faza 3 (global-setup) × Faza 4 (krok eksportu env)
- **Detail**: `supabase status -o env` emituje nazwy API_URL / ANON_KEY / SERVICE_ROLE_KEY, a fallback globalSetup oczekuje SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY — nigdy by nie zmatchował. Krok jest zbędny: globalSetup sam woła `supabase status -o json` identycznie lokalnie i w CI.
- **Fix**: Wyciąć krok eksportu env z joba CI; globalSetup samoobsługowo pobiera klucze przez `status -o json` w obu środowiskach.
- **Decision**: FIXED

### F3 — Kryterium 2.2 nie ma wykonywalnej komendy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Plan Completeness
- **Location**: Faza 2 — Success Criteria / Progress 2.2
- **Detail**: „Funkcja istnieje z poprawnymi uprawnieniami (smoke psql) w ramach db reset" — `supabase db reset` nie wykonuje takich asercji, plan nie podaje komendy; kryterium niesprawdzalne i duplikuje test RLS (f) z Fazy 3.
- **Fix**: Skonkretyzować do jednej komendy psql z `has_function_privilege` (oczekiwane `f` dla anon), albo zredukować 2.2 do „db reset czysty + funkcja w wygenerowanych typach" i zostawić uprawnienia testom Fazy 3.
- **Decision**: FIXED

### F4 — `supabase start` w CI boota cały stack — można przyciąć

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Lean Execution
- **Location**: Faza 4
- **Detail**: Testy potrzebują tylko db + auth + PostgREST; pełny start ciągnie Studio, Realtime, Storage, edge-runtime, mailpit (maile wyłączone: config.toml:209).
- **Fix**: `npx supabase start -x studio,realtime,storage-api,imgproxy,edge-runtime,mailpit` w jobie CI.
- **Decision**: FIXED

### F5 — Anon INSERT nie może chainować .select()

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Faza 3 — rls.test.ts (a) + helpery
- **Detail**: Anon ma INSERT bez SELECT — `insert(...).select()` (PostgREST return=representation) padnie mimo że goły `insert()` przejdzie; ryzyko błędnej interpretacji jako padnięcia polityki.
- **Fix**: Dopisać zdanie do kontraktu testów RLS: anon wstawia gołym `.insert()` bez `.select()`.
- **Decision**: FIXED
