# Redesign UI „Łąka i miód" — Implementation Plan

## Overview

Globalny re-theme Zagroda Hub: z ciemnego „kosmicznego" motywu 10x Astro Startera (gradient `bg-cosmic`, glassmorphism `bg-white/10 backdrop-blur-xl`, fioletowe akcenty) na jasny, ciepły motyw domenowy **„Łąka i miód"** (kremowe tło, białe miękkie karty, zieleń łąki jako primary, miodowy akcent). Mechanika: semantyczne tokeny `@theme` + utility-szkielety `@utility` w `src/styles/global.css`, migracja ~31 plików per grupa powierzchni. Do tego: pełna polonizacja resztek EN (formularze auth), domenowe assety SVG (logomark, favicon, OG, ilustracja-placeholder), webfont Nunito, dedykowana strona 404, poprawki kontrastu WCAG AA, sprzątnięcie plików startera i uzgodnienie palety e-maili.

## Current State Analysis

Pełna analiza: `context/changes/new-user-interface/research.md`. Skrót:

- **Motyw jest zakodowany w klasach utility, nie w tokenach.** 31 z 34 plików `.astro`/`.tsx` nosi hardkodowane idiomy: `bg-cosmic` (12 stron; definicja `src/styles/global.css:113`), karta `rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl`, nagłówek `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-transparent`, przycisk `bg-purple-600 hover:bg-purple-500`, tekst wtórny `text-blue-100/50-80`. Idiomy powtarzają się verbatim (np. `src/pages/index.astro:8-12` trzyma je w lokalnych constach).
- **Tokeny shadcn w `global.css:6-111` to nietknięte defaulty** — konsumują je `src/components/ui/button.tsx` (importowany tylko przez `SubmitButton.tsx`, który i tak nadpisuje go klasą `bg-purple-600`) ORAZ reguła bazowa `body { @apply bg-background text-foreground }` (`global.css:122`). Przekolorowanie tokenów jest niemal darmowe, ale przez regułę `body` przemalowuje warstwę bazową KAŻDEJ strony (biel → krem) już w fazie 1 — niewidoczne, dopóki wrappery `bg-cosmic min-h-screen` kryją viewport ciemnych stron; wymaga spot-checku w fazie 1.
- **Angielskie copy startera** w `SignInForm.tsx:21-89`, `SignUpForm.tsx:34-114`, `ResetPasswordForm.tsx:27-93`, `PasswordToggle.tsx:14` (aria) — jawnie odroczony follow-up z landing-redesign. `Layout.astro:20` ma `lang="en"`.
- **Assety startera**: `public/favicon.png` (rakieta na granacie), nieużywany `public/template.png` (1,2 MB), brak logo i `og:image`; placeholder zdjęcia zagrody to emoji `🏡` (`ZagrodaCard.astro:33-39`, `zagrody/[id].astro:78-84`). Martwy `LibBadge.astro`, off-palette `Banner.astro`, link do docs startera w `config-status.ts:16`, `package.json` `name: "10x-astro-starter"`.
- **E-maile już są jasno-zielone** (`src/lib/email/layout.ts`: tło `#f4f4f1`, zieleń `#2d5a27`) — bliskie nowej palecie, wymagają tylko uzgodnienia odcieni.
- **Testy**: 6 lokatorów Playwright zależy od angielskiego copy auth (`e2e/critical-flow.spec.ts:93-98`, `e2e/idor-contact-data.spec.ts:48-53`); CI (`.github/workflows/ci.yml`) uruchamia lint+build+vitest, **bez e2e**. Brak snapshotów wizualnych i testów komponentów — czysty re-theme CSS nie psuje Vitest.
- **Stack**: Astro 6 SSR + React 19 + Tailwind v4 (CSS-first, bez configu) na Cloudflare Workers (wrangler); e2e na Pixel 5 (portrait) przeciw `npx wrangler dev :8787` po `npm run build`.

## Desired End State

Aplikacja w całości (landing, katalog, strona zagrody, auth, panel, anuluj, 404, e-maile) wygląda jak produkt o tematyce zagród edukacyjnych: jasny ciepły motyw „Łąka i miód", logomark w Topbarze i faviconie, ilustracja domenowa zamiast emoji, typografia Nunito, całe copy po polsku, `lang="pl"`. Zero śladów startera: brak `bg-cosmic`, glassmorphism, fioletu, gradientowych nagłówków, angielskich stringów UI i plików `LibBadge.astro`/`template.png`.

Weryfikacja końcowa: `npm run build && npm run lint && npm test` przechodzą; `npm run test:e2e` przechodzi lokalnie (z zaktualizowanymi lokatorami); grepy `bg-cosmic|backdrop-blur|purple-|from-blue-200|bg-white/5|bg-white/10|text-blue-100` w `src/` nic nie zwracają (poza świadomymi wyjątkami brand-SVG Google/FB w OAuthButtons); wszystkie strony obejrzane na viewporcie Pixel 5 i zatwierdzone.

### Key Discoveries:

