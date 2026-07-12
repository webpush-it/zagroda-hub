---
date: 2026-07-12T00:42:18+02:00
researcher: Claude (Fable 5)
git_commit: c49d89c955cdcd2d46d399b45c6f28f0761d780d
branch: master
repository: zagroda-hub
topic: "Redesign UI — odejście od wyglądu startera na rzecz motywu dopasowanego do tematyki aplikacji"
tags: [research, codebase, ui, design-system, tailwind, re-theme, polonization]
status: complete
last_updated: 2026-07-12
last_updated_by: Claude (Fable 5)
---

# Research: Redesign UI — odejście od wyglądu startera na rzecz motywu dopasowanego do tematyki

**Date**: 2026-07-12T00:42:18+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: c49d89c955cdcd2d46d399b45c6f28f0761d780d
**Branch**: master
**Repository**: zagroda-hub

## Research Question

„Popraw design UI tak, aby nie wyglądał jak starter, ale żeby był dostosowany do tematyki aplikacji" — Zagroda Hub to polska platforma katalogowo-rezerwacyjna dla **zagród edukacyjnych** (wycieczki szkolne; persony: nauczyciel-gość i właściciel zagrody pracujący jednoręcznie na telefonie w terenie). Research ma ugruntować plan pełnego re-themingu.

## Summary

