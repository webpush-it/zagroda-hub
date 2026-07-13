# Wspólny PageShell i spójny kontrakt szerokości RWD — Implementation Plan

## Overview

Wprowadzamy jeden współdzielony layout treści `src/components/PageShell.astro`, który zastępuje ręcznie rolowane per-strona powłoki (`bg-meadow min-h-screen p-4` + `mx-auto w-full max-w-*` + wklejany `<Topbar />`). Shell renderuje `Layout` wewnętrznie (forwarduje `title`/`description`), dostarcza wyśrodkowany, **parametryzowany** kontener szerokości z jednym responsywnym gutterem oraz warunkowy Topbar. Migrujemy wszystkie ~13 stron do tego jednego prymitywu, ustanawiając jeden spójny kontrakt szerokości: capy mobile-first z zachowawczym poszerzaniem na `lg`/`xl`.

## Current State Analysis

Stan potwierdzony w `context/changes/refactor-responsive-web-design/research.md`:

- **Brak wspólnego kontraktu szerokości.** `Layout.astro:39,56` to goła powłoka (`<body>` bez klas, goły `<slot/>`), `global.css:1,29-49` (Tailwind 4 CSS-first) nie definiuje `.container`, custom breakpointów ani tokenów szerokości.
- **Trzy szerokości w obiegu + dwa mechanizmy centrowania:** `max-w-4xl` (tylko `index.astro:33`), `max-w-md` (7 stron app, np. `dashboard.astro:48`), `max-w-sm` (5 stron auth przez flex-center, np. `signin.astro:10-11`).
- **Topbar duplikowany w 8 stronach** — wklejany bezpośrednio (`dashboard.astro:49`), czyta `Astro.locals.user` wewnętrznie (`Topbar.astro:5`).
- **Padding zawsze `p-*` (wszystkie boki), nigdy responsywny `px-*`;** poza Home płaskie `p-4` na każdym progu (`index.astro:32` jest jedynym z `sm:p-8`).
- **Guardrail z poprzedniego cyklu:** "jednokolumnowy `max-w-md` mobile-first zostaje" (`context/archive/2026-07-12-new-user-interface/plan.md:43`); polityka e2e single-device (Pixel 5 ~393px) opiera się o tę strukturę kontenera (`.../new-user-interface/research.md:98`). Wybór responsywnego poszerzania na `lg/xl` świadomie modyfikuje ten guardrail — patrz Open Risks.
- **Prior art do respektowania (nie ruszać):** `context/archive/2026-07-12-fix-mobile-ui-bugs/` — `tap-target` ≥44px (`global.css:232`), normalizacja date/time iOS (`global.css` `@layer base`), Topbar→drawer `<sm`, `e2e/mobile-320.spec.ts` (gate: brak overflow @320px, tap-target ≥44).

## Desired End State

Po ukończeniu:

- Istnieje `src/components/PageShell.astro` — jedyny właściciel powłoki treści (tło, `min-h-screen`, gutter, wyśrodkowany kontener szerokości, warunkowy Topbar), renderujący `Layout` wewnętrznie i forwardujący SEO.
- Każda z ~13 stron używa `<PageShell …>` jako jedynego wrappera; **żadna** nie roluje własnego `bg-meadow min-h-screen`/`mx-auto w-full max-w-*` ani nie importuje `Topbar` bezpośrednio.
- Jeden spójny kontrakt szerokości przez prop `width`: `narrow` (auth, `max-w-sm` stałe), `default` (app, `max-w-md lg:max-w-2xl`), `wide` (home, `max-w-4xl xl:max-w-6xl`); jeden gutter `px-4 py-4 sm:px-6 lg:px-8`.
- Auth używa wariantu `align="center"` bez Topbara; reszta `align="top"` z Topbarem.
- `e2e/mobile-320.spec.ts` nadal zielony; nowy scenariusz na szerokim viewport (~1280px) waliduje capy/wyśrodkowanie shella.

**Weryfikacja end-state:** `npm run lint && npm run build` przechodzą; `grep -rn "min-h-screen" src/pages` zwraca 0 trafień (powłoka żyje tylko w `src/components/PageShell.astro`); wizualnie każda strona identyczna @320/@393, poszerza się @lg; auth wyśrodkowane bez Topbara.

### Key Discoveries:

