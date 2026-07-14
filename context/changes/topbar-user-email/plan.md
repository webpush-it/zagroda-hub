# Przywrócenie e-maila zalogowanego użytkownika w Topbarze — Implementation Plan

## Overview

Przywracamy widoczność adresu e-mail zalogowanego użytkownika w Topbarze. Element ten istniał od initu (`1b18c06`) jako `<span>{user.email}</span>`, ale wypadł przy migracji UI na motyw „Łąka i miód" (`6c29252`, 2026-07-12) i nie został przywrócony w późniejszych zmianach Topbara (`d2310f7` hamburger/drawer) ani w refaktorze szerokości RWD. Cel jest czysto UX/informacyjny: użytkownik ma widzieć, na jakie konto jest zalogowany — na desktopie (pasek inline) i na mobile (nagłówek drawera). Bez zmian w auth, danych czy API — `user` jest już na `Astro.locals`.

## Current State Analysis

- `src/components/Topbar.astro` — czyta `const { user } = Astro.locals;`, buduje `links` (inne dla gościa i zalogowanego) i `signOutAction = user ? "/api/auth/signout" : undefined`. Renderuje: (a) brand-link z logo po lewej, (b) desktopową grupę `<div class="hidden items-center gap-4 sm:flex">` z linkami + formularzem „Wyloguj", (c) wyspę `<TopbarMobileMenu client:idle links={links} signOutAction={signOutAction} />` (widoczną `<sm`). **Nigdzie nie renderuje `user.email`.**
- `src/components/TopbarMobileMenu.tsx` — wyspa React (`client:idle`), props `{ links: NavLink[]; signOutAction?: string }`. Drawer ma nagłówek z przyciskiem zamknięcia (`div.mb-2.flex.justify-end`), potem listę linków, potem opcjonalny formularz „Wyloguj". **Brak propa/renderu e-maila.**
- `src/env.d.ts:3` — `App.Locals.user: import("@supabase/supabase-js").User | null`. Typ Supabase `User` ma `email?: string` — **`email` może być `undefined`** (np. część OAuth), więc render musi być warunkowy.
- Topbar pojawia się tylko tam, gdzie `showTopbar` (domyślnie `true`); 5 stron auth ustawia `showTopbar={false}`. Zalogowany użytkownik widzi Topbar na stronach aplikacji (`/dashboard`, `/katalog`, `/` itd.).
- `src/middleware.ts:13` — `context.locals.user` ustawiany z sesji Supabase; guard chronionych tras już istnieje.
- E2E: seed helpers w `e2e/helpers/seed.ts` (`createConfirmedOwner(email, password)`, `uniqueEmail(prefix)`); wzorzec logowania przez UI w `critical-flow.spec.ts:92-100` (`/auth/signin` → `getByLabel("E-mail")`/`Hasło` → `getByRole("button", { name: "Zaloguj się" })` → `waitForURL("**/dashboard")`).

## Desired End State

Po ukończeniu:

- Zalogowany użytkownik na dowolnej stronie z Topbarem widzi swój e-mail:
  - **Desktop (`≥sm`)**: wyszarzony (`text-ink-muted`), skrócony przy przepełnieniu, umieszczony w prawej grupie tuż **przed** przyciskiem „Wyloguj".
  - **Mobile (`<sm`)**: w nagłówku otwartego drawera (nad listą linków / przy akcji „Wyloguj").
- Gdy `user.email` jest `undefined` — element e-maila **nie jest renderowany** (reszta paska bez zmian); brak pustego/mylącego tekstu.
- Gość (niezalogowany) — bez zmian (żaden e-mail, żaden fallback).
- Brak regresji istniejących gate'ów (`mobile-320`, `desktop-width`, critical-flow, smoke, idor); nowy lekki test e2e potwierdza, że e-mail zalogowanego usera jest widoczny na stronie z Topbarem.

**Weryfikacja end-state:** `npm run lint && npm run build` przechodzą; `astro check` bez błędów; zalogowany user @1280 widzi e-mail przy „Wyloguj"; @320 e-mail widoczny w otwartym drawerze; długi e-mail nie powoduje horizontal scroll @320; gość nie widzi e-maila.

### Key Discoveries:

- `Topbar.astro` (desktopowa grupa `hidden … sm:flex`) — miejsce wstrzyknięcia e-maila: pierwszy element przed mapą linków lub tuż przed formularzem „Wyloguj"; wybór: **przed „Wyloguj"** (powiązanie konto→wyloguj).
- `TopbarMobileMenu.tsx:9-13` — interfejs `Props` do rozszerzenia o `userEmail?: string`; nagłówek drawera (`div.mb-2.flex.justify-end`, linie 110-119) to miejsce na e-mail.
- `src/env.d.ts:3` — `email` jest opcjonalny; render warunkowy `{user.email && …}` / `userEmail ?` wymagany, by uniknąć pustego węzła i błędu typów.
- `e2e/critical-flow.spec.ts:92-100` + `e2e/helpers/seed.ts` — gotowy wzorzec seed+login przez UI dla testu guard.
- `Topbar.astro` używa `min-w-0` na kontenerze — potrzebny `truncate` + `max-w-*` na e-mailu, by długi adres nie rozpychał paska (spójne z fix-mobile-ui-bugs `min-w-0/break-words`).

## What We're NOT Doing

- **Nie dodajemy menu konta / dropdownu** — e-mail to statyczny tekst, nie rozwijane menu.
- **Nie zmieniamy `links` ani logiki `signOutAction`** — e-mail jest dodatkiem obok istniejącej nawigacji.
- **Nie pokazujemy niczego gościowi** — brak „Niezalogowany"/fallbacku (świadomie usunięte w `6c29252`, zostaje usunięte).
- **Nie ruszamy** `middleware.ts`, auth, `PageShell.astro`, `Layout.astro`, stron auth (`showTopbar={false}`).
- **Nie zmieniamy** focus-trapa/scroll-locka/klawiatury w drawerze — dokładamy tylko element wizualny w nagłówku.
- **Nie parametryzujemy** wariantów wyświetlania (skrót vs pełny itd.) — YAGNI.

## Implementation Approach

Dwie fazy. Faza 1: jedna edycja w `Topbar.astro` (desktopowy e-mail przy „Wyloguj") + rozszerzenie propsów `TopbarMobileMenu` o `userEmail` i render w nagłówku drawera; oba renderowane warunkowo (email zdefiniowany + user zalogowany). Faza 2: lekki test e2e (seed + login przez UI → asercja widoczności e-maila na stronie z Topbarem) i przebieg pełnych gate'ów. Ryzyko skupione na @320 (długi e-mail → overflow) — mitigowane `truncate`/`max-w` i istniejącym gate'em `mobile-320`.

## Phase 1: E-mail w Topbarze (desktop + drawer)

### Overview

Dodać wyszarzony e-mail zalogowanego użytkownika do desktopowego paska (przy „Wyloguj") oraz do nagłówka drawera mobilnego.

### Changes Required:

#### 1. Desktopowy e-mail w pasku

**File**: `src/components/Topbar.astro`

**Intent**: Pokazać e-mail zalogowanego użytkownika w desktopowej grupie (`hidden … sm:flex`), wyszarzony i powiązany wizualnie z akcją „Wyloguj". Render tylko gdy `user` istnieje i ma `email` — inaczej pasek bez zmian.

**Contract**: W desktopowej grupie, **przed** blokiem `{signOutAction && …}` (formularz „Wyloguj"), dodać warunkowy węzeł `{user?.email && <span>…{user.email}…</span>}`. Klasy: `text-ink-muted` (wyszarzenie), `max-w-[12rem] truncate` (ochrona szerokości; kontener ma już `min-w-0`), dopasowane do `text-sm` paska. Dać `title={user.email}` dla pełnego adresu w tooltipie po skróceniu. Nie zmieniać `links`, `navLink`, `signOutAction` ani struktury `justify-between`.

#### 2. E-mail w nagłówku drawera mobilnego

**File**: `src/components/TopbarMobileMenu.tsx`

**Intent**: Przekazać e-mail do wyspy i pokazać go w nagłówku otwartego drawera, aby użytkownik na mobile widział, na jakie konto jest zalogowany. Render warunkowy — brak e-maila = brak elementu.

**Contract**: Rozszerzyć `interface Props` o `userEmail?: string`. W nagłówku drawera (obecny `div.mb-2.flex.justify-end` z przyciskiem zamknięcia, linie ~110-119) dodać — gdy `userEmail` jest zdefiniowany — element z e-mailem (np. zmienić układ nagłówka na `justify-between`: e-mail po lewej, „X" po prawej; e-mail `text-ink-muted text-sm truncate` z `max-w`, `title={userEmail}`). Nie zmieniać focus-trapa (selektor `a[href], button` pozostaje poprawny — `<span>`/`<p>` nie łapią fokusa), scroll-locka ani logiki `close()`.

#### 3. Przekazanie e-maila do wyspy

**File**: `src/components/Topbar.astro`

**Intent**: Zasilić nowy prop `userEmail` wyspy `TopbarMobileMenu` wartością z `Astro.locals.user`.

**Contract**: Zmienić `<TopbarMobileMenu client:idle links={links} signOutAction={signOutAction} />` na dodatkowo `userEmail={user?.email}`. Przekazujemy `undefined` gdy brak — wyspa sama pomija render. Bez innych zmian.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking + lint: `npm run lint`
- [ ] `astro check` — brak błędów typów (nowy prop `userEmail`, opcjonalny `email`)
- [ ] Build przechodzi (adapter Cloudflare): `npm run build`
- [ ] `grep -c "user?.email\|user.email" src/components/Topbar.astro` ≥ 1 (e-mail renderowany + przekazany do wyspy)

#### Manual Verification:

- [ ] Zalogowany user @1280 widzi swój e-mail (wyszarzony) tuż przed „Wyloguj"; długi e-mail jest skrócony (truncate), tooltip pokazuje pełny
- [ ] Zalogowany user @320: po otwarciu drawera e-mail widoczny w nagłówku; brak horizontal scroll
- [ ] Gość (niezalogowany) @1280 i @320 — brak e-maila, brak pustego elementu; nawigacja bez zmian
- [ ] Drawer nadal działa: Escape/klik w tło/wybór linku zamyka, focus wraca na hamburger

**Implementation Note**: Po tej fazie i przejściu automated verification — pauza na manualne potwierdzenie (szczególnie @320 overflow i wariant gościa) przed Fazą 2.

---

## Phase 2: E2E guard + weryfikacja

### Overview

Dołożyć lekki test e2e chroniący widoczność e-maila zalogowanego usera na stronie z Topbarem i potwierdzić brak regresji istniejących gate'ów.

### Changes Required:

#### 1. Asercja widoczności e-maila po zalogowaniu

**File**: nowy `e2e/topbar-user-email.spec.ts` (lub rozszerzenie istniejącego, jeśli czytelniej)

**Intent**: Zablokować dokładnie tę regresję, która już raz się zdarzyła (e-mail wypadł przy restyle): po zalogowaniu prawdziwego użytkownika jego e-mail musi być widoczny w Topbarze na stronie aplikacji.

**Contract**: Seed przez `createConfirmedOwner(uniqueEmail("user"), PASSWORD)` z `e2e/helpers/seed.ts`; logowanie przez UI wzorem `critical-flow.spec.ts:92-100` (`/auth/signin` → `getByLabel("E-mail", { exact: true })` / `getByLabel("Hasło", { exact: true })` → `getByRole("button", { name: "Zaloguj się" })` → `waitForURL("**/dashboard")`). Asercja: `await expect(page.getByText(seededEmail)).toBeVisible()` na `/dashboard` (strona z Topbarem). Locatory wg konwencji `/10x-e2e` (role/label/text), bez `waitForTimeout`, test niezależny (unikatowy e-mail z sufiksem). Domyślny viewport projektu to Pixel 5 (~393px, `<sm`) — e-mail żyje wtedy w drawerze; test albo (a) otwiera drawer (`getByRole("button", { name: "Menu nawigacji" })` → hydratacja jak w `mobile-320.spec.ts` → klik) i asertuje w `dialog`, albo (b) wymusza desktopowy viewport (`page.setViewportSize({ width: 1280, height: 800 })`) i asertuje inline. **Wybrać wariant (b)** jako prostszy i deterministyczny (bez zależności od hydratacji wyspy), z komentarzem uzasadniającym.

#### 2. Utrzymanie istniejących gate'ów

**File**: (weryfikacja, bez nowego kodu) `e2e/mobile-320.spec.ts`, `e2e/desktop-width.spec.ts`

**Intent**: Potwierdzić, że dodanie e-maila nie łamie @320 (overflow) ani kontraktu szerokości.

**Contract**: Pełny `npm run test:e2e` zielony; `mobile-320` bez zmian asercji (e-mail niesie `truncate`/`max-w`, nie rozpycha paska; drawer mierzony na tap-target bez kolizji).

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:e2e` — nowy test widoczności e-maila zielony
- [ ] `npm run test:e2e` — `mobile-320.spec.ts` zielony (bez zmian asercji)
- [ ] `npm run test:e2e` — `desktop-width.spec.ts` zielony (geometria bez regresji)
- [ ] Pełny `npm run test:e2e` zielony (critical-flow, smoke, idor-contact-data włącznie)
- [ ] Lint + build: `npm run lint && npm run build`

#### Manual Verification:

- [ ] Zalogowany user: e-mail widoczny @1280 (inline) i @320 (drawer); gość — brak
- [ ] Brak horizontal scroll @320 z długim e-mailem

**Implementation Note**: Po tej fazie zmiana jest kompletna; pauza na finalne manualne potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- Brak dedykowanych unitów (zmiana prezentacyjna; kontrakt propsów weryfikowany przez `astro check`/TS).

### Integration Tests:

- Build SSR przez adapter Cloudflare (`npm run build`) jako integracja renderu Topbara z e-mailem.

### Manual Testing Steps:

1. Zaloguj się; `/dashboard` @1280 — e-mail wyszarzony przy „Wyloguj"; sprawdź truncate na długim adresie (tooltip = pełny).
2. `/dashboard` @320 — otwórz drawer (hamburger); e-mail w nagłówku; brak horizontal scroll; Escape/tło/link zamykają.
3. Wyloguj się; `/katalog` @1280 i @320 — brak e-maila, nawigacja gościa bez zmian.
4. (Edge) konto bez e-maila (jeśli dostępne) — brak elementu e-maila, brak błędu.

## Performance Considerations

Zmiana czysto prezentacyjna — jeden `<span>` na desktopie i jeden element w drawerze; `userEmail` to string już obecny w `Astro.locals`. Bez wpływu na hydratację (prop skalarny) i bez dodatkowych zapytań.

## Migration Notes

Brak migracji danych. Rollback = revert commitu. Zmiana addytywna i warunkowa (tylko dla zalogowanych z e-mailem), więc nie wpływa na gościa ani strony bez Topbara.

## References

- Historia zniknięcia: commit `6c29252` (`feat(new-user-interface): Powierzchnie publiczne (p2)`), pierwotny render od `1b18c06`
- Komponenty: `src/components/Topbar.astro`, `src/components/TopbarMobileMenu.tsx`
- Typ usera: `src/env.d.ts:3` (`App.Locals.user`)
- Wzorzec e2e seed+login: `e2e/critical-flow.spec.ts:92-100`, `e2e/helpers/seed.ts`
- Gate'y e2e: `e2e/mobile-320.spec.ts`, `e2e/desktop-width.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: E-mail w Topbarze (desktop + drawer)

#### Automated

- [x] 1.1 Type checking + lint: `npm run lint` — 9735b65
- [x] 1.2 `astro check` — brak błędów typów (nowy prop `userEmail`, opcjonalny `email`) — 9735b65
- [x] 1.3 Build przechodzi (adapter Cloudflare): `npm run build` — 9735b65
- [x] 1.4 `grep -c "user?.email\|user.email" src/components/Topbar.astro` ≥ 1 — 9735b65

#### Manual

- [x] 1.5 Zalogowany @1280 widzi e-mail (wyszarzony) przy „Wyloguj"; długi e-mail skrócony + tooltip — 9735b65
- [x] 1.6 Zalogowany @320: e-mail w nagłówku drawera; brak horizontal scroll — 9735b65
- [x] 1.7 Gość @1280/@320 — brak e-maila, nawigacja bez zmian — 9735b65
- [x] 1.8 Drawer nadal działa (Escape/tło/link zamyka, focus wraca na hamburger) — 9735b65

### Phase 2: E2E guard + weryfikacja

#### Automated

- [x] 2.1 `npm run test:e2e` — nowy test widoczności e-maila zielony
- [x] 2.2 `npm run test:e2e` — `mobile-320.spec.ts` zielony
- [x] 2.3 `npm run test:e2e` — `desktop-width.spec.ts` zielony
- [x] 2.4 Pełny `npm run test:e2e` zielony (critical-flow, smoke, idor-contact-data)
- [x] 2.5 Lint + build: `npm run lint && npm run build`

#### Manual

- [x] 2.6 Zalogowany: e-mail @1280 (inline) i @320 (drawer); gość — brak
- [x] 2.7 Brak horizontal scroll @320 z długim e-mailem