- Dźwignia motywu już działa: `@utility bg-cosmic` w `src/styles/global.css:113` steruje tłem 11 stron jedną linijką — nowy motyw używa tego samego wzorca (`@theme` + `@utility`).
- Glass `bg-white/N` zakłada ciemne tło — na jasnym tle idiomy NIE mapują się 1:1; karty muszą stać się realnymi powierzchniami (`card-surface`).
- Sprzężenie testowe: `getByLabel("Password", { exact: true })` istnieje, by nie łapać aria-label `PasswordToggle` — po polonizacji „Hasło" vs „Pokaż hasło" ten sam problem substring wraca, `exact: true` musi zostać (komentarze w specach: `critical-flow.spec.ts:96`, `idor-contact-data.spec.ts:51`).
- Kolory statusów (`StatusBadge.tsx:6-10`, boxy green/red/amber w `RequestDecision.tsx:82-112`) są zaprojektowane jako jasny-tekst-na-ciemnym (`text-green-200` na `bg-green-400/10`) — na jasnym tle wymagają odwrócenia na ciemny-tekst-na-jasnym-tincie.
- `katalog.astro:107` wymusza ciemne natywne kontrolki (`[color-scheme:dark]`, `[&>option]:bg-slate-900`) — do usunięcia przy jasnym motywie.
- Lekcje z `context/foundation/lessons.md` (lock-order, migracje przy deployu, sekrety wranglera) nie dotyczą tej zmiany — zero backendu i schematu.

## What We're NOT Doing