- `Topbar.astro:5` — `const { user } = Astro.locals;` → Topbar samodzielnie czyta usera; PageShell renderuje `<Topbar />` bez propsów (kontekst żądania współdzielony między komponentami Astro).
- `Layout.astro:6-14` — `Props { title?, description? }`, owner `<head>`/SEO/Banner; PageShell forwarduje te propsy przez `<Layout {title} {description}>`.
- `dashboard.astro:46-62` — kanoniczny wzorzec top-align (Layout → wrapper → Topbar → `<main class="card-surface">`).
- `signin.astro:9-23` — kanoniczny wzorzec auth (flex-center → `card-surface w-full max-w-sm`, bez Topbara).
- `cn()` z `@/lib/utils` (clsx + tailwind-merge) — konwencja łączenia klas (CLAUDE.md.scaffold); użyć do komponowania klasy width.
- Wszystkie capy (`max-w-sm/md/2xl/4xl/6xl`) to standardowe utility Tailwind — brak potrzeby zmian w `global.css`.

## What We're NOT Doing

- **Nie redesignujemy kart/`card-surface`** ani nie usuwamy potrójnego insetu (page gutter + `card-surface` 1.5rem + karty wewnętrzne) — poza zakresem.
- **Nie ujednolicamy progów gridów na Home** (`index.astro:74` `sm:grid-cols-3` vs `:90` `md:grid-cols-2`) — to osobny concern (gridy, nie szerokości).
- **Nie zmieniamy `Layout.astro`** poza tym, że staje się renderowany przez PageShell (żadnych zmian w `<head>`/SEO/Banner/viewport).
- **Nie ruszamy poprawek z `fix-mobile-ui-bugs`** (tap-target, normalizacja date/time, Topbar drawer, min-w-0/break-words sweep).
- **Nie poszerzamy kart auth** — `narrow` pozostaje stałe `max-w-sm` (czytelność formularza).
- Nie dotykamy `CancelRequest.tsx`/`BookingRequestForm.tsx` ani innych komponentów React — dziedziczą szerokość z kolumny strony.

## Implementation Approach

Budujemy prymityw najpierw i pilotujemy go na jednej stronie (Faza 1), by udowodnić dwa ryzykowne założenia end-to-end: (a) `<Topbar />` renderowany z wnętrza PageShell nadal poprawnie czyta `Astro.locals.user`, (b) forwardowanie SEO do Layout + slot passthrough działa w buildzie Cloudflare. Dopiero potem migrujemy resztę stron partiami wg wariantu (top-align app → home/auth), na końcu domykamy testami i grep-sweepem. Migracja jest czysto strukturalna (przenosimy klasy powłoki z każdej strony do jednego komponentu), więc każda faza jest niezależnie weryfikowalna wizualnie względem stanu sprzed zmiany.

## Critical Implementation Details

- **Topbar musi pozostać komponentem Astro renderowanym przez PageShell.** Wyspy React nie mają dostępu do `Astro.locals` (`fix-mobile-ui-bugs/plan.md:47`); `<Topbar />` w PageShell działa tylko dlatego, że jest `.astro` w kontekście żądania. Nie zamieniać na island.
- **Wariant `center` nie renderuje Topbara i wyśrodkowuje w pionie** — outer to `flex min-h-screen items-center justify-center`, więc wewnętrzny kontener `w-full max-w-*` jest wyśrodkowany w obu osiach. `mx-auto` jest wtedy no-opem (nieszkodliwym).
- **Kolejność migracji jest niezależna per strona**, ale Faza 1 (pilot) MUSI przejść manualną weryfikację Topbara zanim ruszą Fazy 2-3 — inaczej błąd w kontrakcie Topbara rozlałby się na 8 stron.

## Phase 1: Build PageShell + pilot (dashboard)

### Overview

Stworzyć `PageShell.astro` z pełnym API wariantów i zmigrować `dashboard.astro` jako pilota, dowodząc kontraktu Topbara i buildu.

### Changes Required:

#### 1. Nowy komponent współdzielonej powłoki

**File**: `src/components/PageShell.astro`

**Intent**: Jedyny właściciel powłoki treści — tło `bg-meadow`, `min-h-screen`, responsywny gutter, wyśrodkowany parametryzowany kontener szerokości, warunkowy `<Topbar />` — renderujący `Layout` wewnętrznie i forwardujący SEO. Realizuje "wspólny główny layout podstron".