1. **„Starterowość" UI to dziś przede wszystkim motyw wizualny, nie treść.** Copy stron jest już polskie i domenowe (landing przeprojektowany w czerwcu 2026), ale skóra całej aplikacji to ciemny „kosmiczny" motyw z 10x Astro Startera: gradient `bg-cosmic` (`#0a0e1a → #0f1529`) na 12 stronach, glassmorphism (`border-white/10 bg-white/10 backdrop-blur-xl`), gradientowe nagłówki `from-blue-200 to-purple-200`, fioletowe przyciski `bg-purple-600`. Zero związku z tematyką zagród/natury/edukacji.
2. **Poprzednia zmiana świadomie ZACHOWAŁA ten motyw** („język wizualny produktu, nie starter" — `context/archive/2026-06-15-landing-page-redesign/plan.md:26-32`). Ta zmiana tę decyzję odwraca — re-theme musi być **globalny** (31 z 34 plików `.astro`/`.tsx` nosi hardkodowane klasy palety), inaczej strony będą się gryzły.
3. **Istnieje naturalny kierunek brandu: zieleń.** Szablony e-mail są już domenowo obrandowane — jasne tło `#f4f4f1`, biała karta, zielony nagłówek `#2d5a27` z wordmarkiem „Zagroda Hub" (`src/lib/email/layout.ts`). To jedyny istniejący „kolor marki" i punkt odniesienia do uspójnienia web ↔ e-mail.
4. **Mechanika re-themingu jest tania dzięki Tailwind v4 (CSS-first).** Tokeny shadcn w `src/styles/global.css` to nietknięte defaulty (prawie nic ich nie konsumuje — tylko `button.tsx` importowany w 1 pliku). Rekomendowana dźwignia: semantyczne tokeny `@theme` + utility-szkielety `@utility` (wzorzec już sprawdzony — `bg-cosmic` to jednolinijkowa dźwignia dla 11 stron), potem mechaniczna migracja idiomów (idiomy powtarzają się verbatim).
5. **Największe twarde pozostałości startera**: angielskie copy w React-owych formularzach auth (`SignInForm/SignUpForm/ResetPasswordForm` — labelki, walidacje, przyciski „Sign in"), `<html lang="en">`, starterowy favicon (rakieta na granacie), martwy `LibBadge.astro`, nieużywany `public/template.png` (1,2 MB), link do dokumentacji startera w `config-status.ts`, jasny off-palette `Banner.astro`.
6. **Ograniczenia**: 6 lokatorów Playwright zależy od ANGIELSKIEGO copy auth („Email"/„Password"/„Sign in") — polonizacja musi iść w parze z aktualizacją speców (CI **nie** uruchamia e2e, więc regres byłby cichy). Mobile-first `max-w-md`, jedna kolumna, lokatory oparte o accessible names (zero `data-testid`) — to kontrakty do zachowania.

## Detailed Findings

### 1. Inwentarz powierzchni UI (co podlega re-themingowi)

**Strony (wszystkie na `bg-cosmic` + glass + gradient h1):**

| Route | Plik | Wyspy React |
|---|---|---|
| `/` | `src/pages/index.astro` (cosmic L34, gradient L41, btn L9,84) | — |
| `/katalog` | `src/pages/katalog.astro` (cosmic L112, select z `[color-scheme:dark]` L107) | — |
| `/zagrody/:id` | `src/pages/zagrody/[id].astro` (cosmic L64; inline-404 L59) | `BookingRequestForm client:load` L115 |
| `/dashboard` | `src/pages/dashboard.astro` (cosmic L47) | `ZagrodaProfileForm client:load` L61 |
| `/dashboard/zapytania` | `src/pages/dashboard/zapytania/index.astro` (cosmic L38) | `RequestsList client:load` L47 |
| `/dashboard/zapytania/:id` | `src/pages/dashboard/zapytania/[id].astro` (cosmic L70; inline-404 L58) | `RequestDecision client:load` L140 |
| `/anuluj` | `src/pages/anuluj.astro` (cosmic L17) | `CancelRequest client:load` L29 |
| `/auth/signin`, `/auth/signup` | `src/pages/auth/signin.astro`, `signup.astro` (cosmic L10, wariant wycentrowany `max-w-sm`) | `SignInForm`/`SignUpForm` + `OAuthButtons` |
| `/auth/forgot-password`, `/auth/reset-password`, `/auth/confirm-email` | `src/pages/auth/*.astro` | `ResetPasswordForm` (reset) |

**Komponenty współdzielone:** `src/components/Topbar.astro` (nawigacja, linki `text-purple-300`), `src/components/katalog/ZagrodaCard.astro` (karta katalogu, glass L25; placeholder zdjęcia = emoji `🏡` L33-39), `src/components/booking/StatusBadge.tsx` (kolory statusów amber/green/red — semantycznie OK, do przestrojenia odcieni).

**Brak dedykowanej strony 404** — 404 renderowane inline w dwóch stronach; redesign to okazja, by dodać `src/pages/404.astro`.

**Zasięg idiomów (wystąpienia / pliki):** `bg-cosmic` 12/12, `bg-white/…` 68/23, `border-white/…` 57/24, `text-blue-1xx` 69/24, `text-purple-…` 40/14, `bg-purple-…` 21/11, `backdrop-blur` 13/13, gradient-heading 11 stron. **Unia: 31 z 34 plików.** Idiomy powtarzają się verbatim (np. `index.astro:8-12` definiuje lokalne consty `primaryBtn`/`secondaryBtn`/`card`), więc migracja jest w dużej mierze mechaniczna.

### 2. Architektura stylów (dźwignie re-themingu)

- **Tailwind v4.2, CSS-first, bez `tailwind.config.*`** — całość w `src/styles/global.css` (125 linii), wpięta przez `@tailwindcss/vite` (`astro.config.mjs:6,14`).
- `src/styles/global.css:6-73` — **stockowe, achromatyczne tokeny shadcn/neutral** (`:root` + `.dark`, oklch chroma 0); `L75-111` `@theme inline` mapuje je na tokeny Tailwinda. **Praktycznie nic ich nie konsumuje** — jedyny odbiorca to `src/components/ui/button.tsx`, importowany wyłącznie przez `src/components/auth/SubmitButton.tsx:18`, który… i tak nadpisuje go klasą `bg-purple-600`.
- `src/styles/global.css:113-115` — `@utility bg-cosmic` (jedyna customowa utility; dowód, że jednolinijkowa dźwignia motywu działa app-wide).
- **Ciemny motyw jest hardkodowany na poziomie klas, nie tokenów** — `.dark` nigdy nie jest aplikowany, brak jakiegokolwiek przełącznika motywu; tokeny bazowe resolwują się do jasnych wartości, które każda strona natychmiast zamalowuje `bg-cosmic`. Przejście na jasny motyw wymaga likwidacji systemu `bg-white/N` glass (biała mgła na jasnym tle jest niewidoczna).
- **Fonty: żadnych** — czysty systemowy `font-sans`; e-maile używają Arial. Wybór fontu brandowego to otwarta, bezkosztowa dźwignia.
- **Assety**: `public/favicon.png` (32×32, starterowa „rakieta" na granacie — do podmiany), `public/template.png` (1,2 MB, **nieużywany** — do usunięcia), brak logo i og-image (`og:image` w ogóle nieobecny w `Layout.astro:19-31`).
- **shadcn/ui footprint ≈ zero**: `components.json` (styl `new-york`, baseColor `neutral`), `src/lib/utils.ts` z `cn()`, ale w `src/components/ui/` tylko `button.tsx` (+ martwy `LibBadge.astro`).
- **Stack/deploy (korekta względem CLAUDE.md.scaffold):** faktyczny adapter to **`@astrojs/cloudflare`** + `wrangler.jsonc` + `src/worker.ts` (nie Vercel); Astro 6.3, React 19.2.

**Opcje re-themingu (z analizy, wg rekomendacji):**
1. **(b) Semantyczne tokeny `@theme` + szkielety `@utility`** (`--color-brand-*`, `--color-surface`, `@utility card-surface`, `btn-primary`…), potem migracja plików na tokeny. Blast radius migracji ~31 plików (jak każda opcja), ale kolejne re-themingi = edycja 1 pliku; jedyna opcja czysto przeżywająca flip dark→light. Przy okazji przekolorować tokeny shadcn `:root`, żeby `button.tsx` i przyszłe komponenty grały z motywem.
2. **(c) Pełna adopcja shadcn** — najlepszy stan końcowy, ale komponentyzacja ~30 plików podwaja diff; robić przyrostowo PO (b).
3. **(a) Goły find/replace klas** — najtańszy jednorazowo, ale tylko jeśli nowy motyw zostaje ciemno-szklany; nie przeżywa jasnego motywu i odtwarza dług.

### 3. Twarde pozostałości startera (checklista)

- `src/components/auth/SignInForm.tsx:21-89` — angielskie labelki/walidacje/przyciski („Email", „Password", „Sign in", „Signing in..."); analogicznie `SignUpForm.tsx:34-114`, `ResetPasswordForm.tsx:27-93`; `PasswordToggle.tsx:14` aria-label „Show/Hide password".
- `src/layouts/Layout.astro:20` — `<html lang="en">` na w pełni polskiej stronie.
- `src/components/ui/LibBadge.astro` — martwy komponent startera (0 użyć) — usunąć.
- `src/components/Banner.astro:27-41` — hardkodowane jasne kolory (`#dbeafe`, `#fef3c7`, `#fee2e2`) gryzące się z każdym motywem.
- `src/lib/config-status.ts:16` — `docsUrl` do `github.com/przeprogramowani/10x-astro-starter#…` widoczny dla użytkownika przez Banner.
- `public/favicon.png` (starterowa rakieta), `public/template.png` (nieużywany), `package.json` `name: "10x-astro-starter"` (wewnętrzne).
- Placeholder zdjęcia zagrody = emoji `🏡` (`ZagrodaCard.astro:33-39`, `zagrody/[id].astro:78-84`) — kandydat na domenową ilustrację.

### 4. Tematyka aplikacji — istniejące kotwice brandu

- **E-maile już mają markę**: `src/lib/email/layout.ts` — jasne tło `#f4f4f1`, biała karta, **zielony `#2d5a27`** nagłówek z wordmarkiem „Zagroda Hub", `lang="pl"`, polska stopka. To jedyny istniejący kolor brandu; web (fiolet) i e-mail (zieleń) są dziś rozjechane — re-theme powinien je uzgodnić (naturalnie: w stronę zieleni/natury).
- Domena produktu (PRD): zagrody edukacyjne, dzieci/szkoła, zwierzęta, wieś, praca w terenie → ciepła, jasna, naturalna paleta jest zgodna z tematyką; ciemny kosmos jest jej zaprzeczeniem.
- Guardrail PRD (musi przetrwać): panel używalny na telefonie w pionie, jednoręcznie; katalog < 2 s.

### 5. Ograniczenia z testów (co pęknie / czego nie ruszać)

- **Pęknie przy polonizacji auth (6 lokatorów, 2 spec-i)**: `e2e/critical-flow.spec.ts:93,97,98` i `e2e/idor-contact-data.spec.ts:48,52,53` — `getByLabel("Email")`, `getByLabel("Password", { exact: true })`, `getByRole("button", { name: "Sign in" })`. Źródła: `SignInForm.tsx:47,60,89`. **Sprzężenie**: `exact: true` na „Password" istnieje po to, by nie łapać aria-label `PasswordToggle` — polonizując labelkę na „Hasło", trzeba spolszczyć też aria-label toggle'a i zaktualizować spec w tym samym commicie (komentarze w specach: `critical-flow.spec.ts:96`, `idor-contact-data.spec.ts:51`).
- **Pęknie przy zmianie nagłówka katalogu**: `e2e/smoke.spec.ts:13` — `getByRole("heading", { name: "Katalog zagród" })`.
- **Nie przeformułowywać (kontrakty spec/PRD)**: `critical-flow.spec.ts:121` — „Limit dzienny przekroczony (1 z 1 zajęte, 1 wymaga miejsca)" (oracle FR-014); „Akceptuj", „Oczekujące", „Zapytanie wysłane — sprawdź e-mail", „Zaakceptowano — nauczyciel dostanie e-mail", polskie labelki formularza rezerwacji (`critical-flow.spec.ts:78-89`).
- **CI nie uruchamia e2e** (`.github/workflows/ci.yml`: lint + build + vitest; e2e odroczone do fazy 4 test-planu) — regres lokatorów byłby cichy; plan redesignu musi jawnie wymagać `npm run test:e2e` lokalnie.
- **Brak snapshotów wizualnych i testów komponentów** — czysty re-theme CSS nie może zepsuć Vitest; jedyne ryzyko to lokatory e2e (accessible names — zero `data-testid`, polityka celowa).
- E2E działa na **Pixel 5 (portrait)** przeciw zbudowanemu workerowi (`npx wrangler dev`, port 8787); uzasadnienie jednego urządzenia opiera się o jednokolumnowy `max-w-md` layout — jeśli redesign zmienia strukturę kontenera, to założenie osłabnie (`context/archive/2026-06-14-testing-e2e-critical-flow-mobile/plan.md:56`).

### 6. Dostępność / kontrast (do naprawienia przy okazji)

- `text-blue-100/50` (15 użyć) i `/40` na ciemnym glass — na granicy / poniżej WCAG AA 4.5:1; `text-white/40` (3 użycia) — poniżej AA.
- `hover:bg-purple-500` + biały tekst ≈ 3.4:1 — poniżej AA dla normalnego tekstu (stan bazowy `purple-600` ≈ 4.7:1 przechodzi).
- Bordery inputów `border-white/20` — poniżej 3:1 dla non-text UI.
- Gradientowe nagłówki `bg-clip-text text-transparent` bez koloru fallbacku.
- Na plus: `eslint-plugin-jsx-a11y` w lint, emoji-placeholdery `aria-hidden`, lokatory e2e wymuszają poprawne accessible names.

## Code References

- `src/styles/global.css:113-115` — definicja `@utility bg-cosmic`; `:6-73` — nietknięte tokeny shadcn; główna dźwignia re-themingu
- `src/pages/index.astro:8-12` — lokalne consty `primaryBtn`/`secondaryBtn`/`card` (wzorzec idiomów do stokenizowania)
- `src/pages/katalog.astro:107` — jedyny `[color-scheme:dark]` + `[&>option]:bg-slate-900` (do zdjęcia przy jasnym motywie)
- `src/components/ui/button.tsx` — jedyny komponent na tokenach semantycznych (kotwica opcji shadcn)
- `src/components/auth/SubmitButton.tsx:18` — nadpisuje Button klasą `bg-purple-600` (symptom obejścia tokenów)
- `src/components/auth/SignInForm.tsx:21-89`, `SignUpForm.tsx:34-114`, `ResetPasswordForm.tsx:27-93`, `PasswordToggle.tsx:14` — angielskie copy do polonizacji
- `src/lib/email/layout.ts:27` — zielony brand e-maili `#2d5a27`, jasne tło `#f4f4f1`
- `src/layouts/Layout.astro:20` — `lang="en"`; `:19-31` — brak `og:image`
- `src/components/katalog/ZagrodaCard.astro:33-39`, `src/pages/zagrody/[id].astro:78-84` — emoji-placeholdery zdjęć
- `src/lib/config-status.ts:16` — link do docs startera
- `e2e/critical-flow.spec.ts:93-98,121`, `e2e/idor-contact-data.spec.ts:48-53`, `e2e/smoke.spec.ts:13` — lokatory sprzężone z copy
- `.github/workflows/ci.yml` — lint + build + vitest (bez e2e)

## Architecture Insights

- **Motyw jest zakodowany w klasach utility, nie w tokenach** — system tokenów shadcn istnieje w global.css, ale jest omijany; to zarazem dług i szansa: tokeny można przekolorować „za darmo", bo nic od nich nie zależy.
- **Idiomy wizualne są verbatim-regularne** (ta sama literalna klasa karty/przycisku/nagłówka w ~31 plikach) — migracja na semantyczne utility jest mechaniczna i dobrze skryptowalna.
- **Glassmorphism `bg-white/N` zakłada ciemne tło** — decyzja dark vs light jest pierwszą decyzją planu, bo determinuje, czy idiomy da się przemapować 1:1 (dark) czy trzeba je zastąpić realnymi powierzchniami (`bg-card` itp., light).
- **Stabilność e2e wisi wyłącznie na accessible names** (celowo zero `data-testid`) — każda zmiana semantyki nagłówków/labelek/przycisków to potencjalny cichy regres, bo CI nie odpala Playwrighta.
- **Stack faktyczny: Astro 6 SSR na Cloudflare Workers** (wrangler), nie Vercel jak sugeruje CLAUDE.md.scaffold.

## Historical Context (from prior changes)

- `context/archive/2026-06-15-landing-page-redesign/plan.md:26-32,74-76` — jawna decyzja „zostajemy w ciemnym `bg-cosmic`; ciemny motyw + glass + purple to język wizualny produktu, nie starter" — **ta zmiana tę decyzję odwraca i musi to zrobić globalnie**.
- `context/archive/2026-06-15-landing-page-redesign/plan.md:143-144` + `reviews/impl-review.md` (F1) — pełny PL-pass formularzy auth jawnie odroczony jako follow-up → domyka go ta zmiana.
- `context/archive/2026-06-15-landing-page-redesign/plan.md:81-83` — favicon + og-image odroczone („wymaga assetu graficznego") → domyka ta zmiana.
- `context/archive/2026-06-14-testing-e2e-critical-flow-mobile/plan.md:56,58,193`, `research.md:182-186` — jednokolumnowy `max-w-md` mobile-first, polityka lokatorów role/label/text bez `data-testid`, czytelność na Pixel 5.
- `context/archive/2026-06-07-catalog-browse-and-zagroda-page/plan.md:157,261` — katalog i strona zagrody celowo bez client-side JS (SSR-only, najtańsze na mobile) — redesign nie powinien dodawać wysp bez potrzeby.

## Related Research

- Brak wcześniejszych `research.md` dotyczących UI; najbliższe artefakty to plan i review zmiany `landing-page-redesign` (wyżej).

## Open Questions

1. **Dark czy light?** Tematyka (zagrody, natura, dzieci) i istniejący brand e-maili (zieleń na jasnym tle) sugerują jasny, ciepły motyw — ale to odwraca zapisaną decyzję produktową i wymaga zastąpienia systemu glass realnymi powierzchniami. Decyzja użytkownika przed planem.
2. **Paleta brandu** — czy kanonizujemy zieleń `#2d5a27` z e-maili jako kolor marki (web ↔ e-mail spójne), czy wybieramy nową paletę i aktualizujemy też `email/layout.ts`?
3. **Assety graficzne** — favicon/logo/og-image/placeholder zdjęcia zagrody wymagają wytworzenia assetów (SVG generowany w repo? zewnętrzny plik od użytkownika?). Co jest dostępne?
4. **Font brandowy** — zostać na system stack (zero kosztu, szybkość na mobile) czy dodać webfont (np. przyjazny serif/rounded sans dla „edukacyjnego" charakteru) kosztem transferu?
5. **Zakres polonizacji vs testy** — polonizacja auth wymaga zmiany speców e2e w tym samym commicie i lokalnego `npm run test:e2e` (CI tego nie złapie). Czy przy okazji dodać job e2e do CI (test-plan §3 faza 4), czy zostawić poza zakresem?
6. **Strona 404** — dodać dedykowaną `src/pages/404.astro` w ramach redesignu?