- **Bez przełącznika dark mode** — jeden jasny motyw; blok `.dark` w global.css zostaje jako nieaktywny default shadcn.
- **Bez pełnej adopcji shadcn/ui** — nie komponentyzujemy ~30 plików; jedyny wyjątek: `SubmitButton` przestaje nadpisywać `Button`. Szersza adopcja = przyszła zmiana.
- **Bez joba e2e w CI** — to test-plan §3 faza 4; tu tylko lokalny `npm run test:e2e` jako bramka faz 3 i 5.
- **Bez snapshotów wizualnych** (`toHaveScreenshot`) — baseline'y miałyby sens dopiero PO redesignie; ewentualny follow-up.
- **Bez zmian treści merytorycznej** — copy landingu/katalogu/panelu zostaje (jest polskie i domenowe); zmieniamy wyłącznie skórę + angielskie resztki.
- **Bez zmian backendu, API, schematu, logiki rezerwacji** i bez przeformułowania stringów-kontraktów spec/PRD (patrz Critical Implementation Details).
- **Bez profesjonalnego brandu** — logomark SVG projektowany w repo to świadomy placeholder brandu, łatwy do podmiany.
- **Bez zmian struktury layoutu** — jednokolumnowy `max-w-md`/`max-w-*` mobile-first zostaje (uzasadnienie jednodevice'owego e2e i guardrail PRD).

## Implementation Approach

Pięć faz per grupa powierzchni. Faza 1 buduje fundament (tokeny, utilities, font, assety) **obok** istniejącego motywu — `bg-cosmic` pozostaje zdefiniowane aż do fazy 5, więc niezmigrowane strony działają przez cały czas. Fazy 2–4 migrują strony grupami (publiczne → auth+polonizacja → panel); w trakcie aplikacja jest przejściowo dwumotywowa między stronami, ale każda strona jest wewnętrznie spójna. Faza 5 usuwa stary motyw, sprząta pliki startera i uzgadnia e-maile — dopiero wtedy grep-gates „zero cosmic/purple" mogą przejść globalnie.

Nowe idiomy zamiast starych (definicje w fazie 1, jedno źródło prawdy w `global.css`):

| Stary idiom (ciemny) | Nowy idiom (jasny) |
|---|---|
| `bg-cosmic min-h-screen` | `@utility bg-meadow` (krem `#F7F5EF`, opcjonalnie bardzo subtelny gradient) |
| `rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl` | `@utility card-surface` (biała karta, `border-stone-ish`, delikatny cień, `rounded-2xl`) |
| `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-transparent` | zwykły kolor marki (token `text-brand-700`-owaty), bez gradientu |
| `bg-purple-600 hover:bg-purple-500` | `@utility btn-primary` (zieleń `#3F7D2C` / hover `#336423`) |
| `border-white/20 hover:bg-white/10` (secondary) | `@utility btn-secondary` (obrys w kolorze marki na jasnym tle) |
| `text-blue-100/60-80` | token tekstu wtórnego `#5B6350` (pełnokryjący — koniec z opacity poniżej AA) |
| `text-purple-300 hover:text-purple-100` | token linku `#2E6B27` + hover ciemniejszy |
| input `bg-white/10 border-white/20 focus:ring-purple-400` | `@utility input-field` (białe tło, widoczny border ≥3:1, focus ring zieleń) |

Kontrast: wszystkie pary tekst/tło i border/tło z powyższej tabeli weryfikuję rachunkiem WCAG przy implementacji fazy 1 (cel: AA 4.5:1 tekst, 3:1 UI); wyniki zapisuję w komentarzu przy tokenach.

## Critical Implementation Details

- **`bg-cosmic` żyje do fazy 5.** Usunięcie utility przed migracją ostatniej strony wywala build/wygląd niezmigrowanych stron. Grep-gate „zero cosmic" jest kryterium fazy 5, nie wcześniejszych.
- **Stringi-kontrakty — restyle tak, reword nie.** Nie zmieniać brzmienia: „Limit dzienny przekroczony (X z Y zajęte, Z wymaga miejsca)" (oracle FR-014, `critical-flow.spec.ts:121`), „Akceptuj", „Oczekujące", „Zapytanie wysłane — sprawdź e-mail", „Zaakceptowano — nauczyciel dostanie e-mail", „Katalog zagród" (h1 katalogu, `smoke.spec.ts:13`), „Nie znaleziono zapytania", „Kontakt do nauczyciela" oraz polskich labelek formularza rezerwacji (`critical-flow.spec.ts:78-89`).
- **Polonizacja auth ↔ spec-i atomowo (faza 3).** Nowe brzmienia: label „E-mail" (spójnie z formularzem rezerwacji), „Hasło", przycisk „Zaloguj się" / „Załóż konto", aria `PasswordToggle` „Pokaż hasło"/„Ukryj hasło". W specach: `getByLabel("Hasło", { exact: true })` — `exact: true` MUSI zostać (aria „Pokaż hasło" zawiera substring „hasło"). Na stronie signin przycisk i link w Topbarze mają to samo brzmienie „Zaloguj się" — lokator `getByRole("button", …)` odróżnia od linku, nie zmieniać na `getByText`.
- **Pozyskanie assetów bez sieci zewnętrznej poza dozwolonymi hostami**: Nunito (licencja OFL) z repo `github.com/google/fonts` (woff2/ttf → subset latin+latin-ext); rasteryzacja OG (1200×630 PNG) i favicon.png (32×32) z autorskich SVG jednorazowym skryptem node z devDependency `@resvg/resvg-js` (lub `sharp`) — skrypt zostaje w `scripts/` do regeneracji.
- **Statusy na jasnym tle**: odwrócić schemat na ciemny-tekst-na-jasnym-tincie (np. `bg-green-100 text-green-900 border-green-300`-owate, dostrojone do palety) w `StatusBadge.tsx`, `RequestDecision.tsx`, boxach sukcesu/błędu formularzy i `ServerError.tsx`.
- **Natywne kontrolki**: usunąć `[color-scheme:dark]` i `[&>option]:bg-slate-900` z `katalog.astro:107`; jasny motyw używa domyślnego `color-scheme: light` (ustawić `color-scheme` na `:root` w global.css, żeby natywne selecty/date-pickery były jasne wszędzie).
- **Brand-SVG Google/Facebook w `OAuthButtons.tsx` zachowują oryginalne kolory** (wytyczne brandowe dostawców) — to świadomy wyjątek od grep-gate na kolory.

## Phase 1: Fundament motywu i brandu

### Overview

Tokeny palety „Łąka i miód", utility-szkielety, webfont Nunito, `lang="pl"` i wszystkie assety SVG — dodane obok istniejącego motywu. Wizualnie zmienia się tylko favicon i font; wszystkie strony nadal renderują się poprawnie na starym motywie.

### Changes Required:

#### 1. Tokeny i utilities motywu

**File**: `src/styles/global.css`

**Intent**: Zdefiniować paletę „Łąka i miód" jako tokeny Tailwind v4 i utility-szkielety dla powtarzalnych idiomów; przekolorować tokeny shadcn `:root`, żeby `button.tsx` i przyszłe komponenty grały z motywem. `bg-cosmic` zostaje nietknięte (usunięcie w fazie 5).

**Contract**: Blok `@theme` z kolorami brandu (nazwy w duchu: `--color-brand-*` zieleń z bazą `#3F7D2C`/hover `#336423`, `--color-accent-*` miód `#B45E14`, `--color-surface` `#F7F5EF`, `--color-ink` `#27301F`, `--color-ink-muted` `#5B6350`, `--color-link` `#2E6B27`) + `--font-sans` wskazujący Nunito z systemowym fallbackiem. Utilities: `@utility bg-meadow`, `@utility card-surface`, `@utility btn-primary`, `@utility btn-secondary`, `@utility input-field`. Przekolorowany `:root` shadcn: `--primary` = zieleń brandu, `--background` = krem, `--foreground` = ink, `--ring` = zieleń, `--radius` bez zmian. `color-scheme: light` na `:root`. Komentarz przy tokenach z wyliczonymi kontrastami WCAG dla par: ink/surface, ink-muted/surface, ink-muted/white, białe-CTA/brand, link/surface, border-input/white (cel: ≥4.5:1 tekst, ≥3:1 UI; jeśli któryś odcień z palety nie domyka AA, przyciemnić go i odnotować odstępstwo od wyjściowych hexów).

#### 2. Webfont Nunito (self-hosted)

**File**: `public/fonts/` (nowe pliki woff2), `src/styles/global.css` (`@font-face`), `src/layouts/Layout.astro` (preload)

**Intent**: Pełna typografia brandu: Nunito dla nagłówków i tekstu (wagi 400/600/700/800), subset latin + latin-ext (polskie diakrytyki), `font-display: swap`, preload najważniejszej wagi w `<head>`.

**Contract**: Pliki `public/fonts/nunito-*.woff2` (pozyskanie: repo google/fonts, licencja OFL — plik licencji dołączyć obok fontów); `@font-face` w global.css przed `@theme`; `--font-sans: "Nunito", ui-sans-serif, system-ui, …`. Budżet: łączny transfer fontów ≤ ~120 KB (guardrail: katalog < 2 s na mobile).

#### 3. Assety brandu: logomark, favicon, OG, ilustracja-placeholder

**File**: `src/components/brand/Logo.astro` (nowy, inline SVG logomark + wordmark), `src/components/brand/ZagrodaPlaceholder.astro` (nowy, inline SVG ilustracji), `public/favicon.svg` + podmieniony `public/favicon.png`, `public/og-image.png`, `scripts/generate-brand-assets.mjs` (nowy)

**Intent**: Prosty domenowy logomark (stodoła/dom + słońce/liść w palecie: zieleń + miód), używany w Topbarze, faviconie i obrazie OG; osobna ilustracja-placeholder zagrody (scena: zagroda + pole/zwierzę) zastępująca emoji 🏡. Skrypt rasteryzuje SVG → `favicon.png` (32×32) i `og-image.png` (1200×630, logomark + wordmark + tagline na kremowym tle).

**Contract**: `Logo.astro` przyjmuje props rozmiaru/wariantu (sam znak vs znak+wordmark); `ZagrodaPlaceholder.astro` renderuje `<svg>` z `aria-hidden="true"` i skaluje się do kontenera (viewBox, w/h 100%). Skrypt node z devDependency `@resvg/resvg-js`; uruchamiany ręcznie (`node scripts/generate-brand-assets.mjs`), commitujemy wygenerowane PNG. Traktować logomark jako placeholder brandu (łatwa podmiana = jeden plik).

#### 4. Metadane layoutu: `lang="pl"`, og:image, favicon links

**File**: `src/layouts/Layout.astro`

**Intent**: Poprawić `lang="en"` → `lang="pl"` (`Layout.astro:20`), dodać `og:image` (absolutny URL z `Astro.url` + `/og-image.png`), podpiąć `favicon.svg` z fallbackiem PNG, preload fontu.

**Contract**: `<html lang="pl">`; `<meta property="og:image" …>`; `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` + istniejący PNG jako fallback. Bez zmian w propsach `title`/`description`.

### Success Criteria:

#### Automated Verification:

- Build przechodzi: `npm run build`
- Lint przechodzi: `npm run lint`
- Vitest bez regresu: `npm test`
- `grep -n "lang=\"pl\"" src/layouts/Layout.astro` zwraca trafienie; `grep -rn "lang=\"en\"" src/` nic nie zwraca
- Pliki istnieją: `public/fonts/*.woff2`, `public/favicon.svg`, `public/og-image.png`, `src/components/brand/Logo.astro`, `src/components/brand/ZagrodaPlaceholder.astro`
- `bg-cosmic` nadal zdefiniowane i strony renderują się (dev smoke: `/` i `/katalog` zwracają 200)

#### Manual Verification:

- Favicon w karcie przeglądarki pokazuje nowy logomark (nie rakietę)
- Font Nunito renderuje się na stronach (diakrytyki ąęłóśżź poprawne), bez widocznego FOIT
- Podgląd `og-image.png` — czytelny logomark + wordmark na kremowym tle
- Kontrasty z komentarza w global.css potwierdzone (spot-check dwóch par w DevTools)
- Strony ciemne (jeszcze niezmigrowane) bez regresu po przekolorowaniu `:root`: spot-check `/katalog` i `/auth/forgot-password` — wrappery `bg-cosmic` kryją cały viewport (w tym overscroll), natywne kontrolki czytelne mimo `color-scheme: light`

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie manualne (zwłaszcza akceptację logomarku i ilustracji — to decyzje estetyczne), zanim ruszysz Fazę 2.

---

## Phase 2: Powierzchnie publiczne

### Overview

Migracja wszystkich stron publicznych na nowy motyw: Topbar (z logo), landing, katalog, strona zagrody z formularzem rezerwacji, strona anulowania, nowa strona 404. Po tej fazie ścieżka nauczyciela-gościa jest w całości „Łąka i miód".

### Changes Required:

#### 1. Topbar z logomarkiem

**File**: `src/components/Topbar.astro`

**Intent**: Zastąpić glass-idiom (`border-white/10 bg-white/5`) jasnym paskiem na `card-surface`-owej powierzchni; dodać `Logo.astro` (znak + wordmark) linkujący do `/`; linki nawigacji na token linku zamiast `text-purple-300`. Brzmienia linków bez zmian (Katalog/Panel/Zapytania/Wyloguj/Zaloguj się/Zarejestruj się).

**Contract**: Topbar renderuje `<Logo>` po lewej; nav zachowuje strukturę `Astro.locals.user` (`Topbar.astro:8-48`). Tap-targets ≥ 44px na mobile (guardrail jednoręczności).

#### 2. Landing

**File**: `src/pages/index.astro`

**Intent**: Przemapować lokalne consty `primaryBtn`/`secondaryBtn`/`card` (`index.astro:8-12`) na nowe utilities; `bg-cosmic` → `bg-meadow`; gradient h1 → kolor marki; teksty wtórne na `ink-muted`. Treść (hero, 3 kroki, persony, stopka) bez zmian.

**Contract**: Zero klas `purple-*`/`blue-100`/`white/N` w pliku po migracji; CTA nadal warunkowe po `Astro.locals.user`.

#### 3. Katalog + karta zagrody

**File**: `src/pages/katalog.astro`, `src/components/katalog/ZagrodaCard.astro`

**Intent**: Migracja shellu strony i formularza filtrów na nowe utilities; usunąć `[color-scheme:dark]` + `[&>option]:bg-slate-900` (`katalog.astro:107`); `ZagrodaCard` na `card-surface` z wpiętą `ZagrodaPlaceholder` zamiast emoji 🏡 (`ZagrodaCard.astro:33-39`). H1 „Katalog zagród" — brzmienie bez zmian (kontrakt `smoke.spec.ts:13`).

**Contract**: Selecty/date-input natywnie jasne; badge „brak miejsc" (`ZagrodaCard.astro:57`) przestrojony na jasny tint z ciemnym tekstem.

#### 4. Strona zagrody + formularz rezerwacji

**File**: `src/pages/zagrody/[id].astro`, `src/components/booking/BookingRequestForm.tsx`

**Intent**: Migracja strony (w tym stanu inline-404 i placeholdera zdjęcia `[id].astro:78-84` → `ZagrodaPlaceholder`); formularz rezerwacji na `input-field`/`btn-primary`, box sukcesu na jasny tint. Labelki i komunikaty formularza — brzmienia bez zmian (kontrakty `critical-flow.spec.ts:78-89`).

**Contract**: Zero zmian w polach, walidacji i fetch-logice formularza; wyłącznie klasy + kolory boxów statusu.

#### 5. Strona anulowania

**File**: `src/pages/anuluj.astro`, `src/components/booking/CancelRequest.tsx`

**Intent**: Migracja shellu i komponentu (przycisk, boxy info/sukces/błąd) na nowe idiomy.

**Contract**: Brzmienia komunikatów bez zmian; tylko skóra.

#### 6. Dedykowana strona 404

**File**: `src/pages/404.astro` (nowy)

**Intent**: Domenowa strona 404 w nowym motywie: ilustracja `ZagrodaPlaceholder`, komunikat po polsku, linki do `/` i `/katalog`. Inline-404 na stronach szczegółów zostają (mają sensowny kontekst), tylko restyle.

**Contract**: Astro serwuje `404.astro` dla niedopasowanych route'ów na adapterze Cloudflare; `<Layout title="Nie znaleziono strony">`. Uwaga: ruch przechodzi przez custom `src/worker.ts` opakowujący handler adaptera — weryfikować przez wejście na NIEDOPASOWANY URL (np. `/nie-ma-takiej-strony`) ze statusem odpowiedzi 404, nie przez `/404` bezpośrednio.

### Success Criteria:

#### Automated Verification:

- Build + lint przechodzą: `npm run build && npm run lint`
- Zero starych idiomów w zmigrowanych plikach: `grep -nE "bg-cosmic|purple-|from-blue-200|text-blue-100|bg-white/(5|10)|backdrop-blur" src/pages/index.astro src/pages/katalog.astro src/pages/zagrody src/pages/anuluj.astro src/pages/404.astro src/components/Topbar.astro src/components/katalog src/components/booking/BookingRequestForm.tsx src/components/booking/CancelRequest.tsx` nic nie zwraca
- Smoke e2e przechodzi lokalnie: `npm run test:e2e -- e2e/smoke.spec.ts`

#### Manual Verification:

- `/`, `/katalog`, `/zagrody/:id`, `/anuluj` oraz strona 404 (przez niedopasowany URL, np. `/nie-ma-takiej-strony`, ze statusem odpowiedzi 404) obejrzane na viewporcie Pixel 5 (pion): czytelne, spójne, klikalne jednoręcznie
- Karta zagrody bez zdjęcia pokazuje ilustrację (nie emoji); filtry katalogu mają jasne natywne kontrolki
- Formularz rezerwacji działa end-to-end (wysłanie zapytania na dev)
- Strony panelu/auth (jeszcze ciemne) nadal działają — dwumotywowość przejściowa zaakceptowana

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie manualne, zanim ruszysz Fazę 3.

---

## Phase 3: Auth — restyle, pełna polonizacja i aktualizacja e2e

### Overview

Migracja 5 stron auth i komponentów formularzy na nowy motyw + pełny pass EN→PL (labelki, placeholdery, walidacje, przyciski, aria-labels) + atomowa aktualizacja 6 lokatorów e2e. Bramka fazy: pełny lokalny `npm run test:e2e`.

### Changes Required:

#### 1. Strony auth (shelle)

**File**: `src/pages/auth/signin.astro`, `signup.astro`, `forgot-password.astro`, `reset-password.astro`, `confirm-email.astro`

**Intent**: Wariant wycentrowany `bg-cosmic flex …` + glass-karta `max-w-sm` → `bg-meadow` + `card-surface`; gradientowe nagłówki → kolor marki; linki na token linku. Natywne formularze w `forgot-password`/`confirm-email` na `input-field`/`btn-primary`.

**Contract**: Struktura stron i routing bez zmian; tytuły PL zostają.

#### 2. Formularze React — restyle + polonizacja

**File**: `src/components/auth/SignInForm.tsx`, `SignUpForm.tsx`, `ResetPasswordForm.tsx`, `FormField.tsx`, `SubmitButton.tsx`, `PasswordToggle.tsx`, `ServerError.tsx`, `OAuthButtons.tsx`

**Intent**: (a) Polonizacja wszystkich stringów EN: labelki („E-mail", „Hasło", „Powtórz hasło"), placeholdery, komunikaty walidacji, przyciski („Zaloguj się"/„Załóż konto"/„Ustaw nowe hasło") i stany pending („Logowanie…"/„Zakładanie konta…"/„Zapisywanie…"), aria `PasswordToggle` → „Pokaż hasło"/„Ukryj hasło". (b) Restyle: `FormField` na `input-field`, `SubmitButton` przestaje nadpisywać shadcn `Button` (usunięcie `bg-purple-600` z `SubmitButton.tsx:18` — Button bierze przekolorowany token `--primary`), `ServerError` i boxy na jasne tinty, `OAuthButtons` na jasne przyciski (brand-SVG Google/FB bez zmian kolorów).

**Contract**: Label „E-mail" spójny z formularzem rezerwacji (tam już „E-mail" z dywizem). Nazwy pól, logika walidacji (progi, kolejność) i API-calls bez zmian — zmieniają się wyłącznie stringi i klasy.

#### 3. Aktualizacja speców e2e (atomowo z #2)

**File**: `e2e/critical-flow.spec.ts`, `e2e/idor-contact-data.spec.ts`

**Intent**: Podmienić 6 lokatorów na polskie brzmienia: `getByLabel("Email")` → `getByLabel("E-mail", { exact: true })`, `getByLabel("Password", { exact: true })` → `getByLabel("Hasło", { exact: true })` (exact zostaje — aria „Pokaż hasło" zawiera substring), `getByRole("button", { name: "Sign in" })` → `getByRole("button", { name: "Zaloguj się" })`. Zaktualizować komentarze wyjaśniające coupling (`critical-flow.spec.ts:96`, `idor-contact-data.spec.ts:51`).

**Contract**: Żadnych innych zmian w specach; lokatory role/label/text bez `data-testid` (polityka repo). Uwaga: `getByLabel("E-mail")` na stronie signin nie może kolidować z niczym innym — na tej stronie jest jedno pole e-mail.

### Success Criteria:

#### Automated Verification:

- Build + lint przechodzą: `npm run build && npm run lint`
- Zero angielskich stringów startera: `grep -rnE "Sign in|Sign up|Signing in|Creating account|Email is required|Password is required|password must|Show password|Hide password|you@example\.com|Your password|Min\. 6 characters|Re-enter" src/components/auth/` nic nie zwraca
- Zero starych idiomów w plikach auth: `grep -nE "purple-|text-blue-100|bg-white/(5|10)|backdrop-blur|bg-cosmic" src/pages/auth src/components/auth` nic nie zwraca
- **Pełny lokalny e2e przechodzi: `npm run test:e2e`** (bramka fazy — CI tego nie łapie)

#### Manual Verification:

- `/auth/signin`, `/auth/signup`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/confirm-email` obejrzane na Pixel 5: nowy motyw, całość po polsku
- Logowanie hasłem + toggle „Pokaż hasło" działają; walidacje pokazują polskie komunikaty
- Przyciski OAuth czytelne na jasnym tle, brand-kolory Google/FB nietknięte

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej (w tym e2e!) zatrzymaj się na potwierdzenie manualne, zanim ruszysz Fazę 4.

---

## Phase 4: Panel właściciela

### Overview

Migracja stron panelu (dashboard, lista i szczegóły zapytań) oraz komponentów React właściciela na nowy motyw. Po tej fazie wszystkie strony aplikacji są jasne; ciemny motyw nie jest już renderowany nigdzie.

### Changes Required:

#### 1. Strony panelu

**File**: `src/pages/dashboard.astro`, `src/pages/dashboard/zapytania/index.astro`, `src/pages/dashboard/zapytania/[id].astro`

**Intent**: Shelle na `bg-meadow`/`card-surface`, nagłówki na kolor marki, linki nawigacyjne i kontaktowe (`tel:`/`mailto:`) na token linku, box wiadomości gościa i stan inline-404 na jasne powierzchnie.

**Contract**: Brzmienia („Kontakt do nauczyciela", „Nie znaleziono zapytania", sekcje szczegółów) bez zmian — kontrakty speców IDOR.

#### 2. Komponenty właściciela i statusy

**File**: `src/components/zagroda/ZagrodaProfileForm.tsx`, `TurnusyEditor.tsx`, `PhotoUpload.tsx`, `src/components/booking/RequestsList.tsx`, `RequestDecision.tsx`, `StatusBadge.tsx`

**Intent**: Inputy na `input-field`, przyciski na `btn-primary`/`btn-secondary`, chipy filtrów `RequestsList` na jasne warianty (aktywny: zieleń, nieaktywny: obrys), `StatusBadge` i boxy decyzji `RequestDecision.tsx:82-112` odwrócone na ciemny-tekst-na-jasnym-tincie (oczekujące=miód/bursztyn, zaakceptowane=zieleń, odrzucone=czerwień, anulowane/wycofane=neutral). Brzmienia statusów i komunikatów bez zmian („Akceptuj", „Oczekujące", „Zaakceptowano — nauczyciel dostanie e-mail", string limitu FR-014).

**Contract**: Zero zmian w logice fetch/stanach; ikony lucide zostają, kolory ikon na `ink-muted`.

### Success Criteria:

#### Automated Verification:

- Build + lint przechodzą: `npm run build && npm run lint`
- Zero starych idiomów w plikach panelu: `grep -nE "bg-cosmic|purple-|text-blue-100|bg-white/(5|10)|backdrop-blur" src/pages/dashboard.astro src/pages/dashboard src/components/zagroda src/components/booking/RequestsList.tsx src/components/booking/RequestDecision.tsx src/components/booking/StatusBadge.tsx` nic nie zwraca
- Pełny lokalny e2e przechodzi: `npm run test:e2e` (critical-flow przechodzi przez panel)

#### Manual Verification:

- `/dashboard`, `/dashboard/zapytania`, `/dashboard/zapytania/:id` na Pixel 5: czytelne jednoręcznie, statusy rozróżnialne kolorem I tekstem
- Edycja profilu zagrody + upload zdjęcia działają; akceptacja/odrzucenie zapytania działa z czytelnymi boxami stanu
- Ścieżka właściciela < 15 s do decyzji (guardrail PRD) — subiektywny spot-check

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się na potwierdzenie manualne, zanim ruszysz Fazę 5.

---

## Phase 5: Sprzątanie startera i spójność e-maili

### Overview

Usunięcie starego motywu i plików startera, restyle Banner, uzgodnienie palety e-maili z brandem, końcowe bramki grep + pełny przebieg testów.

### Changes Required:

#### 1. Usunięcie starego motywu i martwych plików

**File**: `src/styles/global.css`, `src/components/ui/LibBadge.astro` (delete), `public/template.png` (delete)

**Intent**: Usunąć `@utility bg-cosmic` (`global.css:113-115`) — po fazach 2–4 nie ma konsumentów; skasować martwy `LibBadge.astro` (0 użyć) i nieużywany `template.png` (1,2 MB).

**Contract**: `grep -rn "bg-cosmic\|LibBadge\|template.png" src/ public/` nic nie zwraca (poza samym PNG usuniętym).

#### 2. Banner konfiguracyjny i link startera

**File**: `src/components/Banner.astro`, `src/lib/config-status.ts`

**Intent**: Restyle Bannera z hardkodowanych jasnoniebieskich/żółtych hexów (`Banner.astro:27-41`) na tinty palety (info=zieleń, warning=miód, error=czerwień); podmienić `docsUrl` (`config-status.ts:16`) z docs 10x-astro-startera na README projektu (sekcja konfiguracji Supabase) lub oficjalne docs Supabase.

**Contract**: Logika `missingConfigs` bez zmian; wyłącznie style + URL.

#### 3. Rename pakietu

**File**: `package.json`

**Intent**: `name: "10x-astro-starter"` → `name: "zagroda-hub"`.

**Contract**: Czysto kosmetyczne (pakiet prywatny); sprawdzić, że nic nie referuje starej nazwy (`grep -rn "10x-astro-starter" --exclude-dir=node_modules --exclude-dir=context .`— zostaje tylko historia w context/).

#### 4. Uzgodnienie palety e-maili

**File**: `src/lib/email/layout.ts`

**Intent**: Dostroić szablon e-mail do brandu: zieleń nagłówka `#2d5a27` → `#3F7D2C`, tło `#f4f4f1` → `#F7F5EF`, kolory linków/przycisków w treści na zieleń brandu. Struktura table-based i copy bez zmian.

**Contract**: Wyłącznie wartości kolorów w inline-stylach; re-test wysyłki przez `POST /api/dev/test-email` na dev i wizualna kontrola w kliencie poczty.

### Success Criteria:

#### Automated Verification:

- Build + lint + vitest przechodzą: `npm run build && npm run lint && npm test`
- Globalny grep-gate motywu: `grep -rnE "bg-cosmic|backdrop-blur|from-blue-200|bg-clip-text|text-blue-100|bg-white/(5|10)|purple-" src/` nic nie zwraca (dozwolony wyjątek: brand-SVG w `OAuthButtons.tsx` — bez klas kolorów Tailwinda)
- Grep-gate startera: `grep -rn "10x-astro-starter" src/ public/ package.json` nic nie zwraca
- Pliki nie istnieją: `src/components/ui/LibBadge.astro`, `public/template.png`
- **Pełny lokalny e2e przechodzi: `npm run test:e2e`**

#### Manual Verification:

- Testowy e-mail (dev endpoint) wygląda spójnie z web-brandem (zieleń, krem) w realnym kliencie poczty
- Banner konfiguracyjny (wymuszony brakiem env na dev) renderuje się w palecie motywu
- Finalny przegląd WSZYSTKICH stron na Pixel 5 + desktop szeroki viewport (spot-check, że `max-w-*` trzyma kompozycję)
- OG-preview linku (np. wklejenie do komunikatora) pokazuje nowy obraz i opis

**Implementation Note**: Po tej fazie i przejściu weryfikacji plan jest domknięty — kandydat do `/10x-impl-review` i `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- Bez nowych unit testów — zmiana czysto prezentacyjna; istniejący Vitest (API/DB/logika) musi przechodzić bez modyfikacji w każdej fazie.

### Integration Tests:

- `npm run test:e2e` (Playwright, Pixel 5, przeciw zbudowanemu workerowi): smoke po fazie 2, pełny przebieg po fazach 3, 4 i 5. Aktualizacja lokatorów WYŁĄCZNIE w fazie 3 (polonizacja), atomowo ze zmianą stringów.

### Manual Testing Steps:

1. Po każdej fazie: `npm run dev` (lub zbudowany worker), przegląd zmigrowanych stron w DevTools na viewporcie Pixel 5 (pion) — czytelność, tap-targets, spójność palety.
2. Faza 2: pełny flow gościa — katalog → filtr → strona zagrody → wysłanie zapytania → strona /anuluj z tokenu.
3. Faza 3: logowanie e-mail+hasło (błędne i poprawne dane — polskie walidacje), toggle hasła, wygląd przycisków OAuth.
4. Faza 4: flow właściciela — edycja profilu, lista zapytań (filtry), akceptacja z widocznym boxem sukcesu.
5. Faza 5: e-mail testowy w realnym kliencie, OG-preview, finalny przegląd całości.

## Performance Considerations

- Budżet fontów ≤ ~120 KB woff2 łącznie (subset latin+latin-ext, 3–4 wagi), `font-display: swap` + preload — guardrail: katalog < 2 s p95 na mobile.
- Inline SVG (logo, ilustracja) zamiast rastrowych obrazów — zero dodatkowych requestów; `og-image.png` ładowany tylko przez scrapery.
- Usunięcie `backdrop-blur` (13 plików) to drobny zysk renderowania na słabszych telefonach.
- Usunięcie `template.png` odchudza deploy o 1,2 MB.

## Migration Notes

- Zero migracji danych/schematu. Deploy standardowy (`npm run deploy` — bez zmian schematu lekcja „migrations-first" nie aktywuje się).
- Fazy commitować oddzielnie; w razie problemu `wrangler rollback` bezpieczny (czysto frontendowa zmiana).
- Dwumotywowość przejściowa (fazy 2–4) jest akceptowana na dev; NA PRODUKCJĘ deployować dopiero po fazie 4 lub 5, żeby użytkownicy nie zobaczyli miksu motywów — jeśli między fazami coś wymusi deploy, świadomie zaakceptować miks lub wstrzymać.

## References

- Research: `context/changes/new-user-interface/research.md`
- Decyzja odwracana (ciemny motyw jako język produktu): `context/archive/2026-06-15-landing-page-redesign/plan.md:26-32,74-76`
- Wzorzec dźwigni motywu: `src/styles/global.css:113` (`@utility bg-cosmic`)
- Kotwica brandu e-mail: `src/lib/email/layout.ts:27`
- Sprzężenie lokatorów: `e2e/critical-flow.spec.ts:93-98,121`, `e2e/idor-contact-data.spec.ts:48-53`
- Polityka lokatorów i mobile-first: `context/archive/2026-06-14-testing-e2e-critical-flow-mobile/plan.md:56-58`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fundament motywu i brandu

#### Automated

- [x] 1.1 Build przechodzi: `npm run build` — 45e1a63
- [x] 1.2 Lint przechodzi: `npm run lint` — 45e1a63
- [x] 1.3 Vitest bez regresu: `npm test` — 45e1a63
- [x] 1.4 `lang="pl"` w Layout, brak `lang="en"` w src/ — 45e1a63
- [x] 1.5 Assety istnieją: fonts/, favicon.svg, og-image.png, Logo.astro, ZagrodaPlaceholder.astro — 45e1a63
- [x] 1.6 `bg-cosmic` nadal zdefiniowane; `/` i `/katalog` zwracają 200 — 45e1a63

#### Manual

- [x] 1.7 Nowy favicon w karcie przeglądarki — 45e1a63
- [x] 1.8 Nunito renderuje się z polskimi diakrytykami, bez FOIT — 45e1a63
- [x] 1.9 og-image.png czytelny (logomark + wordmark) — 45e1a63
- [x] 1.10 Kontrasty AA z komentarza w global.css spot-checked — 45e1a63
- [x] 1.11 Strony ciemne bez regresu po przekolorowaniu `:root` (spot-check /katalog, /auth/forgot-password) — 45e1a63

### Phase 2: Powierzchnie publiczne

#### Automated

- [x] 2.1 Build + lint przechodzą
- [x] 2.2 Grep starych idiomów w plikach publicznych nic nie zwraca
- [x] 2.3 Smoke e2e przechodzi: `npm run test:e2e -- e2e/smoke.spec.ts`

#### Manual

- [x] 2.4 Strony publiczne + 404 obejrzane na Pixel 5, czytelne jednoręcznie
- [x] 2.5 Ilustracja-placeholder zamiast emoji; jasne kontrolki filtrów
- [x] 2.6 Formularz rezerwacji działa end-to-end na dev
- [x] 2.7 Strony panelu/auth (ciemne) nadal działają

### Phase 3: Auth — restyle, pełna polonizacja i aktualizacja e2e

#### Automated

- [ ] 3.1 Build + lint przechodzą
- [ ] 3.2 Grep angielskich stringów startera w src/components/auth/ nic nie zwraca
- [ ] 3.3 Grep starych idiomów w plikach auth nic nie zwraca
- [ ] 3.4 Pełny lokalny e2e przechodzi: `npm run test:e2e`

#### Manual

- [ ] 3.5 Strony auth na Pixel 5: nowy motyw, całość po polsku
- [ ] 3.6 Logowanie + toggle hasła + polskie walidacje działają
- [ ] 3.7 Przyciski OAuth czytelne, brand-kolory nietknięte

### Phase 4: Panel właściciela

#### Automated

- [ ] 4.1 Build + lint przechodzą
- [ ] 4.2 Grep starych idiomów w plikach panelu nic nie zwraca
- [ ] 4.3 Pełny lokalny e2e przechodzi: `npm run test:e2e`

#### Manual

- [ ] 4.4 Strony panelu na Pixel 5 czytelne jednoręcznie, statusy rozróżnialne
- [ ] 4.5 Edycja profilu, upload zdjęcia, akceptacja/odrzucenie działają
- [ ] 4.6 Spot-check guardrailu < 15 s do decyzji

### Phase 5: Sprzątanie startera i spójność e-maili

#### Automated

- [ ] 5.1 Build + lint + vitest przechodzą
- [ ] 5.2 Globalny grep-gate motywu nic nie zwraca (wyjątek: brand-SVG OAuth)
- [ ] 5.3 Grep-gate `10x-astro-starter` w src/, public/, package.json nic nie zwraca
- [ ] 5.4 LibBadge.astro i template.png usunięte
- [ ] 5.5 Pełny lokalny e2e przechodzi: `npm run test:e2e`

#### Manual

- [ ] 5.6 E-mail testowy spójny z brandem w realnym kliencie poczty
- [ ] 5.7 Banner konfiguracyjny w palecie motywu
- [ ] 5.8 Finalny przegląd wszystkich stron (Pixel 5 + desktop)
- [ ] 5.9 OG-preview linku pokazuje nowy obraz i opis