**Contract**: Props (rozszerza propsy Layout):
- `title?: string`, `description?: string` — forwardowane do `Layout`.
- `width?: "narrow" | "default" | "wide"` = `"default"` → mapa klas: `narrow: "max-w-sm"`, `default: "max-w-md lg:max-w-2xl"`, `wide: "max-w-4xl xl:max-w-6xl"`.
- `align?: "top" | "center"` = `"top"`.
- `showTopbar?: boolean` = `true`.

Struktura renderu (klasy przez `cn()` z `@/lib/utils`):

```astro
---
import Layout from "@/layouts/Layout.astro";
import Topbar from "@/components/Topbar.astro";
import { cn } from "@/lib/utils";

interface Props {
  title?: string;
  description?: string;
  width?: "narrow" | "default" | "wide";
  align?: "top" | "center";
  showTopbar?: boolean;
}
const { title, description, width = "default", align = "top", showTopbar = true } = Astro.props;

const widthClass = { narrow: "max-w-sm", default: "max-w-md lg:max-w-2xl", wide: "max-w-4xl xl:max-w-6xl" }[width];
const outer = cn(
  "bg-meadow min-h-screen px-4 py-4 sm:px-6 lg:px-8",
  align === "center" && "flex items-center justify-center",
);
---

<Layout {title} {description}>
  <div class={outer}>
    <div class={cn("mx-auto w-full", widthClass)}>
      {showTopbar && <Topbar />}
      <slot />
    </div>
  </div>
</Layout>
```

#### 2. Pilot: migracja panelu

**File**: `src/pages/dashboard.astro`

**Intent**: Zastąpić ręczny wrapper + import Topbara jednym `<PageShell>`, dowodząc że Topbar czyta locals z wnętrza shella. Cała logika data-fetch (`:7-43`) bez zmian.

**Contract**: Usunąć importy `Layout` i `Topbar`; dodać import `PageShell`. Zamienić `<Layout title="Panel zagrody"><div class="bg-meadow min-h-screen p-4"><div class="mx-auto w-full max-w-md"><Topbar />…</Layout>` na `<PageShell title="Panel zagrody">…<main class="card-surface">…</main></PageShell>` (width domyślny `default`, Topbar domyślnie wł.). `<main class="card-surface">` i jego zawartość bez zmian.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking + lint: `npm run lint`
- [ ] Build przechodzi (adapter Cloudflare): `npm run build`
- [ ] `astro check` bez błędów typów Props PageShell

#### Manual Verification:

- [ ] `/dashboard` renderuje Topbar poprawnie dla zalogowanego usera (linki Panel/Zapytania) i dla gościa (Zaloguj/Zarejestruj) — dowód, że `Astro.locals.user` działa z wnętrza PageShell
- [ ] Layout wizualnie identyczny @320px i @393px vs stan sprzed zmiany (brak horizontal scroll, `card-surface` bez zmian)
- [ ] @≥1024px (lg) kolumna poszerza się do `max-w-2xl`, pozostaje wyśrodkowana
- [ ] Banner konfiguracyjny (jeśli `missingConfigs`) nadal renderuje się nad treścią

**Implementation Note**: Po tej fazie i przejściu automated verification — **pauza na manualne potwierdzenie** (szczególnie kontrakt Topbara) przed Fazą 2.

---

## Phase 2: Migracja stron top-align (app)

### Overview

Zmigrować pozostałe strony z Topbarem/top-align do `PageShell` (width `default`), usuwając ręczne powłoki i inline Topbar.

### Changes Required:

#### 1. Strony katalogu i szczegółów

**File**: `src/pages/katalog.astro`, `src/pages/zagrody/[id].astro`

**Intent**: Zamienić ręczny wrapper + `<Topbar />` na `<PageShell title=…>`; zawartość `<main class="card-surface">` i logika bez zmian.

**Contract**: Usunąć importy `Layout`/`Topbar`, dodać `PageShell`. `width="default"`. Zachować wewnętrzne struktury (filtr `flex-col sm:flex-row` w `katalog.astro:146`, sekcje w `[id].astro`).

#### 2. Strony pomocnicze

**File**: `src/pages/anuluj.astro`, `src/pages/404.astro`

**Intent**: Ta sama migracja do `PageShell` (`width="default"`).

**Contract**: Usunąć ręczne wrappery/Topbar-import (jeśli obecny), owinąć treść `<PageShell>`. `404.astro` zachowuje `text-center` i `max-w-xs` obrazka wewnątrz slotu.

#### 3. Strony zapytań (dashboard)

