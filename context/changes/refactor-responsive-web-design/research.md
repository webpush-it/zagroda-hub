---
date: 2026-07-13T23:07:24+0200
researcher: Konrad Beśka
git_commit: e19d81d0af9c3c0434c06fa2aa7e6c22cc35a436
branch: master
repository: webpush-it/zagroda-hub
topic: "Niekonsekwentne szerokości w progach RWD i kandydat na wspólny layout podstron"
tags: [research, codebase, rwd, layout, tailwind, responsive, containers]
status: complete
last_updated: 2026-07-13
last_updated_by: Konrad Beśka
---

# Research: Niekonsekwentne szerokości RWD i wspólny layout podstron

**Date**: 2026-07-13T23:07:24+0200
**Researcher**: Konrad Beśka
**Git Commit**: e19d81d0af9c3c0434c06fa2aa7e6c22cc35a436
**Branch**: master
**Repository**: webpush-it/zagroda-hub

## Research Question

Przeanalizować niekonsekwentne szerokości treści w kolejnych progach RWD na kolejnych
odsłonach (wszystkie ~13 stron `.astro`) i naszkicować propozycję **wspólnego, głównego
layoutu** wykorzystywanego na kolejnych podstronach — do decyzji w fazie planowania.

## Summary

**Nie istnieje żaden wspólny kontrakt szerokości.** `src/layouts/Layout.astro` to goła
powłoka (`<html><body><slot/>`) — bez `max-width`, `mx-auto` ani paddingu. `global.css`
(Tailwind 4, CSS-first) nie definiuje żadnego `.container`, custom breakpointów ani tokenów
szerokości. **Każda strona ręcznie roluje własny wrapper.** W obiegu są trzy różne szerokości
treści i dwa różne mechanizmy centrowania:

| Wzorzec | max-width | Centrowanie | Strony |
|---|---|---|---|
| Home (wyjątek) | `max-w-4xl` (896px) | `mx-auto` + `p-4 sm:p-8` | `index.astro` |
| App/Topbar (standard) | `max-w-md` (448px) | `mx-auto` + `p-4` | katalog, zagrody/[id], anuluj, 404, dashboard, zapytania/*, |
| Auth (karta) | `max-w-sm` (384px) | `flex items-center justify-center` + `p-4` | signin, signup, forgot-password, reset-password, confirm-email |

Kluczowe obserwacje:
1. **Home jest jedynym outlierem** — 2× szersza (896px vs 448px), jedyna z responsywnym
   paddingiem (`sm:p-8`), jedyna z dwupoziomowym modelem szerokości (`max-w-2xl` w środku
   `max-w-4xl`).
2. **Auth używa innego centrowania** (flex vertical center) niż reszta (`mx-auto`, top-align)
   i **nie ma Topbara**.
3. **Padding to zawsze `p-*` (wszystkie boki), nigdy `px-*`** — nie ma żadnego responsywnego
   gutteru poziomego (`sm:px-`, `lg:px-`). Poza Home gutter jest płaski `p-4` na każdym progu.
4. **Dashboard/zapytania są wewnętrznie w pełni spójne** (identyczny wrapper), ale kolumna
   `max-w-md` nigdy się nie poszerza na desktopie — na dużym ekranie to wciąż 448px z 16px gutterem.
5. **Topbar nie jest wstrzykiwany przez Layout** — jest wklejony bezpośrednio w 8 stronach
   (duplikacja) i czyta `Astro.locals.user` server-side. To główny kandydat do centralizacji.
6. Praktycznie cała responsywność opiera się o próg `sm:` (19 wystąpień); `md:` 2, `lg:` 3,
   `xl:` 1, `2xl:` nieużywany. Jedyny responsywny grid to `TurnusyEditor.tsx` (`sm:grid-cols-2`).

## Detailed Findings

### A. Wspólna powłoka: Layout / global.css / Topbar / Banner

**`src/layouts/Layout.astro` — zero kontraktu szerokości.**
- `Layout.astro:39` — `<body>` **bez żadnej klasy**.
- `Layout.astro:56` — goły `<slot />`.
- `Layout.astro:60-67` — jedyny styl: `html, body { margin:0; width:100%; height:100% }`.
- Wnioski: layout nie narzuca szerokości/paddingu/centrowania — każda strona odpowiada za siebie.

**`src/styles/global.css` — Tailwind 4 CSS-first, brak tokenów szerokości.**
- `global.css:1` — `@import "tailwindcss";` (brak `tailwind.config.js`).
- `global.css:29-49` — `@theme`: tylko `--font-sans` + paleta kolorów. **Brak custom breakpointów,
  brak `--container-*`, brak tokenów szerokości.**
- `@utility`: `card-surface` (`:167`, stały `padding: 1.5rem`), `tap-target` (`:232`,
  `min-height: 2.75rem`), `input-field` (`:240`, `width:100%`), `btn-*` (`:180`, `:207`).
  **Żadne nie dotyczą szerokości kontenera.**
- `@layer base` (`:263-286`) — normalizacja natywnych inputów date/time pod iOS Safari.
- **Zero definicji `.container`**, custom breakpointów, ani utility szerokości.
- Breakpointy = domyślne Tailwind (sm 640, md 768, lg 1024, xl 1280, 2xl 1536).

**`src/components/Topbar.astro`** — `Topbar.astro:27` root: `... flex min-w-0 items-center
justify-between gap-3 rounded-xl border bg-white px-4 py-2 text-sm` — **bez `max-width`, bez
`mx-auto`**; szerokość dziedziczy z wrappera strony. Linki desktop `hidden ... sm:flex`
(`:33`). Mobile drawer w `TopbarMobileMenu.tsx` (`sm:hidden`, panel `w-72 max-w-[85vw]`).

**`src/components/Banner.astro`** — pełna szerokość (full-bleed), styl scoped CSS, bez klas
szerokości Tailwind.

**`astro.config.mjs`** — Tailwind jako plugin Vite (potwierdza CSS-first), `output: "server"`,
integracje react/sitemap, adapter cloudflare. Nic związanego z szerokością.

### B. Inwentarz stron publicznych

| Strona | file:line | Centrowanie | max-width | Padding base | sm: | Topbar? |
|---|---|---|---|---|---|---|
| index (Home) | `index.astro:32-33` | `mx-auto` | **max-w-4xl** (896px) | `p-4` | **`p-8`** | tak |
| katalog | `katalog.astro:111-112` | `mx-auto` | **max-w-md** (448px) | `p-4` | — | tak |
| zagrody/[id] | `zagrody/[id].astro:65-66` | `mx-auto` | **max-w-md** (448px) | `p-4` | — | tak |
| anuluj | `anuluj.astro:17-18` | `mx-auto` | **max-w-md** (448px) | `p-4` | — | tak |
| 404 | `404.astro:8-9` | `mx-auto` | **max-w-md** (448px) | `p-4` | — | tak |
| auth/signin | `auth/signin.astro:10-11` | **flex center** | **max-w-sm** (384px) | `p-4` | — | nie |
| auth/signup | `auth/signup.astro:10-11` | flex center | max-w-sm | `p-4` | — | nie |
| auth/forgot-password | `auth/forgot-password.astro:10-11` | flex center | max-w-sm | `p-4` | — | nie |
| auth/reset-password | `auth/reset-password.astro:19-20` | flex center | max-w-sm | `p-4` | — | nie |
| auth/confirm-email | `auth/confirm-email.astro:10-11` | flex center | max-w-sm | `p-4` | — | nie |

- **Dwie konkurencyjne powłoki** (obie rolowane per-strona, Layout nie daje żadnej):
  - Scroll/top-align: `<div class="bg-meadow min-h-screen p-4">` → `<div class="mx-auto w-full max-w-md">`.
  - Centered card (auth): `<div class="bg-meadow flex min-h-screen items-center justify-center p-4">` → `<div class="card-surface w-full max-w-sm">`.
- Home dodatkowo: hero `section.px-2 py-16 ... sm:py-24` (`index.astro:37`), teksty hero `max-w-2xl` (`:39`, `:42`) — dwupoziomowa szerokość.
- Gridy: `index.astro:74` `grid-cols-1 sm:grid-cols-3` vs `index.astro:90` `grid-cols-1 md:grid-cols-2`
  — **niespójny próg dla tej samej intencji "karty w wiele kolumn"** w jednym pliku.
- `ZagrodaCard.astro:27` — `flex gap-3` (foto+tekst obok siebie), brak progu; katalog to
  jednokolumnowa `ul` (`katalog.astro:178`) — karty nigdy nie tworzą multi-column gridu.

### C. Inwentarz dashboardu (obszar zalogowanego właściciela)

- **Trzy strony dashboardu są w 100% spójne między sobą** — identyczny wrapper dwupoziomowy:
  `bg-meadow min-h-screen p-4` → `mx-auto w-full max-w-md` → `<main class="card-surface">`.
  - `dashboard.astro:47-50`
  - `dashboard/zapytania/index.astro:38-41`
  - `dashboard/zapytania/[id].astro:70-73`
- **Brak jakiegokolwiek skalowania szerokości/paddingu na desktopie** — płaskie `max-w-md`
  (448px) + `p-4` (16px) na każdym progu; zero `sm:px-*`, `md:max-w-*` itd.
- **Żaden komponent formularza/karty nie narzuca własnego max-width** — `RequestsList.tsx:31`,
  `RequestDecision.tsx:76`, `CancelRequest.tsx:98`, `BookingRequestForm.tsx:116`,
  `ZagrodaProfileForm.tsx:152`, `PhotoUpload.tsx:54` używają `space-y-*` / `w-full` i dziedziczą
  szerokość z kolumny strony. **Zaleta: szerokość jest scentralizowana w stronach** — poszerzenie
  dashboardu wymaga dotknięcia tylko 3 wrapperów stron.
- **Potrójny inset poziomy w kartach:** page `p-4` (16px) + `card-surface` `padding:1.5rem`
  (24px) = 40px, a zagnieżdżone karty (`px-4`/`px-3`/`p-6`) dokładają trzecią warstwę — treść
  liścia bywa wcięta ~56-64px od krawędzi na telefonie.
- Jedyny responsywny grid w całym zestawie: `TurnusyEditor.tsx:71`
  `grid grid-cols-1 gap-2 sm:grid-cols-2`.
- **Topbar mismatch:** przełącza inline↔drawer na `sm` (viewport 640px), ale kolumna dashboardu
  jest zablokowana na `max-w-md` (448px) — na szerokim ekranie pełny inline-nav renderuje się
  w 448px-owym boksie.

### D. Rozrzut wartości (grep po `src/`)

- `max-w-*` użyte: `max-w-4xl` (tylko `index.astro:33`), `max-w-2xl` (tylko teksty hero Home),
  `max-w-md` (7 stron app), `max-w-sm` (5 stron auth), `max-w-xs` (obrazek 404), `max-w-[85vw]`
  (drawer). **Brak `max-w-7xl/6xl/3xl/screen-*`.**
- `container`: **0 wystąpień**. `mx-auto`: wrappery app + Home (auth używa flex).
- `px-`/`sm:px-`/`lg:px-` na wrapperach top-level: **brak** — tylko `p-*`.
- Progi: `sm:` 19, `lg:` 3, `md:` 2, `xl:` 1, `2xl:` 0.

## Code References

- `src/layouts/Layout.astro:39,56,60-67` — goła powłoka, brak kontraktu szerokości.
- `src/styles/global.css:1,29-49,167,232,240` — Tailwind 4 CSS-first; brak tokenów szerokości; `card-surface`/`tap-target`/`input-field`.
- `src/components/Topbar.astro:27,33` — bar bez max-width; nav `hidden sm:flex`.
- `src/pages/index.astro:32-33,37,39,42,74,90` — outlier `max-w-4xl`, dwupoziomowa szerokość, niespójne progi gridów.
- `src/pages/katalog.astro:111-112,146,178` — `max-w-md`; filtr `flex-col sm:flex-row`; wyniki jednokolumnowe.
- `src/pages/zagrody/[id].astro:65-66` — `max-w-md`.
- `src/pages/anuluj.astro:17-18`, `src/pages/404.astro:8-9` — `max-w-md`.
- `src/pages/auth/{signin,signup,forgot-password,reset-password,confirm-email}.astro:~10-20` — flex center, `max-w-sm`, brak Topbara.
- `src/pages/dashboard.astro:47-50`, `dashboard/zapytania/index.astro:38-41`, `dashboard/zapytania/[id].astro:70-73` — spójny wrapper `max-w-md`.
- `src/components/zagroda/TurnusyEditor.tsx:71` — jedyny responsywny grid.

## Architecture Insights

- **Punkt dźwigni to Tailwind 4 CSS-first (`@theme` + `@utility` w `global.css`)** — sankcjonowany
  wzorzec „edit-one-file". Wspólny kontener powinien iść tym idiomem (współdzielony layout `.astro`
  i/lub `@utility`), a nie rozsypane klasy per-strona.
- **Dwa problemy do rozdzielenia:**
  1. *Szerokość treści* — brak wspólnego tokenu; 3 wartości w obiegu; brak responsywnego poszerzania.
  2. *Powłoka strony* — duplikacja `bg-meadow min-h-screen p-4` + `mx-auto w-full max-w-*` +
     ręczne wklejanie Topbara w 8 stronach.
- **Gotcha dla wspólnego layoutu:** Topbar czyta `Astro.locals.user` server-side; wyspy React nie
  mają dostępu do `Astro.locals` (`fix-mobile-ui-bugs/plan.md:47`). Wspólna powłoka `.astro`
  (przyjmująca `user`/props) to naturalne miejsce na centralizację Topbara — ale musi zostać
  komponentem Astro, nie wyspą.
- **Kształt rozwiązania (szkic do decyzji w planie):** wprowadzić w `Layout.astro` lub w nowym
  `PageShell.astro` opcjonalny slot na wyśrodkowany kontener z jednym, parametryzowanym progiem
  szerokości (np. prop `width="narrow|default|wide"` → `max-w-sm|max-w-md|max-w-4xl`), plus
  wspólny responsywny gutter (`px-4 sm:px-6 lg:px-8` zamiast płaskiego `p-4`). Auth (centered card)
  i strony app (top-align) mogą być dwoma wariantami tej samej powłoki, a Topbar dołączany
  warunkowo przez shell zamiast wklejany per-strona.

## Historical Context (from prior changes)

- **`context/archive/2026-07-12-new-user-interface/plan.md:43`** — locked guardrail: „**Bez zmian
  struktury layoutu** — jednokolumnowy `max-w-md`/`max-w-*` mobile-first zostaje". `plan.md:359`
  — final review sprawdza „że `max-w-*` trzyma kompozycję" na szerokim desktopie. Wspólny kontener
  nie był *odrzucony merytorycznie* — był poza zakresem tamtych zmian, świadomie odłożony do
  dedykowanej zmiany (tej).
- **`context/archive/2026-07-12-new-user-interface/research.md:98`** — polityka e2e single-device
  (Pixel 5 ~393px) „opiera się o jednokolumnowy `max-w-md` layout — jeśli redesign zmienia
  strukturę kontenera, to założenie osłabnie". → jeśli wspólny kontener zmieni strukturę, trzeba
  zrewidować uzasadnienie jednego urządzenia w e2e.
- **`context/archive/2026-07-12-fix-mobile-ui-bugs/`** (6 faz + 2 poprawki, wszystko zamknięte) —
  „Nie przeprojektowujemy szkieletów stron" (`plan.md:33`). Dotknął: viewport `initial-scale=1`
  (Layout), `@utility tap-target` + normalizacja date/time iOS (`global.css`), Topbar→hamburger
  drawer (`Topbar.astro` + nowy `TopbarMobileMenu.tsx`), katalog filtr `flex-col sm:flex-row`,
  `TurnusyEditor` `sm:grid-cols-2`, sweep zawijania treści + regression gate
  `e2e/mobile-320.spec.ts`. **Nie ruszać/duplikować tych poprawek — refaktor szerokości ma je
  respektować.**
- **Correctness floor = 320px, „dopięty @360+"** (`fix-mobile-ui-bugs/plan.md:34`); poniżej 320px
  brak zero-tolerance. **Tap-target ≥44px** to guardrail repo-wide (`@utility tap-target`).
- **Budżet szerokości treści:** przy 320px `p-4` + `card-surface` daje ~240px użytecznej treści
  (`fix-mobile-ui-bugs/research.md:41`) — mieć na uwadze przy zmianie gutterów.
- **`context/foundation/lessons.md`** nie zawiera lekcji RWD/layout (tylko DB lock-order i deploy) —
  wiedza RWD żyje w powyższych change-docs.

## Related Research

- `context/archive/2026-07-12-fix-mobile-ui-bugs/research.md` — analiza mobilnych bugów @320px.
- `context/archive/2026-07-12-new-user-interface/research.md` — Tailwind 4 CSS-first, tokeny, guardrail `max-w-*`.

## Open Questions

1. **Docelowy próg szerokości content na desktopie** — czy dashboard/katalog mają się poszerzać
   powyżej `max-w-md` (448px) na `lg:`/`xl:`, czy jednokolumnowy mobile-first pozostaje intencjonalny
   (guardrail e2e)? To decyzja produktowa do planu.
2. **Home**: sprowadzić do wspólnego kontenera czy zachować jako celowo szerszą landing?
3. **Auth**: ujednolicić do wspólnej powłoki (wariant „centered card") czy zostawić osobno?
4. **Zakres shared-shell**: sam wspólny kontener szerokości, czy również centralizacja Topbara/paddingu/
   `bg-meadow min-h-screen` (większy refaktor 8 stron)?
5. **Wpływ na e2e single-device** — jeśli zmieniamy strukturę kontenera, czy `e2e/mobile-320.spec.ts`
   i polityka jednego urządzenia wymagają aktualizacji?