**File**: `src/pages/dashboard/zapytania/index.astro`, `src/pages/dashboard/zapytania/[id].astro`

**Intent**: Migracja do `PageShell` (`width="default"`); cała logika data-fetch i komponenty React (`RequestsList`, `RequestDecision`) bez zmian.

**Contract**: Usunąć importy `Layout`/`Topbar`, dodać `PageShell`. Zachować `<main class="card-surface">` i zawartość.

### Success Criteria:

#### Automated Verification:

- [ ] Lint: `npm run lint`
- [ ] Build: `npm run build`
- [ ] `grep -rn "import Topbar" src/pages` nie zwraca żadnej z tych 6 stron
- [ ] `grep -rn "min-h-screen\|max-w-md" src/pages/katalog.astro src/pages/zagrody src/pages/anuluj.astro src/pages/404.astro src/pages/dashboard/zapytania` — brak trafień (powłoka przeniesiona do shella)

#### Manual Verification:

- [ ] Każda z 6 stron renderuje Topbar i treść identycznie @320/@393 vs przed zmianą
- [ ] Katalog: filtr i lista wyników bez regresji; karty `ZagrodaCard` bez zmian
- [ ] Szczegóły zagrody: formularz rezerwacji działa, brak overflow @320
- [ ] @≥1024px kolumny poszerzają się spójnie do `max-w-2xl`

**Implementation Note**: Pauza na manualne potwierdzenie przed Fazą 3.

---

## Phase 3: Migracja Home (wide) + Auth (narrow/center)

### Overview

Zmigrować stronę główną (wariant `wide`) i strony auth (wariant `narrow` + `center`, bez Topbara).

### Changes Required:

#### 1. Strona główna

**File**: `src/pages/index.astro`

**Intent**: Zamienić wrapper `bg-meadow min-h-screen p-4 sm:p-8` + `max-w-4xl` + `<Topbar />` na `<PageShell width="wide">`. Sekcje (hero, gridy) i wewnętrzne `max-w-2xl` bloki tekstu zostają w slocie.

**Contract**: Usunąć importy `Layout`/`Topbar`, dodać `PageShell` z `width="wide"`. Zachować `index.astro` sekcje `:37` (hero `px-2`), teksty `max-w-2xl` (`:39,:42`), gridy (`:74,:90`) — bez zmian (progi gridów są explicite poza zakresem).

#### 2. Strony auth

**File**: `src/pages/auth/signin.astro`, `signup.astro`, `forgot-password.astro`, `reset-password.astro`, `confirm-email.astro`

**Intent**: Zamienić flex-center wrapper + `card-surface max-w-sm` na `<PageShell width="narrow" align="center" showTopbar={false}>`, ze slotem = zawartość karty.

**Contract**: Usunąć import `Layout`, dodać `PageShell`. Auth nie ma Topbara (`showTopbar={false}`). Slot zawiera `<div class="card-surface">…</div>` (lub `card-surface w-full` — kontener shella daje `w-full max-w-sm`, więc karta wypełnia kolumnę). `confirm-email.astro` zachowuje `text-center`. Zachować przekazywanie `error`/searchParams i wyspy (`SignInForm`, `OAuthButtons` itd.).

### Success Criteria:

#### Automated Verification:

- [ ] Lint: `npm run lint`
- [ ] Build: `npm run build`
- [ ] `grep -rn "import Layout\|import Topbar" src/pages/index.astro src/pages/auth` — brak trafień (wszystko przez PageShell)
- [ ] `grep -rn "min-h-screen" src/pages` — brak trafień (tylko `PageShell.astro`)

#### Manual Verification:

- [ ] Home: Topbar + hero + gridy renderują się jak przed zmianą @320/@393; @≥1280px kolumna poszerza się do `max-w-6xl`, treść wyśrodkowana
- [ ] Auth (wszystkie 5): karta wyśrodkowana w pionie i poziomie, `max-w-sm`, **bez Topbara**; formularze i OAuth działają; @320 brak overflow
- [ ] Banner błędu (missingConfigs) nadal nad treścią na home i auth

**Implementation Note**: Pauza na manualne potwierdzenie przed Fazą 4.

---

## Phase 4: E2E + consistency sweep

### Overview

Utrzymać istniejący gate mobilny, dodać pokrycie desktopowego kontraktu szerokości, domknąć grep-sweepem.

### Changes Required:

#### 1. Utrzymanie mobile-320

**File**: `e2e/mobile-320.spec.ts`

**Intent**: Upewnić się, że gate @320px przechodzi po migracji; dostosować selektory tylko jeśli zmiana struktury wrappera je złamała (locatory oparte o role/text nie powinny się zmienić).

**Contract**: Bez zmian w asercjach (brak overflow, tap-target ≥44). Ewentualne poprawki selektorów, jeśli wskazują na usunięty wrapper.

#### 2. Nowy scenariusz desktop-wide

**File**: `e2e/desktop-width.spec.ts` (nowy)

**Intent**: Zwalidować nowy, poszerzany kontrakt szerokości na szerokim viewport (~1280px) — złagodzenie osłabionego uzasadnienia single-device.

**Contract**: Nowy spec Playwright, viewport 1280×800. Dla reprezentatywnych stron (np. `/dashboard` jako `default`, `/` jako `wide`, `/auth/signin` jako `narrow/center`): brak horizontal overflow; kontener treści wyśrodkowany (marginesy lewy≈prawy w granicach tolerancji); szerokość kontenera nie przekracza capa wariantu. Locatory wg konwencji `/10x-e2e` (role/text), bez `waitForTimeout`, z unikalnymi ID gdzie potrzebne. Test niezależny (własny setup/teardown).

#### 3. Consistency sweep

**File**: (weryfikacja, bez nowego kodu)

**Intent**: Potwierdzić, że migracja jest kompletna i żadna strona nie roluje własnej powłoki.

**Contract**: `grep` potwierdza: brak `min-h-screen`/`bg-meadow`/`mx-auto w-full max-w-*` w `src/pages/**`; brak `import Topbar`/`import Layout` w stronach; jedyne wystąpienia w `PageShell.astro`.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:e2e` — `mobile-320.spec.ts` zielony
- [ ] `npm run test:e2e` — `desktop-width.spec.ts` zielony
- [ ] Pełny `npm run test:e2e` zielony (critical-flow, smoke, idor-contact-data włącznie) — brak regresji nawigacji po migracji powłoki
- [ ] `grep -rn "min-h-screen" src/pages` — 0 trafień
- [ ] `grep -rnE "import (Layout|Topbar)" src/pages` — 0 trafień
- [ ] Lint + build: `npm run lint && npm run build`

#### Manual Verification:

- [ ] Przegląd wszystkich ~13 stron @320 / @768 / @1280 — spójne szerokości i gutter, brak wizualnych regresji vs baseline
- [ ] Topbar obecny wszędzie poza auth; auth wyśrodkowane bez Topbara
- [ ] Poszerzanie na lg/xl działa dla `default`/`wide`, `narrow` pozostaje stałe

**Implementation Note**: Po tej fazie zmiana jest kompletna; pauza na finalne manualne potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- Brak dedykowanych unitów (komponent czysto prezentacyjny). Kontrakt Props weryfikowany przez `astro check`/TS.

### Integration Tests:

- Build SSR przez adapter Cloudflare (`npm run build`) jako integracja renderu wszystkich stron przez PageShell.

### Manual Testing Steps:

1. Dla każdej fazy: otwórz zmigrowane strony @320px (DevTools) — brak horizontal scroll, `card-surface`/formularze bez regresji.
2. @1024px i @1280px — kolumny poszerzają się zgodnie z rampą, treść wyśrodkowana, gutter rośnie (`sm:px-6 lg:px-8`).
3. Topbar: zalogowany vs gość na dowolnej stronie app (dowód czytania `Astro.locals.user`).
4. Auth: wyśrodkowanie w pionie, brak Topbara, działające formularze/OAuth.
5. Cross-browser @320 (Chrome + Firefox) dla stron z natywnymi inputami (katalog, TurnusyEditor) — zgodnie z lekcją z `fix-mobile-ui-bugs`.

## Performance Considerations

Zmiana czysto strukturalna (te same klasy Tailwind przeniesione do jednego komponentu). Brak wpływu na payload wysp React (Topbar pozostaje `.astro`, drawer `client:idle` bez zmian). Tailwind 4 tree-shaking niezmieniony — capy to standardowe utility.

## Migration Notes

Brak migracji danych. Migracja kodu strona-po-stronie; każda faza niezależnie buildowalna i wizualnie weryfikowalna względem baseline (poprzedni commit). Rollback = revert commitu danej fazy; PageShell bez zależności runtime poza Layout/Topbar.

## References

- Related research: `context/changes/refactor-responsive-web-design/research.md`
- Guardrail szerokości: `context/archive/2026-07-12-new-user-interface/plan.md:43`
- Polityka e2e single-device: `context/archive/2026-07-12-new-user-interface/research.md:98`; `context/archive/2026-06-14-testing-e2e-critical-flow-mobile/plan.md:56`
- Gate mobilny + lekcje iOS/Tailwind4: `context/archive/2026-07-12-fix-mobile-ui-bugs/plan.md`, `e2e/mobile-320.spec.ts`
- Wzorce: `src/layouts/Layout.astro:6-14` (Props/SEO), `src/components/Topbar.astro:5` (locals), `src/pages/dashboard.astro:46-62` (top-align), `src/pages/auth/signin.astro:9-23` (center)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Build PageShell + pilot (dashboard)

#### Automated

- [x] 1.1 Type checking + lint: `npm run lint` — 9fa13d5
- [x] 1.2 Build przechodzi (adapter Cloudflare): `npm run build` — 9fa13d5
- [x] 1.3 `astro check` bez błędów typów Props PageShell — 9fa13d5

#### Manual

- [x] 1.4 `/dashboard` renderuje Topbar poprawnie dla zalogowanego i gościa (dowód `Astro.locals.user` z wnętrza PageShell) — 9fa13d5
- [x] 1.5 Layout identyczny @320/@393 vs baseline (brak overflow, `card-surface` bez zmian) — 9fa13d5
- [x] 1.6 @≥1024px kolumna poszerza się do `max-w-2xl`, wyśrodkowana — 9fa13d5
- [x] 1.7 Banner konfiguracyjny nadal nad treścią — 9fa13d5

### Phase 2: Migracja stron top-align (app)

#### Automated

- [x] 2.1 Lint: `npm run lint` — 83abec3
- [x] 2.2 Build: `npm run build` — 83abec3
- [x] 2.3 `grep -rn "import Topbar" src/pages` nie zwraca tych 6 stron — 83abec3
- [x] 2.4 `grep` braku `min-h-screen`/`max-w-md` w zmigrowanych stronach — 83abec3

#### Manual

- [x] 2.5 6 stron renderuje Topbar i treść identycznie @320/@393 vs baseline — 83abec3
- [x] 2.6 Katalog: filtr/lista/karty bez regresji — 83abec3
- [x] 2.7 Szczegóły zagrody: formularz rezerwacji działa, brak overflow @320 — 83abec3
- [x] 2.8 @≥1024px kolumny poszerzają się spójnie do `max-w-2xl` — 83abec3

### Phase 3: Migracja Home (wide) + Auth (narrow/center)

#### Automated

- [x] 3.1 Lint: `npm run lint` — 08bb569
- [x] 3.2 Build: `npm run build` — 08bb569
- [x] 3.3 `grep` braku `import Layout`/`import Topbar` w `index.astro` i `src/pages/auth` — 08bb569
- [x] 3.4 `grep -rn "min-h-screen" src/pages` — brak trafień — 08bb569

#### Manual

- [x] 3.5 Home: Topbar/hero/gridy jak przed zmianą @320/@393; @≥1280px poszerza się do `max-w-6xl` — 08bb569
- [x] 3.6 Auth ×5: karta wyśrodkowana, `max-w-sm`, bez Topbara; formularze/OAuth działają; @320 brak overflow — 08bb569
- [x] 3.7 Banner błędu nadal nad treścią na home i auth — 08bb569

### Phase 4: E2E + consistency sweep

#### Automated

- [x] 4.1 `npm run test:e2e` — `mobile-320.spec.ts` zielony
- [x] 4.2 `npm run test:e2e` — `desktop-width.spec.ts` zielony
- [x] 4.3 Pełny `npm run test:e2e` zielony (critical-flow, smoke, idor-contact-data włącznie)
- [x] 4.4 `grep -rn "min-h-screen" src/pages` — 0 trafień
- [x] 4.5 `grep -rnE "import (Layout|Topbar)" src/pages` — 0 trafień
- [x] 4.6 Lint + build: `npm run lint && npm run build`

#### Manual

- [x] 4.7 Przegląd ~13 stron @320/@768/@1280 — spójne szerokości/gutter, brak regresji
- [x] 4.8 Topbar wszędzie poza auth; auth wyśrodkowane bez Topbara
- [x] 4.9 Poszerzanie lg/xl dla `default`/`wide`, `narrow` stałe
